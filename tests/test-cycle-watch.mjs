// tests/test-cycle-watch.mjs — Task 22: cycle watch (consecutive re-hit
// gap tracking, sitting aware)
//
// Loading note: same UMD/Node-ESM interop as js/wheel-verifier.js — see
// that file's header and tests/test-wheel-verifier.mjs's header for the
// full explanation of why this loads via tests/_load.mjs's vm-sandbox
// loader instead of require().
//
// Synthetic-tape convention used throughout: most tapes need a lot of
// "filler" spins that must NEVER create re-hit gaps of their own (a
// stray repeat would contaminate the band histogram under test, and any
// filler whose "ago" happened to land in the watch band would pollute
// the watch list). CycleWatch only tracks real pockets (integers 0-37,
// see isPocket in js/cycle-watch.js) while still counting every record
// toward spin distances, so filler spins here use large, strictly
// incrementing sentinel values (10000, 10001, ...): they hold their
// tape slot (distances and sitting timing stay realistic) but can never
// pool a gap or appear on a watch list. All numbers under actual test
// (re-hit cycles, watch/overdue candidates) are real pockets.

import assert from 'node:assert/strict';
import { deepEqual } from 'node:assert'; // loose: vm-sandbox objects are cross-realm, see test-wheel-verifier.mjs header
import { loadBTHG } from './_load.mjs';

const CW = loadBTHG(['js/cycle-watch.js']).CycleWatch;

const BASE_TS = 1_700_000_000_000; // arbitrary fixed epoch ms, deterministic
const SEC = 1000;
const HOUR = 60 * 60 * 1000;

// Builds a tape of `len` filler spins (unique, non-pocket sentinel
// numbers starting at `fillerStart`), one per second starting at
// `startTs`. Returned array's slots get overwritten by the caller to
// place specific pockets at specific indices.
function fillerTape(len, startTs, fillerStart) {
  const tape = [];
  for (let i = 0; i < len; i++) {
    tape.push({ number: fillerStart + i, timestamp: startTs + i * SEC });
  }
  return tape;
}

// Places pocket `number` at indices startIdx, startIdx+period, ...
// (count times) in `tape`, preserving each slot's original timestamp.
// Throws if a slot was already claimed by an earlier call (guards the
// test itself against accidental index collisions between cycles).
const claimed = new Set();
function setCycle(tape, number, period, startIdx, count) {
  for (let k = 0; k < count; k++) {
    const idx = startIdx + k * period;
    if (claimed.has(idx)) throw new Error(`test tape index collision at ${idx}`);
    claimed.add(idx);
    tape[idx] = { number, timestamp: tape[idx].timestamp };
  }
}

// Shared scenario for tests 1/1b/5: pockets 1-5 each repeating 8 times
// at fixed periods 62/64/65/66/68 spins -> 7 closed gaps each = 35
// pooled gaps, all in the 60-69 bucket (35 >= MIN_GAPS_FOR_SIGNAL of
// 30). Pocket 1's LAST occurrence lands at index 434 of the 500-spin
// tape, i.e. ago 65 — deliberately inside the watch band, so the tests
// below always expect it alongside their own explicit watch candidate.
function bandTape() {
  claimed.clear();
  const TOTAL = 500;
  const tape = fillerTape(TOTAL, BASE_TS, 10000);
  setCycle(tape, 1, 62, 0, 8);
  setCycle(tape, 2, 64, 1, 8);
  setCycle(tape, 3, 65, 2, 8);
  setCycle(tape, 4, 66, 3, 8);
  setCycle(tape, 5, 68, 4, 8);
  return tape;
}

