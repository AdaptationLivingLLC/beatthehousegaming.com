// tests/test-series-fixes.mjs — Task 4: engine data-integrity fixes
//
// UPDATED for Task 5 (series-end persistence): auto-close used to call
// _resetForNewSeries() synchronously the instant the 38th number hit. That
// is exactly the behavior that caused the real "67 stale spins" field bug —
// live state got wiped with no user interaction while SpinDB still held the
// completed series' spins, so the next load replayed them into the new
// series. As of Task 5, auto-close FREEZES (engine.frozen = true) instead of
// resetting; only an explicit engine.resetSeries() call (wired to "New
// Series" in the UI) wipes history/totalSpins. Tests 1 and 2 below are
// updated to assert the frozen contract instead of an immediate reset —
// see tests/test-series-persistence.mjs for the full Task 5 coverage.
//
// Covers the four confirmed-from-real-casino-export bugs:
//  1. Series auto-close carrying stale spins into the next series
//     (regression guard — verified NOT reproducible against current
//     series-engine.js; _resetForNewSeries() already clears history/totalSpins).
//  2. lifetimeSpins drifting vs. the sum of seriesHistory — this one IS
//     reproducible: undoLastSpin() decremented totalSpins but never
//     decremented lifetimeSpins, so lifetimeSpins silently drifted upward
//     any time a spin was undone. Fixed in series-engine.js.
//  3. finalEightAges/finalEightFirstHit "never written while finalActivated"
//     (regression guard — verified NOT reproducible; they are written on
//     first-hit and aged every subsequent spin).
//  4. Bankroll winCount/lossCount/totalWagered staying 0 while bettingEnabled
//     was false — this IS reproducible, but the guard lives in
//     js/roulette-table.js:388 (`this.bettingEnabled`), not in bankroll.js
//     (BankrollManager has no bettingEnabled concept at all). Fixed by
//     extracting the decision into a pure, testable
//     RouletteTableUI#_shouldTrackBet(wasFinalActive, numbersPlayed) helper
//     that no longer consults bettingEnabled.
//
// Activation rule (series-engine.js _evaluateState, ~line 199-215):
//   unhit.length <= finalTargetCount (default 8) triggers finalActivated;
//   finalEight is seeded with exactly those unhit numbers. Once activated,
//   every remaining unhit number is already inside finalEight, so
//   _pickAutoFillCandidate() never finds a substitute — spinning each of
//   the 8 remaining numbers drives unhit.length to 0 and fires the 'auto'
//   seriesComplete path (_evaluateState ~line 217-232).

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const BTHG = loadBTHG(['js/utils.js', 'js/series-engine.js']);

// ---- Driver: 30 distinct spins -> activation at exactly 8 unhit, then
// spin the remaining 8 to auto-close the series. ------------------------
function activateAndAutoClose(engine) {
  for (let i = 0; i < 30; i++) engine.recordSpin(i);
  assert.equal(engine.finalActivated, true, 'setup: Final N must activate once unhit REAL count reaches 8');
  // Brandon 2026-07-04: 0/00 are covered separately, never Final N members.
  // Hitting 0..29 leaves reals 30..36 (7) + 00 unhit; activation fires one
  // spin earlier (at 28 reals hit) with the last 8 reals [29..36], and 29 is
  // then hit within the loop but not yet aged out, so it stays seeded.
  assert.deepEqual(
    [...engine.finalEight].sort((a, b) => a - b),
    [29, 30, 31, 32, 33, 34, 35, 36],
    'setup: finalEight seeded with the last 8 REAL numbers, no 00'
  );

  let agesWerePopulated = false;
  for (let i = 30; i < 38; i++) {
    engine.recordSpin(i);
    if (Object.keys(engine.finalEightAges).length > 0 || engine.finalEightFirstHit.size > 0) {
      agesWerePopulated = true;
    }
  }
  return agesWerePopulated;
}

// ---- Test 1: auto-close FREEZES (does not reset) history/totalSpins;
// lifetimeSpins stays in sync with the archived total while frozen.
{
  const engine = new BTHG.SeriesEngine();
  const agesWerePopulated = activateAndAutoClose(engine);

  assert.equal(engine.frozen, true, 'engine must freeze on auto-close, not reset');
  assert.equal(engine.history.length, 38, 'history must stay intact (frozen) on auto-close, not clear');
  assert.equal(engine.totalSpins, 38, 'totalSpins must stay intact (frozen) on auto-close, not reset to 0');
  assert.equal(engine.seriesCount, 1, 'one series should have completed');
  assert.equal(engine.seriesHistory.length, 1);
  assert.equal(engine.seriesHistory[0], 38);
  // While frozen, totalSpins for the just-closed series is already inside
  // seriesHistory — it must NOT be added again or lifetimeSpins double-counts.
  assert.equal(
    engine.lifetimeSpins,
    engine.seriesHistory.reduce((a, b) => a + b, 0),
    'lifetimeSpins must equal the archived seriesHistory sum while frozen'
  );
  assert.equal(engine.lifetimeSpins, 38);
  assert.ok(agesWerePopulated, 'finalEightAges/finalEightFirstHit must be written while finalActivated');

  // A spin while frozen must be a total no-op (this is the guard that
  // replaces the old immediate-reset behavior).
  engine.recordSpin(5);
  assert.equal(engine.totalSpins, 38, 'recordSpin must no-op while frozen');
  assert.equal(engine.history.length, 38, 'history must not grow while frozen');

  // resetSeries() is the ONLY thing that may unfreeze and wipe live state —
  // wired to "New Series" in RouletteTableUI.archiveAndReset().
  engine.resetSeries();
  assert.equal(engine.frozen, false, 'resetSeries must unfreeze');
  assert.equal(engine.history.length, 0, 'resetSeries must clear history');
  assert.equal(engine.totalSpins, 0, 'resetSeries must clear totalSpins');
  assert.equal(engine.seriesCount, 1, 'resetSeries must NOT touch archived seriesCount/seriesHistory');
  assert.equal(engine.seriesHistory.length, 1);

  console.log('auto-close freezes (no reset) + resetSeries unfreezes + lifetimeSpins + finalEightAges: PASS');
}

