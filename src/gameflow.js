// src/gameflow.js — S3 (game-flow state machine)
// See docs/CONTRACTS-RABBIT.md "src/gameflow.js + main wiring — S3" for the
// full contract. This module owns the top-level game state machine:
//   ready -> busy -> windup -> flight -> splashView -> return -> ready
// and the held-toy lifecycle (spawn/drag/stow/fetch), orchestrating the
// Rabbit, CameraFX, and Physics modules. It never touches the DOM — safe to
// unit-test under plain node with stub collaborators.
//
// MEGA ADDITION (M5, docs/CONTRACTS-MEGA.md "M5 — flow / camera / audio /
// input / main"): a parallel "sky" branch — requestPlatform('sky') climbs to
// the tower top, boards the balloon gondola, animates the balloon up over
// ~4.5s (gameflow-driven, real time), fetches a giant toy, and enters
// 'ready' with skyMode=true. commitThrow/notifyImpact/return all fork on
// skyMode/spec.mega to the mega presets (longer splashView clamp, mega
// camera/return calls) while every existing normal-mode code path is left
// byte-for-byte the same when skyMode is false — see the REGRESSION GATE in
// CONTRACTS-MEGA.md. Every new rabbit/cameraFX call this adds is typeof-
// guarded exactly like the pre-existing ones below (M1-M4 files may be
// mid-edit/broken in parallel).
//
// Resilience rule (per contract): every rabbit/cameraFX call is typeof-
// guarded so GameFlow keeps running even if a parallel module briefly lacks
// a method. Every step that waits on an external callback (rabbit's
// climbTo/stowToy/fetchToy/windupAndThrow, cameraFX.returnToTower) is driven
// by a single idempotent "finish" function that both the real callback and
// a real-time watchdog can call — whichever happens first wins, the other
// is a no-op — so the flow can never stall waiting on a collaborator that
// forgets to call back, and a normal fast completion never leaves a stale
// watchdog around to later fire a false "timed out" log. Timeouts are
// logged via console.error only (never pushed into __lab.errors — tests
// assert that array stays empty for functional/resilience recovery, not
// just genuine JS exceptions).
import * as THREE from '../vendor/three.module.js';
// NOTE: deliberately does NOT import './toys.js' — toys.js imports the bare
// 'three' specifier (only resolvable via the browser import map in
// index.html), which would break plain-`node` execution of this module
// (used by the gameflow logic selftest). main.js instead passes the real
// 'giantheavy' ToyDef in as the `defaultGiantDef` constructor option (see
// _defaultGiantDef below); GIANT_HEAVY_FALLBACK covers everything else
// (unit tests, or main.js running before M4's toys.js append lands).
//
// Namespace import (not named) for constants: SKY is a MEGA-addendum export
// that M1 appends to constants.js in parallel — a named `import { SKY }`
// would throw a hard SyntaxError at module-link time if M1's edit hasn't
// landed yet (unlike a plain property read on a namespace object, which is
// just `undefined`). G already exists today, so it's safe either way; kept
// on the same namespace import for consistency/one guarded fallback style.
import * as ConstantsNS from './constants.js';

const G = typeof ConstantsNS.G === 'number' ? ConstantsNS.G : 12.5;
// Guarded fallback per contract text ("import constants; guarded fallback
// {x:-1.2,y:26,z:0}") — used only until M1's constants.js append lands.
const SKY = ConstantsNS.SKY || { id: 'sky', height: 26.0, drop: { x: -1.2, y: 26.0, z: 0 } };

// -- tunables (seconds, REAL time unless noted) -----------------------------
const TIMEOUT_S = 4.0; // fallback for any single pending rabbit/cameraFX callback
const SPLASH_MIN_S = 2.0; // splashView minimum dwell (real)
const SPLASH_MAX_S = 3.5; // splashView normal max dwell (real)
const SPLASH_HARD_MAX_S = 5.0; // absolute ceiling even with secondary impacts
const SPLASH_EXTEND_S = 1.0; // how much a secondary impact pushes the max out
// Return itself targets ~1.0s real (cameraFX.returnToTower's own timing);
// GameFlow doesn't hard-code that duration — it just waits for onDone (or
// the TIMEOUT_S watchdog below if that callback never fires).

