// ============================================================
// timing-engine.js — BTHG.TimingEngine (cycle cadence + drift + gap)
// BTHG Roulette Breaker Web App
//
// What this is and is NOT (Brandon, Del Sol machine 1, 2026-07-05):
// The target machine runs a motor-driven rotor on a fixed cycle: ball
// lands, wheel stops, hub lifts, ball is re-fed, wheel re-spins to the
// same speed, ball launched from the same spot, drops in the same ~6in
// section ~90% of the time. Pocket-to-pocket that whole cycle takes 49
// to 51 seconds (his calibrator readings). This engine LEARNS that
// cadence from the timestamps of the spins he records, so it can:
//   - report the machine's own cycle period and how steady it is,
//   - predict when the NEXT ball drop is due,
//   - detect the cadence drifting longer/shorter over a session,
//   - estimate how many spins happened during a gap he was away for.
//
// Honest ceiling: a finger tap carries roughly a second of noise, and
// the +/-2s cycle wobble spans most of a rotor revolution, so this is
// NOT pocket-level sector prediction (that needs sub-100ms timing from
// camera/audio, not fingers). Every number here is cadence/gap grade,
// and the engine says so via `sectorPredictable: false`. When a finer
// timing source is wired later, the same period/phase math upgrades in
// place.
//
// Pure: analyze() takes the spin tape as data and never reads the clock
// itself (nowLive is passed in), so it is fully unit-testable without a
// browser. Same UMD wrapper / sitting model as js/cycle-watch.js.
// ============================================================

