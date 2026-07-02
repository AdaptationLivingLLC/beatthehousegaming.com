# BTHG Web App Major Upgrade — Design Spec
Date: 2026-07-01
Approach: Staged upgrade in place. Keep the vanilla JS architecture, no build step, same repo (`AdaptationLivingLLC/beatthehousegaming.com`), same Vercel auto-deploy. Engine code is remodeled, not rewritten from scratch.

## Context and known defects this build must fix
- Trinity P&L booked every 0/00 hit as a loss despite coverage (partial fix exists uncommitted in `js/roulette-table.js`).
- Fixed Trinity ladder (1,1,1,2,2,4,4,8...) cannot guarantee recovery: two spins deep at 8x, a win no longer clears cumulative losses.
- Series auto-close does not clear `engine.history`; a real export showed 67 stale spins carried into the new series.
- `lifetimeSpins` counter drifts vs `seriesHistory` totals.
- Bankroll stats (`winCount`, `lossCount`, `totalWagered`) stay 0 when `bettingEnabled:false`.
- `finalEightAges` / `finalEightFirstHit` never populate.
- Bankroll panel had no way to set starting bankroll or bet (partial fix exists uncommitted in `js/app.js`).
- Calibrator: `compute()` sorts tap intervals, then uses sorted first/last as chronological first/last, corrupting the deceleration constant k. Units are not clearly labeled on screen.
- Series end wipes visuals and counters.

## 1. Layout and UI shell
Three responsive layouts, auto-selected by viewport:
- **iPhone landscape (primary phone mode):** the table fills the screen edge to edge. Minimum touch target 48px (iPhone 7 = 667x375 CSS px). Thin status strip: spin count, series state, bankroll, Trinity level. Phone portrait shows a rotate-device prompt, not a squished table.
- **iPad:** table across the top 1/3 of the screen; bottom 2/3 is the live intelligence feed (pattern alerts, system messages, Trinity status, bet signals), newest on top, scrollable.
- **Desktop:** wide layout, table left, intelligence feed right.

**Themes:** one button cycles design modes, implemented as CSS custom-property token sets on `<body>`:
- Casino: refined gold/green/black, professional.
- Midnight: dark, low-glow, discreet.
- Paper: light, flat, deliberately boring (spreadsheet look).
Theme choice persists in Settings.

## 2. Stealth screen (fake iMessage view)
- A corner button instantly swaps the entire app for a pixel-faithful Apple Messages screen (iOS style: gray incoming bubbles, blue outgoing, correct fonts/spacing). Browser tab title switches to "Messages"; no BTHG branding visible anywhere.
- Pre-loaded scrollable bubbles, top to bottom:
  1. Calibrator reminder + step-by-step calibrator instructions.
  2. How to enter numbers from stealth: "You can still track numbers from here. Just enter the next number that comes up and put a comma next to it, then add the number after that separated by a comma from the next and so on. When you hit send they will be added to current series count. Type BACK to go back to the table view."
  3. How the Trinity works.
  4. Real simulated betting streak walkthroughs (produced by the Section 5 simulation runs).
  5. App/system info.
- The input bar is functional: `4,17,32,0` + send appends those spins to the live series in order (accepts 0 and 00; validates each token, rejects bad tokens with a reply bubble saying which ones failed). `BACK` (case-insensitive) returns to table view.
- Entered spins fire the same engine path as table taps (Trinity, patterns, persistence all update).

## 3. Data persistence and series end
- On series end (auto or manual): nothing wipes. Board keeps all counters/visuals, slightly grayed, with a SERIES COMPLETE banner.
- Two actions: **New Series** (archives full spin-by-spin record to IndexedDB, then clears the board) and **Keep Reviewing** (stays indefinitely).
- Archive stores per series: ordered spins, timestamps, Final 8 set, entry spin, closer arrival offsets, end type, machine profile id, casino, bankroll/P&L trace.
- Fixes: clear `engine.history` and reset `totalSpins` on auto-close; make `lifetimeSpins` derive from stored data instead of a drifting counter; populate `finalEightAges`/`finalEightFirstHit`; decouple P&L logging from `bettingEnabled`.

