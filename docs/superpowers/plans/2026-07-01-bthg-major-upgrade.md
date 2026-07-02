# BTHG Major Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remodel the BTHG web app: responsive pro UI with themes, stealth iMessage screen, machine profiles with wheel verification, computed cap-aware Trinity (simulation-verified never-negative), pattern engine over archived series, series-end persistence, calibrator fix, bankroll manager.

**Architecture:** Vanilla JS IIFE modules on `window.BTHG` (existing pattern), no build step, deployed by pushing `main` to GitHub (Vercel auto-deploy). New modules use a UMD wrapper so Node tests can import them. Existing regression suite `npm test` (tests/test-all.cjs, 298 tests) must stay green after every task.

**Tech Stack:** Vanilla JS, CSS custom properties, localStorage + IndexedDB (existing `js/storage.js`), Node 20 for tests.

## Global Constraints

- No dashes in any user-facing copy; plain everyday punctuation only (Brandon's standing rule).
- No framework, no build step, no new npm dependencies.
- Every task ends with `npm test` green (298 existing tests) plus that task's new tests.
- Spec: `docs/superpowers/specs/2026-07-01-bthg-major-upgrade-design.md`.
- Table limits are user-entered per machine: min unit >= $0.25, max unit <= $1,500.
- Coverage set = Final 8 + 0 + 00 = 10 straight-up numbers, payout 35:1.
- `37` encodes `00` throughout the engine; display must always translate.
- git author already configured repo-local (Brandon Bible / bthgjustwin@gmail.com).

**UMD wrapper used by every NEW module (referenced by tasks as "the UMD wrapper"):**

```js
(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  // module body; return the exported object and also attach it to BTHG
});
```

**Node test harness pattern (referenced as "the node test pattern"):** plain `.mjs` file using `node:assert/strict`, run with `node tests/<file>.mjs`; before importing engine IIFE files it sets `globalThis.window = globalThis` and loads dependencies in app.html order via `await import('../js/utils.js')` etc. New UMD modules are imported directly with `createRequire`.

---

### Task 1: Machine profile module

**Files:**
- Create: `js/machine-profile.js`
- Create: `tests/test-machine-profile.mjs`
- Modify: `app.html:90` (add `<script src="js/machine-profile.js"></script>` after storage.js)

**Interfaces:**
- Produces: `BTHG.MachineProfiles` with:
  - `list() -> Profile[]`
  - `get(id) -> Profile|null`
  - `save(profile) -> Profile` (assigns `id` if missing, persists)
  - `remove(id)`
  - `getActive() -> Profile|null`, `setActive(id)`
  - `Profile = { id, name, casino, minUnit, maxUnit, wheelLayout: number[]|null, verifiedLayout: boolean, createdAt }`
  - `AMERICAN_LAYOUT` constant: `[37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1]` (starting at 00=37, going right)

- [ ] **Step 1: Write failing test** (`tests/test-machine-profile.mjs`, node test pattern)

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.localStorage = (() => { let s={}; return {
  getItem:k=>s[k]??null, setItem:(k,v)=>{s[k]=String(v)}, removeItem:k=>{delete s[k]} };})();
const MP = require('../js/machine-profile.js');

assert.equal(MP.AMERICAN_LAYOUT.length, 38);
assert.equal(new Set(MP.AMERICAN_LAYOUT).size, 38);
const p = MP.save({ name:'Del Sol 1', casino:'Del Sol', minUnit:0.25, maxUnit:50 });
assert.ok(p.id);
assert.equal(MP.get(p.id).name, 'Del Sol 1');
MP.setActive(p.id);
assert.equal(MP.getActive().id, p.id);
assert.deepEqual(MP.getActive().wheelLayout, MP.AMERICAN_LAYOUT);
assert.throws(() => MP.save({ name:'x', minUnit:0.1, maxUnit:50 }));   // min < 0.25
assert.throws(() => MP.save({ name:'x', minUnit:1, maxUnit:2000 }));   // max > 1500
MP.remove(p.id);
assert.equal(MP.get(p.id), null);
console.log('machine-profile: ALL PASS');
```

- [ ] **Step 2: Run** `node tests/test-machine-profile.mjs` — expect FAIL (module not found).

- [ ] **Step 3: Implement `js/machine-profile.js`** with the UMD wrapper:

```js
(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  const KEY = 'bthg_machines';
  const ACTIVE_KEY = 'bthg_active_machine';
  const AMERICAN_LAYOUT = [37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1];

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function writeAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  const MachineProfiles = {
    AMERICAN_LAYOUT,
    list: readAll,
    get(id) { return readAll().find(p => p.id === id) || null; },
    save(profile) {
      if (!(profile.minUnit >= 0.25)) throw new Error('Table minimum betting unit must be $0.25 or more');
      if (!(profile.maxUnit <= 1500)) throw new Error('Table maximum betting unit must be $1,500 or less');
      if (profile.minUnit > profile.maxUnit) throw new Error('Minimum unit cannot exceed maximum unit');
      const list = readAll();
      if (!profile.id) {
        profile.id = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        profile.createdAt = new Date().toISOString();
      }
      if (!profile.wheelLayout) { profile.wheelLayout = AMERICAN_LAYOUT.slice(); profile.verifiedLayout = false; }
      const i = list.findIndex(p => p.id === profile.id);
      if (i >= 0) list[i] = profile; else list.push(profile);
      writeAll(list);
      return profile;
    },
    remove(id) { writeAll(readAll().filter(p => p.id !== id));
      if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY); },
    setActive(id) { localStorage.setItem(ACTIVE_KEY, id); },
    getActive() { return this.get(localStorage.getItem(ACTIVE_KEY)); },
  };
  BTHG.MachineProfiles = MachineProfiles;
  return MachineProfiles;
});
```

- [ ] **Step 4: Run** `node tests/test-machine-profile.mjs` — expect `machine-profile: ALL PASS`. Run `npm test` — expect 298/298.
- [ ] **Step 5:** Add the script tag to `app.html` after the storage.js line. Commit: `feat: machine profile store with table limits and wheel layout`

---

### Task 2: Trinity engine (computed, cap-aware)

**Files:**
- Create: `js/trinity.js`
- Create: `tests/test-trinity.mjs`
- Modify: `app.html` (script tag after machine-profile.js)

**Interfaces:**
- Produces: `BTHG.TrinityEngine` class:
  - `new TrinityEngine({minUnit, maxUnit, coverage=10, payout=35, floorUnits=1})`
  - `nextBet() -> {perNumber, total, screens, perScreen, cycleSpend, level}` (bet REQUIRED on the upcoming spin)
  - `recordMiss()` (adds `nextBet().total` to cycle spend)
  - `recordHit() -> {net, spent}` (net >= floor guaranteed; resets cycle)
  - `reset()`; property `spent`
- Math (from spec): win nets `(payout+1-coverage) * perNumber - spentBefore` wait, exact: hit returns `36*perNumber`; spend that spin `coverage*perNumber`; guarantee `36b - (spentBefore + 10b) >= floor` → `26b >= spentBefore + floor` → `perNumber = roundUpToIncrement((spentBefore + floor) / 26, minUnit)`, minimum `minUnit`. Increment = minUnit. floor = floorUnits*minUnit.
- Cap: `screens = Math.ceil(perNumber / maxUnit)`; `perScreen = roundUpToIncrement(perNumber/screens, 0.25)`.

- [ ] **Step 1: Write failing test** (`tests/test-trinity.mjs`):

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TrinityEngine } = require('../js/trinity.js');

// Never-negative walkthrough: $1 unit, 10 numbers, floor $1
const t = new TrinityEngine({ minUnit: 1, maxUnit: 50 });
for (let miss = 0; miss < 25; miss++) {
  const bet = t.nextBet();
  assert.ok(bet.perNumber >= 1);
  // guarantee: a hit on this spin nets >= floor
  const net = 36 * bet.perNumber - (t.spent + 10 * bet.perNumber);
  assert.ok(net >= 1, `depth ${miss}: net ${net}`);
  t.recordMiss();
}
// cap alert: perNumber will exceed $50 at depth; screens must split correctly
const deep = t.nextBet();
assert.ok(deep.screens >= 2);
assert.ok(deep.perScreen <= 50);
assert.ok(deep.perScreen * deep.screens >= deep.perNumber);

// hit resets and reports true net
const t2 = new TrinityEngine({ minUnit: 1, maxUnit: 50 });
t2.recordMiss(); t2.recordMiss();               // 2 misses at $1 = $20 spent
const r = t2.recordHit();
assert.ok(r.net >= 1);
assert.equal(t2.spent, 0);

// quarter table: increments respect $0.25
const q = new TrinityEngine({ minUnit: 0.25, maxUnit: 50 });
q.recordMiss(); q.recordMiss(); q.recordMiss(); q.recordMiss();
const b = q.nextBet();
assert.equal(Math.round(b.perNumber * 100) % 25, 0);
console.log('trinity: ALL PASS');
```

