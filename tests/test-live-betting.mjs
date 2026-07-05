// tests/test-live-betting.mjs — Task 23: live betting engine overhaul
// (denomination + wins bucket + real Trinity wiring + 0/00 rules + undo).
//
// Drives RouletteTableUI's money-flow methods directly (_applyLiveBetting,
// _pushMoneySnapshot/_restoreMoneySnapshot, _isFinalHighlighted,
// _currentBetPerNumber/_currentTrinityMultiplier) the same way the existing
// suite drives other DOM-free pure methods on the class
// (_shouldTrackBet/_buildArchiveRecord/_isDiamondLabel in
// tests/test-series-fixes.mjs) — these methods deliberately never touch
// `this.container`/`document`, so a real DOM is not needed. `driveSpin`/
// `driveUndo` below replay the exact non-DOM sequence _onNumberTap/_onUndo
// perform (push snapshot -> capture pre-spin coverage -> engine.recordSpin
// -> _applyLiveBetting / undo -> restore snapshot), skipping only the DOM
// rendering + IndexedDB persistence side effects, which are covered
// elsewhere (test-series-persistence.mjs, test-intel-feed.mjs).

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const BTHG = loadBTHG(['js/utils.js', 'js/series-engine.js', 'js/trinity.js', 'js/bankroll.js', 'js/intel-feed.js', 'js/roulette-table.js']);
const RT = BTHG.RouletteTableUI;

function driveSpin(rt, num) {
  if (rt.engine.frozen) return null;
  rt._pushMoneySnapshot();
  const wasFinalActive = rt.engine.finalActivated;
  const coveredNumbers = rt.engine.getTrinityNumbers();
  const escalationNumbers = rt.engine.getEscalationNumbers();
  rt.engine.recordSpin(num);
  return rt._applyLiveBetting(num, wasFinalActive, coveredNumbers, escalationNumbers);
}

function driveUndo(rt) {
  if (rt.engine.frozen) return false;
  const ok = rt.engine.undoLastSpin();
  if (ok) rt._restoreMoneySnapshot(rt._moneyHistory.pop());
  return ok;
}

// Build a fresh {engine, bankroll, trinity, rt} with Final-1 activated and
// finalEight=[36] (0 and 37 already hit earlier in the series, so
// coveredNumbers = [0, 36, 37], escalationNumbers = [36]). starting
// bankroll $500, denomination $5, table max $500 (no cap).
function setupFinal1() {
  const engine = new BTHG.SeriesEngine();
  engine.setCoverageCount(1);
  for (let i = 0; i <= 35; i++) engine.recordSpin(i);
  engine.recordSpin(37); // activates: unhit = {36}
  assert.equal(engine.finalActivated, true, 'setup: Final 1 must activate');
  assert.deepEqual([...engine.finalEight], [36]);

  const bankroll = new BTHG.BankrollManager(500, 5, 35);
  const trinity = new BTHG.TrinityEngine({ minUnit: 5, maxUnit: 500 });
  const rt = new RT(null, engine, bankroll, {}, {}, trinity);
  rt.bettingEnabled = true;
  // The 36 setup spins above went straight through engine.recordSpin(),
  // never through _onNumberTap/_pushMoneySnapshot (rt did not exist yet) —
  // same shape as app.js's loadPreviousTable reload replay (Critical 1).
  // Backfill so _moneyHistory starts index-aligned with engine.history,
  // exactly like that fix does, instead of carrying a pre-existing test-
  // fixture desync into every test that uses this helper.
  while (rt._moneyHistory.length < engine.history.length) rt._pushMoneySnapshot();
  return { engine, bankroll, trinity, rt };
}

