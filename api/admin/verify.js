// ============================================================
// api/admin/verify.js — Validate an admin JWT without DB lookup
// Called by the client on app page load to confirm the stored
// admin token is still valid (signed, not expired).
// ============================================================

import { requireAdmin } from '../../lib/auth.js';
import { enforceRateLimit } from '../../lib/ratelimit.js';
import { requireMethod, getClientIp } from '../../lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://beatthehousegaming.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireMethod(req, res, 'POST')) return;

  const ip = getClientIp(req);
  if (!enforceRateLimit(req, res, `admin-verify:${ip}`, 30, 60 * 1000)) return;

  const payload = await requireAdmin(req, res);
  if (!payload) return; // requireAdmin already sent 401/403

  return res.status(200).json({ valid: true, role: payload.role });
}
