import assert from 'node:assert/strict';
import { deepEqual } from 'node:assert';
import { loadBTHG } from './_load.mjs';

const MP = loadBTHG(['js/machine-profile.js']).MachineProfiles;

assert.equal(MP.AMERICAN_LAYOUT.length, 38);
assert.equal(new Set(MP.AMERICAN_LAYOUT).size, 38);
const p = MP.save({ name:'Del Sol 1', casino:'Del Sol', minUnit:0.25, maxUnit:50 });
assert.ok(p.id);
assert.equal(MP.get(p.id).name, 'Del Sol 1');
MP.setActive(p.id);
assert.equal(MP.getActive().id, p.id);
deepEqual(MP.getActive().wheelLayout, MP.AMERICAN_LAYOUT);
assert.throws(() => MP.save({ name:'x', minUnit:0.1, maxUnit:50 }));   // min < 0.25
assert.throws(() => MP.save({ name:'x', minUnit:1, maxUnit:2000 }));   // max > 1500
MP.remove(p.id);
assert.equal(MP.get(p.id), null);
console.log('machine-profile: ALL PASS');
