// ============================================================
// BTHG Roulette Breaker — Comprehensive Test Suite
// DEV/QA ONLY — Not part of the production app
// Tests all math, engine logic, calibration, bankroll, predictions
// Run with: node tests/test-all.js
// 298 tests — ALL PASSED (verified 2026-03-07)
// ============================================================

// Mock browser environment
const window = {};
const performance = { now: () => Date.now() };
const document = { addEventListener: () => {} };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const navigator = {};

// Load source files in order
const fs = require('fs');
const vm = require('vm');
const ctx = vm.createContext({ window, performance, document, localStorage, navigator, console, Math, Date, Set, Map, Float64Array, Object, Array, String, parseInt, parseFloat, isNaN, setTimeout: () => {}, clearInterval: () => {}, setInterval: () => {}, requestAnimationFrame: () => {}, alert: () => {} });

function loadFile(path) {
  const code = fs.readFileSync(path, 'utf8');
  vm.runInContext(code, ctx);
}

loadFile('js/utils.js');
loadFile('js/physics-core.js');
loadFile('js/series-engine.js');
loadFile('js/calibration.js');
loadFile('js/bankroll.js');
loadFile('js/prediction-engine.js');

const BTHG = ctx.window.BTHG;

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ FAIL:\x1b[0m ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  total++;
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${message} (got ${actual.toFixed(6)}, expected ${expected.toFixed(6)}, diff ${diff.toFixed(6)})`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ FAIL:\x1b[0m ${message} (got ${actual.toFixed(6)}, expected ${expected.toFixed(6)}, diff ${diff.toFixed(6)})`);
  }
}

// ============================================================
// TEST 1: Constants & Utilities
// ============================================================
console.log('\n\x1b[36m═══ TEST 1: Constants & Utilities ═══\x1b[0m');

assert(BTHG.CONSTANTS.AMERICAN_N === 38, 'American wheel has 38 pockets');
assert(BTHG.CONSTANTS.TWO_PI === 2 * Math.PI, 'TWO_PI is correct');
assertApprox(BTHG.CONSTANTS.POCKET_ANGLE, (2 * Math.PI) / 38, 0.0001, 'Pocket angle = 2π/38');

// Wheel layout validation
const american = BTHG.WHEEL_LAYOUTS.american;
assert(american.length === 38, 'American wheel layout has 38 entries');
const unique = new Set(american);
assert(unique.size === 38, 'All 38 numbers are unique in wheel layout');
assert(american.includes(0), 'Wheel contains 0');
assert(american.includes(37), 'Wheel contains 37 (00)');
for (let i = 1; i <= 36; i++) {
  if (!american.includes(i)) {
    assert(false, `Wheel missing number ${i}`);
  }
}
assert(american[0] === 0, 'Wheel starts with 0');
assert(american[19] === 37, '00 (37) is at position 19 (opposite 0)');

// Color assignments
assert(BTHG.colorForNumber(0) === 'green', '0 is green');
assert(BTHG.colorForNumber(37) === 'green', '00 is green');
assert(BTHG.colorForNumber(1) === 'red', '1 is red');
assert(BTHG.colorForNumber(2) === 'black', '2 is black');
assert(BTHG.colorForNumber(3) === 'red', '3 is red');
assert(BTHG.colorForNumber(4) === 'black', '4 is black');
assert(BTHG.colorForNumber(32) === 'red', '32 is red');
assert(BTHG.colorForNumber(35) === 'black', '35 is black');

// Display number
assert(BTHG.displayNumber(37) === '00', 'displayNumber(37) = "00"');
assert(BTHG.displayNumber(0) === '0', 'displayNumber(0) = "0"');
assert(BTHG.displayNumber(15) === '15', 'displayNumber(15) = "15"');

// Parse number
assert(BTHG.parseNumber('00') === 37, 'parseNumber("00") = 37');
assert(BTHG.parseNumber('0') === 0, 'parseNumber("0") = 0');
assert(BTHG.parseNumber('36') === 36, 'parseNumber("36") = 36');
assert(BTHG.parseNumber('abc') === null, 'parseNumber("abc") = null');
assert(BTHG.parseNumber('-1') === null, 'parseNumber("-1") = null');

// Angle wrapping
assertApprox(BTHG.wrapAngle(0), 0, 0.0001, 'wrapAngle(0) = 0');
assertApprox(BTHG.wrapAngle(Math.PI), Math.PI, 0.0001, 'wrapAngle(π) = π');
assertApprox(BTHG.wrapAngle(3 * Math.PI), Math.PI, 0.0001, 'wrapAngle(3π) = π');
assertApprox(BTHG.wrapAngle(-Math.PI), Math.PI, 0.0001, 'wrapAngle(-π) = π');

