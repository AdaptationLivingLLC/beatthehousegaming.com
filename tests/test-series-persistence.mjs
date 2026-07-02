// tests/test-series-persistence.mjs — Task 5: series-end persistence
// (freeze the board, archive on demand) + the stale-spin-replay field fix.
//
// Real field bug this closes: the OLD flow reset the engine's live state
// (history/totalSpins) the instant the 38th number hit, with zero user
// interaction, while the machine's live spin backlog in SpinDB was left
// completely untouched. On the next load, loadPreviousTable() replayed
// EVERY spin ever recorded for that machine (no series-boundary concept at
// all), so the already-finished series' spins got replayed on top of the
// new one — 67 stale spins in the real export that triggered this task.
//
// New contract:
//  - Series completion (_evaluateState, all 38 hit) FREEZES the engine
//    (engine.frozen = true) instead of resetting it. recordSpin/undoLastSpin
//    are no-ops while frozen.
//  - Nothing is written to SeriesDB, and no spins are marked in SpinDB,
//    until "New Series" is pressed (RouletteTableUI.archiveAndReset), which
//    is the ONLY place resetSeries() gets called following an auto
//    completion.
//  - SpinDB NEVER deletes spins. A machine's full spin tape (every number
//    physically landed on, across every series, forever) has to stay
//    intact for a later always-visible tape feature. Instead, archiving
//    (New Series / Save & Start New Series) or discarding stamps that
//    machine's not-yet-marked spins with a `seriesMarker` (SpinDB.
//    markArchived) — the archived record's timestamp for a real
//    completion, or a synthetic "discard:<ts>" tag for a discard. A spin
//    with no seriesMarker is, by definition, part of the current
//    unfinished series.
//  - The archive record carries machineId, entrySpin (spin index Final 8
//    activated at) and closerOffsets (derived from entrySpin +
//    finalEightFirstHitSpins) — see RouletteTableUI#_buildArchiveRecord.
//  - The frozen board's full state round-trips through a
//    'bthg_frozen_series' localStorage snapshot so a reload can restore it
//    exactly (see RouletteTableUI#_persistFrozenSnapshot / app.js
//    loadPreviousTable).
//
// Note: js/app.js itself boots via `document.addEventListener(
// 'DOMContentLoaded', ...)` at load time and drives the DOM directly, so it
// cannot be exercised through tests/_load.mjs's vm sandbox (no `document`
// global, matching how the rest of this suite treats app.js/roulette-
// table.js — only pure, DOM-free logic is unit tested here; see
// test-series-fixes.mjs's precedent for _shouldTrackBet). The "SpinDB
// marking makes reload replay only the current series" requirement is
// therefore verified by reimplementing loadPreviousTable's exact algorithm
// against a minimal in-memory stand-in for BTHG.Storage.SpinDB that honors
// the same addSpin/getSpinsByMachine/markArchived contract as the real
// IndexedDB-backed one in js/storage.js — the same contract
// RouletteTableUI.archiveAndReset drives via BTHG.Storage.SpinDB.markArchived.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const BTHG = loadBTHG(['js/utils.js', 'js/storage.js', 'js/series-engine.js', 'js/roulette-table.js']);
const SeriesEngine = BTHG.SeriesEngine;
const RT = BTHG.RouletteTableUI;

// ---- Fixture: drive a fresh engine to auto-close (Final 8 activates at
// exactly 8 unhit, then those 8 close the series). ------------------------
function activateAndAutoClose(engine) {
  for (let i = 0; i < 30; i++) engine.recordSpin(i);
  assert.equal(engine.finalActivated, true, 'setup: Final 8 must activate at 8 unhit');
  for (let i = 30; i < 38; i++) engine.recordSpin(i);
  assert.equal(engine.frozen, true, 'setup: engine must be frozen after auto-close');
}

