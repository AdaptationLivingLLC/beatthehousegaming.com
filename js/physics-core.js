// ============================================================
// physics-core.js — RoulettePhysicsCore (kinematics)
// BTHG Roulette Breaker Web App (Ported from RoulettePhysicsCore.swift)
// Last modified: 2026-03-07
// Contains: wrapAngle, angleToIndex, thetaWheel, thetaBallLinear,
//   thetaBallExponential, deltaThetaLinear, deltaThetaExponential,
//   solveForDropTimeLinear, solveForDropTimeExponential,
//   rpmToRadS, radSToRPM, getTimingPerPocketS
// Verified: 298/298 tests passed (test-all.js)
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const C = BTHG.CONSTANTS;

  const Physics = {
    // ---- Angle Wrapping ----------------------------------------
    wrapAngle: BTHG.wrapAngle,
    angleToIndex: BTHG.angleToIndex,

    // ---- Wheel Kinematics (constant speed) ---------------------
    // θ_w(t) = θ_w0 + ω_w * t
    thetaWheel(t, theta0, omega) {
      return BTHG.wrapAngle(theta0 + omega * t);
    },

    // ---- Ball Kinematics — LINEAR MODEL -----------------------
    // θ_b(t) = θ_b0 + ω_b0 * t + 0.5 * α_b * t²
    thetaBallLinear(t, theta0, omega0, alpha) {
      return BTHG.wrapAngle(theta0 + omega0 * t + 0.5 * alpha * t * t);
    },

    // Δθ(t) = Δθ₀ + (ω_b0 - ω_w) * t + 0.5 * α_b * t²
    deltaThetaLinear(t, dTheta0, omegaB0, omegaW, alphaB) {
      return BTHG.wrapAngle(dTheta0 + (omegaB0 - omegaW) * t + 0.5 * alphaB * t * t);
    },

    // Drop Time (Linear): t_drop = (ω_drop - ω_b0) / α_b
    solveForDropTimeLinear(omega0, alpha, omegaDrop) {
      if (alpha >= 0) return null;
      const td = (omegaDrop - omega0) / alpha;
      return td > 0 ? td : null;
    },

    // ---- Ball Kinematics — EXPONENTIAL MODEL (Preferred) ------
    // ω(t) = ω₀ * e^(-kt)
    // θ_b(t) = θ_b0 + (ω₀/k) * (1 - e^(-kt))
    thetaBallExponential(t, theta0, omega0, k) {
      if (k <= 0) return this.thetaWheel(t, theta0, omega0);
      const dist = (omega0 / k) * (1.0 - Math.exp(-k * t));
      return BTHG.wrapAngle(theta0 + dist);
    },

    // Drop Time (Exponential): t_drop = ln(ω₀ / ω_drop) / k
    solveForDropTimeExponential(omega0, k, omegaDrop) {
      if (k <= 0 || omega0 <= omegaDrop || omegaDrop <= 0) return null;
      return Math.log(omega0 / omegaDrop) / k;
    },

    // Δθ(t) = (θ_b0 - θ_w0) + (ω_b0/k)*(1 - e^(-kt)) - ω_w*t
    deltaThetaExponential(t, dTheta0, omegaB0, omegaW, k) {
      if (k <= 0) {
        return BTHG.wrapAngle(dTheta0 + (omegaB0 - omegaW) * t);
      }
      const ballDist = (omegaB0 / k) * (1.0 - Math.exp(-k * t));
      const wheelDist = omegaW * t;
      return BTHG.wrapAngle(dTheta0 + ballDist - wheelDist);
    },

    // ---- Derived Properties ------------------------------------
    getWheelCircumferenceCM(diameter) {
      const d = diameter > 0 ? diameter : C.DEFAULT_WHEEL_DIAMETER;
      return d * Math.PI;
    },

    getPocketLinearVelocityCMS(omegaW, diameter) {
      const d = diameter > 0 ? diameter : C.DEFAULT_WHEEL_DIAMETER;
      return Math.abs(omegaW) * (d / 2.0);
    },

    getTimingPerPocketS(omegaW) {
      if (Math.abs(omegaW) <= 0.01) return 0;
      const T = C.TWO_PI / Math.abs(omegaW);
      return T / C.AMERICAN_N;
    },

    // ---- RPM Conversions ----------------------------------------
    rpmToRadS(rpm) {
      return rpm * C.TWO_PI / 60.0;
    },

    radSToRPM(radS) {
      return radS * 60.0 / C.TWO_PI;
    },
  };

  BTHG.Physics = Physics;
  window.BTHG = BTHG;
})();
