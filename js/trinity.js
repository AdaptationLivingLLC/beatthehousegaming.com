(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  function roundUpTo(value, inc) { return Math.ceil((value - 1e-9) / inc) * inc; }

  class TrinityEngine {
    constructor({ minUnit, maxUnit, coverage = 10, payout = 35, floorUnits = 1 }) {
      this.minUnit = minUnit; this.maxUnit = maxUnit;
      this.coverage = coverage; this.payout = payout;
      this.floor = floorUnits * minUnit;
      this.spent = 0; this.level = 0;
      // net-per-unit on a hit: payout+1 returned minus the covered stakes
      this.netPerUnit = (payout + 1) - coverage;   // 26 for 10-number coverage
    }
    nextBet() {
      let perNumber = roundUpTo((this.spent + this.floor) / this.netPerUnit, this.minUnit);
      if (perNumber < this.minUnit) perNumber = this.minUnit;
      const screens = Math.max(1, Math.ceil(perNumber / this.maxUnit));
      const perScreen = roundUpTo(perNumber / screens, 0.25);
      return { perNumber, total: perNumber * this.coverage, screens, perScreen,
               cycleSpend: this.spent, level: this.level };
    }
    recordMiss() { this.spent += this.nextBet().total; this.level++; }
    recordHit() {
      const bet = this.nextBet();
      const spentTotal = this.spent + bet.total;
      const net = (this.payout + 1) * bet.perNumber - spentTotal;
      this.reset();
      return { net, spent: spentTotal };
    }
    reset() { this.spent = 0; this.level = 0; }

    // Task 23: the live betting path's escalation coverage (Final-N members
    // only — 0/00 are excluded from the deficit that drives escalation per
    // the brief's rule 6) can change spin to spin as Final-N membership
    // ages out / auto-refills. Re-point coverage/netPerUnit at the new
    // count WITHOUT touching the accumulated cycle deficit (spent/level) —
    // those are real dollars already committed and must survive a coverage
    // change untouched.
    setCoverage(coverage) {
      this.coverage = coverage;
      this.netPerUnit = (this.payout + 1) - coverage;
    }

    // Task 23: serialize/restore the MUTABLE cycle state only (spent, level,
    // coverage). minUnit/maxUnit/payout/floor are fixed at construction and
    // are not part of this round trip — callers restore into an engine
    // already constructed with the same config. This is what per-spin undo
    // snapshots (rule 10) rely on to put Trinity back exactly as it was
    // pre-spin, instead of recomputing and hoping.
    toJSON() {
      return { spent: this.spent, level: this.level, coverage: this.coverage };
    }
    fromJSON(data) {
      if (!data) return;
      this.spent = data.spent || 0;
      this.level = data.level || 0;
      if (data.coverage != null) this.setCoverage(data.coverage);
    }
  }
  BTHG.TrinityEngine = TrinityEngine;
  return { TrinityEngine };
});
