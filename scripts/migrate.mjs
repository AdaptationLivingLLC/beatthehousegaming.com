#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run() {
  // Create tracking table
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map(r => r.filename)
  );

  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }
    console.log(`  run   ${file}...`);
    const contents = readFileSync(join(migrationsDir, file), 'utf8');

    // Split on semicolons that are NOT inside parentheses
    // Simple approach: split on lines that end with );
    // and lines that end with ; where the line is a standalone statement
    const statements = [];
    let current = '';
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('--')) {
        if (current) current += '\n' + line;
        continue;
      }
      current += (current ? '\n' : '') + line;
      if (trimmed.endsWith(';')) {
        const stmt = current.replace(/;$/, '').trim();
        if (stmt.length > 0) statements.push(stmt);
        current = '';
      }
    }

    for (const stmt of statements) {
      try {
        await sql(stmt);
      } catch (err) {
        console.error(`  FAIL  Statement error in ${file}:`, err.message);
        console.error('  Statement:', stmt.substring(0, 120) + '...');
        process.exit(1);
      }
    }

    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    console.log(`  done  ${file}`);
  }

  console.log('\nAll migrations applied.');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