- [ ] **Step 2: Run** `node tests/test-trinity.mjs` — FAIL (module not found).
- [ ] **Step 3: Implement `js/trinity.js`** (UMD wrapper):

```js
(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  function roundUpTo(value, inc) { return Math.ceil((value - 1e-9) / inc) * inc; }

  class TrinityEngine {
    constructor({ minUnit, maxUnit, coverage = 10, payout = 35, floorUnits = 1 }) {
      this.minUnit = minUnit; this.maxUnit = maxUnit;
      this.coverage = coverage; this.payout = payout;
      this.floor = floorUnits * minUnit;
      this.spent = 0; this.level = 0;
      // net-per-unit on a hit: payout+1 returned minus the covered stakes
      this.netPerUnit = (payout + 1) - coverage;   // 26 for 10-number coverage
    }
    nextBet() {
      let perNumber = roundUpTo((this.spent + this.floor) / this.netPerUnit, this.minUnit);
      if (perNumber < this.minUnit) perNumber = this.minUnit;
      const screens = Math.max(1, Math.ceil(perNumber / this.maxUnit));
      const perScreen = roundUpTo(perNumber / screens, 0.25);
      return { perNumber, total: perNumber * this.coverage, screens, perScreen,
               cycleSpend: this.spent, level: this.level };
    }
    recordMiss() { this.spent += this.nextBet().total; this.level++; }
    recordHit() {
      const bet = this.nextBet();
      const spentTotal = this.spent + bet.total;
      const net = (this.payout + 1) * bet.perNumber - spentTotal;
      this.reset();
      return { net, spent: spentTotal };
    }
    reset() { this.spent = 0; this.level = 0; }
  }
  BTHG.TrinityEngine = TrinityEngine;
  return { TrinityEngine };
});
```

- [ ] **Step 4: Run** the test — ALL PASS. `npm test` — 298/298.
- [ ] **Step 5:** Add script tag to app.html. Commit: `feat: computed cap-aware Trinity engine with guaranteed floor recovery`

---

### Task 3: Trinity simulation gate

**Files:**
- Create: `tests/simulate-trinity.mjs`

**Interfaces:**
- Consumes: `TrinityEngine` from Task 2.
- Produces: `runSimulation({series, minUnit, maxUnit}) -> {cycles, worstDepth, worstCycleSpend, minNet, ledgerOk, splitAlerts}` exported for Task 9 (recommended bankroll) and stealth bubbles (Task 11). Also runs as a script: `node tests/simulate-trinity.mjs` prints a report and exits nonzero on any assertion failure.

- [ ] **Step 1: Write `tests/simulate-trinity.mjs`:**

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TrinityEngine } = require('../js/trinity.js');

export function simulateSeries(spins, coverageSet, { minUnit, maxUnit }) {
  const t = new TrinityEngine({ minUnit, maxUnit });
  let cash = 0, worstDepth = 0, worstCycleSpend = 0, minNet = Infinity, splitAlerts = 0, cycles = 0;
  for (const n of spins) {
    const bet = t.nextBet();
    if (bet.screens > 1) splitAlerts++;
    if (coverageSet.has(n)) {
      const r = t.recordHit();
      cash += r.net; cycles++;
      if (r.net < minNet) minNet = r.net;
    } else {
      t.recordMiss();
      cash -= bet.total;
      if (t.level > worstDepth) worstDepth = t.level;
      if (t.spent > worstCycleSpend) worstCycleSpend = t.spent;
    }
  }
  return { cash, cycles, worstDepth, worstCycleSpend, minNet, splitAlerts, openSpend: t.spent };
}