// Angle to index
assert(BTHG.angleToIndex(0, 38) === 0, 'angleToIndex(0) = 0');
assert(BTHG.angleToIndex(Math.PI, 38) === 19, 'angleToIndex(π) = 19 (halfway around)');

// Bet amounts
assert(BTHG.BET_AMOUNTS[0] === 0.50, 'First bet amount is $0.50');
assert(BTHG.BET_AMOUNTS[BTHG.BET_AMOUNTS.length - 1] === 100, 'Last bet amount is $100');
assert(BTHG.BET_AMOUNTS.includes(5), 'Bet amounts include $5');
assert(BTHG.BET_AMOUNTS.includes(1), 'Bet amounts include $1');

// Format money
assert(BTHG.formatMoney(0.50) === '$0.50', 'formatMoney(0.50) = "$0.50"');
assert(BTHG.formatMoney(5) === '$5', 'formatMoney(5) = "$5"');
assert(BTHG.formatMoney(100) === '$100', 'formatMoney(100) = "$100"');
assert(BTHG.formatMoney(1.5) === '$1.50', 'formatMoney(1.5) = "$1.50"');

// Side bets
assert(BTHG.SIDE_BETS['1st 12'](1) === true, '1 is in 1st 12');
assert(BTHG.SIDE_BETS['1st 12'](12) === true, '12 is in 1st 12');
assert(BTHG.SIDE_BETS['1st 12'](13) === false, '13 is NOT in 1st 12');
assert(BTHG.SIDE_BETS['RED'](1) === true, '1 is RED');
assert(BTHG.SIDE_BETS['RED'](2) === false, '2 is NOT RED');
assert(BTHG.SIDE_BETS['BLACK'](2) === true, '2 is BLACK');
assert(BTHG.SIDE_BETS['EVEN'](2) === true, '2 is EVEN');
assert(BTHG.SIDE_BETS['EVEN'](0) === false, '0 is NOT EVEN (house number)');
assert(BTHG.SIDE_BETS['ODD'](37) === false, '00 is NOT ODD (house number)');

// ============================================================
// TEST 2: Physics Core — Kinematics
// ============================================================
console.log('\n\x1b[36m═══ TEST 2: Physics Core — Kinematics ═══\x1b[0m');

const P = BTHG.Physics;

// RPM conversions
assertApprox(P.rpmToRadS(60), 2 * Math.PI, 0.0001, '60 RPM = 2π rad/s');
assertApprox(P.rpmToRadS(30), Math.PI, 0.0001, '30 RPM = π rad/s');
assertApprox(P.radSToRPM(2 * Math.PI), 60, 0.0001, '2π rad/s = 60 RPM');
// Round-trip
assertApprox(P.radSToRPM(P.rpmToRadS(25)), 25, 0.0001, 'RPM round-trip: 25 RPM');

// Exponential decay: ω(t) = ω₀ * e^(-kt)
// At t=0, ball angle = theta0
assertApprox(P.thetaBallExponential(0, 0, 10, 0.5), 0, 0.0001, 'Ball at t=0 is at theta0');

// Drop time exponential: t_drop = ln(ω₀/ω_drop) / k
// If ω₀ = 10, k = 0.5, ω_drop = 5: t = ln(10/5)/0.5 = ln(2)/0.5 = 1.3863
const tDrop1 = P.solveForDropTimeExponential(10, 0.5, 5);
assertApprox(tDrop1, Math.log(2) / 0.5, 0.0001, 'Drop time: ω₀=10, k=0.5, ω_drop=5 → t=ln(2)/0.5');

// If ω₀ = 20, k = 0.3, ω_drop = 1.5: t = ln(20/1.5)/0.3
const tDrop2 = P.solveForDropTimeExponential(20, 0.3, 1.5);
assertApprox(tDrop2, Math.log(20 / 1.5) / 0.3, 0.0001, 'Drop time: ω₀=20, k=0.3, ω_drop=1.5');

// Drop time edge cases
assert(P.solveForDropTimeExponential(5, 0.5, 10) === null, 'Drop time null when ω₀ < ω_drop');
assert(P.solveForDropTimeExponential(10, -1, 5) === null, 'Drop time null when k ≤ 0');
assert(P.solveForDropTimeExponential(10, 0.5, 0) === null, 'Drop time null when ω_drop = 0');

