// tests/test-intel-feed.mjs — Task 8: Intelligence feed (BTHG.IntelFeed)
//
// Covers the pure push/cap/dedup/setSignal/reset logic behind
// js/intel-feed.js using the same fake-document pattern as
// tests/test-ui-shell.mjs (makeClassList from _load.mjs) — real enough
// DOM stand-ins (innerHTML + classList) for the render() calls to run
// headlessly, without pulling in a real browser DOM.
//
// intel-feed.js is deliberately dependency-free (no utils.js/storage.js
// needed), unlike ui-shell.js, so it loads standalone here.

import assert from 'node:assert/strict';
import { loadBTHG, makeClassList } from './_load.mjs';

function makeFeedEl() {
  return { innerHTML: '', classList: makeClassList() };
}
function makeChipEl() {
  return { innerHTML: '', classList: makeClassList() };
}
function makeDoc(feedEl, chipEl) {
  return {
    getElementById(id) {
      if (id === 'intel-feed') return feedEl;
      if (id === 'ss-signal') return chipEl;
      return null;
    },
  };
}
function countCards(html) {
  return (html.match(/class="if-card"/g) || []).length;
}

// ---- Test 1: push() renders a card (icon, message, n=samples, timestamp) ----
{
  const feedEl = makeFeedEl();
  const chipEl = makeChipEl();
  const BTHG = loadBTHG(['js/intel-feed.js'], { extraGlobals: { document: makeDoc(feedEl, chipEl) } });

  assert.equal(typeof BTHG.IntelFeed, 'object', 'BTHG.IntelFeed must exist');
  assert.equal(typeof BTHG.IntelFeed.push, 'function');
  assert.equal(typeof BTHG.IntelFeed.setSignal, 'function');

  BTHG.IntelFeed.push({ kind: 'follower', message: '17 followed 5 within 3 spins in 6 of 6 times.', samples: 6 });

  assert.equal(countCards(feedEl.innerHTML), 1, 'one card rendered');
  assert.match(feedEl.innerHTML, /fa-link/, 'follower kind renders its mapped icon class');
  assert.match(feedEl.innerHTML, /17 followed 5 within 3 spins in 6 of 6 times\./, 'message text present');
  assert.match(feedEl.innerHTML, /n=6/, 'samples chip present as n=6');
  assert.match(feedEl.innerHTML, /if-card-time/, 'timestamp element present');

  console.log('push renders card (icon/message/samples/timestamp): PASS');
}

// ---- Test 2: dedup — same (kind, message) pushed twice yields one card ----
{
  const feedEl = makeFeedEl();
  const chipEl = makeChipEl();
  const BTHG = loadBTHG(['js/intel-feed.js'], { extraGlobals: { document: makeDoc(feedEl, chipEl) } });

  BTHG.IntelFeed.push({ kind: 'gap', message: '26 has been out 30 spins.', samples: 4 });
  BTHG.IntelFeed.push({ kind: 'gap', message: '26 has been out 30 spins.', samples: 4 });
  assert.equal(countCards(feedEl.innerHTML), 1, 'duplicate (kind, message) is not re-added');

  // Different message for the same kind is NOT a duplicate.
  BTHG.IntelFeed.push({ kind: 'gap', message: '9 has been out 31 spins.', samples: 2 });
  assert.equal(countCards(feedEl.innerHTML), 2, 'distinct message for same kind adds a new card');

  console.log('dedup by (kind, message): PASS');
}

// ---- Test 3: cap at 50 entries, newest-first ----
{
  const feedEl = makeFeedEl();
  const chipEl = makeChipEl();
  const BTHG = loadBTHG(['js/intel-feed.js'], { extraGlobals: { document: makeDoc(feedEl, chipEl) } });

  for (let i = 0; i < 60; i++) {
    BTHG.IntelFeed.push({ kind: 'cycle', message: `cycle alert #${i}`, samples: i });
  }
  assert.equal(countCards(feedEl.innerHTML), 50, 'feed caps at 50 entries');
  // Newest-first: alert #59 (pushed last) should render before (i.e. appear
  // earlier in the HTML string than) alert #10, and the oldest 10 (#0-#9)
  // must have been evicted.
  const idx59 = feedEl.innerHTML.indexOf('cycle alert #59');
  const idx10 = feedEl.innerHTML.indexOf('cycle alert #10');
  assert.ok(idx59 >= 0 && idx10 >= 0 && idx59 < idx10, 'newest entry (#59) renders before older entry (#10)');
  assert.ok(!feedEl.innerHTML.includes('cycle alert #9"') && !feedEl.innerHTML.includes('>cycle alert #9<'), 'oldest entries evicted past the 50 cap');

  console.log('cap at 50 entries, newest-first: PASS');
}

// ---- Test 4: setSignal() renders pinned banner + status-strip badge ----
{
  const feedEl = makeFeedEl();
  const chipEl = makeChipEl();
  const BTHG = loadBTHG(['js/intel-feed.js'], { extraGlobals: { document: makeDoc(feedEl, chipEl) } });

  BTHG.IntelFeed.setSignal({ state: 'BET', reason: 'Inside the historical entry window.' });
  assert.match(feedEl.innerHTML, /if-signal-banner/, 'pinned signal banner rendered in the feed');
  assert.match(feedEl.innerHTML, />BET</, 'banner shows BET state');
  assert.match(feedEl.innerHTML, /Inside the historical entry window\./, 'banner shows reason text');
  assert.match(chipEl.innerHTML, /BET/, 'status-strip badge mirrors the signal state');
  assert.ok(chipEl.classList.contains('ss-signal-bet'), 'status-strip badge gets a state-specific class');

  BTHG.IntelFeed.setSignal({ state: 'STOP', reason: 'Closing window is likely spent.' });
  assert.match(chipEl.innerHTML, /STOP/, 'status-strip badge updates to STOP');
  assert.ok(chipEl.classList.contains('ss-signal-stop'), 'stale ss-signal-bet class is replaced by ss-signal-stop');
  assert.ok(!chipEl.classList.contains('ss-signal-bet'), 'old state class removed');

  console.log('setSignal renders banner + status-strip badge: PASS');
}

// ---- Test 5: reset() clears entries + dedup memory + signal ----
{
  const feedEl = makeFeedEl();
  const chipEl = makeChipEl();
  const BTHG = loadBTHG(['js/intel-feed.js'], { extraGlobals: { document: makeDoc(feedEl, chipEl) } });

  BTHG.IntelFeed.push({ kind: 'follower', message: 'dup message', samples: 5 });
  BTHG.IntelFeed.setSignal({ state: 'HOLD', reason: 'No closing phase yet.' });
  assert.equal(countCards(feedEl.innerHTML), 1);

  BTHG.IntelFeed.reset();
  assert.equal(countCards(feedEl.innerHTML), 0, 'reset clears rendered cards');
  assert.match(feedEl.innerHTML, /intel-feed-empty/, 'reset restores the empty-state placeholder');

  // Dedup memory must also be cleared by reset() — the same (kind,
  // message) that was suppressed as a duplicate pre-reset must be
  // accepted as a fresh card post-reset (this is the "within the
  // current series" scoping the brief calls for).
  BTHG.IntelFeed.push({ kind: 'follower', message: 'dup message', samples: 5 });
  assert.equal(countCards(feedEl.innerHTML), 1, 'post-reset, a previously-seen (kind, message) is accepted again');

  console.log('reset clears entries, dedup memory, and signal: PASS');
}

console.log('intel-feed: ALL PASS');
