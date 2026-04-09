#!/usr/bin/env node
// ============================================================
// scripts/generate-secrets.mjs
// Generate fresh cryptographic secrets for BTHG_HMAC_SECRET and
// BTHG_JWT_SECRET. Run this once, paste output into Vercel env.
// ============================================================

import { randomBytes } from 'node:crypto';

console.log('\n# BTHG backend secrets — paste into Vercel Dashboard');
console.log('# → Project → Settings → Environment Variables\n');
console.log(`BTHG_HMAC_SECRET="${randomBytes(32).toString('hex')}"`);
console.log(`BTHG_JWT_SECRET="${randomBytes(32).toString('hex')}"`);
console.log('\n# These secrets must NEVER be committed to git.');
console.log('# Rotate them any time a leak is suspected.\n');
