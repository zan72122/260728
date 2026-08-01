import * as THREE from 'three';

/**
 * ChaseCamera — chase/POV camera rig driving the "speed sensation" (FOV
 * stretch, banking roll, G-force shake) that sells how fast the rider is
 * going.
 *
 * The chase-mode position is deliberately NOT `riderPos - forward*dist`:
 * that naive offset cuts straight through walls/tunnel ceilings whenever the
 * chute curves. Instead it re-samples the track itself behind the rider
 * (`track.surfaceAt(s - dist, lateral*0.7, lift)`), so the camera always sits
 * on a point that is, by construction, a valid position just off the chute
 * surface — it can only ever be "inside the tube", never through its walls.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);

const DEFAULTS = {
  // chase framing (SPEC §4.4: 3.2-4.5m behind, 1.1-1.8m above)
  chaseDistMin: 3.2,
  chaseDistMax: 4.5,
  chaseLiftMin: 1.1,
  chaseLiftMax: 1.8,
  chaseAirExtraDist: 1.7, // pull back further when airborne so the arc reads
  chaseAirExtraLift: 0.55,
  lateralPullFactor: 0.7, // spec: surfaceAt(s-dist, lateral*0.7, lift)
  lookAheadDist: 3.2,

  // chase spring-damper
  springStiffness: 68,
  springDamping: 15,
  maxLagDistance: 2.6, // soft leash: never allowed to lag further than this
  // from the geometrically-safe ideal point, however hard the spring lags.

  // pov
  povEyeUp: 0.42,
  povEyeForward: 0.12,
  povTrackRate: 30,
  povHandshakeAmp: 0.006,
  povHandshakeRotAmp: 0.010,

  // shared orientation
  upBlendChase: 0.55, // SPEC: blend camera up between rider up / world up ~0.55
  upBlendPov: 0.8, // it's literally the rider's own eyes — follow their tilt more
  lookSmoothRate: 16,

  // fov
  fovMin: 68,
  fovMax: 92,
  // Re-matched by the integration pass to RiderPhysics.js's real measured
  // speed band (was 8->30 m/s, which sat mostly above what the rider ever
  // reaches, so FOV stretch barely engaged during normal play).
  fovSpeedMin: 6,
  fovSpeedMax: 27,
  fovTuckBonus: 5,
  fovSmoothRate: 5,

  // shake (perlin-like: cheap smoothed value noise, not true Perlin)
  shakeGThreshold: 2.0,
  shakeFromG: 0.020,
  shakeFromSplash: 0.010,
  shakeFromLanding: 0.05,
  shakeAmpMax: 0.045,
  shakeFreq: 9.5,
  shakeDecayRate: 3.2,

  // integration safety (update() is called at a variable render dt)
  maxDt: 0.12,
  subStep: 1 / 60,
  maxSubsteps: 6,
};

/** Smooth 1D value noise (cheap Perlin-like), deterministic and allocation-free. */
function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i);
  const b = hash1(i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u; // 0..1
}