// ---- Test 1: full hand-traced money flow (rules 2, 3, 5, 6, 7) — two
// misses then a recovering Final-N hit. Numbers match the report's
// hand-trace exactly. ---------------------------------------------------
{
  const { bankroll, trinity, rt } = setupFinal1();

  // Miss 1: spin 1 (not covered: [0,36,37])
  const r1 = driveSpin(rt, 1);
  assert.ok(r1, 'miss must still be tracked (BET ON, Final 8 active)');
  assert.equal(r1.stake, 15, 'stake = perNumber($5) x coveredCount(3)');
  assert.equal(bankroll.totalBankroll, 485);
  assert.equal(trinity.spent, 5, 'escalation deficit grows by perNumber x escalationCoverage(1)');
  assert.equal(trinity.level, 1);
  assert.equal(rt._trinityCycleNet, -15);
  assert.equal(bankroll.lossCount, 1);

  // Miss 2: spin 2
  driveSpin(rt, 2);
  assert.equal(bankroll.totalBankroll, 470);
  assert.equal(trinity.spent, 10);
  assert.equal(trinity.level, 2);
  assert.equal(rt._trinityCycleNet, -30);
  assert.equal(bankroll.lossCount, 2);

  // Hit: spin 36 (the Final-1 member) — recovers (cycleNet goes positive)
  const r3 = driveSpin(rt, 36);
  assert.equal(r3.isCovered, true);
  assert.equal(r3.isZeroHit, false);
  assert.equal(r3.perNumber, 5, 'still $5 — deficit never grew past one increment');
  assert.equal(bankroll.totalBankroll, 500, 'wins bucket topped bankroll back to exactly starting');
  assert.equal(bankroll.winsBucket, 135, '180 payout - 45 needed to top up = 135 kept permanently');
  assert.equal(bankroll.winCount, 1);
  assert.equal(bankroll.totalWagered, 45, '3 spins x $15 stake');
  assert.equal(trinity.spent, 0, 'recovering win resets Trinity (rule 7)');
  assert.equal(trinity.level, 0);
  assert.equal(rt._trinityCycleNet, 0, 'cycle net resets alongside Trinity');
  assert.equal(rt._betSpinCount, 3);
  console.log('Test 1 (hand-traced 2 misses + recovering hit, rules 2/3/5/6/7): PASS');
}

// ---- Test 2: bankroll never rises above starting even on a big win from
// a bucket that already holds plenty (rule 3). ---------------------------
{
  const { bankroll, trinity, rt } = setupFinal1();
  bankroll.winsBucket = 1000; // pretend a prior session already built a cushion
  bankroll.totalBankroll = 500;
  driveSpin(rt, 36); // immediate hit, no prior misses
  assert.ok(bankroll.totalBankroll <= 500 + 1e-9, 'bankroll never exceeds starting');
  console.log('Test 2 (bankroll capped at starting even with a large bucket): PASS');
}

// ---- Test 3: rule 6 — a hit on 0 or 00 resets Trinity UNCONDITIONALLY,
// even while the real cycle net is still deeply negative (proves this is
// NOT the same conditional gate as rule 7's Final-N win logic). ----------
{
  const { bankroll, trinity, rt } = setupFinal1();
  // Force a deep, deliberately unrecoverable deficit directly rather than
  // grinding out dozens of organic miss spins — this is a targeted unit
  // test of the reset DECISION, not a claim about how fast real play gets
  // here.
  trinity.spent = 500;
  trinity.level = 40;
  rt._trinityCycleNet = -2000;
  bankroll.totalBankroll = 100;
  bankroll.sessionStartBankroll = 500;
  bankroll.winsBucket = 0;

  const r = driveSpin(rt, 0); // hit on 0
  assert.equal(r.isCovered, true);
  assert.equal(r.isZeroHit, true);
  assert.ok(rt._trinityCycleNet === 0, 'cycle net forced to 0 on reset');
  // The real net was still negative going into this decision — prove it
  // would NOT have qualified for rule 7's conditional reset on its own.
  assert.ok(-2000 + 36 * r.perNumber - r.stake < 0, 'setup sanity: real net was still negative at the time of the hit');
  assert.equal(trinity.spent, 0, '0/00 hit resets Trinity regardless of the negative real net');
  assert.equal(trinity.level, 0);
  console.log('Test 3 (0/00 hit resets Trinity unconditionally, rule 6): PASS');
}

