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
// MEGA (docs/CONTRACTS-MEGA.md "M5"): namespace import for SKY, which M1
// appends to constants.js in parallel — a named `import { SKY }` would throw
// a hard SyntaxError at module-link time until that edit lands. PLATFORMS is
// already a stable export today so the named import above stays as-is.
import * as ConstantsNS from './constants.js';

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
// followFlight/splashView camera positions. The diving boards' long axis
// runs along world X (see scene.js), so a camera sitting right on the +X
// axis sees them end-on (reads as a short pad). Swinging the camera this
// many degrees off the +X axis — while still looking back toward the
// tower/pool center — puts the boards in 3/4 perspective with their full
// length visible, without disturbing framing (pool + all 3 boards still
// fit) or any slow-mo/dip/shake behavior below. followFlight and splashView
// share this same azimuth so the camera never feels like it "jumps around"
// the pool between those two modes (idle uses its own wider azimuth, see
// IDLE_AZIMUTH_DEG below — the two only differ because the idle view has a
// held-toy-occlusion problem the flight/splash views don't).
const CAMERA_AZIMUTH_DEG = 25;
const CAMERA_AZIMUTH_RAD = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
const COS_AZ = Math.cos(CAMERA_AZIMUTH_RAD);
const SIN_AZ = Math.sin(CAMERA_AZIMUTH_RAD);

