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
  // chase framing. NOTE (V3 integration fix): SPEC.md §4.4 does not actually
  // pin exact metres — it only requires "camera never embedded in the
  // chute" + the FOV/roll/lag/shake behaviour below. The previous 3.2-4.5m
  // behind / 1.1-1.8m above pairing (mis-attributed to the spec in an
  // earlier pass) put the camera so low and so close, relative to this
  // track's actual ~5-6.5m cross-section radius (SplineTrack ANGLE_MAX=
  // 1.25rad half-pipe), that the near chute wall/floor read as empty space
  // around the rider — confirmed by screenshotting both values live (see
  // task notes): at old lift (1.1-1.8m, only ~20-30% of the wall height)
  // the camera barely clears the rider's own float height (0.35m) and the
  // downward pitch toward the look-target was too shallow to bring the
  // trough surface into frame. Raising lift (more downward pitch onto the
  // water/floor, more of the U-cross-section visible converging around the
  // rider) and pulling dist in slightly (the near surface reads at a more
  // legible size) fixes this while keeping the same spring/leash/FOV logic.
  chaseDistMin: 2.6,
  chaseDistMax: 3.8,
  chaseLiftMin: 2.2,
  chaseLiftMax: 3.1,
  chaseAirExtraDist: 1.7, // pull back further when airborne so the arc reads
  chaseAirExtraLift: 0.55,
  // 最終アートディレクション修正 (確定原因、実機で再現・切り分け済み):
  // s=0 直後、rawTargetS<0 のとき下の _updateChase は「track.surfaceAt(0,...)
  // から tangent(0) 方向に -rawTargetS ぶん外挿する」formulaだったが、
  // -rawTargetS は chaseDistMin〜chaseDistMax+chaseAirExtraDist
  // (最大で ~5.5m) まで届き得る。s=0 の「手前」はトラックジオメトリが
  // 存在せず、実際には StartTower (発射台の木製プラットフォーム/屋根、
  // Environment.js の buildStartTower) が物理的にその空間を占めている —
  // 外挿がその建物の中/直下に着地し、開始直後の1秒弱ほぼ確実に木製の
  // 巨大な面 (a.k.a. 誤って「樋が茶色い」と報告された症状) がカメラの
  // 目の前を覆っていた。外挿量をライダーモデルの全長を確実に超える程度の
  // 小さな固定値に留めることで、ライダーに埋まらず、かつ StartTower にも
  // 到達しない安全域に収める。
  startBackClearance: 1.4, // m — max backward extrapolation past s=0

  lateralPullFactor: 0.45, // was 0.7 — too much lateral pull rode the camera
  // up onto the (steeply banked, up to ~0.85rad) helix wall right along
  // with the rider, tipping the "up" reference and losing the opposite
  // wall from frame; a softer pull keeps the camera nearer the trough's
  // own centre so both walls stay legible while still favouring the
  // rider's side enough to keep them framed.
  lookAheadDist: 2.4, // was 3.2 — a closer look-target steepens the
  // camera's downward pitch onto the trough/water surface (see above).

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

    const rawTargetS = st.s - dist;
    const targetLateral = THREE.MathUtils.clamp(st.lateral * tune.lateralPullFactor, -1, 1);
    // Integration fix (final AD pass): right at ride start (s ~ 0), clamping
    // targetS to 0 put the "ideal" camera point at the same spot as the
    // rider (who is also near s=0) — the camera ended up buried inside the
    // rider model for the first couple of seconds. A prior fix extrapolated
    // backward from s=0 along the tangent by the *full* shortfall
    // (up to ~5.5m), but there is no track geometry behind s=0 — that space
    // is physically occupied by the StartTower launch platform
    // (Environment.js), so the extrapolated point regularly landed inside
    // its wooden deck/canopy (confirmed live: this is what earlier passes
    // misread as "the chute renders brown" — it was the tower's wood
    // texture filling the frame, not the chute at all). Cap the backward
    // extrapolation to `startBackClearance`, just enough to clear the rider
    // model, so the camera can never reach the tower.
    let idealPos;
    if (rawTargetS < 0) {
      const f0 = this.track.frameAt(0);
      const backAmount = Math.min(-rawTargetS, tune.startBackClearance);
      idealPos = this.track
        .surfaceAt(0, targetLateral, lift)
        .addScaledVector(f0.tangent, -backAmount);
    } else {
      idealPos = this.track.surfaceAt(rawTargetS, targetLateral, lift);
    }

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
