// tests/test-bankroll-reco.mjs — Task 9: bankroll manager rebuild
//
// Covers BTHG.Bankroll (js/bankroll.js): recommendStart, the archive-replay
// path that backs it in real use, projectionLines, resolveProfileForLimits,
// and BankrollManager#setBankroll's re-baseline (no phantom loss).
//
// Binding decision (adjudicated, overrides the brief's Step 2 sourcing):
// recommendStart must derive its worst-cycle numbers from the user's own
// archived series, NOT from the Task 3 simulation constant. The sim's
// stochastic worst (10,000-series Monte Carlo run: depth 44, $26.16M at a
// $1 unit) is a heavy-tail artifact of a pure random walk — a recommended
// bankroll built on it would be absurd. There is deliberately no
// BTHG.CONSTANTS.TRINITY_WORST_SPEND_AT_1 anywhere in this codebase; this
// file asserts that directly (Test 6).

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const BTHG = loadBTHG(['js/utils.js', 'js/trinity.js', 'js/bankroll.js']);
const { Bankroll, BankrollManager } = BTHG;

// ---- Test 1: brief's Step 1 failing test (recommendation math, override path) ----
{
  const r = Bankroll.recommendStart({ minUnit: 1, worstCycleSpendAt1: 480 }); // from sim gate output
  assert.equal(r.amount, Math.ceil(480 * 1 * 1.25 / 50) * 50);
  assert.ok(r.explanation.includes('worst'));
  assert.equal(r.amount, 600, 'sanity: 480 * 1.25 = 600, already a multiple of 50');
  console.log('recommendStart override math (brief Step 1): PASS');
}

// ---- Test 2: override path scales by minUnit, and never mentions dashes ----
{
  const r = Bankroll.recommendStart({ minUnit: 5, worstCycleSpendAt1: 480 });
  // worstSpend = 480 * 5 = 2400; *1.25 = 3000; already a multiple of 50
  assert.equal(r.worstSpend, 2400);
  assert.equal(r.amount, 3000);
  assert.ok(!r.explanation.includes('–') && !r.explanation.includes('—'),
    'no em/en dashes in user-facing copy');
  console.log('recommendStart override scales by minUnit: PASS');
}

// ---- Test 2b: no table limits set yet -> asks for limits, never guesses at $1 ----
{
  for (const bad of [undefined, null, 0, -1]) {
    const r = Bankroll.recommendStart({ minUnit: bad, archive: [{ endType: 'auto', spinHistory: [1], finalEight: [1], entrySpin: 0 }] });
    assert.equal(r.amount, null, `minUnit=${bad} must not produce a number`);
    assert.ok(r.explanation.toLowerCase().includes('table minimum'), 'explanation points at the table minimum field');
  }
  // Also true for the override path — a $1-unit sim number is meaningless without a real table unit to scale to.
  const r2 = Bankroll.recommendStart({ worstCycleSpendAt1: 480 });
  assert.equal(r2.amount, null);
  console.log('no minUnit -> asks for table limits instead of a number: PASS');
}

// ---- Test 3: no archive at all -> null amount, plain-word explanation, no crash ----
{
  const r = Bankroll.recommendStart({ minUnit: 5, archive: [] });
  assert.equal(r.amount, null);
  assert.equal(r.worstDepth, null);
  assert.equal(r.worstSpend, null);
  assert.ok(r.explanation.toLowerCase().includes('completed'), 'explains a completed series is needed');
  assert.ok(!r.explanation.includes('–') && !r.explanation.includes('—'));

  const r2 = Bankroll.recommendStart({ minUnit: 5 }); // archive omitted entirely
  assert.equal(r2.amount, null);
  console.log('empty/omitted archive -> insufficient-data message, no number: PASS');
}

