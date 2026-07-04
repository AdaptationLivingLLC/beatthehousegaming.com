// ============================================================
// cycle-watch.js — BTHG.CycleWatch (Task 22)
// BTHG Roulette Breaker Web App
//
// Field observation driving this: on a real wheel, a vast majority of
// numbers re-hit 60 to 70 spins after their last hit. Brandon plays
// series CONSECUTIVELY on one wheel, so re-hit gaps have to be measured
// on the continuous spin tape across series boundaries (series are just
// bookkeeping; the wheel does not care), not reset to zero every time a
// series is archived — which is what js/pattern-engine.js's per-series
// cycle logic (cycleAlerts) does today. That module is left untouched;
// this is a separate, wheel-continuous view, wired in alongside it.
//
// Binding data rules (Brandon's spec):
//   1. The gap clock runs on the machine's continuous spin tape from the
//      start of counting, crossing series boundaries.
//   2. Live "watch/due" insights come ONLY from the current sitting
//      (this visit to the wheel). A different day/sitting on the same
//      wheel must never drive live watch alerts.
//   3. Historical raw data (older sittings) IS combined into the
//      background statistics (the re-hit gap distribution).
//
// analyze() is pure — it takes the tape as data and never touches
// SpinDB/Date.now() itself, so it stays fully unit-testable without a
// browser or a fake IndexedDB. The read from SpinDB and the Date.now()
// for "now" both happen at the one call site, js/roulette-table.js
// _updateIntelFeed().
//
// Internal helpers (splitSittings/pooledGaps/liveAgo/computeBand) are
// exposed on the public object, not just used internally — same choice
// js/pattern-engine.js makes for its detectors (followerAlerts,
// gapAlertFor, droughtsFor, ...), so each stage can be unit tested in
// isolation instead of only indirectly through analyze()'s narrower
// returned shape.
//
// Loading note: same UMD wrapper as js/wheel-verifier.js, and for the
// exact same reason its test loads it via tests/_load.mjs's vm-sandbox
// loader rather than require() — see the header comment in
// js/wheel-verifier.js for the full Node ESM/CJS explanation. This
// module's test (tests/test-cycle-watch.mjs) follows that same pattern.
// ============================================================