// -- MEGA tunables (docs/CONTRACTS-MEGA.md "M5") ----------------------------
const SKY_ASCEND_S = 4.5; // balloon.setProgress 0->1, real time
const SKY_DESCEND_S = 4.0; // balloon.setProgress 1->0, real time (normal-board tap)
const SPLASH_MEGA_MIN_S = 6.0;
const SPLASH_MEGA_MAX_S = 9.0;
const SPLASH_MEGA_HARD_MAX_S = 12.0; // secondary impacts (jelly rain / beach hop) extend up to this, never below current
const MEGA_HUSH_LEAD_S = 0.3; // audio.preImpactHush() fires this many seconds before water entry
// Default giant toy (M4 appends real giant defs to TOYS with mega:true,
// sky:true; this is only a placeholder used if that hasn't landed yet so
// sky mode still has *something* spawnable to fetch/throw during parallel
// dev/tests).
const GIANT_HEAVY_FALLBACK = {
  id: 'giantheavy', name: 'ジャイアントおもりボール', emoji: '🎳', shape: 'sphere',
  radius: 1.1, density: 2.6, softness: 0, bounciness: 0.15, color: 0x1c1c2e,
  mega: true, sky: true,
};

// -- small internal helpers (no per-frame allocation in update()) ----------
const _scratchWorldPos = new THREE.Vector3();
const _scratchGondolaPos = new THREE.Vector3();

