// ============================================================
// bankroll.js — BankrollTrinityManager, chip rendering
// BTHG Roulette Breaker Web App (Ported from BankrollTrinityManager.swift)
// Last modified: 2026-03-07
// Contains: BankrollManager (recordSpin, session P/L, win rate),
//   TrinityCycle (1x→2x→4x→8x doubling on 3/5/7 misses),
//   renderChips (visual chip stack)
// Supports sub-dollar bets ($0.50+) via parseFloat
// Verified: 298/298 tests passed (test-all.js)
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const C = BTHG.CONSTANTS;

  class BankrollManager {
    constructor(bankroll, baseBet, payoutRatio) {
      this.totalBankroll = bankroll || C.DEFAULT_BANKROLL;
      this.baseBet = baseBet || C.DEFAULT_BASE_BET;
      this.payoutRatio = payoutRatio || C.DEFAULT_PAYOUT_RATIO;
      this.sessionStartBankroll = this.totalBankroll;
      this.winCount = 0;
      this.lossCount = 0;
      this.totalWagered = 0;
      this.peakBankroll = this.totalBankroll;
      this.trinity = new TrinityCycle();
      this._listeners = [];
    }

    onChange(fn) { this._listeners.push(fn); }
    _emit(event, data) { this._listeners.forEach(fn => fn(event, data)); }

    recordSpin(isWin, numbersPlayed, multiplier) {
      const betPerNumber = this.baseBet * multiplier;
      const totalBet = betPerNumber * numbersPlayed;
      this.totalWagered += totalBet;

      if (isWin) {
        // Win pays (payoutRatio * betPerNumber) but we bet on multiple numbers
        const winnings = this.payoutRatio * betPerNumber;
        const netGain = winnings - totalBet + betPerNumber; // winning number bet returned
        this.totalBankroll += netGain;
        this.winCount++;
        this.trinity.record(true);
      } else {
        this.totalBankroll -= totalBet;
        this.lossCount++;
        this.trinity.record(false);
      }

      if (this.totalBankroll > this.peakBankroll) {
        this.peakBankroll = this.totalBankroll;
      }

      this._emit('bankrollUpdate', this.getState());
    }

    getMultiplier() {
      return this.trinity.multiplier();
    }

    getCurrentBetPerNumber() {
      return this.baseBet * this.getMultiplier();
    }

    getTotalBetForNumbers(count) {
      return this.getCurrentBetPerNumber() * count;
    }

    getSessionPnL() {
      return this.totalBankroll - this.sessionStartBankroll;
    }

    // Re-baseline the whole session to a fresh bankroll amount (used by the
    // Bankroll panel's Apply button). Resets sessionStartBankroll AND
    // peakBankroll to the new amount alongside totalBankroll itself, so
    // getSessionPnL() reads 0 immediately after — changing your bankroll
    // number must never show a "loss" against the old number it replaced.
    setBankroll(amount) {
      if (!(amount >= 0)) return false;
      this.totalBankroll = amount;
      this.sessionStartBankroll = amount;
      this.peakBankroll = amount;
      this._emit('bankrollUpdate', this.getState());
      return true;
    }

    getWinRate() {
      const total = this.winCount + this.lossCount;
      return total > 0 ? (this.winCount / total * 100).toFixed(1) : '0.0';
    }

    getState() {
      return {
        bankroll: this.totalBankroll,
        baseBet: this.baseBet,
        multiplier: this.getMultiplier(),
        betPerNumber: this.getCurrentBetPerNumber(),
        sessionPnL: this.getSessionPnL(),
        winCount: this.winCount,
        lossCount: this.lossCount,
        winRate: this.getWinRate(),
        peakBankroll: this.peakBankroll,
        totalWagered: this.totalWagered,
        missStreak: this.trinity.consecutiveLosses,
      };
    }

    // ---- Serialization ------------------------------------------
    toJSON() {
      return {
        totalBankroll: this.totalBankroll,
        baseBet: this.baseBet,
        payoutRatio: this.payoutRatio,
        sessionStartBankroll: this.sessionStartBankroll,
        winCount: this.winCount,
        lossCount: this.lossCount,
        totalWagered: this.totalWagered,
        peakBankroll: this.peakBankroll,
        trinity: this.trinity.toJSON(),
      };
    }

    fromJSON(data) {
      if (!data) return;
      this.totalBankroll = data.totalBankroll;
      this.baseBet = data.baseBet;
      this.payoutRatio = data.payoutRatio;
      this.sessionStartBankroll = data.sessionStartBankroll;
      this.winCount = data.winCount || 0;
      this.lossCount = data.lossCount || 0;
      this.totalWagered = data.totalWagered || 0;
      this.peakBankroll = data.peakBankroll || data.totalBankroll;
      if (data.trinity) this.trinity.fromJSON(data.trinity);
    }
  }

  class TrinityCycle {
    constructor() {
      this.consecutiveLosses = 0;
      this.doublingLevel = 0;
    }

    record(win) {
      if (win) {
        this.consecutiveLosses = 0;
        this.doublingLevel = 0;
      } else {
        this.consecutiveLosses++;
        // Escalate every 3 consecutive misses: 0-2 → 1x, 3-4 → 2x, 5-6 → 4x, 7+ → 8x
        if (this.consecutiveLosses < 3) this.doublingLevel = 0;
        else if (this.consecutiveLosses < 5) this.doublingLevel = 1;
        else if (this.consecutiveLosses < 7) this.doublingLevel = 2;
        else this.doublingLevel = 3;
      }
    }

    multiplier() {
      return Math.pow(2, this.doublingLevel);
    }

    toJSON() {
      return { consecutiveLosses: this.consecutiveLosses, doublingLevel: this.doublingLevel };
    }

    fromJSON(data) {
      this.consecutiveLosses = data.consecutiveLosses || 0;
      this.doublingLevel = data.doublingLevel || 0;
    }
  }

  // ---- Bankroll Manager: recommended start + betting-path projection ----
  // Task 9. Reads a table's actual limits and this player's own archived
  // series (never the Task 3 stochastic simulation gate — see below) to
  // recommend a starting bankroll and show what a banked closer guarantees.

  function money(n) {
    if (BTHG.formatMoney) return BTHG.formatMoney(n);
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }

  /**
   * Replay one series' spin history through the Trinity engine, at the
   * given minUnit, covering only the CLOSING PHASE (from the spin that
   * activated Final 8 onward — before that, finalEight is empty/still
   * filling and nothing is actually being bet the way Trinity bets it).
   * Works for both an archived SeriesDB record (spinHistory/finalEight/
   * entrySpin all present on the record) and the live, still-in-progress
   * SeriesEngine (same field names on the engine instance itself), which
   * is why this takes plain { spinHistory, entrySpin, finalEight, minUnit }
   * rather than a class instance.
   *
   * Coverage always includes 0 and 37 ("00") on top of finalEight,
   * matching SeriesEngine#getTrinityNumbers() — 0/00 are always covered,
   * whether or not they happen to already be inside finalEight.
   *
   * Returns worstDepth/worstSpend (the peak reached anywhere in the
   * replay) AND currentLevel/currentSpent (the state after the LAST spin
   * replayed — i.e. "where the live cycle stands right now" when called
   * on an in-progress series). Returns null if there is nothing usable to
   * replay (series never reached Final 8, or no spins after activation).
   */
  function replaySeriesCycle({ spinHistory, entrySpin, finalEight, minUnit = 1 } = {}) {
    if (entrySpin == null) return null;
    const spins = (spinHistory || []).slice(entrySpin);
    if (spins.length === 0) return null;
    const coverageSet = new Set([...(finalEight || []), 0, 37]);
    const engine = new BTHG.TrinityEngine({ minUnit, maxUnit: Infinity, coverage: coverageSet.size });
    let worstDepth = 0, worstSpend = 0;
    for (const n of spins) {
      if (coverageSet.has(n)) {
        engine.recordHit();
      } else {
        engine.recordMiss();
        if (engine.level > worstDepth) worstDepth = engine.level;
        if (engine.spent > worstSpend) worstSpend = engine.spent;
      }
    }
    return { worstDepth, worstSpend, currentLevel: engine.level, currentSpent: engine.spent };
  }

  /**
   * Worst tracked cycle across a player's own archived series, replayed at
   * a $1 unit (so the result can be scaled to any table's real minUnit —
   * see recommendStart). Only real completions count ('auto' or 'manual'
   * endType) — "Save & Keep Counting" snapshot records are not finished
   * series and would skew this (see js/storage.js SeriesDB doc comment).
   * Returns null if the archive has nothing usable yet.
   */
  function worstFromArchive(archive) {
    const completed = (archive || []).filter(r => r && (r.endType === 'auto' || r.endType === 'manual'));
    let worstDepth = 0, worstSpend = 0, found = false;
    for (const record of completed) {
      const spinHistory = record.spins || record.spinHistory || [];
      const result = replaySeriesCycle({
        spinHistory, entrySpin: record.entrySpin, finalEight: record.finalEight, minUnit: 1,
      });
      if (!result) continue;
      found = true;
      if (result.worstDepth > worstDepth) worstDepth = result.worstDepth;
      if (result.worstSpend > worstSpend) worstSpend = result.worstSpend;
    }
    return found ? { worstDepth, worstSpend } : null;
  }

  /**
   * Recommended starting bankroll = worst cycle spend at this table's
   * unit, times a 1.25 safety margin, rounded up to the nearest $50.
   *
   * worstCycleSpendAt1, if given, is used directly — this is the shape the
   * unit test drives and is also how documentation/stealth-screen content
   * (Task 11) can feed in a fixed number. NEVER wire the Task 3 Monte
   * Carlo sim gate's stochastic worst (10,000-series run: depth 44,
   * $26.16M at a $1 unit) into this path — that is a heavy-tail artifact
   * of a pure random walk, not a real recommendation input, and there is
   * deliberately no BTHG.CONSTANTS.TRINITY_WORST_SPEND_AT_1 in this file.
   *
   * Without an override, the worst cycle is computed from the player's own
   * `archive` (their real completed series at this table) via
   * worstFromArchive(). If the archive has nothing usable yet, there is no
   * sound basis for a number, so amount comes back null with an
   * explanation instead — the panel renders that message, not a number.
   */
  function recommendStart({ minUnit, archive, worstCycleSpendAt1 } = {}) {
    if (!(minUnit > 0)) {
      return {
        amount: null, worstDepth: null, worstSpend: null,
        explanation: 'Set your table minimum betting unit above to see a recommended start.',
      };
    }
    if (typeof worstCycleSpendAt1 === 'number') {
      const worstSpend = worstCycleSpendAt1 * minUnit;
      const amount = Math.ceil(worstSpend * 1.25 / 50) * 50;
      return {
        amount, worstDepth: null, worstSpend,
        explanation: `Recommended start covers the worst tracked cycle. $${worstCycleSpendAt1} was spent at a $1 unit; scaled to your $${minUnit} unit that is ${money(worstSpend)}, plus a 25 percent safety margin, rounded up to the nearest $50.`,
      };
    }

    const worst = worstFromArchive(archive);
    if (!worst) {
      return {
        amount: null, worstDepth: null, worstSpend: null,
        explanation: 'A recommended start needs at least one completed tracked series. Play a series through to completion (New Series or End Series) at this table and the recommendation will appear here.',
      };
    }
    const worstSpend = worst.worstSpend * minUnit;
    const amount = Math.ceil(worstSpend * 1.25 / 50) * 50;
    return {
      amount, worstDepth: worst.worstDepth, worstSpend,
      explanation: `Recommended start covers your worst tracked cycle. ${money(worst.worstSpend)} was spent at a $1 unit across ${worst.worstDepth} misses; scaled to your $${minUnit} unit that is ${money(worstSpend)}, plus a 25 percent safety margin, rounded up to the nearest $50.`,
    };
  }

  /**
   * Given the active machine profile (or null) and the two limit fields
   * off the panel, returns the profile object ready for
   * MachineProfiles.save() — preserving id/name/casino/wheelLayout/etc. on
   * an existing profile (so save() updates it in place instead of minting
   * a new id), or building a fresh minimal profile when none exists yet.
   * Pure — does not call MachineProfiles itself, so it is testable
   * without localStorage.
   */
  function resolveProfileForLimits(activeProfile, { minUnit, maxUnit, name, casino } = {}) {
    if (activeProfile) {
      return { ...activeProfile, minUnit, maxUnit };
    }
    return { name: name || 'Table 1', casino: casino || 'Unknown Casino', minUnit, maxUnit };
  }

  /**
   * Plain-word projection lines for the panel: the guaranteed minimum per
   * banked closer (the Trinity floor), the per-series betting path, and
   * (once Trinity betting is actually underway this series) a live
   * projected-vs-actual line. `live` is optional; pass
   * { active, currentLevel, currentSpent, worstDepth, worstSpend } once
   * Final 8 has activated (see replaySeriesCycle for computing those from
   * the live SeriesEngine).
   */
  function projectionLines({ minUnit, floorUnits = 1, seriesAverage, live } = {}) {
    if (!minUnit) {
      return {
        guaranteedMinimum: 'Set your table minimum and maximum betting unit above to see the guaranteed minimum per banked closer.',
        path: 'Set your table limits above to see your betting path.',
        live: null,
      };
    }
    const floorDollars = floorUnits * minUnit;
    const guaranteedMinimum = `Every banked closer, meaning one completed Trinity cycle, is guaranteed to net at least ${money(floorDollars)} at your $${minUnit} unit. That floor holds no matter how deep the miss streak runs first.`;
    const avgLabel = (seriesAverage && seriesAverage > 0) ? `${seriesAverage} spins` : 'not enough completed series yet to average';
    const path = `3 closers banked equals at least ${money(floorDollars * 3)} minimum. Your archived series average is ${avgLabel}.`;

    let liveText = null;
    if (live) {
      if (!live.active) {
        liveText = 'Live projection appears once Final 8 activates and Trinity betting begins this series.';
      } else {
        const worstPart = (live.worstSpend != null && live.worstDepth != null)
          ? ` Your worst tracked cycle at this unit is ${money(live.worstSpend)} across ${live.worstDepth} misses.`
          : '';
        liveText = `Right now this cycle is ${live.currentLevel} misses deep, ${money(live.currentSpent)} spent.${worstPart}`;
      }
    }
    return { guaranteedMinimum, path, live: liveText };
  }

  BTHG.Bankroll = {
    recommendStart,
    projectionLines,
    replaySeriesCycle,
    worstFromArchive,
    resolveProfileForLimits,
  };

  // ---- Chip Rendering Helper ----------------------------------
  BTHG.renderChips = function(amount) {
    // Returns array of chip objects for visual display
    const chips = [];
    const denominations = [
      { value: 100, color: '#000000', label: '100' },
      { value: 25, color: '#00aa00', label: '25' },
      { value: 5, color: '#cc0000', label: '5' },
      { value: 1, color: '#ffffff', label: '1' },
    ];
    let remaining = Math.floor(amount);
    for (const denom of denominations) {
      while (remaining >= denom.value) {
        chips.push({ ...denom });
        remaining -= denom.value;
      }
    }
    return chips;
  };

  BTHG.BankrollManager = BankrollManager;
  BTHG.TrinityCycle = TrinityCycle;
  window.BTHG = BTHG;
})();