(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {

  // Two hours. Covers meal/bathroom breaks without splitting a real
  // sitting in two; a "few days later" return to the same wheel is
  // unambiguously a new sitting. Named constant per the brief.
  const SITTING_GAP_MS = 2 * 60 * 60 * 1000;

  // Below this many pooled (closed) re-hit gaps, the histogram is too
  // thin to trust for a live watch/overdue call — surface one
  // informational card instead of guessing.
  const MIN_GAPS_FOR_SIGNAL = 30;

  // Histogram bucket width for band estimation (50-59, 60-69, ...).
  const BUCKET_SIZE = 10;

  function disp(n) { return n === 37 ? '00' : String(n); }

  // Only real pockets (integers 0 through 36, plus 37 encoding 00) are
  // ever tracked for re-hit gaps or live watch. Real SpinDB spins are
  // always pockets, so this changes nothing live — it guards against a
  // malformed record's garbage `number` ever reaching a watch list, an
  // alert message, or the pooled histogram. A non-pocket record still
  // occupies its slot on the tape (it counts toward spin distances and
  // sitting timing); it just cannot itself be a tracked number.
  function isPocket(n) { return Number.isInteger(n) && n >= 0 && n <= 37; }

  // Trims a nice whole number's ".0" (median lands on a whole spin count
  // whenever the pool size is odd) but keeps one decimal for a true
  // between-two-values average (even pool size).
  function fmtNum(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

  // Drops anything that isn't a well-formed {number, timestamp} record
  // (defensive — a malformed entry would otherwise corrupt the sitting
  // split or gap math) while preserving tape order.
  function sanitizeTape(tape) {
    if (!Array.isArray(tape)) return [];
    return tape.filter(s => s && typeof s.number === 'number' && Number.isFinite(s.number) &&
      typeof s.timestamp === 'number' && Number.isFinite(s.timestamp));
  }

  /**
   * Splits a machine's full spin tape (insertion order) into "sittings":
   * runs of spins with no gap larger than SITTING_GAP_MS between
   * consecutive timestamps. Series boundaries (seriesMarker) are
   * deliberately ignored here — per rule 1, only real elapsed wall-clock
   * time between physical spins ends a sitting, never a bookkeeping
   * series archive. Returns an array of spin-record arrays, oldest
   * sitting first; the final entry is the current sitting.
   */
  function splitSittings(tape) {
    const list = sanitizeTape(tape);
    if (list.length === 0) return [];
    const sittings = [[list[0]]];
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].timestamp - list[i - 1].timestamp;
      if (gap > SITTING_GAP_MS) {
        sittings.push([list[i]]);
      } else {
        sittings[sittings.length - 1].push(list[i]);
      }
    }
    return sittings;
  }

  /**
   * Pooled re-hit gaps (background statistics, rule 3): for each
   * sitting independently, for each number, the spin-index distance
   * between every pair of consecutive occurrences of that number within
   * THAT sitting (never across a sitting boundary — a fresh lastSeen
   * map is used per sitting so a number's last occurrence in an older
   * sitting can never pair with its first occurrence in a newer one).
   * Series boundaries inside a sitting are not a break point (rule 1) —
   * occurrences are indexed purely by position in the sitting's spin
   * list, regardless of any seriesMarker on the record.
   * Returns a flat array of gap lengths (spins between occurrences).
   * Only pocket numbers (isPocket) are tracked; any other record still
   * advances the spin index but never pairs into a gap.
   */
  function pooledGaps(sittings) {
    const gaps = [];
    for (const sitting of sittings) {
      const lastIdx = new Map();
      for (let i = 0; i < sitting.length; i++) {
        const n = sitting[i].number;
        if (!isPocket(n)) continue;
        if (lastIdx.has(n)) gaps.push(i - lastIdx.get(n));
        lastIdx.set(n, i);
      }
    }
    return gaps;
  }

  /**
   * Live "ago" per number (rule 2) for a single sitting: spins since
   * each number's last occurrence within that sitting, measured from
   * the sitting's own final spin (ago 0 = hit on the very last spin).
   * Numbers that never hit during this sitting are simply absent from
   * the returned map — there is no "last hit" to measure from yet.
   * Same isPocket restriction as pooledGaps: non-pocket records occupy
   * their slot (they count toward everyone else's "ago") but are never
   * themselves watched.
   */
  function liveAgo(sitting) {
    const ago = new Map();
    if (!sitting || sitting.length === 0) return ago;
    const lastIdx = new Map();
    for (let i = 0; i < sitting.length; i++) {
      if (isPocket(sitting[i].number)) lastIdx.set(sitting[i].number, i);
    }
    const lastPos = sitting.length - 1;
    for (const [n, idx] of lastIdx) ago.set(n, lastPos - idx);
    return ago;
  }

  /**
   * Descriptive band estimate over a pooled gap array: a simple
   * histogram in BUCKET_SIZE-spin buckets, the densest bucket expanded
   * to include adjacent buckets whose count is within 80% of the peak
   * bucket's density (contiguous — expansion stops the first time a
   * neighboring bucket falls short). Returns null for an empty pool.
   * `lo`/`hi` are the brief's bandLo/bandHi — hi is the peak bucket's
   * (or expanded band's) inclusive upper spin count.
   */
  function computeBand(gaps) {
    if (!gaps || gaps.length === 0) return null;
    const counts = new Map();
    for (const g of gaps) {
      const b = Math.floor(g / BUCKET_SIZE) * BUCKET_SIZE;
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    const buckets = [...counts.keys()].sort((a, b) => a - b);
    let peakBucket = buckets[0], peakCount = counts.get(buckets[0]);
    for (const b of buckets) {
      const c = counts.get(b);
      if (c > peakCount) { peakCount = c; peakBucket = b; }
    }
    const threshold = peakCount * 0.8;
    let lo = peakBucket, hi = peakBucket + BUCKET_SIZE - 1;
    for (let b = peakBucket - BUCKET_SIZE; (counts.get(b) || 0) >= threshold; b -= BUCKET_SIZE) lo = b;
    for (let b = peakBucket + BUCKET_SIZE; (counts.get(b) || 0) >= threshold; b += BUCKET_SIZE) hi = b + BUCKET_SIZE - 1;

    const sorted = gaps.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    return { lo, hi, median, count: gaps.length };
  }

  /**
   * BTHG.CycleWatch.analyze({tape, nowLive})
   *
   * tape: a machine's full spin list from SpinDB (BTHG.Storage.SpinDB.
   *   getSpinsByMachine), insertion order, each entry at minimum
   *   {number, timestamp}.
   * nowLive: the caller's current wall-clock time (Date.now() in the
   *   browser; a fixed value in tests, keeping analyze() itself pure —
   *   it never reads the clock). Optional; defaults to the tape's last
   *   timestamp, which trivially always treats the final segment as
   *   live. Passing a real "now" that is itself more than
   *   SITTING_GAP_MS past the last recorded spin means the player's
   *   last visit has already timed out with nothing new logged yet —
   *   there is no sitting actually in progress right now, so live
   *   watch/overdue are suppressed (rule 2: no current sitting, nothing
   *   to watch) even though the background band still reflects all the
   *   history recorded so far (rule 3).
   *
   * Returns {sittings, band, watch, overdue, alerts}.
   */
  function analyze({ tape, nowLive } = {}) {
    const sittings = splitSittings(tape);
    const sittingSummaries = sittings.map(s => ({
      startTs: s[0].timestamp,
      endTs: s[s.length - 1].timestamp,
      spinCount: s.length,
    }));

    const gaps = pooledGaps(sittings);
    const count = gaps.length;

    if (count < MIN_GAPS_FOR_SIGNAL) {
      return {
        sittings: sittingSummaries,
        band: null,
        watch: [],
        overdue: [],
        alerts: [{
          kind: 'cycle',
          samples: count,
          message: `Not enough re-hit history on this wheel yet to spot its cycle (${count} re-hit gaps recorded, ${MIN_GAPS_FOR_SIGNAL} needed).`,
        }],
      };
    }

    const band = computeBand(gaps);

    // Is the last sitting actually still open right now, or did it end
    // (by elapsed time) with nothing new logged since? See nowLive doc
    // above.
    const last = sittings[sittings.length - 1];
    const lastTs = last[last.length - 1].timestamp;
    const effectiveNow = typeof nowLive === 'number' ? nowLive : lastTs;
    const currentSitting = (effectiveNow - lastTs) <= SITTING_GAP_MS ? last : [];

    const agoMap = liveAgo(currentSitting);
    const watchLo = band.lo - 5;
    const watchHi = band.hi;
    const overdueThreshold = band.hi + 10;

    const watch = [];
    const overdue = [];
    for (const [n, ago] of agoMap) {
      if (ago > overdueThreshold) overdue.push({ number: n, ago });
      else if (ago >= watchLo && ago <= watchHi) watch.push({ number: n, ago });
    }
    watch.sort((a, b) => a.number - b.number);
    overdue.sort((a, b) => a.number - b.number);

    const alerts = [];
    alerts.push({
      kind: 'cycle',
      samples: count,
      message: `This wheel's numbers mostly re-hit ${band.lo} to ${band.hi + 1} spins after their last hit (median ${fmtNum(band.median)}, n=${count}).`,
    });

    if (watch.length) {
      const minAgo = Math.min(...watch.map(w => w.ago));
      alerts.push({
        kind: 'cycle',
        samples: count,
        message: `Watch ${watch.map(w => disp(w.number)).join(', ')}: entering this wheel's re-hit window (${band.lo} to ${band.hi + 1} spins), each unhit ${minAgo}+ spins.`,
      });
    }

    if (overdue.length) {
      const minAgo = Math.min(...overdue.map(w => w.ago));
      alerts.push({
        kind: 'cycle',
        samples: count,
        message: `${overdue.map(w => disp(w.number)).join(', ')} overdue for a re-hit, each unhit ${minAgo}+ spins past this wheel's usual ${band.lo} to ${band.hi + 1} spin window.`,
      });
    }

    return {
      sittings: sittingSummaries,
      band,
      watch,
      overdue,
      alerts: alerts.slice(0, 3),
    };
  }

  BTHG.CycleWatch = {
    SITTING_GAP_MS,
    MIN_GAPS_FOR_SIGNAL,
    BUCKET_SIZE,
    disp,
    splitSittings,
    pooledGaps,
    liveAgo,
    computeBand,
    analyze,
  };

  return BTHG.CycleWatch;
});
