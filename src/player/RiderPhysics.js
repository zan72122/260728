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
 *   The gravity term is NOT hardcoded assuming an unbanked, world-up-aligned
 *   cross-section: g is projected onto the frame's *actual* binormal/normal
 *   (gx = g_vec.binormal + curvature*v^2, gy = g_vec.normal; theta'' =
 *   (gx*cos(theta)+gy*sin(theta))/r), so a track that layers a static `bank`
 *   on top of the dynamic curvature — confirmed present in the real course,
 *   up to ~0.85 rad in the helix — is handled automatically and correctly.
 *   At bank=0 this reduces exactly to the formula above.
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
// at the fixed 1/120s step the game uses, first against a mock SplineTrack
// (constant and full-course slope/curvature profiles) and then against the
// real SplineTrack/TRACK_DESIGN once available. gForce 2-4G through the
// banked helix and tight corners, lateral tracks the analytic banked-turn
// equilibrium exactly and never diverges, no NaN/instability across 30-40-
// seed fuzz tests with randomized steer/tuck/brake on both the mock and the
// real track.
//
// Longitudinal band re-measured after the integration pass's speed-tuning
// fix (see the comment directly on the longitudinal block below): baseline
// (no input) ~50-56s covering ~12-20 m/s, full-tuck ~26-29s reaching
// ~22-27 m/s peak. Re-verified against the real course with the headless
// harness in the task notes (fixed-1/120s integration, no rendering).
// ---------------------------------------------------------------------------
const GRAVITY = 9.81;
const GRAVITY_VEC = new THREE.Vector3(0, -GRAVITY, 0);