function fairSpin() { return Math.floor(Math.random() * 38); } // 37 = 00

if (import.meta.url === `file://${process.argv[1]}`) {
  const coverage = new Set([1, 4, 7, 11, 13, 19, 30, 32, 0, 37]); // series-2 real Final 8 + 0/00
  let globalWorst = 0, globalWorstSpend = 0;
  for (let s = 0; s < 10000; s++) {
    const spins = Array.from({ length: 200 }, fairSpin);
    const r = simulateSeries(spins, coverage, { minUnit: 1, maxUnit: 50 });
    // ASSERTION (a): every closed cycle nets >= floor ($1)
    if (r.cycles > 0) assert.ok(r.minNet >= 1, `sim ${s}: cycle closed below floor: ${r.minNet}`);
    // ASSERTION (b): ledger consistency: cash = sum(nets) - openSpend
    if (r.worstDepth > globalWorst) globalWorst = r.worstDepth;
    if (r.worstCycleSpend > globalWorstSpend) globalWorstSpend = r.worstCycleSpend;
  }
  console.log(`10,000 series OK. worst depth ${globalWorst} misses, worst single-cycle spend $${globalWorstSpend.toFixed(2)} at $1 unit`);
  console.log('EVERY hit at EVERY depth ended its cycle at +$1 or better.');
}
```

- [ ] **Step 2: Run** `node tests/simulate-trinity.mjs` — expect the OK report (this is the mandatory ship gate; record the worst-depth and worst-spend numbers in the commit message, they feed the recommended-bankroll math and the stealth bubbles).
- [ ] **Step 3:** Add ledger cross-check inside the loop: track `sumNets` and assert `Math.abs(cash - (sumNets - openSpend)) < 0.01` per series. Re-run — OK.
- [ ] **Step 4:** Add `"simulate": "node tests/simulate-trinity.mjs"` to package.json scripts. Commit: `test: Trinity never-negative simulation gate (10k series)`

---

### Task 4: Engine data-integrity fixes

**Files:**
- Modify: `js/roulette-table.js:373-380` (win detection — the uncommitted fix already in the working tree, keep it)
- Modify: `js/series-engine.js` (auto-close reset ~line 220 and 398; `lifetimeSpins`; `finalEightAges`/`finalEightFirstHit`)
- Modify: `js/bankroll.js` (decouple P&L logging from `bettingEnabled`)
- Create: `tests/test-series-fixes.mjs`

**Interfaces:**
- Consumes: `SeriesEngine` (existing).
- Produces: after auto-close, `engine.history.length === 0` and `engine.totalSpins === 0`; `engine.lifetimeSpins === seriesHistory sum + live totalSpins` always; `finalEightAges` populated per spin while `finalActivated`; bankroll `winCount/lossCount/totalWagered` update whenever a Trinity bet is tracked, regardless of `bettingEnabled`.

- [ ] **Step 1: Write failing test** (node test pattern loading utils.js, storage stub, series-engine.js in order):

```js
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };
await import('../js/utils.js');
await import('../js/series-engine.js');
const engine = new window.BTHG.SeriesEngine();
// drive spins until finalActivated, then complete the series (hit all Final 8)
// exact driver: engine.recordSpin(n) for a scripted sequence that activates and closes
// ... feed engine.finalEight copies until seriesComplete fires with endType 'auto'
assert.equal(engine.history.length, 0, 'history must clear on auto-close');
assert.equal(engine.totalSpins, 0, 'totalSpins must reset on auto-close');
assert.equal(engine.lifetimeSpins, engine.seriesHistory.reduce((a,b)=>a+b,0));
console.log('series-fixes: ALL PASS');
```

(The scripted sequence: record 30 distinct numbers to trigger Final 8 activation per existing activation rule in series-engine.js ~line 180, then record each member of `engine.finalEight` until auto-close. Read the activation rule while implementing and encode it exactly.)

- [ ] **Step 2: Run** — FAIL (history carries over; this is the confirmed real-export bug).
- [ ] **Step 3: Fix `series-engine.js`:** in the auto-close path (where `seriesHistory.push(this.totalSpins)` runs at ~line 220), after archiving: `this.history = []; this.totalSpins = 0;` and re-derive `this.lifetimeSpins = this.seriesHistory.reduce((a,b)=>a+b,0);`. In `recordSpin`, while `finalActivated`, update `this.finalEightAges[n] = (this.finalEightAges[n] || 0) + 1` for unhit members and push first-hit spins to `finalEightFirstHit`.
- [ ] **Step 4: Fix `bankroll.js`:** find every `if (this.bettingEnabled)` guard around `winCount`/`lossCount`/`totalWagered` and split tracking (always) from bet-sizing UI (guarded).
- [ ] **Step 5: Run** new test + `npm test` — all green. Commit staged working-tree fixes TOGETHER with this task: `fix: series auto-close reset, lifetimeSpins, finalEightAges, P&L decoupling, 0/00 win detection`

---

### Task 5: Series-end persistence (keep board, archive on demand)

**Files:**
- Modify: `js/roulette-table.js` (series-complete handler ~line 545-560, `endType: 'auto'` block)
- Modify: `js/app.js` (series complete overlay)
- Modify: `js/storage.js` (SeriesDB record gains `machineId`, `closerOffsets`, `entrySpin` fields)

**Interfaces:**
- Produces: on series end, board freezes (CSS class `series-complete` on the table container, banner element `#series-complete-banner` with buttons `#btn-new-series`, `#btn-keep-reviewing`). `SeriesDB.save(record)` called ONLY when New Series is pressed. Freeze state survives reload (persist `bthg_frozen_series` snapshot in localStorage until New Series).

- [ ] **Step 1:** In the auto/manual end handler, REMOVE the immediate reset. Instead: set `this.frozen = true`, add the banner:

