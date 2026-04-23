// ============================================================
// app.js — App entry, navigation, session setup, overlays
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// v3: Calibration hub, pocket timing (IN POCKET + felt table),
//   data persistence, settings (parseFloat bets, bet dropdown),
//   bankroll panel, data inspector, key generator,
//   pocket timing feeds into series engine, wheel direction toggle
// Contains: init, showSessionSetup, showSessionChoice, startSession,
//   resumeSession, loadPreviousTable, launchTable, showCalibrationHub,
//   showRPMCalibration, showPocketTimingOverlay, showSettingsPanel,
//   showBankrollPanel, showDataInspector, showKeyGenerator
// ============================================================

(function() {
  const BTHG = window.BTHG;

  let engine, bankroll, fusion, predictor, tableUI;

  // Both initPaywall() and initAdminPanel() are async; calling them
  // without await leaves `!<Promise>` which is always false, so gates
  // never fire. Every step below must be awaited.
  async function init() {
    const access = await BTHG.Paywall.initPaywall();

    const params = new URLSearchParams(window.location.search);
    if (params.get('admin')) {
      const adminHandled = await BTHG.AdminKeygen.initAdminPanel();
      if (adminHandled) return;
    }

    if (!access) {
      if (typeof BTHG.Paywall.showGateScreen === 'function') {
        BTHG.Paywall.showGateScreen();
      }
      return;
    }

    const timerEl = document.getElementById('access-timer');
    if (timerEl) BTHG.Paywall.startTimer(timerEl);

    const saved = BTHG.Storage.Session.load();
    if (saved && saved.engine && saved.engine.totalSpins > 0) {
      showSessionChoice(saved);
    } else {
      showSessionSetup();
    }
  }

  async function showSessionSetup() {
    const root = document.getElementById('app-root');

    // Load all previously used tables from IndexedDB
    let tables = [];
    try {
      tables = await BTHG.Storage.TableHistory.getAllTables();
    } catch (e) {
      console.warn('Failed to load table history:', e);
    }

    let tableListHTML = '';
    if (tables.length > 0) {
      tableListHTML = `
        <div class="setup-section-label">PREVIOUS TABLES</div>
        <div class="table-history-list" id="table-history-list">
          ${tables.map(t => {
            const lastDate = t.lastUsed ? new Date(t.lastUsed).toLocaleDateString() : 'Unknown';
            const casinoName = t.casino || 'Unknown Casino';
            const spinsLabel = t.hasActiveSession
              ? `${t.activeSpins} active + ${t.totalSpins} saved spins`
              : `${t.totalSpins} spins`;
            const seriesLabel = t.hasActiveSession
              ? (t.activeSeriesCount + t.seriesCount)
              : t.seriesCount;
            const activeTag = t.hasActiveSession ? '<span class="th-active-tag">ACTIVE</span>' : '';
            const calTag = t.hasCal ? '<span class="th-cal-tag">CAL</span>' : '';
            return `
              <button class="th-table-btn" data-machine="${t.machineId}" data-casino="${casinoName}">
                <div class="th-table-main">
                  <span class="th-table-name">${t.machineId}</span>
                  <span class="th-table-casino">${casinoName}</span>
                </div>
                <div class="th-table-stats">
                  <span>${spinsLabel}</span>
                  <span>${seriesLabel} series</span>
                  <span>Last: ${lastDate}</span>
                </div>
                <div class="th-table-tags">${activeTag}${calTag}</div>
              </button>
            `;
          }).join('')}
        </div>
        <div style="text-align:center;margin:1.25rem 0 0.5rem;">
          <span style="color:#444;font-size:0.75rem;letter-spacing:0.1em;">— OR START NEW —</span>
        </div>
      `;
    }

    root.innerHTML = `
      <div class="session-setup">
        <div class="setup-logo">
          <div class="css-logo">ROULETTE<br>BREAKER</div>
          <p class="setup-subtitle">Professional Roulette Analytics</p>
        </div>
        <div class="setup-form">
          ${tableListHTML}
          <div class="setup-field">
            <label>Casino Name</label>
            <input type="text" id="casino-name" placeholder="e.g. Bellagio" autocomplete="off">
          </div>
          <div class="setup-field">
            <label>Machine / Table ID</label>
            <input type="text" id="machine-id" placeholder="e.g. Table 5 or Machine #12" autocomplete="off">
          </div>
          <button id="btn-start-session" class="btn-gold">Start New Table</button>
        </div>
      </div>
    `;

    // Previous table buttons
    root.querySelectorAll('.th-table-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const machineId = btn.dataset.machine;
        const casino = btn.dataset.casino;
        loadPreviousTable(casino, machineId);
      });
    });

    document.getElementById('btn-start-session').addEventListener('click', () => {
      const casino = document.getElementById('casino-name').value.trim() || 'Unknown Casino';
      const machine = document.getElementById('machine-id').value.trim() || 'Table 1';
      startSession(casino, machine);
    });
  }

  function showSessionChoice(saved) {
    const root = document.getElementById('app-root');
    const spins = saved.engine.totalSpins || 0;
    const seriesCount = saved.engine.seriesCount || 0;
    root.innerHTML = `
      <div class="session-setup">
        <div class="setup-logo">
          <div class="css-logo">ROULETTE<br>BREAKER</div>
          <p class="setup-subtitle">Professional Roulette Analytics</p>
        </div>
        <div class="setup-form">
          <div class="session-resume-info">
            <p style="color:#d4af37;font-weight:700;margin-bottom:0.5rem;">Previous Session Found</p>
            <p style="color:#aaa;font-size:0.9rem;">${spins} spins recorded | ${seriesCount} series completed</p>
            ${saved.casino ? `<p style="color:#666;font-size:0.8rem;margin-top:0.25rem;">${saved.casino} — ${saved.machineId || 'Unknown table'}</p>` : ''}
          </div>
          <button id="btn-continue" class="btn-gold">Continue Session</button>
          <button id="btn-new" class="btn-outline" style="margin-top:1rem;">Start New Session</button>
        </div>
      </div>
    `;

    document.getElementById('btn-continue').addEventListener('click', () => {
      resumeSession(saved);
    });

    document.getElementById('btn-new').addEventListener('click', () => {
      // Don't clear session data — it's still in IndexedDB for future loading
      BTHG.Storage.Session.clear();
      showSessionSetup();
    });
  }

  async function loadPreviousTable(casino, machineId) {
    // Check if there's an active session for this exact table
    const saved = BTHG.Storage.Session.load();
    if (saved && saved.machineId === machineId && saved.engine && saved.engine.totalSpins > 0) {
      // Resume the active session directly
      resumeSession(saved);
      return;
    }

    // No active session — load from IndexedDB history
    BTHG._currentCasino = casino;
    BTHG._currentMachineId = machineId;

    const settings = BTHG.Storage.Settings.load();

    engine = new BTHG.SeriesEngine();
    engine.finalTargetCount = settings.finalTargetCount || 8;
    engine.isAutoAddEnabled = settings.autoAdd !== false;

    bankroll = new BTHG.BankrollManager(settings.bankroll, settings.baseBet, settings.payoutRatio);
    fusion = new BTHG.CalibratorDataFusion();
    predictor = new BTHG.PredictionEngine();

    // Load calibrations
    await loadCalibrations(machineId);

    // Load all saved spins for this table and replay them into the engine
    try {
      const spins = await BTHG.Storage.SpinDB.getSpinsByMachine(machineId);
      if (spins.length > 0) {
        // Sort by timestamp to ensure correct order
        spins.sort((a, b) => a.timestamp - b.timestamp);
        for (const spin of spins) {
          engine.recordSpin(spin.number);
        }
      }

      // Load series history to set the series average
      const seriesRecords = await BTHG.Storage.SeriesDB.getSeriesByMachine(machineId);
      if (seriesRecords.length > 0) {
        engine.seriesHistory = seriesRecords.map(s => s.totalSpins);
        engine.seriesCount = seriesRecords.length;
        engine.seriesAverage = Math.round(
          engine.seriesHistory.reduce((a, b) => a + b, 0) / engine.seriesHistory.length
        );
      }
    } catch (e) {
      console.warn('Failed to load table history:', e);
    }

    launchTable();
  }

  function startSession(casino, machineId) {
    BTHG._currentCasino = casino;
    BTHG._currentMachineId = machineId;

    const settings = BTHG.Storage.Settings.load();

    engine = new BTHG.SeriesEngine();
    engine.finalTargetCount = settings.finalTargetCount || 8;
    engine.isAutoAddEnabled = settings.autoAdd !== false;

    bankroll = new BTHG.BankrollManager(settings.bankroll, settings.baseBet, settings.payoutRatio);
    fusion = new BTHG.CalibratorDataFusion();
    predictor = new BTHG.PredictionEngine();

    // Load any saved calibrations for this machine
    loadCalibrations(machineId);

    launchTable();
  }

  function resumeSession(saved) {
    BTHG._currentMachineId = saved.machineId || 'default';
    BTHG._currentCasino = saved.casino || 'Unknown';

    engine = new BTHG.SeriesEngine();
    engine.fromJSON(saved.engine);

    bankroll = new BTHG.BankrollManager();
    bankroll.fromJSON(saved.bankroll);

    fusion = new BTHG.CalibratorDataFusion();
    fusion.fromJSON(saved.fusion);

    predictor = new BTHG.PredictionEngine();

    launchTable();

    // Restore betting toggle state
    if (tableUI) tableUI.restoreBettingState(saved);
  }

  /**
   * Load all saved calibrations for a machine and apply them to the fusion model.
   * This ensures calibration data carries over between sessions.
   */
  async function loadCalibrations(machineId) {
    try {
      const calibrations = await BTHG.Storage.CalibrationDB.getCalibrationsByMachine(machineId);
      if (!calibrations || calibrations.length === 0) return;

      for (const cal of calibrations) {
        if (cal.type === 'rpm' && cal.data) {
          // Re-apply RPM calibration measurements
          fusion.updateFromManual(
            cal.data.wheelRPM || 25,
            cal.data.ballRPM || 0,
            cal.data.kEstimate || 0.5
          );
          if (cal.data.cv !== undefined) {
            fusion.wheelJitterCV = cal.data.cv;
          }
        } else if (cal.type === 'pocket_timing' && cal.data) {
          // Re-apply pocket timing empirical bias
          if (cal.data.empiricalBias) {
            for (const [idx, freq] of Object.entries(cal.data.empiricalBias)) {
              if (!fusion.empiricalBias) fusion.empiricalBias = {};
              const i = parseInt(idx);
              fusion.empiricalBias[i] = fusion.empiricalBias[i] !== undefined
                ? fusion.empiricalBias[i] * 0.6 + freq * 0.4
                : freq;
            }
          }
          if (cal.data.deltaDistribution) {
            if (!fusion.pocketDeltaDistribution) fusion.pocketDeltaDistribution = {};
            for (const [d, count] of Object.entries(cal.data.deltaDistribution)) {
              fusion.pocketDeltaDistribution[parseInt(d)] =
                (fusion.pocketDeltaDistribution[parseInt(d)] || 0) + count;
            }
          }
        }
      }
      fusion._updateQualityTier();
    } catch (e) {
      console.warn('Failed to load calibrations:', e);
    }
  }

  function launchTable() {
    const root = document.getElementById('app-root');
    root.innerHTML = '';

    tableUI = new BTHG.RouletteTableUI(root, engine, bankroll, fusion, predictor);
    tableUI.render();

    // Handle table actions
    tableUI.onAction((action) => {
      if (action === 'openCalibration') showCalibrationHub();
      if (action === 'openSettings') showSettingsPanel();
      if (action === 'openDataInspector') showDataInspector();
      if (action === 'openBankroll') showBankrollPanel();
    });
  }

  // ============================================================
  // CALIBRATION HUB — Two separate calibration modes
  // ============================================================
  function showCalibrationHub() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';
    overlay.id = 'calibration-hub';

    const rpmCount = fusion.calibrationCount || 0;
    const hasRPM = fusion.referenceLocked;
    const hasBias = fusion.empiricalBias && Object.keys(fusion.empiricalBias).length > 0;

    overlay.innerHTML = `
      <div class="rt-overlay-content cal-overlay">
        <h2 style="color:#d4af37;"><i class="fas fa-crosshairs"></i> Calibration Center</h2>
        <p class="cal-hub-info">Two independent calibrations work together. RPM measures ball physics. Pocket timing records landing patterns. Combined, they produce the most accurate predictions.</p>

        <!-- Current Status -->
        <div class="cal-status-grid">
          <div class="cal-status-card">
            <span class="cal-status-label">RPM STATUS</span>
            <span class="cal-status-value" style="color:${hasRPM ? '#5EFF00' : '#ff3333'};">${hasRPM ? 'LOCKED' : 'NONE'}</span>
            ${hasRPM ? `<span class="cal-status-detail">${BTHG.Physics.radSToRPM(fusion.omega_b0).toFixed(1)} RPM | k=${fusion.kPerSec.toFixed(3)}</span>` : ''}
          </div>
          <div class="cal-status-card">
            <span class="cal-status-label">POCKET DATA</span>
            <span class="cal-status-value" style="color:${hasBias ? '#5EFF00' : '#888'};">${hasBias ? Object.keys(fusion.empiricalBias).length + ' POINTS' : 'NONE'}</span>
          </div>
          <div class="cal-status-card">
            <span class="cal-status-label">QUALITY TIER</span>
            <span class="cal-status-value" style="color:${['#ff3333','#FFCC1A','#008CFF','#5EFF00'][fusion.qualityTier]};">${fusion.qualityTier}/3</span>
          </div>
          <div class="cal-status-card">
            <span class="cal-status-label">SESSIONS</span>
            <span class="cal-status-value">${rpmCount}</span>
          </div>
        </div>

        <!-- Calibration Options -->
        <div class="cal-options">
          <button class="cal-option-btn" id="cal-open-rpm">
            <div class="cal-opt-icon"><i class="fas fa-tachometer-alt"></i></div>
            <div class="cal-opt-text">
              <strong>Ball Speed (RPM)</strong>
              <span>Tap ball passes to measure speed and decay rate. Best done while watching a live spin. Feeds the physics prediction model.</span>
            </div>
          </button>
          <button class="cal-option-btn" id="cal-open-pocket">
            <div class="cal-opt-icon"><i class="fas fa-stopwatch"></i></div>
            <div class="cal-opt-text">
              <strong>Pocket-to-Pocket Timing</strong>
              <span>Tap the landed number each spin. Records ms-precision intervals between landings and builds a scatter/bias model for the wheel.</span>
            </div>
          </button>
        </div>

        <div class="cal-hub-explain">
          <h4><i class="fas fa-info-circle"></i> How They Work Together</h4>
          <p><strong>RPM Calibration</strong> calculates where the ball will <em>drop off the rim</em> using exponential decay physics: omega(t) = omega0 * e^(-kt).</p>
          <p><strong>Pocket Timing</strong> captures where the ball actually <em>lands</em> after bouncing. This scatter distribution is convolved with the drop prediction: P_final[i] = sum(P_drop[d] * P_scatter[(i-d+38)%38]).</p>
          <p>The more data from both sources, the tighter the prediction window becomes. Each calibration saves automatically and carries over to future sessions on this table.</p>
        </div>

        <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    document.getElementById('cal-open-rpm').addEventListener('click', () => {
      overlay.remove();
      showRPMCalibration();
    });

    document.getElementById('cal-open-pocket').addEventListener('click', () => {
      overlay.remove();
      try {
        showPocketTimingOverlay();
      } catch (e) {
        console.error('Pocket timing overlay error:', e);
        alert('Error loading pocket timing: ' + e.message);
      }
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // RPM CALIBRATION — Ball speed measurement
  // ============================================================
  function showRPMCalibration() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';

    const session = new BTHG.ManualCalibrationSession();

    overlay.innerHTML = `
      <div class="rt-overlay-content cal-overlay">
        <h2 style="color:#d4af37;"><i class="fas fa-tachometer-alt"></i> RPM Calibration</h2>
        <p class="cal-instructions" id="cal-instructions">Measures ball speed and deceleration rate. Watch a live spin — press START, tap each time the ball passes a fixed reference point on the rim, press DROP when ball falls off, then enter the landed number.</p>

        <div class="cal-live-display">
          <div class="cal-stat">
            <span class="cal-stat-label">TAPS</span>
            <span class="cal-stat-value" id="cal-taps">0</span>
          </div>
          <div class="cal-stat">
            <span class="cal-stat-label">LIVE RPM</span>
            <span class="cal-stat-value" id="cal-rpm">0.0</span>
          </div>
          <div class="cal-stat">
            <span class="cal-stat-label">STATUS</span>
            <span class="cal-stat-value" id="cal-status">IDLE</span>
          </div>
        </div>

        <div class="cal-buttons">
          <button id="cal-start" class="btn-gold">START</button>
          <button id="cal-ball-pass" class="btn-outline" disabled>TAP (Ball Pass)</button>
          <button id="cal-drop" class="btn-outline" style="background:rgba(255,50,50,0.2);" disabled>DROP</button>
        </div>

        <div id="cal-land-section" style="display:none;">
          <p style="color:#FFCC1A;margin:1rem 0 0.5rem;">Where did the ball land?</p>
          <input type="text" id="cal-landed" placeholder="Number (0-36 or 00)" class="cal-input">
          <button id="cal-landed-btn" class="btn-gold" style="margin-top:0.5rem;">Confirm</button>
        </div>

        <div id="cal-results" style="display:none;margin-top:1rem;"></div>

        <div class="cal-wheel-rpm" style="margin-top:1.5rem;">
          <label style="color:#aaa;font-size:0.85rem;">Wheel RPM (estimate — typically 20-30 for a standard wheel)</label>
          <input type="number" id="cal-wheel-rpm" value="25" min="1" max="100" class="cal-input">
        </div>

        <div style="display:flex;gap:0.5rem;margin-top:1rem;">
          <button class="btn-outline" id="cal-back-hub" style="flex:1;"><i class="fas fa-arrow-left"></i> Back to Hub</button>
          <button class="rt-overlay-close" style="flex:1;">Close</button>
        </div>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    let refreshInterval;

    document.getElementById('cal-start').addEventListener('click', () => {
      session.start();
      document.getElementById('cal-start').disabled = true;
      document.getElementById('cal-ball-pass').disabled = false;
      document.getElementById('cal-drop').disabled = false;
      document.getElementById('cal-status').textContent = 'TIMING...';
      document.getElementById('cal-instructions').textContent = 'Tap each time the ball passes your reference point on the rim.';

      refreshInterval = setInterval(() => {
        const status = session.getStatus();
        document.getElementById('cal-taps').textContent = status.taps;
        document.getElementById('cal-rpm').textContent = status.liveRPM.toFixed(1);
      }, 100);
    });

    document.getElementById('cal-ball-pass').addEventListener('click', () => {
      session.recordBallPass();
    });

    document.getElementById('cal-drop').addEventListener('click', () => {
      const result = session.recordDrop();
      if (result && result.error) {
        document.getElementById('cal-instructions').textContent = result.error;
        return;
      }
      clearInterval(refreshInterval);
      document.getElementById('cal-ball-pass').disabled = true;
      document.getElementById('cal-drop').disabled = true;
      document.getElementById('cal-land-section').style.display = 'block';
      document.getElementById('cal-status').textContent = 'WAITING FOR LAND';
      document.getElementById('cal-instructions').textContent = 'Enter the number where the ball landed.';
    });

    document.getElementById('cal-landed-btn').addEventListener('click', () => {
      const input = document.getElementById('cal-landed').value.trim();
      const num = BTHG.parseNumber(input);
      if (num === null) { alert('Enter a valid number (0-36 or 00)'); return; }

      const result = session.recordLanded(num);
      if (!result) { alert('Not enough data. Try again.'); return; }

      // Apply to fusion
      const wheelRPM = parseFloat(document.getElementById('cal-wheel-rpm').value) || 25;
      fusion.updateFromManual(wheelRPM, result.ballRPM, result.kEstimate);
      fusion.wheelJitterCV = result.cv;

      // Save to CalibrationDB
      BTHG.Storage.CalibrationDB.saveCalibration({
        machineId: BTHG._currentMachineId || 'default',
        casino: BTHG._currentCasino || 'Unknown',
        type: 'rpm',
        timestamp: Date.now(),
        data: {
          ballRPM: result.ballRPM,
          kEstimate: result.kEstimate,
          omega_b0: result.omega_b0,
          cv: result.cv,
          condition: result.condition,
          wheelRPM: wheelRPM,
          tapCount: result.tapCount,
          validIntervals: result.validIntervals,
          avgIntervalMs: result.avgIntervalMs,
        }
      });

      // Show results
      const resultsDiv = document.getElementById('cal-results');
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div style="background:rgba(0,179,77,0.15);border:1px solid rgba(0,179,77,0.3);border-radius:8px;padding:1rem;">
          <h4 style="color:#5EFF00;margin-bottom:0.5rem;">RPM Calibration Saved</h4>
          <p style="color:#ccc;font-size:0.9rem;">Ball RPM: <strong>${result.ballRPM.toFixed(1)}</strong></p>
          <p style="color:#ccc;font-size:0.9rem;">Decay (k): <strong>${result.kEstimate.toFixed(3)}</strong> — how fast the ball decelerates</p>
          <p style="color:#ccc;font-size:0.9rem;">Avg Interval: <strong>${result.avgIntervalMs.toFixed(1)}ms</strong> per revolution</p>
          <p style="color:#ccc;font-size:0.9rem;">Condition: <strong style="color:${result.condition === 'stable' ? '#5EFF00' : result.condition === 'caution' ? '#FFCC1A' : '#ff3300'}">${result.condition.toUpperCase()}</strong></p>
          <p style="color:#ccc;font-size:0.9rem;">Quality Tier: <strong>${fusion.qualityTier}/3</strong></p>
          <p style="color:#888;font-size:0.8rem;margin-top:0.5rem;">Data saved to this table's calibration history.</p>
        </div>
      `;

      document.getElementById('cal-status').textContent = 'DONE';
      document.getElementById('cal-land-section').style.display = 'none';

      // Run prediction
      const pred = predictor.predict(fusion);
      if (pred) tableUI.update();
      tableUI._saveState();
    });

    document.getElementById('cal-back-hub').addEventListener('click', () => {
      clearInterval(refreshInterval);
      overlay.remove();
      showCalibrationHub();
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => {
      clearInterval(refreshInterval);
      overlay.remove();
      tableUI._saveState();
    });
  }

  // ============================================================
  // POCKET-TO-POCKET TIMING — Landing pattern analysis
  // Redesigned: "In Pocket" button for timing, felt table for number selection
  // Numbers also feed into the series engine.
  // ============================================================
  function showPocketTimingOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';

    const session = new BTHG.PocketTimingSession();
    let ptState = 'idle'; // idle | recording | awaiting_number
    let pendingTimestamp = null;
    let wheelDirection = 'cw'; // cw | ccw

    // Build felt-layout table HTML (matches real roulette table layout)
    const rows = BTHG.TABLE_GRID.rows;
    let feltHTML = '<div class="pt-felt-wrapper"><div class="pt-felt" style="display:flex;gap:2px;">';
    // Zeros column (left side, like real table)
    feltHTML += '<div class="pt-zeros" style="display:flex;flex-direction:column;gap:2px;width:44px;min-width:44px;">';
    feltHTML += `<button class="pt-felt-btn pt-green" data-num="37" disabled style="flex:1;min-height:50px;">00</button>`;
    feltHTML += `<button class="pt-felt-btn pt-green" data-num="0" disabled style="flex:1;min-height:50px;">0</button>`;
    feltHTML += '</div>';
    // Number grid 3x12
    feltHTML += '<div class="pt-felt-grid" style="display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(3,1fr);gap:2px;flex:1;">';
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const num = rows[r][c];
        const color = BTHG.colorForNumber(num);
        const isHit = engine.getNumber(num).hits > 0;
        feltHTML += `<button class="pt-felt-btn pt-${color}${isHit ? ' pt-hit' : ''}" data-num="${num}" disabled>${num}</button>`;
      }
    }
    feltHTML += '</div></div></div>';

    overlay.innerHTML = `
      <div class="rt-overlay-content cal-overlay pocket-timing-overlay">
        <h2 style="color:#d4af37;"><i class="fas fa-stopwatch"></i> Pocket Timing + Series Tracking</h2>
        <p class="cal-instructions" id="pt-instructions">Press START, then hit <strong>IN POCKET</strong> the instant the ball settles. Then select the number from the table below. Numbers count toward your active series.</p>

        <!-- Live Stats -->
        <div class="cal-live-display">
          <div class="cal-stat">
            <span class="cal-stat-label">LANDINGS</span>
            <span class="cal-stat-value" id="pt-count">0</span>
          </div>
          <div class="cal-stat">
            <span class="cal-stat-label">LAST INTERVAL</span>
            <span class="cal-stat-value" id="pt-interval">--</span>
            <span class="cal-stat-detail" id="pt-interval-ms" style="font-size:0.6rem;color:#888;"></span>
          </div>
          <div class="cal-stat">
            <span class="cal-stat-label">LAST NUMBER</span>
            <span class="cal-stat-value" id="pt-last">--</span>
          </div>
          <div class="cal-stat">
            <span class="cal-stat-label">SERIES</span>
            <span class="cal-stat-value" id="pt-series-count">${engine.totalSpins}</span>
          </div>
        </div>

        <!-- Wheel Direction -->
        <div class="pt-direction-row" style="display:flex;gap:0.5rem;justify-content:center;margin-bottom:0.5rem;">
          <button class="pt-dir-btn pt-dir-active" id="pt-dir-cw" style="padding:0.3rem 0.8rem;font-size:0.75rem;border:1px solid var(--gold);background:rgba(212,175,55,0.15);color:var(--gold);border-radius:4px;cursor:pointer;">&#8635; CW</button>
          <button class="pt-dir-btn" id="pt-dir-ccw" style="padding:0.3rem 0.8rem;font-size:0.75rem;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#888;border-radius:4px;cursor:pointer;">&#8634; CCW</button>
        </div>

        <!-- Control Buttons -->
        <div class="cal-buttons" style="margin-bottom:0.5rem;">
          <button id="pt-start" class="btn-gold">START RECORDING</button>
          <button id="pt-in-pocket" class="btn-gold" disabled style="display:none;font-size:1.3rem;padding:1rem 2rem;background:#e74c3c;letter-spacing:0.05em;">&#11015; IN POCKET</button>
          <button id="pt-stop" class="btn-outline" disabled style="background:rgba(255,50,50,0.15);">STOP & SAVE</button>
        </div>

        <!-- Status Banner -->
        <div id="pt-status-banner" style="text-align:center;padding:0.4rem;font-size:0.8rem;font-weight:700;border-radius:4px;margin-bottom:0.5rem;display:none;"></div>

        <!-- Felt Table for Number Selection -->
        ${feltHTML}

        <!-- Landing History -->
        <div id="pt-history" class="pt-history"></div>

        <!-- Results (shown after stop) -->
        <div id="pt-results" style="display:none;margin-top:1rem;"></div>

        <div style="display:flex;gap:0.5rem;margin-top:1rem;">
          <button class="btn-outline" id="pt-back-hub" style="flex:1;"><i class="fas fa-arrow-left"></i> Back to Hub</button>
          <button class="rt-overlay-close" style="flex:1;">Close</button>
        </div>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    // Prevent background clicks from closing or propagating
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    });

    const statusBanner = document.getElementById('pt-status-banner');

    function showStatus(text, color) {
      statusBanner.textContent = text;
      statusBanner.style.display = 'block';
      statusBanner.style.background = color === 'green' ? 'rgba(94,255,0,0.15)' :
                                       color === 'red' ? 'rgba(231,76,60,0.2)' :
                                       'rgba(212,175,55,0.15)';
      statusBanner.style.color = color === 'green' ? '#5EFF00' :
                                  color === 'red' ? '#e74c3c' : '#d4af37';
    }

    function setTableEnabled(enabled) {
      overlay.querySelectorAll('.pt-felt-btn').forEach(btn => btn.disabled = !enabled);
    }

    function updateFeltHitState() {
      overlay.querySelectorAll('.pt-felt-btn[data-num]').forEach(btn => {
        const num = parseInt(btn.dataset.num);
        const rn = engine.getNumber(num);
        if (rn && rn.hits > 0) {
          btn.classList.add('pt-hit');
        } else {
          btn.classList.remove('pt-hit');
        }
      });
    }

    // Wheel direction toggle
    document.getElementById('pt-dir-cw').addEventListener('click', () => {
      wheelDirection = 'cw';
      document.getElementById('pt-dir-cw').style.background = 'rgba(212,175,55,0.15)';
      document.getElementById('pt-dir-cw').style.color = 'var(--gold)';
      document.getElementById('pt-dir-cw').style.borderColor = 'var(--gold)';
      document.getElementById('pt-dir-ccw').style.background = 'transparent';
      document.getElementById('pt-dir-ccw').style.color = '#888';
      document.getElementById('pt-dir-ccw').style.borderColor = 'rgba(255,255,255,0.2)';
    });
    document.getElementById('pt-dir-ccw').addEventListener('click', () => {
      wheelDirection = 'ccw';
      document.getElementById('pt-dir-ccw').style.background = 'rgba(212,175,55,0.15)';
      document.getElementById('pt-dir-ccw').style.color = 'var(--gold)';
      document.getElementById('pt-dir-ccw').style.borderColor = 'var(--gold)';
      document.getElementById('pt-dir-cw').style.background = 'transparent';
      document.getElementById('pt-dir-cw').style.color = '#888';
      document.getElementById('pt-dir-cw').style.borderColor = 'rgba(255,255,255,0.2)';
    });

    // START
    document.getElementById('pt-start').addEventListener('click', () => {
      session.start();
      ptState = 'recording';
      document.getElementById('pt-start').style.display = 'none';
      document.getElementById('pt-in-pocket').style.display = '';
      document.getElementById('pt-in-pocket').disabled = false;
      document.getElementById('pt-stop').disabled = false;
      showStatus('WAITING FOR BALL TO LAND — Hit IN POCKET when it settles', 'gold');
    });

    // IN POCKET — captures the timing, then enables table for number selection
    document.getElementById('pt-in-pocket').addEventListener('click', () => {
      if (ptState !== 'recording') return;
      pendingTimestamp = performance.now();
      ptState = 'awaiting_number';
      document.getElementById('pt-in-pocket').disabled = true;
      setTableEnabled(true);
      // Highlight the table wrapper to show it's active
      const wrapper = overlay.querySelector('.pt-felt-wrapper');
      if (wrapper) wrapper.classList.add('pt-table-active');
      showStatus('SELECT THE NUMBER where the ball landed', 'green');
    });

    // Number tap on felt table
    overlay.querySelectorAll('.pt-felt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (ptState !== 'awaiting_number' || pendingTimestamp === null) return;

        const num = parseInt(btn.dataset.num);

        // Record to pocket timing session (with the captured timestamp)
        const landing = session.recordLanding(num, pendingTimestamp);
        if (!landing) return;

        // ALSO record to the series engine — this is the key fix
        engine.recordSpin(num);

        // Persist spin
        BTHG.Storage.SpinDB.addSpin({
          number: num,
          timestamp: Date.now(),
          machineId: BTHG._currentMachineId || 'default',
        });

        // Flash the button
        btn.classList.add('pt-num-flash');
        setTimeout(() => btn.classList.remove('pt-num-flash'), 400);

        // Update stats display
        const status = session.getStatus();
        document.getElementById('pt-count').textContent = status.landingCount;
        document.getElementById('pt-last').textContent = BTHG.displayNumber(num);
        document.getElementById('pt-series-count').textContent = engine.totalSpins;

        if (landing.intervalMs !== null) {
          const sec = (landing.intervalMs / 1000).toFixed(1);
          document.getElementById('pt-interval').textContent = sec + 's';
          document.getElementById('pt-interval-ms').textContent = Math.round(landing.intervalMs) + 'ms';
        } else {
          document.getElementById('pt-interval').textContent = 'BASE';
          document.getElementById('pt-interval-ms').textContent = 'first tap';
        }

        // Update felt table hit state
        updateFeltHitState();

        // Highlight last-selected number
        overlay.querySelectorAll('.pt-felt-btn').forEach(b => b.classList.remove('pt-last-selected'));
        btn.classList.add('pt-last-selected');

        // Add to history strip
        const historyEl = document.getElementById('pt-history');
        const chip = document.createElement('span');
        chip.className = `rt-spin-chip rt-${BTHG.colorForNumber(num)}`;
        let chipText = BTHG.displayNumber(num);
        if (landing.intervalMs !== null) {
          chipText += ' (' + (landing.intervalMs / 1000).toFixed(1) + 's)';
        }
        chip.textContent = chipText;
        historyEl.appendChild(chip);
        historyEl.scrollLeft = historyEl.scrollWidth;

        // Reset state — wait for next IN POCKET
        pendingTimestamp = null;
        ptState = 'recording';
        setTableEnabled(false);
        const wrapperEl = overlay.querySelector('.pt-felt-wrapper');
        if (wrapperEl) wrapperEl.classList.remove('pt-table-active');
        document.getElementById('pt-in-pocket').disabled = false;
        showStatus('WAITING FOR BALL TO LAND — Hit IN POCKET when it settles', 'gold');
      });
    });

    // STOP & SAVE
    document.getElementById('pt-stop').addEventListener('click', () => {
      session.stop();
      ptState = 'idle';
      setTableEnabled(false);
      document.getElementById('pt-in-pocket').disabled = true;
      document.getElementById('pt-stop').disabled = true;
      statusBanner.style.display = 'none';

      const results = session.getResults();
      if (!results) {
        document.getElementById('pt-results').style.display = 'block';
        document.getElementById('pt-results').innerHTML = '<p style="color:#ff3333;">Not enough data. Need at least 2 landings.</p>';
        return;
      }

      // Integrate into fusion model
      fusion.integrateTimingData(results);

      // Save to CalibrationDB (include wheel direction)
      BTHG.Storage.CalibrationDB.saveCalibration({
        machineId: BTHG._currentMachineId || 'default',
        casino: BTHG._currentCasino || 'Unknown',
        type: 'pocket_timing',
        timestamp: Date.now(),
        data: {
          landings: results.landings,
          avgIntervalMs: results.avgIntervalMs,
          stdDevMs: results.stdDevMs,
          cv: results.cv,
          medianMs: results.medianMs,
          minMs: results.minMs,
          maxMs: results.maxMs,
          deltaDistribution: results.deltaDistribution,
          numberFreq: results.numberFreq,
          empiricalBias: results.empiricalBias,
          condition: results.condition,
          landingCount: results.landingCount,
          durationMs: results.durationMs,
          wheelDirection: wheelDirection,
        }
      });

      // Show results
      const rDiv = document.getElementById('pt-results');
      rDiv.style.display = 'block';

      const topNums = Object.entries(results.numberFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([n, c]) => `<span class="rt-spin-chip rt-${BTHG.colorForNumber(parseInt(n))}">${BTHG.displayNumber(parseInt(n))} (${c})</span>`)
        .join(' ');

      rDiv.innerHTML = `
        <div style="background:rgba(0,179,77,0.15);border:1px solid rgba(0,179,77,0.3);border-radius:8px;padding:1rem;">
          <h4 style="color:#5EFF00;margin-bottom:0.75rem;">Pocket Timing Saved — ${results.landingCount} Landings (Wheel: ${wheelDirection === 'cw' ? 'Clockwise' : 'Counter-CW'})</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;">
            <p style="color:#ccc;">Avg Interval: <strong>${(results.avgIntervalMs / 1000).toFixed(1)}s</strong> <span style="color:#888;">(${Math.round(results.avgIntervalMs)}ms)</span></p>
            <p style="color:#ccc;">Std Dev: <strong>${(results.stdDevMs / 1000).toFixed(2)}s</strong></p>
            <p style="color:#ccc;">Median: <strong>${(results.medianMs / 1000).toFixed(1)}s</strong></p>
            <p style="color:#ccc;">Range: <strong>${(results.minMs / 1000).toFixed(1)}s — ${(results.maxMs / 1000).toFixed(1)}s</strong></p>
            <p style="color:#ccc;">CV: <strong>${(results.cv * 100).toFixed(1)}%</strong></p>
            <p style="color:#ccc;">Consistency: <strong style="color:${results.condition === 'consistent' ? '#5EFF00' : results.condition === 'moderate' ? '#FFCC1A' : '#ff3300'}">${results.condition.toUpperCase()}</strong></p>
          </div>
          <div style="margin-top:0.75rem;">
            <p style="color:#aaa;font-size:0.8rem;margin-bottom:0.25rem;">Most Frequent Numbers:</p>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">${topNums}</div>
          </div>
          <p style="color:#888;font-size:0.75rem;margin-top:0.75rem;">All ${results.landingCount} numbers were also recorded to your active series. Scatter model updated.</p>
        </div>
      `;

      // Update main table UI and predictions
      const pred = predictor.predict(fusion);
      if (pred) tableUI.update();
      tableUI.update();
      tableUI._saveState();
    });

    document.getElementById('pt-back-hub').addEventListener('click', () => {
      if (session.isActive) session.stop();
      overlay.remove();
      tableUI.update();
      tableUI._saveState();
      showCalibrationHub();
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => {
      if (session.isActive) session.stop();
      overlay.remove();
      tableUI.update();
      tableUI._saveState();
    });
  }

  // ============================================================
  // SETTINGS PANEL
  // ============================================================
  function showSettingsPanel() {
    const settings = BTHG.Storage.Settings.load();
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';
    overlay.innerHTML = `
      <div class="rt-overlay-content settings-panel">
        <h2 style="color:#d4af37;">Settings</h2>
        <div class="settings-grid">
          <div class="settings-field">
            <label>Casino</label>
            <input type="text" id="set-casino" value="${BTHG._currentCasino || ''}">
          </div>
          <div class="settings-field">
            <label>Machine ID</label>
            <input type="text" id="set-machine" value="${BTHG._currentMachineId || ''}">
          </div>
          <div class="settings-field">
            <label>Base Bet ($)</label>
            <select id="set-bet">
              ${BTHG.BET_AMOUNTS.map(v => `<option value="${v}" ${v === (settings.baseBet || 5) ? 'selected' : ''}>${BTHG.formatMoney(v)}</option>`).join('')}
            </select>
          </div>
          <div class="settings-field">
            <label>Bankroll ($)</label>
            <input type="number" id="set-bankroll" value="${bankroll.totalBankroll}" min="0">
          </div>
          <div class="settings-field">
            <label>Payout Ratio</label>
            <select id="set-payout">
              <option value="35" ${settings.payoutRatio === 35 ? 'selected' : ''}>35:1</option>
              <option value="34" ${settings.payoutRatio === 34 ? 'selected' : ''}>34:1</option>
              <option value="36" ${settings.payoutRatio === 36 ? 'selected' : ''}>36:1</option>
            </select>
          </div>
          <div class="settings-field">
            <label>Final Target Count</label>
            <select id="set-final">
              ${[4,5,6,7,8].map(n => `<option value="${n}" ${engine.finalTargetCount === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="settings-field">
            <label>Auto-Add to Final</label>
            <select id="set-autoadd">
              <option value="true" ${engine.isAutoAddEnabled ? 'selected' : ''}>On</option>
              <option value="false" ${!engine.isAutoAddEnabled ? 'selected' : ''}>Off</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1.5rem;flex-wrap:wrap;">
          <button id="set-save" class="btn-gold">Save</button>
          <button id="set-export" class="btn-outline">Export Data</button>
          <button id="set-import" class="btn-outline">Import Data</button>
          <button id="set-reset" class="btn-outline" style="border-color:#ff3333;color:#ff3333;">Factory Reset</button>
        </div>
        ${BTHG.Storage.LS.get('is_admin', false) ? `
        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(212,175,55,0.2);">
          <button id="set-keygen" class="btn-outline" style="width:100%;border-color:var(--gold);color:var(--gold);"><i class="fas fa-key"></i> Generate Access Keys</button>
        </div>
        ` : ''}
        <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    document.getElementById('set-save').addEventListener('click', () => {
      const newSettings = {
        baseBet: parseFloat(document.getElementById('set-bet').value) || 5,
        bankroll: parseFloat(document.getElementById('set-bankroll').value) || 1000,
        payoutRatio: parseInt(document.getElementById('set-payout').value) || 35,
        finalTargetCount: parseInt(document.getElementById('set-final').value) || 8,
        autoAdd: document.getElementById('set-autoadd').value === 'true',
      };
      BTHG.Storage.Settings.save(newSettings);
      bankroll.baseBet = newSettings.baseBet;
      bankroll.totalBankroll = newSettings.bankroll;
      bankroll.sessionStartBankroll = newSettings.bankroll;
      bankroll.payoutRatio = newSettings.payoutRatio;
      engine.finalTargetCount = newSettings.finalTargetCount;
      engine.isAutoAddEnabled = newSettings.autoAdd;
      BTHG._currentCasino = document.getElementById('set-casino').value;
      BTHG._currentMachineId = document.getElementById('set-machine').value;
      tableUI.update();
      overlay.remove();
    });

    document.getElementById('set-export').addEventListener('click', async () => {
      const json = await BTHG.Storage.DataIO.exportSession(BTHG._currentMachineId || 'default');
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bthg-session-${Date.now()}.json`;
      a.click();
    });

    document.getElementById('set-import').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        await BTHG.Storage.DataIO.importSession(text);
        location.reload();
      };
      input.click();
    });

    document.getElementById('set-reset').addEventListener('click', () => {
      if (confirm('This will delete ALL data including calibrations, series history, and settings. Are you sure?')) {
        BTHG.Storage.Session.clear();
        BTHG.Storage.SpinDB.clearAll();
        BTHG.Storage.SeriesDB.clearAll();
        BTHG.Storage.CalibrationDB.clearAll();
        localStorage.clear();
        location.reload();
      }
    });

    // Admin key generator
    const keygenBtn = document.getElementById('set-keygen');
    if (keygenBtn) {
      keygenBtn.addEventListener('click', () => {
        overlay.remove();
        showKeyGenerator();
      });
    }

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // IN-APP KEY GENERATOR (admin only)
  // ============================================================
  function showKeyGenerator() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';
    overlay.innerHTML = `
      <div class="rt-overlay-content" style="text-align:left;">
        <h2 style="color:#d4af37;text-align:center;margin-bottom:1rem;"><i class="fas fa-key"></i> Key Generator</h2>

        <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1.5rem;">
          <div style="flex:1;min-width:140px;">
            <label style="display:block;color:#888;font-size:0.75rem;text-transform:uppercase;margin-bottom:0.3rem;">Duration</label>
            <select id="kg-duration" style="width:100%;padding:0.65rem;background:#1a1a1a;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:0.95rem;">
              <option value="1">1 Day</option>
              <option value="3">3 Days</option>
              <option value="7">7 Days</option>
              <option value="14">14 Days</option>
              <option value="30">30 Days</option>
            </select>
          </div>
          <button id="kg-generate" class="btn-gold" style="width:auto;padding:0.65rem 1.5rem;white-space:nowrap;">GENERATE</button>
        </div>

        <div id="kg-result" style="display:none;padding:1rem;background:rgba(0,179,77,0.08);border:1px solid rgba(0,179,77,0.25);border-radius:8px;margin-bottom:1rem;">
          <p style="color:#5EFF00;font-size:0.75rem;margin-bottom:0.4rem;font-weight:700;">NEW KEY:</p>
          <div id="kg-key-text" style="font-family:monospace;font-size:0.9rem;color:#fff;word-break:break-all;padding:0.6rem;background:rgba(0,0,0,0.5);border-radius:4px;margin-bottom:0.6rem;"></div>
          <button id="kg-copy" class="btn-outline" style="font-size:0.8rem;padding:0.4rem 1rem;">Copy to Clipboard</button>
        </div>

        <div id="kg-history" style="max-height:250px;overflow-y:auto;"></div>

        <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    function refreshHistory() {
      const container = document.getElementById('kg-history');
      const keys = BTHG.Storage.AdminKeys.getAll();
      if (keys.length === 0) {
        container.innerHTML = '<p style="color:#555;font-size:0.8rem;font-style:italic;">No keys generated yet.</p>';
        return;
      }
      container.innerHTML = keys.slice().reverse().map(k => {
        const created = new Date(k.created).toLocaleDateString();
        const isExpired = Date.now() > (k.created + k.days * 86400000);
        const isUsed = BTHG.Storage.Access.isKeyUsed(k.key);
        let status, sColor;
        if (isUsed) { status = 'USED'; sColor = '#888'; }
        else if (isExpired) { status = 'EXPIRED'; sColor = '#ff3333'; }
        else { status = 'ACTIVE'; sColor = '#5EFF00'; }
        return `
          <div style="padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;">
              <div style="font-family:monospace;font-size:0.7rem;color:#aaa;word-break:break-all;">${k.key}</div>
              <div style="font-size:0.6rem;color:#555;margin-top:2px;">${k.days}d — ${created}</div>
            </div>
            <span style="color:${sColor};font-weight:700;font-size:0.65rem;padding:2px 8px;border:1px solid ${sColor};border-radius:3px;">${status}</span>
          </div>
        `;
      }).join('');
    }

    refreshHistory();

    document.getElementById('kg-generate').addEventListener('click', async () => {
      const days = parseInt(document.getElementById('kg-duration').value);
      const btn = document.getElementById('kg-generate');
      btn.textContent = 'Generating...';
      btn.disabled = true;

      try {
        const key = await BTHG.Paywall.generateKey(days);
        BTHG.Storage.AdminKeys.add({ key, days, created: Date.now(), used: false });

        document.getElementById('kg-result').style.display = 'block';
        document.getElementById('kg-key-text').textContent = key;
        refreshHistory();
      } catch (e) {
        alert('Error: ' + e.message);
      }

      btn.textContent = 'GENERATE';
      btn.disabled = false;
    });

    document.getElementById('kg-copy').addEventListener('click', () => {
      const keyText = document.getElementById('kg-key-text').textContent;
      navigator.clipboard.writeText(keyText).then(() => {
        const btn = document.getElementById('kg-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
      });
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // DATA INSPECTOR
  // ============================================================
  function showDataInspector() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';

    // Build insights
    const sorted = [...engine.numbers].sort((a, b) => b.hits - a.hits);
    const hottest = sorted.slice(0, 5);
    const coldest = sorted.filter(n => n.hits > 0).sort((a, b) => b.ago - a.ago).slice(0, 5);

    const scatterTotal = Object.values(fusion.countOffset || {}).reduce((a, b) => a + b, 0);

    overlay.innerHTML = `
      <div class="rt-overlay-content data-inspector">
        <h2 style="color:#d4af37;">Data Inspector</h2>
        <div class="di-tabs">
          <button class="di-tab active" data-tab="insights">Insights</button>
          <button class="di-tab" data-tab="analysis">Analysis</button>
          <button class="di-tab" data-tab="series">Series</button>
          <button class="di-tab" data-tab="raw">Raw</button>
        </div>
        <div class="di-content" id="di-insights">
          <h3>Hot Numbers (Most Hits This Series)</h3>
          <div class="di-number-list">
            ${hottest.map(n => `<div class="di-num-row"><span class="rt-spin-chip rt-${BTHG.colorForNumber(n.value)}">${BTHG.displayNumber(n.value)}</span><span>${n.hits} hits</span></div>`).join('')}
          </div>
          <h3 style="margin-top:1rem;">Coldest (Longest Since Hit)</h3>
          <div class="di-number-list">
            ${coldest.map(n => `<div class="di-num-row"><span class="rt-spin-chip rt-${BTHG.colorForNumber(n.value)}">${BTHG.displayNumber(n.value)}</span><span>${n.ago} spins ago</span></div>`).join('')}
          </div>
          <h3 style="margin-top:1rem;">Side Bet Status</h3>
          <p style="color:#888;font-size:0.75rem;margin-bottom:0.5rem;">Shows spins since each section last hit. Higher numbers = colder. At 12+ a blue glow appears. At 16+ cop lights flash — prime for Crossroads betting.</p>
          <div class="di-sidebets">
            ${Object.entries(engine.sideBetAgo).map(([label, ago]) =>
              `<div class="di-sb-row"><span>${label}</span><span style="color:${ago >= 16 ? '#ff3333' : ago >= 12 ? '#008CFF' : '#aaa'}">${ago} ago</span><span>${engine.sideBetHits[label] || 0} hits</span></div>`
            ).join('')}
          </div>
        </div>
        <div class="di-content" id="di-analysis" style="display:none;">
          <h3>Session Statistics</h3>
          <p>Total Spins: ${engine.totalSpins}</p>
          <p>Series Completed: ${engine.seriesCount}</p>
          <p>Unique Numbers Hit: ${engine.numbers.filter(n => n.hits > 0).length} / 38</p>
          <p>Series Average: ${engine.seriesAverage > 0 ? engine.seriesAverage + ' spins' : 'No completed series yet'}</p>
          <p>Win Rate: ${bankroll.getWinRate()}%</p>
          <p>Session P&L: $${bankroll.getSessionPnL().toFixed(2)}</p>
          <p>Peak Bankroll: $${bankroll.peakBankroll.toFixed(2)}</p>
          <p>Total Wagered: $${bankroll.totalWagered.toFixed(2)}</p>
          ${fusion.referenceLocked ? `
          <h3 style="margin-top:1rem;">Calibration Data</h3>
          <p>Wheel Speed: ${BTHG.Physics.radSToRPM(fusion.omega_w).toFixed(1)} RPM</p>
          <p>Ball Speed: ${BTHG.Physics.radSToRPM(fusion.omega_b0).toFixed(1)} RPM</p>
          <p>Decay (k): ${fusion.kPerSec.toFixed(3)}</p>
          <p>Quality: Tier ${fusion.qualityTier}/3 — ${fusion.getWheelCondition()}</p>
          <p>Scatter Samples: ${scatterTotal}</p>
          <p>Empirical Bias Points: ${fusion.empiricalBias ? Object.keys(fusion.empiricalBias).length : 0}</p>
          <p>Sessions: ${fusion.calibrationCount}</p>
          ` : '<p style="color:#888;">Not calibrated yet — use the Calibrate button to measure ball speed or record landing patterns.</p>'}
        </div>
        <div class="di-content" id="di-series" style="display:none;">
          <h3>Completed Series History</h3>
          <p style="color:#888;font-size:0.8rem;margin-bottom:0.75rem;">Each table develops its own average cycle length. The more series you complete, the more accurate the average becomes.</p>
          <div id="di-series-list" style="max-height:300px;overflow-y:auto;">
            <p style="color:#666;font-style:italic;">Loading...</p>
          </div>
        </div>
        <div class="di-content" id="di-raw" style="display:none;">
          <h3>Spin History (This Series)</h3>
          <div class="di-raw-list" style="max-height:300px;overflow-y:auto;font-family:monospace;font-size:0.8rem;">
            ${engine.history.map((n, i) =>
              `<span class="rt-spin-chip rt-${BTHG.colorForNumber(n)}" style="display:inline-block;margin:2px;">${i+1}: ${BTHG.displayNumber(n)}</span>`
            ).join('')}
          </div>
        </div>
        <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);

    // Load series history from IndexedDB
    BTHG.Storage.SeriesDB.getSeriesByMachine(BTHG._currentMachineId || 'default').then(seriesList => {
      const container = document.getElementById('di-series-list');
      if (!seriesList || seriesList.length === 0) {
        container.innerHTML = '<p style="color:#666;font-style:italic;">No completed series yet. Complete a full cycle (all 38 numbers hit) or use End Series to save partial series.</p>';
        return;
      }
      container.innerHTML = seriesList.map((s, i) => {
        const date = new Date(s.timestamp).toLocaleString();
        return `
          <div style="padding:0.75rem;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="color:#d4af37;">Series #${s.seriesNumber || (i + 1)}</strong>
              <span style="color:${s.endType === 'auto' ? '#5EFF00' : '#FFCC1A'};font-size:0.75rem;font-weight:700;">${s.endType === 'auto' ? 'COMPLETE' : 'MANUAL'}</span>
            </div>
            <p style="color:#aaa;font-size:0.8rem;">${s.totalSpins} spins | ${s.uniqueHit || 38}/38 hit</p>
            <p style="color:#666;font-size:0.75rem;">${date}</p>
          </div>
        `;
      }).join('');
    });

    // Tab switching
    overlay.querySelectorAll('.di-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        overlay.querySelectorAll('.di-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        overlay.querySelectorAll('.di-content').forEach(c => c.style.display = 'none');
        document.getElementById(`di-${tab.dataset.tab}`).style.display = 'block';
      });
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // BANKROLL PANEL
  // ============================================================
  function showBankrollPanel() {
    const state = bankroll.getState();
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';
    overlay.innerHTML = `
      <div class="rt-overlay-content bankroll-panel">
        <h2 style="color:#d4af37;"><i class="fas fa-dollar-sign"></i> Bankroll & Trinity</h2>
        <p style="color:#888;font-size:0.8rem;margin-bottom:1rem;">Trinity is a controlled doubling progression. Bet stays at 1x for the first 3 misses, then doubles: 2x (3-4 misses), 4x (5-6), 8x (7+). Resets on any hit.</p>
        <div class="br-stats">
          <div class="br-stat"><span class="br-label">Bankroll</span><span class="br-value" style="color:#5EFF00;">${BTHG.formatMoney(state.bankroll)}</span></div>
          <div class="br-stat"><span class="br-label">Session P&L</span><span class="br-value" style="color:${state.sessionPnL >= 0 ? '#5EFF00' : '#ff3333'};">${state.sessionPnL >= 0 ? '+' : '-'}${BTHG.formatMoney(Math.abs(state.sessionPnL))}</span></div>
          <div class="br-stat"><span class="br-label">Multiplier</span><span class="br-value" style="color:#d4af37;">${state.multiplier}x</span></div>
          <div class="br-stat"><span class="br-label">Bet/Number</span><span class="br-value">${BTHG.formatMoney(state.betPerNumber)}</span></div>
          <div class="br-stat"><span class="br-label">Win Rate</span><span class="br-value">${state.winRate}%</span></div>
          <div class="br-stat"><span class="br-label">Wins/Losses</span><span class="br-value">${state.winCount}/${state.lossCount}</span></div>
          <div class="br-stat"><span class="br-label">Miss Streak</span><span class="br-value">${state.missStreak}</span></div>
          <div class="br-stat"><span class="br-label">Total Wagered</span><span class="br-value">$${state.totalWagered.toFixed(2)}</span></div>
        </div>

        <div class="br-chips" style="margin-top:1rem;">
          <h4 style="color:#aaa;font-size:0.85rem;margin-bottom:0.5rem;">Chip Stack</h4>
          <div class="chip-stack">
            ${BTHG.renderChips(state.bankroll).slice(0, 20).map(c =>
              `<div class="chip" style="background:${c.color};color:${c.color === '#ffffff' ? '#000' : '#fff'};border:2px solid ${c.color === '#000000' ? '#d4af37' : c.color};">$${c.label}</div>`
            ).join('')}
            ${state.bankroll > 2000 ? '<span style="color:#888;">...</span>' : ''}
          </div>
        </div>
        <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
      </div>
    `;

    document.getElementById('app-root').appendChild(overlay);
    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ---- Boot ---------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('Bootstrap failed:', err);
      if (typeof BTHG.Paywall.showGateScreen === 'function') {
        BTHG.Paywall.showGateScreen();
      }
    });
  });

  BTHG.App = { init, showSessionSetup };
  window.BTHG = BTHG;
})();
