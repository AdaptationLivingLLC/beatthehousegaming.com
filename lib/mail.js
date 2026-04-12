// ============================================================
// lib/mail.js — Resend email wrapper for BTHG transactional email
// ============================================================

import { Resend } from 'resend';
import { requireEnv } from './security.js';

let _resend = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(requireEnv('RESEND_API_KEY'));
  }
  return _resend;
}

const FROM = process.env.RESEND_FROM_EMAIL || 'Roulette Breaker <no-reply@beatthehousegaming.com>';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'brandon@beatthehousegaming.com';

/**
 * Send a transactional email. Never pass raw user input as the subject
 * or body — always validate/sanitize upstream.
 */
export async function sendMail({ to, subject, html, text }) {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
  });
  if (error) {
    // Log the error but don't leak internal details to the caller
    console.error('[mail] Resend error:', error.message || 'unknown');
    throw new Error('Email delivery failed');
  }
  return data;
}

/**
 * Send the lifetime-access welcome email after a successful Stripe purchase.
 */
export async function sendAccessKeyEmail({ to, key, orderId }) {
  const subject = 'Your Roulette Breaker Lifetime Access Key';
  const appUrl = (process.env.PUBLIC_SITE_URL || 'https://beatthehousegaming.com');
  const keyUrl = `${appUrl}?key=${encodeURIComponent(key)}`;

  const html = `
    <div style="font-family: Inter, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #fff; padding: 2rem;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <h1 style="font-family: 'Cinzel', Georgia, serif; color: #d4af37; font-size: 1.8rem; margin: 0;">ROULETTE BREAKER</h1>
        <p style="color: #888; font-size: 0.9rem; margin: 0.5rem 0 0;">Beat The House Gaming</p>
      </div>
      <p style="font-size: 1.1rem;">Welcome aboard.</p>
      <p>Your lifetime access to Roulette Breaker has been activated. Click the button below to launch the app, or copy your access key and use it manually at any time.</p>
      <div style="text-align: center; margin: 2rem 0;">
        <a href="${keyUrl}" style="display: inline-block; padding: 1rem 2rem; background: #d4af37; color: #000; text-decoration: none; font-weight: 700; border-radius: 6px; letter-spacing: 0.05em;">LAUNCH ROULETTE BREAKER</a>
      </div>
      <p style="color: #aaa; font-size: 0.9rem;">Your access key:</p>
      <div style="font-family: monospace; font-size: 1rem; background: #1a1a1a; padding: 1rem; border: 1px solid #333; border-radius: 6px; word-break: break-all; color: #d4af37;">
        ${escapeHtml(key)}
      </div>
      <p style="color: #aaa; font-size: 0.85rem; margin-top: 2rem;">Save this email. You can redeem your key at <a href="${appUrl}" style="color: #d4af37;">${appUrl}</a> at any time from any device.</p>
      <hr style="border: none; border-top: 1px solid #222; margin: 2rem 0;">
      <p style="color: #666; font-size: 0.8rem;">Order ID: ${escapeHtml(orderId)}</p>
      <p style="color: #666; font-size: 0.8rem;">Questions? Reply to this email — it goes directly to Brandon.</p>
    </div>
  `;

  const text = `Roulette Breaker — Lifetime Access\n\nYour lifetime access key:\n${key}\n\nLaunch the app:\n${keyUrl}\n\nOrder ID: ${orderId}\n\nReply to this email for support.`;

  return sendMail({ to, subject, html, text });
}

/**
 * Send a lead-capture notification to Brandon.
 */
export async function sendLeadNotification({ source, payload }) {
  const subject = `[BTHG Lead] ${source}`;
  const html = `
    <div style="font-family: Inter, sans-serif;">
      <h2>New lead captured</h2>
      <p><strong>Source:</strong> ${escapeHtml(source)}</p>
      <pre style="background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto;">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </div>
  `;
  return sendMail({
    to: REPLY_TO,
    subject,
    html,
    text: `New BTHG lead from ${source}:\n${JSON.stringify(payload, null, 2)}`,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
