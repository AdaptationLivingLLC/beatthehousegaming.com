import assert from 'node:assert/strict';
import { loadBTHG } from './_load.mjs';

const PE = loadBTHG(['js/pattern-engine.js']).PatternEngine;

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