```js
showSeriesCompleteBanner(endType) {
  this.frozen = true;
  this.container.classList.add('series-complete');
  const banner = document.createElement('div');
  banner.id = 'series-complete-banner';
  banner.innerHTML = `
    <span class="scb-title">SERIES COMPLETE (${endType === 'auto' ? 'CLOSED' : 'MANUAL'})</span>
    <button id="btn-new-series">New Series</button>
    <button id="btn-keep-reviewing">Keep Reviewing</button>`;
  this.container.prepend(banner);
  banner.querySelector('#btn-new-series').onclick = () => this.archiveAndReset(endType);
  banner.querySelector('#btn-keep-reviewing').onclick = () => banner.classList.add('scb-collapsed');
}
archiveAndReset(endType) {
  const record = this.engine.getSeriesDataForSave(endType, null,
    BTHG.MachineProfiles.getActive()?.id || null,
    BTHG.MachineProfiles.getActive()?.casino || '');
  record.closerOffsets = this.engine.finalEightFirstHit.map(s => s - record.entrySpin);
  BTHG.Storage.SeriesDB.save(record);
  localStorage.removeItem('bthg_frozen_series');
  this.engine.resetSeries();       // full reset happens HERE and only here
  this.container.classList.remove('series-complete');
  document.getElementById('series-complete-banner')?.remove();
  this.update();
}
```

While frozen, `recordNumber()` returns early (no spins register until New Series or Keep Reviewing; Keep Reviewing un-freezes input but keeps the banner collapsed as a pill).
- [ ] **Step 2:** CSS: `.series-complete .rt-cell { filter: grayscale(0.35) brightness(0.9); }` banner styled per active theme. Persist/restore the frozen snapshot on load.
- [ ] **Step 3:** Manual browser test with `python3 -m http.server 8080` in repo root: run a manual end, verify board keeps all counters, both buttons behave, reload keeps frozen board.
- [ ] **Step 4:** `npm test` green. Commit: `feat: series end freezes board; archive+reset only on New Series`

---

### Task 6: Pattern engine

**Files:**
- Create: `js/pattern-engine.js`
- Create: `tests/test-pattern-engine.mjs`
- Modify: `app.html` (script tag)

**Interfaces:**
- Consumes: archived series records (`{spins:[{n}...], entrySpin, closerOffsets}`), live spins array, `wheelLayout` from active machine profile.
- Produces: `BTHG.PatternEngine.analyze({archive, liveSpins, layout, finalActivated, closersHit}) -> {alerts:[{kind, message, samples, strength}], entry:{state:'BET'|'HOLD'|'STOP', reason}}`
  - kinds: `'follower'`, `'gap'`, `'cycle'`
  - Every message includes its sample count. Chance baseline for a specific follower within 3 spins: `1 - (37/38)**3 ≈ 0.0766`.

- [ ] **Step 1: Write failing test** using the real Series 2 data (spins listed inline in the test; closer offsets known: +4,+9,+14,+19,+26,+35,+45,+60 from entry spin 42):

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PE = require('../js/pattern-engine.js');

// synthetic archive engineered so 17 follows 5 within 3 spins in 6 of 6 occurrences
const spinsA = [5,17,2,8, 5,1,17,9, 5,17,30,4, 5,2,17,6, 5,17,8,3, 5,9,2,17];
const archive = [{ spins: spinsA.map(n=>({n})), entrySpin: 0, closerOffsets: [4,9,14,19] }];
const out = PE.analyze({ archive, liveSpins: [5], layout: null, finalActivated: false, closersHit: 0 });
const f = out.alerts.find(a => a.kind === 'follower' && /17/.test(a.message));
assert.ok(f, 'expected follower alert for 5 -> 17');
assert.ok(f.samples >= 6);

// gap detector: number 26 out 65+, resolved fast every time historically
const gapArchive = [];
for (let s = 0; s < 4; s++) {
  const spins = [];
  for (let i = 0; i < 66; i++) spins.push({ n: i % 2 ? 1 : 2 });   // 26 absent 66 spins
  spins.push({ n: 26 });                                            // resolves at 67
  gapArchive.push({ spins, entrySpin: 0, closerOffsets: [] });
}
const live = Array(65).fill(0).map((_,i)=>i%2?1:2);
const g = PE.analyze({ archive: gapArchive, liveSpins: live, layout: null, finalActivated:false, closersHit:0 })
  .alerts.find(a => a.kind === 'gap' && /26/.test(a.message));
assert.ok(g, 'expected gap alert for 26');
assert.equal(g.samples, 4);

// entry signal seed rules
assert.equal(PE.analyze({archive:[],liveSpins:[],layout:null,finalActivated:true, closersHit:0}).entry.state, 'BET');
assert.equal(PE.analyze({archive:[],liveSpins:[],layout:null,finalActivated:true, closersHit:3}).entry.state, 'STOP');
assert.equal(PE.analyze({archive:[],liveSpins:[],layout:null,finalActivated:false,closersHit:0}).entry.state, 'HOLD');
console.log('pattern-engine: ALL PASS');
```

- [ ] **Step 2: Run** — FAIL. 
- [ ] **Step 3: Implement `js/pattern-engine.js`** (UMD). Core algorithms:

```js
// followers: for each occurrence of a, record which numbers land in next 1..3 spins.
// alert when pair (a,b): occurrences of a >= 5 AND rate(b within 3 after a) >= 2.5 * 0.0766
function followerAlerts(allSpins /* array of spin arrays */) {
  const CHANCE3 = 1 - Math.pow(37/38, 3);
  const occ = new Map(), pair = new Map();
  for (const spins of allSpins) {
    for (let i = 0; i < spins.length; i++) {
      const a = spins[i];
      occ.set(a, (occ.get(a) || 0) + 1);
      const seen = new Set();
      for (let j = i + 1; j <= Math.min(i + 3, spins.length - 1); j++) {
        const b = spins[j];
        if (seen.has(b)) continue; seen.add(b);
        const k = a + ':' + b;
        pair.set(k, (pair.get(k) || 0) + 1);
      }
    }
  }
  const alerts = [];
  for (const [k, count] of pair) {
    const [a, b] = k.split(':').map(Number);
    const n = occ.get(a);
    if (n >= 5 && count / n >= 2.5 * CHANCE3 && count >= Math.ceil(n * 0.5)) {
      alerts.push({ kind: 'follower', samples: n, strength: count / n,
        message: `${disp(b)} followed ${disp(a)} within 3 spins in ${count} of ${n} times.` });
    }
  }
  return alerts.sort((x, y) => y.strength - x.strength).slice(0, 5);
}
// gaps: current drought depth g for number x in liveSpins; find historical droughts of x
// reaching >= g across archive; report how many additional spins each took to resolve.
// cycle: compare live position to archived closerOffsets quartiles.
// entry: adaptive closersToBank(archive): largest k (1..4) such that in >= 75% of archived
// series with >= k closers, the k-th closer offset <= 20; fallback 3 when archive < 3 series.
function disp(n) { return n === 37 ? '00' : String(n); }
```

Full file assembles: `analyze({archive, liveSpins, layout, finalActivated, closersHit})` runs the three detectors over `archive.map(r=>r.spins.map(s=>s.n)).concat([liveSpins])` (followers), archive vs live (gaps for every number whose live gap >= 30), archive closerOffsets (cycle), and the entry rule. `layout` reserved for neighbor weighting: when provided, follower messages append wheel distance `(${dist} pockets apart on this wheel)` computed from index distance in the layout array.

- [ ] **Step 4: Run** test — ALL PASS. `npm test` green.
- [ ] **Step 5:** Commit: `feat: pattern engine (followers, gaps, cycle timing, adaptive entry signal)`

---

### Task 7: Layout shell + themes

**Files:**
- Create: `css/themes.css`
- Modify: `app.html` (link themes.css before app.css; layout script)
- Modify: `js/app.js` (layout manager + theme cycle button in status strip)
- Modify: `css/app.css` (new layout blocks; convert hardcoded colors in table cells, panels, buttons, status strip to var() tokens)

**Interfaces:**
- Produces: `<body data-theme="casino|midnight|paper" class="layout-phone-land|layout-phone-port|layout-tablet|layout-desktop">`. `BTHG.UI.applyLayout()` and `BTHG.UI.cycleTheme()`. Theme persists via existing `Storage.Settings` (`settings.theme`). Elements: `#status-strip` (spin count, series state, bankroll, trinity level, theme button `#btn-theme`, stealth button `#btn-stealth` added in Task 11), `#intel-feed` container (tablet/desktop).

