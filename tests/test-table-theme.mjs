// tests/test-table-theme.mjs — Task 21: tracker-style table layout, blue felt
//
// This is a visual/layout recreation task (see .superpowers/sdd/task-21-brief.md),
// so most of it isn't headlessly testable (real cell rendering happens against
// a live `document`, which this repo's test harness doesn't provide — see
// tests/_load.mjs's header comment on why ui-shell.js/roulette-table.js are
// loaded standalone). What IS test-visible without a DOM:
//
//  1. The two pure render-helper methods added to RouletteTableUI for the
//     outside-bet row (_isDiamondLabel / _bandDisplayLabel) — same
//     "pure decision, no `this`/DOM dependency" pattern as the existing
//     _shouldTrackBet (see tests/test-series-fixes.mjs Test 4).
//  2. BTHG.TABLE_GRID's shape (3x12 grid, 3 dozens, 6 bands, 3 columns) and
//     the new bandDisplay map, which the table-building code depends on.
//  3. That the two new theme tokens (--felt: #104E85, --felt-dark: #10107A)
//     are actually defined, with the exact Brandon-specified hex values, in
//     ALL THREE themes in css/themes.css — the brief's most easily-forgotten
//     requirement ("same values in each"). This is plain text/regex checking
//     of the CSS source, not a DOM render, but it directly guards the one
//     concrete, machine-checkable deliverable the brief calls out by name.
//  4. That the table-surface CSS rules (felt background, grid cells, 2to1
//     cells, dozen/band cells, the 0/00 chip) actually reference the new
//     tokens instead of the old literal green gradient / var(--cell-bg) —
//     and that no rule reintroduces var(--green) inside the table.

import assert from 'node:assert/strict';
import { deepEqual } from 'node:assert'; // non-strict: BTHG.TABLE_GRID values cross the vm realm boundary (see test-ui-shell.mjs)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadBTHG } from './_load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themesCss = readFileSync(join(root, 'css/themes.css'), 'utf8');
const appCss = readFileSync(join(root, 'css/app.css'), 'utf8');

// ---- Test 1: _isDiamondLabel / _bandDisplayLabel are pure and correct ----
{
  const BTHG = loadBTHG(['js/utils.js', 'js/roulette-table.js']);
  const RT = BTHG.RouletteTableUI;

  assert.equal(typeof RT.prototype._isDiamondLabel, 'function', '_isDiamondLabel must exist on RouletteTableUI');
  assert.equal(typeof RT.prototype._bandDisplayLabel, 'function', '_bandDisplayLabel must exist on RouletteTableUI');

  // Diamond classification — only RED/BLACK render as a diamond shape;
  // every other bands label (including the reworded ones) stays text.
  assert.equal(RT.prototype._isDiamondLabel('RED'), true, 'RED renders as a diamond');
  assert.equal(RT.prototype._isDiamondLabel('BLACK'), true, 'BLACK renders as a diamond');
  for (const label of ['1-18', 'EVEN', 'ODD', '19-36']) {
    assert.equal(RT.prototype._isDiamondLabel(label), false, `${label} must NOT render as a diamond`);
  }

  // Display label rewording — brief wants "1 to 18" / "19 to 36" (matching
  // the reference image) while the underlying SIDE_BETS/sbKey stays
  // '1-18'/'19-36' for engine lookups. EVEN/ODD pass through unchanged.
  assert.equal(RT.prototype._bandDisplayLabel('1-18'), '1 to 18');
  assert.equal(RT.prototype._bandDisplayLabel('19-36'), '19 to 36');
  assert.equal(RT.prototype._bandDisplayLabel('EVEN'), 'EVEN', 'labels with no override pass through unchanged');
  assert.equal(RT.prototype._bandDisplayLabel('ODD'), 'ODD');
  // A label that isn't in TABLE_GRID.bands at all still falls back safely
  // (no throw, no undefined) rather than depending on bandDisplay always
  // having every possible key.
  assert.equal(RT.prototype._bandDisplayLabel('RED'), 'RED', 'labels with no display override pass through unchanged');

  console.log('_isDiamondLabel / _bandDisplayLabel pure render helpers: PASS');
}

