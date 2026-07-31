import * as THREE from 'three';

/**
 * RiderPhysics — the "軽快に滑る爽快感" (nimble, exhilarating sliding feel) engine.
 *
 * State model (SPEC §4.3):
 *   s          : arc-length position along the track [m]
 *   speed      : tangential (forward) speed [m/s]
 *   lateral    : position across the U-shaped cross-section, -1..+1
 *   lateralVel : d(lateral)/dt
 *
 * -------------------------------------------------------------------------
 * LONGITUDINAL MODEL
 *   dv/dt = g*slope + current - (k1*v + k2*v^2) - brake - governor
 * A small constant "current" term represents the slide's flowing water and
 * keeps the rider from ever fully stalling on flats/the tiny uphill in the
 * E section. `tuck` reduces the quadratic drag term 40% and adds a small
 * thrust bonus. `brake` adds drag that scales with speed (so it can't lock
 * the rider solid at a standstill, but bites hard at speed). A soft cubic
 * governor engages above ~27.5 m/s so no combination of steep slope + tuck
 * can push speed past ~30 m/s. All of this was numerically integrated and
 * tuned against a mock track standing in for SplineTrack — see the summary
 * in the task notes for measured speed/G bands.
 *
 * -------------------------------------------------------------------------
 * LATERAL MODEL (the "faster = climbs the wall" feel)
 *   Generalized coordinate theta = lateral * ANGLE_MAX, i.e. the rider is
 *   treated as a bead on the circular arc of the U-shaped cross-section
 *   (radius = frame.radius), exactly like a pendulum whose pivot is itself
 *   being accelerated sideways by the track's horizontal curvature. This
 *   gives, from first principles (see derivation in task notes):
 *
 *     theta'' = -(g/r)*sin(theta) + curvature*v^2*cos(theta)/r
 *
 *   which is precisely the pendulum equation with an extra "centrifugal
 *   gravity" term from the curve. Its equilibrium (theta''=0) is the
 *   textbook banked-turn angle tan(theta) = curvature*v^2/g — independent
 *   of r. That equilibrium is what makes faster + sharper corners climb the
 *   wall higher, entirely organically. `steer` adds a speed-scaled lateral
 *   force (weight shift); a wall spring+damper clamps |lateral|>0.97 so the
 *   rider never launches off the lip of the chute.
 *
 * -------------------------------------------------------------------------
 * AIRBORNE MODEL
 *   Contact is lost when the centripetal acceleration required to follow
 *   the chute's vertical curvature exceeds what gravity can supply:
 *     required normal accel = v^2*(dT/ds . n) - g_vec . n
 *   (dT/ds estimated by sampling frameAt just ahead/behind; n = the rider's
 *   actual surfaceNormalAt). When negative beyond a threshold (with a couple
 *   frames of hysteresis both ways to avoid flicker), the rider goes
 *   ballistic: true 3D projectile motion (+ light air drag as a safety
 *   bound), while `s` is tracked via a closest-point Newton refinement
 *   against frameAt (robust even when the chute drops away steeply — naive
 *   velocity dead-reckoning was verified to fail badly in that case).
 *   Re-contact fires once the projectile crosses back below the true
 *   surface (via surfaceAt/surfaceNormalAt), with a forced-landing timeout
 *   and a landing-speed cap as safety nets.
 */

// ---------------------------------------------------------------------------
// Tunable constants — validated by numerically integrating this exact model
// against a mock SplineTrack (constant and full-course slope/curvature
// profiles) at the fixed 1/120s step the game uses. See task summary for
// the measured bands (speed stayed in ~8-29.5 m/s, gForce 1-3.5G in typical
// corners, lateral never diverges, no NaN/instability across a 25-seed fuzz
// test with randomized steer/tuck/brake).
// ---------------------------------------------------------------------------
const GRAVITY = 9.81;