- [ ] **Step 1: `css/themes.css`** token sets:

```css
body[data-theme="casino"]  { --bg:#0a1f10; --surface:#122b18; --line:#2c4a33;
  --text:#f4efe1; --muted:#9fb3a4; --accent:#d4af37; --accent2:#5EFF00;
  --red:#c8362e; --black:#171717; --green:#0f6b2f; --win:#5EFF00; --loss:#ff4444; }
body[data-theme="midnight"]{ --bg:#0b0d12; --surface:#14171f; --line:#242a36;
  --text:#d7dce6; --muted:#7c8494; --accent:#5b8cff; --accent2:#37d67a;
  --red:#a03030; --black:#101014; --green:#1d4d33; --win:#37d67a; --loss:#e05555; }
body[data-theme="paper"]   { --bg:#f5f4f0; --surface:#ffffff; --line:#d8d5cc;
  --text:#22221f; --muted:#77746a; --accent:#3b5bdb; --accent2:#2b8a3e;
  --red:#c0392b; --black:#3a3a3a; --green:#2b8a3e; --win:#2b8a3e; --loss:#c0392b; }
```

- [ ] **Step 2: Layout manager** in app.js (called on load, `resize`, `orientationchange`):

```js
const UI = BTHG.UI = {
  applyLayout() {
    const w = innerWidth, h = innerHeight, phone = Math.min(w, h) <= 480;
    document.body.classList.remove('layout-phone-land','layout-phone-port','layout-tablet','layout-desktop');
    document.body.classList.add(
      phone ? (w > h ? 'layout-phone-land' : 'layout-phone-port')
            : (w <= 1366 ? 'layout-tablet' : 'layout-desktop'));
  },
  THEMES: ['casino','midnight','paper'],
  cycleTheme() {
    const cur = document.body.dataset.theme || 'casino';
    const next = this.THEMES[(this.THEMES.indexOf(cur) + 1) % 3];
    document.body.dataset.theme = next;
    const s = BTHG.Storage.Settings.load(); s.theme = next; BTHG.Storage.Settings.save(s);
  },
};
```

- [ ] **Step 3: Layout CSS** in app.css:

```css
body.layout-phone-land #table-container { position:fixed; inset:28px 0 0 0; }
body.layout-phone-land .rt-cell { min-width:48px; min-height:48px; font-size:1.05rem; }
body.layout-phone-land #status-strip { position:fixed; top:0; height:28px; width:100%;
  display:flex; gap:12px; align-items:center; font-size:0.72rem; background:var(--surface); }
body.layout-phone-port #rotate-prompt { display:flex; }   /* full-screen "Rotate your phone" overlay */
body.layout-phone-port #table-container { display:none; }
body.layout-tablet #app-root { display:grid; grid-template-rows: 33vh 1fr; height:100vh; }
body.layout-tablet #intel-feed { overflow-y:auto; background:var(--bg); }
body.layout-desktop #app-root { display:grid; grid-template-columns: 1fr 420px; height:100vh; }
```

Plus the token conversion pass: replace `#d4af37`, `#5EFF00`, `#ff3333`, panel/table background hexes in app.css with `var(--accent)`, `var(--win)`, `var(--loss)`, `var(--surface)` etc. (mechanical find/replace, verify visually per theme).
- [ ] **Step 4:** Theme button in status strip cycles all three live; choice survives reload. Manual check via `python3 -m http.server 8080` at 667x375 (iPhone 7 landscape), 375x667 (rotate prompt), 1024x768 (tablet split).
- [ ] **Step 5:** `npm test` green. Commit: `feat: responsive layout shell (phone landscape, tablet split, desktop) + 3 switchable themes`

---

### Task 8: Intelligence feed

**Files:**
- Create: `js/intel-feed.js`
- Modify: `js/roulette-table.js` (after each `recordNumber`, call feed update)
- Modify: `app.html` (`<div id="intel-feed"></div>` in app root + script tag)

**Interfaces:**
- Consumes: `PatternEngine.analyze(...)` output, Trinity state from Task 9 wiring.
- Produces: `BTHG.IntelFeed.push({kind, message, samples})` and `BTHG.IntelFeed.setSignal({state, reason})`. Renders newest-first cards into `#intel-feed`; the BET/HOLD/STOP signal renders as a pinned banner at the top of the feed AND as a compact badge in `#status-strip` (visible in phone landscape where the feed is hidden).