const DEFAULTS = {
  angleMax: THREE.MathUtils.degToRad(84), // U-arc angle span mapped from lateral -1..1
  riderFloat: 0.35, // tube float height above the chute surface [m]

  // longitudinal
  //
  // INTEGRATION FIX (post-hoc, by the integration pass — see task notes):
  // the original tuning above this comment was validated to run 8-18.5 m/s
  // (no input) / 16-22.4 m/s (full tuck), which sits almost entirely below
  // the speed range PostFX/ChaseCamera/Hud map their speed-sensation FX
  // across (originally 8->30 m/s) — so the "fast/exhilarating" visual
  // feedback (radial blur, chromatic aberration, FOV stretch) barely ever
  // engaged during normal play. dragK1/dragK2 are lowered ~10%, currentAssist
  // (the constant "flowing water" push) is raised ~3x, and tuck is made a
  // much bigger lever (tuckDragMul/tuckThrust) so cruising is noticeably
  // brisk even with no input at all (measured: ~12 m/s avg / ~20 m/s peak),
  // and committing to tuck is a dramatic, rewarding speed boost (measured:
  // ~22 m/s avg / ~27 m/s peak) — comfortably inside the widened FX range
  // (see PostFX.js/ChaseCamera.js/Hud.js) without breaking the lateral/
  // airborne models (unaffected by this section) or the wall clamp.
  dragK1: 0.0315,
  dragK2: 0.00612,
  tuckDragMul: 0.26, // -74% quadratic drag under full tuck (was -40%)
  tuckThrust: 1.0,
  currentAssist: 0.37, // constant "flowing water" push, m/s^2 (was 0.12)
  brakeBase: 1.6,
  brakeSpeedGain: 0.30,
  governorSpeed: 29, // was 27.5 — raised so the natural drag/thrust balance
  governorStrength: 0.5, // (not this soft cap) sets the ~27-28 m/s peak

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
  // Homing is *deviation*-triggered, not time-triggered: a straight-ish
  // ballistic path inherently diverges from a tightly curving chute the
  // longer it's airborne (this was verified directly — going airborne for
  // ~1s in a ~15m-radius curve at high speed diverges >8m from the
  // centerline purely from geometry, nothing to do with search accuracy).
  // So instead of waiting on a clock, pull back in as soon as the rider
  // strays past a generous distance from the nearest track surface —
  // ordinary jumps (which stay close to the chute they launched from) never
  // reach this threshold and are completely unaffected.
  homingDeviationThreshold: 2.2,
  homingAssistRamp: 12,
  homingAssistMax: 40,
  airLateralRelaxRate: 0.6,
  airLateralRelaxRateHoming: 3.2,
  launchSwingContribMax: 4.0,
  airDragCoef: 0.0035,
  landingSpeedCap: 29.5,
  sRefineIters: 4,
  sRefineMaxStep: 2.5,

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

    // Non-contractual extras beyond the SPEC §4.3 state shape: a harmless
    // echo of the last input, so ChaseCamera (which only receives `physics`,
    // not raw input) can react to tuck for its FOV bonus. Any consumer that
    // only knows the documented fields is unaffected.
    this.state.tuck = tuck;
    this.state.steer = steer;
    this.state.brake = brake;

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
        const la = this._lateralAccel(st.lateral, st.lateralVel, st.speed, 0, frame.radius, 0, frame.binormal, frame.normal);
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
        return;
      }

      const dvdt = this._longitudinalAccel(st.speed, frame.slope, tuck, brake);
      st.speed = Math.max(0, st.speed + dvdt * dt);

      const la = this._lateralAccel(st.lateral, st.lateralVel, st.speed, frame.curvature, frame.radius, steer, frame.binormal, frame.normal);
      st.lateralVel = THREE.MathUtils.clamp(st.lateralVel + la * dt, -tune.maxLateralVel, tune.maxLateralVel);
      st.lateral = THREE.MathUtils.clamp(st.lateral + st.lateralVel * dt, -1.05, 1.05);

      const radial = this._radialG(st.lateral, st.lateralVel, st.speed, frame.curvature, frame.radius, frame.binormal, frame.normal);
      st.gForce = Math.min(9, Math.sqrt(radial * radial + dvdt * dvdt) / GRAVITY);

      st.s += st.speed * dt;
    } else {
      this._integrateAirborne(dt);
    }

    if (!st.airborne && st.s >= this.track.length - 1) st.finished = true;
  }

  _longitudinalAccel(speed, slope, tuck, brake) {
    const tune = this.tune;
    const k2 = tune.dragK2 * (1 - (1 - tune.tuckDragMul) * tuck);
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

  /**
   * `theta = lateral*angleMax` treated as a pendulum on the cross-section
   * arc (radius), whose pivot is itself pushed sideways by the track's
   * curvature — see the file-level derivation. Gravity's contribution is
   * NOT hardcoded assuming an unbanked, world-up-aligned cross-section: it's
   * projected onto the frame's *actual* (already bank-rotated, per
   * SplineTrack) binormal/normal, so a track that layers a static `bank` on
   * top of the dynamic curvature — as the real helix does, up to ~0.85 rad —
   * is handled automatically and correctly, with no separate bank term
   * needed. At bank=0 this reduces exactly to the textbook
   * -g*sin(theta)/r + curvature*v^2*cos(theta)/r.
   */
  _lateralAccel(lateral, lateralVel, speed, curvature, radius, steer, binormal, normal) {
    const tune = this.tune;
    const theta = lateral * tune.angleMax;
    const gx = GRAVITY_VEC.dot(binormal) + curvature * speed * speed;
    const gy = GRAVITY_VEC.dot(normal);
    let a = ((gx * Math.cos(theta) + gy * Math.sin(theta)) * tune.lateralGain) / (tune.angleMax * radius);
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

  /** Same bank-aware gravity projection as _lateralAccel, for the "how hard pressed into the tube" display quantity. */
  _radialG(lateral, lateralVel, speed, curvature, radius, binormal, normal) {
    const tune = this.tune;
    const theta = lateral * tune.angleMax;
    const thetaDot = lateralVel * tune.angleMax;
    const gx = GRAVITY_VEC.dot(binormal) + curvature * speed * speed;
    const gy = GRAVITY_VEC.dot(normal);
    return gx * Math.sin(theta) - gy * Math.cos(theta) + radius * thetaDot * thetaDot;
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

    // Deviation-triggered homing (measured against last frame's closest-point
    // estimate, accurate to within one frame of motion). This is NOT a
    // clock: a straight-ish ballistic path inherently and legitimately
    // diverges from a tightly curving chute the longer it's airborne (a
    // ~15m-radius turn at 25 m/s can leave you 8+ m from the centerline
    // after just one second — verified directly, not a search bug). Rather
    // than ever teleporting the rider back onto the track once a flight
    // goes on too long (which would violate "always smooth"), we pull the
    // trajectory itself back in as soon as it strays past a generous
    // distance from the nearest surface — ordinary jumps, which stay close
    // to the chute they launched from, never reach this threshold and are
    // completely unaffected.
    const n0 = this.track.surfaceNormalAt(st.s, st.lateral);
    const surf0 = this.track.surfaceAt(st.s, st.lateral, tune.riderFloat);
    const deviation = this._tmpV3.subVectors(this._airPos, surf0);
    const devLen = deviation.length();
    const homing = devLen > tune.homingDeviationThreshold;

    // `lateral` gently relaxes toward center while airborne (the rider
    // naturally settling mid-flight — steer's cosmetic tilt, per spec, is
    // layered on top in _syncPose and never touches this). Relaxing toward
    // the well-behaved centerline also keeps the reference surface used
    // above predictable, and relaxes faster once homing is active.
    const relaxRate = homing ? tune.airLateralRelaxRate + tune.airLateralRelaxRateHoming : tune.airLateralRelaxRate;
    st.lateral = THREE.MathUtils.damp(st.lateral, 0, relaxRate, dt);
    st.lateralVel = THREE.MathUtils.damp(st.lateralVel, 0, relaxRate, dt);

    if (homing && devLen > 1e-4) {
      const excess = devLen - tune.homingDeviationThreshold;
      const assist = Math.min(tune.homingAssistMax, excess * tune.homingAssistRamp);
      // Pull directly toward the nearest surface point (not just along its
      // normal) — in a tight curve the deviation is mostly sideways, not
      // just "too high".
      this._airVel.addScaledVector(deviation, (-assist * dt) / devLen);
    }

    this._airPos.addScaledVector(this._airVel, dt);
    st.airTime += dt;

    // Closest-point refinement (Newton-style, projecting the offset onto the
    // tangent) instead of naive dead-reckoning by forward speed: verified
    // necessary for steep post-jump terrain, where the chute surface drops
    // away faster than dead-reckoned arc length would suggest. Each step is
    // clamped so a strongly curving/twisting section (where the projection
    // can have more than one near-root) can't make the search leap to a
    // distant, unrelated point in one jump — it stays a *local* refinement.
    let sEst = st.s;
    for (let i = 0; i < tune.sRefineIters; i++) {
      const f = this.track.frameAt(sEst);
      const delta = THREE.MathUtils.clamp(
        this._tmpV1.subVectors(this._airPos, f.position).dot(f.tangent),
        -tune.sRefineMaxStep, tune.sRefineMaxStep
      );
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
      // Track tightly while airborne (and briefly after landing, while the
      // grace window is active): the raw target is a perfectly smooth
      // ballistic path with no jitter risk, so a tighter rate here only
      // shrinks the lag behind a fast-moving body — it's what keeps the
      // grounded<->airborne seam visually seamless.
      const rate = st.airborne || this._groundGrace > 0 ? tune.poseSmoothRateAirborne : tune.poseSmoothRate;
      const t = 1 - Math.exp(-rate * dt);
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