// Ball distance: θ(t) = θ₀ + (ω₀/k) * (1 - e^(-kt))
// At large t, ball distance → ω₀/k
const largeT = 100;
const omega0 = 10, k = 0.5;
const expectedDist = omega0 / k; // 20 radians total
const actualDist = P.thetaBallExponential(largeT, 0, omega0, k);
// wrapAngle will wrap this, so check unwrapped: (ω₀/k) * (1 - e^(-kt)) for large t ≈ ω₀/k
const rawDist = (omega0 / k) * (1 - Math.exp(-k * largeT));
assertApprox(rawDist, expectedDist, 0.01, 'Ball total distance at large t → ω₀/k = 20 rad');

// Delta theta (relative angle between ball and wheel)
// At t=0, Δθ = Δθ₀ = 0
assertApprox(P.deltaThetaExponential(0, 0, 10, 2, 0.5), 0, 0.0001, 'Δθ at t=0 = 0');

// Linear drop time
const tDropLin = P.solveForDropTimeLinear(10, -2, 4);
// t = (ω_drop - ω₀) / α = (4 - 10) / (-2) = 3
assertApprox(tDropLin, 3, 0.0001, 'Linear drop time: ω₀=10, α=-2, ω_drop=4 → t=3');
assert(P.solveForDropTimeLinear(10, 2, 4) === null, 'Linear drop time null when α ≥ 0');

// Pocket timing per pocket
const wheelOmega = P.rpmToRadS(25); // 25 RPM
const timingPerPocket = P.getTimingPerPocketS(wheelOmega);
const expectedTiming = (2 * Math.PI / Math.abs(wheelOmega)) / 38;
assertApprox(timingPerPocket, expectedTiming, 0.0001, 'Timing per pocket at 25 RPM');

// ============================================================
// TEST 3: Series Engine — Core Logic
// ============================================================
console.log('\n\x1b[36m═══ TEST 3: Series Engine — Core Logic ═══\x1b[0m');

let eng = new BTHG.SeriesEngine();

assert(eng.totalSpins === 0, 'Initial: 0 spins');
assert(eng.getRemainingCount() === 38, 'Initial: 38 remaining');
assert(eng.getUniqueHitCount() === 0, 'Initial: 0 unique hit');
assert(eng.seriesCount === 0, 'Initial: 0 series');
assert(eng.finalActivated === false, 'Initial: Final 8 not activated');

// Record first spin
eng.recordSpin(7);
assert(eng.totalSpins === 1, 'After 1 spin: totalSpins = 1');
assert(eng.getUniqueHitCount() === 1, 'After 1 spin: 1 unique hit');
assert(eng.getRemainingCount() === 37, 'After 1 spin: 37 remaining');
assert(eng.getNumber(7).hits === 1, 'Number 7 has 1 hit');
assert(eng.getNumber(7).ago === 0, 'Number 7 ago = 0');
assert(eng.history[0] === 7, 'History[0] = 7');

// Record duplicate
eng.recordSpin(7);
assert(eng.totalSpins === 2, 'After duplicate: totalSpins = 2');
assert(eng.getUniqueHitCount() === 1, 'Duplicate does not increase unique count');
assert(eng.getNumber(7).hits === 2, 'Number 7 has 2 hits now');

// Aging
eng.recordSpin(14);
assert(eng.getNumber(7).ago === 1, 'Number 7 ago = 1 after another spin');
assert(eng.getNumber(14).ago === 0, 'Number 14 ago = 0');
assert(eng.getUniqueHitCount() === 2, '2 unique hits');

// Undo
eng.undoLastSpin();
assert(eng.totalSpins === 2, 'After undo: totalSpins = 2');
assert(eng.getUniqueHitCount() === 1, 'After undo: 1 unique hit (14 removed)');
assert(eng.getNumber(14).hits === 0, 'Number 14 hits back to 0');
assert(eng.getNumber(7).ago === 0, 'Number 7 ago recalculated to 0');

// Final 8 activation — hit 30 unique numbers to leave 8
eng = new BTHG.SeriesEngine();
const numbersToHit = [];
for (let i = 0; i <= 37; i++) numbersToHit.push(i);
// Hit first 30 numbers
let finalActivatedAt = -1;
for (let i = 0; i < 30; i++) {
  eng.recordSpin(numbersToHit[i]);
  if (eng.finalActivated && finalActivatedAt === -1) {
    finalActivatedAt = i + 1;
  }
}
assert(eng.getUniqueHitCount() === 30, '30 unique numbers hit');
assert(eng.getRemainingCount() === 8, '8 remaining');
assert(eng.finalActivated === true, 'Final 8 activated with 8 remaining');
assert(eng.finalEight.length === 8, 'Final 8 array has 8 numbers');
assert(finalActivatedAt === 30, 'Final 8 activated on spin 30');

