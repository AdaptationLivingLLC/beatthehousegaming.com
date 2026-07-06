// ============================================================
// sector-logger.js — BTHG.SectorLogger (physical-sector prediction)
// BTHG Roulette Breaker Web App
//
// Brandon's fixed airball machine (Del Sol, 2026-07-05): the ball
// launches from the same spot, flies for a near-constant time, and drops
// at the same worn spot. So the winning number is decided by where the
// rotor is at drop, which is a near-constant offset from where it was at
// launch. This module LEARNS that offset from real spins and turns it
// into a landing-arc prediction.
//
// Method: each spin the user logs two numbers — the rotor number sitting
// at their reference diamond at LAUNCH, and the WINNING number. The
// per-spin offset is how many pockets (in wheel order) the winner sits
// from the launch reference. Averaged over spins it gives a center, and
// its spread gives the arc width and a confidence.
//
// CRITICAL: the offset is a CIRCULAR quantity on a 38-pocket wheel, so a
// plain arithmetic mean is WRONG (it breaks across the 0/37 wrap). This
// uses proper circular statistics — unit-vector (resultant) averaging —
// for both the mean offset and the scatter. R (resultant length, 0..1)
// is the concentration: R near 1 means the wheel is tightly predictable,
// R near 0 means no sector edge exists on this data.
//
// Pure analyze(); storage helpers use localStorage (additive key per
// machine, no IndexedDB schema touch). Date.now is fine in app/browser
// code. Same UMD wrapper as the other engine modules.
// ============================================================