export class ChaseCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../track/SplineTrack.js').SplineTrack} track
   * @param {import('./RiderPhysics.js').RiderPhysics} physics
   */
  constructor(camera, track, physics) {
    this.camera = camera;
    this.track = track;
    this.physics = physics;
    this.tune = { ...DEFAULTS };
    this.mode = 'chase';

    this._camPos = new THREE.Vector3();
    this._camVel = new THREE.Vector3();
    this._camQuat = new THREE.Quaternion();
    this._fov = this.tune.fovMin;

    this._posInitialized = false;
    this._quatInitialized = false;

    this._prevAirborne = false;
    this._landingKick = 0;
    this._noiseT = 0;
    this._noiseSeed = { x: 11.7, y: 53.2, z: 91.4 };

    // scratch (reused every frame — no per-frame allocation in the hot path)
    this._tmpV1 = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpV3 = new THREE.Vector3();
    this._tmpMat = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._shakeQuat = new THREE.Quaternion();
    this._shakeEuler = new THREE.Euler();

    this.camera.fov = this._fov;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode) {
    if (mode !== 'chase' && mode !== 'pov') return;
    if (mode !== this.mode) {
      this.mode = mode;
      // Re-seat the position spring immediately on a mode switch so the
      // camera doesn't spring in from wherever it used to be.
      this._posInitialized = false;
    }
  }

  update(dt) {
    const tune = this.tune;
    const clampedDt = Math.min(Math.max(dt || 0, 0), tune.maxDt);
    if (clampedDt <= 0) return;

    const st = this.physics.state;

    if (this._prevAirborne && !st.airborne) this._landingKick = 1;
    this._prevAirborne = st.airborne;
    this._landingKick = THREE.MathUtils.damp(this._landingKick, 0, tune.shakeDecayRate, clampedDt);
    this._noiseT += clampedDt;

    if (this.mode === 'pov') {
      this._updatePov(clampedDt);
    } else {
      this._updateChase(clampedDt);
    }

    this._applyShake();
    this._updateFov(clampedDt);

    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------

  _updateChase(dt) {
    const tune = this.tune;
    const st = this.physics.state;

    const speedT = THREE.MathUtils.smoothstep(st.speed, tune.fovSpeedMin, tune.fovSpeedMax);
    let dist = THREE.MathUtils.lerp(tune.chaseDistMin, tune.chaseDistMax, speedT);
    let lift = THREE.MathUtils.lerp(tune.chaseLiftMin, tune.chaseLiftMax, speedT);
    if (st.airborne) {
      dist += tune.chaseAirExtraDist;
      lift += tune.chaseAirExtraLift;
    }

    const targetS = Math.max(0, st.s - dist);
    const targetLateral = THREE.MathUtils.clamp(st.lateral * tune.lateralPullFactor, -1, 1);
    const idealPos = this.track.surfaceAt(targetS, targetLateral, lift);

    if (!this._posInitialized) {
      this._camPos.copy(idealPos);
      this._camVel.set(0, 0, 0);
      this._posInitialized = true;
    } else {
      const steps = Math.min(tune.maxSubsteps, Math.max(1, Math.round(dt / tune.subStep)));
      const subDt = dt / steps;
      for (let i = 0; i < steps; i++) {
        const err = this._tmpV1.subVectors(idealPos, this._camPos);
        // semi-implicit Euler spring-damper (mass = 1)
        this._camVel.addScaledVector(err, tune.springStiffness * subDt);
        this._camVel.addScaledVector(this._camVel, -tune.springDamping * subDt);
        this._camPos.addScaledVector(this._camVel, subDt);
      }
      // Soft leash: never allow the lag to exceed maxLagDistance from the
      // (geometrically safe) ideal point, however hard the spring lags in a
      // sharp turn — this is what keeps the camera from ever drifting into
      // a wall even under extreme, adversarial motion.
      const offset = this._tmpV2.subVectors(this._camPos, idealPos);
      const offLen = offset.length();
      if (offLen > tune.maxLagDistance) {
        this._camPos.copy(idealPos).addScaledVector(offset, tune.maxLagDistance / offLen);
        this._camVel.multiplyScalar(0.6);
      }
    }

    this.camera.position.copy(this._camPos);

    const lookTarget = this._tmpV1.copy(st.position).addScaledVector(st.forward, tune.lookAheadDist);
    const camUp = this._tmpV3.copy(WORLD_UP).lerp(st.up, tune.upBlendChase).normalize();
    this._applyLookAt(lookTarget, camUp, dt);
  }

  _updatePov(dt) {
    const tune = this.tune;
    const st = this.physics.state;

    const eyePos = this._tmpV1.copy(st.position)
      .addScaledVector(st.up, tune.povEyeUp)
      .addScaledVector(st.forward, tune.povEyeForward);

    if (!this._posInitialized) {
      this._camPos.copy(eyePos);
      this._posInitialized = true;
    } else {
      const t = 1 - Math.exp(-tune.povTrackRate * dt);
      this._camPos.lerp(eyePos, t);
    }

    // Small handheld-feeling jitter, independent of the G/splash/landing shake.
    const n = this._noiseT * 3.1;
    const jx = (noise1(n + this._noiseSeed.x) - 0.5) * 2;
    const jy = (noise1(n + this._noiseSeed.y) - 0.5) * 2;
    this.camera.position.copy(this._camPos)
      .addScaledVector(this._tmpV2.set(1, 0, 0).applyQuaternion(this.camera.quaternion), jx * tune.povHandshakeAmp)
      .addScaledVector(this._tmpV3.set(0, 1, 0).applyQuaternion(this.camera.quaternion), jy * tune.povHandshakeAmp);

    const lookTarget = this._tmpV1.copy(eyePos).addScaledVector(st.forward, 6);
    const camUp = this._tmpV3.copy(WORLD_UP).lerp(st.up, tune.upBlendPov).normalize();
    this._applyLookAt(lookTarget, camUp, dt);

    const jz = (noise1(n * 1.3 + this._noiseSeed.z) - 0.5) * 2;
    this._shakeEuler.set(jy * tune.povHandshakeRotAmp, jz * tune.povHandshakeRotAmp, jx * tune.povHandshakeRotAmp * 0.5);
    this._shakeQuat.setFromEuler(this._shakeEuler);
    this.camera.quaternion.multiply(this._shakeQuat);
  }

  _applyLookAt(lookTarget, camUp, dt) {
    this._tmpMat.lookAt(this.camera.position, lookTarget, camUp);
    this._tmpQuat.setFromRotationMatrix(this._tmpMat);

    if (!this._quatInitialized) {
      this._camQuat.copy(this._tmpQuat);
      this._quatInitialized = true;
    } else {
      const t = 1 - Math.exp(-this.tune.lookSmoothRate * dt);
      this._camQuat.slerp(this._tmpQuat, t);
    }
    this.camera.quaternion.copy(this._camQuat);
  }

  /** High-G / splash / landing-impact shake, layered on top of whatever orientation was just set. */
  _applyShake() {
    const tune = this.tune;
    const st = this.physics.state;

    const gExcess = Math.max(0, (st.gForce || 1) - tune.shakeGThreshold);
    const splash = THREE.MathUtils.clamp(st.splashRate || 0, 0, 1);
    const amp = Math.min(
      tune.shakeAmpMax,
      gExcess * tune.shakeFromG + splash * tune.shakeFromSplash + this._landingKick * tune.shakeFromLanding
    );
    if (amp <= 0.0001) return;

    const t = this._noiseT * tune.shakeFreq;
    const nx = noise1(t + this._noiseSeed.x) - 0.5;
    const ny = noise1(t * 1.3 + this._noiseSeed.y) - 0.5;
    const nz = noise1(t * 0.8 + this._noiseSeed.z) - 0.5;

    this._shakeEuler.set(nx * amp, ny * amp, nz * amp * 0.6);
    this._shakeQuat.setFromEuler(this._shakeEuler);
    this.camera.quaternion.multiply(this._shakeQuat);

    this.camera.position
      .addScaledVector(this._tmpV1.set(1, 0, 0).applyQuaternion(this.camera.quaternion), nx * amp * 0.15)
      .addScaledVector(this._tmpV2.set(0, 1, 0).applyQuaternion(this.camera.quaternion), ny * amp * 0.15);
  }

  _updateFov(dt) {
    const tune = this.tune;
    const st = this.physics.state;
    const speedT = THREE.MathUtils.smoothstep(st.speed, tune.fovSpeedMin, tune.fovSpeedMax);
    let targetFov = THREE.MathUtils.lerp(tune.fovMin, tune.fovMax, speedT);
    targetFov += (st.tuck || 0) * tune.fovTuckBonus;
    this._fov = THREE.MathUtils.damp(this._fov, targetFov, tune.fovSmoothRate, dt);
    this.camera.fov = this._fov;
  }
}
