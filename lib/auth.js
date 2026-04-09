// ============================================================
// lib/auth.js — JWT session issuance and verification
// Sessions are signed JWTs (HS256) stored client-side. The server
// verifies the signature on every API call. No session state is kept
// on the server.
// ============================================================

import { SignJWT, jwtVerify } from 'jose';
import { requireEnv } from './security.js';

let _secretKey = null;

function getSecretKey() {
  if (!_secretKey) {
    const secret = requireEnv('BTHG_JWT_SECRET');
    _secretKey = new TextEncoder().encode(secret);
  }
  return _secretKey;
}

/**
 * Issue a session JWT for a successfully verified access key.
 *
 * @param {{ jti: string, exp: number, role?: string }} payload
 * @returns {Promise<string>} signed JWT
 */
export async function issueSessionToken({ jti, exp, role = 'user' }) {
  const key = getSecretKey();
  return await new SignJWT({ jti, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('beatthehousegaming.com')
    .setAudience('bthg-app')
    .setExpirationTime(Math.floor(exp / 1000)) // jose wants seconds
    .sign(key);
}

/**
 * Verify a session JWT. Returns the payload on success, null on any failure.
 */
export async function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: 'beatthehousegaming.com',
      audience: 'bthg-app',
    });
    return payload;
  } catch {
    return null;
  }
}

/**
 * Issue a short-lived admin session token. Admin tokens are separate
 * from user tokens and include `role: "admin"`.
 */
export async function issueAdminToken() {
  const key = getSecretKey();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setIssuer('beatthehousegaming.com')
    .setAudience('bthg-admin')
    .setExpirationTime(now + 60 * 60 * 8) // 8 hours
    .sign(key);
}

/**
 * Require an admin token from the Authorization header.
 * Returns the payload on success, or sends 401 and returns null.
 */
export async function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  const token = match[1];
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: 'beatthehousegaming.com',
      audience: 'bthg-admin',
    });
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}