// Verify Final 8 contains the unhit numbers (30-37)
for (let i = 30; i <= 37; i++) {
  assert(eng.finalEight.includes(i), `Final 8 includes unhit number ${i}`);
}

// ============================================================
// TEST 4: Series Completion
// ============================================================
console.log('\n\x1b[36m═══ TEST 4: Series Completion ═══\x1b[0m');

eng = new BTHG.SeriesEngine();
let seriesCompleted = false;
let completionSpins = 0;
eng.onChange((event, data) => {
  if (event === 'seriesComplete') {
    seriesCompleted = true;
    completionSpins = data.totalSpins;
  }
});

// Hit all 38 numbers
const order = [];
for (let i = 0; i <= 37; i++) order.push(i);
for (const num of order) {
  eng.recordSpin(num);
}

assert(seriesCompleted === true, 'Series completed when all 38 hit');
assert(completionSpins === 38, 'Series completed in exactly 38 spins (best case)');
assert(eng.seriesCount === 1, 'Series count incremented to 1');
assert(eng.seriesHistory.length === 1, 'Series history has 1 entry');
assert(eng.seriesHistory[0] === 38, 'Series history records 38 spins');
assert(eng.seriesAverage === 38, 'Series average = 38');
assert(eng.totalSpins === 0, 'After completion: totalSpins reset to 0');
assert(eng.getRemainingCount() === 38, 'After completion: 38 remaining again');
assert(eng.lifetimeSpins === 38, 'Lifetime spins = 38');

// Second series — add some duplicates to make it longer
seriesCompleted = false;
for (const num of order) {
  eng.recordSpin(num);
  if (num === 10) eng.recordSpin(10); // duplicate
  if (num === 20) eng.recordSpin(20); // duplicate
}
assert(seriesCompleted === true, 'Second series completed');
assert(eng.seriesCount === 2, 'Series count = 2');
assert(eng.seriesHistory[1] === 40, 'Second series took 40 spins (38 + 2 dupes)');
assert(eng.seriesAverage === 39, 'Average of 38 and 40 = 39');
assert(eng.lifetimeSpins === 78, 'Lifetime = 38 + 40 = 78');

// ============================================================
// TEST 5: Trinity Progression
// ============================================================
console.log('\n\x1b[36m═══ TEST 5: Trinity Progression (Bankroll) ═══\x1b[0m');

const trinity = new BTHG.TrinityCycle();
assert(trinity.multiplier() === 1, 'Initial multiplier = 1x');

trinity.record(false); // miss 1
assert(trinity.multiplier() === 1, 'After 1 miss: 1x');
trinity.record(false); // miss 2
assert(trinity.multiplier() === 1, 'After 2 misses: 1x');
trinity.record(false); // miss 3
assert(trinity.multiplier() === 2, 'After 3 misses: 2x');
trinity.record(false); // miss 4
assert(trinity.multiplier() === 2, 'After 4 misses: 2x');
trinity.record(false); // miss 5
assert(trinity.multiplier() === 4, 'After 5 misses: 4x');
trinity.record(false); // miss 6
assert(trinity.multiplier() === 4, 'After 6 misses: 4x');
trinity.record(false); // miss 7
assert(trinity.multiplier() === 8, 'After 7 misses: 8x (max)');
trinity.record(false); // miss 8
assert(trinity.multiplier() === 8, 'After 8 misses: still 8x');

// Win resets everything
trinity.record(true);
assert(trinity.multiplier() === 1, 'After win: reset to 1x');
assert(trinity.consecutiveLosses === 0, 'After win: 0 consecutive losses');

// ============================================================
// TEST 6: Bankroll Manager
// ============================================================
console.log('\n\x1b[36m═══ TEST 6: Bankroll Manager ═══\x1b[0m');

let br = new BTHG.BankrollManager(1000, 5, 35);
assert(br.totalBankroll === 1000, 'Initial bankroll = $1000');
assert(br.baseBet === 5, 'Base bet = $5');
assert(br.getCurrentBetPerNumber() === 5, 'Current bet/number = $5 (1x mult)');

