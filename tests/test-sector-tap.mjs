// tests/test-sector-tap.mjs — tap-timer model: winner ~= lastWin + rate*T + MU.
// MU is learned as the circular mean of per-spin residuals. Loads the UMD
// module via tests/_load.mjs like the other engine tests.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const SL = loadBTHG(['js/sector-logger.js']).SectorLogger;
const ORDER = SL.DEFAULT_ORDER;
const N = ORDER.length;

// ---- Test 1: residual math, exact and wrapped ----
{
  // lastWin = ORDER[0] = 0, rate*T = exactly 10 pockets, winner 30 pockets
  // along -> residual 20 (the physics default MU).
  const T = 10 / 13.2;
  assert.equal(SL.tapResidual(0, T, ORDER[30], 13.2), 20, 'plain residual');

  // Wrap: travel that lands just past a full lap keeps the residual in 0..N.
  const T2 = 40 / 13.2; // 40 pockets = one lap + 2
  const res2 = SL.tapResidual(0, T2, ORDER[(40 + 20) % N], 13.2);
  assert.ok(Math.abs(res2 - 20) < 1e-9, 'residual wraps mod 38');

  // Malformed inputs -> null, no throw.
  assert.equal(SL.tapResidual(999, 5, 14, 13.2), null, 'unknown lastWin');
  assert.equal(SL.tapResidual(0, -3, 14, 13.2), null, 'negative wait');
  assert.equal(SL.tapResidual(0, 5, 999, 13.2), null, 'unknown winner');
  console.log('tapResidual exact/wrap/malformed: PASS');
}

// ---- Test 2: with no data, predict runs on the physics default ----
{
  const r = SL.tapAnalyze([], 13.2);
  assert.equal(r.count, 0);
  assert.equal(r.mu, SL.TAP_DEFAULT_MU);
  assert.equal(r.calibrated, false);
  assert.equal(r.label, 'uncalibrated (physics default)');
  const p = r.predict(0, 10 / 13.2); // 10 pockets of travel + MU 20 -> index 30
  assert.equal(p.center, ORDER[30], 'default-MU prediction lands where physics says');
  assert.equal(p.halfWidth, 3, 'uncalibrated arc is 3 wide each side');
  assert.equal(p.arc.length, 7);
  assert.equal(r.predict(999, 5), null, 'unknown lastWin -> null');
  assert.equal(r.predict(0, 0), null, 'zero wait -> null');
  console.log('uncalibrated predict on defaults: PASS');
}

// ---- Test 3: learning MU from consistent spins ----
{
  // Machine truth MU = 19.5 fractional; build 5 clean spins at varying T.
  const RATE = 13.2, MU = 19.5;
  const obs = [];
  const waits = [12.1, 13.4, 14.3, 15.0, 16.2];
  waits.forEach((T, i) => {
    const li = (i * 7) % N;
    const wi = Math.round(li + RATE * T + MU) % N;
    obs.push({ lastWin: ORDER[li], waitSec: T, winNum: ORDER[wi] });
  });
  const r = SL.tapAnalyze(obs, RATE);
  assert.equal(r.count, 5);
  // Rounding the winner to a whole pocket injects <=0.5 pocket per spin.
  const circErr = Math.min(Math.abs(r.mu - MU), N - Math.abs(r.mu - MU));
  assert.ok(circErr < 0.6, `learned MU ~${MU}, got ${r.mu.toFixed(2)}`);
  assert.ok(r.scatter < 1.5, 'clean spins -> sub-1.5-pocket spread');
  assert.equal(r.calibrated, true);
  assert.equal(r.label, 'strong');
  // Prediction with the learned constant reproduces a held-out spin.
  const T = 13.9, li = 5;
  const wi = Math.round(li + RATE * T + MU) % N;
  const p = r.predict(ORDER[li], T);
  const dist = Math.min(Math.abs(p.centerIndex - wi), N - Math.abs(p.centerIndex - wi));
  assert.ok(dist <= 1, 'held-out spin predicted within a pocket');
  assert.ok(p.halfWidth >= 2 && p.halfWidth <= 5, 'calibrated arc half-width clamped 2..5');
  console.log('MU learning + held-out prediction: PASS');
}

// ---- Test 4: circular mean survives the 0/38 wrap ----
{
  // Residuals hugging both sides of zero: 0.5 and 37.5 -> mean ~0, not ~19.
  const RATE = 13.2;
  const obs = [];
  // Build spins whose residuals are +0.5 and -0.5 (=37.5 wrapped): use
  // waits that are whole-pocket multiples, then nudge the winner index.
  // T=38/RATE is one exact lap, residual = winner index - lastWin index.
  const lap = N / RATE;
  obs.push({ lastWin: ORDER[0], waitSec: lap, winNum: ORDER[0] });   // residual 0
  obs.push({ lastWin: ORDER[0], waitSec: lap, winNum: ORDER[1] });   // +1
  obs.push({ lastWin: ORDER[0], waitSec: lap, winNum: ORDER[N - 1] }); // -1 (37)
  const r = SL.tapAnalyze(obs, RATE);
  const circDist = Math.min(r.mu, N - r.mu);
  assert.ok(circDist < 0.01, `wrap-straddling residuals mean ~0, got ${r.mu.toFixed(3)}`);
  console.log('circular mean across the wrap: PASS');
}

// ---- Test 5: the real video cycle end to end ----
{
  // 2026-07-06 slo-mo: freeze had 00 at the diamond, restart->launch was
  // 14.3s real, winner was 14. In lastWin terms the +2 decel rule puts the
  // previous winner two pockets before 00: ORDER[17] = 13. With the
  // physics-default MU (+20 = +2 decel + +18 flight) and rate 13.2 the
  // model must land on 14.
  const r = SL.tapAnalyze([], 13.2);
  const p = r.predict(13, 14.3);
  assert.equal(p.center, 14, `video cycle predicts 14, got ${p.center}`);
  console.log('real video cycle (stop 00, wait 14.3s -> 14): PASS');
}

// ---- Test 6: storage helpers are additive and guard non-browser env ----
{
  // In Node there is no localStorage: loads return [], saves no-throw.
  // (Loose length check: the module runs in a vm realm, so its arrays fail
  // deepStrictEqual against this realm's [] — same note as tests/_load.mjs.)
  const loaded = SL.tapLoad('m1');
  assert.equal(loaded.length, 0, 'tapLoad returns empty list outside browser');
  assert.doesNotThrow(() => SL.tapLog('m1', 21, 14.3, 14));
  assert.doesNotThrow(() => SL.tapRemoveLast('m1'));
  assert.doesNotThrow(() => SL.tapClear('m1'));
  const cfg = SL.tapLoadCfg('m1');
  assert.equal(cfg.rate, SL.TAP_DEFAULT_RATE);
  console.log('storage guards outside browser: PASS');
}

console.log('ALL SECTOR-TAP TESTS PASS');
