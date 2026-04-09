// ============================================================
// calibration.js — Manual calibration + CalibratorDataFusion
// BTHG Roulette Breaker Web App (Ported from CalibratorDataFusion.swift)
// Last modified: 2026-03-07
// Contains: CalibratorDataFusion (Kalman min-variance fusion,
//   scatter offset learning, quality tier gating, empirical bias,
//   pocket delta distribution), ManualCalibrationSession (RPM),
//   PocketTimingSession (landing intervals, optional timestamp param)
// Note: HysteresisManager/Latch NOT yet ported (requires camera)
// Verified: 298/298 tests passed (test-all.js)
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const C = BTHG.CONSTANTS;
  const Physics = BTHG.Physics;

  // ---- Calibrator Data Fusion ---------------------------------
  class CalibratorDataFusion {
    constructor() {
      this.reset();
    }

    reset() {
      this.omega_w = 0;                // Wheel angular velocity (rad/s)
      this.omega_b0 = 0;               // Ball initial angular velocity (rad/s)
      this.kPerSec = C.DEFAULT_K_PER_SEC; // Exponential decay constant
      this.learnedDropThresholdRadS = C.STANDARD_DROP_THRESHOLD;
      this.calibratedDiameter = C.DEFAULT_WHEEL_DIAMETER;

      // Variances
      this.v_w = 1.0;
      this.v_b = 1.0;
      this.v_k = 0.05;

      // Scatter offset model
      this.countOffset = {};     // { offset: count }

      // Quality signals
      this.referenceLocked = false;
      this.wheelJitterCV = 0;
      this.arTrackingLossRate = 0;
      this.blurScore = 1.0;
      this.qualityTier = 0;

      this.lastCalibrationDate = null;
      this.calibrationCount = 0;
    }

    // ---- Min-Variance Fusion -----------------------------------
    _fuse(current, variance, newValue, newVariance) {
      const invCurrent = 1.0 / variance;
      const invNew = 1.0 / newVariance;
      const combinedInv = invCurrent + invNew;
      return {
        value: (current * invCurrent + newValue * invNew) / combinedInv,
        variance: 1.0 / combinedInv,
      };
    }

    addWheelMeasurement(omega, sourceVariance) {
      const r = this._fuse(this.omega_w, this.v_w, omega, sourceVariance || 0.1);
      this.omega_w = r.value;
      this.v_w = r.variance;
      this._updateQualityTier();
    }

    addBallMeasurement(omega0, k, sourceVariance) {
      let r = this._fuse(this.omega_b0, this.v_b, omega0, sourceVariance || 0.2);
      this.omega_b0 = r.value;
      this.v_b = r.variance;

      r = this._fuse(this.kPerSec, this.v_k, k, sourceVariance || 0.2);
      this.kPerSec = r.value;
      this.v_k = r.variance;

      this._updateQualityTier();
    }

    // ---- Scatter Learning --------------------------------------
    learnOffset(predictedDropIndex, actualOutcomeIndex) {
      if (this.qualityTier < 2) return; // Only learn from good+ quality
      const N = C.AMERICAN_N;
      const epsilon = (actualOutcomeIndex - predictedDropIndex + N) % N;
      this.countOffset[epsilon] = (this.countOffset[epsilon] || 0) + 1;
    }

    getProbabilityMap() {
      const total = Object.values(this.countOffset).reduce((a, b) => a + b, 0);
      if (total === 0) return {};
      const map = {};
      for (const [k, count] of Object.entries(this.countOffset)) {
        map[k] = count / total;
      }
      return map;
    }

    // ---- Quality Tier Gating -----------------------------------
    _updateQualityTier() {
      let tier = 0;

      if (this.referenceLocked) {
        tier = 1;
        if (this.wheelJitterCV <= 0.05 && this.arTrackingLossRate <= 0.25) {
          tier = 2;
        }
        const totalSamples = Object.values(this.countOffset).reduce((a, b) => a + b, 0);
        if (this.wheelJitterCV <= 0.01 && this.arTrackingLossRate <= 0.05 && totalSamples >= 1000) {
          tier = 3;
        }
      }

      // Guard rails
      if (this.wheelJitterCV > 0.10 || this.arTrackingLossRate > 0.40) {
        tier = 0;
      }

      this.qualityTier = tier;
    }

    // ---- Update from Manual Calibration -----------------------
    updateFromManual(wheelRPM, ballRPM, kEstimate) {
      const wheelOmega = Physics.rpmToRadS(wheelRPM);
      const ballOmega = Physics.rpmToRadS(ballRPM);
      const k = kEstimate > 0 ? kEstimate : this.kPerSec;

      this.addWheelMeasurement(wheelOmega, 0.1);
      this.addBallMeasurement(ballOmega, k, 0.2);
      this.referenceLocked = true;
      this.lastCalibrationDate = new Date();
      this.calibrationCount++;
      this._updateQualityTier();
    }

    // ---- Integrate Pocket Timing Data --------------------------
    /**
     * Combine pocket-to-pocket timing data with existing calibration.
     * If RPM calibration exists, each landing updates the scatter model.
     * Also builds an empirical number-bias map for weighted predictions.
     *
     * @param {Object} timingResults — output from PocketTimingSession.getResults()
     */
    integrateTimingData(timingResults) {
      if (!timingResults || timingResults.landingCount < 3) return;

      const N = C.AMERICAN_N;
      const wheelLayout = BTHG.WHEEL_LAYOUTS.american;

      // If RPM calibration exists, compute scatter offsets for each landing
      if (this.referenceLocked && this.qualityTier >= 1) {
        const t_drop = Physics.solveForDropTimeExponential(
          this.omega_b0, this.kPerSec, this.learnedDropThresholdRadS
        );

        if (t_drop && t_drop > 0) {
          const delta_drop = Physics.deltaThetaExponential(
            t_drop, 0, this.omega_b0, this.omega_w, this.kPerSec
          );
          const predictedDropIndex = Physics.angleToIndex(delta_drop, N);

          for (const landing of timingResults.landings) {
            const actualIndex = wheelLayout.indexOf(landing.number);
            if (actualIndex < 0) continue;
            // Scatter offset: how many pockets from predicted drop to actual landing
            const epsilon = (actualIndex - predictedDropIndex + N) % N;
            this.countOffset[epsilon] = (this.countOffset[epsilon] || 0) + 1;
          }
        }
      }

      // Store empirical bias from pocket timing (number → relative frequency)
      // This is used as a secondary prediction signal independent of RPM
      if (!this.empiricalBias) this.empiricalBias = {};
      for (const [idxStr, freq] of Object.entries(timingResults.empiricalBias || {})) {
        const idx = parseInt(idxStr);
        // Weighted running average with existing bias data
        if (this.empiricalBias[idx] !== undefined) {
          this.empiricalBias[idx] = this.empiricalBias[idx] * 0.6 + freq * 0.4;
        } else {
          this.empiricalBias[idx] = freq;
        }
      }

      // Store pocket delta distribution for scatter analysis
      if (!this.pocketDeltaDistribution) this.pocketDeltaDistribution = {};
      for (const [deltaStr, count] of Object.entries(timingResults.deltaDistribution || {})) {
        const d = parseInt(deltaStr);
        this.pocketDeltaDistribution[d] = (this.pocketDeltaDistribution[d] || 0) + count;
      }

      // Timing consistency feeds into quality assessment
      if (timingResults.cv > 0) {
        // Blend timing consistency into wheel jitter estimate
        this.wheelJitterCV = this.wheelJitterCV > 0
          ? this.wheelJitterCV * 0.7 + timingResults.cv * 0.3
          : timingResults.cv;
      }

      this.calibrationCount++;
      this.lastCalibrationDate = new Date();
      this._updateQualityTier();
    }

    /**
     * Get empirical bias correction factor for a wheel index.
     * Returns a multiplier (1.0 = no bias). Values > 1 mean the pocket
     * lands more frequently than expected.
     * @param {number} wheelIndex — 0 to 37
     * @returns {number} bias multiplier
     */
    getEmpiricalBias(wheelIndex) {
      if (!this.empiricalBias || Object.keys(this.empiricalBias).length === 0) return 1.0;
      const expected = 1.0 / C.AMERICAN_N; // ~2.63%
      const observed = this.empiricalBias[wheelIndex] || expected;
      return observed / expected;
    }

    // ---- Wheel Condition Assessment ----------------------------
    getWheelCondition() {
      if (this.wheelJitterCV > 0.10) return 'unstable';
      if (this.wheelJitterCV > 0.05) return 'caution';
      return 'stable';
    }

    // ---- Serialization -----------------------------------------
    toJSON() {
      return {
        omega_w: this.omega_w,
        omega_b0: this.omega_b0,
        kPerSec: this.kPerSec,
        learnedDropThresholdRadS: this.learnedDropThresholdRadS,
        calibratedDiameter: this.calibratedDiameter,
        v_w: this.v_w, v_b: this.v_b, v_k: this.v_k,
        countOffset: this.countOffset,
        referenceLocked: this.referenceLocked,
        wheelJitterCV: this.wheelJitterCV,
        qualityTier: this.qualityTier,
        lastCalibrationDate: this.lastCalibrationDate,
        calibrationCount: this.calibrationCount,
        empiricalBias: this.empiricalBias || {},
        pocketDeltaDistribution: this.pocketDeltaDistribution || {},
      };
    }

    fromJSON(data) {
      if (!data) return;
      Object.assign(this, data);
      if (data.lastCalibrationDate) {
        this.lastCalibrationDate = new Date(data.lastCalibrationDate);
      }
      if (!this.empiricalBias) this.empiricalBias = {};
      if (!this.pocketDeltaDistribution) this.pocketDeltaDistribution = {};
    }
  }

  // ---- Manual Calibration Session -----------------------------
  class ManualCalibrationSession {
    constructor() {
      this.state = 'idle'; // idle → timing_ball → waiting_drop → waiting_land → done
      this.ballTaps = [];
      this.dropTime = null;
      this.landedNumber = null;
      this.startTime = null;
    }

    start() {
      this.state = 'timing_ball';
      this.ballTaps = [];
      this.dropTime = null;
      this.landedNumber = null;
      this.startTime = performance.now();
    }

    recordBallPass() {
      if (this.state !== 'timing_ball') return;
      this.ballTaps.push(performance.now());
    }

    recordDrop() {
      if (this.state !== 'timing_ball') return;
      if (this.ballTaps.length < 3) return { error: 'Need at least 3 ball passes' };
      this.dropTime = performance.now();
      this.state = 'waiting_land';
      return { success: true };
    }

    recordLanded(number) {
      if (this.state !== 'waiting_land') return;
      this.landedNumber = number;
      this.state = 'done';
      return this.compute();
    }

    compute() {
      if (this.ballTaps.length < 3) return null;

      // Compute intervals between consecutive ball passes (ms)
      const intervals = [];
      for (let i = 1; i < this.ballTaps.length; i++) {
        intervals.push(this.ballTaps[i] - this.ballTaps[i - 1]);
      }

      // Filter outliers (> 3x median)
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      const valid = intervals.filter(v => v > 80 && v < median * 3 && v < 10000);

      if (valid.length < 2) return null;

      const avgIntervalMs = valid.reduce((a, b) => a + b, 0) / valid.length;
      const avgIntervalS = avgIntervalMs / 1000;

      // RPM = 60 / period (period = interval between passes = 1 revolution)
      const ballRPM = 60 / avgIntervalS;

      // Estimate deceleration k from first and last intervals
      const firstInt = valid[0] / 1000;
      const lastInt = valid[valid.length - 1] / 1000;
      const totalTime = (this.ballTaps[this.ballTaps.length - 1] - this.ballTaps[0]) / 1000;

      // ω(t) = ω₀ * e^(-kt)  →  k = ln(ω_first / ω_last) / totalTime
      const omega_first = C.TWO_PI / firstInt;
      const omega_last = C.TWO_PI / lastInt;
      let kEstimate = 0;
      if (omega_first > omega_last && totalTime > 0) {
        kEstimate = Math.log(omega_first / omega_last) / totalTime;
      }

      // Coefficient of variation for jitter assessment
      const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
      const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length;
      const cv = Math.sqrt(variance) / mean;

      return {
        ballRPM: ballRPM,
        avgIntervalMs: avgIntervalMs,
        kEstimate: Math.max(0.05, kEstimate),
        omega_b0: omega_first,
        cv: cv,
        tapCount: this.ballTaps.length,
        validIntervals: valid.length,
        condition: cv <= 0.05 ? 'stable' : cv <= 0.10 ? 'caution' : 'unstable',
      };
    }

    getStatus() {
      return {
        state: this.state,
        taps: this.ballTaps.length,
        elapsed: this.startTime ? (performance.now() - this.startTime) / 1000 : 0,
        liveRPM: this._liveRPM(),
      };
    }

    _liveRPM() {
      if (this.ballTaps.length < 2) return 0;
      const last2 = this.ballTaps.slice(-2);
      const interval = (last2[1] - last2[0]) / 1000;
      return interval > 0 ? 60 / interval : 0;
    }
  }

  // ---- Pocket-to-Pocket Timing Session -------------------------
  // Records consecutive ball landings with millisecond precision.
  // Builds scatter distribution and empirical bias data for predictions.
  class PocketTimingSession {
    constructor() {
      this.landings = [];   // { number, timestamp, wheelIndex, intervalMs, pocketDelta }
      this.isActive = false;
      this.startTime = null;
    }

    start() {
      this.landings = [];
      this.isActive = true;
      this.startTime = performance.now();
    }

    /**
     * Record a ball landing.
     * @param {number} number — 0–37 (37 = 00)
     * @param {number} [timestamp] — optional pre-captured timestamp (from "In Pocket" button)
     * @returns {Object} landing record with timing data
     */
    recordLanding(number, timestamp) {
      if (!this.isActive) return null;
      const now = timestamp || performance.now();
      const wheelLayout = BTHG.WHEEL_LAYOUTS.american;
      const wheelIndex = wheelLayout.indexOf(number);

      const landing = {
        number,
        timestamp: now,                         // sub-ms precision via performance.now()
        timestampMs: Math.round(now * 100) / 100, // rounded to 0.01ms
        wheelIndex,
        intervalMs: null,
        pocketDelta: null,
      };

      if (this.landings.length > 0) {
        const prev = this.landings[this.landings.length - 1];
        landing.intervalMs = Math.round((now - prev.timestamp) * 100) / 100; // 0.01ms precision

        // Pocket delta on physical wheel (how many pockets apart)
        const N = wheelLayout.length; // 38
        landing.pocketDelta = ((wheelIndex - prev.wheelIndex) % N + N) % N;
      }

      this.landings.push(landing);
      return landing;
    }

    stop() {
      this.isActive = false;
    }

    /**
     * Compute full analysis of recorded pocket timing data
     * @returns {Object|null} results with statistics, distributions, and raw data
     */
    getResults() {
      if (this.landings.length < 2) return null;

      const intervals = this.landings
        .filter(l => l.intervalMs !== null)
        .map(l => l.intervalMs);

      const pocketDeltas = this.landings
        .filter(l => l.pocketDelta !== null)
        .map(l => l.pocketDelta);

      // ---- Interval Statistics ----
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + (b - avgInterval) ** 2, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const cv = avgInterval > 0 ? stdDev / avgInterval : 0;

      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      // ---- Pocket Delta Distribution (scatter model input) ----
      const N = 38;
      const deltaDistribution = {};
      for (const d of pocketDeltas) {
        deltaDistribution[d] = (deltaDistribution[d] || 0) + 1;
      }

      // ---- Number Frequency (empirical bias) ----
      const numberFreq = {};
      for (const l of this.landings) {
        numberFreq[l.number] = (numberFreq[l.number] || 0) + 1;
      }

      // ---- Empirical Bias Map (wheel index → relative frequency) ----
      const totalLandings = this.landings.length;
      const empiricalBias = {};
      for (const [numStr, count] of Object.entries(numberFreq)) {
        const num = parseInt(numStr);
        const idx = BTHG.WHEEL_LAYOUTS.american.indexOf(num);
        if (idx >= 0) {
          empiricalBias[idx] = count / totalLandings;
        }
      }

      // ---- Sequential Pattern Analysis ----
      // Detect if certain intervals correlate with certain landing zones
      const intervalZoneCorrelation = this._analyzeIntervalZoneCorrelation();

      return {
        landingCount: this.landings.length,
        intervals: intervals.map(i => Math.round(i * 100) / 100),
        avgIntervalMs: Math.round(avgInterval * 100) / 100,
        stdDevMs: Math.round(stdDev * 100) / 100,
        cv: Math.round(cv * 10000) / 10000,
        medianMs: Math.round(median * 100) / 100,
        minMs: Math.round(min * 100) / 100,
        maxMs: Math.round(max * 100) / 100,
        pocketDeltas,
        deltaDistribution,
        numberFreq,
        empiricalBias,
        intervalZoneCorrelation,
        landings: this.landings.map(l => ({
          number: l.number,
          timestampMs: Math.round(l.timestamp * 100) / 100,
          intervalMs: l.intervalMs !== null ? Math.round(l.intervalMs * 100) / 100 : null,
          pocketDelta: l.pocketDelta,
        })),
        condition: cv <= 0.15 ? 'consistent' : cv <= 0.30 ? 'moderate' : 'variable',
        durationMs: Math.round((this.landings[this.landings.length - 1].timestamp - this.landings[0].timestamp) * 100) / 100,
      };
    }

    /**
     * Analyze whether spin intervals correlate with landing wheel zones.
     * Splits the wheel into 4 quadrants and checks if certain interval
     * ranges favor certain quadrants.
     */
    _analyzeIntervalZoneCorrelation() {
      if (this.landings.length < 5) return null;

      const N = 38;
      const quadrants = [
        { name: 'Q1', min: 0, max: Math.floor(N / 4) },
        { name: 'Q2', min: Math.floor(N / 4), max: Math.floor(N / 2) },
        { name: 'Q3', min: Math.floor(N / 2), max: Math.floor(3 * N / 4) },
        { name: 'Q4', min: Math.floor(3 * N / 4), max: N },
      ];

      const intervals = this.landings.filter(l => l.intervalMs !== null);
      if (intervals.length < 4) return null;

      const avgInt = intervals.reduce((s, l) => s + l.intervalMs, 0) / intervals.length;
      const shortThreshold = avgInt * 0.9;
      const longThreshold = avgInt * 1.1;

      const zones = { short: {}, long: {}, normal: {} };
      for (const q of quadrants) {
        zones.short[q.name] = 0;
        zones.long[q.name] = 0;
        zones.normal[q.name] = 0;
      }

      for (const l of intervals) {
        const quad = quadrants.find(q => l.wheelIndex >= q.min && l.wheelIndex < q.max);
        if (!quad) continue;
        if (l.intervalMs < shortThreshold) zones.short[quad.name]++;
        else if (l.intervalMs > longThreshold) zones.long[quad.name]++;
        else zones.normal[quad.name]++;
      }

      return zones;
    }

    getStatus() {
      const lastLanding = this.landings.length > 0 ? this.landings[this.landings.length - 1] : null;
      return {
        isActive: this.isActive,
        landingCount: this.landings.length,
        lastNumber: lastLanding ? lastLanding.number : null,
        lastIntervalMs: lastLanding && lastLanding.intervalMs !== null
          ? Math.round(lastLanding.intervalMs) : null,
        elapsed: this.startTime ? Math.round(performance.now() - this.startTime) : 0,
      };
    }
  }

  BTHG.CalibratorDataFusion = CalibratorDataFusion;
  BTHG.ManualCalibrationSession = ManualCalibrationSession;
  BTHG.PocketTimingSession = PocketTimingSession;
  window.BTHG = BTHG;
})();
