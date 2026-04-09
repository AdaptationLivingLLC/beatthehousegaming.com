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
    }

    render() {
      this.container.innerHTML = '';
      this.container.className = 'roulette-app-container';

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

      this.container.innerHTML = html;
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
      [37, 0].forEach(num => {
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
          <span class="rt-sb-name">2:1</span>
          <span class="rt-sb-hit">0</span>
        `;
        col.appendChild(cell);
      });
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
        if (label === 'RED') cell.classList.add('rt-band-red');
        if (label === 'BLACK') cell.classList.add('rt-band-black');
        cell.dataset.band = label;
        cell.dataset.sbKey = label;
        cell.innerHTML = `
          <span class="rt-sb-ago">0</span>
          <span class="rt-sb-name">${label}</span>
          <span class="rt-sb-hit">0</span>
        `;
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
          this._autoSaveSeries(data);
          this._showToast(`SERIES #${data.seriesCount} COMPLETE — ${data.totalSpins} spins`, 4000);
        }
        if (event === 'finalActivated') {
          this._showToast(`FINAL ${data.numbers.length} ACTIVATED`, 3000);
        }
        if (event === 'finalWarning') {
          this._showToast('FINAL 9 — Prepare to bet', 3000);
        }
      });
    }

    _onNumberTap(num) {
      // Capture betting state BEFORE recordSpin modifies it
      // (recordSpin resets trinityMissStreak on hit, and can clear finalEightJustHit on series complete)
      const wasFinalActive = this.engine.finalActivated;
      const wasInFinal = this.engine.finalEight.includes(num);
      const numbersPlayed = this.engine.getTrinityNumbers().length;
      const multiplier = this.engine.getTrinityMultiplier();

      // Record spin (modifies engine state)
      this.engine.recordSpin(num);

      // Record bankroll using pre-spin state
      if (wasFinalActive && numbersPlayed > 0 && this.bettingEnabled) {
        this.bankroll.recordSpin(wasInFinal, numbersPlayed, multiplier);
      }

      // Learn scatter offset if calibrated
      if (this.fusion.qualityTier >= 2 && this.predictor.lastResult) {
        this.fusion.learnOffset(this.predictor.lastResult.dropIndex, num);
      }

      // Persist to IndexedDB
      BTHG.Storage.SpinDB.addSpin({
        number: num,
        timestamp: Date.now(),
        machineId: BTHG._currentMachineId || 'default',
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

    _flashCell(num) {
      const cell = this.container.querySelector(`.rt-cell[data-num="${num}"]`);
      if (cell) {
        cell.classList.add('rt-just-hit');
        setTimeout(() => cell.classList.remove('rt-just-hit'), 1200);
      }
    }

    _onUndo() {
      if (this.engine.undoLastSpin()) {
        BTHG.Storage.SpinDB.deleteLastSpin(BTHG._currentMachineId || 'default');
        this.update();
        this._saveState();
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
      if (this.engine.totalSpins === 0) return;
      this._showEndSeriesConfirm();
    }

    _showEndSeriesConfirm() {
      const overlay = document.createElement('div');
      overlay.className = 'rt-overlay rt-overlay-visible';
      const hit = this.engine.getUniqueHitCount();
      const remaining = this.engine.getRemainingCount();
      overlay.innerHTML = `
        <div class="rt-overlay-content">
          <div class="rt-celebrate-icon" style="color:var(--gold);"><i class="fas fa-flag-checkered"></i></div>
          <h2 style="color:var(--gold);">End Current Series?</h2>
          <p style="color:#aaa;margin:0.75rem 0;">This saves all data from this series (${hit}/38 hit, ${this.engine.totalSpins} spins) and starts a new series.</p>
          <p style="color:#888;font-size:0.85rem;margin-bottom:1rem;">Tracking will continue — spin history, side bets, and calibrations carry over.</p>
          <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
            <button class="btn-gold" id="confirm-end-series" style="width:auto;padding:0.7rem 2rem;">Save & End Series</button>
            <button class="btn-outline" id="cancel-end-series" style="padding:0.7rem 2rem;">Cancel</button>
          </div>
        </div>
      `;
      this.container.appendChild(overlay);

      document.getElementById('confirm-end-series').addEventListener('click', () => {
        const fusionSnapshot = this.fusion.toJSON();
        const machineId = BTHG._currentMachineId || 'default';
        const casino = BTHG._currentCasino || 'Unknown';
        const seriesData = this.engine.manualEndSeries(fusionSnapshot, machineId, casino);

        // Save to IndexedDB
        BTHG.Storage.SeriesDB.saveSeries(seriesData).then(() => {
          this.update();
          this._saveState();
          overlay.remove();
          this._showSeriesEndConfirmation(seriesData);
        });
      });

      document.getElementById('cancel-end-series').addEventListener('click', () => overlay.remove());
    }

    _showSeriesEndConfirmation(data) {
      const overlay = document.createElement('div');
      overlay.className = 'rt-overlay';
      overlay.innerHTML = `
        <div class="rt-overlay-content">
          <div class="rt-celebrate-icon" style="color:var(--final-green);"><i class="fas fa-check-circle"></i></div>
          <h2 style="color:var(--final-green);">Series Saved</h2>
          <p style="color:#aaa;margin:0.5rem 0;">Series #${data.seriesNumber} — ${data.totalSpins} spins, ${data.uniqueHit}/38 numbers hit</p>
          <p style="color:#888;font-size:0.85rem;">New series started. All tracking continues.</p>
          <button class="rt-overlay-close" style="margin-top:1rem;">Continue Playing</button>
        </div>
      `;
      this.container.appendChild(overlay);
      overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
      setTimeout(() => overlay.classList.add('rt-overlay-visible'), 50);
    }

    /**
     * Auto-save a completed series (all 38 numbers hit) to IndexedDB
     */
    _autoSaveSeries(eventData) {
      const fusionSnapshot = this.fusion.toJSON();
      const machineId = BTHG._currentMachineId || 'default';
      const casino = BTHG._currentCasino || 'Unknown';

      const record = {
        machineId,
        casino,
        seriesNumber: eventData.seriesCount,
        totalSpins: eventData.totalSpins,
        spinHistory: [...this.engine.history],
        endType: 'auto',
        timestamp: Date.now(),
        calibration: fusionSnapshot,
        sideBetState: {
          ago: { ...this.engine.sideBetAgo },
          hits: { ...this.engine.sideBetHits },
        },
        seriesAverage: eventData.seriesAverage,
        uniqueHit: 38,
        remaining: 0,
        finalEight: [],
        finalActivated: true,
        lifetimeSpins: this.engine.lifetimeSpins,
      };

      BTHG.Storage.SeriesDB.saveSeries(record).then(() => {
        this._saveState();
      });
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

      const nums = result.recommendedNumbers.map(n => {
        const color = BTHG.colorForNumber(n);
        return `<span class="rt-pred-num rt-${color}">${BTHG.displayNumber(n)}</span>`;
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
      el.innerHTML = h;
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

      // Top 5 coldest unhit numbers
      if (e.totalSpins > 5) {
        const cold = [...e.numbers].filter(n => n.hits === 0).sort((a, b) => b.ago - a.ago).slice(0, 5);
        if (cold.length > 0 && cold.length <= 20) {
          h += `<div style="margin-top:0.5rem;padding-top:0.4rem;border-top:1px solid rgba(0,140,255,0.15);"><span class="rt-intel-label" style="color:#008CFF;display:block;margin-bottom:0.3rem;">Most Overdue (Unhit)</span><div style="display:flex;gap:3px;flex-wrap:wrap;">`;
          for (const n of cold) {
            const c = BTHG.colorForNumber(n.value);
            h += `<span class="rt-spin-chip rt-${c}" style="font-size:0.7rem;" title="${n.ago} spins ago">${BTHG.displayNumber(n.value)}</span>`;
          }
          h += '</div></div>';
        }
      }

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
