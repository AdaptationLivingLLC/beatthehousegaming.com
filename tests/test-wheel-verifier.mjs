// tests/test-wheel-verifier.mjs — Task 10: wheel layout verifier
//
// Loading note: the brief's Step 1 snippet shows
// `const V = require('../js/wheel-verifier.js')`. Verified by hand
// against this repo (package.json "type": "module", Node 20.20.2):
// require()-ing a plain .js file whose nearest package.json says
// "type": "module" makes Node load it as an ES module instead of
// CommonJS (the FILE's own package.json scope decides this, not the
// caller), and under that interop `module` inside the UMD wrapper is
// not a real CJS wrapper variable, so `module.exports = mod` never
// fires — require() hands back an empty module-namespace object, not
// {validate, INSTRUCTION, EXPECTED_LENGTH}. Every other UMD module in
// this codebase (js/machine-profile.js, js/trinity.js,
// js/pattern-engine.js) hits the exact same thing, which is why their
// tests (test-machine-profile.mjs, test-trinity.mjs,
// test-pattern-engine.mjs) all load via tests/_load.mjs's vm-sandbox
// loader instead of require(). This file follows that same established,
// actually-working pattern. The brief's exact fixture values and
// assertions below are unchanged.
import assert from 'node:assert/strict';
import { deepEqual } from 'node:assert';
import { loadBTHG } from './_load.mjs';

const V = loadBTHG(['js/wheel-verifier.js']).WheelVerifier;

// Note: values returned by code running inside _load.mjs's vm sandbox are
// constructed against a DIFFERENT realm's Object (a separate
// vm.createContext), so node:assert/strict's deepEqual (aliased to
// deepStrictEqual) rejects them as "not reference-equal" even when every
// field matches — same reason tests/test-machine-profile.mjs imports the
// legacy loose `deepEqual` from 'node:assert' alongside strict `assert`.
// Confirmed by hand: the brief's literal `assert.deepEqual(V.validate(good),
// { ok: true })` throws exactly that cross-realm error against a stub that
// already returns the correct value, so the loose import below is required,
// not a style choice.

// ---- Step 1: brief's exact failing test (fixture + assertions verbatim) ----
const good = [27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1]; // 37 numbers, 00 implied at start
deepEqual(V.validate(good), { ok: true });
assert.equal(V.validate(good.slice(0, 20)).ok, false);            // incomplete
const dup = good.slice(); dup[5] = dup[4];
const bad = V.validate(dup);
assert.equal(bad.ok, false);
assert.equal(bad.position, 5);                                     // exact error spot
console.log('brief Step 1 fixture (good/incomplete/duplicate): PASS');

// ---- Sanity: the brief's `good` fixture is the real American order ----
// (rotated so 00/37 leads, matching js/machine-profile.js AMERICAN_LAYOUT
// and js/utils.js WHEEL_LAYOUTS.american) — confirms validate() accepts
// the actual physical wheel, not just an arbitrary permutation.
{
  const MP = loadBTHG(['js/machine-profile.js']).MachineProfiles;
  deepEqual([37, ...good], MP.AMERICAN_LAYOUT, 'brief fixture matches AMERICAN_LAYOUT with 37 prepended');
  console.log('good fixture matches AMERICAN_LAYOUT (37 prepended): PASS');
}

// ---- Length: too long is also rejected, with position = current length ----
{
  const tooLong = good.concat([5]); // 38 entries
  const r = V.validate(tooLong);
  assert.equal(r.ok, false);
  assert.equal(r.position, 38);
  assert.ok(r.error.toLowerCase().includes('37'));
  console.log('too-long sequence rejected: PASS');
}

// ---- Non-array / empty input doesn't throw ----
{
  assert.equal(V.validate(undefined).ok, false);
  assert.equal(V.validate(null).ok, false);
  assert.equal(V.validate([]).ok, false);
  assert.equal(V.validate([]).position, 0);
  console.log('non-array/empty input handled without throwing: PASS');
}

// ---- 00/37 re-entered mid-sequence is rejected (00 is the implied start) ----
{
  const withZeroZero = good.slice();
  withZeroZero[10] = 37; // re-typing 00 in the middle
  const r = V.validate(withZeroZero);
  assert.equal(r.ok, false);
  assert.equal(r.position, 10);
  assert.ok(/00/.test(r.error));
  console.log('re-entered 00/37 mid-sequence rejected at exact position: PASS');
}

// ---- Out-of-range / malformed tokens rejected at exact position ----
{
  for (const [bad2, label] of [
    [-1, 'negative'], [38, 'too high'], [1.5, 'non-integer'], ['5', 'string'], [NaN, 'NaN'],
  ]) {
    const seq = good.slice();
    seq[7] = bad2;
    const r = V.validate(seq);
    assert.equal(r.ok, false, `${label} should fail`);
    assert.equal(r.position, 7, `${label} should report position 7`);
  }
  console.log('malformed tokens rejected at exact position: PASS');
}

// ---- Any rotation/order of 0-36 (not just the real wheel) is a valid permutation ----
{
  const shuffled = good.slice().reverse();
  deepEqual(V.validate(shuffled), { ok: true }, 'validate checks permutation validity, not physical correctness');
  console.log('any full permutation of 0-36 validates: PASS');
}

// ---- Instruction text is exact (mandated wording, verbatim) ----
{
  assert.equal(
    V.INSTRUCTION,
    'Starting from 00, input all the numbers in order starting at the right of 00 until you get back to 00.'
  );
  assert.ok(!V.INSTRUCTION.includes('–') && !V.INSTRUCTION.includes('—'), 'no dashes');
  console.log('instruction text exact + no dashes: PASS');
}

console.log('wheel-verifier: ALL PASS');
