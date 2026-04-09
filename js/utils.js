// ============================================================
// utils.js — Color maps, wheel layouts, constants, helpers
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// Contains: CONSTANTS, WHEEL_LAYOUTS (American physical order),
//   color maps, TABLE_GRID (felt layout), SIDE_BETS, BET_AMOUNTS,
//   formatMoney, wrapAngle, angleToIndex, parseNumber, displayNumber
// ============================================================

const BTHG = window.BTHG || {};

// ---- Constants ------------------------------------------------
BTHG.CONSTANTS = {
  AMERICAN_N: 38,
  EUROPEAN_N: 37,
  TWO_PI: 2 * Math.PI,
  POCKET_ANGLE: (2 * Math.PI) / 38,
  STANDARD_DROP_THRESHOLD: 1.5,   // rad/s
  DEFAULT_WHEEL_DIAMETER: 80.0,   // cm
  DEFAULT_K_PER_SEC: 0.5,
  FINAL_TARGET_COUNT: 8,
  FINAL_EIGHT_AGE_LIMIT: 2,
  DEFAULT_BASE_BET: 5.0,
  DEFAULT_BANKROLL: 1000.0,
  DEFAULT_PAYOUT_RATIO: 35,
  P_DROP_PEAK: 0.6,
  P_DROP_NEIGHBORS: 0.2,
  GLOW_PULSE_DURATION: 1.2,
  ALERT_SHOW_DURATION: 2.0,
};

// ---- American Wheel Layout (physical order) -------------------
BTHG.WHEEL_LAYOUTS = {
  american: [
    0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
    37, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2
  ],
  european: [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ]
};

// ---- Number Colors --------------------------------------------
BTHG.REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
BTHG.BLACKS = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);
BTHG.GREENS = new Set([0, 37]); // 37 = "00"

BTHG.colorForNumber = function(n) {
  if (BTHG.GREENS.has(n)) return 'green';
  if (BTHG.REDS.has(n))   return 'red';
  return 'black';
};

BTHG.displayNumber = function(n) {
  if (n === 37) return '00';
  return String(n);
};

BTHG.parseNumber = function(s) {
  if (s === '00') return 37;
  const n = parseInt(s, 10);
  return (isNaN(n) || n < 0 || n > 36) ? null : n;
};

// ---- Color Palette --------------------------------------------
BTHG.COLORS = {
  feltGreen:     '#2FC219',
  redRoulette:   'rgb(255, 31, 0)',
  blackRoulette: 'rgb(13, 13, 13)',
  zeroGreen:     'rgb(0, 179, 77)',
  goldRoulette:  'rgb(242, 209, 89)',
  yellowRoulette:'rgb(255, 204, 26)',
  blueRoulette:  'rgb(0, 140, 255)',
  finalGreen:    '#5EFF00',
  cellBase:      'rgba(18, 23, 20, 1)',
  controlBar:    'rgba(20, 26, 23, 1)',
  tableBorder:   'rgba(255, 255, 255, 0.25)',
  gold:          '#d4af37',
  bgDark:        '#0a0a0a',
};

// ---- Table Grid Layout ----------------------------------------
// Standard American roulette felt layout
BTHG.TABLE_GRID = {
  // 3 rows × 12 columns of numbers
  rows: [
    [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],  // top
    [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],  // mid
    [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],  // bot
  ],
  dozens: ['1st 12', '2nd 12', '3rd 12'],
  bands:  ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36'],
  columns: ['2:1 Top', '2:1 Mid', '2:1 Bot'],
};

// ---- Side Bet Predicates --------------------------------------
BTHG.SIDE_BETS = {
  '1st 12':  n => n >= 1 && n <= 12,
  '2nd 12':  n => n >= 13 && n <= 24,
  '3rd 12':  n => n >= 25 && n <= 36,
  '1-18':    n => n >= 1 && n <= 18,
  '19-36':   n => n >= 19 && n <= 36,
  'EVEN':    n => n !== 0 && n !== 37 && n % 2 === 0,
  'ODD':     n => n !== 0 && n !== 37 && n % 2 === 1,
  'RED':     n => BTHG.REDS.has(n),
  'BLACK':   n => BTHG.BLACKS.has(n),
  '2:1 Top': n => n > 0 && n !== 37 && n % 3 === 0,
  '2:1 Mid': n => n > 0 && n !== 37 && n % 3 === 2,
  '2:1 Bot': n => n > 0 && n !== 37 && n % 3 === 1,
};

// ---- Aging Color (Final 8) ------------------------------------
BTHG.agingColor = function(age) {
  if (age === 0) return '#5EFF00';  // green — active, not yet hit
  if (age === 1) return '#FFCC1A';  // yellow — 1 spin left before removal
  if (age === 2) return '#FF3300';  // red — last spin, removing next
  return '#888';                    // removing
};

// ---- Helpers --------------------------------------------------
BTHG.wrapAngle = function(x) {
  const TWO_PI = BTHG.CONSTANTS.TWO_PI;
  let mod = x % TWO_PI;
  return mod < 0 ? mod + TWO_PI : mod;
};

BTHG.angleToIndex = function(angle, N) {
  N = N || BTHG.CONSTANTS.AMERICAN_N;
  const pocketAngle = BTHG.CONSTANTS.TWO_PI / N;
  const wrapped = BTHG.wrapAngle(angle);
  const index = Math.floor(wrapped / pocketAngle);
  return Math.max(0, Math.min(N - 1, index));
};

BTHG.generateId = function() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

BTHG.formatTimer = function(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

BTHG.clamp = function(val, min, max) {
  return Math.max(min, Math.min(max, val));
};

// ---- Valid Bet Amounts ----------------------------------------
// $0.50 intervals up to $1, $1 intervals up to $10, $5 intervals up to $100
BTHG.BET_AMOUNTS = [0.50, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

BTHG.formatMoney = function(amount) {
  if (amount % 1 !== 0) return '$' + amount.toFixed(2);
  return '$' + amount;
};

window.BTHG = BTHG;
