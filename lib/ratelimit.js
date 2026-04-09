// ============================================================
// lib/ratelimit.js — In-memory sliding-window rate limiter
// For serverless this is per-instance, not global — a determined
// attacker distributing requests across instances can still hit
// individual endpoints harder. Upgrade to Upstash Redis if you
// need cross-instance limiting.
// ============================================================

const buckets = new Map();

// Periodic cleanup to prevent unbounded memory growth
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt < now) buckets.delete(key);
  }
  lastCleanup = now;
}

/**
 * Rate limit by a string key (typically `endpoint:ip` or `endpoint:userId`).
 * Returns { allowed, remaining, resetAt }.
 *
 * @param {string} key - unique identifier for the limited resource
 * @param {number} max - max requests per window
 * @param {number} windowMs - window size in milliseconds
 */
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  cleanup(now);

  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

/**
 * Apply a rate limit and set appropriate response headers.
 * Returns true if the request should proceed, false if it was blocked.
 */
export function enforceRateLimit(req, res, key, max, windowMs) {
  const result = rateLimit(key, max, windowMs);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return false;
  }
  return true;
}