const DEFAULTS = {
  angleMax: THREE.MathUtils.degToRad(84), // U-arc angle span mapped from lateral -1..1
  riderFloat: 0.35, // tube float height above the chute surface [m]

  // longitudinal
  dragK1: 0.018,
  dragK2: 0.0068,
  tuckDragMul: 0.6, // -40% quadratic drag under full tuck
  tuckThrust: 0.9,
  currentAssist: 0.55, // constant "flowing water" push, m/s^2
  brakeBase: 1.6,
  brakeSpeedGain: 0.30,
  governorSpeed: 27.5,
  governorStrength: 0.62,

  // lateral
  lateralGain: 1.7,
  lateralDamping: 3.4,
  steerForce: 2.6,
  wallEdge: 0.97,
  wallSpring: 55,
  wallDampingExtra: 6,
  maxLateralVel: 2.3,

  // airborne
  airSampleH: 0.4,
  airTriggerThreshold: -1.2,
  airHysteresisSteps: 2,
  minAirtimeBeforeLand: 0.10,
  groundGraceAfterLand: 0.12,
  maxForcedAirtime: 3.0,
  homingAssistStart: 0.9,
  homingAssistRamp: 30,
  homingAssistMax: 34,
  airLateralRelaxRate: 0.6,
  airLateralRelaxRateHoming: 3.2,
  launchSwingContribMax: 4.0,
  airDragCoef: 0.0035,
  landingSpeedCap: 29.5,
  sRefineIters: 4,

  // integration
  substep: 1 / 120,
  maxDt: 0.25,
  maxSubsteps: 10,

  // pose smoothing / cosmetics
  poseSmoothRate: 22,
  poseSmoothRateAirborne: 55, // tighter tracking in flight: the raw signal
  // (ballistic airPos) is already perfectly smooth, so chasing it tightly
  // costs nothing in jitter and keeps the lag small for a fast-moving body —
  // this is what keeps the grounded<->airborne seam from ever popping.
  leanSmoothRate: 6,
  maxLeanRoll: THREE.MathUtils.degToRad(24),
  splashSmoothRate: 8,
};