function safeCall(obj, method, ...args) {
  if (obj && typeof obj[method] === 'function') {
    try {
      return obj[method](...args);
    } catch (err) {
      console.error(`[gameflow] ${method} threw:`, err);
      return undefined;
    }
  }
  return undefined;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Plain (no THREE dependency) ease used for the gameflow-driven balloon
// progress animation.
function easeInOutCubicPlain(t) {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export class GameFlow {
  constructor({ rabbit, cameraFX, physics, audio, water, isSplashActive, balloon, defaultGiantDef } = {}) {
    this.rabbit = rabbit || null;
    this.cameraFX = cameraFX || null;
    this.physics = physics || null;
    this.audio = audio || null;
    this.water = water || null;
    // MEGA: sceneEnv.balloon (M1), wired by main as `balloon`. GameFlow
    // drives balloon.setProgress(p) itself every frame during ascent/
    // descent — the balloon stays a stateless prop per its own contract.
    this.balloon = balloon || null;
    // CONTRACT GAP resolution: splashView's real duration depends on
    // splash.isActive()/underwater.isActive(), both of which live in
    // main.js's module graph, not here. GameFlow accepts an optional
    // predicate — main wires it from
    // `() => splash.isActive() || underwater.isActive()`. If omitted (e.g.
    // in unit tests), we fall back to "never active", which still behaves
    // correctly: splashView simply dwells for exactly SPLASH_MIN_S.
    this.isSplashActive = typeof isSplashActive === 'function' ? isSplashActive : () => false;

    this.state = 'ready';
    this.onStateChange = null;

    this.currentPlatformId = (this.rabbit && this.rabbit.currentPlatformId) || 'mid';
    this.currentToyDef = null; // set on first fetch (main calls initialFetch(heavyballDef))
    this.heldBody = null;
    this._flightBody = null;
    this._platformsRef = null;

    // MEGA: sky-mode state exposed per contract ("Expose skyMode,
    // currentGiantDef").
    this.skyMode = false;
    this.currentGiantDef = null; // set on first sky fetch
    // Real 'giantheavy' ToyDef, passed in by main (which CAN safely import
    // toys.js) — see _defaultGiantDef() below.
    this._defaultGiantDefOverride = defaultGiantDef || null;
    this._splashIsMega = false; // whether the ACTIVE splashView is the mega preset
    this._megaSpec = null; // last full mega ImpactSpec, kept for re-targeting on secondaries
    this._splashMin = SPLASH_MIN_S; // per-run min dwell (mega overrides to 6.0s)
    this._preImpactHushFired = false;
    this._balloonAnim = null; // { from, to, duration, elapsed, onDone, fired }

    // Queueing (last wins) for requestPlatform/requestToy while not ready.
    this._queuedPlatformId = null;
    this._queuedToyDef = null;

    // Single-slot watchdog bookkeeping (only ever one pending external
    // callback in flight at a time — steps are sequential).
    this._pendingTimer = 0;
    this._pendingTimeout = 0; // 0 = no watchdog armed
    this._pendingFallback = null;

    // splashView timers (REAL seconds).
    this._splashElapsed = 0;
    this._splashMax = SPLASH_MAX_S;
    this._returnElapsed = 0;

    this._aiming = false;
    this._busyStarting = false; // guards re-entrant queue draining
  }

  // -- state transition helper ----------------------------------------------
  _setState(next) {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    if (typeof this.onStateChange === 'function') {
      try {
        this.onStateChange(next, prev);
      } catch (err) {
        console.error('[gameflow] onStateChange threw:', err);
      }
    }
  }

  // Arm a real-time watchdog: if `onTimeout` (usually a step's idempotent
  // `finish`) hasn't already run within `seconds`, update() calls it here.
  _armWatchdog(seconds, onTimeout) {
    this._pendingTimer = 0;
    this._pendingTimeout = seconds;
    this._pendingFallback = () => {
      console.error('[gameflow] pending callback timed out; force-completing to avoid a stalled state.');
      onTimeout();
    };
  }

  _clearWatchdog() {
    this._pendingTimeout = 0;
    this._pendingFallback = null;
  }

  // -- world-position helpers -------------------------------------------
  _pawAnchorWorldPos() {
    const anchor = this.rabbit && this.rabbit.pawAnchor;
    if (anchor && typeof anchor.getWorldPosition === 'function') {
      try {
        return anchor.getWorldPosition(_scratchWorldPos).clone();
      } catch (err) {
        console.error('[gameflow] pawAnchor.getWorldPosition threw:', err);
      }
    }
    // Fallback so the rest of the flow still works (better than throwing)
    // even if rabbit briefly lacks a real pawAnchor mid-parallel-dev.
    return _scratchWorldPos.set(0, 2, 0).clone();
  }

  // MEGA: default giant toy def (contract: "default giantheavy"). Uses the
  // real def main.js passed in (from toys.js, once M4 appends it there) so
  // ids/radius/etc. stay a single source of truth; falls back to a local
  // placeholder otherwise so sky mode still has something to spawn/throw.
  _defaultGiantDef() {
    return this._defaultGiantDefOverride || GIANT_HEAVY_FALLBACK;
  }

  // ==========================================================================
  // Public API — requestPlatform / requestToy (queue-latest-while-busy)
  // ==========================================================================
  requestPlatform(id) {
    if (typeof id !== 'string') return;
    this._queuedPlatformId = id;
    this._maybeDrainQueue();
  }

  requestToy(def) {
    if (!def) return;
    // MEGA: while in sky mode only sky-flagged (giant) defs are selectable
    // (contract: "requestToy while skyMode: only defs with sky flag").
    if (this.skyMode && !def.sky) return;
    this._queuedToyDef = def;
    this._maybeDrainQueue();
  }

  _maybeDrainQueue() {
    if (this.state !== 'ready' || this._busyStarting) return;
    const platformId = this._queuedPlatformId;
    const toyDef = this._queuedToyDef;
    this._queuedPlatformId = null;
    this._queuedToyDef = null;

    if (platformId === 'sky') {
      if (!this.skyMode) {
        this._doSkyEntry();
        return;
      }
      // Already in sky mode: 'sky' request is a no-op; fall through so a
      // queued toy swap (another giant toy) can still apply below.
    } else if (platformId && this.skyMode) {
      // MEGA: tapping a normal board while skyMode descends the balloon
      // first, then exits the gondola, then runs the normal climb flow.
      this._doSkyExit(platformId, toyDef || this.currentToyDef);
      return;
    } else if (platformId && platformId !== this.currentPlatformId) {
      this._doPlatformChange(platformId, toyDef || this.currentToyDef);
      return;
    }

    if (toyDef) {
      if (this.skyMode) this._doSkyToySwap(toyDef);
      else this._doToySwap(toyDef);
    }
  }

  // ==========================================================================
  // Held-toy lifecycle
  // ==========================================================================
  _removeHeldBody() {
    if (this.heldBody) {
      safeCall(this.physics, 'removeBody', this.heldBody);
      this.heldBody = null;
    }
  }

  // Toy never rides along during climb/stow — stow first, then climb/fetch.
  _stow(onStowed) {
    if (!this.rabbit || typeof this.rabbit.stowToy !== 'function') {
      this._removeHeldBody();
      onStowed();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      this._removeHeldBody();
      onStowed();
    };
    this._armWatchdog(TIMEOUT_S, finish);
    try {
      this.rabbit.stowToy(finish);
    } catch (err) {
      console.error('[gameflow] rabbit.stowToy threw:', err);
      finish();
    }
  }

  // Look up a platform's tip Vector3 by id (via the optional platformsRef;
  // falls back to a reasonable default so this never throws).
  _tipVec3For(id) {
    const platforms = this._platformsRef;
    if (Array.isArray(platforms)) {
      for (let i = 0; i < platforms.length; i++) {
        if (platforms[i].id === id) return platforms[i].tip;
      }
    }
    return { x: -3.4, y: 4.4, z: 0 };
  }

  _climb(id, onDone) {
    if (!this.rabbit || typeof this.rabbit.climbTo !== 'function') {
      this.currentPlatformId = id;
      // CONTRACT GAP fix: cameraFX.setIdleView is otherwise never called by
      // anyone after construction/returnToTower, so a board tap that moves
      // the rabbit WITHOUT ever throwing (no flight/splashView/return in
      // between) would leave the idle camera framed on the OLD platform
      // forever. Re-frame here too, mirroring the real-rabbit path below.
      safeCall(this.cameraFX, 'setIdleView', this._tipVec3For(id));
      onDone();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      this.currentPlatformId = id;
      // See CONTRACT GAP note above: only GameFlow knows when a platform
      // change (without an accompanying throw) should re-frame the idle
      // camera — nothing else calls setIdleView for this case.
      safeCall(this.cameraFX, 'setIdleView', this._tipVec3For(id));
      onDone();
    };
    this._armWatchdog(TIMEOUT_S, finish);
    try {
      this.rabbit.climbTo(id, finish);
    } catch (err) {
      console.error('[gameflow] rabbit.climbTo threw:', err);
      finish();
    }
  }

  // Generic single-callback rabbit step (MEGA: boardGondola/exitGondola).
  // Watchdog-guarded exactly like climbTo/stowToy above; a no-op (instant
  // onDone) if rabbit doesn't have the method yet (parallel dev).
  _rabbitStep(methodName, onDone) {
    if (!this.rabbit || typeof this.rabbit[methodName] !== 'function') {
      onDone();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      onDone();
    };
    this._armWatchdog(TIMEOUT_S, finish);
    try {
      this.rabbit[methodName](finish);
    } catch (err) {
      console.error(`[gameflow] rabbit.${methodName} threw:`, err);
      finish();
    }
  }

  _boardGondola(onDone) {
    this._rabbitStep('boardGondola', onDone);
  }

  _exitGondola(onDone) {
    this._rabbitStep('exitGondola', onDone);
  }

  // Generic fetch: spawn+grab the toy at onTakeOut (mid-animation), settle
  // at onDone. Shared by the normal fetchToy path and the MEGA
  // fetchGiantToy path (methodName differs; everything else identical).
  _fetchVia(methodName, def, onDone, assignDef) {
    assignDef(def);
    const spawnAndGrab = () => {
      if (this.heldBody) return; // already spawned (e.g. via onTakeOut)
      if (!this.physics || typeof this.physics.spawnToy !== 'function') return;
      const pos = this._pawAnchorWorldPos();
      try {
        const body = this.physics.spawnToy(def, pos);
        this.heldBody = body;
        safeCall(this.physics, 'grab', body);
      } catch (err) {
        console.error('[gameflow] physics.spawnToy/grab threw:', err);
      }
    };
    if (!this.rabbit || typeof this.rabbit[methodName] !== 'function') {
      spawnAndGrab();
      onDone();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      spawnAndGrab(); // no-op if onTakeOut already fired
      onDone();
    };
    this._armWatchdog(TIMEOUT_S, finish);
    try {
      this.rabbit[methodName](spawnAndGrab, finish);
    } catch (err) {
      console.error(`[gameflow] rabbit.${methodName} threw:`, err);
      finish();
    }
  }

  _fetch(def, onDone) {
    this._fetchVia('fetchToy', def, onDone, (d) => { this.currentToyDef = d; });
  }

  // MEGA: fetch a giant toy via rabbit.fetchGiantToy (two-arm heave from the
  // giant crate) — same spawn/grab/pin lifecycle as _fetch, just the rabbit
  // method + tracked def field differ.
  _fetchGiant(def, onDone) {
    this._fetchVia('fetchGiantToy', def, onDone, (d) => { this.currentGiantDef = d; });
  }

  _doPlatformChange(id, toyDefForAfter) {
    this._busyStarting = true;
    this._setState('busy');
    this._stow(() => {
      this._climb(id, () => {
        this._fetch(toyDefForAfter || this.currentToyDef, () => {
          this._busyStarting = false;
          this._setState('ready');
          this._maybeDrainQueue();
        });
      });
    });
  }

  _doToySwap(def) {
    this._busyStarting = true;
    this._setState('busy');
    this._stow(() => {
      this._fetch(def, () => {
        this._busyStarting = false;
        this._setState('ready');
        this._maybeDrainQueue();
      });
    });
  }

  // Initial boot helper (main calls this once after wiring everything so the
  // game opens with the rabbit already holding currentToyDef). No-op if a
  // toy is already held.
  initialFetch(def) {
    if (this.heldBody) return;
    this._busyStarting = true;
    this._setState('busy');
    this._fetch(def, () => {
      this._busyStarting = false;
      this._setState('ready');
      this._maybeDrainQueue();
    });
  }

  // ==========================================================================
  // MEGA: sky (balloon gondola) entry/exit/toy-swap.
  // docs/CONTRACTS-MEGA.md "M5": requestPlatform('sky') -> busy: climb to
  // 'high' (reuse _climb), boardGondola, animate balloon 0->1 over ~4.5s
  // real, fetchGiantToy(currentGiantDef||default) -> ready, skyMode=true.
  // ==========================================================================
  _doSkyEntry() {
    this._busyStarting = true;
    this._setState('busy');
    this._stow(() => {
      this._climb('high', () => {
        this._boardGondola(() => {
          this._ascendBalloon(SKY_ASCEND_S, () => {
            const def = this.currentGiantDef || this._defaultGiantDef();
            this._fetchGiant(def, () => {
              this.skyMode = true;
              this._busyStarting = false;
              this._setState('ready');
              this._maybeDrainQueue();
            });
          });
        });
      });
    });
  }

  // Tapping a normal board while skyMode: descend the balloon (progress
  // 1->0 over ~4s, rabbit riding) -> exitGondola -> normal climb flow to the
  // tapped board.
  _doSkyExit(id, toyDefForAfter) {
    this._busyStarting = true;
    this._setState('busy');
    this._stow(() => {
      this._descendBalloon(SKY_DESCEND_S, () => {
        this._exitGondola(() => {
          this.skyMode = false;
          this._climb(id, () => {
            this._fetch(toyDefForAfter || this.currentToyDef, () => {
              this._busyStarting = false;
              this._setState('ready');
              this._maybeDrainQueue();
            });
          });
        });
      });
    });
  }

  // requestToy while already in sky mode: stow the held giant toy, fetch
  // the newly requested one, no board/balloon movement at all.
  _doSkyToySwap(def) {
    this._busyStarting = true;
    this._setState('busy');
    this._stow(() => {
      this._fetchGiant(def, () => {
        this._busyStarting = false;
        this._setState('ready');
        this._maybeDrainQueue();
      });
    });
  }

  // MEGA: best-effort world position of the gondola, for cameraFX.ascendView
  // — prefers the real balloon.group (M1) world position, falls back to the
  // rabbit's own paw anchor (close enough, and always available once rabbit
  // exists) so ascendView still has something sensible to frame even before
  // balloon.group lands.
  _gondolaWorldPos() {
    const grp = this.balloon && this.balloon.group;
    if (grp && typeof grp.getWorldPosition === 'function') {
      try {
        return grp.getWorldPosition(_scratchGondolaPos).clone();
      } catch (err) {
        console.error('[gameflow] balloon.group.getWorldPosition threw:', err);
      }
    }
    return this._pawAnchorWorldPos();
  }

  // -- balloon progress animation (gameflow-driven, per contract: "balloon
  // itself stateless... ascent/descent timing is driven by gameflow calling
  // setProgress each frame") -----------------------------------------------
  _ascendBalloon(durationS, onDone) {
    // cameraFX.ascendView: smooth climb alongside the gondola (guarded —
    // cameraFX may not have this method yet mid-parallel-dev).
    safeCall(this.cameraFX, 'ascendView', () => this._gondolaWorldPos());
    this._startBalloonAnim(0, 1, durationS, onDone);
  }

  _descendBalloon(durationS, onDone) {
    this._startBalloonAnim(1, 0, durationS, onDone);
  }

  // Fully self-timed (no external callback to await), so unlike the
  // rabbit/cameraFX steps above this needs no separate watchdog: update()
  // itself is the only thing advancing it, and it always terminates after
  // `durationS` real seconds of update() calls regardless of whether
  // `balloon` exists yet (typeof-guarded every frame below).
  _startBalloonAnim(fromP, toP, durationS, onDone) {
    this._balloonAnim = {
      from: fromP,
      to: toP,
      duration: Math.max(durationS, 0.0001),
      elapsed: 0,
      onDone,
      fired: false,
    };
    safeCall(this.balloon, 'setProgress', fromP); // no visual pop on the very first frame
  }

  // ==========================================================================
  // Aiming
  // ==========================================================================
  beginAim() {
    if (this.state !== 'ready') return;
    this._aiming = true;
    safeCall(this.rabbit, 'aimLean', 0, 0, 0);
  }

  updateAim(velocity) {
    if (!this._aiming || this.state !== 'ready') return;
    if (!velocity) return;
    // rabbit.aimLean is scaled from velocity direction+magnitude.
    const vx = velocity.x || 0;
    const vy = velocity.y || 0;
    const vz = velocity.z || 0;
    const mag = Math.hypot(vx, vy, vz);
    const strength01 = Math.max(0, Math.min(1, mag / 10));
    let dirX = 0;
    let dirZ = 0;
    const hMag = Math.hypot(vx, vz);
    if (hMag > 1e-5) {
      dirX = vx / hMag;
      dirZ = vz / hMag;
    }
    safeCall(this.rabbit, 'aimLean', dirX, dirZ, strength01);
  }

  cancelAim() {
    this._aiming = false;
    safeCall(this.rabbit, 'aimLean', 0, 0, 0);
  }

  // ==========================================================================
  // Throw / flight / impact / splash / return
  // ==========================================================================
  commitThrow(velocity) {
    if (this.state !== 'ready' || !this.heldBody) return;
    this._aiming = false;
    this._setState('windup');
    const body = this.heldBody;

    // windupAndThrow's onRelease fires at the release pose (the moment that
    // matters to us); onDone fires later at follow-through's end. We only
    // care about reaching 'flight' as early as possible, so both callbacks
    // point at the same idempotent doRelease — whichever fires first wins.
    let released = false;
    const doRelease = () => {
      if (released) return;
      released = true;
      this._clearWatchdog();
      safeCall(this.physics, 'release', body, velocity);
      this._setState('flight');
      this._flightBody = body;
      this._preImpactHushFired = false; // MEGA: fresh hush-eligibility per flight
      // heldBody stops being "held" (physics owns it as 'flying' now); the
      // still-airborne reference lives on in _flightBody for watchPoint /
      // followFlight / notifyImpact to read.
      this.heldBody = null;
      safeCall(this.cameraFX, 'followFlight', () => (this._flightBody ? this._flightBody.pos : null));
    };

    // MEGA: skyMode throws use rabbit.heaveThrow (slower, whole-body push)
    // instead of windupAndThrow. Same two-callback shape (onRelease, onDone)
    // — doRelease is reused for both exactly like the normal path above.
    const throwMethod = this.skyMode ? 'heaveThrow' : 'windupAndThrow';

    if (!this.rabbit || typeof this.rabbit[throwMethod] !== 'function') {
      doRelease();
      return;
    }
    this._armWatchdog(TIMEOUT_S, doRelease);
    try {
      this.rabbit[throwMethod](doRelease, doRelease);
    } catch (err) {
      console.error(`[gameflow] rabbit.${throwMethod} threw:`, err);
      doRelease();
    }
  }

  // MEGA: estimate real seconds until the falling body reaches y=0, from its
  // CURRENT y/vy (recomputed fresh every frame, not the launch conditions) —
  // same ballistic solve input.js's aim preview uses. Returns null if it
  // can't be estimated (already at/under water, or a degenerate NaN state).
  _estimateTimeToWater(y, vy) {
    if (!isFinite(y) || !isFinite(vy)) return null;
    if (y <= 0) return 0;
    const disc = vy * vy + 2 * G * y;
    if (disc < 0) return null;
    const t = (vy + Math.sqrt(disc)) / G;
    return isFinite(t) && t >= 0 ? t : null;
  }

  // Forwarded by main from physics.onImpact. Must tolerate impacts with no
  // preceding flight (e.g. __lab.drop while ready/busy) by entering
  // splashView directly.
  notifyImpact(spec) {
    const point = spec && spec.point;
    const isMega = !!(spec && spec.mega);

    if (this.state === 'splashView') {
      if (isMega) this._megaSpec = spec;
      if (isMega || this._splashIsMega) {
        // MEGA: secondary impacts (jelly fragment rain / giantbeach's
        // resurface hop) extend the max toward the 12s hard cap, and never
        // shorten it (contract: "EXTEND max to 12s hard cap but never
        // shorten"). Once a splashView has gone mega it stays on the mega
        // hard cap for the rest of its dwell, even if a given secondary
        // spec itself isn't flagged mega (those are normal-path specs per
        // M4's physics contract).
        this._splashIsMega = true;
        this._splashMax = Math.min(SPLASH_MEGA_HARD_MAX_S, this._splashMax + SPLASH_EXTEND_S);
      } else {
        this._splashMax = Math.min(SPLASH_HARD_MAX_S, this._splashMax + SPLASH_EXTEND_S);
      }
      this._callSplashView(point, spec);
      return;
    }

    // Any other state (ready/busy/windup/flight/return) transitions into
    // splashView — including impacts with no throw at all (__lab.drop).
    this._flightBody = null;
    this._splashElapsed = 0;
    this._splashIsMega = isMega;
    this._megaSpec = isMega ? spec : null;
    if (isMega) {
      this._splashMin = SPLASH_MEGA_MIN_S;
      this._splashMax = SPLASH_MEGA_MAX_S;
    } else {
      this._splashMin = SPLASH_MIN_S;
      this._splashMax = SPLASH_MAX_S;
    }
    this._setState('splashView');
    this._callSplashView(point, spec);
    safeCall(this.rabbit, 'cheer');
  }

  // MEGA: cameraFX.megaSplashView(spec) if present, else fall back to the
  // normal splashView(point) preset (contract: "if present else
  // splashView(spec.point)"). Re-targets using the last full mega spec
  // (with the newest impact point merged in) so a secondary impact's
  // spec — which may itself lack megaScale — doesn't blank that field out.
  _callSplashView(point, spec) {
    if (this._splashIsMega && this.cameraFX && typeof this.cameraFX.megaSplashView === 'function') {
      const base = this._megaSpec || spec;
      const specForCam = base ? Object.assign({}, base, { point: point || base.point }) : spec;
      safeCall(this.cameraFX, 'megaSplashView', specForCam);
      return;
    }
    safeCall(this.cameraFX, 'splashView', point);
  }

  _beginReturn() {
    const wasMega = this._splashIsMega;
    this._splashIsMega = false;
    this._returnElapsed = 0;
    this._setState('return');

    let finished = false;
    const finishReturn = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      if (wasMega) {
        // MEGA: balloon STAYS UP; rabbit fetches the next giant toy in the
        // gondola and we go back to 'ready' with skyMode still true.
        const def = this.currentGiantDef || this._defaultGiantDef();
        this._fetchGiant(def, () => {
          this._setState('ready');
          this._maybeDrainQueue();
        });
      } else {
        // GameFlow owns respawn: fetch the current toy back into the paws.
        this._fetch(this.currentToyDef, () => {
          this._setState('ready');
          this._maybeDrainQueue();
        });
      }
    };

    if (wasMega && this.cameraFX && typeof this.cameraFX.returnFromMega === 'function') {
      this._armWatchdog(TIMEOUT_S, finishReturn);
      try {
        this.cameraFX.returnFromMega(finishReturn);
      } catch (err) {
        console.error('[gameflow] cameraFX.returnFromMega threw:', err);
        finishReturn();
      }
      return;
    }

    const tip = this._currentTipVec3();
    if (!this.cameraFX || typeof this.cameraFX.returnToTower !== 'function') {
      finishReturn();
      return;
    }
    this._armWatchdog(TIMEOUT_S, finishReturn);
    try {
      this.cameraFX.returnToTower(tip, finishReturn);
    } catch (err) {
      console.error('[gameflow] cameraFX.returnToTower threw:', err);
      finishReturn();
    }
  }

  _currentTipVec3() {
    return this._tipVec3For(this.currentPlatformId);
  }

  // main may optionally supply sceneEnv.platforms so returnToTower gets a
  // real tip Vector3 rather than the generic fallback above.
  setPlatformsRef(platforms) {
    this._platformsRef = platforms || null;
  }

  // ==========================================================================
  // Per-frame update. dt is SCALED, dtReal is REAL (per contract: state
  // timers for splashView/return clamps use dtReal).
  // ==========================================================================
  update(dt, dtReal) {
    const dr = typeof dtReal === 'number' && isFinite(dtReal) ? dtReal : 0;

    // Single-slot watchdog for whichever external callback is pending.
    if (this._pendingTimeout > 0) {
      this._pendingTimer += dr;
      if (this._pendingTimer >= this._pendingTimeout) {
        const fb = this._pendingFallback;
        this._clearWatchdog();
        if (fb) fb();
      }
    }

    // MEGA: gameflow-driven balloon ascent/descent (real time, eased).
    if (this._balloonAnim) {
      const anim = this._balloonAnim;
      anim.elapsed += dr;
      const t = Math.min(1, anim.elapsed / anim.duration);
      const p = anim.from + (anim.to - anim.from) * easeInOutCubicPlain(t);
      safeCall(this.balloon, 'setProgress', p);
      if (t >= 1 && !anim.fired) {
        anim.fired = true;
        this._balloonAnim = null;
        const cb = anim.onDone;
        if (cb) cb();
      }
    }

    // Held-toy pinning: every frame while a body is held and rabbit's own
    // state is not climb/fetch (stowing/fetching reach into the box, where
    // the toy is momentarily away from the paws), drag it to the paw
    // anchor. During busy's actual stow/climb phases heldBody is already
    // null (removed before climbing), so this is naturally a no-op then.
    if (this.heldBody) {
      const rState = this.rabbit && this.rabbit.state;
      const notClimbingOrFetching = rState !== 'climb' && rState !== 'fetch';
      if (notClimbingOrFetching) {
        const pos = this._pawAnchorWorldPos();
        safeCall(this.physics, 'dragTo', this.heldBody, pos);
      }
    }

    // flight: rabbit watches the falling body every frame.
    if (this.state === 'flight' && this._flightBody) {
      safeCall(this.rabbit, 'watchPoint', this._flightBody.pos || null);

      // MEGA: during a sky (mega) flight, fire audio.preImpactHush() once,
      // ~0.3s before the body reaches the water.
      if (this.skyMode && !this._preImpactHushFired) {
        const body = this._flightBody;
        const y = body.pos ? body.pos.y : 0;
        const vy = body.vel ? body.vel.y : 0;
        const eta = this._estimateTimeToWater(y, vy);
        if (eta !== null && eta <= MEGA_HUSH_LEAD_S) {
          this._preImpactHushFired = true;
          safeCall(this.audio, 'preImpactHush');
        }
      }
    }

    // splashView: clamp window [this._splashMin, this._splashMax] (max grows
    // on secondary impacts up to the hard cap — normal SPLASH_HARD_MAX_S or,
    // once mega, SPLASH_MEGA_HARD_MAX_S), exits early once both splash/
    // underwater report inactive AND the minimum has elapsed.
    if (this.state === 'splashView') {
      this._splashElapsed += dr;
      const stillActive = !!this.isSplashActive();
      const pastMin = this._splashElapsed >= this._splashMin;
      const pastMax = this._splashElapsed >= this._splashMax;
      if (pastMax || (pastMin && !stillActive)) {
        this._beginReturn();
      }
    } else if (this.state === 'return') {
      // Real completion happens via cameraFX.returnToTower's onDone (see
      // _beginReturn) or its TIMEOUT_S watchdog if that never fires —
      // nothing else to drive here every frame.
      this._returnElapsed += dr;
    }
  }
}