// ---- Test 2: next series does not inherit stale history from the closed
// one, once resetSeries() is explicitly called (the "New Series" action).
{
  const engine = new BTHG.SeriesEngine();
  activateAndAutoClose(engine); // completes + freezes series #1 (38 spins)

  // Spinning while frozen must not leak into the next series either.
  engine.recordSpin(9);
  engine.resetSeries();

  engine.recordSpin(0);
  engine.recordSpin(1);
  engine.recordSpin(2);

  assert.equal(engine.totalSpins, 3, 'next series must count from 0, not carry over stale spins');
  assert.equal(engine.history.length, 3);
  // Spread to a plain outer-realm array first — engine.history is created
  // inside the vm sandbox realm, and strict deepEqual checks constructor
  // identity, which differs across realms even for structurally-equal arrays.
  assert.deepEqual([...engine.history], [0, 1, 2], 'history must contain only the new series spins');
  assert.equal(
    engine.lifetimeSpins,
    engine.seriesHistory.reduce((a, b) => a + b, 0) + engine.totalSpins,
    'lifetimeSpins must still equal seriesHistory sum + live totalSpins mid-series'
  );
  console.log('no stale carry-over into next series (after explicit resetSeries): PASS');
}

// ---- Test 3: lifetimeSpins must not drift after undoLastSpin (the real,
// reproducible drift bug — undoLastSpin() decremented totalSpins but not
// lifetimeSpins). --------------------------------------------------------
{
  const engine = new BTHG.SeriesEngine();
  engine.recordSpin(1);
  engine.recordSpin(2);
  engine.recordSpin(3);
  engine.undoLastSpin();

  assert.equal(engine.totalSpins, 2);
  assert.equal(
    engine.lifetimeSpins,
    engine.seriesHistory.reduce((a, b) => a + b, 0) + engine.totalSpins,
    'lifetimeSpins must stay in sync (no drift) after undoLastSpin'
  );
  assert.equal(engine.lifetimeSpins, 2);
  console.log('lifetimeSpins stays consistent after undo: PASS');
}

// ---- Test 4: bankroll P&L tracking decision (Task 23 rule 11 supersedes
// Task 4's decision here: D2/"bets were not counting" was one bug, but
// Brandon's live-floor rule 11 is explicit — "while OFF nothing is deducted
// or counted (no phantom bets)". So bettingEnabled is now a REQUIRED third
// argument the caller must consult, reversing Task 4's original "must not
// depend on bettingEnabled" fix.
{
  const RT = loadBTHG(['js/utils.js', 'js/roulette-table.js']).RouletteTableUI;
  assert.equal(typeof RT.prototype._shouldTrackBet, 'function', '_shouldTrackBet must exist on RouletteTableUI');
  assert.equal(RT.prototype._shouldTrackBet(true, 9, true), true, 'active Trinity bet + BET ON must be tracked');
  assert.equal(RT.prototype._shouldTrackBet(false, 9, true), false, 'no active Final 8 => nothing to track');
  assert.equal(RT.prototype._shouldTrackBet(true, 0, true), false, 'zero numbers played => nothing to track');
  assert.equal(RT.prototype._shouldTrackBet(true, 9, false), false, 'BET OFF => nothing tracked even with an active Trinity bet (rule 11)');
  console.log('bankroll tracking requires Final 8 active, numbers played, AND bettingEnabled (rule 11): PASS');
}

// ---- Test 5: getEscalationNumbers (Task 23 rule 6) — Final-N members only,
// excluding 0/00, regardless of whether 0/00 happen to also be unhit
// members of finalEight itself.
{
  const engine = new BTHG.SeriesEngine();
  engine.finalEight = [1, 4, 7, 0, 37];
  assert.deepEqual([...engine.getEscalationNumbers()], [1, 4, 7], 'excludes 0 and 37 even when they are finalEight members');
  assert.deepEqual([...engine.getTrinityNumbers()], [0, 1, 4, 7, 37], 'sanity: full coverage still includes 0/00 (dedup)');

  engine.finalEight = [2, 5, 8];
  assert.deepEqual([...engine.getEscalationNumbers()], [2, 5, 8], '0/00 not in finalEight are still excluded from escalation count');
  assert.deepEqual([...engine.getTrinityNumbers()], [0, 2, 5, 8, 37]);
  console.log('getEscalationNumbers excludes 0/00 from the escalation coverage count: PASS');
}

console.log('series-fixes: ALL PASS');
