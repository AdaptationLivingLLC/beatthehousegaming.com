// ============================================================
// roulette-table.js — Roulette grid UI, number tapping, side bets
// BTHG Roulette Breaker Web App (Ported from RouletteTableView.swift)
// Last modified: 2026-03-07
// Contains: RouletteTableUI — main app screen with felt table,
//   bankroll bar, Final 8 display, series tracker, side bets,
//   spin history (newest-left), betting toggle, physical wheel SVG,
//   physics status panel, series intelligence panel, how-it-works panel
// Two-column responsive layout (table left, analytics right on 960px+)
// ============================================================

(function() {
  const BTHG = window.BTHG;

  // Cold thresholds — numbers
  const NUM_COLD_THRESHOLD = 13;
  const NUM_VERY_COLD_THRESHOLD = 20;

  // Cold thresholds — sections (dozens, bands, columns)
  const SECTION_WARM_THRESHOLD = 12;  // subtle blue/green hue
  const SECTION_HOT_THRESHOLD = 16;   // cop lights (police flash)

  class RouletteTableUI {
    constructor(container, engine, bankroll, fusion, predictor) {
      this.container = container;
      this.engine = engine;
      this.bankroll = bankroll;
      this.fusion = fusion;
      this.predictor = predictor;
      this._listeners = [];
      this.bettingEnabled = false;
      this._nextBestSet = new Set();
    }

    render() {
      this.container.innerHTML = '';
      // The outer container (#app-root) stays unstyled — Task 7's layout
      // shell (css/app.css) targets #table-container as the thing that
      // goes edge-to-edge/fixed on phone landscape, and needs #intel-feed
      // as its sibling (both direct children of #app-root) for the
      // tablet/desktop grid split. See js/ui-shell.js + the
      // body.layout-* rules in app.css.
      this.container.className = '';

      const html = `
        <!-- Spin Counter — always visible, resets on series completion -->
        <div class="rt-spin-counter">
          <span class="rt-sc-label">TRACK #</span>
          <span class="rt-sc-number" id="spin-counter">0</span>
          <span class="rt-sc-of" id="spin-counter-remaining">38 remaining</span>
        </div>

        <!-- Bankroll Summary Bar -->
        <div class="rt-bankroll-bar">
          <div class="rt-br-item">
            <span class="rt-br-label">BANKROLL</span>
            <span class="rt-br-value" id="br-total">$0</span>
          </div>
          <div class="rt-br-item">
            <span class="rt-br-label">SESSION P&L</span>
            <span class="rt-br-value" id="br-session">$0</span>
          </div>
          <div class="rt-br-item">
            <span class="rt-br-label">BET/NUM</span>
            <span class="rt-br-value" id="br-bet">$0</span>
          </div>
          <div class="rt-br-item">
            <span class="rt-br-label">TRINITY</span>
            <span class="rt-br-value" id="br-mult">1x</span>
          </div>
        </div>

        <!-- Active Betting Detail Bar (visible when Final 8 active) -->
        <div class="rt-betting-detail-bar" id="betting-detail-bar" style="display:none;">
          <div class="rt-bd-item rt-betting-toggle-item">
            <label class="rt-betting-toggle" id="betting-toggle">
              <input type="checkbox" id="betting-toggle-input">
              <span class="rt-toggle-slider"></span>
              <span class="rt-toggle-label" id="betting-toggle-label">BET OFF</span>
            </label>
          </div>
          <div class="rt-bd-item">
            <span class="rt-bd-label">COVERING</span>
            <span class="rt-bd-value" id="bd-covering">0 nums</span>
          </div>
          <div class="rt-bd-item">
            <span class="rt-bd-label">TOTAL BET</span>
            <span class="rt-bd-value" id="bd-total-bet">$0</span>
          </div>
          <div class="rt-bd-item">
            <span class="rt-bd-label">WIN PAYS</span>
            <span class="rt-bd-value rt-positive" id="bd-win-pays">$0</span>
          </div>
          <div class="rt-bd-item">
            <span class="rt-bd-label">W / L</span>
            <span class="rt-bd-value" id="bd-win-loss">0 / 0</span>
          </div>
        </div>

        <!-- Final 8 Display -->
        <div class="rt-final8-bar">
          <span class="rt-f8-label">FINAL 8</span>
          <div class="rt-f8-chips" id="final8-display"></div>
        </div>

        <!-- Series Tracker -->
        <div class="rt-series-tracker">
          <div class="rt-series-top">
            <span class="rt-series-label">SERIES</span>
            <span id="series-spin" class="rt-series-spin">Spin 0</span>
            <span id="series-remaining" class="rt-series-left">38 unhit</span>
            <span id="series-avg" class="rt-series-avg">Avg: --</span>
          </div>
          <div class="rt-series-meter">
            <div class="rt-series-fill" id="series-fill"></div>
          </div>
        </div>

        <!-- Main Content (two-column on wide screens) -->
        <div class="rt-main-content">
          <!-- Left Column: Roulette Table -->
          <div class="rt-table-column">
            <div class="rt-table-wrapper">
              <div class="rt-felt">
                <div class="rt-table-body">
                  <div class="rt-zeros-col" id="zeros-col"></div>
                  <div class="rt-numbers-area">
                    <div class="rt-number-grid" id="number-grid"></div>
                  </div>
                  <div class="rt-columns-col" id="columns-col"></div>
                </div>
                <div class="rt-dozens-row" id="dozens-row"></div>
                <div class="rt-bands-row" id="bands-row"></div>
              </div>
            </div>
            <div class="rt-extra-btns">
              <button class="rt-corner-btn rt-extra-btn" id="btn-bankroll"><i class="fas fa-wallet"></i><span>Bankroll</span></button>
              <button class="rt-corner-btn rt-extra-btn" id="btn-settings"><i class="fas fa-cog"></i><span>Settings</span></button>
            </div>
          </div>

          <!-- Right Column: Wheel + Analytics -->
          <div class="rt-analytics-column">
            <div class="rt-panel rt-wheel-panel">
              <div class="rt-panel-header"><i class="fas fa-dharmachakra"></i> PHYSICAL WHEEL MAP</div>
              <div id="wheel-viz" class="rt-wheel-viz"></div>
            </div>
            <div class="rt-panel">
              <div class="rt-panel-header"><i class="fas fa-atom"></i> PHYSICS ENGINE</div>
              <div id="physics-status" class="rt-panel-body"></div>
            </div>
            <div class="rt-panel">
              <div class="rt-panel-header"><i class="fas fa-brain"></i> SERIES INTELLIGENCE</div>
              <div id="series-intel" class="rt-panel-body"></div>
            </div>
            <div class="rt-panel rt-info-panel">
              <div class="rt-panel-header"><i class="fas fa-microscope"></i> HOW THIS WORKS</div>
              <div class="rt-panel-body rt-info-body">
                <p><strong>Series Tracking</strong> — A physical roulette wheel must eventually land on all 38 numbers. One complete cycle through every number is a "series." By tracking consecutive series on the same wheel, the app learns the wheel's average cycle length and identifies when the final unhit numbers are statistically concentrated.</p>
                <p><strong>Final 8</strong> — When only 8 numbers remain unhit in the current series, the probability density shifts in our favor. These numbers are covered with bets using the Trinity progression &mdash; a controlled doubling sequence on consecutive misses (1x &rarr; 2x &rarr; 4x &rarr; 8x) that resets on any hit.</p>
                <p><strong>Calibration</strong> — Pocket-to-pocket timing and RPM measurements feed a Kalman-filtered physics model. The ball's exponential decay &omega;(t) = &omega;<sub>0</sub> &middot; e<sup>-kt</sup> predicts the drop point. Scatter distribution data refines where the ball actually lands after bouncing off the deflectors.</p>
                <p><strong>The Edge</strong> — No single spin is predictable. But across hundreds of tracked spins, mechanical imperfections in the wheel &mdash; pocket depth variation, rotor speed consistency, tilt, ball track wear &mdash; create measurable bias. The more data collected on a specific wheel, the tighter the prediction window becomes.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Last Spins & Prediction -->
        <div class="rt-bottom-section">
          <div class="rt-last-spins" id="last-spins"></div>
          <div class="rt-prediction-bar" id="prediction-bar"></div>
        </div>

        <!-- HUD -->
        <div class="rt-hud">
          <span id="hud-series">Series: 0</span>
          <span id="hud-spins">Spins: 0</span>
          <span id="hud-lifetime">Lifetime: 0</span>
        </div>
      `;

      // #table-container wraps the whole table screen above so the
      // layout shell can position it edge-to-edge (phone landscape) or
      // as the left/top grid cell (tablet/desktop) without touching any
      // of the ids/classes inside it. #intel-feed is its sibling — the
      // right/bottom grid cell on tablet/desktop, hidden on phone. Its
      // content renderer is a later task; this is a themed placeholder.
      this.container.innerHTML = `
        <div id="table-container" class="roulette-app-container">${html}</div>
        <div id="intel-feed">
          <div class="intel-feed-empty">
            <i class="fas fa-satellite-dish"></i>
            <p>Live intelligence feed will appear here once a series is active.</p>
          </div>
        </div>
      `;
      this._buildZeros();
      this._buildNumberGrid();
      this._buildColumns();
      this._buildDozens();
      this._buildBands();
      this._buildWheelViz();
      this._bindEvents();
      this.update();
    }

    _buildZeros() {
      const col = document.getElementById('zeros-col');
      // Brandon's Task 21 spec: 0 on the top half, 00 on the bottom half
      // (the reference image's single spanning 0 cell, split for the
      // American 0/00 wheel). Order here drives visual position via
      // flex-direction:column + the :first-child/:last-child corner
      // rounding in css/app.css.
      [0, 37].forEach(num => {
        const cell = document.createElement('div');
        cell.className = 'rt-cell';
        cell.dataset.num = num;
        cell.innerHTML = `
          <span class="rt-ago-badge">0</span>
          <div class="rt-oval rt-oval-green"><span class="rt-number">${num === 37 ? '00' : '0'}</span></div>
          <span class="rt-hits-badge">0</span>
        `;
        col.appendChild(cell);
      });
    }

    _buildNumberGrid() {
      const grid = document.getElementById('number-grid');
      const rows = BTHG.TABLE_GRID.rows;
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const num = rows[r][c];
          const color = BTHG.colorForNumber(num);
          const cell = document.createElement('div');
          cell.className = 'rt-cell';
          cell.dataset.num = num;
          cell.innerHTML = `
            <span class="rt-ago-badge">0</span>
            <div class="rt-oval rt-oval-${color}"><span class="rt-number">${num}</span></div>
            <span class="rt-hits-badge">0</span>
          `;
          grid.appendChild(cell);
        }
      }
    }

    _buildColumns() {
      const col = document.getElementById('columns-col');
      const labels = [
        { col: 'top', key: '2:1 Top' },
        { col: 'mid', key: '2:1 Mid' },
        { col: 'bot', key: '2:1 Bot' },
      ];
      labels.forEach(({ col: colName, key }) => {
        const cell = document.createElement('div');
        cell.className = 'rt-col-btn';
        cell.dataset.col = colName;
        cell.dataset.sbKey = key;
        cell.id = `col-${colName}`;
        cell.innerHTML = `
          <span class="rt-sb-ago">0</span>
          <span class="rt-sb-name">2to1</span>
          <span class="rt-sb-hit">0</span>
        `;
        col.appendChild(cell);
      });
    }

    // Pure render helpers for the outside-bet row (Task 21) — deliberately
    // not touching `this`/DOM (same pattern as _shouldTrackBet below) so
    // they're headlessly testable: given a BTHG.TABLE_GRID.bands label,
    // decide whether it renders as a diamond shape (RED/BLACK) and what
    // text the other four cells display.
    _isDiamondLabel(label) {
      return label === 'RED' || label === 'BLACK';
    }

    _bandDisplayLabel(label) {
      return BTHG.TABLE_GRID.bandDisplay[label] || label;
    }

    _buildDozens() {
      const row = document.getElementById('dozens-row');
      // Left corner — Undo button
      const undoCorner = document.createElement('button');
      undoCorner.className = 'rt-corner-btn';
      undoCorner.id = 'btn-undo';
      undoCorner.innerHTML = '<i class="fas fa-undo"></i><span>Undo</span>';
      row.appendChild(undoCorner);

      BTHG.TABLE_GRID.dozens.forEach(label => {
        const cell = document.createElement('div');
        cell.className = 'rt-dozen-cell';
        cell.dataset.dozen = label;
        cell.dataset.sbKey = label;
        cell.innerHTML = `
          <span class="rt-sb-ago">0</span>
          <span class="rt-sb-name">${label}</span>
          <span class="rt-sb-hit">0</span>
        `;
        row.appendChild(cell);
      });

      // Right corner — Calibrate button
      const calCorner = document.createElement('button');
      calCorner.className = 'rt-corner-btn';
      calCorner.id = 'btn-calibrate';
      calCorner.innerHTML = '<i class="fas fa-crosshairs"></i><span>Cal</span>';
      row.appendChild(calCorner);
    }

    _buildBands() {
      const row = document.getElementById('bands-row');
      // Left corner — End Series button
      const endCorner = document.createElement('button');
      endCorner.className = 'rt-corner-btn';
      endCorner.id = 'btn-end-series';
      endCorner.innerHTML = '<i class="fas fa-flag-checkered"></i><span>End</span>';
      row.appendChild(endCorner);

      BTHG.TABLE_GRID.bands.forEach(label => {
        const cell = document.createElement('div');
        cell.className = 'rt-band-cell';
        cell.dataset.band = label;
        // dataset.sbKey stays the raw SIDE_BETS key ('1-18'/'19-36'/etc.)
        // — this is what _updateSideBets uses to look up
        // engine.sideBetAgo/sideBetHits, so it must never change even
        // though the visible label below is reworded for the reference
        // image ("1 to 18" / "19 to 36" instead of "1-18" / "19-36").
        cell.dataset.sbKey = label;
        if (this._isDiamondLabel(label)) {
          // Reference image draws these two as a red/black diamond, not
          // a whole-cell color tint — see .rt-diamond in css/app.css.
          const diamondClass = label === 'RED' ? 'rt-diamond-red' : 'rt-diamond-black';
          cell.innerHTML = `
            <span class="rt-sb-ago">0</span>
            <div class="rt-diamond ${diamondClass}"></div>
            <span class="rt-sb-hit">0</span>
          `;
        } else {
          cell.innerHTML = `
            <span class="rt-sb-ago">0</span>
            <span class="rt-sb-name">${this._bandDisplayLabel(label)}</span>
            <span class="rt-sb-hit">0</span>
          `;
        }
        row.appendChild(cell);
      });

      // Right corner — Data button
      const dataCorner = document.createElement('button');
      dataCorner.className = 'rt-corner-btn';
      dataCorner.id = 'btn-data';
      dataCorner.innerHTML = '<i class="fas fa-chart-bar"></i><span>Data</span>';
      row.appendChild(dataCorner);
    }

    _bindEvents() {
      // Number cells click (grid + zeros)
      this.container.querySelectorAll('.rt-cell[data-num]').forEach(cell => {
        cell.addEventListener('click', () => {
          const num = parseInt(cell.dataset.num);
          this._onNumberTap(num);
        });
      });

      // Undo
      const undoBtn = document.getElementById('btn-undo');
      if (undoBtn) undoBtn.addEventListener('click', () => this._onUndo());

      // Calibration
      const calBtn = document.getElementById('btn-calibrate');
      if (calBtn) calBtn.addEventListener('click', () => this._onCalibrate());

      // Settings
      const setBtn = document.getElementById('btn-settings');
      if (setBtn) setBtn.addEventListener('click', () => this._onSettings());

      // Data inspector
      const dataBtn = document.getElementById('btn-data');
      if (dataBtn) dataBtn.addEventListener('click', () => this._onDataInspector());

      // Bankroll panel
      const bankBtn = document.getElementById('btn-bankroll');
      if (bankBtn) bankBtn.addEventListener('click', () => this._onBankrollPanel());

      // End Series
      const endBtn = document.getElementById('btn-end-series');
      if (endBtn) endBtn.addEventListener('click', () => this._onEndSeries());

      // Betting toggle
      const bettingInput = document.getElementById('betting-toggle-input');
      if (bettingInput) {
        bettingInput.checked = this.bettingEnabled;
        bettingInput.addEventListener('change', () => {
          // Only allow ON if bankroll is configured
          if (bettingInput.checked && (this.bankroll.baseBet <= 0 || this.bankroll.totalBankroll <= 0)) {
            bettingInput.checked = false;
            this._showToast('Set bankroll first', 2000);
            return;
          }
          this.bettingEnabled = bettingInput.checked;
          const label = document.getElementById('betting-toggle-label');
          if (label) label.textContent = this.bettingEnabled ? 'BET ON' : 'BET OFF';
          this._saveState();
        });
      }

      // Listen to engine events
      this.engine.onChange((event, data) => {
        this.update();
        if (event === 'seriesComplete') {
          // Nothing is archived here anymore. The board freezes and waits
          // for the user to press New Series (which archives + clears the
          // live spin backlog) or Keep Reviewing (which just collapses the
          // banner). See showSeriesCompleteBanner / archiveAndReset below.
          this._showToast(`SERIES #${data.seriesCount} COMPLETE, ${data.totalSpins} spins`, 4000);
          this.showSeriesCompleteBanner('auto');
        }
        if (event === 'finalActivated') {
          this._showToast(`FINAL ${data.numbers.length} ACTIVATED`, 3000);
        }
        if (event === 'finalWarning') {
          this._showToast('FINAL 9. Prepare to bet', 3000);
        }
      });
    }

    _onNumberTap(num) {
      // Frozen board (series complete, awaiting New Series) does not accept
      // input at all — no engine mutation, no bankroll tracking, no SpinDB
      // write.
      if (this.engine.frozen) return;

      // Capture betting state BEFORE recordSpin modifies it
      // (recordSpin resets trinityMissStreak on hit, and can clear finalEightJustHit on series complete)
      const wasFinalActive = this.engine.finalActivated;
      // A spin is a WIN if the number is anywhere in our actual coverage —
      // the Final 8 PLUS the always-covered 0 and 00. Using finalEight alone
      // wrongly booked every 0/00 hit as a loss even though we cover them,
      // which dragged the session P&L negative.
      const wasInFinal = this.engine.getTrinityNumbers().includes(num);
      const numbersPlayed = this.engine.getTrinityNumbers().length;
      const multiplier = this.engine.getTrinityMultiplier();

      // Record spin (modifies engine state)
      this.engine.recordSpin(num);

      // Pattern engine + intel feed: re-analyze on every spin (Task 8).
      this._updateIntelFeed();

      // Record bankroll P&L stats using pre-spin state. This must run
      // regardless of bettingEnabled — bettingEnabled only gates the manual
      // "BET ON" UI toggle, not whether a Trinity bet situation existed.
      // Previously this whole block was gated on this.bettingEnabled, so
      // winCount/lossCount/totalWagered silently stayed at 0 for the entire
      // session unless the user had manually flipped betting on.
      if (this._shouldTrackBet(wasFinalActive, numbersPlayed)) {
        this.bankroll.recordSpin(wasInFinal, numbersPlayed, multiplier);
      }

      // Learn scatter offset if calibrated
      if (this.fusion.qualityTier >= 2 && this.predictor.lastResult) {
        this.fusion.learnOffset(this.predictor.lastResult.dropIndex, num);
      }

      // Persist to IndexedDB. The `realTime` flag (additive, defaults to
      // true for older records that predate it) marks whether this tap was
      // an actual ball-drop moment (Real Time ON, tapped live at the wheel)
      // or historical back-fill (Real Time OFF). Only realTime taps carry a
      // meaningful timestamp for the cycle-cadence engine — back-fill taps
      // are seconds apart and would poison the ~50s cadence. Number/order/
      // droughts/coverage are recorded identically either way.
      BTHG.Storage.SpinDB.addSpin({
        number: num,
        timestamp: Date.now(),
        machineId: BTHG._currentMachineId || 'default',
        realTime: BTHG._realTime !== false,
      });

      // Flash effect
      this._flashCell(num);

      // Update prediction
      if (this.fusion.referenceLocked) {
        this.predictor.predict(this.fusion);
      }

      this.update();

      // Save state
      this._saveState();
    }

    // Pure decision for whether this spin's P&L should be tracked into the
    // bankroll — deliberately does NOT consult this.bettingEnabled, which is
    // UI-only state for the manual "BET ON" toggle. A Trinity bet is "in
    // play" (and must be tracked) whenever Final 8 was active and there were
    // covered numbers, independent of that toggle.
    _shouldTrackBet(wasFinalActive, numbersPlayed) {
      return wasFinalActive && numbersPlayed > 0;
    }

    // Re-runs PatternEngine.analyze against this machine's archived series
    // plus the live spin sequence, and forwards its output into the intel
    // feed (Task 8). Archive lookup is async (IndexedDB), so this can't
    // block the tap handler — the feed just updates a beat after the rest
    // of the UI. closersHit uses finalEightFirstHit.size (count of Final 8
    // numbers hit at least once during the current closing phase), the
    // same source _buildArchiveRecord uses via finalEightFirstHitSpins to
    // compute closerOffsets on archive, so the live "closers hit" count and
    // the historical closerOffsets it's compared against stay consistent.
    _updateIntelFeed() {
      if (!BTHG.IntelFeed || !BTHG.PatternEngine) return;
      const machineId = BTHG._currentMachineId || 'default';
      BTHG.Storage.SeriesDB.getSeriesByMachine(machineId).then(archive => {
        const res = BTHG.PatternEngine.analyze({
          archive,
          liveSpins: this.engine.history,
          layout: (BTHG.MachineProfiles.getActive() || {}).wheelLayout || BTHG.WHEEL_LAYOUTS.american,
          finalActivated: this.engine.finalActivated,
          closersHit: this.engine.finalEightFirstHit.size,
        });
        res.alerts.forEach(a => BTHG.IntelFeed.push(a));
        BTHG.IntelFeed.setSignal(res.entry);
      }).catch(e => console.warn('IntelFeed update failed:', e));

      // Cycle watch (Task 22): re-hit gap tracking on the machine's
      // continuous spin tape (crossing series boundaries, sitting
      // aware) — a separate view from PatternEngine's per-series cycle
      // logic. Read-only fetch of the full tape from SpinDB; its own
      // .catch so a CycleWatch failure can never break the
      // PatternEngine path above.
      if (BTHG.CycleWatch) {
        BTHG.Storage.SpinDB.getSpinsByMachine(machineId).then(tape => {
          const cw = BTHG.CycleWatch.analyze({ tape, nowLive: Date.now() });
          cw.alerts.forEach(a => BTHG.IntelFeed.push(a));

          // Cycle-timing engine (own try/catch so a failure here can never
          // break the cycle-watch/pattern paths). Runs on the CURRENT
          // sitting only (last splitSittings segment), reading each spin's
          // realTime flag to learn the machine's ~50s drop cadence from
          // live taps and ignore back-fill.
          try {
            if (BTHG.TimingEngine && BTHG.CycleWatch.splitSittings) {
              const sittings = BTHG.CycleWatch.splitSittings(tape);
              let current = sittings.length ? sittings[sittings.length - 1] : [];
              // Reset Timing cutoff: ignore drops recorded before the user
              // pressed Reset (e.g. back-fill that got tapped while Real
              // Time was ON). Only filters the timing view — the spins
              // themselves are untouched.
              const resetAt = BTHG._timingResetAt || 0;
              if (resetAt) current = current.filter(s => s.timestamp >= resetAt);
              const te = BTHG.TimingEngine.analyze({ sitting: current, nowLive: Date.now() });
              this._timing = te;
              if (te.alert) BTHG.IntelFeed.push(te.alert);
              this._renderTimingReadout(te);
            }
          } catch (e) { console.warn('TimingEngine update failed:', e); }
        }).catch(e => console.warn('CycleWatch update failed:', e));
      }
    }

    // Paints the cycle-timing readout into the Physics Engine panel's
    // timing slot if present (id "timing-readout"); otherwise a no-op, so
    // this is safe on layouts that do not render that slot.
    _renderTimingReadout(te) {
      const el = document.getElementById('timing-readout');
      if (!el) return;
      if (!te || te.cycleSec == null) {
        el.textContent = te && te.sampleCount
          ? 'Timing: building (need more live drops)'
          : 'Timing: switch Real Time ON and tap each drop';
        return;
      }
      const sec = te.cycleSec.toFixed(1);
      const next = te.secToNextDrop != null ? Math.max(0, Math.round(te.secToNextDrop)) : null;
      const nextTxt = next != null ? `, next drop in ~${next}s` : '';
      el.textContent = `Cycle ~${sec}s (${te.confidence.label}, n=${te.sampleCount})${nextTxt}`;
    }

    _flashCell(num) {
      const cell = this.container.querySelector(`.rt-cell[data-num="${num}"]`);
      if (cell) {
        cell.classList.add('rt-just-hit');
        setTimeout(() => cell.classList.remove('rt-just-hit'), 1200);
      }
    }

    _onUndo() {
      if (this.engine.frozen) return;
      if (this.engine.undoLastSpin()) {
        BTHG.Storage.SpinDB.deleteLastSpin(BTHG._currentMachineId || 'default');
        this.update();
        this._saveState();

        // Re-analyze against post-undo engine state (Task 8 review fix).
        // Without this, the pinned signal banner and #ss-signal badge kept
        // showing the pre-undo BET/HOLD/STOP call indefinitely, since
        // _updateIntelFeed() was only ever invoked from the spin path.
        // Per-series dedup memory in IntelFeed is intentionally left as is
        // (not reset here); undo doesn't start a new series.
        this._updateIntelFeed();
      }
    }

    _onCalibrate() {
      this._listeners.forEach(fn => fn('openCalibration'));
    }

    _onSettings() {
      this._listeners.forEach(fn => fn('openSettings'));
    }

    _onDataInspector() {
      this._listeners.forEach(fn => fn('openDataInspector'));
    }

    _onBankrollPanel() {
      this._listeners.forEach(fn => fn('openBankroll'));
    }

    _onEndSeries() {
      // The auto-complete banner already covers "series is done" — the
      // manual End Series overlay is for ending mid-series, so it makes no
      // sense (and would risk a double archive) while frozen.
      if (this.engine.frozen) return;
      if (this.engine.totalSpins === 0) return;
      this._showEndSeriesConfirm();
    }

    _showEndSeriesConfirm() {
      const overlay = document.createElement('div');
      overlay.className = 'rt-overlay rt-overlay-visible';
      const hit = this.engine.getUniqueHitCount();
      const spins = this.engine.totalSpins;
      const fusionSnapshot = this.fusion.toJSON();
      const machineId = BTHG._currentMachineId || 'default';
      const casino = BTHG._currentCasino || 'Unknown';

      overlay.innerHTML = `
        <div class="rt-overlay-content" style="max-width:460px;">
          <div class="rt-celebrate-icon" style="color:var(--gold);"><i class="fas fa-flag-checkered"></i></div>
          <h2 style="color:var(--gold);">End / Save This Series</h2>
          <p style="color:#aaa;margin:0.4rem 0 1rem;">${hit}/38 numbers hit · ${spins} spins this series. What do you want to do?</p>
          <div style="display:flex;flex-direction:column;gap:0.6rem;text-align:left;">
            <button class="btn-gold" id="es-save-new" style="padding:0.7rem 1rem;line-height:1.3;">
              <strong>Save &amp; Start New Series</strong>
              <span style="display:block;font-weight:400;font-size:0.76rem;color:#3a2f00;">Bank this series into history. Spin count resets to 1. Your table average keeps building.</span>
            </button>
            <button class="btn-outline" id="es-save-keep" style="padding:0.7rem 1rem;line-height:1.3;">
              <strong>Save &amp; Keep Counting</strong>
              <span style="display:block;font-weight:400;font-size:0.76rem;color:#999;">Save a snapshot to history but DON'T reset — keep counting right where you left off.</span>
            </button>
            <button class="btn-outline" id="es-discard" style="padding:0.7rem 1rem;line-height:1.3;border-color:#a33;color:#e88;">
              <strong>Discard &amp; Start Over</strong>
              <span style="display:block;font-weight:400;font-size:0.76rem;color:#a77;">Throw this series away (not saved). Fresh start at spin 1. Keeps your learned table average.</span>
            </button>
            <button class="btn-outline" id="es-cancel" style="padding:0.55rem 1rem;line-height:1.3;">
              <strong>Cancel</strong>
              <span style="display:block;font-weight:400;font-size:0.76rem;color:#999;">Go back — nothing changes.</span>
            </button>
          </div>
        </div>
      `;
      this.container.appendChild(overlay);
      const close = () => overlay.remove();

      // Save & Start New Series — completes + banks the series, resets to spin 1.
      // The series is now fully archived (spinHistory is saved inside
      // seriesData). Its live spins in SpinDB are stamped with this
      // record's timestamp as their seriesMarker (never deleted — the full
      // spin tape for the machine has to persist forever), so the next load
      // knows they belong to a finished series and skips them on replay.
      // Routed through _recordManualCompletion() + _buildArchiveRecord()
      // (same record-builder the auto-close path uses) instead of
      // engine.manualEndSeries() directly, so this manual completion also
      // carries closerOffsets — manualEndSeries() used to reset the board
      // (wiping finalEightFirstHitSpins/entrySpin) before closerOffsets
      // could ever be computed from it.
      document.getElementById('es-save-new').addEventListener('click', () => {
        this.engine._recordManualCompletion();
        const seriesData = this._buildArchiveRecord(this.engine, 'manual', fusionSnapshot, machineId, casino);
        this.engine.resetSeries();
        if (BTHG.IntelFeed) BTHG.IntelFeed.reset();
        BTHG.Storage.SeriesDB.saveSeries(seriesData)
          .then(() => BTHG.Storage.SpinDB.markArchived(machineId, seriesData.timestamp))
          .then(() => {
            this.update(); this._saveState(); close();
            // Repopulate the feed from the archive right away (including
            // the record just saved) instead of leaving it blank until the
            // new series' first spin. Insights derive from the archive on
            // every analyze, so they survive series boundaries; the blank
            // gap read as "all my past data vanished" on the floor.
            this._updateIntelFeed();
            this._showSeriesEndConfirmation(seriesData, 'Series saved. New series started at spin 1.');
          });
      });

      // Save & Keep Counting — snapshot to history, do NOT reset. The series
      // is still live, so its spins in SpinDB are deliberately left
      // unmarked (still "current series").
      document.getElementById('es-save-keep').addEventListener('click', () => {
        const seriesData = this.engine.saveSnapshot(fusionSnapshot, machineId, casino);
        BTHG.Storage.SeriesDB.saveSeries(seriesData).then(() => {
          this.update(); this._saveState(); close();
          this._showSeriesEndConfirmation(seriesData, 'Snapshot saved. Still counting where you left off.');
        });
      });

      // Discard & Start Over — drop current series (no save), reset to spin 1.
      // Nothing was archived to SeriesDB, but the live spins for this
      // machine still get stamped with a discard marker (not deleted) so
      // the next load does not replay them as part of the fresh series.
      document.getElementById('es-discard').addEventListener('click', () => {
        this.engine.discardSeries();
        if (BTHG.IntelFeed) BTHG.IntelFeed.reset();
        BTHG.Storage.SpinDB.markArchived(machineId, 'discard:' + Date.now()).then(() => {
          this.update(); this._saveState(); close();
          // Same repopulate-from-archive as the other two boundaries.
          this._updateIntelFeed();
          this._showToast('Series discarded. Fresh start at spin 1.', 2500);
        });
      });

      document.getElementById('es-cancel').addEventListener('click', close);
    }

    _showSeriesEndConfirmation(data, message) {
      const overlay = document.createElement('div');
      overlay.className = 'rt-overlay';
      overlay.innerHTML = `
        <div class="rt-overlay-content">
          <div class="rt-celebrate-icon" style="color:var(--final-green);"><i class="fas fa-check-circle"></i></div>
          <h2 style="color:var(--final-green);">Saved</h2>
          <p style="color:#aaa;margin:0.5rem 0;">Series #${data.seriesNumber} — ${data.totalSpins} spins, ${data.uniqueHit}/38 numbers hit</p>
          <p style="color:#888;font-size:0.85rem;">${message || 'All tracking continues.'}</p>
          <button class="rt-overlay-close" style="margin-top:1rem;">Continue Playing</button>
        </div>
      `;
      this.container.appendChild(overlay);
      overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
      setTimeout(() => overlay.classList.add('rt-overlay-visible'), 50);
    }

    /**
     * Series just completed (endType 'auto' from full board completion, or
     * 'manual' if a future caller wires the manual End Series flow through
     * here). Freeze the board so the final state stays visible for review
     * instead of silently wiping it. Nothing is written to SeriesDB, and no
     * spins are marked/reassigned in SpinDB, until New Series is pressed
     * (archiveAndReset) — that is the fix for the field bug where a
     * completed series' spins got reset out of the engine but stayed
     * unmarked in SpinDB, then replayed on top of the next series on the
     * following load.
     */
    showSeriesCompleteBanner(endType) {
      this.engine.frozen = true;
      this.container.classList.add('series-complete');

      // Guard against a duplicate banner (e.g. restoring a frozen snapshot
      // on load into a container that already rendered one).
      const already = document.getElementById('series-complete-banner');
      if (already) already.remove();

      const banner = document.createElement('div');
      banner.id = 'series-complete-banner';
      banner.innerHTML = `
        <span class="scb-title">SERIES COMPLETE (${endType === 'auto' ? 'CLOSED' : 'MANUAL'})</span>
        <button id="btn-new-series">New Series</button>
        <button id="btn-keep-reviewing">Keep Reviewing</button>`;
      // Prepend inside #table-container (not this.container/#app-root)
      // so the banner stays visually anchored to the table it freezes,
      // and stacks correctly on phone landscape where #table-container
      // is position:fixed (see css/app.css layout-phone-land rules).
      (this.container.querySelector('#table-container') || this.container).prepend(banner);
      banner.querySelector('#btn-new-series').addEventListener('click', (e) => {
        // Disable immediately (belt-and-suspenders alongside the
        // this._archiving guard in archiveAndReset) so a rapid double-tap
        // can't even fire a second click before the first is processed.
        e.currentTarget.disabled = true;
        this.archiveAndReset(endType);
      });
      banner.querySelector('#btn-keep-reviewing').addEventListener('click', () => banner.classList.add('scb-collapsed'));

      this._persistFrozenSnapshot(endType);
    }

    /**
     * Save the frozen board's full state to localStorage so it survives a
     * reload. Read back in app.js's loadPreviousTable().
     */
    _persistFrozenSnapshot(endType) {
      const machineId = BTHG._currentMachineId || 'default';
      const casino = BTHG._currentCasino || 'Unknown';
      BTHG.Storage.LS.set('frozen_series', {
        machineId,
        casino,
        endType,
        engineState: this.engine.toJSON(),
        timestamp: Date.now(),
      });
    }

    /**
     * "New Series" pressed: archive the completed series to SeriesDB, stamp
     * this machine's live spins with the archived record's timestamp as
     * their seriesMarker (SpinDB never deletes spins — the full spin tape
     * for a machine has to persist forever across every series for a future
     * always-visible tape view), drop the frozen snapshot, and reset the
     * engine for the next series. This is now the ONLY place a completed
     * series gets saved or the board gets wiped.
     *
     * Guarded by this._archiving against a double-tap on "New Series"
     * racing two archive+save cycles for the same frozen series (which
     * would otherwise produce two SeriesDB records for one completed
     * series). The flag is checked-and-set synchronously at entry — before
     * anything async happens — and cleared in a .finally() once the
     * save/mark chain settles either way.
     */
    archiveAndReset(endType) {
      if (this._archiving) return;
      this._archiving = true;

      const machineId = BTHG._currentMachineId || 'default';
      const casino = BTHG._currentCasino || 'Unknown';
      const fusionSnapshot = this.fusion.toJSON();
      const record = this._buildArchiveRecord(this.engine, endType, fusionSnapshot, machineId, casino);

      BTHG.Storage.SeriesDB.saveSeries(record)
        .then(() => BTHG.Storage.SpinDB.markArchived(machineId, record.timestamp))
        .then(() => {
          BTHG.Storage.LS.remove('frozen_series');
          this.engine.resetSeries();
          if (BTHG.IntelFeed) BTHG.IntelFeed.reset();
          this.container.classList.remove('series-complete');
          const banner = document.getElementById('series-complete-banner');
          if (banner) banner.remove();
          this.update();
          this._saveState();
          // Repopulate the feed from the archive right away (including the
          // record just saved) so past-series insights are visible before
          // the new series' first spin — same as the manual save path.
          this._updateIntelFeed();
          this._showToast('New series started at spin 1.', 2500);
        })
        .finally(() => { this._archiving = false; });
    }

    // Pure record-builder, deliberately not touching `this`/DOM so it is
    // testable in isolation (same pattern as _shouldTrackBet). Adds
    // closerOffsets on top of getSeriesDataForSave's record: how many spins
    // into the Final 8 closing phase each closing number took to hit,
    // derived from finalEightFirstHitSpins (per-number spin index of first
    // hit while in Final 8) relative to entrySpin (spin index Final 8
    // activated at). If Final 8 never activated (series ended before
    // closing), there is no closing phase, so closerOffsets is empty.
    _buildArchiveRecord(engine, endType, fusionSnapshot, machineId, casino) {
      const record = engine.getSeriesDataForSave(endType, fusionSnapshot, machineId, casino);
      record.closerOffsets = record.entrySpin != null
        ? Object.values(engine.finalEightFirstHitSpins).map(spinAt => spinAt - record.entrySpin)
        : [];
      return record;
    }

    onAction(fn) { this._listeners.push(fn); }

    // ---- Update Display ----------------------------------------
    update() {
      this._updateNumbers();
      this._updateFinal8();
      this._updateSideBets();
      this._updateSeriesTracker();
      this._updateLastSpins();
      this._updatePredictionBar();
      this._updateHUD();
      this._updateBankrollBar();
      this._updateWheelViz();
      this._updatePhysicsStatus();
      this._updateSeriesIntel();
    }

    _updateNumbers() {
      // Recompute the on-deck set once per render (getNextBestNumbers is a
      // cheap sort). Only meaningful once enough numbers have been tracked
      // for a cold cluster to exist; before that it just tints the current
      // coldest and is harmless.
      this._nextBestSet = new Set(this.engine.getNextBestNumbers(this.engine.finalTargetCount));
      for (const num of this.engine.numbers) {
        const cell = this.container.querySelector(`.rt-cell[data-num="${num.value}"]`);
        if (!cell) continue;

        const agoEl = cell.querySelector('.rt-ago-badge');
        const hitsEl = cell.querySelector('.rt-hits-badge');

        // Always show ago (persistent) — no color coding on individual numbers
        if (agoEl) {
          agoEl.textContent = num.ago;
          agoEl.classList.remove('rt-ago-warm', 'rt-ago-hot');
        }

        // Always show hits (persistent)
        if (hitsEl) {
          hitsEl.textContent = num.hits;
        }

        // Just-hit glow
        cell.classList.toggle('rt-hot', num.ago === 0 && num.hits > 0);

        // Final 8 highlight
        const inFinal = this.engine.finalEight.includes(num.value);
        cell.classList.toggle('rt-in-final', inFinal);

        // On-deck "next best" tint (Brandon, 2026-07-04): the coldest real
        // numbers not yet in the Final set — what to bet next once current
        // members hit. Blue so it reads clearly against the gold Final tint.
        // Computed once per render below and toggled here.
        cell.classList.toggle('rt-next-best', this._nextBestSet.has(num.value) && !inFinal);

        // Most recent Final 8 hit highlight
        const isF8JustHit = this.engine.finalEightJustHit.has(num.value);
        cell.classList.toggle('rt-f8-just-hit-cell', isF8JustHit);

        // Show removal countdown on grid cells for Final 8 numbers
        const isF8FirstHit = this.engine.finalEightFirstHit.has(num.value);
        const f8Age = this.engine.finalEightAges[num.value];
        const isZero = (num.value === 0 || num.value === 37);
        cell.classList.toggle('rt-f8-aging', isF8FirstHit && !isZero && f8Age !== undefined);

        // Blue tint at 60+ spins without hit (subtle cold indicator)
        cell.classList.remove('rt-cold-13', 'rt-cold-20', 'rt-cold-60');
        if (!inFinal && num.ago >= 60) {
          cell.classList.add('rt-cold-60');
        }
      }
    }

    _updateFinal8() {
      const display = document.getElementById('final8-display');
      if (!display) return;
      display.innerHTML = '';

      if (this.engine.finalEight.length === 0 && !this.engine.finalActivated) {
        display.innerHTML = '<span class="rt-f8-empty">Tracking numbers... Awaiting Final 8</span>';
        return;
      }

      // Always show 0 and 00 when Final 8 is active (they're always covered)
      const targets = this.engine.getTrinityNumbers();

      for (const numVal of targets) {
        const div = document.createElement('div');
        div.className = 'rt-f8-chip';
        const color = BTHG.colorForNumber(numVal);
        const age = this.engine.finalEightAges[numVal];
        const isJustHit = this.engine.finalEightJustHit.has(numVal);
        const isFirstHit = this.engine.finalEightFirstHit.has(numVal);
        const isZero = (numVal === 0 || numVal === 37);

        let borderColor = '#5EFF00'; // green — active, not yet hit
        let subtitle = '';

        if (isJustHit) {
          borderColor = '#FFD700'; // gold flash
          div.classList.add('rt-f8-flash');
          div.classList.add('rt-f8-latest-hit');
          if (!isZero) subtitle = '2 left';
        } else if (isFirstHit && age !== undefined && !isZero) {
          borderColor = BTHG.agingColor(age);
          const spinsLeft = BTHG.CONSTANTS.FINAL_EIGHT_AGE_LIMIT - age;
          if (spinsLeft > 0) {
            subtitle = spinsLeft + ' left';
          } else {
            subtitle = 'OUT';
          }
        } else if (isZero) {
          borderColor = '#5EFF00';
          subtitle = 'LOCK';
        }

        div.style.borderColor = borderColor;
        div.style.color = borderColor;
        if (color === 'red') div.style.background = 'rgba(196,18,0,0.7)';
        else if (color === 'black') div.style.background = 'rgba(26,26,26,0.8)';
        else div.style.background = 'rgba(0,115,58,0.7)';

        // Number label
        const numSpan = document.createElement('span');
        numSpan.className = 'rt-f8-num';
        numSpan.textContent = BTHG.displayNumber(numVal);
        div.appendChild(numSpan);

        // Countdown subtitle
        if (subtitle) {
          const subSpan = document.createElement('span');
          subSpan.className = 'rt-f8-countdown';
          subSpan.textContent = subtitle;
          subSpan.style.color = borderColor;
          div.appendChild(subSpan);
        }

        display.appendChild(div);
      }
    }

    _updateSideBets() {
      // Update ALL side bet cells — set hit, ago, and warm/hot indicators
      const allSbCells = this.container.querySelectorAll('[data-sb-key]');
      for (const cell of allSbCells) {
        const key = cell.dataset.sbKey;
        const ago = this.engine.sideBetAgo[key] || 0;
        const hits = this.engine.sideBetHits[key] || 0;

        // Update ago and hit text
        const agoEl = cell.querySelector('.rt-sb-ago');
        const hitEl = cell.querySelector('.rt-sb-hit');
        if (agoEl) agoEl.textContent = ago;
        if (hitEl) hitEl.textContent = hits;

        // Warm/hot indicators
        cell.classList.remove('rt-section-warm', 'rt-section-hot');
        if (ago >= SECTION_HOT_THRESHOLD) {
          cell.classList.add('rt-section-hot');
        } else if (ago >= SECTION_WARM_THRESHOLD) {
          cell.classList.add('rt-section-warm');
        }

        // Color code the ago text
        if (agoEl) {
          agoEl.classList.remove('rt-ago-warm', 'rt-ago-hot');
          if (ago >= SECTION_HOT_THRESHOLD) {
            agoEl.classList.add('rt-ago-hot');
          } else if (ago >= SECTION_WARM_THRESHOLD) {
            agoEl.classList.add('rt-ago-warm');
          }
        }
      }
    }

    _updateSeriesTracker() {
      const N = 38;
      const hit = this.engine.getUniqueHitCount();
      const remaining = this.engine.getRemainingCount();
      const pct = (hit / N) * 100;

      // Big spin counter
      const scNumber = document.getElementById('spin-counter');
      const scRemaining = document.getElementById('spin-counter-remaining');
      if (scNumber) {
        scNumber.textContent = this.engine.totalSpins;
      }
      if (scRemaining) {
        if (remaining === 0) {
          scRemaining.textContent = 'SERIES COMPLETE';
          scRemaining.style.color = 'var(--final-green)';
        } else if (this.engine.finalActivated) {
          scRemaining.textContent = remaining + ' left — FINAL ' + remaining;
          scRemaining.style.color = 'var(--final-green)';
        } else {
          scRemaining.textContent = hit + '/38 hit · ' + remaining + ' remaining';
          scRemaining.style.color = '';
        }
      }

      const fill = document.getElementById('series-fill');
      const spinEl = document.getElementById('series-spin');
      const leftEl = document.getElementById('series-remaining');
      const avgEl = document.getElementById('series-avg');

      if (fill) {
        fill.style.width = pct + '%';
        fill.classList.toggle('rt-series-final', this.engine.finalActivated);
      }

      if (spinEl) {
        spinEl.textContent = 'Spin ' + this.engine.totalSpins;
      }

      if (leftEl) {
        if (remaining === 0) {
          leftEl.textContent = 'COMPLETE';
          leftEl.style.color = '#5EFF00';
        } else if (remaining <= this.engine.finalTargetCount) {
          leftEl.textContent = remaining + ' left — FINAL ' + remaining;
          leftEl.style.color = '#5EFF00';
        } else if (remaining <= this.engine.finalTargetCount + 2) {
          leftEl.textContent = remaining + ' unhit';
          leftEl.style.color = '#FFD700';
        } else {
          leftEl.textContent = remaining + ' unhit';
          leftEl.style.color = '';
        }
      }

      if (avgEl) {
        const avg = this.engine.getSeriesAverage();
        avgEl.textContent = avg > 0 ? 'Avg: ' + avg + ' spins' : 'Avg: --';
      }
    }

    _updateLastSpins() {
      const container = document.getElementById('last-spins');
      if (!container) return;
      const all = this.engine.history;
      // Newest first (left), oldest last (right) — scroll right for history
      const reversed = [...all].reverse();
      container.innerHTML = reversed.map((num, i) => {
        const color = BTHG.colorForNumber(num);
        const spinNum = all.length - i;
        return `<span class="rt-spin-chip rt-${color}" title="Spin #${spinNum}">${BTHG.displayNumber(num)}</span>`;
      }).join('');
      // Keep scroll at left edge (newest always visible)
      container.scrollLeft = 0;
    }

    _updatePredictionBar() {
      const bar = document.getElementById('prediction-bar');
      if (!bar) return;

      const result = this.predictor.lastResult;
      if (!result || !result.recommendedNumbers || result.recommendedNumbers.length === 0) {
        bar.innerHTML = '<span class="rt-pred-empty"><i class="fas fa-crosshairs"></i> Calibrate to enable predictions</span>';
        return;
      }

      // recommendedNumbers are physical WHEEL POSITION indices (0-37), not pocket
      // numbers — map each through the wheel layout to the actual pocket number.
      const order = BTHG.WHEEL_LAYOUTS.american;
      const nums = result.recommendedNumbers.map(idx => {
        const num = order[idx];
        const color = BTHG.colorForNumber(num);
        return `<span class="rt-pred-num rt-${color}">${BTHG.displayNumber(num)}</span>`;
      }).join('');

      bar.innerHTML = `
        <span class="rt-pred-icon"><i class="fas fa-fire"></i></span>
        <span class="rt-pred-nums">${nums}</span>
        <span class="rt-pred-prob">${result.probability.toFixed(1)}%</span>
        <span class="rt-pred-quality" data-tier="${result.qualityTier}">${result.qualityMessage}</span>
        <span class="rt-pred-mult">${this.engine.getTrinityMultiplier()}x</span>
      `;
    }

    _updateHUD() {
      const series = document.getElementById('hud-series');
      const spins = document.getElementById('hud-spins');
      const lifetime = document.getElementById('hud-lifetime');
      if (series) series.textContent = `Series: ${this.engine.seriesCount}`;
      if (spins) spins.textContent = `Spins: ${this.engine.totalSpins}`;
      if (lifetime) lifetime.textContent = `Lifetime: ${this.engine.lifetimeSpins}`;
    }

    _updateBankrollBar() {
      const totalEl = document.getElementById('br-total');
      const sessionEl = document.getElementById('br-session');
      const betEl = document.getElementById('br-bet');
      const multEl = document.getElementById('br-mult');

      if (totalEl) {
        totalEl.textContent = BTHG.formatMoney(this.bankroll.totalBankroll);
        totalEl.classList.remove('rt-positive', 'rt-negative');
      }

      if (sessionEl) {
        const pnl = this.bankroll.getSessionPnL();
        const absPnl = Math.abs(pnl);
        sessionEl.textContent = (pnl >= 0 ? '+' : '-') + BTHG.formatMoney(absPnl);
        sessionEl.classList.remove('rt-positive', 'rt-negative');
        sessionEl.classList.add(pnl >= 0 ? 'rt-positive' : 'rt-negative');
      }

      if (betEl) {
        betEl.textContent = BTHG.formatMoney(this.bankroll.getCurrentBetPerNumber());
      }

      if (multEl) {
        const m = this.engine.getTrinityMultiplier();
        multEl.textContent = m + 'x';
        multEl.style.color = m > 1 ? '#FFD700' : '';
      }

      // Active Betting Detail Bar
      const detailBar = document.getElementById('betting-detail-bar');
      if (detailBar) {
        if (this.engine.finalActivated) {
          detailBar.style.display = 'flex';
          const targets = this.engine.getTrinityNumbers();
          const numbersCount = targets.length;
          const betPerNum = this.bankroll.getCurrentBetPerNumber();
          const totalBet = betPerNum * numbersCount;
          const winPayout = this.bankroll.payoutRatio * betPerNum;

          const coverEl = document.getElementById('bd-covering');
          const totalBetEl = document.getElementById('bd-total-bet');
          const winPaysEl = document.getElementById('bd-win-pays');
          const winLossEl = document.getElementById('bd-win-loss');

          if (coverEl) coverEl.textContent = numbersCount + ' nums';
          if (totalBetEl) totalBetEl.textContent = BTHG.formatMoney(totalBet);
          if (winPaysEl) winPaysEl.textContent = '+' + BTHG.formatMoney(winPayout);
          if (winLossEl) {
            winLossEl.textContent = this.bankroll.winCount + 'W / ' + this.bankroll.lossCount + 'L';
            winLossEl.classList.remove('rt-positive', 'rt-negative');
            winLossEl.classList.add(this.bankroll.winCount >= this.bankroll.lossCount ? 'rt-positive' : 'rt-negative');
          }
        } else {
          detailBar.style.display = 'none';
        }
      }
    }

    // ---- Physical Wheel Visualization (SVG) ---------------------
    _buildWheelViz() {
      const container = document.getElementById('wheel-viz');
      if (!container) return;

      const order = BTHG.WHEEL_LAYOUTS.american;
      const N = order.length;
      const size = 320;
      const cx = size / 2, cy = size / 2;
      const outerR = 148, innerR = 100, labelR = 125;
      const pocketAngle = (2 * Math.PI) / N;

      let svg = `<svg viewBox="0 0 ${size} ${size}" class="wheel-svg">`;

      // Defs
      svg += `<defs>
        <filter id="pocket-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <radialGradient id="cg"><stop offset="0%" stop-color="#1a1a1a"/><stop offset="100%" stop-color="#080808"/></radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d4af37"/><stop offset="50%" stop-color="#8B7500"/><stop offset="100%" stop-color="#d4af37"/></linearGradient>
      </defs>`;

      // Outer rim
      svg += `<circle cx="${cx}" cy="${cy}" r="${outerR + 8}" fill="none" stroke="url(#rim)" stroke-width="5" opacity="0.6"/>`;
      svg += `<circle cx="${cx}" cy="${cy}" r="${outerR + 3}" fill="none" stroke="#d4af37" stroke-width="1" opacity="0.4"/>`;

      // Pockets
      for (let i = 0; i < N; i++) {
        const num = order[i];
        const sa = -Math.PI / 2 + i * pocketAngle;
        const ea = sa + pocketAngle;
        const ma = sa + pocketAngle / 2;

        const ox1 = cx + outerR * Math.cos(sa), oy1 = cy + outerR * Math.sin(sa);
        const ox2 = cx + outerR * Math.cos(ea), oy2 = cy + outerR * Math.sin(ea);
        const ix1 = cx + innerR * Math.cos(sa), iy1 = cy + innerR * Math.sin(sa);
        const ix2 = cx + innerR * Math.cos(ea), iy2 = cy + innerR * Math.sin(ea);

        const color = BTHG.colorForNumber(num);
        const fill = color === 'red' ? '#c41200' : color === 'green' ? '#00733a' : '#151515';

        svg += `<path d="M${ix1.toFixed(1)},${iy1.toFixed(1)} L${ox1.toFixed(1)},${oy1.toFixed(1)} A${outerR},${outerR} 0 0,1 ${ox2.toFixed(1)},${oy2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${innerR},${innerR} 0 0,0 ${ix1.toFixed(1)},${iy1.toFixed(1)}" fill="${fill}" stroke="#2a2a2a" stroke-width="0.4" data-wnum="${num}" class="whl-pocket"/>`;

        // Label
        const lx = cx + labelR * Math.cos(ma), ly = cy + labelR * Math.sin(ma);
        const rd = (ma * 180 / Math.PI) + 90;
        const label = num === 37 ? '00' : String(num);
        svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="7.5" font-weight="700" fill="#fff" font-family="Inter,sans-serif" transform="rotate(${rd.toFixed(1)},${lx.toFixed(1)},${ly.toFixed(1)})" data-wlabel="${num}" class="whl-label">${label}</text>`;
      }

      // Center
      svg += `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="url(#cg)" stroke="#444" stroke-width="0.5"/>`;
      svg += `<text x="${cx}" y="${cy - 16}" text-anchor="middle" font-size="10" font-weight="700" fill="#d4af37" font-family="Cinzel,serif" letter-spacing="2">WHEEL</text>`;
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="9" fill="#aaa" font-family="Inter,sans-serif" font-weight="600" id="whl-hit-count">0/38</text>`;
      svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="7.5" fill="#666" font-family="Inter,sans-serif" id="whl-last-label">--</text>`;

      // Ball marker
      svg += `<circle id="whl-ball" cx="${cx}" cy="${cy - labelR}" r="5.5" fill="#d4af37" stroke="#fff" stroke-width="1.2" opacity="0" class="whl-ball"/>`;

      svg += `</svg>`;
      container.innerHTML = svg;
    }

    _updateWheelViz() {
      const container = document.getElementById('wheel-viz');
      if (!container || !container.querySelector('.whl-pocket')) return;

      const order = BTHG.WHEEL_LAYOUTS.american;
      const N = order.length;
      const lastSpun = this.engine.history.length > 0 ? this.engine.history[this.engine.history.length - 1] : null;

      for (let i = 0; i < N; i++) {
        const num = order[i];
        const rn = this.engine.getNumber(num);
        const pocket = container.querySelector(`[data-wnum="${num}"]`);
        const label = container.querySelector(`[data-wlabel="${num}"]`);
        if (!pocket) continue;

        const isHit = rn && rn.hits > 0;
        const inFinal = this.engine.finalEight.includes(num);
        const isLast = lastSpun === num;

        // Hit pockets dim, unhit stay bright
        pocket.style.opacity = isHit ? '0.3' : '1';
        pocket.style.stroke = '#2a2a2a';
        pocket.style.strokeWidth = '0.4';
        pocket.style.filter = '';

        if (inFinal) {
          pocket.style.opacity = '1';
          pocket.style.stroke = '#5EFF00';
          pocket.style.strokeWidth = '1.5';
        }

        if (isLast) {
          pocket.style.filter = 'url(#pocket-glow)';
          pocket.style.stroke = '#d4af37';
          pocket.style.strokeWidth = '2.5';
          pocket.style.opacity = '1';
        }

        if (label) {
          label.style.opacity = isHit && !inFinal && !isLast ? '0.3' : '1';
          label.style.fill = isLast ? '#d4af37' : inFinal ? '#5EFF00' : '#fff';
        }
      }

      // Center text
      const hitEl = document.getElementById('whl-hit-count');
      const lastEl = document.getElementById('whl-last-label');
      if (hitEl) hitEl.textContent = `${this.engine.getUniqueHitCount()}/38`;
      if (lastEl) lastEl.textContent = lastSpun !== null ? `Last: ${BTHG.displayNumber(lastSpun)}` : '--';

      // Ball marker position
      const ball = document.getElementById('whl-ball');
      if (ball && lastSpun !== null) {
        const idx = order.indexOf(lastSpun);
        if (idx >= 0) {
          const pa = (2 * Math.PI) / N;
          const ma = -Math.PI / 2 + idx * pa + pa / 2;
          const r = 125;
          ball.setAttribute('cx', (160 + r * Math.cos(ma)).toFixed(1));
          ball.setAttribute('cy', (160 + r * Math.sin(ma)).toFixed(1));
          ball.setAttribute('opacity', '1');
        }
      }
    }

    // ---- Physics Status Panel -----------------------------------
    _updatePhysicsStatus() {
      const el = document.getElementById('physics-status');
      if (!el) return;

      const f = this.fusion;
      const hasRPM = f.referenceLocked;
      const hasBias = f.empiricalBias && Object.keys(f.empiricalBias).length > 0;
      const tierColors = ['#ff3333', '#FFCC1A', '#008CFF', '#5EFF00'];
      const tierLabels = ['INSUFFICIENT', 'LIMITED', 'GOOD', 'PREMIUM LOCK'];

      if (!hasRPM && !hasBias) {
        el.innerHTML = `<div style="text-align:center;padding:0.5rem;"><p style="color:#555;font-size:0.8rem;">No calibration data.</p><p style="color:#444;font-size:0.7rem;margin-top:0.3rem;">Tap <strong style="color:#d4af37;">Cal</strong> on the table to begin measuring wheel physics.</p></div>`;
        return;
      }

      let h = '<div class="rt-phys-grid">';
      h += `<div class="rt-phys-stat"><span class="rt-phys-label">QUALITY</span><span class="rt-phys-value" style="color:${tierColors[f.qualityTier]};">${tierLabels[f.qualityTier]}</span><span class="rt-phys-sub">Tier ${f.qualityTier}/3</span></div>`;

      if (hasRPM) {
        h += `<div class="rt-phys-stat"><span class="rt-phys-label">BALL</span><span class="rt-phys-value">${BTHG.Physics.radSToRPM(f.omega_b0).toFixed(1)}</span><span class="rt-phys-sub">RPM</span></div>`;
        h += `<div class="rt-phys-stat"><span class="rt-phys-label">DECAY</span><span class="rt-phys-value">${f.kPerSec.toFixed(3)}</span><span class="rt-phys-sub">k/sec</span></div>`;
        h += `<div class="rt-phys-stat"><span class="rt-phys-label">WHEEL</span><span class="rt-phys-value">${BTHG.Physics.radSToRPM(f.omega_w).toFixed(1)}</span><span class="rt-phys-sub">RPM</span></div>`;
      }

      if (hasBias) {
        h += `<div class="rt-phys-stat"><span class="rt-phys-label">BIAS</span><span class="rt-phys-value">${Object.keys(f.empiricalBias).length}</span><span class="rt-phys-sub">pockets</span></div>`;
      }

      h += `<div class="rt-phys-stat"><span class="rt-phys-label">CONDITION</span><span class="rt-phys-value" style="color:${f.getWheelCondition() === 'stable' ? '#5EFF00' : f.getWheelCondition() === 'caution' ? '#FFCC1A' : '#ff3333'};">${f.getWheelCondition().toUpperCase()}</span><span class="rt-phys-sub">stability</span></div>`;
      h += `<div class="rt-phys-stat"><span class="rt-phys-label">SESSIONS</span><span class="rt-phys-value">${f.calibrationCount}</span><span class="rt-phys-sub">calibrations</span></div>`;
      h += '</div>';
      // Cycle-timing readout: learned live from the drop cadence, separate
      // from the ball-physics tiers above. Filled by _renderTimingReadout.
      // The Reset button clears the learned cadence (via a cutoff marker)
      // without deleting any spins — for when back-fill got tapped with
      // Real Time ON and polluted the timing.
      h += '<div class="rt-timing-row">' +
             '<div id="timing-readout" class="rt-timing-readout">Timing: switch Real Time ON and tap each drop</div>' +
             '<button id="btn-reset-timing" class="rt-reset-timing" type="button">Reset Timing</button>' +
           '</div>';
      el.innerHTML = h;
      const rtBtn = el.querySelector('#btn-reset-timing');
      if (rtBtn) rtBtn.addEventListener('click', () => {
        if (BTHG.UI && BTHG.UI.resetTiming) BTHG.UI.resetTiming();
        this._timing = null;
      });
      if (this._timing) this._renderTimingReadout(this._timing);
    }

    // ---- Series Intelligence Panel ------------------------------
    _updateSeriesIntel() {
      const el = document.getElementById('series-intel');
      if (!el) return;

      const e = this.engine;
      const remaining = e.getRemainingCount();
      const hit = e.getUniqueHitCount();
      const avg = e.getSeriesAverage();
      const pct = (hit / 38 * 100).toFixed(0);

      let h = '<div class="rt-intel-grid">';
      h += `<div class="rt-intel-row"><span class="rt-intel-label">Completed Series</span><span class="rt-intel-value">${e.seriesCount}</span></div>`;
      h += `<div class="rt-intel-row"><span class="rt-intel-label">Series Average</span><span class="rt-intel-value">${avg > 0 ? avg + ' spins' : 'N/A'}</span></div>`;
      h += `<div class="rt-intel-row"><span class="rt-intel-label">Current Progress</span><span class="rt-intel-value">${hit}/38 <span style="color:#666;">(${pct}%)</span></span></div>`;
      h += `<div class="rt-intel-row"><span class="rt-intel-label">Lifetime Spins</span><span class="rt-intel-value">${e.lifetimeSpins}</span></div>`;

      if (avg > 0 && e.totalSpins > 0) {
        const est = Math.max(0, avg - e.totalSpins);
        h += `<div class="rt-intel-row"><span class="rt-intel-label">Est. Remaining</span><span class="rt-intel-value" style="color:${est < 30 ? '#FFCC1A' : '#aaa'};">~${est} spins</span></div>`;
      }

      // Final 8 status
      if (e.finalActivated) {
        h += `<div class="rt-intel-row" style="border-top:1px solid rgba(94,255,0,0.2);padding-top:0.4rem;margin-top:0.2rem;"><span class="rt-intel-label" style="color:#5EFF00;">FINAL ${remaining} ACTIVE</span><span class="rt-intel-value" style="color:#5EFF00;">${remaining} left</span></div>`;
        h += `<div class="rt-intel-row"><span class="rt-intel-label">Trinity Multiplier</span><span class="rt-intel-value" style="color:#d4af37;">${e.getTrinityMultiplier()}x</span></div>`;
        h += `<div class="rt-intel-row"><span class="rt-intel-label">Miss Streak</span><span class="rt-intel-value">${e.trinityMissStreak}</span></div>`;
      }

      // NOTE: "Most Overdue (Unhit)" panel removed — it was meaningless.
      // Every unhit number's `ago` increments on every spin, so all unhit
      // numbers are mathematically tied (equally overdue). The old sort did
      // nothing and just displayed the lowest-numbered unhit pockets.
      // The real signal (numbers due relative to the table's learned average
      // completion point) is being built in the timing engine — see worklog.

      h += '</div>';
      el.innerHTML = h;
    }

    // ---- Toast Notifications ------------------------------------
    _showToast(message, duration) {
      duration = duration || 3000;
      // Remove any existing toast
      const existing = this.container.querySelector('.rt-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'rt-toast';
      toast.textContent = message;
      this.container.appendChild(toast);

      // Trigger slide-in
      requestAnimationFrame(() => toast.classList.add('rt-toast-visible'));

      // Auto-dismiss
      setTimeout(() => {
        toast.classList.remove('rt-toast-visible');
        setTimeout(() => toast.remove(), 400);
      }, duration);
    }

    _saveState() {
      const state = {
        engine: this.engine.toJSON(),
        bankroll: this.bankroll.toJSON(),
        fusion: this.fusion.toJSON(),
        machineId: BTHG._currentMachineId || 'default',
        casino: BTHG._currentCasino || 'Unknown',
        bettingEnabled: this.bettingEnabled,
      };
      BTHG.Storage.Session.save(state);
    }

    restoreBettingState(state) {
      if (state && state.bettingEnabled !== undefined) {
        this.bettingEnabled = state.bettingEnabled;
        const input = document.getElementById('betting-toggle-input');
        const label = document.getElementById('betting-toggle-label');
        if (input) input.checked = this.bettingEnabled;
        if (label) label.textContent = this.bettingEnabled ? 'BET ON' : 'BET OFF';
      }
    }
  }

  BTHG.RouletteTableUI = RouletteTableUI;
  window.BTHG = BTHG;
})();
