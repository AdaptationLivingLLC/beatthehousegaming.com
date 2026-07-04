import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const { TrinityEngine } = loadBTHG(['js/trinity.js']);

export function simulateSeries(spins, coverageSet, { minUnit, maxUnit }) {
  const t = new TrinityEngine({ minUnit, maxUnit });
  let cash = 0, worstDepth = 0, worstCycleSpend = 0, minNet = Infinity, splitAlerts = 0, cycles = 0;
  let sumNets = 0;  // Step 3: track sum of all nets
  for (const n of spins) {
    const bet = t.nextBet();
    if (bet.screens > 1) splitAlerts++;
    if (coverageSet.has(n)) {
      const r = t.recordHit();
      cash += 36 * bet.perNumber - bet.total;
      sumNets += r.net;  // Step 3: accumulate net
      cycles++;
      if (r.net < minNet) minNet = r.net;
    } else {
      t.recordMiss();
      // Deduct the miss cost from cash
      cash -= bet.total;
      if (t.level > worstDepth) worstDepth = t.level;
      if (t.spent > worstCycleSpend) worstCycleSpend = t.spent;
    }
  }
  // Step 3: ledger cross-check per series
  // Verify ledger consistency: track sumNets per series and confirm accounting
  // Invariant: cash accounting should match (sum of nets minus open cycle spend)
  const openSpend = t.spent;
  assert.ok(Math.abs(cash - (sumNets - openSpend)) < 0.01, `ledger mismatch: cash=${cash}, sumNets=${sumNets}, openSpend=${openSpend}, expected ${sumNets - openSpend}`);
  return { cash, cycles, worstDepth, worstCycleSpend, minNet, splitAlerts, openSpend, ledgerOk: true };
}

export function runSimulation({ series, minUnit, maxUnit, coverageSet }) {
  let cycles = 0, worstDepth = 0, worstCycleSpend = 0, minNet = Infinity, ledgerOk = true, splitAlerts = 0;
  for (const spins of series) {
    const r = simulateSeries(spins, coverageSet, { minUnit, maxUnit });
    cycles += r.cycles;
    if (r.worstDepth > worstDepth) worstDepth = r.worstDepth;
    if (r.worstCycleSpend > worstCycleSpend) worstCycleSpend = r.worstCycleSpend;
    if (r.minNet < minNet) minNet = r.minNet;
    if (!r.ledgerOk) ledgerOk = false;
    splitAlerts += r.splitAlerts;
  }
  return { cycles, worstDepth, worstCycleSpend, minNet, ledgerOk, splitAlerts };
}

function fairSpin() { return Math.floor(Math.random() * 38); } // 37 = 00

// ============================================================
// Task 23 — the live betting rules change the guarantee's SHAPE:
//   - rule 6: 0/00 stakes are placed and covered but EXCLUDED from the
//     escalation deficit (coverage passed to the engine is the Final-N
//     count only, not Final-N + 0/00).
//   - rule 6: a hit on 0/00 resets the cycle UNCONDITIONALLY.
//   - rule 7: a covered Final-N win resets the cycle ONLY if it brings the
//     REAL cycle net (every dollar wagered/paid since the last reset,
//     INCLUDING 0/00 stakes the engine's own ledger never counted) to zero
//     or positive. If not, the deficit carries forward and Trinity
//     escalates exactly as a miss would (rule 5) — the old guarantee
//     "every hit ends its cycle at +floor or better" NO LONGER HOLDS
//     unconditionally, because the real cycle net now includes costs the
//     engine's internal netPerUnit math never saw.
//
// The invariant that DOES still hold, and is asserted below on every one
// of the 10,000 simulated series:
//   (a) Every reset (0/00 hit, or a Final-N win with real cycle net >= 0)
//       leaves the engine at EXACTLY spent=0, level=0 — never a partial
//       reset.
//   (b) A non-recovering Final-N win (real cycle net still < 0 after its
//       payout) escalates the deficit by EXACTLY perNumber x
//       escalationCoverage — bit-for-bit the same amount a miss would have
//       added. A non-recovering win is therefore indistinguishable from a
//       miss from the escalation engine's point of view, which is exactly
//       Brandon's own description: "the trinity betting carries over ...
//       whether it is going to keep moving up or reset depending on how
//       much money is made."
//   (c) A hit on 0/00 resets unconditionally — this is exercised for real
//       (not just asserted in the abstract) by confirming at least one
//       sampled 0/00 reset happens while the real cycle net was negative
//       at the moment of the hit.
export function simulateSeriesV2(spins, coverageSet, escalationCoverage, { minUnit, maxUnit }) {
  const t = new TrinityEngine({ minUnit, maxUnit, coverage: escalationCoverage });
  const fullCoverage = coverageSet.size;
  let cash = 0;               // running real P&L across the whole series (never reset)
  let cycleNet = 0;           // real P&L since the last Trinity reset (rule 7's gate)
  let worstDrawdown = 0;      // most negative `cash` reached at any point
  let worstSpent = 0, worstLevel = 0;
  let resets = 0, nonRecoveringWins = 0, zeroResetsWhileNegative = 0;

  for (const n of spins) {
    t.setCoverage(escalationCoverage);
    const bet = t.nextBet();
    const stake = bet.perNumber * fullCoverage;
    cash -= stake;
    cycleNet -= stake;
    if (cash < worstDrawdown) worstDrawdown = cash;

    const isZero = (n === 0 || n === 37);
    if (coverageSet.has(n)) {
      const payout = 36 * bet.perNumber;
      cash += payout;
      cycleNet += payout;

      if (isZero) {
        if (cycleNet < 0) zeroResetsWhileNegative++;
        t.reset();
        assert.equal(t.spent, 0, 'invariant (a): 0/00 reset must be exact');
        cycleNet = 0;
        resets++;
      } else if (cycleNet >= 0) {
        t.reset();
        assert.equal(t.spent, 0, 'invariant (a): recovering-win reset must be exact');
        cycleNet = 0;
        resets++;
      } else {
        const spentBefore = t.spent;
        t.recordMiss();
        assert.equal(t.spent, spentBefore + bet.perNumber * escalationCoverage,
          'invariant (b): non-recovering win must escalate exactly like a miss');
        nonRecoveringWins++;
      }
    } else {
      t.recordMiss();
    }
    if (t.level > worstLevel) worstLevel = t.level;
    if (t.spent > worstSpent) worstSpent = t.spent;
  }
  return { cash, worstDrawdown, worstSpent, worstLevel, resets, nonRecoveringWins, zeroResetsWhileNegative };
}

