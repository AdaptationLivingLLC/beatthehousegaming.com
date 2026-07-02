// ============================================================
// series-engine.js — Series tracking, Final 8, aging, auto-fill
// BTHG Roulette Breaker Web App (Ported from SeriesTrackingEngine.swift)
// Last modified: 2026-03-07
// Contains: RouletteNumber, SeriesEngine (recordSpin, undoLastSpin,
//   Final 8 activation/aging/auto-fill, Trinity multiplier,
//   series completion/reset, side bet tracking, serialization)
// Verified: 298/298 tests passed (test-all.js)
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const C = BTHG.CONSTANTS;

  class RouletteNumber {
    constructor(value) {
      this.value = value;   // 0–37 (37 = 00)
      this.hits = 0;
      this.ago = 0;         // spins since last hit
    }
  }

  class SeriesEngine {
    constructor() {
      this.reset();
    }

    reset() {
      // Initialize 38 numbers
      this.numbers = [];
      for (let i = 0; i <= 37; i++) {
        this.numbers.push(new RouletteNumber(i));
      }
      this.history = [];           // ordered list of hit numbers
      this.totalSpins = 0;
      this.seriesCount = 0;
      this.lifetimeSpins = 0;
      this.seriesHistory = [];     // array of completed series spin counts
      this.seriesAverage = 0;      // running average cycle length for this table

      // Final 8 state
      this.finalEight = [];        // array of number values in Final 8
      this.finalEightAges = {};    // { numberValue: age }
      this.finalEightFirstHit = new Set();
      this.finalEightFirstHitSpins = {};  // { numberValue: totalSpins at first hit } — used to compute closerOffsets on archive
      this.finalEightJustHit = new Set();
      this.entrySpin = null;       // totalSpins count at the moment Final 8 activated (start of the closing phase)

      // Frozen: set true the instant a series completes. While frozen, new
      // spins are refused (see recordSpin) — the board stays exactly as it
      // was at completion so it can be reviewed. Only an explicit
      // resetSeries() call (wired to the "New Series" action) clears it.
      this.frozen = false;
      // Configurable coverage: how many unhit numbers to cover (+ 0/00 always).
      // Preserved across series/table resets so it stays a user setting, not
      // something that snaps back to the default every reset.
      this.finalTargetCount = this.finalTargetCount || C.FINAL_TARGET_COUNT;
      this.finalActivated = false;
      this.isAutoAddEnabled = true;

      // Trinity
      this.trinityMissStreak = 0;

      // Side bets
      this.sideBetAgo = {};
      this.sideBetHits = {};
      for (const label of Object.keys(BTHG.SIDE_BETS)) {
        this.sideBetAgo[label] = 0;
        this.sideBetHits[label] = 0;
      }

      // Callbacks
      this._listeners = [];
    }

    onChange(fn) { this._listeners.push(fn); }
    _emit(event, data) {
      this._listeners.forEach(fn => fn(event, data));
    }

    getNumber(val) {
      return this.numbers.find(n => n.value === val);
    }

    // Set how many unhit numbers to cover (e.g. 6, 7, 8). 0 and 00 are ALWAYS
    // covered on top of this — they're the mandatory security, not part of N.
    // Lower N = enter later / risk less per spin; higher N = enter earlier.
    setCoverageCount(n) {
      n = Math.floor(Number(n));
      if (!Number.isFinite(n)) return;
      this.finalTargetCount = Math.max(1, Math.min(20, n));
    }

    recordSpin(number) {
      // While frozen (series complete, awaiting New Series / Keep Reviewing)
      // spins do not register at all — this is the guard that replaces the
      // old "auto-reset immediately on completion" behavior.
      if (this.frozen) return;
      if (number < 0 || number > 37) return;

      this.totalSpins++;
      this.lifetimeSpins++;
      this.history.push(number);

      // Clear previous just-hit
      this.finalEightJustHit.clear();

      // Age all numbers
      for (const num of this.numbers) {
        if (num.value !== number) {
          num.ago++;
        }
      }

      // Update hit number
      const hitNum = this.getNumber(number);
      if (hitNum) {
        hitNum.ago = 0;
        hitNum.hits++;
      }

      // Update side bets
      this._updateSideBets(number);

      // Handle Final 8 progression
      this._handleFinalEight(number);

      // Evaluate state
      this._evaluateState();

      this._emit('spin', { number, totalSpins: this.totalSpins });
    }

    _updateSideBets(number) {
      for (const [label, predicate] of Object.entries(BTHG.SIDE_BETS)) {
        if (predicate(number)) {
          this.sideBetAgo[label] = 0;
          this.sideBetHits[label] = (this.sideBetHits[label] || 0) + 1;
        } else {
          this.sideBetAgo[label] = (this.sideBetAgo[label] || 0) + 1;
        }
      }
    }

    _handleFinalEight(number) {
      if (this.finalEight.length === 0) return;

      const inFinal = this.finalEight.includes(number);

      if (inFinal) {
        // HIT
        this.finalEightJustHit.add(number);
        this.trinityMissStreak = 0;

        if (!this.finalEightFirstHit.has(number)) {
          this.finalEightFirstHit.add(number);
          this.finalEightAges[number] = 0;
          this.finalEightFirstHitSpins[number] = this.totalSpins;
        }
      } else if (number !== 0 && number !== 37) {
        // MISS (non-zero)
        this.trinityMissStreak++;
      } else {
        // Zero/00 — reset miss streak
        this.trinityMissStreak = 0;
      }

      // Age all Final 8 numbers that have been hit
      for (const num of this.finalEight) {
        if (this.finalEightAges.hasOwnProperty(num)) {
          this.finalEightAges[num]++;
        }
      }

      // Remove aged-out numbers (> 2 spins since first hit)
      // Zeros (0 and 00/37) are NEVER removed — always covered
      const toRemove = [];
      for (const [numStr, age] of Object.entries(this.finalEightAges)) {
        const numVal = parseInt(numStr);
        if (age > C.FINAL_EIGHT_AGE_LIMIT && numVal !== 0 && numVal !== 37) {
          toRemove.push(numVal);
        }
      }
      for (const num of toRemove) {
        delete this.finalEightAges[num];
        this.finalEightFirstHit.delete(num);
        this.finalEight = this.finalEight.filter(n => n !== num);
        this._emit('finalEightRemoved', { number: num });
      }

      // Auto-fill if enabled
      if (this.isAutoAddEnabled && this.finalEight.length < this.finalTargetCount) {
        const candidate = this._pickAutoFillCandidate();
        if (candidate !== null && !this.finalEight.includes(candidate)) {
          this.finalEight.push(candidate);
          this._emit('finalEightAdded', { number: candidate });
        }
      }
    }

    _pickAutoFillCandidate() {
      // ONLY ever auto-fill with genuinely UNHIT numbers (longest since seen).
      // NEVER pad coverage with already-hit numbers — that was the bug that put
      // numbers the user should not bet back onto the board. If none remain
      // unhit, return null and coverage simply shrinks as the series completes.
      const unhit = this.numbers
        .filter(n => n.hits === 0 && !this.finalEight.includes(n.value))
        .sort((a, b) => b.ago - a.ago);
      return unhit.length > 0 ? unhit[0].value : null;
    }

    _evaluateState() {
      const unhit = this.numbers.filter(n => n.hits === 0);
      const target = this.finalTargetCount;

      if (unhit.length === target + 1 && !this.finalActivated) {
        this._emit('finalWarning', { count: unhit.length });
      }

      if (unhit.length <= target && !this.finalActivated) {
        // Activate Final 8
        this.finalActivated = true;
        this.finalEight = unhit.map(n => n.value);
        this.finalEightAges = {};
        this.finalEightFirstHit.clear();
        this.finalEightFirstHitSpins = {};
        this.entrySpin = this.totalSpins;
        this.trinityMissStreak = 0;
        this._emit('finalActivated', { numbers: [...this.finalEight] });
      }

      if (unhit.length === 0 && this.finalActivated) {
        // Series complete!
        this.seriesCount++;
        this.seriesHistory.push(this.totalSpins);
        this.seriesAverage = Math.round(
          this.seriesHistory.reduce((a, b) => a + b, 0) / this.seriesHistory.length
        );
        // Resync lifetimeSpins against the archived history at every series
        // boundary. lifetimeSpins is normally tracked incrementally, which
        // can silently drift out of sync (e.g. undoLastSpin edge cases) —
        // this makes the invariant self-healing instead of relying on every
        // mutation site remembering to keep it perfectly balanced. totalSpins
        // for the series that just closed is already inside seriesHistory
        // (pushed above), and — unlike before — totalSpins is NOT reset here,
        // so the sum alone (without adding totalSpins again) is correct.
        this.lifetimeSpins = this.seriesHistory.reduce((a, b) => a + b, 0);
        this._emit('seriesComplete', {
          seriesCount: this.seriesCount,
          totalSpins: this.totalSpins,
          lastNumber: this.history[this.history.length - 1],
          seriesAverage: this.seriesAverage
        });
        // FREEZE instead of resetting. The old behavior called
        // _resetForNewSeries() right here, synchronously, with no user
        // interaction — that silently wiped totalSpins/history the instant
        // the 38th number hit, while the live spin backlog for this machine
        // in SpinDB was untouched. On the next load, every one of those
        // spins (now belonging to nothing) got replayed on top of the next
        // series, which is exactly the "67 stale spins" field bug. Now the
        // engine just stops accepting new spins (see recordSpin) and holds
        // its final state until resetSeries() is explicitly called — which
        // only happens from RouletteTableUI.archiveAndReset(), itself only
        // reachable by pressing "New Series".
        this.frozen = true;
      }
    }

    _resetForNewSeries() {
      for (const num of this.numbers) {
        num.hits = 0;
        num.ago = 0;
      }
      this.totalSpins = 0;
      this.history = [];
      this.finalEight = [];
      this.finalEightAges = {};
      this.finalEightFirstHit.clear();
      this.finalEightFirstHitSpins = {};
      this.entrySpin = null;
      this.finalEightJustHit.clear();
      this.finalActivated = false;
      this.trinityMissStreak = 0;
      this.frozen = false;
      // Reset the outside-bet counters too, so they zero out with the board
      // instead of carrying over from the previous series.
      for (const label of Object.keys(BTHG.SIDE_BETS)) {
        this.sideBetAgo[label] = 0;
        this.sideBetHits[label] = 0;
      }
      // Keep: seriesCount, seriesHistory, seriesAverage, lifetimeSpins
    }

    /**
     * Explicitly start a new series after the previous one has been
     * archived (or discarded). This is now the ONLY path that wipes live
     * board state following an auto-completed series — completion itself
     * (_evaluateState) just freezes. Called from
     * RouletteTableUI.archiveAndReset() when "New Series" is pressed.
     */
    resetSeries() {
      this._resetForNewSeries();
    }

    // ---- Trinity Multiplier ------------------------------------
    getTrinityMultiplier() {
      const s = this.trinityMissStreak;
      if (s < 3) return 1;
      if (s < 5) return 2;
      if (s < 7) return 4;
      return 8;
    }

    getTrinityNumbers(baseBet) {
      const targets = [...this.finalEight];
      if (!targets.includes(0)) targets.push(0);
      if (!targets.includes(37)) targets.push(37);
      return targets.sort((a, b) => a - b);
    }

    getTrinityTotalBet(baseBet) {
      return this.getTrinityNumbers().length * baseBet * this.getTrinityMultiplier();
    }

    // ---- Undo ---------------------------------------------------
    undoLastSpin() {
      // Frozen means the series is complete and awaiting New Series —
      // nothing about the frozen board is mutable, undo included.
      if (this.frozen) return false;
      if (this.history.length === 0) return false;

      const last = this.history.pop();
      this.totalSpins--;
      // lifetimeSpins is incremented once per recordSpin() and must be
      // un-done in lockstep, or it silently drifts above the true total
      // (confirmed from a real casino export: lifetimeSpins no longer
      // matched the sum of seriesHistory + the live series count).
      this.lifetimeSpins--;

      const num = this.getNumber(last);
      if (num && num.hits > 0) num.hits--;

      // Recalculate ago from history
      this._recomputeAgo();
      this._recomputeSideBets();

      // Recalculate Final 8 state
      this.finalEight = [];
      this.finalEightAges = {};
      this.finalEightFirstHit.clear();
      this.finalEightFirstHitSpins = {};
      this.entrySpin = null;
      this.finalEightJustHit.clear();
      this.finalActivated = false;
      this.trinityMissStreak = 0;

      // Re-evaluate
      const unhit = this.numbers.filter(n => n.hits === 0);
      if (unhit.length <= this.finalTargetCount) {
        this.finalActivated = true;
        this.finalEight = unhit.map(n => n.value);
        this.entrySpin = this.totalSpins;
      }

      this._emit('undo', { removed: last });
      return true;
    }

    _recomputeAgo() {
      for (const num of this.numbers) { num.ago = this.totalSpins; }
      const seen = new Set();
      for (let i = this.history.length - 1; i >= 0; i--) {
        const val = this.history[i];
        if (!seen.has(val)) {
          const num = this.getNumber(val);
          if (num) num.ago = this.history.length - 1 - i;
          seen.add(val);
        }
      }
      for (const num of this.numbers) {
        if (!seen.has(num.value)) num.ago = this.totalSpins;
      }
    }

    _recomputeSideBets() {
      for (const label of Object.keys(BTHG.SIDE_BETS)) {
        this.sideBetAgo[label] = 0;
        this.sideBetHits[label] = 0;
      }
      for (const number of this.history) {
        for (const [label, predicate] of Object.entries(BTHG.SIDE_BETS)) {
          if (predicate(number)) {
            this.sideBetAgo[label] = 0;
            this.sideBetHits[label]++;
          } else {
            this.sideBetAgo[label]++;
          }
        }
      }
    }

    // ---- Series Progress ----------------------------------------
    getUniqueHitCount() {
      return this.numbers.filter(n => n.hits > 0).length;
    }

    getRemainingCount() {
      return this.numbers.filter(n => n.hits === 0).length;
    }

    getSeriesAverage() {
      return this.seriesAverage;
    }

    /**
     * Build a complete data snapshot of the current series for saving.
     * Includes full spin history order, calibration snapshot, and side bet state.
     * @param {string} endType — 'auto' | 'manual'
     * @param {Object} fusionSnapshot — CalibratorDataFusion.toJSON()
     * @param {string} machineId
     * @param {string} casino
     * @returns {Object} complete series record ready for SeriesDB.saveSeries()
     */
    getSeriesDataForSave(endType, fusionSnapshot, machineId, casino) {
      return {
        machineId: machineId || 'default',
        casino: casino || 'Unknown',
        seriesNumber: this.seriesCount,
        totalSpins: this.totalSpins,
        spinHistory: [...this.history],
        endType: endType,
        timestamp: Date.now(),
        calibration: fusionSnapshot || null,
        sideBetState: {
          ago: { ...this.sideBetAgo },
          hits: { ...this.sideBetHits },
        },
        seriesAverage: this.seriesAverage,
        uniqueHit: this.getUniqueHitCount(),
        remaining: this.getRemainingCount(),
        finalEight: [...this.finalEight],
        finalActivated: this.finalActivated,
        lifetimeSpins: this.lifetimeSpins,
        // Spin count at which Final 8 activated (start of the closing
        // phase), or null if the series never reached Final 8 before
        // ending. Combined with finalEightFirstHitSpins by the caller to
        // derive closerOffsets (how many spins into the close each of the
        // final numbers took to hit).
        entrySpin: this.entrySpin,
      };
    }

    /**
     * Manual-completion bookkeeping only: series length/average accounting
     * (seriesCount, seriesHistory, seriesAverage, lifetimeSpins resync).
     * Deliberately does NOT build the save record or reset board state.
     *
     * Split out of manualEndSeries() so RouletteTableUI's "Save & Start New
     * Series" handler can call this, THEN build the archive record via
     * _buildArchiveRecord (which reads finalEightFirstHitSpins/entrySpin
     * off this engine to compute closerOffsets — they still have to be
     * live, un-reset values), THEN call resetSeries(). That is the same
     * bookkeeping-before-record-before-reset ordering the auto-close path
     * in _evaluateState() already uses (seriesCount increments right at
     * completion; the record isn't built until "New Series" is pressed,
     * long after). Before this split, manualEndSeries() reset the board
     * (wiping finalEightFirstHitSpins/entrySpin) before the caller ever had
     * a chance to compute closerOffsets, so manual completions silently
     * saved without them.
     */
    _recordManualCompletion() {
      this.seriesCount++;
      this.seriesHistory.push(this.totalSpins);
      this.seriesAverage = Math.round(
        this.seriesHistory.reduce((a, b) => a + b, 0) / this.seriesHistory.length
      );
      // See the matching comment in _evaluateState()'s auto-close path —
      // resync lifetimeSpins here too so a manual end-series can't drift.
      this.lifetimeSpins = this.seriesHistory.reduce((a, b) => a + b, 0);
    }

    /**
     * Manually end the current series. Saves data and resets for next series,
     * but keeps tracking (history, side bets, lifetime spins) active.
     * Returns the series data snapshot.
     *
     * NOTE: this does not carry closerOffsets (see _buildArchiveRecord in
     * roulette-table.js) — RouletteTableUI's "Save & Start New Series"
     * handler does NOT call this anymore; it calls _recordManualCompletion()
     * + _buildArchiveRecord() + resetSeries() directly so the archived
     * record is shape-identical to an auto completion. This method is kept
     * as a standalone convenience/back-compat entry point.
     */
    manualEndSeries(fusionSnapshot, machineId, casino) {
      this._recordManualCompletion();
      const data = this.getSeriesDataForSave('manual', fusionSnapshot, machineId, casino);

      // Reset number tracking for next series, keep everything else
      this._resetForNewSeries();

      this._emit('manualSeriesEnd', data);
      return data;
    }

    /**
     * SAVE & KEEP COUNTING: snapshot the CURRENT (incomplete) series to history
     * WITHOUT resetting — the spin count keeps going exactly where it is. The
     * series isn't finished, so it does NOT count toward the completion average.
     */
    saveSnapshot(fusionSnapshot, machineId, casino) {
      const data = this.getSeriesDataForSave('snapshot', fusionSnapshot, machineId, casino);
      this._emit('snapshotSaved', data);
      return data;
    }

    /**
     * DISCARD: throw away the current in-progress series WITHOUT saving and
     * start fresh at spin 1. Keeps the table's learned average + the history of
     * already-completed series (you don't lose the rhythm you've learned).
     */
    discardSeries() {
      this._resetForNewSeries();
      this._emit('seriesDiscarded', {});
    }

    // ---- Last N spins -------------------------------------------
    getLastSpins(n) {
      return this.history.slice(-n);
    }

    // ---- Serialization ------------------------------------------
    toJSON() {
      return {
        numbers: this.numbers.map(n => ({ value: n.value, hits: n.hits, ago: n.ago })),
        history: this.history,
        totalSpins: this.totalSpins,
        seriesCount: this.seriesCount,
        lifetimeSpins: this.lifetimeSpins,
        seriesHistory: this.seriesHistory,
        seriesAverage: this.seriesAverage,
        finalEight: this.finalEight,
        finalEightAges: this.finalEightAges,
        finalEightFirstHit: [...this.finalEightFirstHit],
        finalEightFirstHitSpins: this.finalEightFirstHitSpins,
        entrySpin: this.entrySpin,
        finalActivated: this.finalActivated,
        trinityMissStreak: this.trinityMissStreak,
        sideBetAgo: this.sideBetAgo,
        sideBetHits: this.sideBetHits,
        finalTargetCount: this.finalTargetCount,
        isAutoAddEnabled: this.isAutoAddEnabled,
        frozen: this.frozen,
      };
    }

    fromJSON(data) {
      if (!data) return;
      this.numbers = data.numbers.map(n => {
        const rn = new RouletteNumber(n.value);
        rn.hits = n.hits; rn.ago = n.ago;
        return rn;
      });
      this.history = data.history || [];
      this.totalSpins = data.totalSpins || 0;
      this.seriesCount = data.seriesCount || 0;
      this.lifetimeSpins = data.lifetimeSpins || 0;
      this.seriesHistory = data.seriesHistory || [];
      this.seriesAverage = data.seriesAverage || 0;
      this.finalEight = data.finalEight || [];
      this.finalEightAges = data.finalEightAges || {};
      this.finalEightFirstHit = new Set(data.finalEightFirstHit || []);
      this.finalEightFirstHitSpins = data.finalEightFirstHitSpins || {};
      this.entrySpin = data.entrySpin != null ? data.entrySpin : null;
      this.finalActivated = data.finalActivated || false;
      this.trinityMissStreak = data.trinityMissStreak || 0;
      this.sideBetAgo = data.sideBetAgo || {};
      this.sideBetHits = data.sideBetHits || {};
      this.finalTargetCount = data.finalTargetCount || C.FINAL_TARGET_COUNT;
      this.isAutoAddEnabled = data.isAutoAddEnabled !== false;
      this.frozen = data.frozen || false;
    }
  }

  BTHG.SeriesEngine = SeriesEngine;
  window.BTHG = BTHG;
})();