// ---- Test 4: rule 7 — a Final-N win that does NOT bring the real cycle
// net back to zero or positive does NOT reset Trinity; it escalates
// exactly like a miss (deficit carries forward). -------------------------
{
  const { bankroll, trinity, rt } = setupFinal1();
  trinity.spent = 200;
  trinity.level = 20;
  rt._trinityCycleNet = -1000; // deep enough that this hit's payout cannot recover it
  bankroll.totalBankroll = 100;
  bankroll.sessionStartBankroll = 500;
  bankroll.winsBucket = 0;

  const spentBefore = trinity.spent;
  const levelBefore = trinity.level;
  const r = driveSpin(rt, 36); // Final-N hit, NOT 0/00
  assert.equal(r.isCovered, true);
  assert.equal(r.isZeroHit, false);
  assert.ok(rt._trinityCycleNet < 0, 'real cycle net is still negative after this payout');
  assert.equal(bankroll.winCount, 1, 'the wins-bucket payout still happens even without a Trinity reset');
  // Non-reset: recordMiss() was called instead — spent grows by exactly
  // this spin's escalation-only cost (perNumber x escalationCoverage),
  // level increments by 1, same as any miss (rule 5).
  assert.equal(trinity.spent, spentBefore + r.perNumber * 1, 'deficit carries forward + grows like a miss');
  assert.equal(trinity.level, levelBefore + 1);
  console.log('Test 4 (non-recovering win does not reset, carries forward + escalates, rule 7): PASS');
}

// ---- Test 5: rule 8 regression — every covered-number type pays: a
// Final-N member's first hit, the SAME number hit again immediately while
// still inside the 2-spin age window (Brandon's real-data "quick repeats"),
// 0, and 00. ---------------------------------------------------------------
{
  const engine = new BTHG.SeriesEngine();
  engine.setCoverageCount(2);
  // Hit 0-29, 31-35, 37 (36 distinct numbers) -> unhit = {30, 36}
  for (let i = 0; i <= 29; i++) engine.recordSpin(i);
  for (let i = 31; i <= 35; i++) engine.recordSpin(i);
  engine.recordSpin(37);
  assert.equal(engine.finalActivated, true);
  assert.deepEqual([...engine.finalEight].sort((a, b) => a - b), [30, 36]);

  const bankroll = new BTHG.BankrollManager(500, 5, 35);
  const trinity = new BTHG.TrinityEngine({ minUnit: 5, maxUnit: 500 });
  const rt = new RT(null, engine, bankroll, {}, {}, trinity);
  rt.bettingEnabled = true;

  // First hit on Final-N member 30.
  const rFirst = driveSpin(rt, 30);
  assert.equal(rFirst.isCovered, true, 'Final-N member first hit must pay');
  assert.equal(bankroll.winCount, 1);

  // Immediate repeat of 30 — still inside the 2-spin age window (not yet
  // evicted), must pay exactly like any other covered hit (rule 4/8).
  assert.ok(engine.finalEight.includes(30), 'setup: 30 must still be covered immediately after its first hit');
  const rRepeat = driveSpin(rt, 30);
  assert.equal(rRepeat.isCovered, true, 'age-window repeat hit must register as paid');
  assert.equal(bankroll.winCount, 2);

  // Hit on 0.
  const rZero = driveSpin(rt, 0);
  assert.equal(rZero.isCovered, true, '0 must always register as paid when hit');
  assert.equal(rZero.isZeroHit, true);
  assert.equal(bankroll.winCount, 3);

  // Hit on 00 (37).
  const rDoubleZero = driveSpin(rt, 37);
  assert.equal(rDoubleZero.isCovered, true, '00 must always register as paid when hit');
  assert.equal(rDoubleZero.isZeroHit, true);
  assert.equal(bankroll.winCount, 4);

  console.log('Test 5 (every covered-number type pays: Final-N, age-window repeat, 0, 00 — rule 8): PASS');
}

// ---- Test 6: rule 9 — cap alert pushed through BTHG.IntelFeed (kind
// 'trinity') when the next required escalation exceeds the table maximum;
// the underlying bet math is untouched (trinity.js's own screens/perScreen
// cap behavior governs). -------------------------------------------------
{
  const { rt, trinity } = setupFinal1();
  trinity.maxUnit = 10; // small table max relative to a deep deficit
  trinity.spent = 1000; // forces perNumber well past $10

  const pushed = [];
  BTHG.IntelFeed = { push: (alert) => pushed.push(alert) }; // stub — see file header

  const r = driveSpin(rt, 1); // miss (not covered)
  assert.ok(r.perNumber > trinity.maxUnit, 'setup sanity: this bet does exceed the table max');
  assert.equal(pushed.length, 1, 'exactly one cap alert pushed');
  assert.equal(pushed[0].kind, 'trinity');
  assert.ok(pushed[0].message.length > 0);
  assert.ok(!pushed[0].message.includes('–') && !pushed[0].message.includes('—'), 'no dashes in user-facing copy');
  console.log('Test 6 (cap alert pushed via IntelFeed kind=trinity, rule 9): PASS');
}

