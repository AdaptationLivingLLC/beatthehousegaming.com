// tests/test-series-fixes.mjs — Task 4: engine data-integrity fixes
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
  assert.equal(engine.finalActivated, true, 'setup: Final 8 must activate once unhit count reaches 8');
  assert.deepEqual(
    [...engine.finalEight].sort((a, b) => a - b),
    [30, 31, 32, 33, 34, 35, 36, 37],
    'setup: finalEight must be seeded with exactly the unhit numbers'
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

// ---- Test 1: auto-close resets history/totalSpins; lifetimeSpins stays in sync
{
  const engine = new BTHG.SeriesEngine();
  const agesWerePopulated = activateAndAutoClose(engine);

  assert.equal(engine.history.length, 0, 'history must clear on auto-close');
  assert.equal(engine.totalSpins, 0, 'totalSpins must reset on auto-close');
  assert.equal(engine.seriesCount, 1, 'one series should have completed');
  assert.equal(engine.seriesHistory.length, 1);
  assert.equal(engine.seriesHistory[0], 38);
  assert.equal(
    engine.lifetimeSpins,
    engine.seriesHistory.reduce((a, b) => a + b, 0) + engine.totalSpins,
    'lifetimeSpins must equal seriesHistory sum + live totalSpins'
  );
  assert.equal(engine.lifetimeSpins, 38);
  assert.ok(agesWerePopulated, 'finalEightAges/finalEightFirstHit must be written while finalActivated');
  console.log('auto-close reset + lifetimeSpins + finalEightAges: PASS');
}

// ---- Test 2: next series does not inherit stale history from the closed one
{
  const engine = new BTHG.SeriesEngine();
  activateAndAutoClose(engine); // completes series #1 (38 spins)

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
  console.log('no stale carry-over into next series: PASS');
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

// ---- Test 4: bankroll P&L tracking decision must not depend on bettingEnabled
{
  const RT = loadBTHG(['js/utils.js', 'js/roulette-table.js']).RouletteTableUI;
  assert.equal(typeof RT.prototype._shouldTrackBet, 'function', '_shouldTrackBet must exist on RouletteTableUI');
  assert.equal(RT.prototype._shouldTrackBet(true, 9), true, 'active Trinity bet must be tracked');
  assert.equal(RT.prototype._shouldTrackBet(false, 9), false, 'no active Final 8 => nothing to track');
  assert.equal(RT.prototype._shouldTrackBet(true, 0), false, 'zero numbers played => nothing to track');
  console.log('bankroll tracking decoupled from bettingEnabled: PASS');
}

console.log('series-fixes: ALL PASS');
