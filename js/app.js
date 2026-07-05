// ============================================================
// app.js — App entry, navigation, session setup, overlays
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// v3: Calibration hub, pocket timing (IN POCKET + felt table),
//   data persistence, settings (parseFloat bets, bet dropdown),
//   bankroll panel, data inspector, key generator,
//   pocket timing feeds into series engine, wheel direction toggle
// Contains: init, showSessionSetup, startSession,
//   loadPreviousTable, launchTable, showCalibrationHub,
//   showRPMCalibration, showPocketTimingOverlay, showSettingsPanel,
//   showBankrollPanel, showDataInspector, showWheelVerifierOverlay
// ============================================================

(function() {
  const BTHG = window.BTHG;

  // trinityEngine: the REAL computed Trinity engine (js/trinity.js), wired
  // into live play by Task 23 (this replaces the deprecated series-engine
  // ladder multiplier everywhere — see js/roulette-table.js). Kept in sync
  // with the active machine profile's table limits AND the bankroll panel's
  // denomination (rule 1) via syncTrinityEngineFromProfile below.
  let engine, bankroll, fusion, predictor, tableUI, trinityEngine;

  // Keep the module-level TrinityEngine (and tableUI's reference to it) in
  // sync with the active machine profile's table limits and the current
  // denomination (bankroll.baseBet — Task 23 rule 1: the chip value bet per
  // number, reusing the existing "base bet" field, validated to [table min,
  // table max] by the Apply handler). trinityEngine's `minUnit` is the
  // DENOMINATION (the escalation quantum/floor, so "denomination x Trinity
  // multiplier" in rule 2 is exactly perNumber/denomination), not the table
  // minimum — `maxUnit` is the table's real maximum (the cap rule 9 alerts
  // against).
  //
  // This function is called on every Bankroll panel OPEN (just to read the
  // active profile for display), not only when Apply is clicked — so it
  // must be idempotent when nothing has actually changed. A LIVE cycle's
  // escalation state (spent/level) is real, uncommitted money math now
  // (Task 23), so silently rebuilding a fresh engine every time the panel
  // is merely opened to check stats would wipe an in-progress cycle back to
  // the base denomination with no win having happened. A fresh instance
  // (and the cycle reset that comes with it) is only created when the
  // denomination or the table maximum has genuinely changed since the
  // current instance was built, or none exists yet — that IS a deliberate
  // reset point (changing your chip denomination or the table max
  // mid-session starts a fresh cycle). The live "how deep is this cycle
  // right now" numbers shown in the Bankroll panel come from replaying the
  // in-progress SeriesEngine's own history via BTHG.Bankroll.
  // replaySeriesCycle, not from mutating this instance spin by spin — that
  // replay path is untouched by Task 23. Returns the active profile, or
  // null if none exists / it has no limits set yet.
  function syncTrinityEngineFromProfile() {
    const profile = BTHG.MachineProfiles.getActive();
    if (profile && profile.minUnit != null && profile.maxUnit != null && bankroll && bankroll.baseBet > 0) {
      // Important 4 fix: clamp the denomination into the table's real
      // limits here too, not only in the Bankroll panel's Apply handler —
      // this function also runs on every panel OPEN (see the comment
      // above), so a denomination left stale from before the table limits
      // existed/changed (e.g. set via the older Settings panel, which
      // writes bankroll.baseBet directly with no bounds check at all) gets
      // corrected the next time anything resyncs, not only at Apply.
      if (bankroll.baseBet < profile.minUnit) bankroll.baseBet = profile.minUnit;
      if (bankroll.baseBet > profile.maxUnit) bankroll.baseBet = profile.maxUnit;
      const denom = bankroll.baseBet;

      const hadEngine = !!trinityEngine;
      if (!trinityEngine || trinityEngine.minUnit !== denom || trinityEngine.maxUnit !== profile.maxUnit) {
        trinityEngine = new BTHG.TrinityEngine({ minUnit: denom, maxUnit: profile.maxUnit, tableMinUnit: profile.minUnit });
        // Critical 2 fix: this rebuild branch fires whenever the
        // denomination or table maximum actually changed (a genuine
        // mid-cycle settings change, not just the panel being opened to
        // check stats — see this function's header comment). Resetting
        // _trinityCycleNet (and announcing it, unless this is the very
        // first engine of the session) alongside the fresh TrinityEngine is
        // RouletteTableUI's own concern — see _onTrinitySettingsChanged.
        if (typeof tableUI !== 'undefined' && tableUI) tableUI._onTrinitySettingsChanged(hadEngine);
      }
      if (typeof tableUI !== 'undefined' && tableUI) tableUI.trinityEngine = trinityEngine;
      return profile;
    }
    trinityEngine = null;
    if (typeof tableUI !== 'undefined' && tableUI) tableUI.trinityEngine = null;
    return profile || null;
  }

  async function init() {
    // ACCESS IS OPEN — Stripe is disconnected, so there is NO paywall gate and
    // no access-expiry timer. The app loads straight into setup. All session
    // data persists locally on the device (IndexedDB + localStorage).
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin')) {
      const adminHandled = await BTHG.AdminKeygen.initAdminPanel();
      if (adminHandled) return;
    }

    // Continue-from-previous-session removed: consecutive spin tracking only
    // works start-to-finish — a gap in the middle ruins the read — so we always
    // begin a fresh session. Past spins + series records stay in IndexedDB and
    // are used only as historical data for calibration.
    showSessionSetup();
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

  async function loadPreviousTable(casino, machineId) {
    // Continue-from-previous-session removed — never resume a live session.
    // The table's saved spins + series records still load below, used only as
    // historical data for calibration.
    BTHG._currentCasino = casino;
    BTHG._currentMachineId = machineId;

    const settings = BTHG.Storage.Settings.load();

    engine = new BTHG.SeriesEngine();
    engine.finalTargetCount = settings.finalTargetCount || 8;
    engine.isAutoAddEnabled = settings.autoAdd !== false;

    bankroll = new BTHG.BankrollManager(settings.bankroll, settings.baseBet, settings.payoutRatio);
    // Task 23: force a fresh Trinity cycle for this table/session — a new
    // table is a genuinely different wheel/context even if its denomination
    // and table maximum happen to numerically match a previous one, so
    // syncTrinityEngineFromProfile's idempotent reuse check (below) must
    // not carry a stale cycle over. launchTable() resyncs a real instance
    // right after this.
    trinityEngine = null;
    fusion = new BTHG.CalibratorDataFusion();
    predictor = new BTHG.PredictionEngine();

    // Load calibrations
    await loadCalibrations(machineId);

    // A completed-but-not-yet-archived series freezes the board and survives
    // reload as a snapshot in localStorage (see RouletteTableUI.
    // showSeriesCompleteBanner / _persistFrozenSnapshot). If one exists for
    // this machine, restore it directly instead of replaying spins — the
    // snapshot already contains the completed series' full final state, and
    // that series has NOT been written to SpinDB/SeriesDB yet (only New
    // Series does that).
    let frozenSnapshot = null;
    try {
      const fs = BTHG.Storage.LS.get('frozen_series', null);
      if (fs && fs.machineId === machineId && fs.engineState) frozenSnapshot = fs;
    } catch (e) {
      console.warn('Failed to read frozen series snapshot:', e);
    }

    try {
      if (frozenSnapshot) {
        engine.fromJSON(frozenSnapshot.engineState);
      } else {
        // Replay only the CURRENT (unfinished) series' spins. SpinDB keeps
        // every spin ever recorded for the machine forever (nothing is
        // deleted — a future tape view needs the full history across every
        // series), but every time a series is archived (New Series / Save &
        // Start New Series) or discarded, its spins get stamped with a
        // seriesMarker (see archiveAndReset and the Discard handler in
        // roulette-table.js). Spins with no seriesMarker are, by
        // definition, still part of the in-progress series — replaying only
        // those is what closes the "67 stale spins from a finished series
        // replayed into the next one" field bug, without losing any history.
        const allSpins = await BTHG.Storage.SpinDB.getSpinsByMachine(machineId);
        const liveSpins = allSpins.filter(s => s.seriesMarker == null);
        if (liveSpins.length > 0) {
          liveSpins.sort((a, b) => a.timestamp - b.timestamp);
          for (const spin of liveSpins) {
            engine.recordSpin(spin.number);
          }
        }

        // Load series history to set the series average. Only real
        // completions ('auto' / 'manual') count — "Save & Keep Counting"
        // snapshots are not finished series and must not be mixed in, or
        // the average and series count both come out wrong.
        const seriesRecords = await BTHG.Storage.SeriesDB.getSeriesByMachine(machineId);
        const completed = seriesRecords.filter(s => s.endType === 'auto' || s.endType === 'manual');
        if (completed.length > 0) {
          engine.seriesHistory = completed.map(s => s.totalSpins);
          engine.seriesCount = completed.length;
          engine.seriesAverage = Math.round(
            engine.seriesHistory.reduce((a, b) => a + b, 0) / engine.seriesHistory.length
          );
        }

        // Resync lifetimeSpins from the archived history plus whatever spins
        // are live now, rather than trusting the incremental counter across
        // a full engine rebuild.
        engine.lifetimeSpins = engine.seriesHistory.reduce((a, b) => a + b, 0) + engine.totalSpins;
      }
    } catch (e) {
      console.warn('Failed to load table history:', e);
    }

    launchTable();

    // Critical 1 fix: engine.history may already hold spins at this point
    // (either replayed directly via engine.recordSpin() in the loop above,
    // or restored via engine.fromJSON(frozenSnapshot.engineState)) — both
    // paths bypass _onNumberTap/_pushMoneySnapshot entirely, and tableUI
    // did not even exist yet while they ran, so it cannot have been called
    // then. _moneyHistory must stay index-aligned with engine.history (see
    // roulette-table.js's field comment) or undo desyncs money state.
    // None of these spins moved any money (bankroll/trinityEngine are
    // freshly built above from Settings, untouched since), so backfilling
    // with the CURRENT (unchanged) money snapshot once per untracked spin
    // is exactly equivalent to having pushed one before each — undoing any
    // of them correctly restores that same, still-current state.
    while (tableUI._moneyHistory.length < engine.history.length) {
      tableUI._pushMoneySnapshot();
    }

    // Re-show the freeze banner on top of the restored board.
    if (frozenSnapshot) {
      tableUI.showSeriesCompleteBanner(frozenSnapshot.endType || 'auto');
    }
  }

  function startSession(casino, machineId) {
    BTHG._currentCasino = casino;
    BTHG._currentMachineId = machineId;

    const settings = BTHG.Storage.Settings.load();

    engine = new BTHG.SeriesEngine();
    engine.finalTargetCount = settings.finalTargetCount || 8;
    engine.isAutoAddEnabled = settings.autoAdd !== false;

    bankroll = new BTHG.BankrollManager(settings.bankroll, settings.baseBet, settings.payoutRatio);
    // Task 23: force a fresh Trinity cycle for this table/session — a new
    // table is a genuinely different wheel/context even if its denomination
    // and table maximum happen to numerically match a previous one, so
    // syncTrinityEngineFromProfile's idempotent reuse check (below) must
    // not carry a stale cycle over. launchTable() resyncs a real instance
    // right after this.
    trinityEngine = null;
    fusion = new BTHG.CalibratorDataFusion();
    predictor = new BTHG.PredictionEngine();

    // Load any saved calibrations for this machine
    loadCalibrations(machineId);

    launchTable();
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

    // Task 23: resync trinityEngine (table limits + current denomination)
    // before constructing the table so live betting has a real engine from
    // the first spin if the profile/denomination are already configured.
    syncTrinityEngineFromProfile();

    tableUI = new BTHG.RouletteTableUI(root, engine, bankroll, fusion, predictor, trinityEngine);
    tableUI.render();

    // Handle table actions
    tableUI.onAction((action) => {
      if (action === 'openCalibration') showCalibrationHub();
      if (action === 'openSettings') showSettingsPanel();
      if (action === 'openDataInspector') showDataInspector();
      if (action === 'openBankroll') showBankrollPanel();
      if (action === 'openSector') showSectorPanel();
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

        // Critical 1 fix: this is a direct engine.recordSpin() call that
        // bypasses _onNumberTap entirely, so it must push a money snapshot
        // first too, or undo desyncs (_moneyHistory falls one entry short
        // of engine.history, and _restoreMoneySnapshot(undefined) silently
        // no-ops while the board rolls back). These spins move no money
        // (Pocket Timing never touches bettingEnabled/_applyLiveBetting),
        // so the snapshot just captures the CURRENT (unchanged) money
        // state — undoing this spin correctly restores that same state.
        if (tableUI) tableUI._pushMoneySnapshot();

        // ALSO record to the series engine — this is the key fix
        engine.recordSpin(num);

        // Persist spin — but only while the series is actually live.
        // engine.recordSpin() above is already a no-op while frozen (series
        // complete, awaiting New Series/Discard), but this SpinDB write
        // was NOT gated the same way: it would persist an unmarked spin
        // straight to storage while frozen, and since archiveAndReset's
        // markArchived only stamps spins that exist at the moment "New
        // Series" is pressed, that unmarked spin would get swept into
        // whichever series comes next on a later reload. Match the engine's
        // own guard here.
        if (!engine.frozen) {
          BTHG.Storage.SpinDB.addSpin({
            number: num,
            timestamp: Date.now(),
            machineId: BTHG._currentMachineId || 'default',
          });
        }

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
  // SECTOR LOGGER PANEL (physical-sector prediction)
  // ============================================================
  function showSectorPanel() {
    const machineId = BTHG._currentMachineId || 'default';
    const layout = (BTHG.MachineProfiles.getActive() || {}).wheelLayout || null;
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';

    const d = BTHG.SectorLogger.disp;

    // Update ONLY the prediction output (called on every keystroke of the
    // predict field, so the field never loses focus to a full re-render).
    function updatePrediction() {
      const out = overlay.querySelector('#sec-predict-out');
      const inp = overlay.querySelector('#sec-predict-ref');
      if (!out || !inp) return;
      const r = BTHG.SectorLogger.analyze(BTHG.SectorLogger.load(machineId), layout);
      const refVal = inp.value;
      const ref = BTHG.parseNumber(refVal);
      if (refVal === '' || ref == null) { out.textContent = ''; out.className = 'sec-predict-out'; return; }
      const p = r.predict(ref);
      if (p) {
        out.className = 'sec-predict-out';
        out.innerHTML = `Bet the arc around <strong>${d(p.center)}</strong> (from ${d(p.lo)} to ${d(p.hi)}: ${p.arc.map(d).join(' ')})`;
      } else if (r.count < BTHG.SectorLogger.MIN_SPINS) {
        out.className = 'sec-predict-out sec-muted';
        out.textContent = `Need ${BTHG.SectorLogger.MIN_SPINS} spins before a call (have ${r.count}).`;
      } else {
        out.className = 'sec-predict-out sec-muted';
        out.textContent = 'Spread too wide to call a sector on this data yet.';
      }
    }

    function render() {
      const obs = BTHG.SectorLogger.load(machineId);
      const r = BTHG.SectorLogger.analyze(obs, layout);

      const refVal = overlay.querySelector('#sec-predict-ref')
        ? overlay.querySelector('#sec-predict-ref').value : '';

      let statLine;
      if (r.count === 0) {
        statLine = 'No spins logged yet. Log the reference number at launch and the winner for each spin.';
      } else {
        const center = r.meanOffset != null ? r.meanOffset.toFixed(1) : '--';
        const spread = (r.scatterPockets != null && isFinite(r.scatterPockets)) ? r.scatterPockets.toFixed(1) : '--';
        statLine = `${r.count} spins logged. Offset center ${center} pockets, spread ${spread}. Signal: ${r.confidence.label}.`;
      }

      const rows = obs.slice(-8).reverse().map((o, i) =>
        `<div class="sec-row">#${obs.length - i}: ref ${d(o.refNum)} to win ${d(o.winNum)} (offset ${BTHG.SectorLogger.offsetOf(o.refNum, o.winNum, layout)})</div>`
      ).join('');

      overlay.innerHTML = `
        <div class="rt-overlay-content sector-panel">
          <h2 style="color:#d4af37;">Sector Predictor</h2>
          <p class="sec-help">At launch, read the number at your reference diamond and log it with the winner. After a handful of spins this learns the fixed offset and calls the landing arc.</p>

          <div class="sec-log-row">
            <div class="settings-field"><label>Ref number at launch</label><input type="text" id="sec-ref" inputmode="numeric" placeholder="e.g. 33"></div>
            <div class="settings-field"><label>Winning number</label><input type="text" id="sec-win" inputmode="numeric" placeholder="e.g. 22"></div>
            <button id="sec-log" class="btn-gold" style="align-self:flex-end;">Log Spin</button>
          </div>

          <div class="sec-stat">${statLine}</div>

          <div class="sec-log-row">
            <div class="settings-field"><label>Predict: ref number now</label><input type="text" id="sec-predict-ref" inputmode="numeric" value="${refVal}" placeholder="type the launch ref"></div>
          </div>
          <div id="sec-predict-out" class="sec-predict-out"></div>

          <div class="sec-history">${rows}</div>
          <div style="display:flex;gap:1rem;margin-top:1rem;flex-wrap:wrap;">
            <button id="sec-undo" class="btn-outline">Undo Last</button>
            <button id="sec-clear" class="btn-outline" style="border-color:#ff3333;color:#ff3333;">Clear All</button>
          </div>
          <button class="rt-overlay-close" style="margin-top:1rem;">Close</button>
        </div>`;

      overlay.querySelector('#sec-log').addEventListener('click', () => {
        const ref = BTHG.parseNumber(overlay.querySelector('#sec-ref').value);
        const win = BTHG.parseNumber(overlay.querySelector('#sec-win').value);
        if (ref == null || win == null) { alert('Enter both numbers (0-36 or 00).'); return; }
        BTHG.SectorLogger.logSpin(machineId, ref, win);
        render();
      });
      overlay.querySelector('#sec-undo').addEventListener('click', () => { BTHG.SectorLogger.removeLast(machineId); render(); });
      overlay.querySelector('#sec-clear').addEventListener('click', () => {
        if (confirm('Clear all logged sector spins for this machine? Your tracked numbers are not affected.')) { BTHG.SectorLogger.clear(machineId); render(); }
      });
      overlay.querySelector('#sec-predict-ref').addEventListener('input', () => updatePrediction());
      overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
      updatePrediction();
    }

    document.getElementById('app-root').appendChild(overlay);
    render();
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
            <label>Payout Ratio (display only, live play pays 35 to 1 plus stake)</label>
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
        <div class="settings-legend">
          <h3 style="color:#d4af37;margin:1.25rem 0 0.5rem;font-size:0.95rem;">Top Bar Buttons</h3>
          <p><i class="fas fa-bolt" style="color:#5EFF00;"></i> <strong>Real Time (LIVE / HIST)</strong> tap to switch. LIVE means each number you tap is a real ball drop, timed for the cadence engine. HIST means you are entering old numbers, so their timing is ignored. Leave it on LIVE at the wheel; switch to HIST when back-filling history.</p>
          <p><i class="fas fa-list" style="color:#d4af37;"></i> <strong>Hide Feed</strong> collapses the insight panel so the table fills the screen. The SIGNAL chip up top still shows the call.</p>
          <p><i class="fas fa-palette" style="color:#d4af37;"></i> <strong>Theme</strong> cycles the color themes.</p>
          <p><i class="fas fa-stopwatch" style="color:#d4af37;"></i> <strong>Reset Timing</strong> (in the Physics panel) clears the learned cadence without deleting any of your numbers. Use it if back-fill got tapped while Real Time was on LIVE.</p>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1.5rem;flex-wrap:wrap;">
          <button id="set-save" class="btn-gold">Save</button>
          <button id="set-export" class="btn-outline">Export Data</button>
          <button id="set-import" class="btn-outline">Import Data</button>
          <button id="set-reset" class="btn-outline" style="border-color:#ff3333;color:#ff3333;">Factory Reset</button>
        </div>
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
    const activeProfile = syncTrinityEngineFromProfile();
    const minUnitVal = activeProfile && activeProfile.minUnit != null ? activeProfile.minUnit : '';
    const maxUnitVal = activeProfile && activeProfile.maxUnit != null ? activeProfile.maxUnit : '';

    // Task 23: bankroll.getState()'s multiplier/betPerNumber/missStreak
    // reflect the DEPRECATED ladder (bankroll.recordSpin/TrinityCycle,
    // no longer called from live play) — showing those here next to real
    // money numbers would be actively misleading. Source the real Trinity
    // engine instead (same projection tableUI uses via
    // _currentBetPerNumber/_currentTrinityMultiplier — pure, does not
    // mutate trinityEngine's spent/level).
    let realBetPerNumber = bankroll.baseBet;
    let realMultiplier = 1;
    let realLevel = 0;
    if (trinityEngine) {
      trinityEngine.setCoverage(engine.getEscalationNumbers().length);
      realBetPerNumber = trinityEngine.nextBet().perNumber;
      const denom = bankroll.baseBet || trinityEngine.minUnit || 1;
      realMultiplier = Math.round((realBetPerNumber / denom) * 100) / 100;
      realLevel = trinityEngine.level;
    }
    const overlay = document.createElement('div');
    overlay.className = 'rt-overlay rt-overlay-visible';
    overlay.innerHTML = `
      <div class="rt-overlay-content bankroll-panel">
        <h2 style="color:#d4af37;"><i class="fas fa-dollar-sign"></i> Bankroll & Trinity</h2>
        <p style="color:#888;font-size:0.8rem;margin-bottom:1rem;">Trinity computes exactly how much to bet on your denomination so a win covers everything lost this cycle plus a bit more. It resets when a win brings the cycle back to even or better. 0 and 00 always reset it on a hit.</p>
        <div class="br-config" style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.6rem;align-items:end;margin-bottom:0.6rem;">
          <label style="display:flex;flex-direction:column;gap:0.3rem;color:#aaa;font-size:0.72rem;letter-spacing:0.05em;">BANKROLL ($)
            <input type="number" id="br-set-bankroll" value="${bankroll.totalBankroll}" min="0" step="1" inputmode="decimal" style="padding:0.55rem;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:1rem;width:100%;">
          </label>
          <label style="display:flex;flex-direction:column;gap:0.3rem;color:#aaa;font-size:0.72rem;letter-spacing:0.05em;">DENOMINATION ($)
            <input type="number" id="br-set-bet" value="${bankroll.baseBet}" min="0.25" step="0.25" inputmode="decimal" style="padding:0.55rem;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:1rem;width:100%;">
          </label>
          <button id="br-apply" class="btn-gold" style="padding:0.6rem 1.1rem;white-space:nowrap;">Apply</button>
        </div>
        <div class="br-limits">
          <label class="br-limit-label">Table minimum betting unit
            <input type="number" id="br-min-unit" value="${minUnitVal}" min="0.25" max="1500" step="0.25" inputmode="decimal" placeholder="e.g. 5">
          </label>
          <label class="br-limit-label">Table maximum betting unit
            <input type="number" id="br-max-unit" value="${maxUnitVal}" min="0.25" max="1500" step="0.25" inputmode="decimal" placeholder="e.g. 500">
          </label>
        </div>
        <div id="br-limits-msg" class="br-limits-msg"></div>
        <div class="wv-launcher" style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
          <button type="button" id="wv-open-btn" class="btn-outline"><i class="fas fa-compass"></i> Verify Wheel</button>
          <span class="wv-status${activeProfile && activeProfile.verifiedLayout ? ' wv-status-verified' : ''}" id="wv-status-line">
            ${activeProfile && activeProfile.verifiedLayout
              ? 'Wheel layout verified for this table.'
              : 'Wheel layout not verified. Using standard American order until verified.'}
          </span>
        </div>
        <div class="br-stats">
          <div class="br-stat"><span class="br-label">Bankroll</span><span class="br-value" style="color:#5EFF00;">${BTHG.formatMoney(state.bankroll)}</span></div>
          <div class="br-stat"><span class="br-label">Wins Bucket</span><span class="br-value" style="color:#d4af37;">${BTHG.formatMoney(bankroll.winsBucket || 0)}</span></div>
          <div class="br-stat"><span class="br-label">Session P&L</span><span class="br-value" style="color:${state.sessionPnL >= 0 ? '#5EFF00' : '#ff3333'};">${state.sessionPnL >= 0 ? '+' : '-'}${BTHG.formatMoney(Math.abs(state.sessionPnL))}</span></div>
          <div class="br-stat"><span class="br-label">Multiplier</span><span class="br-value" style="color:#d4af37;">${realMultiplier}x</span></div>
          <div class="br-stat"><span class="br-label">Bet/Number</span><span class="br-value">${BTHG.formatMoney(realBetPerNumber)}</span></div>
          <div class="br-stat"><span class="br-label">Win Rate</span><span class="br-value">${state.winRate}%</span></div>
          <div class="br-stat"><span class="br-label">Wins/Losses</span><span class="br-value">${state.winCount}/${state.lossCount}</span></div>
          <div class="br-stat"><span class="br-label">Trinity Level</span><span class="br-value">${realLevel}</span></div>
          <div class="br-stat"><span class="br-label">Total Wagered</span><span class="br-value">$${state.totalWagered.toFixed(2)}</span></div>
        </div>

        <div class="br-projection" id="br-projection">
          <h4 class="br-projection-title">Recommended Start &amp; Betting Path</h4>
          <p class="br-projection-line" id="br-projection-reco">Loading recommendation...</p>
          <p class="br-projection-line" id="br-projection-floor"></p>
          <p class="br-projection-line" id="br-projection-path"></p>
          <p class="br-projection-line" id="br-projection-live"></p>
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

    // Recommended start + betting path projection (Task 9). Needs the
    // archived series list, which is IndexedDB/async, so it fills in
    // after the panel is already on screen — same pattern as the Data
    // Inspector's Series tab (#di-series-list) just above.
    fillProjection();

    function fillProjection() {
      const machineId = BTHG._currentMachineId || 'default';
      BTHG.Storage.SeriesDB.getSeriesByMachine(machineId).then(archive => {
        if (!overlay.isConnected) return; // panel was closed before this resolved
        const profile = BTHG.MachineProfiles.getActive();
        const minUnit = profile && profile.minUnit != null ? profile.minUnit : null;
        const reco = BTHG.Bankroll.recommendStart({ minUnit, archive });

        let live = { active: !!(engine && engine.finalActivated) };
        if (live.active && minUnit) {
          // Same closerOffsets derivation _buildArchiveRecord uses in
          // roulette-table.js (spinAt - entrySpin per number's first hit
          // while in Final 8), computed here from the live engine's own
          // finalEightFirstHitSpins so the live projection is bounded by
          // real closer resets too, not a single stale coverage snapshot.
          const liveCloserOffsets = Object.values(engine.finalEightFirstHitSpins || {})
            .map(spinAt => spinAt - engine.entrySpin);
          const cyc = BTHG.Bankroll.replaySeriesCycle({
            spinHistory: engine.history, entrySpin: engine.entrySpin, finalEight: engine.finalEight,
            closerOffsets: liveCloserOffsets, minUnit, denomination: bankroll.baseBet,
          });
          if (cyc) {
            live.currentLevel = cyc.currentLevel;
            live.currentSpent = cyc.currentSpent;
            live.worstDepth = reco.worstDepth;
            live.worstSpend = reco.worstSpend;
            // Important 3: the live "right now" numbers above are priced at
            // the denomination actually being bet (when set), which can
            // differ from worstDepth/worstSpend above (the archived-history
            // recommendation, deliberately anchored to the table minimum as
            // a stable worst-case baseline regardless of the current
            // denomination) — say so explicitly rather than let the two
            // silently disagree.
            live.pricedAt = cyc.pricedAt;
            live.pricedWithDenomination = cyc.pricedWithDenomination;
          } else {
            live.active = false; // Final 8 active but no closing-phase spins yet
          }
        }

        const lines = BTHG.Bankroll.projectionLines({
          minUnit, seriesAverage: engine ? engine.seriesAverage : 0, live,
        });

        const recoEl = overlay.querySelector('#br-projection-reco');
        const floorEl = overlay.querySelector('#br-projection-floor');
        const pathEl = overlay.querySelector('#br-projection-path');
        const liveEl = overlay.querySelector('#br-projection-live');
        if (recoEl) {
          recoEl.textContent = reco.amount != null
            ? `Recommended start: ${BTHG.formatMoney(reco.amount)}. ${reco.explanation}`
            : reco.explanation;
        }
        if (floorEl) floorEl.textContent = lines.guaranteedMinimum;
        if (pathEl) pathEl.textContent = lines.path;
        if (liveEl) liveEl.textContent = lines.live || '';
      }).catch(e => {
        console.warn('Failed to compute bankroll projection:', e);
      });
    }

    overlay.querySelector('#wv-open-btn').addEventListener('click', () => {
      const profileForVerify = BTHG.MachineProfiles.getActive();
      const limitsMsg = overlay.querySelector('#br-limits-msg');
      if (!profileForVerify || profileForVerify.minUnit == null || profileForVerify.maxUnit == null) {
        limitsMsg.textContent = 'Set your table minimum and maximum betting unit above, then click Apply, before verifying the wheel layout.';
        return;
      }
      limitsMsg.textContent = '';
      showWheelVerifierOverlay(profileForVerify, () => {
        overlay.remove();
        showBankrollPanel(); // re-render so the verified status line reflects the save
      });
    });

    overlay.querySelector('#br-apply').addEventListener('click', () => {
      // Table limits are validated and saved FIRST, and the whole Apply
      // is all-or-nothing on them: an invalid limit shows its message and
      // stops right there (nothing else applied, panel stays open) so the
      // user can fix it and click Apply again without losing what they
      // already typed in the bankroll/bet fields.
      const minUnitRaw = document.getElementById('br-min-unit').value.trim();
      const maxUnitRaw = document.getElementById('br-max-unit').value.trim();
      const limitsMsg = document.getElementById('br-limits-msg');
      limitsMsg.textContent = '';

      if (minUnitRaw !== '' || maxUnitRaw !== '') {
        if (minUnitRaw === '' || maxUnitRaw === '') {
          limitsMsg.textContent = 'Enter both the table minimum and table maximum betting unit.';
          return;
        }
        const minUnit = parseFloat(minUnitRaw);
        const maxUnit = parseFloat(maxUnitRaw);
        if (isNaN(minUnit) || isNaN(maxUnit)) {
          limitsMsg.textContent = 'Table limits must be numbers.';
          return;
        }
        try {
          const activeProfile = BTHG.MachineProfiles.getActive();
          const profileToSave = BTHG.Bankroll.resolveProfileForLimits(activeProfile, {
            minUnit, maxUnit,
            name: BTHG._currentMachineId || 'Table 1',
            casino: BTHG._currentCasino || 'Unknown Casino',
          });
          const saved = BTHG.MachineProfiles.save(profileToSave);
          BTHG.MachineProfiles.setActive(saved.id);
        } catch (e) {
          limitsMsg.textContent = e.message;
          return;
        }
      }

      const newBank = parseFloat(document.getElementById('br-set-bankroll').value);
      const newBet = parseFloat(document.getElementById('br-set-bet').value); // denomination (rule 1)

      // Task 23 (rule 1): denomination must be validated to [table min,
      // table max] against whatever limits are active NOW (just-saved
      // above, or the existing profile if the limit fields were left
      // blank). All-or-nothing, same as the limits validation above —
      // nothing else applies if this fails.
      if (!isNaN(newBet) && newBet > 0) {
        const profileNow = BTHG.MachineProfiles.getActive();
        if (profileNow && profileNow.minUnit != null && profileNow.maxUnit != null) {
          if (newBet < profileNow.minUnit || newBet > profileNow.maxUnit) {
            limitsMsg.textContent = `Denomination must be between ${BTHG.formatMoney(profileNow.minUnit)} and ${BTHG.formatMoney(profileNow.maxUnit)}, your table limits.`;
            return;
          }
        }
      }

      if (!isNaN(newBank) && newBank >= 0) {
        bankroll.setBankroll(newBank); // re-baselines session start + peak too — never shows a phantom loss
      }
      if (!isNaN(newBet) && newBet > 0) {
        bankroll.baseBet = newBet;
      }
      // Persist so the new bankroll/denomination survive a reload and seed the next session
      const s = BTHG.Storage.Settings.load();
      s.bankroll = bankroll.totalBankroll;
      s.baseBet = bankroll.baseBet;
      BTHG.Storage.Settings.save(s);

      // Resync trinityEngine LAST, after baseBet (denomination) is applied,
      // so it picks up the latest value — this also propagates the fresh
      // instance onto tableUI.
      syncTrinityEngineFromProfile();

      if (typeof tableUI !== 'undefined' && tableUI) tableUI.update();
      overlay.remove();
      showBankrollPanel(); // re-render with the updated values
    });

    overlay.querySelector('.rt-overlay-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // WHEEL LAYOUT VERIFIER (Task 10)
  // Opened from the Bankroll panel's "Verify Wheel" button (that panel
  // is where table-limit/machine-profile fields already live — see
  // .br-limits above). Requires a saved active profile (with table
  // limits already Applied) since MachineProfiles.save() throws on a
  // profile missing minUnit/maxUnit — the caller checks that and shows
  // its own message before ever getting here, so `profile` below is
  // always a real saved profile.
  //
  // Touch pad reuses .rt-cell sizing (see js/roulette-table.js's own
  // felt cells) for 0 through 36 only — 00 is the implied start/end per
  // BTHG.WheelVerifier.INSTRUCTION and is never itself tappable, matching
  // validate()'s rule that a 37/"00" token appearing in the typed
  // sequence is always an error, not a valid entry.
  //
  // `onDone` is called after a successful save (or Cancel), so the
  // caller can re-render itself with the new verified status.
  // ============================================================
  function showWheelVerifierOverlay(profile, onDone) {
    const WV = BTHG.WheelVerifier;
    const N = WV.EXPECTED_LENGTH; // 37 — everything but the implied 00
    let seq = [];         // numbers tapped so far, in entry order
    let errorState = null; // last validate() failure, or null

    const wv = document.createElement('div');
    wv.className = 'rt-overlay rt-overlay-visible';
    wv.innerHTML = `
      <div class="rt-overlay-content wv-panel">
        <h2 style="color:var(--accent);"><i class="fas fa-compass"></i> Verify Wheel Layout</h2>
        <p class="wv-instruction">${WV.INSTRUCTION}</p>
        <div class="wv-progress" id="wv-progress"></div>
        <div class="wv-msg" id="wv-msg"></div>
        <div class="wv-pad" id="wv-pad">
          ${Array.from({ length: N }, (_, n) => `<button type="button" class="rt-cell wv-cell" data-num="${n}">${n}</button>`).join('')}
        </div>
        <div class="wv-actions">
          <button type="button" id="wv-undo" class="btn-outline">Undo Last</button>
          <button type="button" id="wv-reset" class="btn-outline">Reset</button>
          <button type="button" class="rt-overlay-close btn-outline">Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('app-root').appendChild(wv);

    const padEl = wv.querySelector('#wv-pad');
    const msgEl = wv.querySelector('#wv-msg');
    const progressEl = wv.querySelector('#wv-progress');

    function renderPad() {
      padEl.querySelectorAll('.wv-cell').forEach(btn => {
        const n = parseInt(btn.dataset.num, 10);
        const idx = seq.indexOf(n);
        const used = idx !== -1;
        btn.classList.toggle('wv-used', used);
        btn.disabled = used;
        btn.classList.toggle('wv-error-cell', !!errorState && idx === errorState.position);
      });
    }

    // Progress ring: N equal wedges around a circle, one per ENTRY
    // POSITION (the order tapped), not physical wheel position — that
    // physical mapping is exactly what this overlay is collecting, so it
    // isn't known yet. Filled wedges show the number entered at that
    // position; the wedge at errorState.position (if any) is highlighted
    // instead of filled/empty.
    function renderProgress() {
      const size = 220, cx = size / 2, cy = size / 2;
      const outerR = 98, innerR = 60, labelR = 80;
      const wedgeAngle = (2 * Math.PI) / N;
      let svg = `<svg viewBox="0 0 ${size} ${size}">`;
      for (let i = 0; i < N; i++) {
        const sa = -Math.PI / 2 + i * wedgeAngle;
        const ea = sa + wedgeAngle;
        const ma = sa + wedgeAngle / 2;
        const ox1 = cx + outerR * Math.cos(sa), oy1 = cy + outerR * Math.sin(sa);
        const ox2 = cx + outerR * Math.cos(ea), oy2 = cy + outerR * Math.sin(ea);
        const ix1 = cx + innerR * Math.cos(sa), iy1 = cy + innerR * Math.sin(sa);
        const ix2 = cx + innerR * Math.cos(ea), iy2 = cy + innerR * Math.sin(ea);
        const isError = !!errorState && errorState.position === i;
        const filled = i < seq.length;
        const cls = 'wv-ring-wedge' + (isError ? ' wv-error' : (filled ? ' wv-filled' : ''));
        svg += `<path d="M${ix1.toFixed(1)},${iy1.toFixed(1)} L${ox1.toFixed(1)},${oy1.toFixed(1)} A${outerR},${outerR} 0 0,1 ${ox2.toFixed(1)},${oy2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${innerR},${innerR} 0 0,0 ${ix1.toFixed(1)},${iy1.toFixed(1)}" class="${cls}"/>`;
        if (filled) {
          const lx = cx + labelR * Math.cos(ma), ly = cy + labelR * Math.sin(ma);
          svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" class="wv-ring-label">${seq[i]}</text>`;
        }
      }
      svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" class="wv-ring-center-count">${seq.length}/${N}</text>`;
      svg += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" class="wv-ring-center-label">ENTERED</text>`;
      svg += `</svg>`;
      progressEl.innerHTML = svg;
    }

    function renderMsg() {
      msgEl.classList.remove('wv-msg-ok');
      msgEl.textContent = errorState ? errorState.error : '';
    }

    function renderAll() {
      renderPad();
      renderProgress();
      renderMsg();
    }
    renderAll();

    function handleTap(n) {
      if (seq.includes(n)) return; // pad already disables used cells; guard anyway
      seq.push(n);
      errorState = null;
      if (seq.length === N) {
        const res = WV.validate(seq);
        if (res.ok) {
          save();
          return;
        }
        errorState = res;
      }
      renderAll();
    }

    padEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.wv-cell');
      if (!btn || btn.disabled) return;
      handleTap(parseInt(btn.dataset.num, 10));
    });

    wv.querySelector('#wv-undo').addEventListener('click', () => {
      if (seq.length === 0) return;
      seq.pop();
      errorState = null;
      renderAll();
    });

    wv.querySelector('#wv-reset').addEventListener('click', () => {
      seq = [];
      errorState = null;
      renderAll();
    });

    wv.querySelector('.rt-overlay-close').addEventListener('click', () => {
      wv.remove();
      if (typeof onDone === 'function') onDone();
    });

    // On success: 37 prepended for 00 (see js/machine-profile.js
    // AMERICAN_LAYOUT / js/utils.js WHEEL_LAYOUTS for the same encoding),
    // verifiedLayout stamped true. Spreads `profile` into a fresh object
    // rather than mutating it in place — MachineProfiles.save() mutates
    // whatever object it's given (stamping id/createdAt the first time),
    // so passing a copy keeps that side effect off the profile object the
    // Bankroll panel closure is still holding a reference to.
    function save() {
      const fullLayout = [37, ...seq];
      const profileToSave = { ...profile, wheelLayout: fullLayout, verifiedLayout: true };
      try {
        const saved = BTHG.MachineProfiles.save(profileToSave);
        BTHG.MachineProfiles.setActive(saved.id);
        msgEl.textContent = 'Wheel layout verified and saved for this table.';
        msgEl.classList.add('wv-msg-ok');
        renderPad();
        renderProgress();
        setTimeout(() => {
          wv.remove();
          if (typeof onDone === 'function') onDone();
        }, 900);
      } catch (e) {
        errorState = null;
        msgEl.classList.remove('wv-msg-ok');
        msgEl.textContent = 'Could not save: ' + e.message;
      }
    }
  }

  // ---- Boot ---------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('Bootstrap failed:', err);
      // No paywall — on any failure, surface setup so the user is never blocked.
      try { showSessionSetup(); } catch (e) { console.error(e); }
    });
  });

  BTHG.App = { init, showSessionSetup };
  window.BTHG = BTHG;
})();
