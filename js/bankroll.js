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
      // Task 23 (rule 3): the wins bucket. Every covered hit's full payout
      // lands here first; only the amount needed to top totalBankroll back
      // up to sessionStartBankroll ever transfers out of it (see
      // BTHG.Bankroll.applyWinsBucketPayout below). Whatever is left stays
      // here permanently — it never funds a bet and is never folded back
      // into totalBankroll beyond the top-up.
      this.winsBucket = 0;
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
        // Task 23 — additive field, no schema/version change (localStorage
        // session blob, not IndexedDB).
        winsBucket: this.winsBucket,
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
      // Additive — legacy sessions saved before Task 23 have no winsBucket
      // field at all; default to 0 rather than crashing/going undefined.
      this.winsBucket = data.winsBucket || 0;
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
  //
  // Review round 2: replaySeriesCycle now bounds each real Trinity cycle by
  // the record's own closerOffsets (js/roulette-table.js _buildArchiveRecord)
  // instead of testing every spin against a single end-of-series finalEight
  // snapshot. Final 8 membership is rolling (a closer ages out
  // FINAL_EIGHT_AGE_LIMIT spins after its first hit and gets auto-replaced,
  // js/utils.js + js/series-engine.js#_handleFinalEight), so the old
  // single-snapshot approach replayed earlier real closer hits — whose
  // numbers had since aged out of the snapshot — as misses, merging several
  // bounded cycles into one inflated streak. See replayBoundedCycles below.

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
   * entrySpin/closerOffsets all present on the record) and the live,
   * still-in-progress SeriesEngine (same field names on the engine
   * instance itself, closerOffsets derived by the caller from
   * finalEightFirstHitSpins), which is why this takes plain
   * { spinHistory, entrySpin, finalEight, closerOffsets, minUnit } rather
   * than a class instance.
   *
   * `closerOffsets`, when present (even an empty array), is the
   * AUTHORITATIVE source of real cycle-reset points: each entry is a
   * spin-offset (from entrySpin) at which a genuine Final 8 closer was hit
   * for the first time (js/roulette-table.js _buildArchiveRecord). Final 8
   * membership is rolling — a closer ages out FINAL_EIGHT_AGE_LIMIT spins
   * after its first hit and is auto-replaced (js/utils.js,
   * js/series-engine.js#_handleFinalEight) — so `finalEight` alone (an
   * end-of-series snapshot) cannot be used as a single coverage set across
   * the whole closing phase without replaying earlier real closer hits,
   * whose numbers have since aged out of the snapshot, as misses. Bounding
   * on closerOffsets instead (see replayBoundedCycles) fixes that: every
   * spin strictly between two resets is a real miss by construction, no
   * stale membership test needed. Every literal 0/00 spin in the window is
   * folded in as an extra reset point too — 0 and 00 are ALWAYS covered
   * regardless of Final 8 membership (SeriesEngine#getTrinityNumbers()), so
   * a 0/00 hit resets the live cycle even on a record where 0/00 was
   * already hit before Final 8 activated (and so never appears in
   * closerOffsets, which only tracks first hits while a number sits inside
   * finalEight). Known residual gap: a REPEAT hit on a Final 8 number that
   * is still within its aging grace window (not yet evicted) also resets
   * the live cycle but is not recorded anywhere the archive keeps (only
   * first hits are tracked) — out of scope here since fixing it needs
   * roulette-table.js/series-engine.js to record every hit offset, not just
   * the first, and this task's files don't include those.
   *
   * If `closerOffsets` is `undefined` (the field genuinely does not exist
   * on the record — an archived series saved before Task 5 added it), there
   * is no authoritative reset data at all, so this falls back to the old
   * single end-of-series coverage-set replay across the whole closing
   * phase. That fallback can still merge real cycles into one inflated
   * streak; the result is flagged `estimated: true` so callers can say so.
   *
   * Coverage always includes 0 and 37 ("00") on top of finalEight,
   * matching SeriesEngine#getTrinityNumbers() — 0/00 are always covered,
   * whether or not they happen to already be inside finalEight.
   *
   * Returns worstDepth/worstSpend (the peak reached across the whole
   * replay) AND currentLevel/currentSpent (the state after the LAST spin
   * replayed — i.e. "where the live cycle stands right now" when called
   * on an in-progress series). Returns null if there is nothing usable to
   * replay (series never reached Final 8, or no spins after activation).
   *
   * Important 3 (review round 3) — the escalation/reset semantics here now
   * match js/roulette-table.js's real live-betting path exactly, instead of
   * an older, simpler approximation that could disagree with it:
   *   - 0/00 stakes are real cash (counted in worstSpend/currentSpent, the
   *     cash a bankroll must actually cover) but are EXCLUDED from the
   *     escalation deficit that sizes the next bet (rule 6) — a separate
   *     `escalationCoverage` (Final-N members only) drives the engine,
   *     while `fullCoverage` (+0/00) prices every spin's real stake/payout.
   *   - A covered hit resets the cycle only if the real cash net is back to
   *     zero or positive (rule 7); 0/00 hits reset UNCONDITIONALLY (rule 6)
   *     regardless of the cash net; a non-recovering hit escalates exactly
   *     like a miss instead of resetting.
   *   - Priced at the denomination actually being bet (`denomination`,
   *     i.e. bankroll.baseBet) when one is known, falling back to the
   *     table minimum (`minUnit`) only when it is not (e.g.
   *     worstFromArchive's $1-unit scaling pass, which never passes one on
   *     purpose). `pricedAt`/`pricedWithDenomination` on the result say
   *     which was actually used, for callers that want to state it.
   */
  function replaySeriesCycle({ spinHistory, entrySpin, finalEight, closerOffsets, minUnit = 1, denomination } = {}) {
    if (entrySpin == null) return null;
    const spins = (spinHistory || []).slice(entrySpin);
    if (spins.length === 0) return null;

    const usedDenomination = denomination != null && denomination > 0;
    const unit = usedDenomination ? denomination : minUnit;

    // Full coverage (real cash staked/paid every spin) always includes
    // 0/00 on top of finalEight. Escalation coverage (rule 6) excludes
    // 0/00 — only real Final-N members count toward the deficit driving
    // the next bet's size.
    const fullCoverage = new Set([...(finalEight || []), 0, 37]).size;
    const escalationCoverage = new Set(finalEight || []).size;

    let result;
    if (closerOffsets !== undefined) {
      const closerSet = new Set(closerOffsets);
      const isHitAt = (n, i) => (n === 0 || n === 37) || closerSet.has(i + 1);
      result = replayContinuous(spins, isHitAt, unit, escalationCoverage, fullCoverage);
    } else {
      // Fallback (no closerOffsets field at all — a record saved before
      // Task 5): the only hit signal available is the static end-of-series
      // finalEight snapshot, so an earlier real closer hit whose number has
      // since aged out of it replays as a miss (the same known, flagged
      // limitation as before — see the doc comment above this function).
      const coverageSet = new Set([...(finalEight || []), 0, 37]);
      const isHitAt = (n) => coverageSet.has(n);
      result = replayContinuous(spins, isHitAt, unit, escalationCoverage, fullCoverage);
      result.estimated = true;
    }
    result.pricedAt = unit;
    result.pricedWithDenomination = usedDenomination;
    return result;
  }

  /**
   * Single continuous replay of `spins` through one running TrinityEngine
   * plus a real cash ledger (`cashNet`), matching
   * js/roulette-table.js#_applyLiveBetting spin for spin:
   *
   *   - Every spin, the current bet (`trinity.nextBet().perNumber`) is
   *     staked on ALL covered numbers (`fullCoverage`, including 0/00) and
   *     deducted from the ledger BEFORE the outcome is known — this is the
   *     real trough a live bankroll would hit that spin, tracked into
   *     `worstSpend`.
   *   - `isHitAt(spinValue, index)` says whether this spin is a covered
   *     hit. A hit pays 36x the per-number bet into the ledger. A 0/00 hit
   *     resets the cycle (engine + ledger) UNCONDITIONALLY (rule 6). A
   *     Final-N hit resets ONLY if the ledger is back to zero or positive
   *     (rule 7); otherwise the deficit carries forward exactly like a
   *     miss (`trinity.recordMiss()`, escalating on `escalationCoverage`
   *     only — 0/00 stakes never count toward that deficit, though they
   *     are real cash in the ledger). A miss is `trinity.recordMiss()`,
   *     same treatment as a non-recovering hit.
   *
   * worstDepth/worstSpend are the running peaks across the WHOLE replay
   * (never reset when the cycle itself resets, so the worst of several
   * real cycles across a closing phase is still captured, exactly like the
   * old bounded-cycles approach did); currentLevel/currentSpent are the
   * state after the last spin replayed.
   */
  function replayContinuous(spins, isHitAt, unit, escalationCoverage, fullCoverage) {
    const trinity = new BTHG.TrinityEngine({ minUnit: unit, maxUnit: Infinity, coverage: escalationCoverage });
    let cashNet = 0;
    let worstDepth = 0, worstSpend = 0;

    for (let i = 0; i < spins.length; i++) {
      const n = spins[i];
      const bet = trinity.nextBet();
      const stake = bet.perNumber * fullCoverage;
      cashNet -= stake;
      if (-cashNet > worstSpend) worstSpend = -cashNet;

      if (isHitAt(n, i)) {
        const isZeroHit = n === 0 || n === 37;
        cashNet += 36 * bet.perNumber;
        if (isZeroHit || cashNet >= 0) {
          trinity.reset();
          cashNet = 0;
        } else {
          trinity.recordMiss();
        }
      } else {
        trinity.recordMiss();
      }
      if (trinity.level > worstDepth) worstDepth = trinity.level;
    }

    return { worstDepth, worstSpend, currentLevel: trinity.level, currentSpent: Math.max(0, -cashNet) };
  }

  /**
   * Worst tracked cycle across a player's own archived series, replayed at
   * a $1 unit (so the result can be scaled to any table's real minUnit —
   * see recommendStart). Only real completions count ('auto' or 'manual'
   * endType) — "Save & Keep Counting" snapshot records are not finished
   * series and would skew this (see js/storage.js SeriesDB doc comment).
   * Returns null if the archive has nothing usable yet, otherwise
   * { worstDepth, worstSpend, estimated }. `estimated` is true only when
   * the specific record that produced the returned worstDepth or
   * worstSpend had no closerOffsets field at all (saved before Task 5) and
   * so was replayed via replaySeriesCycle's single-snapshot fallback —
   * recommendStart surfaces this as a caveat instead of silently trusting a
   * possibly-inflated number.
   */
  function worstFromArchive(archive) {
    const completed = (archive || []).filter(r => r && (r.endType === 'auto' || r.endType === 'manual'));
    let worstDepth = 0, worstSpend = 0, found = false;
    let depthEstimated = false, spendEstimated = false;
    for (const record of completed) {
      const spinHistory = record.spins || record.spinHistory || [];
      const result = replaySeriesCycle({
        spinHistory, entrySpin: record.entrySpin, finalEight: record.finalEight,
        closerOffsets: record.closerOffsets, minUnit: 1,
      });
      if (!result) continue;
      found = true;
      if (result.worstDepth > worstDepth) { worstDepth = result.worstDepth; depthEstimated = !!result.estimated; }
      if (result.worstSpend > worstSpend) { worstSpend = result.worstSpend; spendEstimated = !!result.estimated; }
    }
    return found ? { worstDepth, worstSpend, estimated: depthEstimated || spendEstimated } : null;
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
    // A record saved before Task 5 added closerOffsets has no authoritative
    // reset data to bound cycles by, so its contribution here came from
    // replaySeriesCycle's single-snapshot fallback, which can still merge
    // real cycles into one inflated streak. Say so rather than silently
    // presenting a number that may be padded.
    const caveat = worst.estimated
      ? ' Part of this comes from an older series recorded before per-closer tracking existed, so this estimate may be high.'
      : '';
    return {
      amount, worstDepth: worst.worstDepth, worstSpend,
      explanation: `Recommended start covers your worst tracked cycle. ${money(worst.worstSpend)} was spent at a $1 unit across ${worst.worstDepth} misses; scaled to your $${minUnit} unit that is ${money(worstSpend)}, plus a 25 percent safety margin, rounded up to the nearest $50.${caveat}`,
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
        // Important 3: say which unit price this live line actually used —
        // it can legitimately differ from the table minimum shown
        // elsewhere on the panel once a denomination is set, and the two
        // disagreeing with no explanation was the bug being fixed.
        const pricedPart = live.pricedAt != null
          ? (live.pricedWithDenomination
              ? ` Priced at your ${money(live.pricedAt)} denomination.`
              : ` Priced at your ${money(live.pricedAt)} table minimum, since no denomination is set yet.`)
          : '';
        liveText = `Right now this cycle is ${live.currentLevel} misses deep, ${money(live.currentSpent)} spent.${worstPart}${pricedPart}`;
      }
    }
    return { guaranteedMinimum, path, live: liveText };
  }

  /**
   * Task 23 (rule 3) — the wins-bucket money model for LIVE betting. Every
   * covered hit's full payout lands in the wins bucket FIRST. From the
   * bucket, transfer back into the bankroll ONLY the amount needed to top
   * it back up to startingBankroll — never more, so the bankroll never
   * shows above its starting amount. Whatever remains in the bucket stays
   * there permanently: the wins bucket never funds a bet and profit is
   * never folded back into the bankroll beyond the top-up.
   *
   * Pure — no class, no side effects — so it can be driven directly by
   * tests and reused identically from the live tap handler. `bankroll` here
   * is the CURRENT bankroll amount (already net of this spin's stake
   * deduction, which happens before the payout in the caller), not
   * sessionStartBankroll.
   */
  function applyWinsBucketPayout({ bankroll, winsBucket, startingBankroll, payout }) {
    let newBucket = (winsBucket || 0) + (payout || 0);
    let newBankroll = bankroll;
    const need = startingBankroll - newBankroll;
    if (need > 0) {
      const transfer = Math.min(need, newBucket);
      newBankroll += transfer;
      newBucket -= transfer;
    }
    return { bankroll: newBankroll, winsBucket: newBucket };
  }

  BTHG.Bankroll = {
    recommendStart,
    projectionLines,
    replaySeriesCycle,
    worstFromArchive,
    resolveProfileForLimits,
    applyWinsBucketPayout,
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