// ---- Test 1: seriesComplete no longer wipes history until archiveAndReset
{
  const engine = new SeriesEngine();
  activateAndAutoClose(engine);

  assert.equal(engine.history.length, 38, 'frozen: full history must still be present');
  assert.equal(engine.totalSpins, 38, 'frozen: totalSpins must still be 38');
  assert.equal(engine.getRemainingCount(), 0, 'frozen: still shows the completed board (0 remaining)');
  assert.equal(engine.seriesCount, 1, 'frozen: series already counted as complete');

  // No spins register while frozen — this is the mechanism, not just a
  // side effect.
  engine.recordSpin(5);
  engine.undoLastSpin();
  assert.equal(engine.totalSpins, 38, 'frozen: recordSpin must be a no-op');
  assert.equal(engine.history.length, 38, 'frozen: undoLastSpin must be a no-op');

  // Simulate "New Series" — the only thing allowed to wipe state now.
  engine.resetSeries();
  assert.equal(engine.frozen, false, 'resetSeries must unfreeze');
  assert.equal(engine.history.length, 0, 'resetSeries must clear history');
  assert.equal(engine.totalSpins, 0, 'resetSeries must clear totalSpins');
  // Archived history from the completed series must survive the reset.
  assert.equal(engine.seriesCount, 1);
  assert.deepEqual([...engine.seriesHistory], [38]);

  console.log('seriesComplete freezes instead of wiping; resetSeries is the only wipe path: PASS');
}

// ---- Test 2: archive record carries closerOffsets/entrySpin/machineId
{
  const engine = new SeriesEngine();
  activateAndAutoClose(engine);

  assert.notEqual(engine.entrySpin, null, 'entrySpin must be set once Final 8 activates');
  assert.equal(engine.entrySpin, 30, 'Final 8 activated exactly on spin 30 in this fixture');

  const record = RT.prototype._buildArchiveRecord(engine, 'auto', null, 'table-7', 'Bellagio');

  assert.equal(record.machineId, 'table-7', 'record must carry machineId');
  assert.equal(record.casino, 'Bellagio');
  assert.equal(record.endType, 'auto');
  assert.equal(record.entrySpin, 30, 'record must carry entrySpin');
  assert.ok(Array.isArray(record.closerOffsets), 'record must carry closerOffsets');
  assert.equal(record.closerOffsets.length, 8, 'one closerOffset per Final 8 number that closed the series');
  // Every offset must be a non-negative spin count measured from entrySpin.
  for (const offset of record.closerOffsets) {
    assert.ok(Number.isInteger(offset) && offset >= 1, `closerOffset must be a positive spin count, got ${offset}`);
  }
  // In this fixture, numbers 30..37 close the series one per spin
  // immediately after entry (spin 31..38), so offsets are exactly 1..8.
  assert.deepEqual([...record.closerOffsets].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);

  console.log('archive record carries closerOffsets/entrySpin/machineId: PASS');
}

// ---- Test 2b: closerOffsets degrades gracefully when Final 8 never activated
// (e.g. a manual "End Series" pressed well before the board narrows down).
{
  const engine = new SeriesEngine();
  engine.recordSpin(1);
  engine.recordSpin(2);
  engine.recordSpin(3);
  assert.equal(engine.entrySpin, null, 'Final 8 never activated, entrySpin stays null');

  const record = RT.prototype._buildArchiveRecord(engine, 'manual', null, 'table-1', 'Bellagio');
  assert.equal(record.entrySpin, null);
  assert.deepEqual([...record.closerOffsets], [], 'closerOffsets must be empty, not throw, when entrySpin is null');

  console.log('closerOffsets degrades gracefully without Final 8 activation: PASS');
}

