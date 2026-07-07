// ============================================================
// cycle-lock.js — BTHG.CycleLock (consecutive-winner jump agreement)
// BTHG Roulette Breaker Web App
//
// Brandon's Del Sol airball machine is fully deterministic except for the
// wait between the wheel's reload-freeze and the ball launch. His own
// history-board observation (2026-07-06): the wait is STICKY — it holds
// nearly constant for stretches, so consecutive winners are related by one
// near-constant wheel-order jump K during a stretch (back-to-back repeats
// are K≈0; the 00-then-0 pair is K≈19). This module watches the live
// tracked winners (numbers the user already enters — zero extra input),
// computes the jump between consecutive spins, and calls a LOCK when the
// most recent jumps agree. While locked, the next winner is expected at
// (last winner + K) ± bounce.
//
// Pure analyze(); no storage, no DOM. Same UMD wrapper as other engines.
// 37 encodes 00 everywhere; display via disp().
// ============================================================

(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {

  const DEFAULT_ORDER = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2];

  // Two consecutive jumps agreeing within this many pockets = the bounce
  // envelope on this machine (launch cluster spread was ±1-2).
  const AGREE_POCKETS = 2;
  // How many trailing jumps to report/scan for the streak length.
  const SCAN_JUMPS = 6;

  const disp = n => n === 37 ? '00' : String(n);

  // Signed-free wheel-order jump from a to b (0..N-1).
  function jumpOf(a, b, order) {
    const o = order || DEFAULT_ORDER;
    const ai = o.indexOf(a), bi = o.indexOf(b);
    if (ai < 0 || bi < 0) return null;
    return ((bi - ai) % o.length + o.length) % o.length;
  }

  // Circular distance between two jumps on an N-wheel.
  function circDist(a, b, N) {
    const d = Math.abs(((a - b) % N + N) % N);
    return Math.min(d, N - d);
  }

  /**
   * analyze(history, order) -> {
   *   jumps,            // trailing wheel-order jumps, oldest..newest (≤ SCAN_JUMPS)
   *   locked,           // true when the two most recent jumps agree ±AGREE_POCKETS
   *   streak,           // how many trailing jumps agree with the newest one
   *   K,                // rounded consensus jump while locked (else null)
   *   center, arc, halfWidth, lo, hi,   // next-spin arc while locked
   *   message           // feed-ready one-liner while locked (else null)
   * }
   * history: live tracked winners in spin order (plain numbers, 37 = 00).
   * Unknown numbers break the chain at that point rather than throwing.
   */
  function analyze(history, order) {
    const o = order || DEFAULT_ORDER;
    const N = o.length;
    const h = history || [];

    const jumps = [];
    for (let i = Math.max(1, h.length - SCAN_JUMPS); i < h.length; i++) {
      const j = jumpOf(h[i - 1], h[i], o);
      jumps.push(j); // null marks an unreadable link; breaks streaks below
    }

    const none = { jumps, locked: false, streak: 0, K: null, center: null,
      arc: [], halfWidth: 0, lo: null, hi: null, message: null };

    if (jumps.length < 2) return none;
    const newest = jumps[jumps.length - 1];
    const prev = jumps[jumps.length - 2];
    if (newest == null || prev == null) return none;
    if (circDist(newest, prev, N) > AGREE_POCKETS) return none;

    // Streak: walk backwards while jumps keep agreeing with the newest.
    let streak = 1;
    for (let i = jumps.length - 2; i >= 0; i--) {
      if (jumps[i] == null || circDist(jumps[i], newest, N) > AGREE_POCKETS) break;
      streak++;
    }

    // Consensus K: circular mean of the agreeing trailing jumps.
    const agreeing = jumps.slice(jumps.length - streak);
    let sx = 0, sy = 0;
    for (const j of agreeing) {
      const a = (j / N) * 2 * Math.PI;
      sx += Math.cos(a); sy += Math.sin(a);
    }
    let ang = Math.atan2(sy, sx);
    if (ang < 0) ang += 2 * Math.PI;
    const K = Math.round((ang / (2 * Math.PI)) * N) % N;

    // Arc: tight when the pair agrees exactly, one wider otherwise.
    const spreadMax = Math.max(...agreeing.map(j => circDist(j, K, N)));
    const half = spreadMax <= 1 ? 2 : 3;

    const last = h[h.length - 1];
    const li = o.indexOf(last);
    if (li < 0) return none;
    const centerIndex = (li + K) % N;
    const arc = [];
    for (let d = -half; d <= half; d++) arc.push(o[((centerIndex + d) % N + N) % N]);
    const lo = o[((centerIndex - half) % N + N) % N];
    const hi = o[((centerIndex + half) % N + N) % N];
    const center = o[centerIndex];

    const message = `CYCLE LOCK +${K} (x${streak}): next arc ${arc.map(disp).join(' ')}`;

    return { jumps, locked: true, streak, K, center, arc, halfWidth: half, lo, hi, message };
  }

  BTHG.CycleLock = {
    DEFAULT_ORDER,
    AGREE_POCKETS,
    disp,
    jumpOf,
    analyze,
  };

  return BTHG.CycleLock;
});
