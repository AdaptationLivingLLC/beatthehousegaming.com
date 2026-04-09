// ============================================================
// storage.js — localStorage + IndexedDB wrapper
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// v2: Added completed_series and calibrations stores
// Contains: Session (localStorage), Settings, SpinDB, SeriesDB,
//   CalibrationDB, TableHistory, AdminKeys, Access, DataIO
// ============================================================

(function() {
  const BTHG = window.BTHG || {};
  const DB_NAME = 'bthg_roulette';
  const DB_VERSION = 2;
  const SPIN_STORE = 'spins';
  const SESSION_STORE = 'sessions';
  const SERIES_STORE = 'completed_series';
  const CALIBRATION_STORE = 'calibrations';

  // ---- localStorage helpers -----------------------------------
  const LS = {
    set(key, value) {
      try { localStorage.setItem('bthg_' + key, JSON.stringify(value)); }
      catch(e) { console.warn('Storage set failed:', e); }
    },
    get(key, fallback) {
      try {
        const v = localStorage.getItem('bthg_' + key);
        return v !== null ? JSON.parse(v) : fallback;
      } catch(e) { return fallback; }
    },
    remove(key) {
      localStorage.removeItem('bthg_' + key);
    }
  };

  // ---- Access Control Storage ---------------------------------
  const Access = {
    grantAccess(durationMs) {
      const expires = Date.now() + durationMs;
      LS.set('access_expires', expires);
    },
    getExpiry() {
      return LS.get('access_expires', 0);
    },
    isValid() {
      return Date.now() < this.getExpiry();
    },
    revoke() {
      LS.remove('access_expires');
    },
    remainingSeconds() {
      const diff = this.getExpiry() - Date.now();
      return diff > 0 ? Math.floor(diff / 1000) : 0;
    },
    markKeyUsed(key) {
      const used = LS.get('used_keys', []);
      if (!used.includes(key)) {
        used.push(key);
        LS.set('used_keys', used);
      }
    },
    isKeyUsed(key) {
      return LS.get('used_keys', []).includes(key);
    }
  };

  // ---- Session Storage ----------------------------------------
  const Session = {
    save(data) {
      LS.set('current_session', data);
    },
    load() {
      return LS.get('current_session', null);
    },
    clear() {
      LS.remove('current_session');
    }
  };

  // ---- Settings Storage ---------------------------------------
  const Settings = {
    save(settings) {
      LS.set('settings', settings);
    },
    load() {
      return LS.get('settings', {
        baseBet: 5,
        bankroll: 1000,
        payoutRatio: 35,
        wheelType: 'american',
        finalTargetCount: 8,
        autoAdd: true,
        sound: true,
        haptic: true,
        theme: 'classic',
      });
    }
  };

  // ---- IndexedDB ----------------------------------------------
  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        const oldVersion = e.oldVersion;

        // v1 stores
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(SPIN_STORE)) {
            const store = db.createObjectStore(SPIN_STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('machineId', 'machineId', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!db.objectStoreNames.contains(SESSION_STORE)) {
            db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
          }
        }

        // v2 stores — completed series and calibrations
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(SERIES_STORE)) {
            const seriesStore = db.createObjectStore(SERIES_STORE, { keyPath: 'id', autoIncrement: true });
            seriesStore.createIndex('machineId', 'machineId', { unique: false });
            seriesStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!db.objectStoreNames.contains(CALIBRATION_STORE)) {
            const calStore = db.createObjectStore(CALIBRATION_STORE, { keyPath: 'id', autoIncrement: true });
            calStore.createIndex('machineId', 'machineId', { unique: false });
            calStore.createIndex('type', 'type', { unique: false });
            calStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        }
      };
      req.onsuccess = function(e) {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  // ---- Spin History Store -------------------------------------
  const SpinDB = {
    async addSpin(spin) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readwrite');
        tx.objectStore(SPIN_STORE).add(spin);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async getSpinsByMachine(machineId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readonly');
        const idx = tx.objectStore(SPIN_STORE).index('machineId');
        const req = idx.getAll(machineId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getAllSpins() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readonly');
        const req = tx.objectStore(SPIN_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async deleteLastSpin(machineId) {
      const db = await openDB();
      const spins = await this.getSpinsByMachine(machineId);
      if (spins.length === 0) return;
      const last = spins[spins.length - 1];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readwrite');
        tx.objectStore(SPIN_STORE).delete(last.id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async clearMachine(machineId) {
      const db = await openDB();
      const spins = await this.getSpinsByMachine(machineId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readwrite');
        const store = tx.objectStore(SPIN_STORE);
        spins.forEach(s => store.delete(s.id));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async clearAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SPIN_STORE, 'readwrite');
        tx.objectStore(SPIN_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    }
  };

  // ---- Completed Series Store ---------------------------------
  // Stores full data for every completed (auto or manual) series
  const SeriesDB = {
    /**
     * Save a completed series with all tracking data
     * @param {Object} record
     *   machineId: string
     *   casino: string
     *   seriesNumber: number (which series in this session)
     *   totalSpins: number (how many spins this series took)
     *   spinHistory: number[] (every number hit in order)
     *   endType: 'auto' | 'manual'
     *   timestamp: number (Date.now() when series ended)
     *   calibration: object (snapshot of fusion state)
     *   sideBetState: object (final side bet ago/hits)
     *   seriesAverage: number (running avg at time of save)
     */
    async saveSeries(record) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SERIES_STORE, 'readwrite');
        tx.objectStore(SERIES_STORE).add(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async getSeriesByMachine(machineId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SERIES_STORE, 'readonly');
        const idx = tx.objectStore(SERIES_STORE).index('machineId');
        const req = idx.getAll(machineId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getAllSeries() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SERIES_STORE, 'readonly');
        const req = tx.objectStore(SERIES_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async clearAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SERIES_STORE, 'readwrite');
        tx.objectStore(SERIES_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    }
  };

  // ---- Calibration Store --------------------------------------
  // Stores calibration sessions (RPM, pocket timing) for each machine
  const CalibrationDB = {
    /**
     * Save a calibration session
     * @param {Object} record
     *   machineId: string
     *   casino: string
     *   type: 'rpm' | 'pocket_timing'
     *   timestamp: number
     *   data: object (calibration-specific data)
     *     For rpm: { ballRPM, kEstimate, omega_b0, cv, condition, wheelRPM }
     *     For pocket_timing: { landings: [{number, timestamp, intervalMs}],
     *       averageIntervalMs, stats: {min, max, median, count} }
     */
    async saveCalibration(record) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CALIBRATION_STORE, 'readwrite');
        tx.objectStore(CALIBRATION_STORE).add(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async getCalibrationsByMachine(machineId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CALIBRATION_STORE, 'readonly');
        const idx = tx.objectStore(CALIBRATION_STORE).index('machineId');
        const req = idx.getAll(machineId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getCalibrationsByType(type) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CALIBRATION_STORE, 'readonly');
        const idx = tx.objectStore(CALIBRATION_STORE).index('type');
        const req = idx.getAll(type);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getAllCalibrations() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CALIBRATION_STORE, 'readonly');
        const req = tx.objectStore(CALIBRATION_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async clearAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CALIBRATION_STORE, 'readwrite');
        tx.objectStore(CALIBRATION_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    }
  };

  // ---- Table History (discover all previously used tables) -----
  const TableHistory = {
    /**
     * Scan all IndexedDB stores to build a list of unique casino+table combos
     * Returns: [{ machineId, casino, totalSpins, seriesCount, lastUsed }]
     */
    async getAllTables() {
      const spins = await SpinDB.getAllSpins();
      const series = await SeriesDB.getAllSeries();
      const calibrations = await CalibrationDB.getAllCalibrations();

      const tables = {};

      // Scan spins
      for (const spin of spins) {
        const id = spin.machineId || 'default';
        if (!tables[id]) tables[id] = { machineId: id, casino: '', totalSpins: 0, seriesCount: 0, lastUsed: 0, hasCal: false };
        tables[id].totalSpins++;
        if (spin.timestamp > tables[id].lastUsed) tables[id].lastUsed = spin.timestamp;
      }

      // Scan series
      for (const s of series) {
        const id = s.machineId || 'default';
        if (!tables[id]) tables[id] = { machineId: id, casino: '', totalSpins: 0, seriesCount: 0, lastUsed: 0, hasCal: false };
        tables[id].seriesCount++;
        if (s.casino) tables[id].casino = s.casino;
        if (s.timestamp > tables[id].lastUsed) tables[id].lastUsed = s.timestamp;
      }

      // Scan calibrations
      for (const c of calibrations) {
        const id = c.machineId || 'default';
        if (!tables[id]) tables[id] = { machineId: id, casino: '', totalSpins: 0, seriesCount: 0, lastUsed: 0, hasCal: false };
        tables[id].hasCal = true;
        if (c.casino) tables[id].casino = c.casino;
        if (c.timestamp > tables[id].lastUsed) tables[id].lastUsed = c.timestamp;
      }

      // Also check current session in localStorage
      const current = Session.load();
      if (current && current.machineId) {
        const id = current.machineId;
        if (!tables[id]) tables[id] = { machineId: id, casino: current.casino || '', totalSpins: 0, seriesCount: 0, lastUsed: 0, hasCal: false };
        if (current.casino) tables[id].casino = current.casino;
        if (current.engine && current.engine.totalSpins) {
          // Current session spins may not be in IndexedDB yet
          tables[id].hasActiveSession = true;
          tables[id].activeSpins = current.engine.totalSpins;
          tables[id].activeSeriesCount = current.engine.seriesCount || 0;
        }
      }

      // Sort by last used (most recent first)
      return Object.values(tables).sort((a, b) => b.lastUsed - a.lastUsed);
    }
  };

  // ---- Export/Import ------------------------------------------
  const DataIO = {
    async exportSession(machineId) {
      const spins = await SpinDB.getSpinsByMachine(machineId);
      const series = await SeriesDB.getSeriesByMachine(machineId);
      const calibrations = await CalibrationDB.getCalibrationsByMachine(machineId);
      const session = Session.load();
      const settings = Settings.load();
      return JSON.stringify({
        session, settings, spins, series, calibrations,
        exported: new Date().toISOString()
      }, null, 2);
    },

    async importSession(jsonStr) {
      const data = JSON.parse(jsonStr);
      if (data.session) Session.save(data.session);
      if (data.settings) Settings.save(data.settings);
      if (data.spins && Array.isArray(data.spins)) {
        for (const spin of data.spins) {
          delete spin.id;
          await SpinDB.addSpin(spin);
        }
      }
      if (data.series && Array.isArray(data.series)) {
        for (const s of data.series) {
          delete s.id;
          await SeriesDB.saveSeries(s);
        }
      }
      if (data.calibrations && Array.isArray(data.calibrations)) {
        for (const c of data.calibrations) {
          delete c.id;
          await CalibrationDB.saveCalibration(c);
        }
      }
      return data;
    }
  };

  // ---- Admin Key Storage (generated keys list) ----------------
  const AdminKeys = {
    getAll() {
      return LS.get('admin_generated_keys', []);
    },
    add(keyObj) {
      const keys = this.getAll();
      keys.push(keyObj);
      LS.set('admin_generated_keys', keys);
    },
    markUsed(keyStr) {
      const keys = this.getAll();
      const k = keys.find(x => x.key === keyStr);
      if (k) { k.used = true; k.usedAt = Date.now(); }
      LS.set('admin_generated_keys', keys);
    }
  };

  // ---- Public API ---------------------------------------------
  BTHG.Storage = {
    LS, Access, Session, Settings,
    SpinDB, SeriesDB, CalibrationDB,
    DataIO, AdminKeys, TableHistory
  };

  window.BTHG = BTHG;
})();