// ---- Test 2: BTHG.TABLE_GRID shape the table-building code depends on ----
{
  const BTHG = loadBTHG(['js/utils.js']);
  const grid = BTHG.TABLE_GRID;

  assert.equal(grid.rows.length, 3, 'main grid must be 3 rows');
  grid.rows.forEach((row, i) => assert.equal(row.length, 12, `row ${i} must have 12 columns`));

  // Every number 1-36 appears exactly once across the 3x12 grid (no dupes,
  // nothing missing) — a cheap but real regression guard for the layout
  // this task recreates.
  const allNums = grid.rows.flat().sort((a, b) => a - b);
  deepEqual(allNums, Array.from({ length: 36 }, (_, i) => i + 1), 'grid must contain exactly 1-36, no dupes/gaps');

  deepEqual(grid.dozens, ['1st 12', '2nd 12', '3rd 12']);
  deepEqual(grid.bands, ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36']);
  assert.equal(grid.columns.length, 3, 'three 2to1 column-bet cells');

  // bandDisplay only overrides the two reworded labels — RED/BLACK/EVEN/ODD
  // are deliberately absent (RED/BLACK never reach the text path at all;
  // EVEN/ODD already match the image verbatim, no entry needed).
  deepEqual(Object.keys(grid.bandDisplay).sort(), ['1-18', '19-36']);

  console.log('BTHG.TABLE_GRID shape (3x12 + dozens/bands/columns/bandDisplay): PASS');
}

// ---- Test 3: --felt / --felt-dark defined with Brandon's exact hex values
//              in ALL THREE themes (css/themes.css) ----
{
  const themeBlockRe = /body\[data-theme="(casino|midnight|paper)"\]\s*\{([^}]*)\}/g;
  const seen = {};
  let m;
  while ((m = themeBlockRe.exec(themesCss)) !== null) {
    seen[m[1]] = m[2];
  }

  deepEqual(Object.keys(seen).sort(), ['casino', 'midnight', 'paper'], 'all three theme blocks must be present');

  for (const theme of ['casino', 'midnight', 'paper']) {
    const block = seen[theme];
    assert.match(block, /--felt:\s*#104E85\s*;/, `${theme} theme must define --felt: #104E85`);
    assert.match(block, /--felt-dark:\s*#10107A\s*;/, `${theme} theme must define --felt-dark: #10107A`);
  }

  console.log('--felt / --felt-dark tokens present with exact hex values in all 3 themes: PASS');
}

// ---- Test 4: table-surface CSS rules actually use the new tokens, and no
//              rule inside the table reintroduces var(--green) ----
{
  // Helper: pull a single top-level rule's body out of app.css by selector.
  function ruleBody(selector) {
    const re = new RegExp(selector.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const match = appCss.match(re);
    assert.ok(match, `selector "${selector}" must exist in css/app.css`);
    return match[1];
  }

  assert.match(ruleBody('.rt-felt'), /var\(--felt\)/, '.rt-felt background must use var(--felt)');
  assert.match(ruleBody('.rt-cell'), /var\(--felt\)/, '.rt-cell (main grid + zero cells) background must use var(--felt)');
  assert.match(ruleBody('.rt-col-btn'), /var\(--felt\)/, '.rt-col-btn (2to1 cells) background must use var(--felt)');
  assert.match(ruleBody('.rt-zeros-col .rt-cell'), /var\(--felt\)/, '.rt-zeros-col .rt-cell background must use var(--felt)');

  assert.match(ruleBody('.rt-dozen-cell'), /var\(--felt-dark\)/, '.rt-dozen-cell background must use var(--felt-dark)');
  assert.match(ruleBody('.rt-band-cell'), /var\(--felt-dark\)/, '.rt-band-cell background must use var(--felt-dark)');

  // The 0/00 chip (rt-oval-green, the class colorForNumber's 'green'
  // bucket maps to) must NOT be literal green — Brandon's project rule is
  // black/gold chrome, never green, and the Task 21 blue-felt carve-out
  // only covers --felt/--felt-dark, not a new green chip.
  const ovalGreenBody = ruleBody('.rt-oval-green');
  assert.doesNotMatch(ovalGreenBody, /var\(--green\)/, '.rt-oval-green must not use var(--green) — no green in the table');
  assert.match(ovalGreenBody, /var\(--felt-dark\)/, '.rt-oval-green (0/00 chip) must use var(--felt-dark)');

  // Old whole-cell RED/BLACK tint classes are gone — replaced by the
  // .rt-diamond shape approach.
  assert.doesNotMatch(appCss, /\.rt-band-red\s*\{/, 'old .rt-band-red whole-cell tint must be removed');
  assert.doesNotMatch(appCss, /\.rt-band-black\s*\{/, 'old .rt-band-black whole-cell tint must be removed');
  assert.match(appCss, /\.rt-diamond-red\s*\{[^}]*var\(--red\)/, '.rt-diamond-red must use the existing --red token');
  assert.match(appCss, /\.rt-diamond-black\s*\{[^}]*var\(--black\)/, '.rt-diamond-black must use the existing --black token');

  console.log('table-surface CSS rules use --felt/--felt-dark tokens, no green in the table: PASS');
}

console.log('table-theme: ALL PASS');