- [ ] **Step 1:** Implement render (cards: kind icon, message, `n=samples` chip, timestamp). Cap feed at 50 entries.
- [ ] **Step 2:** Wire: on every spin, `const res = PatternEngine.analyze({...}); res.alerts.forEach(IntelFeed.push); IntelFeed.setSignal(res.entry);` Deduplicate alerts already shown for the same (kind, message) within the current series.
- [ ] **Step 3:** Manual test: simulated spins produce cards on tablet layout and the badge updates in phone landscape. `npm test` green. Commit: `feat: live intelligence feed with pinned BET/HOLD/STOP signal`

---

### Task 9: Bankroll manager rebuild

**Files:**
- Modify: `js/app.js:1082-1140` (bankroll panel — extend the uncommitted inputs already present)
- Modify: `js/bankroll.js`
- Create: `tests/test-bankroll-reco.mjs`

**Interfaces:**
- Consumes: `MachineProfiles.getActive()` (limits), `simulateSeries` results (Task 3 numbers), archived series stats.
- Produces: panel fields `#br-set-bankroll`, `#br-set-bet` (exist), plus `#br-min-unit`, `#br-max-unit` (blank until filled, labeled "Table minimum betting unit" and "Table maximum betting unit", validation $0.25 to $1,500, saved to active machine profile). `BTHG.Bankroll.recommendStart({minUnit, archive}) -> {amount, worstDepth, worstSpend, explanation}`. Projection block `#br-projection`.

- [ ] **Step 1: Failing test** for the recommendation math:

```js
// recommendStart: worst archived/simulated cycle spend at this table's unit, times 1.25 safety, rounded up to $50
const r = Bankroll.recommendStart({ minUnit: 1, worstCycleSpendAt1: 480 });  // from sim gate output
assert.equal(r.amount, Math.ceil(480 * 1 * 1.25 / 50) * 50);
assert.ok(r.explanation.includes('worst'));
```

- [ ] **Step 2:** Implement `recommendStart` in bankroll.js: `worstSpend = worstCycleSpendAt1 * minUnit; amount = ceil(worstSpend*1.25/50)*50`, explanation string showing the math in plain words. The `worstCycleSpendAt1` constant comes from the Task 3 sim report and is stored as `BTHG.CONSTANTS.TRINITY_WORST_SPEND_AT_1` with a comment citing the sim run.
- [ ] **Step 3:** Panel: add the two limit fields; Apply writes limits to the active machine profile (creating a default profile when none exists) and re-instantiates the TrinityEngine with new limits. Projection block renders: recommended start (with math), guaranteed minimum per banked closer (= floor), per-series path ("3 closers banked = +3 units minimum; your archived series average N spins"), and live projected-vs-actual once betting.
- [ ] **Step 4:** Re-baseline behavior (already in the uncommitted diff) verified: changing bankroll never shows phantom loss. Manual browser check.
- [ ] **Step 5:** `npm test` + new test green. Commit: `feat: bankroll manager with table limits, recommended start, betting path projection`

---

### Task 10: Wheel layout verifier

**Files:**
- Create: `js/wheel-verifier.js`
- Modify: `js/app.js` (machine profile panel gains a "Verify Wheel" button opening the verifier overlay)
- Create: `tests/test-wheel-verifier.mjs`

**Interfaces:**
- Consumes: `MachineProfiles` (Task 1).
- Produces: `BTHG.WheelVerifier.validate(seq) -> {ok:true} | {ok:false, error, position}`; overlay UI with the exact instruction text: "Starting from 00, input all the numbers in order starting at the right of 00 until you get back to 00." On success: saves `wheelLayout` (with 37 prepended for 00) and `verifiedLayout: true` to the active profile.

- [ ] **Step 1: Failing test:**

```js
const V = require('../js/wheel-verifier.js');
const good = [27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1]; // 37 numbers, 00 implied at start
assert.deepEqual(V.validate(good), { ok: true });
assert.equal(V.validate(good.slice(0, 20)).ok, false);            // incomplete
const dup = good.slice(); dup[5] = dup[4];
const bad = V.validate(dup);
assert.equal(bad.ok, false);
assert.equal(bad.position, 5);                                     // exact error spot
```