## 4. Pattern engine (new module `js/pattern-engine.js`)
Runs against all archived series + live series, recomputes after every spin. Reports only from this user's actual machine data. Every alert displays its sample size. Detectors:
- **Follower patterns:** for each number, distribution of what arrives in the next 1 to 3 spins; flag pairings that beat chance across series (with count shown, e.g. "seen 6 of 7 times").
- **Gap behavior:** for each number at its current drought depth, how that depth resolved historically. Example alert: "26 out 65 spins. At 65+, hit within 2 spins in 4 of 4 past series."
- **Cycle timing:** live position vs archived series curve. "Spin 42, Final 8 entered. Across your last 4 series, closers 1 to 3 landed within 14 spins of entry."
- **Entry signal (self-adjusting):** learns most profitable entry/exit windows from archived data; initial seed from real data = enter at Final 8 activation, bank first 3 closers, hard stop. Re-derives windows as series accumulate. Displays BET / HOLD / STOP with one-line reasoning, visible in both phone and iPad layouts.
- All physical-position analytics (neighbors, arcs, sectors) use the verified wheel layout from Section 8.

## 5. Trinity rebuilt: computed, cap-aware, simulation-verified
- Replace the fixed ladder with a computed progression: after each miss, multiplier m_next = smallest unit step such that a hit on the next spin clears all money spent this cycle plus a profit floor (default: +1 base unit). Formula for N covered numbers at unit u: win nets 35*m*u minus (N-1)*m*u; requirement is win_net >= cumulative_spent + floor. Solve for m, round up to the table's betting unit increment.
- Coverage set: Final 8 + 0 + 00 (10 numbers) as today; wins detected against the full coverage set.
- **Cap awareness:** uses the user-entered per-machine limits (Section 7). When required m*u exceeds the max betting unit per number, alert: "SPLIT: SECOND SCREEN NEEDED" with exact per-screen amounts. Also warns when bankroll cannot cover the next required bet.
- **Verification gate (must pass before ship):** simulation harness runs the progression against the 2 real archived series + 10,000 generated fair-wheel series. Assertions: (a) any hit at any depth always ends the cycle at >= +floor; (b) reported P&L matches the spin-by-spin cash ledger exactly; (c) cap alerts fire at exactly the right depth for given limits. Selected sim streaks become stealth-screen example bubbles.

## 6. Calibrator fix
- Preserve chronological order: compute median for outlier filtering on a copy; derive first/last intervals and k from the time-ordered valid sequence.
- Label all displayed readings in real units: seconds per revolution, RPM, and k in 1/s, so readings can be sanity-checked with a stopwatch.
- Sanity bounds on results (ball RPM plausible range, k plausible range) with a clear "measurement rejected, re-tap" message instead of silently storing garbage.

## 7. Bankroll manager rebuilt
- Setup fields (blank until user fills): **Starting Bankroll**, **Table Minimum Betting Unit** (>= $0.25), **Table Maximum Betting Unit** (<= $1,500). Saved per machine profile.
- **Recommended starting bankroll:** computed from the worst progression depth in archived series plus safety layer; the math is shown, not just the number.
- **Betting path projection:** if Trinity is followed exactly at this table with this bankroll: expected profit per completed series, expected spins per series (from archived data), and a live "projected vs actual" line during play.
- Session P&L always visible; changing bankroll re-baselines cleanly (no phantom losses).

## 8. Wheel layout verifier
- Default = standard American wheel order. Each machine profile has a Verify Wheel option.
- Manual entry screen instruction: "Starting from 00, input all the numbers in order starting at the right of 00 until you get back to 00." Large touch number pad; live progress display around the wheel; validation = all 38 numbers exactly once, with the exact error position identified on failure.
- Verified layout saves to the machine profile and drives all physical-position pattern logic. Nonstandard/European layouts follow whatever was verified.

## Architecture notes
- New files: `js/pattern-engine.js`, `js/stealth.js`, `js/machine-profile.js`, `js/trinity.js` (extracted/rebuilt from series-engine betting logic), `css/themes.css`. `tests/` gains a simulation harness runnable with `node tests/simulate-trinity.mjs`.
- `js/app.js` (55KB) is decomposed as it is touched: overlay/panel code moves to `js/panels.js`. No framework, no build step.
- Machine profile (id, casino, table limits, wheel layout, calibration data) becomes the single per-machine record in storage; series archives reference it.
- Existing IndexedDB (SpinDB/SeriesDB) is the storage backbone; schema gains machine profile store + closer-offset fields. Migration preserves the two real archived series.

## Testing
- Trinity simulation gate (Section 5) is mandatory before deploy.
- Pattern engine unit tests against the two real series with known answers (e.g. Series 2 closer offsets +4,+9,+14,+19,+26,+35,+45,+60).
- Calibrator compute() unit test with synthetic tap sequences of known RPM/k.
- Manual device pass: iPhone 7 Safari landscape + iPad before each deploy.

## Out of scope
- Payments/paywall changes, camera/AR tracking, native apps, repo/hosting changes.
