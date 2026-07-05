// tests/test-timing-engine.mjs — cycle cadence + drift + gap estimator.
// Loads the UMD module via tests/_load.mjs's vm sandbox, same as the
// other engine tests.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const TE = loadBTHG(['js/timing-engine.js']).TimingEngine;

const T0 = 1_700_000_000_000; // fixed epoch ms
const SEC = 1000;

// Build a sitting of `n` spins spaced `stepSec` apart (plus per-spin
// jitter in ms if provided as an array), starting at T0.
function sitting(stepSecs) {
  let t = T0;
  const out = [{ timestamp: t }];
  for (const s of stepSecs) { t += s * SEC; out.push({ timestamp: t }); }
  return out;
}

// ---- Test 1: clean ~50s cadence is learned, next drop predicted ----
{
  // 10 cycles at exactly 50s.
  const s = sitting(Array(10).fill(50));
  const now = s[s.length - 1].timestamp + 12 * SEC; // 12s after the last drop
  const r = TE.analyze({ sitting: s, nowLive: now });

  assert.equal(r.sampleCount, 10, '10 clean cycles');
  assert.equal(r.cycleSec, 50, 'median cycle is 50s');
  assert.equal(r.cycleCV, 0, 'zero variance on a fixed cadence');
  assert.equal(r.confidence.tier, 3, 'fixed cadence reads tight');
  assert.equal(r.secToNextDrop, 38, 'next drop due 50 - 12 = 38s from now');
  assert.equal(r.sectorPredictable, false, 'never claims pocket prediction at tap resolution');
  assert.ok(/cycling about every 50.0 seconds/.test(r.alert.message));
  console.log('clean 50s cadence learned + next-drop predicted: PASS');
}

// ---- Test 2: breaks and fumbles are excluded from cadence ----
{
  // 6 real 50s cycles, then a 40-minute break, then 5 more 50s cycles,
  // with one 2s fumble spliced in (double tap).
  const steps = [50, 50, 50, 2, 50, 50, 40 * 60, 50, 50, 50, 50, 50];
  const s = sitting(steps);
  const r = TE.analyze({ sitting: s });
  // clean intervals: all the 50s ones (10 of them); the 2s fumble and
  // the 2400s break are both dropped.
  assert.equal(r.sampleCount, 10, 'fumble (<8s) and break (>2min) both excluded');
  assert.equal(r.cycleSec, 50, 'cadence still 50s despite the noise');
  console.log('fumbles and breaks excluded from cadence: PASS');
}

// ---- Test 3: gap estimator (missed spins over an away period) ----
{
  const s = sitting(Array(8).fill(50)); // solid 50s cadence learned
  const r = TE.analyze({ sitting: s });
  const g = r.gapEstimate(53 * 60 * SEC); // 53 minutes away
  assert.equal(g.estimatedSpins, Math.round((53 * 60 * SEC) / (50 * SEC)), '53min / 50s ~= 64 spins');
  assert.equal(g.estimatedSpins, 64);
  assert.equal(g.assumedDefault, false, 'used the learned cadence, not the default');
  assert.equal(g.cycleUsed, 50 * SEC);
  console.log('gap estimator: 53min gap ~= 64 missed spins from learned cadence: PASS');
}

// ---- Test 4: too little data -> gap estimator falls back to default ----
{
  const s = sitting([50, 50]); // only 2 cycles, under MIN_INTERVALS
  const r = TE.analyze({ sitting: s });
  assert.equal(r.confidence.tier, 0, 'under MIN_INTERVALS -> building');
  assert.equal(r.alert, null, 'no cadence card until enough clean cycles');
  const g = r.gapEstimate(10 * 60 * SEC);
  assert.equal(g.assumedDefault, true, 'falls back to the 50s default assumption');
  assert.equal(g.estimatedSpins, 12, '10min / 50s default = 12');
  console.log('sparse data -> default-cycle fallback, flagged: PASS');
}

// ---- Test 5: drift detection (cadence lengthening) ----
{
  // 6 cycles at 45s, then 6 at 55s -> recent window is clearly longer.
  const steps = [...Array(6).fill(45), ...Array(6).fill(55)];
  const s = sitting(steps);
  const r = TE.analyze({ sitting: s });
  assert.equal(r.drift, 'lengthening', 'recent cycles longer than earlier -> lengthening');
  assert.ok(/lengthening/.test(r.alert.message), 'drift surfaced in the card');
  console.log('drift detection (lengthening cadence): PASS');
}

// ---- Test 6: empty / single-spin input is safe ----
{
  assert.equal(TE.analyze({ sitting: [] }).cycleMs, null);
  assert.equal(TE.analyze({ sitting: [{ timestamp: T0 }] }).sampleCount, 0);
  assert.equal(TE.analyze({}).cycleMs, null, 'missing sitting is tolerated');
  console.log('empty/single-spin input safe: PASS');
}

console.log('timing-engine: ALL PASS');