// ---- Test 7: rule 11 — BET OFF means nothing deducted or counted at all
// (no phantom bets), and toggling then undoing keeps the books consistent.
{
  const { bankroll, trinity, rt } = setupFinal1();

  rt.bettingEnabled = true;
  driveSpin(rt, 1); // miss, BET ON — mutates
  const afterFirstSpin = {
    bankroll: bankroll.toJSON(),
    trinity: trinity.toJSON(),
    cycleNet: rt._trinityCycleNet,
    betSpinCount: rt._betSpinCount,
  };

  rt.bettingEnabled = false;
  driveSpin(rt, 2); // BET OFF — must be a complete no-op for money
  assert.deepEqual(bankroll.toJSON(), afterFirstSpin.bankroll, 'BET OFF: bankroll untouched');
  assert.deepEqual(trinity.toJSON(), afterFirstSpin.trinity, 'BET OFF: Trinity untouched');
  assert.equal(rt._trinityCycleNet, afterFirstSpin.cycleNet, 'BET OFF: cycle net untouched');
  assert.equal(rt._betSpinCount, afterFirstSpin.betSpinCount, 'BET OFF: bet count untouched (no phantom bet)');

  // Undo the BET-OFF spin — books must land back exactly on the BET-ON
  // spin's post-state (toggling then undoing keeps books consistent).
  assert.ok(driveUndo(rt));
  assert.deepEqual(bankroll.toJSON(), afterFirstSpin.bankroll);
  assert.deepEqual(trinity.toJSON(), afterFirstSpin.trinity);
  assert.equal(rt._trinityCycleNet, afterFirstSpin.cycleNet);
  assert.equal(rt._betSpinCount, afterFirstSpin.betSpinCount);
  console.log('Test 7 (BET OFF: no phantom bets; toggle then undo keeps books consistent, rule 11): PASS');
}

// ---- Test 8: rule 10 / D3 — undo restores Trinity + bankroll + wins
// bucket + cycle-net + bet count to EXACTLY the pre-spin snapshot. Spin,
// undo, spin a DIFFERENT number: every money number must be identical to
// having never made the first spin (the brief's literal test). ----------
{
  const a = setupFinal1(); // will: spin(1), undo, spin(2)
  const b = setupFinal1(); // control: only ever spins(2)

  driveSpin(a.rt, 1); // some spin that mutates money state
  assert.ok(driveUndo(a.rt));
  driveSpin(a.rt, 2);

  driveSpin(b.rt, 2);

  assert.deepEqual(a.bankroll.toJSON(), b.bankroll.toJSON(), 'bankroll identical to never having spun 1 first');
  assert.deepEqual(a.trinity.toJSON(), b.trinity.toJSON(), 'Trinity identical to never having spun 1 first');
  assert.equal(a.rt._trinityCycleNet, b.rt._trinityCycleNet, 'cycle net identical');
  assert.equal(a.rt._betSpinCount, b.rt._betSpinCount, 'bet count identical');
  console.log('Test 8 (undo restores exact pre-spin state; spin/undo/spin-different matches never-spun-first, rule 10/D3): PASS');
}

// ---- Test 9: D1/rule 12 — _isFinalHighlighted. 0/00 highlight as covered
// on the felt once the final phase is active, not just literal finalEight
// membership; nothing highlights before the final phase activates. ------
{
  const engine = new BTHG.SeriesEngine();
  const rt = new RT(null, engine, new BTHG.BankrollManager(500, 5, 35), {}, {}, null);

  // Before Final 8 activates at all — nothing highlights, even 0/00.
  assert.equal(rt._isFinalHighlighted(0), false);
  assert.equal(rt._isFinalHighlighted(37), false);

  engine.finalActivated = true;
  engine.finalEight = [3, 7];
  assert.equal(rt._isFinalHighlighted(3), true, 'literal Final-N member highlights');
  assert.equal(rt._isFinalHighlighted(0), true, '0 highlights once final phase is active (D1 fix)');
  assert.equal(rt._isFinalHighlighted(37), true, '00 highlights once final phase is active (D1 fix)');
  assert.equal(rt._isFinalHighlighted(5), false, 'uncovered number does not highlight');
  console.log('Test 9 (D1/rule 12: 0/00 highlight as covered once final phase is active): PASS');
}

