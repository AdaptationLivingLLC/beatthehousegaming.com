import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Mock browser environment
const window = { BTHG: {} };
const localStorage = (() => { let s={}; return {
  getItem:k=>s[k]??null, setItem:(k,v)=>{s[k]=String(v)}, removeItem:k=>{delete s[k]} };})();
const ctx = vm.createContext({ window, localStorage, console, Math, Date, Set, Object, String });

// Load machine-profile.js into the mock environment
const code = fs.readFileSync('js/machine-profile.js', 'utf8');
vm.runInContext(code, ctx);

// Export for use in assertions
const MP = ctx.window.BTHG.MachineProfiles;

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