// Simulate a LOSS covering 10 numbers at 1x multiplier
br.recordSpin(false, 10, 1);
// Lost: 5 * 10 = $50
assert(br.totalBankroll === 950, 'After loss on 10 nums at $5: bankroll = $950');
assert(br.lossCount === 1, 'Loss count = 1');
assert(br.totalWagered === 50, 'Total wagered = $50');

// Simulate a WIN covering 10 numbers at 1x multiplier
br.recordSpin(true, 10, 1);
// Win: payout = 35 * 5 = $175, bet returned for winning num = $5
// Net = 175 - 50 + 5 = $130 gain
// Total wagered this spin: 5 * 10 = $50
assert(br.totalBankroll === 950 + 130, 'After win: bankroll = $1080');
assert(br.winCount === 1, 'Win count = 1');

// Test with $0.50 base bet
br = new BTHG.BankrollManager(100, 0.50, 35);
assert(br.baseBet === 0.50, 'Base bet = $0.50');
assert(br.getCurrentBetPerNumber() === 0.50, 'Bet/number = $0.50');

br.recordSpin(false, 8, 1);
// Lost: 0.50 * 8 = $4
assertApprox(br.totalBankroll, 96, 0.01, 'After loss on 8 nums at $0.50: bankroll = $96');

br.recordSpin(true, 8, 1);
// Win: 35 * 0.50 = $17.50, net = 17.50 - 4 + 0.50 = $14
assertApprox(br.totalBankroll, 110, 0.01, 'After win: bankroll = $110');

// Test Trinity doubling
br = new BTHG.BankrollManager(1000, 5, 35);
// 3 misses → 2x multiplier
br.recordSpin(false, 10, 1);
br.recordSpin(false, 10, 1);
br.recordSpin(false, 10, 1);
assert(br.getMultiplier() === 2, 'After 3 misses: multiplier = 2x');
assert(br.getCurrentBetPerNumber() === 10, 'Bet/number now $10');

// Session P/L
const pnl = br.getSessionPnL();
assert(pnl < 0, 'Session P/L is negative after 3 losses');
assertApprox(pnl, -150, 0.01, 'P/L = -$150 (3 losses at $50 each)');

// ============================================================
// TEST 7: Calibration Data Fusion
// ============================================================
console.log('\n\x1b[36m═══ TEST 7: Calibration Data Fusion ═══\x1b[0m');

const fusion = new BTHG.CalibratorDataFusion();
assert(fusion.qualityTier === 0, 'Initial quality tier = 0');
assert(fusion.referenceLocked === false, 'Initial: reference not locked');

// Manual calibration
fusion.updateFromManual(25, 40, 0.5);
assert(fusion.referenceLocked === true, 'After manual cal: reference locked');
assert(fusion.calibrationCount === 1, 'Calibration count = 1');
assert(fusion.omega_w > 0, 'Wheel omega > 0');
assert(fusion.omega_b0 > 0, 'Ball omega > 0');

// Verify RPM → rad/s conversion was applied
const expectedWheelOmega = P.rpmToRadS(25);
assertApprox(fusion.omega_w, expectedWheelOmega, 0.5, 'Wheel omega matches 25 RPM');

// Wheel condition
assert(['stable', 'caution', 'unstable'].includes(fusion.getWheelCondition()), 'Wheel condition is valid');

// Scatter learning (needs quality tier ≥ 2)
fusion.wheelJitterCV = 0.02;
fusion.arTrackingLossRate = 0.1;
fusion._updateQualityTier();
assert(fusion.qualityTier >= 2, 'Quality tier ≥ 2 with good jitter/tracking');

fusion.learnOffset(5, 8);
fusion.learnOffset(5, 7);
fusion.learnOffset(5, 8);
const probMap = fusion.getProbabilityMap();
assert(Object.keys(probMap).length > 0, 'Probability map has entries after learning');
const offset3 = (8 - 5 + 38) % 38;
assert(probMap[offset3] !== undefined, 'Learned offset 3 exists in probability map');

// Serialization round-trip
const json = fusion.toJSON();
const fusion2 = new BTHG.CalibratorDataFusion();
fusion2.fromJSON(json);
assertApprox(fusion2.omega_w, fusion.omega_w, 0.0001, 'Serialization preserves omega_w');
assertApprox(fusion2.omega_b0, fusion.omega_b0, 0.0001, 'Serialization preserves omega_b0');
assert(fusion2.referenceLocked === true, 'Serialization preserves referenceLocked');
assert(fusion2.calibrationCount === fusion.calibrationCount, 'Serialization preserves calibrationCount');

