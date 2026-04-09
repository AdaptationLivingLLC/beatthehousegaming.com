// ============================================================
// api/verify-key.js — Server-side access key verification
// Replaces the (insecure) client-side HMAC check. The HMAC secret
// never leaves the server. On success, returns a signed session JWT.
// ============================================================

import { createHash } from 'node:crypto';
import { getSql } from '../lib/db.js';
import { verifyKey } from '../lib/keys.js';
import { issueSessionToken } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import {
  requireMethod,
  sanitizeString,
  getClientIp,
} from '../lib/security.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  // Aggressive rate limit on key verification — 5 per minute per IP
  if (!enforceRateLimit(req, res, `verify-key:${ip}`, 5, 60 * 1000)) return;

  try {
    const keyStr = sanitizeString(req.body?.key || '', 500);
    if (!keyStr) {
      return res.status(400).json({ error: 'Key required' });
    }

    // Verify HMAC signature and expiration
    const payload = verifyKey(keyStr);
    if (!payload) {
      await logAttempt(ip, false);
      return res.status(401).json({ error: 'Invalid or expired key' });
    }

    // Check the database — is this key known, not revoked, not used?
    const sql = getSql();
    const keyHash = sha256(keyStr);
    const rows = await sql`
      SELECT id, jti, email, expires_at, used_at, revoked_at, duration_days
      FROM access_keys
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      await logAttempt(ip, false);
      return res.status(401).json({ error: 'Key not recognized' });
    }

    const row = rows[0];
    if (row.revoked_at) {
      await logAttempt(ip, false);
      return res.status(401).json({ error: 'Key has been revoked' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await logAttempt(ip, false);
      return res.status(401).json({ error: 'Key has expired' });
    }

    // Mark first-use timestamp (idempotent — only sets if null)
    if (!row.used_at) {
      await sql`UPDATE access_keys SET used_at = NOW() WHERE id = ${row.id}`;
    }

    // Issue a session JWT tied to this key's jti
    const sessionToken = await issueSessionToken({
      jti: row.jti,
      exp: new Date(row.expires_at).getTime(),
      role: 'user',
    });

    await logAttempt(ip, true);

    return res.status(200).json({
      session: sessionToken,
      expiresAt: row.expires_at,
      durationDays: row.duration_days,
    });
  } catch (err) {
    console.error('[verify-key] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

async function logAttempt(ip, success) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO login_attempts (ip_address, endpoint, success)
      VALUES (${ip}::inet, 'key', ${success})
    `;
  } catch (err) {
    console.error('[verify-key] log failed:', err.message);
  }
}
