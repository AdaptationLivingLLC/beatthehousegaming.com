// Shared loader: evaluates browser-global JS modules in a vm sandbox and
// returns the BTHG namespace. Usage: const BTHG = await loadBTHG(['js/machine-profile.js'])
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function makeLocalStorage() {
  let s = {};
  return {
    getItem: k => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
  };
}

// Minimal classList stand-in (Set-backed, supports the multi-arg
// add()/remove() calls BTHG.UI.applyLayout makes) for headless DOM-free
// layout/theme tests.
export function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) { names.forEach(n => set.add(n)); },
    remove(...names) { names.forEach(n => set.delete(n)); },
    contains(n) { return set.has(n); },
    toString() { return [...set].join(' '); },
  };
}

// Minimal `document` stand-in: just enough (`body.classList`,
// `body.dataset`, a no-op addEventListener/getElementById) for
// BTHG.UI.applyLayout()/cycleTheme()/restoreTheme() to run without a
// real DOM. Pass `overrides` to stub getElementById etc. per test.
export function makeFakeDocument(overrides = {}) {
  const body = { classList: makeClassList(), dataset: {} };
  return Object.assign({
    body,
    addEventListener() {},
    getElementById() { return null; },
  }, overrides);
}

export function loadBTHG(files, { localStorage = makeLocalStorage(), extraGlobals = {} } = {}) {
  const sandbox = { console, localStorage, Date, Math, JSON };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  Object.assign(sandbox, extraGlobals);
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
  }
  // Stash the sandbox on the returned namespace (test-only convenience)
  // so tests can mutate innerWidth/innerHeight/document between calls,
  // e.g. to exercise applyLayout() across several viewport sizes.
  if (sandbox.BTHG) sandbox.BTHG.__sandbox = sandbox;
  return sandbox.BTHG;
}
