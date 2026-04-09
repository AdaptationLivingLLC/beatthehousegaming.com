// ============================================================
// api/admin/generate-key.js — Admin-only key generation endpoint
// Requires a valid admin JWT. Generates a signed access key and
// stores it in the database. Returns the key to the caller so
// they can distribute it manually.
// ============================================================

import { createHash } from 'node:crypto';
import { getSql } from '../../lib/db.js';
import { generateKey } from '../../lib/keys.js';
import { requireAdmin } from '../../lib/auth.js';
import { enforceRateLimit } from '../../lib/ratelimit.js';
import { requireMethod, getClientIp } from '../../lib/security.js';

const ALLOWED_DURATIONS = new Set([1, 3, 7, 14, 30, 90, 365, 36500]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  if (!enforceRateLimit(req, res, `admin-genkey:${ip}`, 20, 60 * 1000)) return;

  // Require admin JWT
  const admin = await requireAdmin(req, res);
  if (!admin) return; // requireAdmin already sent the error response

  try {
    const durationDays = parseInt(req.body?.durationDays, 10);
    if (!ALLOWED_DURATIONS.has(durationDays)) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    const { key, jti, exp } = generateKey(durationDays);
    const keyHash = createHash('sha256').update(key).digest('hex');

    const sql = getSql();
    const [row] = await sql`
      INSERT INTO access_keys (jti, key_hash, duration_days, expires_at, source)
      VALUES (
        ${jti},
        ${keyHash},
        ${durationDays},
        ${new Date(exp).toISOString()},
        'admin'
      )
      RETURNING id, issued_at, expires_at
    `;

    return res.status(200).json({
      key,
      id: row.id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      durationDays,
    });
  } catch (err) {
    console.error('[admin-generate-key] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