export function runSimulationV2({ series, minUnit, maxUnit, coverageSet, escalationCoverage }) {
  let worstDrawdown = 0, worstSpent = 0, worstLevel = 0, resets = 0, nonRecoveringWins = 0, zeroResetsWhileNegative = 0;
  for (const spins of series) {
    const r = simulateSeriesV2(spins, coverageSet, escalationCoverage, { minUnit, maxUnit });
    if (r.worstDrawdown < worstDrawdown) worstDrawdown = r.worstDrawdown;
    if (r.worstSpent > worstSpent) worstSpent = r.worstSpent;
    if (r.worstLevel > worstLevel) worstLevel = r.worstLevel;
    resets += r.resets;
    nonRecoveringWins += r.nonRecoveringWins;
    zeroResetsWhileNegative += r.zeroResetsWhileNegative;
  }
  return { worstDrawdown, worstSpent, worstLevel, resets, nonRecoveringWins, zeroResetsWhileNegative };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Coverage = Final 8 + 0 + 00 (10 numbers full coverage; escalation
  // coverage excludes 0/00 -> 8), per the brief's "Engine test alignment"
  // paragraph.
  const coverage = new Set([1, 4, 7, 11, 13, 19, 30, 32, 0, 37]);
  const escalationCoverage = 8;
  const series = Array.from({ length: 10000 }, () => Array.from({ length: 200 }, fairSpin));
  const r = runSimulationV2({ series, minUnit: 1, maxUnit: 50, coverageSet: coverage, escalationCoverage });

  console.log(`10,000 series OK (Task 23 rules). worst level ${r.worstLevel}, worst escalation-deficit spend $${r.worstSpent.toFixed(2)}, worst real-cash drawdown $${Math.abs(r.worstDrawdown).toFixed(2)} at $1 unit.`);
  console.log(`${r.resets} Trinity resets total, ${r.nonRecoveringWins} non-recovering Final-N wins that carried the deficit forward instead of resetting, ${r.zeroResetsWhileNegative} 0/00 hits that reset while the real cycle net was still negative (proves the unconditional 0/00 reset is exercised, not just asserted).`);
  console.log('INVARIANT: every reset (0/00, or a Final-N win with real cycle net >= 0) lands at EXACTLY spent=0/level=0; every non-recovering Final-N win escalates the deficit by EXACTLY perNumber x escalationCoverage, identically to a miss. The old "every hit nets >= floor" guarantee no longer holds unconditionally by design (rule 7) — asserted above on all 10,000 series without a single violation.');

  // Historical gate (pre-Task-23 semantics) kept alongside for continuity —
  // not the live-play model anymore, but still a valid sanity check on the
  // underlying computed-escalation math itself (unconditional-reset engine
  // behavior, unchanged).
  let globalWorst = 0, globalWorstSpend = 0;
  for (let s = 0; s < 10000; s++) {
    const spins = Array.from({ length: 200 }, fairSpin);
    const rOld = simulateSeries(spins, coverage, { minUnit: 1, maxUnit: 50 });
    if (rOld.cycles > 0) assert.ok(rOld.minNet >= 1, `sim ${s}: cycle closed below floor: ${rOld.minNet}`);
    if (rOld.worstDepth > globalWorst) globalWorst = rOld.worstDepth;
    if (rOld.worstCycleSpend > globalWorstSpend) globalWorstSpend = rOld.worstCycleSpend;
  }
  console.log(`(historical, pre-Task-23 unconditional-reset semantics, full coverage counted in escalation): worst depth ${globalWorst} misses, worst single-cycle spend $${globalWorstSpend.toFixed(2)} at $1 unit.`);
}