// ---- Test 1: band detection + live watch(ago=58) + overdue(ago=85) ----
// (brief's primary scenario: numbers seeded to re-hit at 62-68 spins)
{
  const tape = bandTape();
  const lastIdx = tape.length - 1;
  // Watch candidate: pocket 8, single hit, exactly 58 spins ago.
  tape[lastIdx - 58] = { number: 8, timestamp: tape[lastIdx - 58].timestamp };
  // Overdue candidate: pocket 9, single hit, exactly 85 spins ago.
  tape[lastIdx - 85] = { number: 9, timestamp: tape[lastIdx - 85].timestamp };

  const res = CW.analyze({ tape });

  assert.equal(res.sittings.length, 1, 'one continuous sitting (all spins 1s apart)');
  assert.ok(res.band, 'band should be computed (35 pooled gaps >= 30)');
  assert.equal(res.band.lo, 60, 'band low bound is the 60s bucket');
  assert.equal(res.band.hi, 69, 'band high bound is the 60s bucket (no adjacent expansion)');
  assert.equal(res.band.median, 65);
  assert.equal(res.band.count, 35);

  // Pocket 1 (last cycle hit 65 spins ago) rides along in the watch
  // band by construction — see bandTape().
  deepEqual(res.watch, [{ number: 1, ago: 65 }, { number: 8, ago: 58 }],
    'ago=58 falls in [55,69] -> watch (with pocket 1 at ago=65)');
  deepEqual(res.overdue, [{ number: 9, ago: 85 }], 'ago=85 > 79 (69+10) -> overdue');

  assert.ok(res.alerts.length <= 3, 'alert cap of 3');
  assert.equal(res.alerts.length, 3, 'band summary + watch + overdue, one each');
  assert.ok(res.alerts.every(a => a.kind === 'cycle'));
  assert.ok(/60 to 70/.test(res.alerts[0].message), 'band summary states the window');
  assert.ok(/Watch 1, 8:/.test(res.alerts[1].message) && /58\+/.test(res.alerts[1].message));
  assert.ok(/^9 overdue/.test(res.alerts[2].message) && /85\+/.test(res.alerts[2].message));
  console.log('band detection + watch(58) + overdue(85): PASS');
}

// ---- Test 1b (bonus, beyond the brief's list): stale "now" suppresses
// live watch/overdue even though the band (background stats) still
// stands, per rule 2 vs rule 3 — nowLive lets analyze() stay pure
// (never reads the clock itself) while still expressing "the last
// sitting already timed out with nothing new logged". ----
{
  const tape = bandTape();
  const lastIdx = tape.length - 1;
  tape[lastIdx - 58] = { number: 8, timestamp: tape[lastIdx - 58].timestamp };

  const lastTs = tape[lastIdx].timestamp;
  const res = CW.analyze({ tape, nowLive: lastTs + 3 * HOUR }); // 3h later, no new spins

  assert.ok(res.band, 'background band still reported (rule 3: history always pooled)');
  assert.equal(res.band.lo, 60);
  deepEqual(res.watch, [], 'no live sitting in progress right now -> no watch');
  deepEqual(res.overdue, [], 'no live sitting in progress right now -> no overdue');
  console.log('stale nowLive suppresses live watch/overdue but keeps background band: PASS');
}

// ---- Test 2: sitting split (two clusters 3 hours apart) ----
// Gaps must not cross the boundary; live watch must use only the
// second (current) cluster.
{
  claimed.clear();
  const CLUSTER_LEN = 50;
  const tapeA = fillerTape(CLUSTER_LEN, BASE_TS, 20000);
  // Last spin of sitting 1 is a hit of pocket 7.
  tapeA[CLUSTER_LEN - 1] = { number: 7, timestamp: tapeA[CLUSTER_LEN - 1].timestamp };

  const gapMs = 3 * HOUR;
  const clusterBStart = tapeA[CLUSTER_LEN - 1].timestamp + gapMs;
  const tapeB = fillerTape(CLUSTER_LEN, clusterBStart, 30000);
  // Second (near-start) hit of pocket 7 in sitting 2 -> if sittings
  // were not split, this would look like a 6-spin re-hit gap for 7
  // (index 55 in the combined tape minus index 49).
  tapeB[5] = { number: 7, timestamp: tapeB[5].timestamp };

  const tape = tapeA.concat(tapeB);
  const sittings = CW.splitSittings(tape);

  assert.equal(sittings.length, 2, 'a >2h gap between spins starts a new sitting');
  assert.equal(sittings[0].length, CLUSTER_LEN);
  assert.equal(sittings[1].length, CLUSTER_LEN);

  const gaps = CW.pooledGaps(sittings);
  assert.equal(gaps.length, 0,
    'pocket 7 appears once per sitting only -> zero pooled gaps (the cross-boundary pair is never paired)');

  // Live ago for pocket 7 must be measured only within sitting 2 (the
  // current sitting), from its sitting-2-local index (5), not any
  // cross-cluster distance.
  const currentSitting = sittings[sittings.length - 1];
  const ago = CW.liveAgo(currentSitting);
  assert.equal(ago.get(7), CLUSTER_LEN - 1 - 5, 'ago computed within sitting 2 only');
  console.log('sitting split: gaps do not cross boundary, live watch uses only current cluster: PASS');
}

