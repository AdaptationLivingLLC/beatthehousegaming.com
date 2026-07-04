(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  // Pattern engine: three independent detectors (followers, gaps, cycle
  // timing) plus an adaptive entry signal, all consuming archived series
  // records and the live spin stream. Each detector is exported as its own
  // function (not a closure buried inside analyze()) so a later task
  // (tailStats/rankFinal) can reuse the internals directly.

  const CHANCE3 = 1 - Math.pow(37 / 38, 3); // ~0.0766 — chance a specific number lands within 3 spins

  function disp(n) { return n === 37 ? '00' : String(n); }

  // Archive spin entries may be plain numbers or {n} objects depending on
  // how old the record is. Normalize to a plain number either way.
  function toNum(s) { return typeof s === 'number' ? s : (s ? s.n : s); }

  function wheelDistance(layout, a, b) {
    if (!layout) return null;
    const ia = layout.indexOf(a), ib = layout.indexOf(b);
    if (ia < 0 || ib < 0) return null;
    const d = Math.abs(ia - ib);
    return Math.min(d, layout.length - d);
  }

  // ---- Follower detector ----------------------------------------
  // For each occurrence of a, record which numbers land in the next 1..3
  // spins. Alert when pair (a,b) shows up meaningfully more than chance:
  // occurrences of a >= 5 AND rate(b within 3 after a) >= 2.5 * CHANCE3
  // AND count >= half of a's occurrences (guards against one lucky spin
  // dominating a small sample).
  function followerAlerts(allSpins /* array of number arrays */, layout) {
    const occ = new Map(), pair = new Map();
    for (const spins of allSpins) {
      for (let i = 0; i < spins.length; i++) {
        const a = spins[i];
        occ.set(a, (occ.get(a) || 0) + 1);
        const seen = new Set();
        for (let j = i + 1; j <= Math.min(i + 3, spins.length - 1); j++) {
          const b = spins[j];
          if (seen.has(b)) continue;
          seen.add(b);
          const k = a + ':' + b;
          pair.set(k, (pair.get(k) || 0) + 1);
        }
      }
    }
    const alerts = [];
    for (const [k, count] of pair) {
      const [a, b] = k.split(':').map(Number);
      const n = occ.get(a);
      if (n >= 5 && count / n >= 2.5 * CHANCE3 && count >= Math.ceil(n * 0.5)) {
        let message = `${disp(b)} followed ${disp(a)} within 3 spins in ${count} of ${n} times.`;
        const dist = wheelDistance(layout, a, b);
        if (dist !== null) message += ` (${dist} pockets apart on this wheel)`;
        alerts.push({ kind: 'follower', samples: n, strength: count / n, message });
      }
    }
    return alerts.sort((x, y) => y.strength - x.strength).slice(0, 5);
  }

  // ---- Gap (drought) detector -------------------------------------
  // Splits a single series' spin sequence into runs where number x is
  // absent. A run that ends because x hits is "resolved"; a run still open
  // at the end of the sequence is not. Used both to measure the live
  // series' current drought depth and to mine the archive for how those
  // droughts have historically resolved.
  function droughtsFor(x, spins) {
    const runs = [];
    let cur = 0;
    for (const v of spins) {
      if (v === x) {
        runs.push({ length: cur, resolved: true });
        cur = 0;
      } else {
        cur++;
      }
    }
    if (cur > 0) runs.push({ length: cur, resolved: false });
    return runs;
  }

  // Current drought depth for number x in a live spin sequence: 0 if x just
  // hit (or the sequence is empty), otherwise spins since its last hit (or
  // the full sequence length if x never appeared at all).
  function currentGap(x, spins) {
    const runs = droughtsFor(x, spins);
    if (runs.length === 0) return spins.length;
    const last = runs[runs.length - 1];
    return last.resolved ? 0 : last.length;
  }

  // Historical droughts of x, across archived series, that reached at least
  // depth g and then resolved. Returns null when there is no such history.
  function gapAlertFor(x, g, archiveSeries) {
    const extras = [];
    for (const spins of archiveSeries) {
      for (const run of droughtsFor(x, spins)) {
        if (run.resolved && run.length >= g) extras.push(run.length - g + 1);
      }
    }
    if (extras.length === 0) return null;
    const avg = extras.reduce((a, b) => a + b, 0) / extras.length;
    return {
      kind: 'gap',
      samples: extras.length,
      strength: extras.length / (avg + 1),
      message: `${disp(x)} has been out ${g} spins with no hit. In ${extras.length} historical droughts of ${g} or more spins, it resolved within an average of ${avg.toFixed(1)} more spins after matching this depth.`,
    };
  }

  // Runs the drought check for every pocket (0..37, 37 == 00) whose live
  // gap is at least `threshold` spins deep, using only archived series as
  // the historical source (the live series has no resolution to report on
  // for its own open drought).
  function gapAlerts(archiveSeries, liveSpins, threshold) {
    threshold = threshold == null ? 30 : threshold;
    const alerts = [];
    for (let x = 0; x <= 37; x++) {
      const g = currentGap(x, liveSpins);
      if (g < threshold) continue;
      const a = gapAlertFor(x, g, archiveSeries);
      if (a) alerts.push(a);
    }
    return alerts.sort((x, y) => y.strength - x.strength).slice(0, 5);
  }

  // ---- Cycle (closing timing) detector -----------------------------
  // Compares live position in the closing phase to the quartile spread of
  // archived closerOffsets (how many spins into the close each historical
  // closer took to land).
  function quartile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function cycleAlerts(archive, liveSpins, finalActivated) {
    const offsets = [];
    for (const rec of archive || []) {
      if (Array.isArray(rec.closerOffsets)) offsets.push(...rec.closerOffsets);
    }
    if (offsets.length < 4) return [];
    offsets.sort((a, b) => a - b);
    const q1 = quartile(offsets, 0.25);
    const q2 = quartile(offsets, 0.5);
    const q3 = quartile(offsets, 0.75);
    const alerts = [{
      kind: 'cycle',
      samples: offsets.length,
      strength: offsets.length,
      message: `Across ${offsets.length} historical closer timings, the middle half land between spin ${Math.round(q1)} and spin ${Math.round(q3)} into the close, with a median around spin ${Math.round(q2)}.`,
    }];
    if (finalActivated && Array.isArray(liveSpins) && liveSpins.length > 0) {
      // liveSpins.length is a POSITION PROXY, not a true "spins into the
      // close" count — it's the whole live series' spin count, not spins
      // since Final 8/closing activated. Good enough for Task 8's alert
      // wiring; Task 15 (timing engine) replaces this with the real
      // entrySpin-relative offset (see entrySpin/closerOffsets elsewhere
      // in this file and in js/series-engine.js).
      const pos = liveSpins.length;
      if (pos > q3) {
        alerts.push({
          kind: 'cycle',
          samples: offsets.length,
          strength: offsets.length * 0.9,
          message: `The close is ${pos} spins in, past the typical spin ${Math.round(q3)} mark seen in ${offsets.length} historical closer timings. Closers are running later than usual.`,
        });
      } else if (pos >= q1) {
        alerts.push({
          kind: 'cycle',
          samples: offsets.length,
          strength: offsets.length * 0.8,
          message: `The close is ${pos} spins in, inside the typical spin ${Math.round(q1)} to spin ${Math.round(q3)} window seen in ${offsets.length} historical closer timings.`,
        });
      }
    }
    return alerts;
  }

  // ---- Adaptive entry signal ---------------------------------------
  // closersToBank: largest k (1..4) such that in at least 75% of archived
  // series that reached k closers, the k-th closer (in arrival order)
  // landed by offset 20. Falls back to 3 when the archive is thin (< 3
  // series) or when no k clears the 75% bar.
  function closersToBank(archive) {
    if (!archive || archive.length < 3) return 3;
    let best = null;
    for (let k = 1; k <= 4; k++) {
      const withK = archive.filter(r => Array.isArray(r.closerOffsets) && r.closerOffsets.length >= k);
      if (withK.length === 0) continue;
      const hits = withK.filter(r => {
        const sorted = [...r.closerOffsets].sort((a, b) => a - b);
        return sorted[k - 1] <= 20;
      }).length;
      if (hits / withK.length >= 0.75) best = k;
    }
    return best || 3;
  }

  function entrySignal(archive, finalActivated, closersHit) {
    const k = closersToBank(archive);
    const n = (archive || []).length;
    if (!finalActivated) {
      return { state: 'HOLD', reason: 'Final 8 has not activated yet, so there is no closing phase to time entries against.' };
    }
    if (closersHit >= k) {
      return {
        state: 'STOP',
        reason: `${closersHit} closers already hit, at or beyond the adaptive threshold of ${k} historically banked closers based on ${n} archived series. The closing window is likely spent.`,
      };
    }
    return {
      state: 'BET',
      reason: `${closersHit} of an adaptive threshold of ${k} closers hit so far, based on ${n} archived series. Still inside the historical entry window.`,
    };
  }

  // ---- Assembly ------------------------------------------------------
  function analyze({ archive = [], liveSpins = [], layout = null, finalActivated = false, closersHit = 0 } = {}) {
    archive = archive || [];
    liveSpins = (liveSpins || []).map(toNum);
    // Real archived SeriesDB records carry their spin order as
    // `spinHistory` (see js/storage.js SeriesDB.saveSeries doc + the
    // record built by SeriesEngine.getSeriesDataForSave) — `spins` only
    // ever appears in synthetic/test fixtures. Fall back through both so
    // this reads real archive data, not just test shapes.
    const archiveSeries = archive.map(r => (r.spins || r.spinHistory || []).map(toNum));
    const allSeries = archiveSeries.concat([liveSpins]);

    const alerts = []
      .concat(followerAlerts(allSeries, layout))
      .concat(gapAlerts(archiveSeries, liveSpins, 30))
      .concat(cycleAlerts(archive, liveSpins, finalActivated));

    return { alerts, entry: entrySignal(archive, finalActivated, closersHit) };
  }

  const PatternEngine = {
    CHANCE3,
    disp,
    analyze,
    followerAlerts,
    gapAlerts,
    gapAlertFor,
    droughtsFor,
    currentGap,
    cycleAlerts,
    quartile,
    closersToBank,
    entrySignal,
  };

  BTHG.PatternEngine = PatternEngine;
  return { PatternEngine };
});