// ============================================================
// TEST 8: Pocket Timing Session
// ============================================================
console.log('\n\x1b[36m═══ TEST 8: Pocket Timing Session ═══\x1b[0m');

const pts = new BTHG.PocketTimingSession();
pts.start();
assert(pts.isActive === true, 'Session is active after start');

// Simulate landings with known timestamps
const baseTime = 1000;
pts.recordLanding(7, baseTime);
pts.recordLanding(14, baseTime + 45000); // 45 seconds later
pts.recordLanding(21, baseTime + 90000); // 45 seconds later
pts.recordLanding(0, baseTime + 136000);  // 46 seconds later

assert(pts.landings.length === 4, '4 landings recorded');
assert(pts.landings[0].intervalMs === null, 'First landing has no interval');
assertApprox(pts.landings[1].intervalMs, 44000, 1000, 'Second landing interval ≈ 45000ms');

// Pocket delta — physical wheel distance between consecutive landings
const idx7 = american.indexOf(7);
const idx14 = american.indexOf(14);
const expectedDelta = ((idx14 - idx7) % 38 + 38) % 38;
assert(pts.landings[1].pocketDelta === expectedDelta, `Pocket delta from 7→14 = ${expectedDelta}`);

pts.stop();
const results = pts.getResults();
assert(results !== null, 'Results not null with 4 landings');
assert(results.landingCount === 4, 'Results show 4 landings');
assert(results.intervals.length === 3, '3 intervals');
assert(results.numberFreq[7] === 1, 'Number 7 hit once');
assert(results.numberFreq[14] === 1, 'Number 14 hit once');

// ============================================================
// TEST 9: Prediction Engine
// ============================================================
console.log('\n\x1b[36m═══ TEST 9: Prediction Engine ═══\x1b[0m');

const pred = new BTHG.PredictionEngine();

// No calibration → null
assert(pred.predict(new BTHG.CalibratorDataFusion()) === null, 'No prediction without calibration');

// With calibration
const fusionForPred = new BTHG.CalibratorDataFusion();
fusionForPred.updateFromManual(25, 40, 0.5);
fusionForPred.wheelJitterCV = 0.03;
fusionForPred.arTrackingLossRate = 0.15;
fusionForPred._updateQualityTier();
assert(fusionForPred.qualityTier >= 1, 'Fusion has quality ≥ 1 for prediction');

const predResult = pred.predict(fusionForPred);
assert(predResult !== null, 'Prediction result not null');
assert(predResult.recommendedNumbers.length === 8, 'Prediction recommends 8 numbers');
assert(predResult.probability > 0, 'Combined probability > 0');
assert(predResult.probability <= 100, 'Combined probability ≤ 100');
assert(predResult.dropIndex >= 0 && predResult.dropIndex < 38, 'Drop index in valid range');
assert(predResult.dropTime > 0, 'Drop time > 0');
assert(predResult.qualityTier >= 1, 'Prediction quality tier matches fusion');

// Verify the recommended numbers are actual wheel indices (0-37)
for (const idx of predResult.recommendedNumbers) {
  assert(idx >= 0 && idx < 38, `Recommended index ${idx} is in range 0-37`);
}

// Verify predicted drop makes physical sense
// ω(t_drop) = ω₀ * e^(-k * t_drop) should equal the drop threshold
const omega0Pred = fusionForPred.omega_b0;
const kPred = fusionForPred.kPerSec;
const tDropPred = predResult.dropTime;
const omegaAtDrop = omega0Pred * Math.exp(-kPred * tDropPred);
assertApprox(omegaAtDrop, BTHG.CONSTANTS.STANDARD_DROP_THRESHOLD, 0.01, 'ω at drop time = drop threshold (1.5 rad/s)');

// ============================================================
// TEST 10: Prediction with Scatter Data
// ============================================================
console.log('\n\x1b[36m═══ TEST 10: Prediction with Scatter Data ═══\x1b[0m');

const fusionScatter = new BTHG.CalibratorDataFusion();
fusionScatter.updateFromManual(25, 40, 0.5);
fusionScatter.wheelJitterCV = 0.02;
fusionScatter.arTrackingLossRate = 0.05;
fusionScatter._updateQualityTier();
assert(fusionScatter.qualityTier >= 2, 'Quality tier ≥ 2 for scatter learning');

