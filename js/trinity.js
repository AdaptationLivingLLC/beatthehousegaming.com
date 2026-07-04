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
  }
  BTHG.TrinityEngine = TrinityEngine;
  return { TrinityEngine };
});
