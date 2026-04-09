// ============================================================
// api/stripe-webhook.js — Stripe webhook handler
// On checkout.session.completed: generate an access key, store it,
// email it to the customer. Idempotent via stripe_session_id unique
// constraint — safe against webhook retries.
// ============================================================

import { createHash } from 'node:crypto';
import { getSql } from '../lib/db.js';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { generateKey } from '../lib/keys.js';
import { sendAccessKeyEmail } from '../lib/mail.js';

// Vercel needs the raw body for Stripe signature verification.
// Disable automatic body parsing so we can read the raw bytes.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // We only care about completed checkout sessions
    if (event.type !== 'checkout.session.completed') {
      return res.status(200).json({ received: true, handled: false });
    }

    const session = event.data.object;
    const sessionId = session.id;
    const customerEmail = session.customer_details?.email || session.customer_email;

    if (!customerEmail) {
      console.error('[stripe-webhook] no customer email in session', sessionId);
      return res.status(200).json({ received: true, error: 'no_email' });
    }

    const sql = getSql();

    // Idempotency check — already processed?
    const existing = await sql`
      SELECT id FROM access_keys WHERE stripe_session_id = ${sessionId} LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(200).json({ received: true, handled: 'duplicate' });
    }

    // Generate a lifetime (100-year) access key
    const { key, jti, exp, durationDays } = generateKey(36500);
    const keyHash = createHash('sha256').update(key).digest('hex');

    await sql`
      INSERT INTO access_keys (
        jti, key_hash, email, duration_days, expires_at, source, stripe_session_id, metadata
      ) VALUES (
        ${jti},
        ${keyHash},
        ${customerEmail.toLowerCase()},
        ${durationDays},
        ${new Date(exp).toISOString()},
        'stripe',
        ${sessionId},
        ${JSON.stringify({
          amount_total: session.amount_total,
          currency: session.currency,
          payment_status: session.payment_status,
        })}::jsonb
      )
    `;

    // Send the welcome email with the access key
    try {
      await sendAccessKeyEmail({
        to: customerEmail,
        key,
        orderId: sessionId,
      });
    } catch (err) {
      // Log but don't fail the webhook — the key is already in the DB
      // and can be resent manually if delivery fails.
      console.error('[stripe-webhook] email failed:', err.message);
    }

    return res.status(200).json({ received: true, handled: 'key_issued' });
  } catch (err) {
    console.error('[stripe-webhook] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
