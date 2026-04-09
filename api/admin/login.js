// ============================================================
// api/admin/login.js — Admin password authentication
// Verifies a password against a scrypt hash stored in env, returns
// a short-lived admin JWT on success. Rate limited aggressively.
// ============================================================

import { getSql } from '../../lib/db.js';
import { verifyPassword, requireEnv } from '../../lib/security.js';
import { issueAdminToken } from '../../lib/auth.js';
import { enforceRateLimit } from '../../lib/ratelimit.js';
import {
  requireMethod,
  sanitizeString,
  getClientIp,
} from '../../lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  // Very aggressive limit: 5 attempts per 15 minutes per IP
  if (!enforceRateLimit(req, res, `admin-login:${ip}`, 5, 15 * 60 * 1000)) return;

  try {
    const password = sanitizeString(req.body?.password || '', 500);
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const hash = requireEnv('BTHG_ADMIN_PASSWORD_HASH');
    const ok = verifyPassword(password, hash);

    // Log every attempt (for audit and monitoring)
    try {
      const sql = getSql();
      await sql`
        INSERT INTO login_attempts (ip_address, endpoint, success)
        VALUES (${ip}::inet, 'admin', ${ok})
      `;
    } catch (err) {
      console.error('[admin-login] log failed:', err.message);
    }

    if (!ok) {
      // Constant-delay on failure to blunt timing attacks
      await new Promise((r) => setTimeout(r, 200));
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = await issueAdminToken();
    return res.status(200).json({ token, expiresIn: 28800 });
  } catch (err) {
    console.error('[admin-login] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