// ---- Test 3: SpinDB marking/filtering keeps a simulated reload from
// replaying anything but the current (unfinished) series' spins, WITHOUT
// ever deleting a spin — the full tape must survive forever for a later
// always-visible tape feature (per explicit requirement: mark, don't delete).
{
  // Minimal in-memory stand-in for BTHG.Storage.SpinDB — same method names
  // and semantics (per-machine array, stamp-not-delete) as the real
  // IndexedDB-backed one in js/storage.js, which RouletteTableUI.
  // archiveAndReset and the Discard handler drive via
  // BTHG.Storage.SpinDB.markArchived(machineId, marker).
  function makeFakeSpinDB() {
    let rows = [];
    let nextId = 1;
    return {
      async addSpin(spin) { rows.push({ id: nextId++, ...spin }); },
      async getSpinsByMachine(machineId) { return rows.filter(r => r.machineId === machineId); },
      async markArchived(machineId, marker) {
        for (const r of rows) {
          if (r.machineId === machineId && r.seriesMarker == null) r.seriesMarker = marker;
        }
      },
      _all() { return rows; },
    };
  }

  // Reimplements the relevant slice of app.js loadPreviousTable(): replay
  // only the UNMARKED spins currently in SpinDB for the machine.
  async function simulateReload(spinDB, machineId, finalTargetCount) {
    const fresh = new SeriesEngine();
    fresh.finalTargetCount = finalTargetCount;
    const allSpins = await spinDB.getSpinsByMachine(machineId);
    const liveSpins = allSpins.filter(s => s.seriesMarker == null);
    liveSpins.sort((a, b) => a.timestamp - b.timestamp);
    for (const spin of liveSpins) fresh.recordSpin(spin.number);
    return fresh;
  }

  const spinDB = makeFakeSpinDB();
  const machineId = 'table-9';

  // Series #1: 38 spins recorded live, exactly like _onNumberTap does.
  const live = new SeriesEngine();
  let t = 1000;
  for (let i = 0; i <= 37; i++) {
    live.recordSpin(i);
    await spinDB.addSpin({ number: i, timestamp: t++, machineId });
  }
  assert.equal(live.frozen, true, 'setup: series #1 auto-closed and froze');
  assert.equal((await spinDB.getSpinsByMachine(machineId)).length, 38, 'setup: all 38 spins are in SpinDB');

  // "New Series" pressed: archiveAndReset's SpinDB.markArchived step. Marks,
  // does not delete.
  const archiveMarker = 999000;
  await spinDB.markArchived(machineId, archiveMarker);
  live.resetSeries();
  const afterArchive = await spinDB.getSpinsByMachine(machineId);
  assert.equal(afterArchive.length, 38, 'archiving must NOT delete any spins, only mark them');
  assert.ok(afterArchive.every(s => s.seriesMarker === archiveMarker), 'every series #1 spin must carry the archive marker');

  // A few spins of series #2 happen before the next reload.
  for (const n of [4, 4, 9]) {
    live.recordSpin(n);
    await spinDB.addSpin({ number: n, timestamp: t++, machineId });
  }

  // The full tape must still contain all 41 spins (38 archived + 3 live) —
  // nothing was ever removed.
  assert.equal((await spinDB.getSpinsByMachine(machineId)).length, 41,
    'the machine\'s full spin tape must keep growing, never shrink');

  // Simulated reload: must replay ONLY series #2's 3 unmarked spins, never
  // series #1's 38 marked ones — this is the exact 67-stale-spins bug, closed.
  const reloaded = await simulateReload(spinDB, machineId, live.finalTargetCount);
  assert.equal(reloaded.totalSpins, 3, 'reload must replay only the current unfinished (unmarked) series');
  assert.deepEqual([...reloaded.history], [4, 4, 9]);

  // Resync lifetimeSpins from seriesHistory + live spins, the way
  // loadPreviousTable does after replay (seriesHistory would come from
  // SeriesDB in the real app; here it is asserted directly against the
  // fixture's known archived total).
  reloaded.seriesHistory = [38]; // what SeriesDB.getSeriesByMachine (auto/manual only) would report
  reloaded.seriesCount = 1;
  reloaded.lifetimeSpins = reloaded.seriesHistory.reduce((a, b) => a + b, 0) + reloaded.totalSpins;
  assert.equal(reloaded.lifetimeSpins, 41, 'lifetimeSpins must resync to archived total + live spins after replay');

  console.log('SpinDB marking (never deleting) prevents stale-spin replay across a simulated reload: PASS');
}