// ---- Test 4: archive-based recommendation replays real archived series ----
// Build a synthetic archived series record shaped exactly like
// SeriesEngine#getSeriesDataForSave()'s output: spinHistory (plain numbers,
// NOT spins), finalEight (the Final 8 snapshot, NOT including 0/00 — those
// are always covered on top per getTrinityNumbers()), entrySpin (index at
// which Final 8 activated), endType.
{
  // Closing phase covers {2, 4} plus 0/00 always -> coverage = {2,4,0,37}.
  // Spins after entrySpin: miss, miss, miss, hit(2). At $1/unit, 4-number
  // coverage: netPerUnit = 36 - 4 = 32. Depth 0 bet: ceil((0+1)/32 -> 1) = $1/number,
  // total $4. After 3 misses spent = $12, level = 3. Then hit resets.
  const record = {
    machineId: 'm1', endType: 'auto',
    spinHistory: [10, 11, 12, 13, /* entry */ 9, 9, 9, 2],
    finalEight: [2, 4],
    entrySpin: 4, // closing phase = spinHistory.slice(4) = [9,9,9,2]
  };

  const cyc = Bankroll.replaySeriesCycle({
    spinHistory: record.spinHistory, entrySpin: record.entrySpin, finalEight: record.finalEight, minUnit: 1,
  });
  assert.ok(cyc, 'replaySeriesCycle must return a result for a real closing phase');
  assert.equal(cyc.worstDepth, 3, 'three misses (9,9,9) deep before the hit');
  assert.ok(cyc.worstSpend > 0, 'some spend accrued before the hit');
  assert.equal(cyc.currentLevel, 0, 'hit resets the cycle');
  assert.equal(cyc.currentSpent, 0, 'hit resets spend');

  const r = Bankroll.recommendStart({ minUnit: 10, archive: [record] });
  assert.notEqual(r.amount, null, 'archive with one real completion produces a number');
  assert.equal(r.worstDepth, 3);
  assert.ok(r.worstSpend > 0);
  assert.equal(r.amount, Math.ceil(r.worstSpend * 1.25 / 50) * 50);
  assert.ok(r.explanation.includes('worst'));
  console.log('archive-replay recommendation (real completed series): PASS');
}

// ---- Test 4b: replaySeriesCycle edge cases ----
{
  // Series never reached Final 8 (entrySpin still null) -> nothing to replay.
  assert.equal(Bankroll.replaySeriesCycle({ spinHistory: [1, 2, 3], entrySpin: null, finalEight: [] }), null);

  // Final 8 activated on the very last spin -> no closing-phase spins yet.
  assert.equal(Bankroll.replaySeriesCycle({ spinHistory: [1, 2, 3], entrySpin: 3, finalEight: [4, 5] }), null);

  // A record using `spins` instead of `spinHistory` (the field-name variance
  // the brief calls out) must be handled by the CALLER mapping r.spins ||
  // r.spinHistory, same as SeriesDB consumers elsewhere in this codebase —
  // worstFromArchive does this internally, so an archive record with only
  // `spins` set must still be replayed.
  const spinsFieldRecord = { endType: 'manual', spins: [10, 11, 9, 9, 2], finalEight: [2], entrySpin: 2 };
  const r = Bankroll.recommendStart({ minUnit: 1, archive: [spinsFieldRecord] });
  assert.notEqual(r.amount, null, '`spins` field (not spinHistory) is still picked up');
  console.log('replaySeriesCycle edge cases + spins/spinHistory field variance: PASS');
}

// ---- Test 5: snapshot records ("Save & Keep Counting") are excluded ----
{
  const snapshotOnly = [
    { machineId: 'm1', endType: 'snapshot', spinHistory: [1, 2, 3, 4, 5, 6, 7, 8, 9], finalEight: [1, 2], entrySpin: 2 },
  ];
  const r = Bankroll.recommendStart({ minUnit: 5, archive: snapshotOnly });
  assert.equal(r.amount, null, 'a snapshot-only archive must NOT produce a recommendation');
  console.log('snapshot records excluded from archive recommendation: PASS');
}

// ---- Test 6: no Task 3 sim constant is ever wired in as a source ----
{
  assert.equal(BTHG.CONSTANTS.TRINITY_WORST_SPEND_AT_1, undefined,
    'binding decision: the sim gate constant must not exist as a recommendation source');
  console.log('no TRINITY_WORST_SPEND_AT_1 constant present: PASS');
}

