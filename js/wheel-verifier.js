// ============================================================
// wheel-verifier.js — BTHG.WheelVerifier (Task 10)
// BTHG Roulette Breaker Web App
//
// Some casino wheels are NOT standard American order (a pocket or two
// swapped during a resurface, a house running a non-standard wheel,
// etc). Wheel-position math (js/pattern-engine.js#wheelDistance, the
// physical wheel viz in js/roulette-table.js) all assume
// BTHG.WHEEL_LAYOUTS.american unless a machine profile carries its own
// verified wheelLayout. This module is the pure verification step: the
// player walks the real wheel pocket by pocket, starting at 00 (never
// re-typed, since it's the fixed reference point) and going around to
// the right until back at 00, and validate() checks the result is a
// genuine permutation of every number before it gets trusted as that
// machine's wheelLayout.
//
// Encoding: 37 stands for "00" everywhere in this codebase (see
// js/machine-profile.js AMERICAN_LAYOUT, js/utils.js WHEEL_LAYOUTS,
// js/pattern-engine.js disp()) — display always translates 37 back to
// the string "00"; it is never shown to the player as the number 37.
// validate() takes the 37 numbers AFTER the implied starting 00 (0
// through 36, each exactly once) — 00 itself is never part of the input
// sequence, so a 37/"00" token appearing anywhere in it is always wrong
// (see reject-re-entry below), not just a value out of range.
//
// Loading note: same UMD wrapper as js/machine-profile.js / js/trinity.js
// / js/pattern-engine.js (attaches to a real `window.BTHG` in the
// browser; the module.exports line only fires under a true CommonJS
// require). This project's package.json sets "type": "module", which
// makes Node's `require()` of a plain .js file load it as an ES module
// instead (Node's ESM/CJS choice is based on the FILE's own package.json
// scope, not the caller) — under that interop `module` is not a real
// CJS wrapper variable, so `module.exports = mod` above never runs and
// require() hands back an empty module-namespace object, not
// {validate,...}. Confirmed by hand against this exact file/Node 20.20.2
// before writing tests/test-wheel-verifier.mjs. Every other UMD module
// in this codebase (machine-profile/trinity/pattern-engine) hits the
// same thing and its test loads it via tests/_load.mjs's vm-sandbox
// loader instead of require() — test-wheel-verifier.mjs follows that
// same established pattern rather than the brief's illustrative
// require() line, keeping the brief's exact fixtures/assertions.
// ============================================================

(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  // Exact wording mandated by the brief — verbatim, including the
  // deliberate lack of a comma before "until" (no dashes anywhere).
  const INSTRUCTION = 'Starting from 00, input all the numbers in order starting at the right of 00 until you get back to 00.';

  // 00 is the implied start/end and is never itself part of the typed
  // sequence, so the sequence is exactly the other 37 numbers (0-36).
  const EXPECTED_LENGTH = 37;

  /**
   * Validates a player-entered wheel sequence (37 numbers, 0 through 36,
   * each exactly once, 00 implied at the start and not re-typed).
   *
   * Returns { ok: true } on success (no extra keys — callers/tests rely
   * on this being the whole object), or { ok: false, error, position }
   * on the first problem found, `position` being the exact 0-based index
   * into `seq` where it went wrong:
   *   - wrong length: position is seq.length itself (where entry should
   *     resume/how many are in so far), reported once, up front.
   *   - a token of 37 (or the string "00"): 00 is the implied start and
   *     cannot be re-entered mid-sequence.
   *   - a token outside 0-36 (non-integer, negative, > 36, NaN, etc): not
   *     a valid wheel number at all.
   *   - a repeated number: already used earlier in this same sequence.
   */
  function validate(seq) {
    if (!Array.isArray(seq) || seq.length !== EXPECTED_LENGTH) {
      const have = Array.isArray(seq) ? seq.length : 0;
      return {
        ok: false,
        error: `Enter all 37 numbers after 00 (0 through 36). You have entered ${have} so far.`,
        position: have,
      };
    }

    const seen = new Set();
    for (let i = 0; i < seq.length; i++) {
      const n = seq[i];

      if (n === 37 || n === '00') {
        return {
          ok: false,
          error: '00 is the starting point and cannot be entered again.',
          position: i,
        };
      }

      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 36) {
        return {
          ok: false,
          error: `"${n}" is not a valid number. Use 0 through 36.`,
          position: i,
        };
      }

      if (seen.has(n)) {
        return {
          ok: false,
          error: `${n} has already been entered.`,
          position: i,
        };
      }
      seen.add(n);
    }

    return { ok: true };
  }

  BTHG.WheelVerifier = { validate, INSTRUCTION, EXPECTED_LENGTH };
  return BTHG.WheelVerifier;
});