// ---- Test 3: series-boundary crossing within ONE sitting ----
// (the whole point of Task 22): a number's re-hit gap is pooled across
// a seriesMarker change as long as it's still the same sitting.
{
  claimed.clear();
  const TOTAL = 200;
  const tape = fillerTape(TOTAL, BASE_TS, 40000);
  // First half of the tape is an archived series (seriesMarker set);
  // second half is the current, still-unmarked series (seriesMarker
  // null) — mirrors js/storage.js SpinDB.markArchived's real shape.
  for (let i = 0; i < 100; i++) tape[i].seriesMarker = 555555;
  for (let i = 100; i < TOTAL; i++) tape[i].seriesMarker = null;

  // Pocket 17 hits once near the end of the archived series and again
  // 65 spins later, inside the live series — same continuous sitting.
  tape[90] = { number: 17, timestamp: tape[90].timestamp, seriesMarker: 555555 };
  tape[155] = { number: 17, timestamp: tape[155].timestamp, seriesMarker: null };

  const sittings = CW.splitSittings(tape);
  assert.equal(sittings.length, 1, 'no time gap in this tape -> one sitting despite the series change');

  const gaps = CW.pooledGaps(sittings);
  deepEqual(gaps, [65], 'the 65-spin gap for pocket 17 is pooled across the series boundary');
  console.log('series-boundary crossing within one sitting: PASS');
}

// ---- Test 4: fewer than 30 pooled gaps -> no watch/overdue, one
// informational alert card ----
{
  claimed.clear();
  const TOTAL = 60;
  const tape = fillerTape(TOTAL, BASE_TS, 50000);
  // Only one repeating pocket -> 4 gaps, well under MIN_GAPS_FOR_SIGNAL.
  setCycle(tape, 21, 10, 0, 5);

  const res = CW.analyze({ tape });
  assert.equal(res.band, null, 'insufficient pooled data -> no band');
  deepEqual(res.watch, []);
  deepEqual(res.overdue, []);
  assert.equal(res.alerts.length, 1, 'exactly one informational alert card');
  assert.equal(res.alerts[0].kind, 'cycle');
  assert.equal(res.alerts[0].samples, 4);
  assert.ok(/not enough/i.test(res.alerts[0].message));
  assert.ok(/4 re-hit gaps recorded, 30 needed/.test(res.alerts[0].message));
  console.log('fewer than 30 pooled gaps -> single informational alert: PASS');
}

// ---- Test 5: 00/37 translation in messages ----
{
  const tape = bandTape();
  const lastIdx = tape.length - 1;
  // 37 (00) is the watch candidate, at ago=58.
  tape[lastIdx - 58] = { number: 37, timestamp: tape[lastIdx - 58].timestamp };

  const res = CW.analyze({ tape });
  deepEqual(res.watch, [{ number: 1, ago: 65 }, { number: 37, ago: 58 }]);

  const watchAlert = res.alerts.find(a => /^Watch /.test(a.message));
  assert.ok(watchAlert, 'watch alert present');
  assert.ok(/Watch 1, 00:/.test(watchAlert.message), 'message shows 00, not the raw number 37');
  for (const a of res.alerts) {
    assert.ok(!/\b37\b/.test(a.message), 'no stray untranslated "37" token in any message');
    assert.ok(!/[–—]/.test(a.message), 'no dashes in user-facing copy');
  }
  console.log('00/37 translation in messages + no dashes: PASS');
}

console.log('cycle-watch: ALL PASS');
