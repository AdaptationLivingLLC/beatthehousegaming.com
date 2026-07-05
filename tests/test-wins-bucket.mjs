// tests/test-wins-bucket.mjs — Task 23: the wins-bucket money model
// (brief rules 1-3), replacing the old ladder-based bankroll P&L flow for
// LIVE betting. Covers:
//   - BTHG.Bankroll.applyWinsBucketPayout (pure): every covered hit's full
//     payout lands in the wins bucket first; only the amount needed to top
//     the bankroll back up to its STARTING amount transfers back; the rest
//     stays in the bucket permanently; bankroll never exceeds starting.
//   - BankrollManager#winsBucket field + toJSON/fromJSON round trip
//     (additive — must not disturb existing serialized fields).
//
// Deliberately a NEW file, not appended to tests/test-bankroll-reco.mjs —
// that file's scope (recommendStart/projectionLines/replaySeriesCycle/
// worstFromArchive/resolveProfileForLimits) must keep passing untouched
// per the Task 23 brief.

import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const BTHG = loadBTHG(['js/utils.js', 'js/trinity.js', 'js/bankroll.js']);
const { Bankroll, BankrollManager } = BTHG;

// ---- Test 1: bankroll below starting — payout tops it up first, remainder
// stays in the wins bucket. -------------------------------------------------
{
  const r = Bankroll.applyWinsBucketPayout({ bankroll: 455, winsBucket: 0, startingBankroll: 500, payout: 180 });
  assert.equal(r.bankroll, 500, 'tops up exactly to starting, never past it');
  assert.equal(r.winsBucket, 135, 'remainder (180 - 45 needed) stays in the wins bucket');
  console.log('applyWinsBucketPayout: tops up to starting, keeps remainder: PASS');
}

// ---- Test 2: bankroll already AT starting — payout goes entirely to the
// wins bucket, none transfers (nothing needed). -----------------------------
{
  const r = Bankroll.applyWinsBucketPayout({ bankroll: 500, winsBucket: 135, startingBankroll: 500, payout: 200 });
  assert.equal(r.bankroll, 500, 'bankroll never exceeds starting even after a big win');
  assert.equal(r.winsBucket, 335, 'entire payout accumulates in the wins bucket');
  console.log('applyWinsBucketPayout: bankroll at/above starting keeps 100% of payout in bucket: PASS');
}

// ---- Test 3: payout smaller than the top-up need — the whole payout
// transfers into the bankroll, wins bucket gains nothing this time. --------
{
  const r = Bankroll.applyWinsBucketPayout({ bankroll: 470, winsBucket: 0, startingBankroll: 500, payout: 10 });
  assert.equal(r.bankroll, 480, 'entire payout transfers when it does not fully cover the gap');
  assert.equal(r.winsBucket, 0, 'wins bucket gains nothing this spin (gap not fully covered)');
  console.log('applyWinsBucketPayout: partial top-up when payout is smaller than the gap: PASS');
}

// ---- Test 4: bankroll deep underwater, wins bucket already holds enough to
// fully restore it — bucket funds the whole gap, bankroll hits starting
// exactly, bucket keeps the rest. This is the "wins bucket never funds bets,
// but DOES fund the top-up" case (brief rule 3). ---------------------------
{
  const r = Bankroll.applyWinsBucketPayout({ bankroll: 100, winsBucket: 1000, startingBankroll: 500, payout: 0 });
  assert.equal(r.bankroll, 500);
  assert.equal(r.winsBucket, 600);
  console.log('applyWinsBucketPayout: existing bucket balance alone can fund the top-up (payout=0): PASS');
}

// ---- Test 5: never produces a negative wins bucket or a bankroll above
// starting, across a small randomized sequence (property check). ----------
{
  let bankroll = 500, winsBucket = 0;
  const startingBankroll = 500;
  let bankrollNeverAboveStarting = true;
  let winsBucketNeverNegative = true;
  for (let i = 0; i < 200; i++) {
    // simulate a spin: a stake deduction, then sometimes a payout
    bankroll -= 15;
    const payout = (i % 3 === 0) ? 180 : 0;
    const r = Bankroll.applyWinsBucketPayout({ bankroll, winsBucket, startingBankroll, payout });
    bankroll = r.bankroll;
    winsBucket = r.winsBucket;
    if (bankroll > startingBankroll + 1e-9) bankrollNeverAboveStarting = false;
    if (winsBucket < -1e-9) winsBucketNeverNegative = false;
  }
  assert.ok(bankrollNeverAboveStarting, 'bankroll must never rise above startingBankroll');
  assert.ok(winsBucketNeverNegative, 'wins bucket must never go negative');
  console.log('applyWinsBucketPayout: bankroll capped + wins bucket non-negative over 200 spins: PASS');
}

// ---- Test 6: BankrollManager#winsBucket exists, defaults to 0, and round
// trips through toJSON/fromJSON additively (no disturbance to existing
// serialized fields). -------------------------------------------------------
{
  const b = new BankrollManager(500, 5, 35);
  assert.equal(b.winsBucket, 0, 'winsBucket defaults to 0');

  b.winsBucket = 135;
  b.totalBankroll = 500;
  const json = b.toJSON();
  assert.equal(json.winsBucket, 135);
  // existing fields still present (additive, not replaced)
  assert.equal(json.totalBankroll, 500);
  assert.equal(json.baseBet, 5);
  assert.equal(json.payoutRatio, 35);

  const b2 = new BankrollManager(1, 1, 1);
  b2.fromJSON(json);
  assert.equal(b2.winsBucket, 135);
  assert.equal(b2.totalBankroll, 500);

  // fromJSON on legacy data (no winsBucket field at all) must not crash and
  // must default to 0 — real archived sessions from before Task 23 have no
  // such field.
  const legacy = { totalBankroll: 200, baseBet: 5, payoutRatio: 35, sessionStartBankroll: 200 };
  const b3 = new BankrollManager(1, 1, 1);
  b3.fromJSON(legacy);
  assert.equal(b3.winsBucket, 0, 'legacy session data without winsBucket defaults to 0, no crash');
  console.log('BankrollManager#winsBucket: default + toJSON/fromJSON round trip + legacy-safe: PASS');
}

console.log('wins-bucket: ALL PASS');
