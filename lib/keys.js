// ============================================================
// lib/keys.js — Server-side BTHG access key signing & verification
// The HMAC secret NEVER leaves the server. Keys are cryptographically
// bound to a specific payload (issue time, duration) and cannot be
// forged without access to BTHG_HMAC_SECRET.
// ============================================================

import { randomBytes } from 'node:crypto';
import { hmacSign, hmacVerify, requireEnv } from './security.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'BTHG';

function base64urlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Generate a cryptographically signed access key.
 *
 * Format: BTHG-<payload>-<sig>-<nonce>
 * - payload: base64url(JSON({ iat, exp, jti }))
 * - sig: 32 hex chars of HMAC-SHA256(payload) using BTHG_HMAC_SECRET
 * - nonce: unique 8-byte random — prevents key enumeration and ensures
 *   each key has a unique database row even for identical payloads
 *
 * @param {number} durationDays - how long the key is valid
 * @returns {{ key: string, jti: string, iat: number, exp: number }}
 */
export function generateKey(durationDays) {
  const secret = requireEnv('BTHG_HMAC_SECRET');
  const now = Date.now();
  const exp = now + Math.floor(durationDays * DAY_MS);
  const jti = randomBytes(16).toString('hex'); // unique JWT-style ID

  const payload = base64urlEncode(JSON.stringify({ iat: now, exp, jti }));
  const sig = hmacSign(payload, secret).substring(0, 32);
  const nonce = randomBytes(4).toString('hex'); // 8 hex chars

  // Format as BTHG-<chunks> for user-friendly display
  const raw = `${payload}.${sig}.${nonce}`;
  const chunks = [];
  for (let i = 0; i < raw.length; i += 6) {
    chunks.push(raw.substring(i, i + 6));
  }
  const key = `${KEY_PREFIX}-${chunks.join('-')}`;

  return { key, jti, iat: now, exp, durationDays };
}

/**
 * Verify an access key's HMAC signature and parse its payload.
 * Returns null if invalid, expired, or malformed. Does NOT check
 * whether the key was revoked or already used — that's a DB lookup.
 *
 * @param {string} keyStr
 * @returns {{ jti: string, iat: number, exp: number } | null}
 */
export function verifyKey(keyStr) {
  if (typeof keyStr !== 'string') return null;
  if (!keyStr.startsWith(`${KEY_PREFIX}-`)) return null;

  try {
    const secret = requireEnv('BTHG_HMAC_SECRET');
    const stripped = keyStr.substring(KEY_PREFIX.length + 1).replace(/-/g, '');
    const parts = stripped.split('.');
    if (parts.length !== 3) return null;
    const [payload, sig, _nonce] = parts;

    if (!hmacVerify(payload, sig, secret)) return null;

    const data = JSON.parse(base64urlDecode(payload));
    if (!data.iat || !data.exp || !data.jti) return null;

    if (Date.now() > data.exp) return null; // expired

    return { jti: data.jti, iat: data.iat, exp: data.exp };
  } catch {
    return null;
  }
}
