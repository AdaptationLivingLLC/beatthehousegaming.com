// ============================================================
// lib/db.js — Neon Postgres connection (serverless-optimized)
// ============================================================

import { neon, neonConfig } from '@neondatabase/serverless';
import { requireEnv } from './security.js';

// Connection pooling via HTTP (no persistent WebSocket) — best for serverless
neonConfig.fetchConnectionCache = true;

let _sql = null;

/**
 * Get the Neon SQL tagged template function.
 * Lazy-initialized so that missing DATABASE_URL doesn't crash module load.
 *
 * Usage:
 *   const sql = getSql();
 *   const rows = await sql`SELECT * FROM keys WHERE email = ${email}`;
 *
 * Neon's tagged-template syntax parameterizes automatically, so SQL
 * injection via interpolation is not possible when used correctly.
 */
export function getSql() {
  if (!_sql) {
    const url = requireEnv('DATABASE_URL');
    _sql = neon(url);
  }
  return _sql;
}

/**
 * Run a query and return rows. Thin wrapper for simple queries.
 */
export async function query(strings, ...values) {
  const sql = getSql();
  return sql(strings, ...values);
}