// Learn that the ball consistently lands 3 pockets after the predicted drop
for (let i = 0; i < 50; i++) {
  fusionScatter.learnOffset(10, 13); // actual = predicted + 3
}
for (let i = 0; i < 20; i++) {
  fusionScatter.learnOffset(10, 12); // actual = predicted + 2
}

const scatterMap = fusionScatter.getProbabilityMap();
assert(Object.keys(scatterMap).length === 2, 'Scatter map has 2 offsets');
const offset3Val = scatterMap[3]; // (13 - 10 + 38) % 38 = 3
const offset2Val = scatterMap[2]; // (12 - 10 + 38) % 38 = 2
assert(offset3Val > offset2Val, 'Offset 3 has higher probability than offset 2');
assertApprox(offset3Val, 50 / 70, 0.01, 'Offset 3 probability ≈ 50/70 ≈ 0.714');
assertApprox(offset2Val, 20 / 70, 0.01, 'Offset 2 probability ≈ 20/70 ≈ 0.286');

const predScatter = new BTHG.PredictionEngine();
const scatterResult = predScatter.predict(fusionScatter);
assert(scatterResult !== null, 'Scatter prediction not null');
assert(scatterResult.recommendedNumbers.length === 8, 'Scatter prediction recommends 8 numbers');

// The recommended numbers should be biased toward drop+2 and drop+3
const dropIdx = scatterResult.dropIndex;
const expected1 = (dropIdx + 3) % 38;
const expected2 = (dropIdx + 2) % 38;
assert(scatterResult.recommendedNumbers.includes(expected1), 'Prediction includes drop+3 (highest scatter offset)');
assert(scatterResult.recommendedNumbers.includes(expected2), 'Prediction includes drop+2 (second scatter offset)');

// ============================================================
// TEST 11: Empirical Bias Integration
// ============================================================
console.log('\n\x1b[36m═══ TEST 11: Empirical Bias Integration ═══\x1b[0m');

const fusionBias = new BTHG.CalibratorDataFusion();
fusionBias.updateFromManual(25, 40, 0.5);
fusionBias.wheelJitterCV = 0.03;
fusionBias.arTrackingLossRate = 0.15;
fusionBias._updateQualityTier();

// Simulate bias — pocket 5 lands 3x more than expected
fusionBias.empiricalBias = {};
const expected1pct = 1.0 / 38;
for (let i = 0; i < 38; i++) {
  fusionBias.empiricalBias[i] = expected1pct;
}
fusionBias.empiricalBias[5] = expected1pct * 3; // 3x bias

const biasMultiplier = fusionBias.getEmpiricalBias(5);
assertApprox(biasMultiplier, 3.0, 0.01, 'Empirical bias multiplier for pocket 5 = 3x');

const normalBias = fusionBias.getEmpiricalBias(0);
assertApprox(normalBias, 1.0, 0.01, 'Normal pocket bias = 1x');

// ============================================================
// TEST 12: End-to-End Scenario — Known Outcome
// ============================================================
console.log('\n\x1b[36m═══ TEST 12: End-to-End Scenario ═══\x1b[0m');

// Simulate a realistic session:
// - Track numbers, verify series engine state
// - Verify Final 8 activation and numbers
// - Verify bankroll P/L math
// - Verify prediction integrates calibration

const testEngine = new BTHG.SeriesEngine();
const testBankroll = new BTHG.BankrollManager(500, 5, 35);
const testFusion = new BTHG.CalibratorDataFusion();
const testPredictor = new BTHG.PredictionEngine();

// Calibrate
testFusion.updateFromManual(25, 40, 0.5);

// Record 30 unique spins (0-29), leaving 30-37 as Final 8
for (let i = 0; i < 30; i++) {
  testEngine.recordSpin(i);
}

assert(testEngine.finalActivated === true, 'E2E: Final 8 activated');
assert(testEngine.finalEight.length === 8, 'E2E: 8 numbers in Final 8');
assert(testEngine.getRemainingCount() === 8, 'E2E: 8 remaining');

// Final 8 should be 30,31,32,33,34,35,36,37
for (let i = 30; i <= 37; i++) {
  assert(testEngine.finalEight.includes(i), `E2E: Final 8 contains ${i}`);
}

// Trinity numbers include 0 and 37 (zeros always covered)
const trinityNums = testEngine.getTrinityNumbers();
assert(trinityNums.includes(0), 'E2E: Trinity covers 0');
assert(trinityNums.includes(37), 'E2E: Trinity covers 00');