// ---- Test 7: resolveProfileForLimits ----
{
  const created = Bankroll.resolveProfileForLimits(null, { minUnit: 1, maxUnit: 50, name: 'Table 5', casino: 'Bellagio' });
  assert.equal(created.id, undefined, 'brand-new profile has no id yet (MachineProfiles.save mints one)');
  assert.equal(created.name, 'Table 5');
  assert.equal(created.minUnit, 1);
  assert.equal(created.maxUnit, 50);

  const existing = { id: 'm_abc123', name: 'Table 5', casino: 'Bellagio', minUnit: 1, maxUnit: 50, wheelLayout: [0, 1, 2], verifiedLayout: true };
  const updated = Bankroll.resolveProfileForLimits(existing, { minUnit: 2, maxUnit: 200 });
  assert.equal(updated.id, 'm_abc123', 'updating an existing profile preserves its id (in-place save, not a new profile)');
  assert.equal(updated.name, 'Table 5', 'preserves fields not being changed');
  assert.deepEqual(updated.wheelLayout, [0, 1, 2], 'preserves wheelLayout');
  assert.equal(updated.minUnit, 2);
  assert.equal(updated.maxUnit, 200);
  console.log('resolveProfileForLimits create/update: PASS');
}

// ---- Test 8: projectionLines ----
{
  const noLimits = Bankroll.projectionLines({});
  assert.ok(noLimits.guaranteedMinimum.toLowerCase().includes('table'));
  assert.equal(noLimits.live, null);

  const withLimits = Bankroll.projectionLines({ minUnit: 5, seriesAverage: 47 });
  assert.ok(withLimits.guaranteedMinimum.includes('$5'), 'guaranteed minimum line mentions the floor at this unit');
  assert.ok(withLimits.path.includes('3 closers banked'), 'per-series path line names the illustrative example');
  assert.ok(withLimits.path.includes('47 spins'), 'per-series path line includes the archived series average');
  assert.equal(withLimits.live, null, 'no live line when live is not passed at all');

  const notBettingYet = Bankroll.projectionLines({ minUnit: 5, seriesAverage: 47, live: { active: false } });
  assert.ok(notBettingYet.live.toLowerCase().includes('final 8'));

  const liveBetting = Bankroll.projectionLines({
    minUnit: 5, seriesAverage: 47,
    live: { active: true, currentLevel: 2, currentSpent: 40, worstDepth: 5, worstSpend: 900 },
  });
  assert.ok(liveBetting.live.includes('2 misses deep'));
  assert.ok(liveBetting.live.includes('$40'));
  assert.ok(liveBetting.live.includes('$900'));

  for (const line of [noLimits, withLimits, notBettingYet, liveBetting]) {
    for (const v of Object.values(line)) {
      if (typeof v === 'string') {
        assert.ok(!v.includes('–') && !v.includes('—'), `no em/en dashes: "${v}"`);
      }
    }
  }
  console.log('projectionLines (guaranteed minimum, path, live states): PASS');
}

// ---- Test 9: setBankroll re-baseline never shows a phantom loss ----
// Regression coverage for the brief's Step 4 ("changing bankroll never
// shows phantom loss") — no manual browser check available in this
// sandbox, so this drives the exact state transition the panel's Apply
// handler performs, directly against BankrollManager.
{
  const br = new BankrollManager(1000, 5, 35);
  // Simulate a losing stretch so sessionPnL is meaningfully negative.
  br.recordSpin(false, 10, 1);
  br.recordSpin(false, 10, 1);
  assert.ok(br.getSessionPnL() < 0, 'setup: bankroll is down for the session');

  const ok = br.setBankroll(2000);
  assert.equal(ok, true);
  assert.equal(br.totalBankroll, 2000);
  assert.equal(br.sessionStartBankroll, 2000, 're-baselines the session start too');
  assert.equal(br.peakBankroll, 2000, 're-baselines peak too');
  assert.equal(br.getSessionPnL(), 0, 'changing bankroll must never show a phantom loss');

  // Play again after re-baselining: P&L now measures against the NEW baseline only.
  br.recordSpin(false, 10, 1);
  assert.ok(br.getSessionPnL() < 0, 'a real loss after re-baselining still shows up');
  assert.ok(Math.abs(br.getSessionPnL()) < 100, 'but only reflects post-rebaseline play, not the old session');

  // Invalid amounts are rejected, not silently applied.
  const before = br.totalBankroll;
  assert.equal(br.setBankroll(-5), false);
  assert.equal(br.totalBankroll, before, 'negative amount is a no-op');
  assert.equal(br.setBankroll(NaN), false);
  assert.equal(br.totalBankroll, before, 'NaN amount is a no-op');

  console.log('setBankroll re-baseline (no phantom loss): PASS');
}

console.log('bankroll-reco: ALL PASS');
