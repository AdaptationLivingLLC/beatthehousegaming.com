import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const { TrinityEngine } = loadBTHG(['js/trinity.js']);

// Never-negative walkthrough: $1 unit, 10 numbers, floor $1
const t = new TrinityEngine({ minUnit: 1, maxUnit: 50 });
for (let miss = 0; miss < 25; miss++) {
  const bet = t.nextBet();
  assert.ok(bet.perNumber >= 1);
  // guarantee: a hit on this spin nets >= floor
  const net = 36 * bet.perNumber - (t.spent + 10 * bet.perNumber);
  assert.ok(net >= 1, `depth ${miss}: net ${net}`);
  t.recordMiss();
}
// cap alert: perNumber will exceed $50 at depth; screens must split correctly
const deep = t.nextBet();
assert.ok(deep.screens >= 2);
assert.ok(deep.perScreen <= 50);
assert.ok(deep.perScreen * deep.screens >= deep.perNumber);

// hit resets and reports true net
const t2 = new TrinityEngine({ minUnit: 1, maxUnit: 50 });
t2.recordMiss(); t2.recordMiss();               // 2 misses at $1 = $20 spent
const r = t2.recordHit();
assert.ok(r.net >= 1);
assert.equal(t2.spent, 0);

// quarter table: increments respect $0.25
const q = new TrinityEngine({ minUnit: 0.25, maxUnit: 50 });
q.recordMiss(); q.recordMiss(); q.recordMiss(); q.recordMiss();
const b = q.nextBet();
assert.equal(Math.round(b.perNumber * 100) % 25, 0);

// ---- Task 23: setCoverage — the live wiring must be able to change the
// escalation coverage count (Final-N members only, excluding 0/00 per the
// brief's rule 6) spin to spin as Final-N membership ages/refills, WITHOUT
// resetting the accumulated cycle deficit (spent/level). Only netPerUnit
// (which depends on coverage) may change.
{
  const t = new TrinityEngine({ minUnit: 5, maxUnit: 500, coverage: 10 });
  t.recordMiss();
  t.recordMiss();
  const spentBefore = t.spent;
  const levelBefore = t.level;
  t.setCoverage(8); // Final 8 only, excluding 0/00
  assert.equal(t.spent, spentBefore, 'setCoverage must not touch spent');
  assert.equal(t.level, levelBefore, 'setCoverage must not touch level');
  assert.equal(t.coverage, 8);
  assert.equal(t.netPerUnit, 36 - 8, 'netPerUnit recomputed for the new coverage');
  console.log('trinity: setCoverage preserves spent/level, recomputes netPerUnit: PASS');
}

// ---- Task 23: toJSON/fromJSON round-trip the mutable cycle state (spent,
// level, coverage) — this is what per-spin undo snapshots (rule 10) and any
// future session persistence rely on to restore the engine EXACTLY, not
// recompute-and-hope.
{
  const t = new TrinityEngine({ minUnit: 5, maxUnit: 500, coverage: 8 });
  t.recordMiss();
  t.recordMiss();
  t.setCoverage(6);
  t.recordMiss();
  const snap = t.toJSON();

  const t2 = new TrinityEngine({ minUnit: 5, maxUnit: 500, coverage: 8 });
  t2.fromJSON(snap);
  assert.equal(t2.spent, t.spent);
  assert.equal(t2.level, t.level);
  assert.equal(t2.coverage, t.coverage);
  assert.deepEqual(t2.nextBet(), t.nextBet(), 'restored engine computes an identical next bet');

  // A fresh, never-touched engine must NOT equal the deep engine's state —
  // proves fromJSON is actually doing the restoring, not a no-op coincidence.
  const t3 = new TrinityEngine({ minUnit: 5, maxUnit: 500, coverage: 8 });
  assert.notEqual(t3.spent, t.spent);
  console.log('trinity: toJSON/fromJSON restores exact cycle state: PASS');
}

console.log('trinity: ALL PASS');
