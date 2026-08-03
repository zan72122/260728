// src/gameflow.js — S3 (game-flow state machine)
// See docs/CONTRACTS-RABBIT.md "src/gameflow.js + main wiring — S3" for the
// full contract. This module owns the top-level game state machine:
//   ready -> busy -> windup -> flight -> splashView -> return -> ready
// and the held-toy lifecycle (spawn/drag/stow/fetch), orchestrating the
// Rabbit, CameraFX, and Physics modules. It never touches the DOM — safe to
// unit-test under plain node with stub collaborators.
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

// -- tunables (seconds, REAL time unless noted) -----------------------------
const TIMEOUT_S = 4.0; // fallback for any single pending rabbit/cameraFX callback
const SPLASH_MIN_S = 2.0; // splashView minimum dwell (real)
const SPLASH_MAX_S = 3.5; // splashView normal max dwell (real)
const SPLASH_HARD_MAX_S = 5.0; // absolute ceiling even with secondary impacts
const SPLASH_EXTEND_S = 1.0; // how much a secondary impact pushes the max out
// Return itself targets ~1.0s real (cameraFX.returnToTower's own timing);
// GameFlow doesn't hard-code that duration — it just waits for onDone (or
// the TIMEOUT_S watchdog below if that callback never fires).

// -- small internal helpers (no per-frame allocation in update()) ----------
const _scratchWorldPos = new THREE.Vector3();

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

export class GameFlow {
  constructor({ rabbit, cameraFX, physics, audio, water, isSplashActive } = {}) {
    this.rabbit = rabbit || null;
    this.cameraFX = cameraFX || null;
    this.physics = physics || null;
    this.audio = audio || null;
    this.water = water || null;
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
    this._queuedToyDef = def;
    this._maybeDrainQueue();
  }

  _maybeDrainQueue() {
    if (this.state !== 'ready' || this._busyStarting) return;
    const platformId = this._queuedPlatformId;
    const toyDef = this._queuedToyDef;
    this._queuedPlatformId = null;
    this._queuedToyDef = null;
    if (platformId && platformId !== this.currentPlatformId) {
      this._doPlatformChange(platformId, toyDef || this.currentToyDef);
    } else if (toyDef) {
      this._doToySwap(toyDef);
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

  _climb(id, onDone) {
    if (!this.rabbit || typeof this.rabbit.climbTo !== 'function') {
      this.currentPlatformId = id;
      onDone();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      this.currentPlatformId = id;
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

  // Fetch: spawn+grab the toy at onTakeOut (mid-animation), settle at onDone.
  _fetch(def, onDone) {
    this.currentToyDef = def;
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
    if (!this.rabbit || typeof this.rabbit.fetchToy !== 'function') {
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
      this.rabbit.fetchToy(spawnAndGrab, finish);
    } catch (err) {
      console.error('[gameflow] rabbit.fetchToy threw:', err);
      finish();
    }
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
      // heldBody stops being "held" (physics owns it as 'flying' now); the
      // still-airborne reference lives on in _flightBody for watchPoint /
      // followFlight / notifyImpact to read.
      this.heldBody = null;
      safeCall(this.cameraFX, 'followFlight', () => (this._flightBody ? this._flightBody.pos : null));
    };

    if (!this.rabbit || typeof this.rabbit.windupAndThrow !== 'function') {
      doRelease();
      return;
    }
    this._armWatchdog(TIMEOUT_S, doRelease);
    try {
      this.rabbit.windupAndThrow(doRelease, doRelease);
    } catch (err) {
      console.error('[gameflow] rabbit.windupAndThrow threw:', err);
      doRelease();
    }
  }

  // Forwarded by main from physics.onImpact. Must tolerate impacts with no
  // preceding flight (e.g. __lab.drop while ready/busy) by entering
  // splashView directly.
  notifyImpact(spec) {
    const point = spec && spec.point;
    if (this.state === 'splashView') {
      // Secondary impact during an active splashView: extend the clamp
      // window (re-clamped), capped at SPLASH_HARD_MAX_S total.
      this._splashMax = Math.min(SPLASH_HARD_MAX_S, this._splashMax + SPLASH_EXTEND_S);
      safeCall(this.cameraFX, 'splashView', point);
      return;
    }
    // Any other state (ready/busy/windup/flight/return) transitions into
    // splashView — including impacts with no throw at all (__lab.drop).
    this._flightBody = null;
    this._splashElapsed = 0;
    this._splashMax = SPLASH_MAX_S;
    this._setState('splashView');
    safeCall(this.cameraFX, 'splashView', point);
    safeCall(this.rabbit, 'cheer');
  }

  _beginReturn() {
    this._returnElapsed = 0;
    this._setState('return');
    const tip = this._currentTipVec3();

    let finished = false;
    const finishReturn = () => {
      if (finished) return;
      finished = true;
      this._clearWatchdog();
      // GameFlow owns respawn: fetch the current toy back into the paws.
      this._fetch(this.currentToyDef, () => {
        this._setState('ready');
        this._maybeDrainQueue();
      });
    };

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
    const platforms = this._platformsRef;
    if (Array.isArray(platforms)) {
      for (let i = 0; i < platforms.length; i++) {
        if (platforms[i].id === this.currentPlatformId) return platforms[i].tip;
      }
    }
    return { x: -3.4, y: 4.4, z: 0 };
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
    }

    // splashView: clamp window [SPLASH_MIN_S, this._splashMax] (max grows on
    // secondary impacts up to SPLASH_HARD_MAX_S), exits early once both
    // splash/underwater report inactive AND the minimum has elapsed.
    if (this.state === 'splashView') {
      this._splashElapsed += dr;
      const stillActive = !!this.isSplashActive();
      const pastMin = this._splashElapsed >= SPLASH_MIN_S;
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