(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {

  // A cycle this far apart in time cannot be one uninterrupted machine
  // cycle — it is a break in play (bathroom, meal, walked away). Inter
  // spin gaps longer than this are excluded from the cadence estimate
  // and are what the gap estimator measures instead. 2 minutes: the
  // real cycle is ~50s, so a genuine cycle never approaches this, while
  // even a short pause clears it.
  const MAX_CYCLE_MS = 2 * 60 * 1000;

  // A cycle cannot physically be shorter than this (the ball is still
  // orbiting). Below it, the two taps were a fumble/double-tap, not two
  // real drops. 8s is well under the ~50s real cycle.
  const MIN_CYCLE_MS = 8 * 1000;

  // Need at least this many clean consecutive-cycle intervals before the
  // cadence is worth quoting a confidence on.
  const MIN_INTERVALS = 5;

  // Recent-window size for drift detection: compare the median of the
  // last N cycles against the median of the ones before them.
  const DRIFT_WINDOW = 6;

  // Fallback cycle when there is no learned cadence yet — his measured
  // 49 to 51s, midpoint. Used ONLY by gapEstimate when the engine has
  // too little data of its own, and flagged as an assumption.
  const DEFAULT_CYCLE_MS = 50 * 1000;

  function median(sorted) {
    if (!sorted.length) return null;
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }

  // Clean consecutive-cycle intervals (ms) from a spin list that is
  // already one sitting (see splitSittings): the elapsed time between
  // each spin and the one before it, keeping only those inside the
  // physically-plausible cycle band. An interval outside the band is a
  // fumble (too short) or a break (too long) and is dropped, never
  // averaged into the cadence.
  function cycleIntervals(sitting) {
    const out = [];
    for (let i = 1; i < sitting.length; i++) {
      // Only measure the gap between two ACTUAL drops. A record with
      // realTime === false is historical back-fill (tapped seconds apart,
      // not a real ~50s cycle); it breaks the chain rather than
      // contributing a bogus short interval. Records with no realTime
      // field (older data) are treated as real, which is what they were.
      const a = sitting[i - 1], b = sitting[i];
      if (a.realTime === false || b.realTime === false) continue;
      const dt = b.timestamp - a.timestamp;
      if (dt >= MIN_CYCLE_MS && dt <= MAX_CYCLE_MS) out.push(dt);
    }
    return out;
  }

  // Confidence tier for a learned cadence: driven by how many clean
  // cycles back it and how steady they are (coefficient of variation).
  // His wheel reads cv ~0.35 on tap timing — real but noisy — so the
  // bands are set so that honest cadence lands "good", never "locked".
  function confidenceFor(count, cv) {
    if (count < MIN_INTERVALS) return { tier: 0, label: 'building' };
    if (cv <= 0.15) return { tier: 3, label: 'tight' };
    if (cv <= 0.30) return { tier: 2, label: 'good' };
    if (cv <= 0.50) return { tier: 1, label: 'loose' };
    return { tier: 0, label: 'noisy' };
  }

  /**
   * BTHG.TimingEngine.analyze({ sitting, nowLive })
   *
   * sitting: the CURRENT sitting's spin records (one continuous run,
   *   from BTHG.CycleWatch.splitSittings(tape) — pass the last segment).
   *   Each record at minimum { timestamp }.
   * nowLive: caller's wall-clock (Date.now() live; fixed in tests).
   *   Optional; defaults to the last spin's timestamp.
   *
   * Returns a plain object (all times ms unless *Sec):
   *   sampleCount, cycleMs, cycleSec, cycleCV, confidence{tier,label},
   *   drift ('steady'|'lengthening'|'shortening'|null),
   *   lastSpinTs, nextDropAt, msToNextDrop, secToNextDrop,
   *   sectorPredictable (always false at tap resolution),
   *   gapEstimate(gapMs) -> { estimatedSpins, cycleUsed, assumedDefault }
   *   alert -> IntelFeed card or null.
   */
  function analyze({ sitting, nowLive } = {}) {
    const spins = Array.isArray(sitting) ? sitting.filter(s => s && typeof s.timestamp === 'number') : [];
    const intervals = cycleIntervals(spins);
    const count = intervals.length;
    const sorted = intervals.slice().sort((a, b) => a - b);
    const cycleMs = count ? median(sorted) : null;

    let cycleCV = null;
    if (count) {
      const mean = intervals.reduce((a, b) => a + b, 0) / count;
      const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / count);
      cycleCV = mean > 0 ? sd / mean : null;
    }

    const confidence = confidenceFor(count, cycleCV == null ? 1 : cycleCV);

    // Drift: median of the most recent DRIFT_WINDOW cycles vs the median
    // of the ones before them (both need enough samples to mean it).
    let drift = null;
    if (count >= DRIFT_WINDOW * 2) {
      const recent = intervals.slice(-DRIFT_WINDOW).slice().sort((a, b) => a - b);
      const prior = intervals.slice(0, -DRIFT_WINDOW).slice().sort((a, b) => a - b);
      const rMed = median(recent), pMed = median(prior);
      const rel = (rMed - pMed) / pMed;
      if (rel > 0.08) drift = 'lengthening';
      else if (rel < -0.08) drift = 'shortening';
      else drift = 'steady';
    }

    const lastSpinTs = spins.length ? spins[spins.length - 1].timestamp : null;
    const now = typeof nowLive === 'number' ? nowLive : lastSpinTs;
    const nextDropAt = (cycleMs != null && lastSpinTs != null) ? lastSpinTs + cycleMs : null;
    const msToNextDrop = (nextDropAt != null && now != null) ? nextDropAt - now : null;

    function gapEstimate(gapMs) {
      if (!(gapMs > 0)) return { estimatedSpins: 0, cycleUsed: cycleMs || DEFAULT_CYCLE_MS, assumedDefault: cycleMs == null };
      const use = (cycleMs != null && count >= MIN_INTERVALS) ? cycleMs : DEFAULT_CYCLE_MS;
      return {
        estimatedSpins: Math.round(gapMs / use),
        cycleUsed: use,
        assumedDefault: !(cycleMs != null && count >= MIN_INTERVALS),
      };
    }

    // Feed card: only once there is a real cadence to report.
    let alert = null;
    if (cycleMs != null && count >= MIN_INTERVALS) {
      const sec = (cycleMs / 1000).toFixed(1);
      const driftTxt = drift && drift !== 'steady'
        ? ` Cadence is ${drift} this session.`
        : '';
      alert = {
        kind: 'timing',
        samples: count,
        message: `This machine is cycling about every ${sec} seconds (${confidence.label}, n=${count}).${driftTxt}`,
      };
    }

    return {
      sampleCount: count,
      cycleMs,
      cycleSec: cycleMs != null ? cycleMs / 1000 : null,
      cycleCV,
      confidence,
      drift,
      lastSpinTs,
      nextDropAt,
      msToNextDrop,
      secToNextDrop: msToNextDrop != null ? msToNextDrop / 1000 : null,
      // Fingers cannot resolve rotor phase to a pocket; never claim so.
      sectorPredictable: false,
      gapEstimate,
      alert,
    };
  }

  BTHG.TimingEngine = {
    MAX_CYCLE_MS,
    MIN_CYCLE_MS,
    MIN_INTERVALS,
    DRIFT_WINDOW,
    DEFAULT_CYCLE_MS,
    median,
    cycleIntervals,
    confidenceFor,
    analyze,
  };

  return BTHG.TimingEngine;
});
