// tests/test-sector-logger.mjs — physical-sector offset learning with
// circular statistics. Loads the UMD module via tests/_load.mjs.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const SL = loadBTHG(['js/sector-logger.js']).SectorLogger;
const ORDER = SL.DEFAULT_ORDER;

// ---- Test 1: offsetOf matches Brandon's two real spins ----
{
  // Spin A: reference 4, winner 13. Spin B: reference 33, winner 22.
  assert.equal(SL.offsetOf(4, 13), 22, 'ref 4 -> win 13 is 22 pockets along the wheel');
  assert.equal(SL.offsetOf(33, 22), 18, 'ref 33 -> win 22 is 18 pockets');
  assert.equal(SL.offsetOf(0, 0), 0, 'same number is offset 0');
  assert.equal(SL.offsetOf(999, 13), null, 'unknown number -> null, no throw');
  console.log('offsetOf on real spins: PASS');
}

// ---- Test 2: perfect consistency -> tight arc, strong confidence ----
{
  // Build 6 spins all with a fixed offset of exactly 10 pockets: pick
  // ref = ORDER[i], win = ORDER[(i+10)%38].
  const obs = [];
  for (let i = 0; i < 6; i++) obs.push({ refNum: ORDER[i], winNum: ORDER[(i + 10) % 38] });
  const r = SL.analyze(obs);
  assert.equal(r.count, 6);
  assert.ok(Math.abs(r.meanOffset - 10) < 1e-6, 'mean offset is exactly 10');
  assert.ok(r.R > 0.9999, 'perfect cluster -> R ~ 1');
  assert.ok(r.scatterPockets < 0.01, 'zero spread');
  assert.equal(r.confidence.label, 'strong');
  const p = r.predict(0); // ref 0 (index 0) -> center index 10 -> ORDER[10]=5
  assert.equal(p.center, ORDER[10], 'predicts the exact center for a perfect wheel');
  assert.equal(p.halfWidth, 1, 'tight arc floored at 1 pocket each side');
  console.log('perfect consistency -> strong, exact prediction: PASS');
}

// ---- Test 3: circular mean handles the 0/37 wrap correctly ----
{
  // Offsets of 1 and 37 (i.e. -1). A naive arithmetic mean would give 19
  // (garbage, the opposite side of the wheel); the circular mean must be
  // 0 (or 38), the true center between +1 and -1.
  // ref ORDER[0]=0: win ORDER[1] -> offset 1; win ORDER[37] -> offset 37.
  const obs = [
    { refNum: ORDER[0], winNum: ORDER[1] },
    { refNum: ORDER[0], winNum: ORDER[37] },
  ];
  const r = SL.analyze(obs);
  const m = r.meanOffset % 38;
  assert.ok(m < 0.01 || m > 37.99, `circular mean wraps to ~0, got ${m.toFixed(3)}`);
  console.log('circular mean handles 0/37 wrap: PASS');
}

// ---- Test 4: scattered data -> no edge, no prediction ----
{
  // 8 spins with offsets spread all around the wheel -> low R.
  const spread = [0, 5, 10, 15, 19, 24, 29, 34];
  const obs = spread.map((off, i) => ({ refNum: ORDER[i], winNum: ORDER[(i + off) % 38] }));
  const r = SL.analyze(obs);
  assert.ok(r.R < 0.4, 'uniform spread -> low concentration');
  assert.equal(r.confidence.tier, 0, 'scattered -> no usable edge');
  assert.equal(r.predict(ORDER[0]), null, 'no prediction when scattered (tier 0), even with count>=5');
  console.log('scattered data -> no edge: PASS');
}

// ---- Test 5: below MIN_SPINS -> collecting, no prediction ----
{
  const obs = [{ refNum: 4, winNum: 13 }, { refNum: 33, winNum: 22 }];
  const r = SL.analyze(obs);
  assert.equal(r.count, 2);
  assert.equal(r.confidence.label, 'collecting');
  assert.equal(r.predict(4), null, 'no prediction under MIN_SPINS');
  // but the mean offset is still computed for display (22 and 18 -> ~20)
  assert.ok(r.meanOffset > 19 && r.meanOffset < 21, `two-spin mean ~20, got ${r.meanOffset.toFixed(2)}`);
  console.log('below MIN_SPINS -> collecting, mean still shown: PASS');
}

// ---- Test 6: tight-but-real cluster -> moderate, sane arc ----
{
  // 6 spins with offsets clustered around 20 (+/- ~4): a real bounce.
  const offs = [18, 22, 20, 16, 24, 20];
  const obs = offs.map((off, i) => ({ refNum: ORDER[i], winNum: ORDER[(i + off) % 38] }));
  const r = SL.analyze(obs);
  assert.ok(Math.abs(r.meanOffset - 20) < 1.5, `center ~20, got ${r.meanOffset.toFixed(2)}`);
  assert.ok(r.scatterPockets > 1 && r.scatterPockets < 6, `real spread, got ${r.scatterPockets.toFixed(2)}`);
  assert.ok(['moderate', 'strong'].includes(r.confidence.label));
  const p = r.predict(ORDER[0]);
  assert.ok(p && p.arc.length === p.halfWidth * 2 + 1, 'arc spans center +/- halfWidth');
  console.log('realistic cluster -> moderate confidence, sane arc: PASS');
}

console.log('sector-logger: ALL PASS');
