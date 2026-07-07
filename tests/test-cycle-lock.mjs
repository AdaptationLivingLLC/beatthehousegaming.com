// tests/test-cycle-lock.mjs — consecutive-winner jump agreement ("sticky
// wait" detection from the live tracked numbers). Pure engine tests.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const CL = loadBTHG(['js/cycle-lock.js']).CycleLock;
const ORDER = CL.DEFAULT_ORDER;
const N = ORDER.length;

const at = i => ORDER[((i % N) + N) % N];

// ---- Test 1: jumpOf basics, wrap, and Brandon's real observations ----
{
  assert.equal(CL.jumpOf(21, 21), 0, 'back-to-back repeat is jump 0');
  assert.equal(CL.jumpOf(5, 5), 0, 'the 5,5 pair too');
  assert.equal(CL.jumpOf(37, 0), 19, '00 then 0 is exactly half the wheel');
  assert.equal(CL.jumpOf(2, 0), 1, 'wraps across the order end');
  assert.equal(CL.jumpOf(999, 0), null, 'unknown number -> null, no throw');
  console.log('jumpOf basics + real pairs: PASS');
}

// ---- Test 2: no lock on scattered jumps ----
{
  // Jumps 5, 20, 33 — nothing agrees.
  const h = [at(0), at(5), at(25), at(58)];
  const r = CL.analyze(h);
  assert.equal(r.locked, false);
  assert.equal(r.message, null);
  console.log('scattered history -> no lock: PASS');
}

// ---- Test 3: exact repeat lock (K = 0) ----
{
  // 21, 21, 21: two jumps of 0 -> locked, arc centered on 21.
  const r = CL.analyze([21, 21, 21]);
  assert.equal(r.locked, true);
  assert.equal(r.K, 0);
  assert.equal(r.center, 21);
  assert.equal(r.streak, 2);
  assert.equal(r.halfWidth, 2, 'exact agreement -> tight 5-number arc');
  assert.equal(r.arc.length, 5);
  assert.ok(r.message.includes('CYCLE LOCK +0'), r.message);
  console.log('repeat lock K=0: PASS');
}

// ---- Test 4: locked stretch with bounce (K = 19, jumps 18/19/20) ----
{
  // Indices 0, 18, 37, 57: jumps 18, 19, 20 — all within ±2 of each other.
  const h = [at(0), at(18), at(37), at(57)];
  const r = CL.analyze(h);
  assert.equal(r.locked, true);
  assert.equal(r.K, 19, 'consensus of 18,19,20 is 19');
  assert.equal(r.streak, 3);
  assert.equal(r.halfWidth, 2, 'deviation ±1 from consensus keeps the tight arc');
  assert.equal(r.center, at(57 + 19), 'arc centered K past the last winner');

  // A streak whose members sit 2 off the consensus widens the arc to 7.
  // Jumps 17,19,19,19: K rounds to 19, the 17 sits 2 away.
  const h2 = [at(0), at(17), at(36), at(55), at(74)];
  const r2 = CL.analyze(h2);
  assert.equal(r2.locked, true);
  assert.equal(r2.streak, 4);
  assert.equal(r2.halfWidth, 3, 'deviation of 2 widens arc to 7 numbers');
  console.log('locked stretch with bounce: PASS');
}

// ---- Test 5: lock breaks when the newest jump disagrees ----
{
  // Two agreeing jumps then a wild one -> not locked (the machine moved).
  const h = [at(0), at(19), at(38), at(50)];
  const r = CL.analyze(h);
  assert.equal(r.locked, false, 'newest jump 12 vs prior 19 breaks the lock');
  console.log('newest disagreement kills lock: PASS');
}

// ---- Test 6: unknown numbers break the chain instead of throwing ----
{
  const r0 = CL.analyze([21, 999, 21, 21]);
  assert.equal(r0.locked, false, 'one clean jump after a bad link is not agreement');
  const r = CL.analyze([21, 999, 21, 21, 21]);
  assert.equal(r.locked, true, 'two clean agreeing jumps after the bad link lock');
  assert.equal(r.streak, 2, 'streak stops at the unreadable link');
  const r2 = CL.analyze([21, 999]);
  assert.equal(r2.locked, false);
  console.log('unreadable link handling: PASS');
}

// ---- Test 7: short history -> no lock, empty-safe ----
{
  assert.equal(CL.analyze([]).locked, false);
  assert.equal(CL.analyze([5]).locked, false);
  assert.equal(CL.analyze([5, 5]).locked, false, 'one jump is not agreement');
  console.log('short/empty history: PASS');
}

console.log('ALL CYCLE-LOCK TESTS PASS');