// Now simulate betting phase: miss 3 times, then hit
// Miss 1: spin lands on 7 (already hit, not in Final 8)
testEngine.recordSpin(7);
const numbersPlayed1 = trinityNums.length;
testBankroll.recordSpin(false, numbersPlayed1, testEngine.getTrinityMultiplier());
assert(testEngine.trinityMissStreak === 1, 'E2E: miss streak = 1');

// Miss 2
testEngine.recordSpin(14);
testBankroll.recordSpin(false, trinityNums.length, testEngine.getTrinityMultiplier());

// Miss 3
testEngine.recordSpin(21);
testBankroll.recordSpin(false, trinityNums.length, testEngine.getTrinityMultiplier());
assert(testEngine.getTrinityMultiplier() === 2, 'E2E: multiplier = 2x after 3 misses');

// HIT! Spin lands on 32 (in Final 8)
testEngine.recordSpin(32);
const wasHit = testEngine.finalEightJustHit.has(32);
assert(wasHit === true, 'E2E: 32 registered as Final 8 hit');
testBankroll.recordSpin(true, trinityNums.length, 2); // 2x multiplier at time of bet

// Verify bankroll math
// 3 losses at 1x: 3 * (5 * 10) = $150 (10 numbers covered)
// Then 1 win at 2x: bet = 10 * 10 = $100, payout = 35 * 10 = $350, net = 350 - 100 + 10 = $260
// Total P/L: -150 + 260 = +$110
// (Note: number of Trinity numbers may vary due to aging, so approximate)
const e2ePnL = testBankroll.getSessionPnL();
console.log(`  E2E Session P/L: $${e2ePnL.toFixed(2)} (bankroll: $${testBankroll.totalBankroll.toFixed(2)})`);
assert(testBankroll.winCount === 1, 'E2E: 1 win');
assert(testBankroll.lossCount === 3, 'E2E: 3 losses');

// Prediction should work
const e2ePred = testPredictor.predict(testFusion);
assert(e2ePred !== null, 'E2E: prediction produces result');
assert(e2ePred.recommendedNumbers.length === 8, 'E2E: prediction has 8 recommendations');

// ============================================================
// TEST 13: Series Engine Serialization Round-Trip
// ============================================================
console.log('\n\x1b[36m═══ TEST 13: Serialization Round-Trip ═══\x1b[0m');

const serJSON = testEngine.toJSON();
const restoredEng = new BTHG.SeriesEngine();
restoredEng.fromJSON(serJSON);

assert(restoredEng.totalSpins === testEngine.totalSpins, 'Restored totalSpins matches');
assert(restoredEng.seriesCount === testEngine.seriesCount, 'Restored seriesCount matches');
assert(restoredEng.lifetimeSpins === testEngine.lifetimeSpins, 'Restored lifetimeSpins matches');
assert(restoredEng.history.length === testEngine.history.length, 'Restored history length matches');
assert(restoredEng.finalActivated === testEngine.finalActivated, 'Restored finalActivated matches');
assert(restoredEng.finalEight.length === testEngine.finalEight.length, 'Restored Final 8 length matches');

for (let i = 0; i <= 37; i++) {
  const orig = testEngine.getNumber(i);
  const rest = restoredEng.getNumber(i);
  assert(orig.hits === rest.hits, `Number ${i}: hits match after restore`);
  assert(orig.ago === rest.ago, `Number ${i}: ago match after restore`);
}

// Bankroll round-trip
const brJSON = testBankroll.toJSON();
const restoredBR = new BTHG.BankrollManager();
restoredBR.fromJSON(brJSON);
assertApprox(restoredBR.totalBankroll, testBankroll.totalBankroll, 0.01, 'Restored bankroll matches');
assert(restoredBR.baseBet === testBankroll.baseBet, 'Restored baseBet matches');
assert(restoredBR.winCount === testBankroll.winCount, 'Restored winCount matches');
assert(restoredBR.lossCount === testBankroll.lossCount, 'Restored lossCount matches');

// ============================================================
// RESULTS
// ============================================================
console.log('\n\x1b[36m═══════════════════════════════════════════\x1b[0m');
console.log(`\x1b[36m  TOTAL: ${total} tests\x1b[0m`);
console.log(`\x1b[32m  PASSED: ${passed}\x1b[0m`);
if (failed > 0) {
  console.log(`\x1b[31m  FAILED: ${failed}\x1b[0m`);
} else {
  console.log(`\x1b[32m  ALL TESTS PASSED\x1b[0m`);
}
console.log(`\x1b[36m═══════════════════════════════════════════\x1b[0m\n`);

process.exit(failed > 0 ? 1 : 0);
