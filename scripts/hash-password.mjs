#!/usr/bin/env node
// ============================================================
// scripts/hash-password.mjs
// Generate a scrypt hash for the BTHG_ADMIN_PASSWORD_HASH env var.
//
// Usage:
//   node scripts/hash-password.mjs
//   (prompts for password silently)
//
//   OR
//   node scripts/hash-password.mjs "your-password-here"
//
// Output: a single-line scrypt hash string to paste into Vercel env.
// ============================================================

import { scryptSync, randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { Writable } from 'node:stream';

function hashPassword(password) {
  const N = 16384, r = 8, p = 1, keyLen = 64;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function promptPassword() {
  const mutableStdout = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  mutableStdout.muted = true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });
  process.stdout.write('Enter admin password: ');
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const passwordArg = process.argv[2];
const password = passwordArg || (await promptPassword());

if (!password || password.length < 12) {
  console.error('ERROR: Password must be at least 12 characters.');
  process.exit(1);
}

const hash = hashPassword(password);
console.log('\nBTHG_ADMIN_PASSWORD_HASH="' + hash + '"');
console.log('\nPaste this into your Vercel project environment variables.');
console.log('Do NOT commit the hash to git — it goes in Vercel Dashboard → Settings → Environment Variables.\n');
