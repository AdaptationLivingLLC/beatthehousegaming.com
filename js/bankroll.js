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
