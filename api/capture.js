// ============================================================
// api/capture.js — Lead capture endpoint
// Persists to Neon DB + optional Slack/email notification.
// Rate limited per IP. Validates and sanitizes all input.
// ============================================================

import { getSql } from '../lib/db.js';
import { sendLeadNotification } from '../lib/mail.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import {
  requireMethod,
  validateEmail,
  sanitizeString,
  getClientIp,
} from '../lib/security.js';

export default async function handler(req, res) {
  // CORS — only allow the production domain
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  if (!enforceRateLimit(req, res, `capture:${ip}`, 10, 60 * 1000)) return;

  try {
    const body = req.body || {};
    const source = sanitizeString(body.source || 'unknown', 100);
    const payload = typeof body.payload === 'object' && body.payload !== null ? body.payload : {};

    // Extract common fields, validate and sanitize
    const email = validateEmail(payload.email);
    const name = sanitizeString(payload.name || '', 200);
    const phone = sanitizeString(payload.phone || '', 40);
    const message = sanitizeString(payload.message || '', 5000);

    // Persist
    const sql = getSql();
    const [row] = await sql`
      INSERT INTO leads (source, email, name, phone, message, payload, ip_address, user_agent)
      VALUES (
        ${source},
        ${email},
        ${name || null},
        ${phone || null},
        ${message || null},
        ${JSON.stringify(payload)}::jsonb,
        ${ip}::inet,
        ${sanitizeString(req.headers['user-agent'] || '', 500)}
      )
      RETURNING id, created_at
    `;

    // Fire-and-forget notification (don't block response on email)
    sendLeadNotification({ source, payload: { email, name, phone, message, ...payload } })
      .catch((err) => console.error('[capture] notification failed:', err.message));

    return res.status(200).json({
      status: 'captured',
      id: row.id,
    });
  } catch (err) {
    // Never leak stack traces or DB errors to the client
    console.error('[capture] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
