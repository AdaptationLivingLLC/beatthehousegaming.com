// ============================================================
// lib/security.js — Core security primitives for BTHG backend
// Constant-time comparison, input validation, scrypt password hashing
// ============================================================

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

/**
 * Constant-time string comparison. Always use for comparing secrets —
 * plain `===` leaks timing information that attackers can exploit.
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hash a password using scrypt with a random salt.
 * Returns a self-contained string: scrypt$N$r$p$salt_hex$derived_key_hex
 */
export function hashPassword(password) {
  const N = 16384, r = 8, p = 1, keyLen = 64;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a password against a scrypt hash string.
 * Uses constant-time comparison. Returns true only on exact match.
 */
export function verifyPassword(password, hashString) {
  try {
    const parts = hashString.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, derivedHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(derivedHex, 'hex');
    const actual = scryptSync(password, salt, expected.length, {
      N: parseInt(N, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * HMAC-SHA256 signing. Used for access-key signatures.
 * Returns a hex-encoded signature.
 */
export function hmacSign(data, secret) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature using constant-time comparison.
 */
export function hmacVerify(data, signature, secret) {
  const expected = hmacSign(data, secret);
  return safeCompare(signature, expected);
}

/**
 * Validate and normalize an email address. Returns the lowercase email
 * or null if invalid. Does NOT check MX records or deliverability.
 */
export function validateEmail(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  // RFC 5322-ish: local@domain.tld, no whitespace, printable only
  const re = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  return re.test(trimmed) ? trimmed : null;
}

/**
 * Basic input sanitizer — strips control characters and caps length.
 * Does NOT escape HTML (use per-context escaping for that).
 */
export function sanitizeString(raw, maxLength = 500) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Require a request method. Returns true if allowed, false (and sends
 * 405) otherwise.
 */
export function requireMethod(req, res, method) {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: 'Method Not Allowed' });
    return false;
  }
  return true;
}

/**
 * Extract client IP from Vercel request headers.
 * Falls back to x-forwarded-for, then socket.remoteAddress.
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Get a required env variable or throw (fail-fast on boot).
 * Never log the value — only log that it's missing.
 */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
}