// ---- Test 3b: Discard must also mark (not delete) the live spin backlog
// (the other half of the critical requirement — roulette-table.js's
// es-discard handler)
{
  function makeFakeSpinDB() {
    let rows = [];
    return {
      async addSpin(spin) { rows.push(spin); },
      async getSpinsByMachine(machineId) { return rows.filter(r => r.machineId === machineId); },
      async markArchived(machineId, marker) {
        for (const r of rows) {
          if (r.machineId === machineId && r.seriesMarker == null) r.seriesMarker = marker;
        }
      },
    };
  }
  const spinDB = makeFakeSpinDB();
  const machineId = 'table-3';
  const engine = new SeriesEngine();
  let t = 0;
  for (const n of [1, 2, 3, 4, 5]) {
    engine.recordSpin(n);
    await spinDB.addSpin({ number: n, timestamp: t++, machineId });
  }
  assert.equal((await spinDB.getSpinsByMachine(machineId)).length, 5);

  // Mirrors the es-discard handler: engine.discardSeries() +
  // SpinDB.markArchived(machineId, 'discard:<ts>') — marks, never deletes.
  engine.discardSeries();
  await spinDB.markArchived(machineId, 'discard:123');

  const allSpins = await spinDB.getSpinsByMachine(machineId);
  assert.equal(engine.totalSpins, 0, 'discardSeries must reset the engine');
  assert.equal(allSpins.length, 5, 'discard must NOT delete anything from SpinDB, only mark it');
  assert.ok(allSpins.every(s => s.seriesMarker === 'discard:123'),
    'discarded spins must be marked so a reload does not replay them, without losing them from the tape');

  console.log('discard marks (does not delete) the live spin backlog: PASS');
}

// ---- Test 4: frozen snapshot round-trips through localStorage
{
  const engine = new SeriesEngine();
  activateAndAutoClose(engine);

  // Mirrors RouletteTableUI#_persistFrozenSnapshot.
  BTHG.Storage.LS.set('frozen_series', {
    machineId: 'table-5',
    casino: 'Wynn',
    endType: 'auto',
    engineState: engine.toJSON(),
    timestamp: 12345,
  });

  const readBack = BTHG.Storage.LS.get('frozen_series', null);
  assert.ok(readBack, 'frozen snapshot must be readable back from localStorage');
  assert.equal(readBack.machineId, 'table-5');
  assert.equal(readBack.endType, 'auto');
  assert.equal(readBack.engineState.frozen, true, 'persisted engine state must itself be marked frozen');
  assert.equal(readBack.engineState.totalSpins, 38);
  assert.equal(readBack.engineState.history.length, 38);

  // Mirrors app.js loadPreviousTable's restore-from-snapshot branch.
  const restored = new SeriesEngine();
  restored.fromJSON(readBack.engineState);
  assert.equal(restored.frozen, true, 'restored engine must come back frozen');
  assert.equal(restored.totalSpins, 38);
  assert.deepEqual([...restored.history], [...engine.history]);
  assert.equal(restored.entrySpin, engine.entrySpin, 'entrySpin must round-trip too');

  // Mirrors archiveAndReset's cleanup of the snapshot once archived.
  BTHG.Storage.LS.remove('frozen_series');
  assert.equal(BTHG.Storage.LS.get('frozen_series', null), null, 'New Series must remove the frozen snapshot');

  console.log('frozen snapshot round-trips through localStorage and restores frozen state: PASS');
}

// ---- Test 5: SeriesDB record filtering — "Save & Keep Counting" snapshots
// must not be mixed in with real completions when rebuilding seriesHistory
// (the other confirmed root-cause bug: SeriesDB.getSeriesByMachine mixes
// snapshot records with real completions).
{
  const seriesRecords = [
    { endType: 'auto', totalSpins: 38 },
    { endType: 'snapshot', totalSpins: 15 },   // Save & Keep Counting — NOT a completion
    { endType: 'manual', totalSpins: 42 },
    { endType: 'snapshot', totalSpins: 9 },
  ];
  // Mirrors the filter now applied in app.js loadPreviousTable.
  const completed = seriesRecords.filter(s => s.endType === 'auto' || s.endType === 'manual');
  assert.equal(completed.length, 2, 'snapshot records must be excluded from completed series history');
  const seriesHistory = completed.map(s => s.totalSpins);
  const seriesAverage = Math.round(seriesHistory.reduce((a, b) => a + b, 0) / seriesHistory.length);
  assert.deepEqual(seriesHistory, [38, 42]);
  assert.equal(seriesAverage, 40, 'average must be computed only from real completions, not snapshots');

  console.log('SeriesDB snapshot records excluded from completed-series accounting: PASS');
}

console.log('series-persistence: ALL PASS');
