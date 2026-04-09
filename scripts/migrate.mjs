#!/usr/bin/env node
// ============================================================
// scripts/migrate.mjs
// Apply SQL migration files to the Neon database.
// Runs migrations in alphabetical order, ignoring already-applied ones.
//
// Usage: DATABASE_URL=... node scripts/migrate.mjs
// ============================================================

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set.');
  console.error('Run: DATABASE_URL="postgresql://..." node scripts/migrate.mjs');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function run() {
  await ensureMigrationsTable();

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ⏭  ${file} (already applied)`);
      continue;
    }
    const contents = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`  ▶  Running ${file}...`);
    // Split on semicolons carefully — allows multiple statements per file
    const statements = contents
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      // Use raw query — migrations are trusted source
      await sql.query(stmt);
    }
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    console.log(`  ✓  ${file} applied`);
  }

  console.log('\nAll migrations applied successfully.');
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