(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {

  // American wheel order clockwise; 37 encodes 00. If BTHG.WHEEL_LAYOUTS
  // is present (verified per-machine layout, Task 10) the caller can pass
  // it in; this is the default reference order.
  const DEFAULT_ORDER = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2];

  // Minimum logged spins before an offset is worth quoting a prediction
  // on — below this the circular mean is too unstable to trust.
  const MIN_SPINS = 5;

  const disp = n => n === 37 ? '00' : String(n);

  function storeKey(machineId) { return 'bthg_sector_' + (machineId || 'default'); }

  // ---- storage (localStorage, additive) ----
  function load(machineId) {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(storeKey(machineId))) || []; }
    catch { return []; }
  }
  function save(machineId, list) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storeKey(machineId), JSON.stringify(list));
  }
  function logSpin(machineId, refNum, winNum, ts) {
    const list = load(machineId);
    list.push({ refNum, winNum, ts: ts || (typeof Date !== 'undefined' ? Date.now() : 0) });
    save(machineId, list);
    return list;
  }
  function removeLast(machineId) {
    const list = load(machineId);
    list.pop();
    save(machineId, list);
    return list;
  }
  function clear(machineId) { save(machineId, []); }

  // Pockets from ref to win in wheel order (0..N-1). Positions increase
  // in the ORDER array direction; the caller reads it as "the winner sits
  // this many pockets along the wheel from the reference number."
  function offsetOf(refNum, winNum, order) {
    const o = order || DEFAULT_ORDER;
    const ri = o.indexOf(refNum), wi = o.indexOf(winNum);
    if (ri < 0 || wi < 0) return null;
    return ((wi - ri) % o.length + o.length) % o.length;
  }

  /**
   * analyze(observations, order) -> {
   *   count, offsets, meanOffset (fractional pockets), R (0..1),
   *   scatterPockets (circular SD), confidence {tier,label},
   *   predict(refNum) -> { center, centerIndex, arc:[numbers], lo, hi } | null
   * }
   * observations: [{refNum, winNum}]. Malformed entries (number not in
   * the order) are skipped, not thrown on.
   */
  function analyze(observations, order) {
    const o = order || DEFAULT_ORDER;
    const N = o.length;
    const offsets = [];
    for (const ob of (observations || [])) {
      const off = offsetOf(ob.refNum, ob.winNum, o);
      if (off != null) offsets.push(off);
    }
    const count = offsets.length;

    if (count === 0) {
      return { count: 0, offsets, meanOffset: null, R: 0, scatterPockets: null,
        confidence: { tier: 0, label: 'no data' }, predict: () => null };
    }

    // Circular mean via unit-vector sum.
    let sx = 0, sy = 0;
    for (const off of offsets) {
      const a = (off / N) * 2 * Math.PI;
      sx += Math.cos(a); sy += Math.sin(a);
    }
    const R = Math.sqrt(sx * sx + sy * sy) / count; // 0..1 concentration
    let meanAng = Math.atan2(sy, sx);
    if (meanAng < 0) meanAng += 2 * Math.PI;
    const meanOffset = (meanAng / (2 * Math.PI)) * N; // fractional pockets

    // Circular standard deviation (radians -> pockets). R==1 -> 0 spread.
    const circStdRad = R > 0 ? Math.sqrt(-2 * Math.log(R)) : Infinity;
    const scatterPockets = isFinite(circStdRad) ? (circStdRad / (2 * Math.PI)) * N : Infinity;

    // Confidence: needs both enough spins AND a tight cluster.
    let confidence;
    if (count < MIN_SPINS) confidence = { tier: 0, label: 'collecting' };
    else if (scatterPockets <= 3) confidence = { tier: 3, label: 'strong' };
    else if (scatterPockets <= 6) confidence = { tier: 2, label: 'moderate' };
    else if (scatterPockets <= 9) confidence = { tier: 1, label: 'weak' };
    else confidence = { tier: 0, label: 'scattered (no edge)' };

    // Per-spin outlier flag. A spin whose offset sits far from the cluster
    // center is almost never wheel scatter — on Brandon's machine it means
    // the launch number was read off a DIFFERENT reference point (a
    // different diamond), which slides every offset by ~5 pockets per
    // diamond. Flagging it lets the tight cluster stand on its own instead
    // of a stray read widening the whole spread. Circular distance to the
    // mean; OUTLIER_POCKETS is a hair over one diamond spacing (~4.75).
    const OUTLIER_POCKETS = 5;
    const circDist = off => {
      const d = Math.abs(((off - meanOffset) % N + N) % N);
      return Math.min(d, N - d);
    };
    const outliers = offsets
      .map((off, i) => ({ i, off, dist: circDist(off) }))
      .filter(x => x.dist > OUTLIER_POCKETS);

    // Tightness of the CORE cluster (offsets within OUTLIER_POCKETS of the
    // mean) — this is the spread you actually bet on once the off-reference
    // reads are set aside.
    const core = offsets.filter(off => circDist(off) <= OUTLIER_POCKETS);

    function predict(refNum) {
      const ri = o.indexOf(refNum);
      // No prediction without enough spins, an unknown reference, OR when
      // the cluster is too loose to be an edge (tier 0). A "prediction"
      // whose arc spans half the wheel is not a prediction.
      if (ri < 0 || count < MIN_SPINS || confidence.tier === 0) return null;
      const centerIndex = Math.round((ri + meanOffset) % N + N) % N;
      // Arc half-width from the scatter, capped so it can never balloon
      // past a meaningful sector (a bet covering most of the wheel is
      // pointless — that case is already screened out as tier 0 above).
      const half = Math.min(Math.floor(N / 4), Math.max(1, Math.round(scatterPockets)));
      const arc = [];
      for (let d = -half; d <= half; d++) arc.push(o[((centerIndex + d) % N + N) % N]);
      return {
        center: o[centerIndex],
        centerIndex,
        arc,
        halfWidth: half,
        lo: o[((centerIndex - half) % N + N) % N],
        hi: o[((centerIndex + half) % N + N) % N],
      };
    }

    return {
      count, offsets, meanOffset, R, scatterPockets, confidence, predict,
      // i indices into observations/offsets that read as off-reference.
      outlierIndices: outliers.map(x => x.i),
      coreCount: core.length,
    };
  }

  // ============================================================
  // TAP TIMER (dead-stop + wait-time prediction, 2026-07-06)
  //
  // Verified machine facts this model rests on:
  //   1. The wheel decelerates into its reload stop deterministically:
  //      the number at Brandon's diamond at the freeze is always the
  //      previous winner +2 pockets in wheel order (7/7 exact in tape).
  //   2. Flight is a constant ~+18 pockets (launch-reference cluster).
  //   3. The ONLY live variable is T: seconds from the wheel restarting
  //      after its ~1s freeze to the ball firing. The rotor covers
  //      rate*T pockets in that wait.
  // So: winnerIndex ~= idx(lastWinner) + rate*T + MU, where MU bundles
  // every fixed piece (the +2 decel, the spin-up shortfall after the
  // restart, the +18 flight). MU starts at the physics default (+20)
  // and is LEARNED as the circular mean of logged tap residuals, which
  // also absorbs reaction-time bias in the taps.
  // ============================================================
  const TAP_DEFAULT_RATE = 13.2; // rotor pockets/second (editable in panel)
  const TAP_DEFAULT_MU = 20;     // +2 decel-to-stop, +18 flight, no shortfall
  const TAP_MIN_SPINS = 3;

  function tapKey(machineId) { return 'bthg_sector_tap_' + (machineId || 'default'); }
  function tapCfgKey(machineId) { return 'bthg_sector_tapcfg_' + (machineId || 'default'); }

  function tapLoad(machineId) {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(tapKey(machineId))) || []; }
    catch { return []; }
  }
  function tapSave(machineId, list) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(tapKey(machineId), JSON.stringify(list));
  }
  function tapLog(machineId, lastWin, waitSec, winNum, ts) {
    const list = tapLoad(machineId);
    list.push({ lastWin, waitSec, winNum, ts: ts || (typeof Date !== 'undefined' ? Date.now() : 0) });
    tapSave(machineId, list);
    return list;
  }
  function tapRemoveLast(machineId) {
    const list = tapLoad(machineId);
    list.pop();
    tapSave(machineId, list);
    return list;
  }
  function tapClear(machineId) { tapSave(machineId, []); }

  function tapLoadCfg(machineId) {
    if (typeof localStorage === 'undefined') return { rate: TAP_DEFAULT_RATE };
    try {
      const cfg = JSON.parse(localStorage.getItem(tapCfgKey(machineId))) || {};
      return { rate: (cfg.rate > 0) ? cfg.rate : TAP_DEFAULT_RATE };
    } catch { return { rate: TAP_DEFAULT_RATE }; }
  }
  function tapSaveCfg(machineId, cfg) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(tapCfgKey(machineId), JSON.stringify(cfg || {}));
  }

  // Residual: pockets left after removing the measured rotation from the
  // observed travel — one spin's estimate of the machine constant MU.
  // Fractional, wrapped to 0..N.
  function tapResidual(lastWin, waitSec, winNum, rate, order) {
    const o = order || DEFAULT_ORDER;
    const N = o.length;
    const li = o.indexOf(lastWin), wi = o.indexOf(winNum);
    const r = rate > 0 ? rate : TAP_DEFAULT_RATE;
    if (li < 0 || wi < 0 || !(waitSec > 0)) return null;
    const raw = wi - li - r * waitSec;
    return ((raw % N) + N) % N;
  }

  /**
   * tapAnalyze(observations, rate, order) -> {
   *   count, residuals, mu, R, scatter, calibrated, label,
   *   predict(lastWin, waitSec) -> { center, centerIndex, arc, halfWidth, lo, hi } | null
   * }
   * observations: [{lastWin, waitSec, winNum}]. Malformed entries skipped.
   * Before TAP_MIN_SPINS logged taps, predictions run on the physics
   * default MU and are labeled uncalibrated rather than refused — the
   * whole point of the tool is to be usable on spin one and sharpen.
   */
  function tapAnalyze(observations, rate, order) {
    const o = order || DEFAULT_ORDER;
    const N = o.length;
    const r = rate > 0 ? rate : TAP_DEFAULT_RATE;

    const residuals = [];
    for (const ob of (observations || [])) {
      const res = tapResidual(ob.lastWin, ob.waitSec, ob.winNum, r, o);
      if (res != null) residuals.push(res);
    }
    const count = residuals.length;

    let mu = TAP_DEFAULT_MU, R = 0, scatter = null;
    if (count > 0) {
      let sx = 0, sy = 0;
      for (const res of residuals) {
        const a = (res / N) * 2 * Math.PI;
        sx += Math.cos(a); sy += Math.sin(a);
      }
      R = Math.sqrt(sx * sx + sy * sy) / count;
      let ang = Math.atan2(sy, sx);
      if (ang < 0) ang += 2 * Math.PI;
      mu = (ang / (2 * Math.PI)) * N;
      const sd = R > 0 ? Math.sqrt(-2 * Math.log(R)) : Infinity;
      scatter = isFinite(sd) ? (sd / (2 * Math.PI)) * N : Infinity;
    }

    const calibrated = count >= TAP_MIN_SPINS && scatter != null && scatter <= 6;
    let label;
    if (count === 0) label = 'uncalibrated (physics default)';
    else if (count < TAP_MIN_SPINS) label = `calibrating (${count} tap${count > 1 ? 's' : ''})`;
    else if (scatter <= 3) label = 'strong';
    else if (scatter <= 6) label = 'moderate';
    else label = 'scattered — check taps/rate';

    function predict(lastWin, waitSec) {
      const li = o.indexOf(lastWin);
      if (li < 0 || !(waitSec > 0)) return null;
      const centerIndex = ((Math.round(li + r * waitSec + mu) % N) + N) % N;
      const half = calibrated ? Math.min(5, Math.max(2, Math.round(scatter))) : 3;
      const arc = [];
      for (let d2 = -half; d2 <= half; d2++) arc.push(o[((centerIndex + d2) % N + N) % N]);
      return {
        center: o[centerIndex],
        centerIndex,
        arc,
        halfWidth: half,
        lo: o[((centerIndex - half) % N + N) % N],
        hi: o[((centerIndex + half) % N + N) % N],
      };
    }

    return { count, residuals, mu, R, scatter, calibrated, label, predict };
  }

  BTHG.SectorLogger = {
    DEFAULT_ORDER,
    MIN_SPINS,
    disp,
    load, save, logSpin, removeLast, clear,
    offsetOf,
    analyze,
    // tap timer
    TAP_DEFAULT_RATE, TAP_DEFAULT_MU, TAP_MIN_SPINS,
    tapLoad, tapSave, tapLog, tapRemoveLast, tapClear,
    tapLoadCfg, tapSaveCfg,
    tapResidual, tapAnalyze,
  };

  return BTHG.SectorLogger;
});
