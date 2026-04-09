// ============================================================
// api/verify-session.js — Validate a JWT session token
// Called by the client on app page load to confirm the session is
// still valid. Checks signature, expiration, and revocation list.
// ============================================================

import { getSql } from '../lib/db.js';
import { verifySessionToken } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { requireMethod, getClientIp } from '../lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  if (!enforceRateLimit(req, res, `verify-session:${ip}`, 30, 60 * 1000)) return;

  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ valid: false, error: 'No session' });
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({ valid: false, error: 'Invalid session' });
    }

    // Check revocation list — allows emergency logout of a specific key
    const sql = getSql();
    const revoked = await sql`
      SELECT jti FROM revoked_sessions WHERE jti = ${payload.jti} LIMIT 1
    `;
    if (revoked.length > 0) {
      return res.status(401).json({ valid: false, error: 'Session revoked' });
    }

    // Also check the underlying access key isn't revoked or expired
    const keys = await sql`
      SELECT expires_at, revoked_at FROM access_keys WHERE jti = ${payload.jti} LIMIT 1
    `;
    if (keys.length === 0) {
      return res.status(401).json({ valid: false, error: 'Key not found' });
    }
    const key = keys[0];
    if (key.revoked_at) {
      return res.status(401).json({ valid: false, error: 'Key revoked' });
    }
    if (new Date(key.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ valid: false, error: 'Key expired' });
    }

    return res.status(200).json({
      valid: true,
      role: payload.role,
      expiresAt: key.expires_at,
    });
  } catch (err) {
    console.error('[verify-session] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  return req.body?.session || null;
}