// ---- Test 10: _currentBetPerNumber / _currentTrinityMultiplier reflect
// the REAL Trinity engine (denomination x multiplier), not the deprecated
// ladder — and are pure projections (repeated calls do not mutate state).
{
  const { trinity, rt } = setupFinal1();
  const before = { spent: trinity.spent, level: trinity.level };
  const perNumber1 = rt._currentBetPerNumber();
  const perNumber2 = rt._currentBetPerNumber();
  assert.equal(perNumber1, perNumber2, 'display projection is idempotent');
  assert.equal(perNumber1, 5, 'first bet at a fresh cycle is exactly the denomination (1x)');
  assert.equal(trinity.spent, before.spent, 'display must not mutate trinity state');
  assert.equal(trinity.level, before.level);
  assert.equal(rt._currentTrinityMultiplier(), 1);

  driveSpin(rt, 1); // miss -> escalates
  driveSpin(rt, 2); // miss -> escalates further
  const mult = rt._currentTrinityMultiplier();
  assert.ok(mult >= 1, 'multiplier reflects real escalation');
  console.log('Test 10 (_currentBetPerNumber/_currentTrinityMultiplier reflect the real engine, pure): PASS');
}

// ---- Test 11a: Critical 1 — direct engine.recordSpin() calls that bypass
// _onNumberTap (app.js's loadPreviousTable reload replay and the Pocket
// Timing overlay both do this) must push a money snapshot FIRST, matching
// the fix at both call sites. These spins move no money at all, so undoing
// one must restore the exact same (unchanged) money state. -----------------
{
  const { bankroll, trinity, rt, engine } = setupFinal1();

  const before = {
    bankroll: bankroll.toJSON(), trinity: trinity.toJSON(),
    cycleNet: rt._trinityCycleNet, betSpinCount: rt._betSpinCount,
  };

  // Exactly what app.js now does at both direct-recordSpin call sites:
  // push a snapshot of the CURRENT state, then record the spin with no
  // _applyLiveBetting involved (no money moves).
  const moneyLenBefore = rt._moneyHistory.length;
  const engineLenBefore = engine.history.length;
  assert.equal(moneyLenBefore, engineLenBefore, 'setup: fixture starts aligned');
  rt._pushMoneySnapshot();
  engine.recordSpin(1);
  assert.equal(rt._moneyHistory.length, moneyLenBefore + 1, 'exactly one snapshot pushed');
  assert.equal(engine.history.length, engineLenBefore + 1, 'exactly one spin recorded');
  assert.equal(rt._moneyHistory.length, engine.history.length, 'stays index-aligned with engine.history');

  assert.ok(driveUndo(rt), 'undo must succeed');
  assert.deepEqual(bankroll.toJSON(), before.bankroll, 'bankroll restored exactly (untracked spin moved no money)');
  assert.deepEqual(trinity.toJSON(), before.trinity, 'trinity restored exactly');
  assert.equal(rt._trinityCycleNet, before.cycleNet, 'cycle net restored exactly');
  assert.equal(rt._betSpinCount, before.betSpinCount, 'bet count restored exactly (untracked spin never counted as bet)');
  console.log('Test 11a (untracked direct recordSpin + snapshot -> undo restores identical money state, Critical 1): PASS');
}

