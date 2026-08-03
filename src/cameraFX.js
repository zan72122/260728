// Camera & post-impact camera choreography. See docs/CONTRACTS.md
// (section "src/cameraFX.js + src/audio.js — I") and docs/CONTRACTS-RABBIT.md
// (section "src/cameraFX.js — S2"). No orbit controls, no child input — the
// camera is entirely automatic, driven by an explicit VIEW MODE that
// GameFlow commands: idle | followFlight | splashView | returning.
//
// Why modes exist (bug this rework fixes): the old camera had ONE implicit
// "focus point" (setFocus) that ANYTHING could nudge every frame, including
// stale held-toy targets. After a high-platform drop this let the
// held-toy focus steal the camera back toward the tower mid-splash. Now
// setFocus is honored ONLY in 'idle' mode — it is structurally impossible
// for it to affect followFlight/splashView/returning, because those modes
// compute their own camera pose every frame from their own inputs and never
// read the setFocus point at all.
import * as THREE from 'three';
import { PLATFORMS } from './constants.js';

// ---- small math helpers (no allocation) --------------------------------
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
function easeOutCubic(t) {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}
function easeInOutCubic(t) {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

// Critically-damped spring-smoothing of a single scalar, applied in place to
// `obj[key]` with persistent velocity stored in `velObj[velKey]`. Standard
// "SmoothDamp" formulation (frame-rate independent, never overshoots — the
// definition of critically damped): given enough time it always reaches the
// target smoothly, and it can never overshoot the target and swing back
// (that's what makes it "critical" rather than under/over-damped). No
// allocation: reads/writes plain numeric fields only.
function smoothDampAxis(obj, key, velObj, velKey, targetVal, smoothTime, dt) {
  const t = Math.max(smoothTime, 0.0001);
  const omega = 2 / t;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const current = obj[key];
  const change = current - targetVal;
  const originalTo = targetVal;
  const temp = (velObj[velKey] + omega * change) * dt;
  velObj[velKey] = (velObj[velKey] - omega * temp) * exp;
  let output = originalTo + (change + temp) * exp;
  // Prevent the rare overshoot case (large dt spikes) from reversing past
  // the target — keeps the spring truly critically damped under all dt.
  if (originalTo - current > 0 === output > originalTo) {
    output = originalTo;
    velObj[velKey] = (output - originalTo) / Math.max(dt, 0.0001);
  }
  obj[key] = output;
}
function smoothDampVec3(vec, velVec, target, smoothTime, dt) {
  smoothDampAxis(vec, 'x', velVec, 'x', target.x, smoothTime, dt);
  smoothDampAxis(vec, 'y', velVec, 'y', target.y, smoothTime, dt);
  smoothDampAxis(vec, 'z', velVec, 'z', target.z, smoothTime, dt);
}

// Fixed 3/4 azimuth offset (around the pool, toward +Z) applied to the
// default camera position in BOTH framings. The diving boards' long axis
// runs along world X (see scene.js), so a camera sitting right on the +X
// axis sees them end-on (reads as a short pad). Swinging the camera this
// many degrees off the +X axis — while still looking back toward the
// tower/pool center — puts the boards in 3/4 perspective with their full
// length visible, without disturbing framing (pool + all 3 boards still
// fit) or any slow-mo/dip/shake behavior below. All view modes (idle,
// followFlight, splashView) share this same azimuth so the camera never
// feels like it "jumps around" the pool between modes.
const CAMERA_AZIMUTH_DEG = 25;
const CAMERA_AZIMUTH_RAD = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
const COS_AZ = Math.cos(CAMERA_AZIMUTH_RAD);
const SIN_AZ = Math.sin(CAMERA_AZIMUTH_RAD);

// Rotate a base (x, z) camera offset onto the fixed azimuth, keeping its
// original distance from the pool center (y untouched by caller). Only used
// from handleResize (infrequent) — per-frame mode code below uses the
// module-level COS_AZ/SIN_AZ constants directly to avoid allocating a
// fresh object every frame.
function withAzimuth(x, z) {
  const r = Math.hypot(x, z);
  return { x: r * Math.cos(CAMERA_AZIMUTH_RAD), z: r * Math.sin(CAMERA_AZIMUTH_RAD) };
}

// Impact timeline constants (seconds / timeScale units). Unchanged from the
// pre-rework version — GameFlow/rabbit never touch these.
const HITSTOP_DUR = 0.07;
const HITSTOP_SCALE = 0.02;
const SLOWMO_SCALE = 0.22;
const SLOWMO_BASE_DUR = 1.1;
const SLOWMO_ENERGY_BONUS = 0.3;
const RECOVER_DUR = 0.5;
const DIP_WINDOW = 0.6;
const DIP_RAMP = 0.15;

// The platform the pre-rework hardcoded framing numbers were tuned for
// (rabbit.js starts on 'mid' too, see docs/CONTRACTS-RABBIT.md) — used as
// the zero point for the idle-framing height adjustment below, so that
// setIdleView(midTip) reproduces the exact original framing bit-for-bit.
const MID_PLATFORM = PLATFORMS.find((p) => p.id === 'mid') || PLATFORMS[1];
const MID_TIP_Y = MID_PLATFORM.height;

// ---- view-mode tuning ----------------------------------------------------
const IDLE_SMOOTH_TIME = 0.9; // gentle reframe when the idle tip changes
const IDLE_HEIGHT_POS_K = 0.28; // camera-Y follows platform height, softened
const IDLE_HEIGHT_LOOK_K = 0.3; // look-at-Y follows platform height, softened

// followFlight: camera eases from a wide dramatic overview down to a good
// splash vantage as the toy falls. Distances/heights chosen so the END
// state (u=1, toy at the water) already sits inside splashView's own
// framing numbers, so the followFlight -> splashView handoff is seamless.
const FOLLOW_DIST_START = 6.0;
const FOLLOW_DIST_END = 3.4;
const FOLLOW_Y_START = 4.2;
const FOLLOW_Y_END = 1.6;
const FOLLOW_PIVOT_W_START = 0.25; // camera pivot: weight toward landing pt
const FOLLOW_PIVOT_W_END = 0.85;
const FOLLOW_LOOK_W_START = 0.35; // look-at: weight toward landing pt
const FOLLOW_LOOK_W_END = 0.85;
const FOLLOW_SMOOTH_TIME = 0.35; // critically damped, real dt driven

// splashView: locked-on framing, full splash column (crown base to ~2.5m)
// kept in frame in both orientations; slight orbital sway/breathing "for
// life" (small enough it never lets the point drift out of frame).
const SPLASH_DIST = 3.5;
const SPLASH_Y = 1.7;
const SPLASH_SMOOTH_TIME = 0.35; // settle-in speed when splashView begins
const SPLASH_SWAY_ANG = 0.07; // rad, orbital drift amplitude
const SPLASH_SWAY_ANG_SPEED = 0.22;
const SPLASH_SWAY_RADIUS = 0.15; // gentle dolly breathing
const SPLASH_SWAY_RADIUS_SPEED = 0.33;
const SPLASH_LOOK_HEADROOM_LAND = 0.45; // look-at above the point: landscape
const SPLASH_LOOK_HEADROOM_PORT = 1.1; // ...and portrait (lower-center third)

// returnToTower: fixed ~1.0s real-time eased pan/dolly back to idle framing.
const RETURN_DUR = 1.0;

export class CameraFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);

    // main reads this every frame to scale dt for every other module.
    this.timeScale = 1;
    // exposed for main to optionally read; the underwater tint is fully
    // owned & rendered by this class regardless.
    this.underwaterAmount = 0;

    // ---- view mode state -------------------------------------------------
    // 'idle' | 'followFlight' | 'splashView' | 'returning'
    this._mode = 'idle';

    // ---- pre-allocated vectors reused every frame (no per-frame alloc) --
    this._basePos = new THREE.Vector3();
    this._baseLookAt = new THREE.Vector3();
    this._focusPoint = new THREE.Vector3();
    this._focusSmoothed = new THREE.Vector3();
    this._swayVec = new THREE.Vector3();
    this._composedPos = new THREE.Vector3();
    this._composedLookAt = new THREE.Vector3();
    this._dollyPos = new THREE.Vector3();
    this._dipCamPos = new THREE.Vector3();
    this._dipLookAt = new THREE.Vector3();
    this._finalPos = new THREE.Vector3();
    this._finalLookAt = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();
    this._impactPoint = new THREE.Vector3();

    // Idle-view (setIdleView) state: current platform tip target, the raw
    // (unsmoothed) desired framing recomputed every frame, and the spring
    // velocities that ease _basePos/_baseLookAt toward it.
    this._idleTip = new THREE.Vector3(
      MID_PLATFORM.tip.x,
      MID_PLATFORM.tip.y,
      MID_PLATFORM.tip.z
    );
    this._idleRawPos = new THREE.Vector3();
    this._idleRawLookAt = new THREE.Vector3();
    this._idleVelPos = new THREE.Vector3();
    this._idleVelLookAt = new THREE.Vector3();

    // followFlight state.
    this._followGetPos = null;
    this._followInitialized = false;
    this._followStartY = 1;
    this._followCamPos = new THREE.Vector3();
    this._followVelPos = new THREE.Vector3();
    this._followLookAt = new THREE.Vector3();
    this._followVelLookAt = new THREE.Vector3();
    this._followLanding = new THREE.Vector3();
    this._followPivot = new THREE.Vector3();
    this._followDesiredPos = new THREE.Vector3();
    this._followDesiredLookAt = new THREE.Vector3();

    // splashView state.
    this._splashPoint = new THREE.Vector3();
    this._splashInitialized = false;
    this._splashElapsed = 0;
    this._splashCamPos = new THREE.Vector3();
    this._splashVelPos = new THREE.Vector3();
    this._splashLookAt = new THREE.Vector3();
    this._splashVelLookAt = new THREE.Vector3();
    this._splashDesiredPos = new THREE.Vector3();
    this._splashDesiredLookAt = new THREE.Vector3();

    // returnToTower state.
    this._returnStartPos = new THREE.Vector3();
    this._returnStartLookAt = new THREE.Vector3();
    this._returnTargetPos = new THREE.Vector3();
    this._returnTargetLookAt = new THREE.Vector3();
    this._returnTimer = 0;
    this._returnFired = false;
    this._returnOnDone = null;

    // Last look-at actually applied to the camera, tracked every frame so
    // any mode transition can start its blend/spring from where the camera
    // truly is right now instead of a stale value — this is what makes
    // "mode transitions always smooth, never teleport" hold structurally.
    this._lastLookAt = new THREE.Vector3();

    this._focusInitialized = false;
    this._portraitAmount = 0;
    this._land = null;
    this._port = null;

    // impact timeline state
    this._phase = 'idle'; // 'idle' | 'hitstop' | 'slowmo' | 'recover'
    this._phaseTimer = 0;
    this._slowmoDur = SLOWMO_BASE_DUR;
    this._underwaterEligible = false;
    this._dollyAmount = 0;
    this._dipAmount = 0;

    // shake state
    this._shakeTimer = 999;
    this._shakeDuration = 0.22;
    this._shakeMag = 0;
    this._shakeDirX = 1;
    this._shakeDirY = 1;

    // Underwater tint: a fullscreen DOM overlay this module owns entirely.
    this._tintEl = null;
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.background =
        'linear-gradient(rgba(30,90,190,0.9), rgba(10,50,140,0.95))';
      el.style.opacity = '0';
      el.style.zIndex = '40';
      el.style.mixBlendMode = 'normal';
      document.body.appendChild(el);
      this._tintEl = el;
    }

    // Initialize framing from current renderer size.
    let w = 1280;
    let h = 720;
    if (renderer && renderer.domElement) {
      w = renderer.domElement.clientWidth || renderer.domElement.width || w;
      h = renderer.domElement.clientHeight || renderer.domElement.height || h;
    }
    this.handleResize(w, h);
    this._lastLookAt.copy(this._baseLookAt);
  }

  // -------------------------------------------------------------------
  handleResize(w, h) {
    const aspect = h > 0 ? w / h : 16 / 9;
    this.camera.aspect = aspect;

    // Continuous portrait<->landscape blend (no hard branch = no pop).
    const landscapeEdge = 1.5;
    const portraitEdge = 0.6;
    const t = clamp01((landscapeEdge - aspect) / (landscapeEdge - portraitEdge));
    const a = smoothstep(t);
    this._portraitAmount = a;

    // Landscape: closer, cinematic, 3/4 angle from +X (see CAMERA_AZIMUTH_DEG).
    const lpAz = withAzimuth(9.0, 3.0);
    this._land = { x: lpAz.x, y: 3.8, z: lpAz.z, fov: 44, lx: -1.0, ly: 1.6, lz: 0 };
    // Portrait: pulled back & higher/steeper so tower + pool both fit and
    // the water surface fills the lower ~2/3 of the frame; same fixed azimuth.
    const ppAz = withAzimuth(10.5, 1.8);
    this._port = { x: ppAz.x, y: 7.6, z: ppAz.z, fov: 60, lx: -1.3, ly: 0.4, lz: 0 };

    this.camera.fov = lerp(this._land.fov, this._port.fov, a);
    this.camera.updateProjectionMatrix();

    // Seed/snap the idle target immediately (matches the pre-rework
    // behavior of resizing the framing right away on orientation change).
    // This only affects on-screen output while _mode === 'idle'; it never
    // yanks the camera mid-followFlight/splashView/return.
    this._computeIdleRaw(this._idleTip, this._basePos, this._baseLookAt);

    if (!this._focusInitialized) {
      this._focusPoint.copy(this._baseLookAt);
      this._focusSmoothed.copy(this._baseLookAt);
      this._focusInitialized = true;
    }
  }

  // Raw (unsmoothed) idle framing for a given platform tip: blends the
  // landscape/portrait framings by _portraitAmount (aspect), then adjusts
  // camera-Y/look-at-Y by the tip's height delta from the 'mid' platform
  // (the platform the original hardcoded numbers were tuned for) so low/
  // high platforms reframe gently instead of reusing 'mid' framing for
  // every height. Writes into the given (reused) output vectors — no
  // allocation, safe to call every frame.
  _computeIdleRaw(tipPos, outPos, outLookAt) {
    const land = this._land;
    const port = this._port;
    const a = this._portraitAmount;
    const baseX = lerp(land.x, port.x, a);
    const baseY = lerp(land.y, port.y, a);
    const baseZ = lerp(land.z, port.z, a);
    const lookX = lerp(land.lx, port.lx, a);
    const lookY = lerp(land.ly, port.ly, a);
    const lookZ = lerp(land.lz, port.lz, a);
    const deltaH = tipPos.y - MID_TIP_Y;
    outPos.set(baseX, baseY + deltaH * IDLE_HEIGHT_POS_K, baseZ);
    outLookAt.set(lookX, lookY + deltaH * IDLE_HEIGHT_LOOK_K, lookZ);
  }

  // -------------------------------------------------------------------
  // View mode API (docs/CONTRACTS-RABBIT.md "src/cameraFX.js — S2").
  // -------------------------------------------------------------------

  // Default mode: frame the current platform tip + pool. Gentle reframe,
  // never a snap even if called mid-flight/splash (falls back to seeding
  // the idle spring from wherever the camera currently is).
  setIdleView(tipPos) {
    if (!tipPos) return;
    if (this._mode !== 'idle') {
      // Coming from another mode without going through returnToTower —
      // seed the idle spring from the camera's actual current pose so the
      // very next frame doesn't jump.
      this._basePos.copy(this.camera.position);
      this._baseLookAt.copy(this._lastLookAt);
      this._idleVelPos.set(0, 0, 0);
      this._idleVelLookAt.set(0, 0, 0);
      this._focusPoint.copy(this._baseLookAt);
      this._focusSmoothed.copy(this._baseLookAt);
    }
    this._idleTip.set(tipPos.x, tipPos.y, tipPos.z);
    this._mode = 'idle';
  }

  // Track the falling toy: called every frame while active. getPos() must
  // return the toy's current world position (a live reference is fine —
  // read fresh each frame, never cached).
  followFlight(getPos) {
    if (typeof getPos !== 'function') return;
    this._followGetPos = getPos;
    this._followInitialized = false; // seed spring from current cam next update()
    this._mode = 'followFlight';
  }

  // Lock the camera on the impact point through the full splash sequence.
  // Composes with the existing slow-mo/dip; ignores setFocus and any other
  // target until the mode changes. Calling again while already active
  // (secondary impact) just smoothly re-targets rather than re-seeding —
  // no snap.
  splashView(point) {
    if (!point) return;
    const wasActive = this._mode === 'splashView';
    this._splashPoint.set(point.x, point.y, point.z);
    if (!wasActive) {
      this._splashInitialized = false;
      this._splashElapsed = 0;
    }
    this._mode = 'splashView';
  }

  // ~1.0s real-time eased pan/dolly back to the idle framing of the given
  // tip; onDone() fires exactly once, at arrival, then mode becomes idle.
  returnToTower(tipPos, onDone) {
    const cb = typeof onDone === 'function' ? onDone : null;
    if (!tipPos) {
      if (cb) cb();
      return;
    }
    this._returnStartPos.copy(this.camera.position);
    this._returnStartLookAt.copy(this._lastLookAt);
    this._idleTip.set(tipPos.x, tipPos.y, tipPos.z);
    this._computeIdleRaw(this._idleTip, this._returnTargetPos, this._returnTargetLookAt);
    this._returnTimer = 0;
    this._returnFired = false;
    this._returnOnDone = cb;
    this._mode = 'returning';
  }

  // -------------------------------------------------------------------
  // Smooth spring-follow aim point (held/flying toy), for idle framing
  // only. Explicitly a no-op outside 'idle' — this is the fix for the
  // "held-toy focus stole the camera during the splash" bug: it is now
  // structurally impossible for setFocus to influence followFlight/
  // splashView/returning, because those modes never read _focusPoint.
  setFocus(point) {
    if (!point) return;
    if (this._mode !== 'idle') return;
    this._focusPoint.set(point.x, point.y, point.z);
  }

  // -------------------------------------------------------------------
  // onImpact still ONLY drives time effects (hit-stop/slow-mo/recover,
  // shake, dip envelope). It must NOT change the view mode — GameFlow
  // calls splashView(spec.point) itself. If splashView is never called
  // (legacy path, e.g. a standalone test or __lab.drop with no GameFlow
  // wired) the camera simply stays in 'idle' mode, whose per-frame
  // composition below reproduces the exact pre-rework dolly/dip/shake
  // behavior — graceful degradation, not a special case.
  onImpact(spec) {
    try {
      if (!spec || !spec.point) return;
      this._impactPoint.set(spec.point.x, spec.point.y, spec.point.z);
      const energy = clamp01(spec.energy || 0);
      this._underwaterEligible = energy > 0.45;
      this._slowmoDur = SLOWMO_BASE_DUR + (energy > 0.7 ? SLOWMO_ENERGY_BONUS : 0);
      this._phase = 'hitstop';
      this._phaseTimer = 0;

      if (energy > 0.6) {
        this._shakeTimer = 0;
        this._shakeMag = lerp(0.018, 0.032, clamp01((energy - 0.6) / 0.4));
        this._shakeDirX = Math.random() < 0.5 ? -1 : 1;
        this._shakeDirY = Math.random() < 0.5 ? -1 : 1;
      }
    } catch (e) {
      // camera choreography must never crash the game
    }
  }

  // -------------------------------------------------------------------
  _advanceTimeline(dtReal) {
    if (this._phase === 'idle') {
      this.timeScale = 1;
      this._dollyAmount = 0;
      this._dipAmount = 0;
      this.underwaterAmount = 0;
      return;
    }

    this._phaseTimer += dtReal;

    if (this._phase === 'hitstop') {
      this.timeScale = HITSTOP_SCALE;
      this._dollyAmount = smoothstep(this._phaseTimer / HITSTOP_DUR);
      this._dipAmount = 0;
      if (this._phaseTimer >= HITSTOP_DUR) {
        this._phase = 'slowmo';
        this._phaseTimer = 0;
      }
    } else if (this._phase === 'slowmo') {
      this.timeScale = SLOWMO_SCALE;
      this._dollyAmount = 1;
      this._dipAmount = this._underwaterEligible
        ? this._computeDipEnvelope(this._phaseTimer, this._slowmoDur)
        : 0;
      if (this._phaseTimer >= this._slowmoDur) {
        this._phase = 'recover';
        this._phaseTimer = 0;
      }
    } else if (this._phase === 'recover') {
      const t = clamp01(this._phaseTimer / RECOVER_DUR);
      this.timeScale = lerp(SLOWMO_SCALE, 1, easeOutCubic(t));
      this._dollyAmount = 1 - easeInOutCubic(t);
      this._dipAmount = 0;
      if (this._phaseTimer >= RECOVER_DUR) {
        this._phase = 'idle';
        this._phaseTimer = 0;
        this.timeScale = 1;
        this._dollyAmount = 0;
      }
    }

    this.underwaterAmount = this._dipAmount;
  }

  // Dip envelope: ramps in, holds, ramps out across the middle ~0.6s of
  // the slow-mo window — a quick, smooth "dive" through the surface.
  _computeDipEnvelope(t, slowmoDur) {
    const dipWindow = Math.min(DIP_WINDOW, slowmoDur * 0.5);
    const dipStart = Math.max(0, (slowmoDur - dipWindow) / 2);
    const dipEnd = dipStart + dipWindow;
    if (t < dipStart) return 0;
    if (t < dipStart + DIP_RAMP) return smoothstep((t - dipStart) / DIP_RAMP);
    if (t < dipEnd - DIP_RAMP) return 1;
    if (t < dipEnd) return 1 - smoothstep((t - (dipEnd - DIP_RAMP)) / DIP_RAMP);
    return 0;
  }

  _updateShake(dtReal) {
    if (this._shakeTimer >= this._shakeDuration) {
      this._shakeOffset.set(0, 0, 0);
      return;
    }
    this._shakeTimer += dtReal;
    const t = this._shakeTimer / this._shakeDuration;
    const decay = 1 - t;
    const wobble = Math.sin(this._shakeTimer * 42) * this._shakeMag * decay;
    this._shakeOffset.set(wobble * this._shakeDirX, wobble * this._shakeDirY * 0.6, 0);
  }

  // -------------------------------------------------------------------
  // Per-mode camera composition. Each branch computes the camera's final
  // position/look-at into this._finalPos/this._finalLookAt, applies shake,
  // and updates this._lastLookAt (so the next mode transition can start
  // smoothly from here).
  // -------------------------------------------------------------------

  _updateIdle(dtReal) {
    // Ease _basePos/_baseLookAt toward the current idle tip's raw framing
    // (only actually moves when the idle tip changed, e.g. a board tap).
    this._computeIdleRaw(this._idleTip, this._idleRawPos, this._idleRawLookAt);
    smoothDampVec3(this._basePos, this._idleVelPos, this._idleRawPos, IDLE_SMOOTH_TIME, dtReal);
    smoothDampVec3(this._baseLookAt, this._idleVelLookAt, this._idleRawLookAt, IDLE_SMOOTH_TIME, dtReal);

    // ---- legacy composition (pre-rework behavior, unchanged in spirit) --
    // Spring-follow the setFocus point (gentle, framerate independent).
    const focusAlpha = 1 - Math.exp(-2.2 * dtReal);
    this._focusSmoothed.lerp(this._focusPoint, focusAlpha);

    // Subtle position sway toward the action.
    this._swayVec.set(
      (this._focusSmoothed.x - this._baseLookAt.x) * 0.12,
      (this._focusSmoothed.y - this._baseLookAt.y) * 0.05,
      (this._focusSmoothed.z - this._baseLookAt.z) * 0.12
    );

    // Dolly target: ~25% of the way toward the impact point.
    this._dollyPos.set(
      lerp(this._basePos.x, this._impactPoint.x, 0.25),
      lerp(this._basePos.y, Math.max(this._impactPoint.y, 0.6), 0.12),
      lerp(this._basePos.z, this._impactPoint.z, 0.25)
    );

    this._composedPos.set(
      this._basePos.x + this._swayVec.x,
      this._basePos.y + this._swayVec.y,
      this._basePos.z + this._swayVec.z
    );
    this._composedPos.lerp(this._dollyPos, this._dollyAmount);

    // Underwater dip: quick, smooth dive to look into the cavity. Only
    // meaningful here (legacy/no-mode path) and in splashView — see
    // _updateSplash for the modal version.
    const amt = this._dipAmount;
    this._dipCamPos.set(this._impactPoint.x + 0.9, -0.5, this._impactPoint.z + 0.9);
    this._dipLookAt.set(this._impactPoint.x, -0.9, this._impactPoint.z);

    this._finalPos.copy(this._composedPos).lerp(this._dipCamPos, amt);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;

    this.camera.position.copy(this._finalPos);

    this._composedLookAt.copy(this._baseLookAt).lerp(this._focusSmoothed, 0.5);
    this._finalLookAt.copy(this._composedLookAt).lerp(this._dipLookAt, amt);
    this.camera.lookAt(this._finalLookAt);
    this._lastLookAt.copy(this._finalLookAt);

    this._setTint(amt);
  }

  _updateFollowFlight(dtReal) {
    const p = this._followGetPos ? this._followGetPos() : null;
    if (!p) {
      // Degrade gracefully: hold the last known camera pose rather than
      // crashing or snapping anywhere.
      this._setTint(0);
      return;
    }

    if (!this._followInitialized) {
      this._followInitialized = true;
      this._followStartY = Math.max(p.y, 0.5);
      // Seed the spring from wherever the camera currently is so entering
      // this mode from idle never teleports.
      this._followCamPos.copy(this.camera.position);
      this._followVelPos.set(0, 0, 0);
      this._followLookAt.copy(this._lastLookAt);
      this._followVelLookAt.set(0, 0, 0);
    }

    // Progress 0 (release) -> 1 (at the water). Works from any platform
    // height: a high-platform drop simply takes longer real time to reach
    // u=1, which is exactly what makes it "the longest, most dramatic
    // follow" — no special-casing per platform needed.
    const u = clamp01(1 - p.y / this._followStartY);
    const eu = easeInOutCubic(u);

    this._followLanding.set(p.x, 0, p.z);

    const pivotW = lerp(FOLLOW_PIVOT_W_START, FOLLOW_PIVOT_W_END, eu);
    this._followPivot.set(
      lerp(p.x, this._followLanding.x, pivotW),
      0,
      lerp(p.z, this._followLanding.z, pivotW)
    );

    const dist = lerp(FOLLOW_DIST_START, FOLLOW_DIST_END, eu);
    const camY = lerp(FOLLOW_Y_START, FOLLOW_Y_END, eu);
    this._followDesiredPos.set(
      this._followPivot.x + dist * COS_AZ,
      camY,
      this._followPivot.z + dist * SIN_AZ
    );

    // Blend look-at between the toy itself and its projected landing point
    // — keeps BOTH in frame throughout, shifting weight to the landing
    // point as the toy nears the water.
    const lookW = lerp(FOLLOW_LOOK_W_START, FOLLOW_LOOK_W_END, eu);
    this._followDesiredLookAt.set(
      lerp(p.x, this._followLanding.x, lookW),
      lerp(p.y, 0, lookW),
      lerp(p.z, this._followLanding.z, lookW)
    );

    // Critically damped spring, REAL dt — keeps moving even during
    // hit-stop/slow-mo (which only scales dtScaled fed to other modules).
    smoothDampVec3(this._followCamPos, this._followVelPos, this._followDesiredPos, FOLLOW_SMOOTH_TIME, dtReal);
    smoothDampVec3(this._followLookAt, this._followVelLookAt, this._followDesiredLookAt, FOLLOW_SMOOTH_TIME, dtReal);

    this._finalPos.copy(this._followCamPos);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;
    this.camera.position.copy(this._finalPos);
    this.camera.lookAt(this._followLookAt);
    this._lastLookAt.copy(this._followLookAt);

    this._setTint(0);
  }

  _updateSplashView(dtReal) {
    if (!this._splashInitialized) {
      this._splashInitialized = true;
      this._splashElapsed = 0;
      // Seed from the camera's actual current pose (usually mid-followFlight
      // ending near the same numbers) so the lock-on eases in, no snap.
      this._splashCamPos.copy(this.camera.position);
      this._splashVelPos.set(0, 0, 0);
      this._splashLookAt.copy(this._lastLookAt);
      this._splashVelLookAt.set(0, 0, 0);
    }
    this._splashElapsed += dtReal;

    // Slow orbital sway + gentle radial "breathing" for life — small enough
    // it never lets the impact point drift out of frame or toward any other
    // target (setFocus is ignored entirely in this mode, see setFocus()).
    const swAng = CAMERA_AZIMUTH_RAD + Math.sin(this._splashElapsed * SPLASH_SWAY_ANG_SPEED) * SPLASH_SWAY_ANG;
    const rBreath = SPLASH_DIST + Math.sin(this._splashElapsed * SPLASH_SWAY_RADIUS_SPEED) * SPLASH_SWAY_RADIUS;
    this._splashDesiredPos.set(
      this._splashPoint.x + rBreath * Math.cos(swAng),
      SPLASH_Y,
      this._splashPoint.z + rBreath * Math.sin(swAng)
    );

    // Look slightly ABOVE the impact point: pushes the point down toward
    // the lower-center third of the frame (more so in portrait), leaving
    // headroom above for the crown/jet column to read fully unobstructed.
    const headroom = lerp(SPLASH_LOOK_HEADROOM_LAND, SPLASH_LOOK_HEADROOM_PORT, this._portraitAmount);
    this._splashDesiredLookAt.set(
      this._splashPoint.x,
      this._splashPoint.y + headroom,
      this._splashPoint.z
    );

    smoothDampVec3(this._splashCamPos, this._splashVelPos, this._splashDesiredPos, SPLASH_SMOOTH_TIME, dtReal);
    smoothDampVec3(this._splashLookAt, this._splashVelLookAt, this._splashDesiredLookAt, SPLASH_SMOOTH_TIME, dtReal);

    // Underwater dip composes WITH the locked splashView framing (per
    // contract): same dip offsets as before, blended on top of the locked
    // pose instead of the old base+dolly.
    const amt = this._dipAmount;
    this._dipCamPos.set(this._splashPoint.x + 0.9, -0.5, this._splashPoint.z + 0.9);
    this._dipLookAt.set(this._splashPoint.x, -0.9, this._splashPoint.z);

    this._finalPos.copy(this._splashCamPos).lerp(this._dipCamPos, amt);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;
    this.camera.position.copy(this._finalPos);

    this._finalLookAt.copy(this._splashLookAt).lerp(this._dipLookAt, amt);
    this.camera.lookAt(this._finalLookAt);
    this._lastLookAt.copy(this._finalLookAt);

    this._setTint(amt);
  }

  _updateReturning(dtReal) {
    this._returnTimer += dtReal;
    const t = clamp01(this._returnTimer / RETURN_DUR);
    const e = easeInOutCubic(t);

    this._finalPos.lerpVectors(this._returnStartPos, this._returnTargetPos, e);
    this._finalLookAt.lerpVectors(this._returnStartLookAt, this._returnTargetLookAt, e);

    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;
    this.camera.position.copy(this._finalPos);
    this.camera.lookAt(this._finalLookAt);
    this._lastLookAt.copy(this._finalLookAt);

    this._setTint(0);

    if (t >= 1 && !this._returnFired) {
      this._returnFired = true;
      // Seed the idle spring exactly at the target with zero velocity so
      // the next frame's idle composition continues with no pop.
      this._basePos.copy(this._returnTargetPos);
      this._baseLookAt.copy(this._returnTargetLookAt);
      this._idleVelPos.set(0, 0, 0);
      this._idleVelLookAt.set(0, 0, 0);
      this._focusPoint.copy(this._baseLookAt);
      this._focusSmoothed.copy(this._baseLookAt);
      this._mode = 'idle';
      const cb = this._returnOnDone;
      this._returnOnDone = null;
      if (cb) cb();
    }
  }

  _setTint(amt) {
    if (this._tintEl) {
      this._tintEl.style.opacity = String(amt * 0.38);
    }
  }

  // -------------------------------------------------------------------
  update(dtReal, time) {
    this._advanceTimeline(dtReal);
    this._updateShake(dtReal);

    if (this._mode === 'followFlight') {
      this._updateFollowFlight(dtReal);
    } else if (this._mode === 'splashView') {
      this._updateSplashView(dtReal);
    } else if (this._mode === 'returning') {
      this._updateReturning(dtReal);
    } else {
      this._updateIdle(dtReal);
    }
  }
}
