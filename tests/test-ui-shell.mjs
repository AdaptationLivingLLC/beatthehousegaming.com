// tests/test-ui-shell.mjs — Task 7: layout shell + themes (BTHG.UI)
//
// Covers the two pure, headlessly-testable pieces of js/ui-shell.js:
//   1. Theme cycling order (casino -> midnight -> paper -> casino) and
//      persistence through BTHG.Storage.Settings (survives a simulated
//      reload — a fresh vm load sharing the same localStorage backing).
//   2. applyLayout()'s device classification for the four layout body
//      classes, at the concrete viewport sizes called out in the task:
//      667x375 (iPhone 7 landscape), 375x667 (portrait -> rotate
//      prompt), 1024x768 (tablet split), plus a desktop-width size.
//
// ui-shell.js is loaded standalone from app.js on purpose (see its file
// header): app.js has a top-level document.addEventListener call that
// assumes a real DOM and can't load in this vm sandbox. Layout manager
// + theme cycle logic lives in js/ui-shell.js instead so it's testable
// here. Visual verification (does it actually look right on-device) is
// Task 14's job, not this file's.

import assert from 'node:assert/strict';
import { deepEqual } from 'node:assert'; // non-strict: THEMES array crosses the vm realm boundary
import { loadBTHG, makeLocalStorage, makeFakeDocument } from './_load.mjs';

// ---- Test 1: theme cycle order casino -> midnight -> paper -> casino ----
{
  const ls = makeLocalStorage();
  const doc = makeFakeDocument();
  const BTHG = loadBTHG(['js/utils.js', 'js/storage.js', 'js/ui-shell.js'], {
    localStorage: ls,
    extraGlobals: { document: doc },
  });

  assert.equal(typeof BTHG.UI, 'object', 'BTHG.UI must exist');
  deepEqual(BTHG.UI.THEMES, ['casino', 'midnight', 'paper']);

  doc.body.dataset.theme = 'casino';
  assert.equal(BTHG.UI.cycleTheme(), 'midnight', 'casino -> midnight');
  assert.equal(doc.body.dataset.theme, 'midnight');
  assert.equal(BTHG.UI.cycleTheme(), 'paper', 'midnight -> paper');
  assert.equal(doc.body.dataset.theme, 'paper');
  assert.equal(BTHG.UI.cycleTheme(), 'casino', 'paper -> casino (wraps)');
  assert.equal(doc.body.dataset.theme, 'casino');

  // No theme set yet at all -> treated as casino, so the first cycle
  // still lands on midnight (matches the "casino is the implicit start"
  // contract cycleTheme() documents).
  delete doc.body.dataset.theme;
  assert.equal(BTHG.UI.cycleTheme(), 'midnight', 'unset theme defaults to casino, cycles to midnight');

  console.log('theme cycle order: PASS');
}

// ---- Test 2: theme persists via Storage.Settings across a reload ----
{
  const ls = makeLocalStorage(); // shared "disk" across two separate loads
  const doc1 = makeFakeDocument();
  const BTHG1 = loadBTHG(['js/utils.js', 'js/storage.js', 'js/ui-shell.js'], {
    localStorage: ls,
    extraGlobals: { document: doc1 },
  });

  doc1.body.dataset.theme = 'casino';
  BTHG1.UI.cycleTheme(); // -> midnight
  BTHG1.UI.cycleTheme(); // -> paper
  assert.equal(doc1.body.dataset.theme, 'paper');

  const saved = JSON.parse(ls.getItem('bthg_settings'));
  assert.equal(saved.theme, 'paper', 'Settings.save persisted the new theme');

  // Simulate a page reload: fresh vm context, fresh <body>, SAME
  // localStorage backing. restoreTheme() must read the persisted value.
  const doc2 = makeFakeDocument();
  const BTHG2 = loadBTHG(['js/utils.js', 'js/storage.js', 'js/ui-shell.js'], {
    localStorage: ls,
    extraGlobals: { document: doc2 },
  });
  assert.equal(doc2.body.dataset.theme, undefined, 'fresh body starts with no theme set');
  assert.equal(BTHG2.UI.restoreTheme(), 'paper', 'restoreTheme reads the persisted choice');
  assert.equal(doc2.body.dataset.theme, 'paper');

  // A never-saved / pre-Task-7 settings blob (theme: 'classic') must
  // fall back to 'casino', not blow up or stick with an invalid value.
  const lsFresh = makeLocalStorage();
  const doc3 = makeFakeDocument();
  const BTHG3 = loadBTHG(['js/utils.js', 'js/storage.js', 'js/ui-shell.js'], {
    localStorage: lsFresh,
    extraGlobals: { document: doc3 },
  });
  assert.equal(BTHG3.UI.restoreTheme(), 'casino', 'default/legacy theme value falls back to casino');

  console.log('theme persistence via Storage.Settings: PASS');
}

// ---- Test 3: applyLayout() viewport classification ----
{
  const doc = makeFakeDocument();
  const BTHG = loadBTHG(['js/utils.js', 'js/storage.js', 'js/ui-shell.js'], {
    extraGlobals: { document: doc, innerWidth: 0, innerHeight: 0 },
  });
  const sandbox = BTHG.__sandbox;

  function classify(w, h) {
    sandbox.innerWidth = w;
    sandbox.innerHeight = h;
    BTHG.UI.applyLayout();
    const classes = ['layout-phone-land', 'layout-phone-port', 'layout-tablet', 'layout-desktop']
      .filter(c => doc.body.classList.contains(c));
    assert.equal(classes.length, 1, `exactly one layout class for ${w}x${h}, got [${classes}]`);
    return classes[0];
  }

  assert.equal(classify(667, 375), 'layout-phone-land', 'iPhone 7 landscape (667x375)');
  assert.equal(classify(375, 667), 'layout-phone-port', 'iPhone 7 portrait (375x667) -> rotate prompt');
  assert.equal(classify(1024, 768), 'layout-tablet', 'iPad split (1024x768)');
  assert.equal(classify(1920, 1080), 'layout-desktop', 'desktop width (1920x1080)');

  // Switching sizes must swap the class, not accumulate stale ones —
  // re-check after the desktop call above that only ONE class survives
  // (classify() already asserts this each call, but drive it through a
  // full phone -> tablet -> phone cycle once more for good measure).
  assert.equal(classify(667, 375), 'layout-phone-land', 'back to phone-land after desktop, no stale classes');

  console.log('applyLayout viewport classification: PASS');
}

console.log('ui-shell: ALL PASS');
