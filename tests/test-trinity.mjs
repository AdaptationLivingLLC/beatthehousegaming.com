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
console.log('trinity: ALL PASS');