// ---- Test 11b: the alignment guard warns loudly (never silently no-ops)
// when _moneyHistory and engine.history have genuinely drifted apart — the
// exact bug this closes (D3 resurfacing via a second, un-snapshotted
// route, e.g. a future call site that forgets to push). --------------------
{
  const { rt, engine } = setupFinal1();
  assert.equal(rt._moneyHistory.length, engine.history.length, 'setup: fixture starts aligned');

  // Deliberately reproduce the BUG being fixed: record a spin directly with
  // NO snapshot pushed first (i.e. skip the fix), the way the two call
  // sites used to.
  engine.recordSpin(1);
  assert.notEqual(rt._moneyHistory.length, engine.history.length, 'setup: histories are desynced on purpose');

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  let aligned;
  try {
    aligned = rt._checkMoneyHistoryAlignment();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(aligned, false);
  assert.equal(warnings.length, 1, 'exactly one warning fired, never a silent no-op');
  assert.ok(warnings[0].includes(String(rt._moneyHistory.length)), 'warning names the _moneyHistory length');
  assert.ok(warnings[0].includes(String(engine.history.length)), 'warning names the engine.history length');

  // Aligned state (the normal case) must NOT warn.
  const { rt: rt2 } = setupFinal1();
  console.warn = (...args) => warnings.push(args.join(' '));
  let aligned2;
  try {
    aligned2 = rt2._checkMoneyHistoryAlignment();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(aligned2, true);
  assert.equal(warnings.length, 1, 'no new warning when histories are aligned');
  console.log('Test 11b (alignment guard warns loudly on real desync, silent when aligned, Critical 1): PASS');
}

// ---- Test 12: Critical 2 — a mid-cycle denomination/table-max change
// (RouletteTableUI#_onTrinitySettingsChanged, called by app.js's
// syncTrinityEngineFromProfile when it rebuilds trinityEngine) must reset
// _trinityCycleNet to 0, or a stale deficit keeps gating rule 7's
// conditional-reset decision against a Trinity that has no memory of it —
// a win could then never reset again. betSpinCount is a session counter
// and must NOT reset. One plain-word IntelFeed card announces the restart,
// but only when an engine already existed (not on first-ever setup). ------
{
  const { bankroll, trinity, rt } = setupFinal1();

  driveSpin(rt, 1); // miss
  driveSpin(rt, 2); // miss
  driveSpin(rt, 3); // miss
  assert.ok(rt._trinityCycleNet < 0, 'setup: 3 misses have driven the cycle net negative');
  const betSpinCountBefore = rt._betSpinCount;

  const pushed = [];
  BTHG.IntelFeed = { push: (alert) => pushed.push(alert) };

  // Simulate the rebuild branch firing (denomination changed) — app.js
  // constructs a fresh TrinityEngine and calls this exactly once.
  const freshTrinity = new BTHG.TrinityEngine({ minUnit: 10, maxUnit: 500 }); // new denomination: $10
  rt.trinityEngine = freshTrinity;
  rt._onTrinitySettingsChanged(true); // announce=true: an engine already existed

  assert.equal(rt._trinityCycleNet, 0, 'cycle net resets to 0 on a mid-cycle settings change');
  assert.equal(rt._betSpinCount, betSpinCountBefore, 'betSpinCount is a session counter, must NOT reset');
  assert.equal(pushed.length, 1, 'exactly one IntelFeed card announces the restart');
  assert.equal(pushed[0].kind, 'trinity');
  assert.ok(pushed[0].message.length > 0);
  assert.ok(!pushed[0].message.includes('–') && !pushed[0].message.includes('—'), 'no dashes in user-facing copy');

  // Next win at fresh-cycle math resets properly: a hit on the still-active
  // Final-1 member (36, unchanged since setup — the 3 misses above were all
  // non-36 spins), now priced by the NEW $10 engine starting from a clean
  // spent=0/level=0/cycleNet=0, must reset cleanly (rule 7).
  const r = driveSpin(rt, 36);
  assert.equal(r.isCovered, true);
  assert.equal(r.perNumber, 10, 'fresh-cycle math prices at the NEW $10 denomination');
  assert.equal(freshTrinity.spent, 0, 'fresh-cycle win resets cleanly');
  assert.equal(freshTrinity.level, 0);
  assert.equal(rt._trinityCycleNet, 0, 'cycle net resets cleanly on the fresh-cycle win');
  console.log('Test 12 (mid-cycle settings change resets cycle net, session counter untouched, fresh-cycle win resets cleanly, Critical 2): PASS');
}

console.log('live-betting: ALL PASS');
