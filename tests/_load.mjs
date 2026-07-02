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

export function loadBTHG(files, { localStorage = makeLocalStorage() } = {}) {
  const sandbox = { console, localStorage, Date, Math, JSON };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.BTHG;
}