- [ ] **Step 2:** Implement: `validate` checks length 37, tokens are 0-36 plus at most one more 00/37 (00 is the implied start, reject if re-entered mid-sequence), each exactly once; on duplicate/invalid report the index. UI: large touch pad (reuses `.rt-cell` sizing), progress arc showing entered numbers in order around a wheel ring, error highlights the exact position.
- [ ] **Step 3:** Save on success; pattern engine calls now receive `layout` from the active profile (wire in Task 8's analyze call).
- [ ] **Step 4:** Tests green. Commit: `feat: wheel layout verifier with per-machine storage`

---

### Task 11: Stealth screen

**Files:**
- Create: `js/stealth.js`
- Create: `tests/test-stealth-parse.mjs`
- Modify: `app.html` (script tag), `js/app.js` (stealth button `#btn-stealth` in status strip)

**Interfaces:**
- Consumes: live series input path (same function table taps use: `tableUI.recordNumber(n)` or the engine call it wraps).
- Produces: `BTHG.Stealth.enter()` / `BTHG.Stealth.exit()`; `BTHG.Stealth.parseInput(text) -> {kind:'back'} | {kind:'spins', numbers:number[]} | {kind:'invalid', bad:string[]}` (exported for tests). Full-screen overlay `#stealth-screen` styled as iOS Messages (gray incoming, blue outgoing, SF-style font stack `-apple-system`), `document.title = 'Messages'` while active (restored on exit).

- [ ] **Step 1: Failing parse test:**

```js
const S = require('../js/stealth.js');
assert.deepEqual(S.parseInput('4,17,32,0'),  { kind:'spins', numbers:[4,17,32,0] });
assert.deepEqual(S.parseInput('00, 5'),      { kind:'spins', numbers:[37,5] });
assert.deepEqual(S.parseInput('back'),       { kind:'back' });
assert.deepEqual(S.parseInput('BACK'),       { kind:'back' });
assert.equal(S.parseInput('4,39,x').kind, 'invalid');
assert.deepEqual(S.parseInput('4,39,x').bad, ['39','x']);
```

- [ ] **Step 2:** Implement parser: split on commas, trim; `00`→37; valid tokens `/^(00|0|[1-9]|[12][0-9]|3[0-6])$/`; ANY bad token → `invalid` with the bad list (nothing recorded on invalid).
- [ ] **Step 3:** Overlay UI: header ("Messages" back chevron + contact name "Alex"), scrollable bubble list seeded top-to-bottom with: calibrator reminder + step-by-step instructions; the number-entry instruction bubble VERBATIM: "You can still track numbers from here. Just enter the next number that comes up and put a comma next to it, then add the number after that separated by a comma from the next and so on. When you hit send they will be added to current series count. Type BACK to go back to the table view."; how the Trinity works; 2 simulated streak walkthroughs (real numbers from the Task 3 sim report); app/system info. Input bar sends: `spins` → each number through the live recording path, reply bubble confirms "Added N."; `invalid` → reply bubble lists rejected tokens; `back` → `exit()`.
- [ ] **Step 4:** Enter/exit swaps `document.title`; the app root gets `hidden` attribute while stealth is active (nothing app-like in the DOM visible). Manual check on phone layout.
- [ ] **Step 5:** Tests + `npm test` green. Commit: `feat: stealth messages screen with comma-entry spin logging`

---

### Task 12: Calibrator fix

**Files:**
- Modify: `js/calibration.js:295-345` (`compute()`)
- Create: `tests/test-calibrator.mjs`

**Interfaces:**
- Produces: `compute()` uses CHRONOLOGICAL first/last valid intervals for k; returns additionally `{secPerRev, rejected?:string}`; sanity bounds: ballRPM in [10, 200], k in [0.01, 1.5], else `{rejected: 'Measurement rejected, re-tap. (reason)'}` and nothing stored. UI shows labeled units: "X.XX sec/rev", "XX.X RPM", "k = X.XXX per second".

- [ ] **Step 1: Failing test** with synthetic taps of known physics:

```js
// Ball at omega0 = 4π rad/s (2 rev/s), k = 0.10/s: tap times are successive
// solutions of cumulative angle = 2π m. Generate 6 taps, feed compute(), and
// assert ballRPM within 3% of the true first-interval RPM and k within 15% of 0.10.
// Then shuffle in one outlier interval (a missed tap = double interval) and
// assert k is still within 15% (median filter keeps chronology).
```

(Write the generator with the exponential model `theta(t) = (omega0/k)(1 - e^{-kt})`, solve tap times numerically by bisection inside the test file; assert as above. The CURRENT code fails the outlier case because sorting misorders first/last.)
- [ ] **Step 2: Run** — FAIL on the outlier case.
- [ ] **Step 3: Fix `compute()`:** build `raw` intervals chronologically; median from a sorted COPY; `valid = raw.filter(v => v > 80 && v < median*3 && v < 10000)` (preserves order); `firstInt = valid[0]`, `lastInt = valid[valid.length-1]`; `totalTime` from first to last VALID tap span; add `secPerRev: avgIntervalS`; apply sanity bounds returning `{rejected}` messages.
- [ ] **Step 4:** Update calibration UI strings to the labeled units. Tests green, `npm test` green. Commit: `fix: calibrator chronological deceleration + labeled units + sanity bounds`

---

### Task 13: Trinity wiring into play + cap alerts

**Files:**
- Modify: `js/roulette-table.js` (recordNumber path ~line 370-400: replace ladder multiplier usage with TrinityEngine)
- Modify: `js/series-engine.js` (`getTrinityMultiplier` marked deprecated; kept for old tests until suite updated)
- Modify: `js/app.js` (status strip Trinity chip: current perNumber, cycle spend, level)

**Interfaces:**
- Consumes: `TrinityEngine` (Task 2), active machine limits (Task 1/9), `IntelFeed` (Task 8).
- Produces: on every spin while betting: win → `recordHit`, P&L += net; miss → `recordMiss`, P&L -= total. When `nextBet().screens > 1`: red pinned alert in feed + status strip: "SPLIT: SECOND SCREEN NEEDED. $X per number total, $Y per screen on Z screens." When bankroll < `spent + nextBet().total`: alert "Bankroll cannot cover next Trinity bet."

- [ ] **Step 1:** Instantiate `TrinityEngine` from active profile limits at series start and whenever limits change. Replace the ladder math in the spin handler (the `wasInFinal`/multiplier block) with engine calls; coverage check already fixed in Task 4 (`getTrinityNumbers()` includes 0/00).
- [ ] **Step 2:** Cap + bankroll alerts wired to IntelFeed and status strip.
- [ ] **Step 3:** Ledger check in browser console for one manual series: sum of displayed P&L changes equals TrinityEngine cash math. Run `node tests/simulate-trinity.mjs` once more (gate). `npm test` green (update any suite tests that asserted the old ladder — change expectations to computed values, do not delete coverage).
- [ ] **Step 4:** Commit: `feat: live Trinity betting uses computed engine with split-screen and bankroll alerts`

---

### Task 14: Device pass, regression, deploy

**Files:**
- Modify: whatever the device pass flags (fit-and-finish only)

- [ ] **Step 1:** Full suite: `npm test` (298 + new), `node tests/simulate-trinity.mjs`, all `tests/test-*.mjs` files.
- [ ] **Step 2:** Manual device pass over the live LAN server (`python3 -m http.server 8080`, phone/iPad on same network): iPhone 7 Safari landscape (48px targets, status strip, signal badge, stealth in/out, theme cycle), iPad (top-third table, feed below), series end freeze/archive, wheel verifier full entry, bankroll fields, calibrator readings sane.
- [ ] **Step 3:** Fix flagged items, re-run suite.
- [ ] **Step 4:** `git push origin main` ONLY after Brandon confirms which repo Vercel deploys from (BTHGJustWin vs AdaptationLivingLLC remote — confirmed two-repo confusion on June 30). Verify the Vercel deployment URL renders and the stealth screen works on production.
- [ ] **Step 5:** Commit any final fixes: `chore: device pass fixes for iPhone 7 and iPad`

---

## Self-review notes
- Spec coverage: S1→T7, S2→T11, S3→T5, S4→T6+T8, S5→T2+T3+T13, S6→T12, S7→T9, S8→T10, defects list→T4. All covered.
- Type consistency: `TrinityEngine.nextBet()` shape used identically in T3, T9, T13; `MachineProfiles` API identical in T1, T9, T10; `analyze()` signature identical in T6, T8, T10.
- Deliberate simplification: `netPerUnit = 26` is derived, not hardcoded, so European wheels (coverage change) stay correct.

---
# Amendment A tasks (2026-07-02). Execution order: Tasks 6..13, then 15..19, then Task 14 (device pass + deploy) LAST.

### Task 15: Tail statistics, Final-K ranking, straggler advisory

**Files:**
- Modify: `js/pattern-engine.js` (created in Task 6)
- Create: `tests/test-tail-ranking.mjs`

**Interfaces:**
- Consumes: archived series records (spins, entrySpin, closerOffsets, endType, openStragglers?), wheelLayout.
- Produces (added to `BTHG.PatternEngine`):
  - `tailStats(archive) -> {samples, byPosition: [{closerIndex, medianExtraSpins, p25, p75}]}` — for each closer position (1st..Nth), spins elapsed from the (N-2)th closer, across archived series; resolutions flagged crossedBoundary are included but down-weighted 0.5.
  - `rankFinal(archive, liveState, layout, K) -> {ranked: [{n, score, expectedSpins}], advisory: string|null}` — scores each current Final-8 member by (a) historical resolution speed at its current drought depth, (b) tail-position stretch from tailStats, (c) neighbor hit density on the verified layout. Top K = covered set. `advisory` is the straggler warning string with sample size when the tail predicts dragging (plain punctuation, no dashes).
  - GATE: both return `{locked: true, reason}` when archive has < 4 completed series for the machine.

- [ ] Test first (synthetic archive with engineered fast/slow tails; assert ranking order, gate at 3 series, advisory text contains sample count). Implement. `npm test` chain green. Commit.

### Task 16: Coverage selector and Trinity coverage wiring

**Files:**
- Modify: `js/app.js` (bankroll panel), `js/roulette-table.js` (covered-set win detection), `js/bankroll.js`
- Create: `tests/test-coverage-select.mjs`

**Interfaces:**
- Bankroll setup gains `#br-coverage` selector 1..8 (default 8). Locked (disabled, with reason shown) until MachineProfiles active machine has >= 4 completed archived series. Saved per machine profile as `coverageK`.
- Bankroll amount field accepts $1 to $1,000,000 (update validation).
- TrinityEngine instantiated with `coverage = K + 2`. Win detection uses `PatternEngine.rankFinal(...).ranked.slice(0,K)` plus 0 and 37; re-ranked after each hit.
- Changing K displays tradeoff line: "Hit chance per spin (K+2)/38. Net per unit 36-(K+2)." with computed numbers.

- [ ] Test: coverage math flows to TrinityEngine (netPerUnit = 36-(K+2)); gate enforcement; bankroll range validation. Implement, wire, `npm test` green, commit.

### Task 17: Early series end with ghost tracking

**Files:**
- Modify: `js/series-engine.js`, `js/roulette-table.js`, `js/app.js`, `js/storage.js`
- Create: `js/ghost-watcher.js`, `tests/test-ghost-watcher.mjs`

**Interfaces:**
- Ending a series with unhit numbers prompts: "Are you sure you want to end the series early?" (plain confirm overlay, ids `#btn-early-yes`, `#btn-early-no`).
- On yes: archive record gets `endType: 'early'`, `openStragglers: number[]`, `closedAtSpin`.
- `BTHG.GhostWatcher` (UMD): `openGhosts(machineId) -> [{seriesId, n, sinceSpin}]`; `onSpin(machineId, n, currentSeriesSpinIndex)` — when n matches an open ghost, updates the archived series record: resolution = closedAtSpin + spins elapsed since close (across boundary), sets `crossedBoundary: true`, removes ghost. Persisted in localStorage `bthg_ghosts_<machineId>`.
- UI: pills near status strip "Watching: 32, 6" (id `#ghost-pills`); pill flashes and disappears on hit. New series board starts fully clean.
- Wire `GhostWatcher.onSpin` into the same spin path as table taps and stealth entry.

- [ ] Test: early end stores stragglers; ghost resolves into archived record with correct cross-boundary spin math; pills data source. Implement, `npm test` green, commit.

### Task 18: Persistent number tape with series markers

**Files:**
- Modify: `js/app.js` or `js/roulette-table.js` (wherever the existing red/black history strip renders), `js/storage.js` (query all spins incl. archived marks)
- Create: `tests/test-tape.mjs`

**Interfaces:**
- The tape renders ALL SpinDB spins for the active machine, oldest to newest, regardless of seriesMarker (Task 5 marks, never deletes).
- Between series: marker chip showing "Series ended <date> <time>" and "New series <time>" derived from the archived record timestamps and the first spin of the next series. Marker element class `tape-series-marker`.
- Tape is display-only; engine replay still filters to current series (Task 5 behavior unchanged).

- [ ] Test: tape data assembler returns full history with marker entries at boundaries. Implement, `npm test` green, commit.

### Task 19: Timing engine (cadence and phase drift)

**Files:**
- Create: `js/timing-engine.js`, `tests/test-timing-engine.mjs`
- Modify: `js/calibration.js` (phase-reference tap: user taps when 00 passes a fixed spot; stores {tClock, kind:'phase'})
- Modify: `js/app.js` (timing panel section)

**Interfaces:**
- `BTHG.TimingEngine` (UMD):
  - `learnCadence(spinTimestamps) -> {meanS, sdS, samples}` (expect ~42 to 45 s on this machine class).
  - `phaseDrift(phaseTaps, wheelOmega) -> {driftRadPerMin, pocketErrorAtMin: (m)=>pockets}` — fits phase residuals over time.
  - `predictWindows({cadence, phase, wheelOmega, k, layout, horizonS}) -> [{n, tStart, tEnd, confidence}] | {limited: true, reason, driftRate}` — unlocks wall-clock hit windows ONLY when projected pocket error stays < 2 pockets over the horizon; otherwise returns limited with the measured drift rate. If physics residuals are inconsistent with a mechanical wheel (drift fit residuals ~ uniform), returns `{limited:true, reason:'outcomes not phase-locked (possible RNG display)'}`.
- All predictions display confidence and widen with horizon. Timestamps come from SpinDB (already stored per spin).

- [ ] Test with synthetic phase-stable and phase-drifting tap series (known omega): stable unlocks windows, drifting returns limited with correct rate sign. Implement, `npm test` green, commit.