// IDLE-VIEW-ONLY azimuth (S5 integration fix, docs/CONTRACTS-RABBIT.md
// verification "rabbit visible ... holding the dark ball overhead"):
// rabbit.js's pawAnchor sits ~0.5m along +X (toward the camera) from the
// rabbit's own stance, per its own x/z-matches-tip contract requirement, and
// the held heavyball's real-world radius (0.35m) is large enough that at
// CAMERA_AZIMUTH_DEG (25°, tuned for followFlight/splashView) the ball's
// silhouette falls almost entirely along the same camera ray as the rabbit's
// body — nearly 95% of that 0.5m offset projects to screen DEPTH, not
// visible lateral/vertical separation, so the ball fully eclipses the
// rabbit in the idle view regardless of distance or elevation (verified
// empirically: raising camera height alone does not help, since the
// rabbit/ball offset is almost purely horizontal, not vertical). Widening
// the azimuth rotates the idle camera further around toward the boards'
// SIDE, converting more of that horizontal offset into visible separation
// (verified: readable rabbit-beside-ball at 80°) while, in practice, the
// boards remain just as readable (their long axis is still on-screen at a
// generous angle, not end-on) — see docs/CONTRACTS-RABBIT.md Verification.
// Deliberately kept SEPARATE from CAMERA_AZIMUTH_RAD (only used below) so
// followFlight/splashView's already-tuned framing is untouched; the two
// modes swinging to a different azimuth during their eased transitions
// (returnToTower/followFlight seed from the camera's actual current pose)
// reads as a normal cinematic dolly, not a snap.
const IDLE_AZIMUTH_DEG = 68;
const IDLE_AZIMUTH_RAD = (IDLE_AZIMUTH_DEG * Math.PI) / 180;
function withIdleAzimuth(x, z) {
  const r = Math.hypot(x, z);
  return { x: r * Math.cos(IDLE_AZIMUTH_RAD), z: r * Math.sin(IDLE_AZIMUTH_RAD) };
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

// ---- MEGA additions (docs/CONTRACTS-MEGA.md "M5") ------------------------
// Guarded fallback (SKY may not exist in constants.js yet mid-parallel-dev).
const SKY = ConstantsNS.SKY || { id: 'sky', height: 26.0, drop: { x: -1.2, y: 26.0, z: 0 } };
const HIGH_PLATFORM = PLATFORMS.find((p) => p.id === 'high') || PLATFORMS[PLATFORMS.length - 1];
const HIGH_PLATFORM_Y = HIGH_PLATFORM.height;
// cameraFX has no live scene refs (by design — S2's rework note: no scene
// graph access, only camera math). The gondola's real position lives in
// scene.js/rabbit.js; this approximation (drop-point XZ, just under sky
// height) is close enough for framing purposes for ascendView's climb and
// the E3 reaction cut / returnFromMega's wide sky idle view below.
const GONDOLA_APPROX = { x: SKY.drop.x, y: SKY.height - 1.0, z: SKY.drop.z };

// ascendView: camera climbs alongside the gondola from the tower top up to
// sky height, pulling back as it rises so the shrinking world (pool) stays
// visible below at high progress.
const ASCEND_DIST_START = 5.5;
const ASCEND_DIST_END = 10.0;
const ASCEND_CAMY_OFFSET_START = 1.6;
const ASCEND_CAMY_OFFSET_END = 4.0;
const ASCEND_LOOK_POOL_WEIGHT_START = 0.15; // how much look-at leans toward pool center (0,0,0)
const ASCEND_LOOK_POOL_WEIGHT_END = 0.55;
const ASCEND_SMOOTH_TIME = 0.5;

// followFlight, MEGA case: a sky drop starts far higher (>15 per contract)
// than any normal platform, so it gets its own wider/longer chase framing,
// passing close to the cloud layers (y~10/18) on the way down. Detected
// internally from the very first getPos() sample (see _updateFollowFlight).
const FOLLOW_MEGA_START_Y_THRESHOLD = 15;
const FOLLOW_MEGA_DIST_START = 12.0;
const FOLLOW_MEGA_DIST_END = 4.2;
const FOLLOW_MEGA_Y_START = 14.0;
const FOLLOW_MEGA_Y_END = 2.0;

// megaSplashView: wider locked-on preset (fit an 8m column) + scripted E3
// reaction cut sub-timeline.
const MEGA_SPLASH_DIST_BASE = 9.0; // m, before the megaScale nudge, clamped to ~[9,11]
const MEGA_SPLASH_DIST_SCALE_GAIN = 0.35;
const MEGA_SPLASH_DIST_MAX_BONUS = 2.0;
const MEGA_SPLASH_Y = 3.2;
const MEGA_SPLASH_LOOK_HEADROOM_LAND = 1.6;
const MEGA_SPLASH_LOOK_HEADROOM_PORT = 2.4;
const MEGA_SPLASH_SMOOTH_TIME = 0.4;
const MEGA_CUT_START_S = 1.8; // E3 reaction cut begins ~1.8s into the mega splash
const MEGA_CUT_DUR_S = 0.7;
// Slow-mo envelope for mega impacts: phases ①-④ run through the first ~3s
// real, then timeScale returns to 1 for ⑤-⑦ — implemented as a longer
// _slowmoDur fed into the SAME hitstop/slowmo/recover state machine used for
// every normal impact (see onImpact below): extends it, doesn't fork it.
const MEGA_SLOWMO_TOTAL_S = 3.0;

// returnFromMega: wider idle-sky view (gondola + pool), ~1.2s real.
const RETURN_MEGA_DUR = 1.2;

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
    // MEGA: detected from the very first getPos() sample's height (see
    // _updateFollowFlight) — true widens/lengthens the chase for a sky drop.
    this._followIsMega = false;
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
    // MEGA: which duration/target returning is easing toward — set by
    // returnToTower (false) vs returnFromMega (true); returnToTower always
    // resets this so a later normal return is completely unaffected.
    this._returnIsMega = false;

    // MEGA: ascendView state (climb alongside the gondola).
    this._ascendGetPos = null;
    this._ascendInitialized = false;
    this._ascendCamPos = new THREE.Vector3();
    this._ascendVelPos = new THREE.Vector3();
    this._ascendLookAt = new THREE.Vector3();
    this._ascendVelLookAt = new THREE.Vector3();
    this._ascendDesiredPos = new THREE.Vector3();
    this._ascendDesiredLookAt = new THREE.Vector3();

    // MEGA: megaSplashView state.
    this._megaPoint = new THREE.Vector3();
    this._megaScale = 1;
    this._megaInitialized = false;
    this._megaElapsed = 0;
    this._megaCamPos = new THREE.Vector3();
    this._megaVelPos = new THREE.Vector3();
    this._megaLookAt = new THREE.Vector3();
    this._megaVelLookAt = new THREE.Vector3();
    this._megaDesiredPos = new THREE.Vector3();
    this._megaDesiredLookAt = new THREE.Vector3();
    this._megaCutPos = new THREE.Vector3();
    this._megaCutLookAt = new THREE.Vector3();

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

    // Landscape: closer, cinematic, wide angle from +X (see IDLE_AZIMUTH_DEG
    // — idle framing uses its own, wider azimuth than followFlight/
    // splashView so the held toy doesn't eclipse the rabbit; see that
    // constant's comment for why).
    const lpAz = withIdleAzimuth(9.0, 3.0);
    this._land = { x: lpAz.x, y: 3.8, z: lpAz.z, fov: 44, lx: -1.0, ly: 1.6, lz: 0 };
    // Portrait: pulled back & higher/steeper so tower + pool both fit and
    // the water surface fills the lower ~2/3 of the frame; same fixed azimuth.
    const ppAz = withIdleAzimuth(10.5, 1.8);
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
    this._returnIsMega = false;
    this._mode = 'returning';
  }

  // ---------------------------------------------------------------------
  // MEGA additions (docs/CONTRACTS-MEGA.md "M5"). Same "ignore setFocus"
  // rule as every other non-idle mode below — setFocus() already returns
  // early for any this._mode !== 'idle', so ascendView/megaSplashView are
  // covered by that existing guard with no further change needed there.
  // ---------------------------------------------------------------------

  // Smooth climb alongside the gondola: getPos() returns the gondola's
  // current world position each frame (called every frame while active,
  // same contract shape as followFlight's getPos).
  ascendView(getPos) {
    if (typeof getPos !== 'function') return;
    this._ascendGetPos = getPos;
    this._ascendInitialized = false;
    this._mode = 'ascendView';
  }

  // Wider locked-on mega splash preset with a scripted E3 reaction cut.
  // Calling again while already active (secondary impact, e.g. jelly
  // fragment rain) re-targets smoothly without restarting the sub-timeline
  // or re-seeding the spring — same "no snap on repeat" rule as splashView.
  megaSplashView(spec) {
    if (!spec || !spec.point) return;
    const wasActive = this._mode === 'megaSplashView';
    this._megaPoint.set(spec.point.x, spec.point.y, spec.point.z);
    const scale = spec.megaScale;
    this._megaScale = typeof scale === 'number' && isFinite(scale) && scale > 0 ? scale : 1;
    if (!wasActive) {
      this._megaInitialized = false;
      this._megaElapsed = 0;
    }
    this._mode = 'megaSplashView';
  }

  // Wide idle-sky view (gondola + pool), ~1.2s real; onDone() fires exactly
  // once at arrival, then mode becomes 'idle' — pinned on the gondola-height
  // framing (via the SAME idle spring/composition every other mode hands
  // back to) until something calls setIdleView again, which is exactly what
  // happens the next time GameFlow climbs to a real board (exiting sky
  // mode) — see _updateReturning's arrival branch.
  returnFromMega(onDone) {
    const cb = typeof onDone === 'function' ? onDone : null;
    this._returnStartPos.copy(this.camera.position);
    this._returnStartLookAt.copy(this._lastLookAt);
    this._idleTip.set(GONDOLA_APPROX.x, GONDOLA_APPROX.y, GONDOLA_APPROX.z);
    this._computeIdleRaw(this._idleTip, this._returnTargetPos, this._returnTargetLookAt);
    this._returnTimer = 0;
    this._returnFired = false;
    this._returnOnDone = cb;
    this._returnIsMega = true;
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
      // MEGA: extend (don't fork) the SAME hitstop/slowmo/recover state
      // machine — a longer _slowmoDur naturally keeps timeScale in slow-mo
      // through phases ①-④ (first ~3s real), then recover/idle bring it back
      // to 1 for ⑤-⑦, matching "slow-mo only through the first ~3s" without
      // any extra phase/branch in _advanceTimeline below.
      this._slowmoDur = spec.mega
        ? Math.max(0.1, MEGA_SLOWMO_TOTAL_S - HITSTOP_DUR)
        : SLOWMO_BASE_DUR + (energy > 0.7 ? SLOWMO_ENERGY_BONUS : 0);
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
      // MEGA: a sky drop starts far higher than any normal platform — widen
      // and lengthen the chase (it naturally also takes longer real time to
      // fall the extra height, which is what makes it read as "the longest,
      // most dramatic follow" on top of the wider framing here).
      this._followIsMega = this._followStartY > FOLLOW_MEGA_START_Y_THRESHOLD;
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

    const distStart = this._followIsMega ? FOLLOW_MEGA_DIST_START : FOLLOW_DIST_START;
    const distEnd = this._followIsMega ? FOLLOW_MEGA_DIST_END : FOLLOW_DIST_END;
    const yStart = this._followIsMega ? FOLLOW_MEGA_Y_START : FOLLOW_Y_START;
    const yEnd = this._followIsMega ? FOLLOW_MEGA_Y_END : FOLLOW_Y_END;
    const dist = lerp(distStart, distEnd, eu);
    const camY = lerp(yStart, yEnd, eu);
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

  // MEGA: smooth climb alongside the gondola (see ascendView above).
  _updateAscendView(dtReal) {
    const p = this._ascendGetPos ? this._ascendGetPos() : null;
    if (!p) {
      this._setTint(0);
      return;
    }
    if (!this._ascendInitialized) {
      this._ascendInitialized = true;
      this._ascendCamPos.copy(this.camera.position);
      this._ascendVelPos.set(0, 0, 0);
      this._ascendLookAt.copy(this._lastLookAt);
      this._ascendVelLookAt.set(0, 0, 0);
    }

    // Progress 0 (tower top) -> 1 (sky height): pulls the camera back and up
    // as the gondola rises, keeping the shrinking pool visible below at high
    // progress (look-at leans further toward the pool center as u grows).
    const span = Math.max(1, SKY.height - HIGH_PLATFORM_Y);
    const u = clamp01((p.y - HIGH_PLATFORM_Y) / span);
    const eu = smoothstep(u);

    const dist = lerp(ASCEND_DIST_START, ASCEND_DIST_END, eu);
    const camY = p.y + lerp(ASCEND_CAMY_OFFSET_START, ASCEND_CAMY_OFFSET_END, eu);
    this._ascendDesiredPos.set(p.x + dist * COS_AZ, camY, p.z + dist * SIN_AZ);

    const poolW = lerp(ASCEND_LOOK_POOL_WEIGHT_START, ASCEND_LOOK_POOL_WEIGHT_END, eu);
    this._ascendDesiredLookAt.set(
      lerp(p.x, 0, poolW),
      lerp(p.y, 0, poolW * 0.5),
      lerp(p.z, 0, poolW)
    );

    smoothDampVec3(this._ascendCamPos, this._ascendVelPos, this._ascendDesiredPos, ASCEND_SMOOTH_TIME, dtReal);
    smoothDampVec3(this._ascendLookAt, this._ascendVelLookAt, this._ascendDesiredLookAt, ASCEND_SMOOTH_TIME, dtReal);

    this._finalPos.copy(this._ascendCamPos);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;
    this.camera.position.copy(this._finalPos);
    this.camera.lookAt(this._ascendLookAt);
    this._lastLookAt.copy(this._ascendLookAt);

    this._setTint(0);
  }

  // MEGA: wide locked-on mega splash preset with a scripted ~0.7s E3
  // reaction cut to the gondola at ~1.8s in, then back to the locked splash.
  _updateMegaSplashView(dtReal) {
    if (!this._megaInitialized) {
      this._megaInitialized = true;
      this._megaElapsed = 0;
      this._megaCamPos.copy(this.camera.position);
      this._megaVelPos.set(0, 0, 0);
      this._megaLookAt.copy(this._lastLookAt);
      this._megaVelLookAt.set(0, 0, 0);
    }
    this._megaElapsed += dtReal;

    const inCut = this._megaElapsed >= MEGA_CUT_START_S && this._megaElapsed < MEGA_CUT_START_S + MEGA_CUT_DUR_S;
    if (inCut) {
      // E3: fixed close view near the gondola, looking down at the rabbit.
      this._megaCutPos.set(GONDOLA_APPROX.x + 1.4, GONDOLA_APPROX.y + 0.6, GONDOLA_APPROX.z + 1.4);
      this._megaCutLookAt.set(GONDOLA_APPROX.x, GONDOLA_APPROX.y - 1.2, GONDOLA_APPROX.z);
      this._finalPos.copy(this._megaCutPos);
      this._finalPos.x += this._shakeOffset.x;
      this._finalPos.y += this._shakeOffset.y;
      this.camera.position.copy(this._finalPos);
      this.camera.lookAt(this._megaCutLookAt);
      this._lastLookAt.copy(this._megaCutLookAt);
      // Re-seed the splash spring at the cut's pose (zero velocity) so
      // "then back" (below, once inCut goes false again) eases smoothly
      // back to the locked splash framing instead of snapping to it.
      this._megaCamPos.copy(this._finalPos);
      this._megaVelPos.set(0, 0, 0);
      this._megaLookAt.copy(this._megaCutLookAt);
      this._megaVelLookAt.set(0, 0, 0);
      this._setTint(0);
      return;
    }

    // Locked-on framing (same shape as splashView, wider + higher to fit an
    // 8m mega column): distance ~9-11m, scaled by megaScale.
    const bonus = Math.max(0, Math.min(MEGA_SPLASH_DIST_MAX_BONUS, (this._megaScale - 1) * MEGA_SPLASH_DIST_SCALE_GAIN));
    const dist = MEGA_SPLASH_DIST_BASE + bonus;
    const swAng = CAMERA_AZIMUTH_RAD + Math.sin(this._megaElapsed * SPLASH_SWAY_ANG_SPEED) * SPLASH_SWAY_ANG;
    const rBreath = dist + Math.sin(this._megaElapsed * SPLASH_SWAY_RADIUS_SPEED) * SPLASH_SWAY_RADIUS;
    this._megaDesiredPos.set(
      this._megaPoint.x + rBreath * Math.cos(swAng),
      MEGA_SPLASH_Y,
      this._megaPoint.z + rBreath * Math.sin(swAng)
    );

    const headroom = lerp(MEGA_SPLASH_LOOK_HEADROOM_LAND, MEGA_SPLASH_LOOK_HEADROOM_PORT, this._portraitAmount);
    this._megaDesiredLookAt.set(this._megaPoint.x, this._megaPoint.y + headroom, this._megaPoint.z);

    smoothDampVec3(this._megaCamPos, this._megaVelPos, this._megaDesiredPos, MEGA_SPLASH_SMOOTH_TIME, dtReal);
    smoothDampVec3(this._megaLookAt, this._megaVelLookAt, this._megaDesiredLookAt, MEGA_SPLASH_SMOOTH_TIME, dtReal);

    // Underwater dip composes with the locked mega framing exactly like the
    // normal splashView does.
    const amt = this._dipAmount;
    this._dipCamPos.set(this._megaPoint.x + 1.4, -0.5, this._megaPoint.z + 1.4);
    this._dipLookAt.set(this._megaPoint.x, -0.9, this._megaPoint.z);

    this._finalPos.copy(this._megaCamPos).lerp(this._dipCamPos, amt);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;
    this.camera.position.copy(this._finalPos);

    this._finalLookAt.copy(this._megaLookAt).lerp(this._dipLookAt, amt);
    this.camera.lookAt(this._finalLookAt);
    this._lastLookAt.copy(this._finalLookAt);

    this._setTint(amt);
  }

  _updateReturning(dtReal) {
    this._returnTimer += dtReal;
    const dur = this._returnIsMega ? RETURN_MEGA_DUR : RETURN_DUR;
    const t = clamp01(this._returnTimer / dur);
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
    } else if (this._mode === 'megaSplashView') {
      this._updateMegaSplashView(dtReal);
    } else if (this._mode === 'ascendView') {
      this._updateAscendView(dtReal);
    } else if (this._mode === 'returning') {
      this._updateReturning(dtReal);
    } else {
      this._updateIdle(dtReal);
    }
  }
}
