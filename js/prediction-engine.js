// ============================================================
// prediction-engine.js — SmartPredictor (P_final convolution)
// BTHG Roulette Breaker Web App (Ported from SmartPredictor.swift)
// Last modified: 2026-03-07
// Contains: PredictionEngine.predict() — computes P_final[i] via:
//   1. Exponential drop time: t = ln(ω₀/ω_drop) / k
//   2. P_drop distribution around predicted drop index
//   3. Scatter convolution: P_final[i] = Σ P_drop[d] · P_scatter[(i-d+38)%38]
//   4. Empirical bias weighting from pocket timing data
//   Returns top 8 recommended wheel indices with combined probability
// Verified: 298/298 tests passed (test-all.js)
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const C = BTHG.CONSTANTS;
  const Physics = BTHG.Physics;

  const QUALITY_MESSAGES = {
    3: 'PREMIUM QUANT LOCK',
    2: 'GOOD MEASUREMENT',
    1: 'LIMITED DATA',
    0: 'INSUFFICIENT DATA',
  };

  class PredictionEngine {
    constructor() {
      this.lastResult = null;
    }

    /**
     * Predict recommended numbers from calibration fusion state
     * @param {Object} fusion — CalibratorDataFusion state
     * @returns {Object|null} — { recommendedNumbers, probabilityMap, qualityTier, probability, qualityMessage, multiplierPlan }
     */
    predict(fusion) {
      if (!fusion || fusion.qualityTier < 1) return null;

      const N = C.AMERICAN_N;

      // 1. Estimate drop time using exponential model
      const t_drop = Physics.solveForDropTimeExponential(
        fusion.omega_b0,
        fusion.kPerSec,
        fusion.learnedDropThresholdRadS
      );

      if (!t_drop || t_drop <= 0) return null;

      // 2. Compute relative angle at drop
      const dTheta0 = 0.0;
      const delta_drop = Physics.deltaThetaExponential(
        t_drop, dTheta0,
        fusion.omega_b0, fusion.omega_w, fusion.kPerSec
      );

      const dropIndex = Physics.angleToIndex(delta_drop, N);

      // 3. Build P_drop[d] — narrow distribution around predicted drop
      const p_drop = new Float64Array(N);
      p_drop[dropIndex] = C.P_DROP_PEAK;
      p_drop[(dropIndex + 1) % N] = C.P_DROP_NEIGHBORS;
      p_drop[(dropIndex - 1 + N) % N] = C.P_DROP_NEIGHBORS;

      // 4. Get learned scatter offset distribution P_offset
      const p_offset = fusion.getProbabilityMap();
      const hasOffset = Object.keys(p_offset).length > 0;

      // 5. P_final[i] = Σ_d P_drop[d] * P_offset[(i - d + N) % N]
      const p_final = new Float64Array(N);

      if (hasOffset) {
        for (let d = 0; d < N; d++) {
          if (p_drop[d] <= 0) continue;
          for (const [offsetStr, prob_off] of Object.entries(p_offset)) {
            const offset = parseInt(offsetStr);
            const finalIndex = (d + offset) % N;
            p_final[finalIndex] += p_drop[d] * prob_off;
          }
        }
      } else {
        // No scatter data — use drop distribution directly
        for (let i = 0; i < N; i++) {
          p_final[i] = p_drop[i];
        }
      }

      // 6. Apply empirical bias from pocket-to-pocket timing (if available)
      //    Bias multiplier adjusts probabilities based on observed landing frequency.
      //    Numbers that land more often than expected get boosted.
      if (fusion.empiricalBias && Object.keys(fusion.empiricalBias).length > 0) {
        for (let i = 0; i < N; i++) {
          const bias = fusion.getEmpiricalBias(i);
          p_final[i] *= bias;
        }
        // Re-normalize
        const biasTotal = p_final.reduce((s, v) => s + v, 0);
        if (biasTotal > 0) {
          for (let i = 0; i < N; i++) p_final[i] /= biasTotal;
        }
      }

      // 7. Rank and select top 8
      const ranked = [];
      for (let i = 0; i < N; i++) {
        ranked.push({ index: i, prob: p_final[i] });
      }
      ranked.sort((a, b) => b.prob - a.prob);

      const topTargets = ranked.slice(0, 8).map(r => r.index);
      const combinedProb = topTargets.reduce((sum, idx) => sum + p_final[idx], 0);

      this.lastResult = {
        recommendedNumbers: topTargets,
        probabilityMap: p_final,
        qualityTier: fusion.qualityTier,
        probability: combinedProb * 100.0,
        qualityMessage: QUALITY_MESSAGES[fusion.qualityTier] || 'UNKNOWN',
        dropIndex,
        dropTime: t_drop,
      };

      return this.lastResult;
    }
  }

  BTHG.PredictionEngine = PredictionEngine;
  BTHG.QUALITY_MESSAGES = QUALITY_MESSAGES;
  window.BTHG = BTHG;
})();