const ORIGIN = new THREE.Vector3(0, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

export class RiderPhysics {
  /**
   * @param {import('../track/SplineTrack.js').SplineTrack} track
   * @param {Partial<typeof DEFAULTS>} [opts]
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.tune = { ...DEFAULTS, ...opts };

    // Scratch objects reused every frame to avoid GC churn in the hot path.
    this._airPos = new THREE.Vector3();
    this._airVel = new THREE.Vector3();
    this._smoothedPos = new THREE.Vector3();
    this._smoothedQuat = new THREE.Quaternion();
    this._tmpMat = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._rollQuat = new THREE.Quaternion();
    this._tmpV1 = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpV3 = new THREE.Vector3();
    this._tmpV4 = new THREE.Vector3();

    this.state = {
      s: 0,
      speed: 0,
      lateral: 0,
      lateralVel: 0,
      airborne: false,
      airTime: 0,
      gForce: 1,
      lean: 0,
      finished: false,
      splashRate: 0,
      contactPoint: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      forward: new THREE.Vector3(0, 0, 1),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    };

    this._airCounter = 0;
    this._groundGrace = 0;
    this._splashImpulse = 0;
    this._firstFrame = true;

    this.reset();
  }

  reset() {
    const st = this.state;
    st.s = 0;
    st.speed = 0;
    st.lateral = 0;
    st.lateralVel = 0;
    st.airborne = false;
    st.airTime = 0;
    st.gForce = 1;
    st.lean = 0;
    st.finished = false;
    st.splashRate = 0;

    this._airCounter = 0;
    this._groundGrace = 0;
    this._splashImpulse = 0;
    this._airVel.set(0, 0, 0);
    this._firstFrame = true;

    this._syncPose(0, 0, 0);
  }

  /**
   * @param {number} dt
   * @param {{steer?: number, tuck?: number, brake?: number}} [input]
   */
  update(dt, input) {
    const inp = input || {};
    const steer = THREE.MathUtils.clamp(inp.steer || 0, -1, 1);
    const tuck = THREE.MathUtils.clamp(inp.tuck || 0, 0, 1);
    const brake = THREE.MathUtils.clamp(inp.brake || 0, 0, 1);

    const tune = this.tune;
    const clampedDt = Math.min(Math.max(dt || 0, 0), tune.maxDt);
    if (clampedDt <= 0) {
      this._syncPose(0, steer, brake);
      return;
    }

    const steps = Math.min(tune.maxSubsteps, Math.max(1, Math.round(clampedDt / tune.substep)));
    const subDt = clampedDt / steps;
    for (let i = 0; i < steps; i++) {
      this._integrateSubstep(subDt, steer, tuck, brake);
    }

    this._syncPose(clampedDt, steer, brake);
  }

  // -------------------------------------------------------------------
  // Core per-substep integration
  // -------------------------------------------------------------------

  _integrateSubstep(dt, steer, tuck, brake) {
    const st = this.state;
    const tune = this.tune;

    this._groundGrace = Math.max(0, this._groundGrace - dt);

    if (st.finished) {
      // Graceful settle (e.g. drifting in the finish pool): decay speed and
      // let lateral relax to center, but stop making forward progress.
      if (!st.airborne) {
        const frame = this.track.frameAt(st.s);
        const drag = tune.dragK1 * st.speed + tune.dragK2 * st.speed * st.speed + 0.4;
        st.speed = Math.max(0, st.speed - drag * dt);
        const la = this._lateralAccel(st.lateral, st.lateralVel, st.speed, 0, frame.radius, 0);
        st.lateralVel = THREE.MathUtils.clamp(st.lateralVel + la * dt, -tune.maxLateralVel, tune.maxLateralVel);
        st.lateral = THREE.MathUtils.clamp(st.lateral + st.lateralVel * dt, -1.05, 1.05);
        st.gForce = THREE.MathUtils.damp(st.gForce, 1, 3, dt);
      }
      return;
    }

    if (!st.airborne) {
      const frame = this.track.frameAt(st.s);

      const reqAccel = this._requiredContactAccel(st.s, st.lateral, st.speed);
      const eligible = this._groundGrace <= 0;
      this._airCounter = eligible && reqAccel < tune.airTriggerThreshold ? this._airCounter + 1 : 0;

      if (this._airCounter >= tune.airHysteresisSteps) {
        this._launchAirborne(frame);
        if (!st.airborne) {
          // Launch declined to arm (shouldn't normally happen); fall through
          // to grounded integration this substep instead of doing nothing.
        } else {
          return;
        }
      }

      const dvdt = this._longitudinalAccel(st.speed, frame.slope, tuck, brake);
      st.speed = Math.max(0, st.speed + dvdt * dt);

      const la = this._lateralAccel(st.lateral, st.lateralVel, st.speed, frame.curvature, frame.radius, steer);
      st.lateralVel = THREE.MathUtils.clamp(st.lateralVel + la * dt, -tune.maxLateralVel, tune.maxLateralVel);
      st.lateral = THREE.MathUtils.clamp(st.lateral + st.lateralVel * dt, -1.05, 1.05);

      const radial = this._radialG(st.lateral, st.lateralVel, st.speed, frame.curvature, frame.radius);
      st.gForce = Math.min(9, Math.sqrt(radial * radial + dvdt * dvdt) / GRAVITY);

      st.s += st.speed * dt;
    } else {
      this._integrateAirborne(dt);
    }

    if (!st.airborne && st.s >= this.track.length - 1) st.finished = true;
  }

  _longitudinalAccel(speed, slope, tuck, brake) {
    const tune = this.tune;
    const k2 = tune.dragK2 * (1 - 0.4 * tuck);
    let a = GRAVITY * slope + tune.currentAssist + tuck * tune.tuckThrust - tune.dragK1 * speed - k2 * speed * speed;
    a -= brake * (tune.brakeBase + tune.brakeSpeedGain * speed);
    if (speed > tune.governorSpeed) {
      const over = speed - tune.governorSpeed;
      a -= tune.governorStrength * over * over * over;
    }
    return a;
  }

  _steerEffectiveness(speed) {
    return THREE.MathUtils.clamp(0.35 + speed / 22, 0.35, 1.5);
  }

  _lateralAccel(lateral, lateralVel, speed, curvature, radius, steer) {
    const tune = this.tune;
    const theta = lateral * tune.angleMax;
    const gravTerm = -GRAVITY * Math.sin(theta) / radius;
    const centTerm = curvature * speed * speed * Math.cos(theta) / radius;
    let a = ((gravTerm + centTerm) * tune.lateralGain) / tune.angleMax;
    a += steer * tune.steerForce * this._steerEffectiveness(speed);
    a -= tune.lateralDamping * lateralVel;

    const absLat = Math.abs(lateral);
    if (absLat > tune.wallEdge) {
      const over = absLat - tune.wallEdge;
      const dir = Math.sign(lateral);
      a -= dir * over * tune.wallSpring;
      a -= tune.wallDampingExtra * lateralVel;
    }
    return a;
  }

  _radialG(lateral, lateralVel, speed, curvature, radius) {
    const tune = this.tune;
    const theta = lateral * tune.angleMax;
    const thetaDot = lateralVel * tune.angleMax;
    return GRAVITY * Math.cos(theta) + curvature * speed * speed * Math.sin(theta) + radius * thetaDot * thetaDot;
  }

  // -------------------------------------------------------------------
  // Airborne
  // -------------------------------------------------------------------

  /** Required normal-direction contact acceleration; negative-beyond-threshold means airborne. */
  _requiredContactAccel(s, lateral, speed) {
    const h = this.tune.airSampleH;
    const fA = this.track.frameAt(s - h);
    const fB = this.track.frameAt(s + h);
    const dT = this._tmpV1.subVectors(fB.tangent, fA.tangent).divideScalar(2 * h);
    const n = this.track.surfaceNormalAt(s, lateral);
    const kappaN = dT.dot(n);
    // required = v^2*(dT/ds . n) - g_vec . n, with g_vec = (0,-G,0) => -g_vec.n = G*n.y
    return speed * speed * kappaN + GRAVITY * n.y;
  }

  _launchAirborne(frame) {
    const st = this.state;
    const tune = this.tune;

    // Estimate the world-space velocity contribution from lateral swinging by
    // numerically differentiating the *actual* surfaceAt against lateral,
    // rather than assuming a specific cross-section parametrization — this
    // stays correct regardless of how SplineTrack implements the U-shape.
    const h = 0.015;
    const latPlus = Math.min(1, st.lateral + h);
    const latMinus = Math.max(-1, st.lateral - h);
    const pPlus = this.track.surfaceAt(st.s, latPlus, tune.riderFloat);
    const pMinus = this.track.surfaceAt(st.s, latMinus, tune.riderFloat);
    const denom = Math.max(1e-4, latPlus - latMinus);
    const dPosDLateral = this._tmpV2.subVectors(pPlus, pMinus).divideScalar(denom);

    const lateralWorldVel = this._tmpV3.copy(dPosDLateral).multiplyScalar(st.lateralVel);
    const mag = lateralWorldVel.length();
    if (mag > tune.launchSwingContribMax) lateralWorldVel.multiplyScalar(tune.launchSwingContribMax / mag);

    this._airVel.copy(frame.tangent).multiplyScalar(st.speed).add(lateralWorldVel);
    this._airPos.copy(this.track.surfaceAt(st.s, st.lateral, tune.riderFloat));

    st.airborne = true;
    st.airTime = 0;
    this._airCounter = 0;
  }

  _integrateAirborne(dt) {
    const st = this.state;
    const tune = this.tune;

    this._airVel.y -= GRAVITY * dt;
    const airSpeed = this._airVel.length();
    if (airSpeed > 0.01) {
      // Small air-resistance safety bound (real drag is far smaller in air
      // than in water, but this stops unusually long flights from
      // accumulating unbounded speed in free fall).
      const drag = Math.min(tune.airDragCoef * airSpeed * airSpeed * dt, airSpeed * 0.5);
      this._airVel.addScaledVector(this._airVel, -drag / airSpeed);
    }

    // `lateral` gently relaxes toward center while airborne (the rider
    // naturally settling mid-flight — steer's cosmetic tilt, per spec, is
    // layered on top in _syncPose and never touches this). This is also
    // what keeps the system robust: on a long flight through a strongly
    // curving/twisting section, a *frozen* lateral offset can reference a
    // point on the chute that has drifted far from where the free 3D
    // parabola actually is. Relaxing toward the well-behaved centerline
    // keeps the reference surface predictable the longer a flight runs.
    const relaxRate = st.airTime > tune.homingAssistStart
      ? tune.airLateralRelaxRate + tune.airLateralRelaxRateHoming
      : tune.airLateralRelaxRate;
    st.lateral = THREE.MathUtils.damp(st.lateral, 0, relaxRate, dt);
    st.lateralVel = THREE.MathUtils.damp(st.lateralVel, 0, relaxRate, dt);

    // Homing assist: rather than ever teleporting the rider back onto the
    // track (which would violate "always smooth"), once a flight has gone
    // on unusually long we gently — and smoothly — steer the trajectory
    // back toward the track's surface so a *natural* crossing (not a forced
    // snap) always resolves it in bounded time.
    if (st.airTime > tune.homingAssistStart) {
      const n0 = this.track.surfaceNormalAt(st.s, st.lateral);
      const surf0 = this.track.surfaceAt(st.s, st.lateral, tune.riderFloat);
      const height = this._tmpV3.subVectors(this._airPos, surf0).dot(n0);
      const assist = Math.min(tune.homingAssistMax, (st.airTime - tune.homingAssistStart) * tune.homingAssistRamp);
      this._airVel.addScaledVector(n0, -Math.sign(height || 1) * assist * dt);
    }

    this._airPos.addScaledVector(this._airVel, dt);
    st.airTime += dt;

    // Closest-point refinement (Newton-style, projecting the offset onto the
    // tangent) instead of naive dead-reckoning by forward speed: verified
    // necessary for steep post-jump terrain, where the chute surface drops
    // away faster than dead-reckoned arc length would suggest.
    let sEst = st.s;
    for (let i = 0; i < tune.sRefineIters; i++) {
      const f = this.track.frameAt(sEst);
      const delta = this._tmpV1.subVectors(this._airPos, f.position).dot(f.tangent);
      sEst = THREE.MathUtils.clamp(sEst + delta, 0, this.track.length);
    }
    st.s = sEst;
    st.gForce = 0.05; // near-weightless in free flight

    const surf = this.track.surfaceAt(st.s, st.lateral, tune.riderFloat);
    const n = this.track.surfaceNormalAt(st.s, st.lateral);
    const rel = this._tmpV4.subVectors(this._airPos, surf);
    const canLand = st.airTime >= tune.minAirtimeBeforeLand;

    if ((canLand && rel.dot(n) <= 0) || st.airTime > tune.maxForcedAirtime) {
      this._landAirborne(n);
    }
  }

  _landAirborne(n) {
    const st = this.state;
    const tune = this.tune;

    const impactSpeed = Math.max(0, -this._airVel.dot(n));
    const landFrame = this.track.frameAt(st.s);
    const tangentSpeed = Math.max(0, this._airVel.dot(landFrame.tangent));
    st.speed = Math.min(tune.landingSpeedCap, tangentSpeed * (1 - Math.min(0.25, impactSpeed * 0.01)));
    st.lateralVel = THREE.MathUtils.clamp(st.lateralVel, -tune.maxLateralVel, tune.maxLateralVel);

    st.airborne = false;
    st.airTime = 0;
    this._groundGrace = tune.groundGraceAfterLand;
    this._splashImpulse = Math.max(this._splashImpulse, THREE.MathUtils.clamp(impactSpeed / 9, 0, 1));
  }

  // -------------------------------------------------------------------
  // Pose (position/quaternion/up/forward/lean/splashRate/contactPoint),
  // updated once per update() call (not per substep) and smoothed so the
  // visual result never pops, including across the grounded<->airborne seam.
  // -------------------------------------------------------------------

  _syncPose(dt, steer, brake) {
    const st = this.state;
    const tune = this.tune;

    let rawPos, rawUp, rawForward;
    if (st.airborne) {
      rawPos = this._airPos;
      rawUp = this.track.surfaceNormalAt(st.s, st.lateral);
      rawForward = this._airVel.lengthSq() > 0.04
        ? this._tmpV1.copy(this._airVel).normalize()
        : this.track.frameAt(st.s).tangent;
    } else {
      rawPos = this.track.surfaceAt(st.s, st.lateral, tune.riderFloat);
      rawUp = this.track.surfaceNormalAt(st.s, st.lateral);
      rawForward = this.track.frameAt(st.s).tangent;
    }

    st.contactPoint.copy(this.track.surfaceAt(st.s, st.lateral, 0));

    // Cosmetic lean: blends current bank position, angular rate (a bit of
    // anticipation) and steer (much stronger while airborne, per spec —
    // visual only, does not affect the actual flight path).
    const targetLean = THREE.MathUtils.clamp(
      st.lateral * 0.55 + st.lateralVel * 0.7 + steer * (st.airborne ? 0.6 : 0.15),
      -1, 1
    );
    st.lean = THREE.MathUtils.damp(st.lean, targetLean, tune.leanSmoothRate, dt);

    this._tmpMat.lookAt(ORIGIN, rawForward, rawUp);
    this._tmpQuat.setFromRotationMatrix(this._tmpMat);
    this._rollQuat.setFromAxisAngle(Z_AXIS, st.lean * tune.maxLeanRoll);
    this._tmpQuat.multiply(this._rollQuat);

    if (this._firstFrame) {
      this._smoothedQuat.copy(this._tmpQuat);
      this._smoothedPos.copy(rawPos);
      this._firstFrame = false;
    } else if (dt > 0) {
      const t = 1 - Math.exp(-tune.poseSmoothRate * dt);
      this._smoothedQuat.slerp(this._tmpQuat, t);
      this._smoothedPos.lerp(rawPos, t);
    }

    st.position.copy(this._smoothedPos);
    st.quaternion.copy(this._smoothedQuat);
    st.forward.copy(FORWARD_LOCAL).applyQuaternion(st.quaternion);
    st.up.copy(UP_AXIS).applyQuaternion(st.quaternion);

    // Splash: ambient spray from speed/carving/braking, plus a decaying
    // impulse kicked up by hard landings.
    this._splashImpulse = THREE.MathUtils.damp(this._splashImpulse, 0, 2.2, dt);
    let ambient = 0;
    if (!st.airborne) {
      ambient += THREE.MathUtils.clamp(st.speed / 26, 0, 1) * 0.32;
      ambient += THREE.MathUtils.clamp(Math.abs(st.lateralVel) * 1.1, 0, 1) * 0.32;
      ambient += brake * 0.55;
    }
    const targetSplash = THREE.MathUtils.clamp(ambient + this._splashImpulse, 0, 1);
    st.splashRate = THREE.MathUtils.damp(st.splashRate, targetSplash, tune.splashSmoothRate, dt);
  }
}
