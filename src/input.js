// src/input.js — S4 (input & UI)
// Owns: bottom toy-picker bar, board-tap platform selection, and the
// aim-drag → dotted trajectory preview → throw gesture.
// See docs/CONTRACTS-RABBIT.md "src/input.js — S4" (this file's contract)
// and docs/CONTRACTS.md for the wider module map / GameFlow API this file
// calls into. GameFlow (src/gameflow.js, owner S3) now owns ALL toy
// spawn/grab/drag/release lifecycle and the board-select/climb workflow;
// input.js never touches physics directly any more — it only turns
// gestures into gameflow.* calls, plus renders its own aim preview and a
// tiny visual pulse on a tapped board.
//
// Every gameflow.* call is typeof-guarded (per contract) so this file keeps
// working even while S1/S2/S3 are still mid-rework in parallel.

import * as THREE from 'three';
import { TOYS } from './toys.js';
import { PLATFORMS, POOL, G } from './constants.js';

// --- tunables ---------------------------------------------------------
const MOVE_THRESHOLD = 12; // px — drag-vs-tap discriminator (also contract's aim-start gate)
const TAP_MAX_MS = 250; // ms — quick-tap window for board selection
const BOARD_TAP_WORLD_TOLERANCE = 0.9; // m — generous ray-to-tip distance tolerance
const BOARD_TAP_SCREEN_RADIUS = 90; // px — screen-space fallback tolerance
const PRESS_FEEDBACK_MS = 180;

// MEGA (docs/CONTRACTS-MEGA.md "M5"): balloon tap -> requestPlatform('sky').
const BALLOON_TAP_SCREEN_RADIUS = 110; // px — a bit more generous than a board tip

// Gesture → velocity mapping (screen px → world m/s). Kept in the same
// spirit as the old drag-the-toy gesture math: right/left maps to a
// camera-relative lateral axis, downward drag adds forward+down "throw"
// power, upward drag adds loft, tiny movement stays near a straight drop.
const MAX_RELEASE_SPEED = 9; // m/s clamp
const PX_TO_MPS = 0.045; // px → m/s gesture scale
const FORWARD_GAIN = 1.0;
const LATERAL_GAIN = 0.85;
const UP_GAIN = 0.9;
const DOWN_BIAS = 0.3; // downward drags dip the arc slightly (plunge feel)

// Trajectory preview.
const PREVIEW_DOT_COUNT_NORMAL = 14;
// MEGA: sky (giant-toy) throws start from a much greater height — a longer
// dotted arc reads better and matches M4's own aim-assist radius for sky
// drops (bigger objects need center room, so the landing point is clamped
// tighter too — see SKY_AIM_CLAMP_FRACTION below).
const PREVIEW_DOT_COUNT_SKY = 22;
const PREVIEW_DOT_COUNT_MAX = Math.max(PREVIEW_DOT_COUNT_NORMAL, PREVIEW_DOT_COUNT_SKY);
const SKY_AIM_HEIGHT_THRESHOLD = 15; // m — matches cameraFX's mega-followFlight detection
const PREVIEW_DOT_RADIUS = 0.055; // m
const PREVIEW_RING_SCALE = 2.1; // landing dot is this many times bigger
const POOL_CLAMP_FRACTION = 0.82; // matches Physics' own aim-assist radius
const SKY_AIM_CLAMP_FRACTION = 0.55; // matches M4's sky-drop aim-assist radius

// Board tap pulse feedback (real time, tiny UI feedback — not gameplay).
const BOARD_PULSE_DURATION = 0.32; // s
const BOARD_PULSE_SCALE = 0.08; // +8% at peak
const BOARD_PULSE_COLOR = new THREE.Color(0xfff97a);

// Auto-hide states (per contract): flight/splashView/windup hide the bar;
// return/ready fade it back in.
const HIDE_STATES = new Set(['flight', 'splashView', 'windup']);
const SHOW_STATES = new Set(['return', 'ready']);

const CSS_TEXT = `
.h-toybar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px calc(12px + env(safe-area-inset-right, 0px))
           calc(10px + env(safe-area-inset-bottom, 0px))
           calc(12px + env(safe-area-inset-left, 0px));
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  z-index: 40;
  touch-action: pan-x;
  background: linear-gradient(to top, rgba(10,30,60,0.35), rgba(10,30,60,0));
  opacity: 1;
  transition: opacity 0.25s ease;
}
.h-toybar::-webkit-scrollbar { display: none; }
.h-toybar.h-hidden { pointer-events: none; }

.h-toybtn {
  flex: 0 0 auto;
  width: clamp(72px, 11vw, 96px);
  height: clamp(72px, 11vw, 96px);
  border-radius: 50%;
  border: 4px solid rgba(255,255,255,0.85);
  background: radial-gradient(circle at 32% 28%, #ffffff77, var(--toy-color, #58c8ff) 62%);
  box-shadow: 0 6px 14px rgba(0,0,0,0.35), inset 0 -6px 10px rgba(0,0,0,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(32px, 6vw, 46px);
  cursor: pointer;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  touch-action: manipulation;
  padding: 0;
}
.h-toybtn-emoji { pointer-events: none; line-height: 1; filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }

.h-toybtn.selected {
  transform: scale(1.28);
  border-color: #fff97a;
  box-shadow: 0 8px 20px rgba(0,0,0,.4), 0 0 0 6px rgba(255,249,122,.35);
  animation: h-bounce 1.1s ease-in-out infinite;
  z-index: 2;
}
.h-toybtn.h-pressed { transform: scale(0.85); }

@keyframes h-bounce {
  0%, 100% { transform: scale(1.28) translateY(0); }
  50% { transform: scale(1.28) translateY(-10px); }
}

@media (max-width: 480px), ((orientation: portrait) and (max-height: 600px)) {
  .h-toybtn { width: clamp(64px, 15vw, 84px); height: clamp(64px, 15vw, 84px); font-size: clamp(28px, 8vw, 38px); }
}

@media (orientation: landscape) and (max-height: 480px) {
  .h-toybar { padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  .h-toybtn { width: clamp(60px, 9vh, 80px); height: clamp(60px, 9vh, 80px); font-size: clamp(26px, 5vh, 34px); }
}

/* MEGA (docs/CONTRACTS-MEGA.md "M5"): sky-mode toy bar shows only the giant
   (sky-flagged) defs, slightly bigger than the normal 8-button row. */
.h-toybar.h-toybar-sky .h-toybtn {
  width: clamp(84px, 13vw, 112px);
  height: clamp(84px, 13vw, 112px);
  font-size: clamp(38px, 7vw, 54px);
}
`;

export class InputController {
  constructor({ dom, getCamera, physics, sceneEnv, audio, gameflow }) {
    this.dom = dom;
    this.getCamera = getCamera;
    // Kept for the contract shape only — GameFlow owns all physics calls now
    // (spawn/grab/dragTo/release). input.js never calls physics directly.
    this.physics = physics;
    this.sceneEnv = sceneEnv;
    this.audio = audio;
    this.gameflow = gameflow || null;

    // Fallbacks used only when gameflow is absent/incomplete (parallel dev,
    // or the test harness) so currentToyDef/currentPlatformId always exist.
    this._fallbackToyDef = TOYS.find((t) => t.id === 'heavyball') || TOYS[0];
    this._fallbackPlatformId = 'mid';

    // Single-pointer gesture state (first pointer wins).
    this._activePointerId = null;
    this._pointerStartX = 0;
    this._pointerStartY = 0;
    this._pointerStartT = 0;
    this._pointerMoved = false;
    this._aiming = false;

    this._audioUnlocked = false;
    this._boardPulse = null; // { target, materials:[{mat,base}], baseScale:Vector3, t }
    this._toyBarHidden = false;
    // MEGA: cached skyMode flag so the toy bar only rebuilds on an actual
    // transition (cheap per-frame poll, per contract), not every frame.
    this._toyBarSkyMode = false;

    // Pre-allocated scratch objects (avoid per-event allocations).
    this._raycaster = new THREE.Raycaster();
    this._tmpNdc = new THREE.Vector2();
    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpProj = new THREE.Vector3();
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpAnchor = new THREE.Vector3();
    this._tmpVel = new THREE.Vector3();

    this._toyButtons = {};

    this._bindHandlers();
    this._buildUI();
    this._buildTrajectoryPreview();
    this._bindPointerEvents();
    this._subscribeGameflow();
  }

  // -- public contract fields (proxy GameFlow; keep existing so nothing
  // else that reads these two properties breaks) --------------------------
  get currentToyDef() {
    if (this.gameflow) {
      // MEGA: while in sky mode the "current toy" for selection-highlight/
      // audio purposes is the held giant toy, not the normal one it was
      // swapped out of.
      if (this.gameflow.skyMode && this.gameflow.currentGiantDef) return this.gameflow.currentGiantDef;
      if (this.gameflow.currentToyDef) return this.gameflow.currentToyDef;
    }
    return this._fallbackToyDef;
  }

  get currentPlatformId() {
    if (this.gameflow && typeof this.gameflow.currentPlatformId === 'string') {
      return this.gameflow.currentPlatformId;
    }
    return this._fallbackPlatformId;
  }

  // -- setup ---------------------------------------------------------------

  _bindHandlers() {
    // Bind once so add/removeEventListener references stay stable.
    this._unlockAudioOnce = this._unlockAudioOnce.bind(this);
    this._onDomPointerDown = this._onDomPointerDown.bind(this);
    this._onDomPointerMove = this._onDomPointerMove.bind(this);
    this._onDomPointerUp = this._onDomPointerUp.bind(this);
    this._onDomPointerCancel = this._onDomPointerCancel.bind(this);
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
    this._styleEl = style;

    // Bottom row: 8 big toy buttons. Same look/size/bounce as before —
    // selecting one now just asks GameFlow for the swap.
    const toyBar = document.createElement('div');
    toyBar.className = 'h-toybar';
    TOYS.forEach((def) => {
      const btn = this._createToyButton(def);
      toyBar.appendChild(btn);
      this._toyButtons[def.id] = btn;
    });
    document.body.appendChild(toyBar);
    this._toyBar = toyBar;

    this._updateToySelectionUI();
  }

  _createToyButton(def) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'h-toybtn';
    btn.setAttribute('aria-label', def.name || def.id);
    btn.dataset.toyId = def.id;
    const colorHex = '#' + (def.color >>> 0).toString(16).padStart(6, '0').slice(-6);
    btn.style.setProperty('--toy-color', colorHex);
    btn.innerHTML = `<span class="h-toybtn-emoji">${def.emoji}</span>`;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._pressFeedback(btn);
      this._selectToy(def);
    });
    return btn;
  }

  // MEGA: swap the toy bar's contents between the normal 8-button row and
  // the sky-mode-only giant-toy defs (TOYS.filter(t=>t.sky)). Called both
  // from the onStateChange hook (immediate rebuild right as a sky
  // entry/exit lands on 'ready') and from the per-frame update() poll below
  // (covers skyMode flipping mid-'busy', e.g. _doSkyExit clearing it before
  // 'ready' is reached) — see _syncToyBarForSkyMode.
  _rebuildToyBar() {
    if (!this._toyBar) return;
    while (this._toyBar.firstChild) this._toyBar.removeChild(this._toyBar.firstChild);
    this._toyButtons = {};
    const defs = this._toyBarSkyMode ? TOYS.filter((t) => t && t.sky) : TOYS;
    this._toyBar.classList.toggle('h-toybar-sky', this._toyBarSkyMode);
    defs.forEach((def) => {
      const btn = this._createToyButton(def);
      this._toyBar.appendChild(btn);
      this._toyButtons[def.id] = btn;
    });
    this._updateToySelectionUI();
  }

  _syncToyBarForSkyMode() {
    const sky = !!(this.gameflow && this.gameflow.skyMode);
    if (sky === this._toyBarSkyMode) return;
    this._toyBarSkyMode = sky;
    this._rebuildToyBar();
  }

  _pressFeedback(btn) {
    btn.classList.add('h-pressed');
    clearTimeout(btn._hPressTimeout);
    btn._hPressTimeout = setTimeout(() => btn.classList.remove('h-pressed'), PRESS_FEEDBACK_MS);
  }

  _updateToySelectionUI() {
    const id = this.currentToyDef && this.currentToyDef.id;
    for (const btnId in this._toyButtons) {
      this._toyButtons[btnId].classList.toggle('selected', btnId === id);
    }
  }

  _bindPointerEvents() {
    // First pointerdown anywhere (canvas or UI) unlocks audio, exactly once.
    window.addEventListener('pointerdown', this._unlockAudioOnce, { capture: true, once: true });

    // Prevent the browser from panning/zooming the canvas while dragging.
    if (this.dom && this.dom.style) this.dom.style.touchAction = 'none';

    this.dom.addEventListener('pointerdown', this._onDomPointerDown);
    this.dom.addEventListener('pointermove', this._onDomPointerMove);
    this.dom.addEventListener('pointerup', this._onDomPointerUp);
    this.dom.addEventListener('pointercancel', this._onDomPointerCancel);
  }

  _unlockAudioOnce() {
    if (this._audioUnlocked) return;
    this._audioUnlocked = true;
    try {
      if (this.audio) this.audio.unlock();
    } catch (err) {
      console.error(err);
    }
  }

  // -- GameFlow wiring -------------------------------------------------------

  _subscribeGameflow() {
    const gf = this.gameflow;
    if (!gf) return;
    // Chain any existing handler — onStateChange is a single callback slot
    // on GameFlow, not a multi-listener event, so we must not clobber
    // whatever main.js already hung there.
    const prevHandler = typeof gf.onStateChange === 'function' ? gf.onStateChange : null;
    gf.onStateChange = (state, prev) => {
      if (prevHandler) {
        try {
          prevHandler(state, prev);
        } catch (err) {
          console.error(err);
        }
      }
      this._onGameflowStateChange(state, prev);
    };
    // Apply whatever state GameFlow is already in (covers construction order
    // races and the test harness setting state before wiring us up).
    if (typeof gf.state === 'string') this._onGameflowStateChange(gf.state, null);
  }

  _onGameflowStateChange(state) {
    if (HIDE_STATES.has(state)) {
      this._setToyBarHidden(true);
    } else if (SHOW_STATES.has(state)) {
      this._setToyBarHidden(false);
    }
    // The throw is no longer being aimed once we leave 'ready' for any
    // reason (windup starting, or anything else GameFlow decides).
    if (this._aiming && state !== 'ready') {
      this._cancelAim();
    }
    // MEGA: immediate rebuild right as a state change lands (e.g. sky
    // entry's busy->ready) — see _rebuildToyBar's doc comment; update()'s
    // poll below is the cheap fallback for any skyMode flip that happens
    // mid-'busy' instead.
    this._syncToyBarForSkyMode();
  }

  _setToyBarHidden(hidden) {
    if (this._toyBarHidden === hidden) return;
    this._toyBarHidden = hidden;
    if (!this._toyBar) return;
    this._toyBar.style.opacity = hidden ? '0' : '1';
    this._toyBar.classList.toggle('h-hidden', hidden);
  }

  // -- toy selection --------------------------------------------------------

  _selectToy(def) {
    if (this.gameflow && typeof this.gameflow.requestToy === 'function') {
      try {
        this.gameflow.requestToy(def);
      } catch (err) {
        console.error(err);
      }
    } else {
      // No GameFlow yet (parallel dev / harness without one) — at least keep
      // the UI locally consistent so the button row still behaves.
      this._fallbackToyDef = def;
    }
    this._updateToySelectionUI();
  }

  // -- platform lookup helpers ------------------------------------------------

  _platformById(id) {
    if (this.sceneEnv && Array.isArray(this.sceneEnv.platforms)) {
      const p = this.sceneEnv.platforms.find((pp) => pp && pp.id === id);
      if (p) return p;
    }
    const c = PLATFORMS.find((pp) => pp.id === id);
    if (!c) return null;
    return { id: c.id, tip: new THREE.Vector3(c.tip.x, c.tip.y, c.tip.z), focus: null };
  }

  _getPawAnchorPos(target) {
    const out = target || new THREE.Vector3();
    const body = this.gameflow && this.gameflow.heldBody;
    if (body && body.pos) return out.copy(body.pos);
    const plat = this._platformById(this.currentPlatformId);
    if (plat && plat.tip) return out.copy(plat.tip);
    return out.set(-3.4, 4.4, 0);
  }

  // -- shared pointer utilities ------------------------------------------------

  _ndcFromClient(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    this._tmpNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    return { ndc: this._tmpNdc, rect };
  }

  // -- board tap hit-test ------------------------------------------------------
  // 1) recursive raycast against each platform's `focus` subtree (future-
  //    proof — focus currently has no visible children, but other modules
  //    may attach some later); 2) a generous ray-to-tip world-space distance
  //    tolerance; 3) a screen-space fallback within ~90px of any board tip's
  //    projected position, nearest wins.
  _hitTestBoard(clientX, clientY, camera) {
    if (!this.sceneEnv || !Array.isArray(this.sceneEnv.platforms)) return null;
    const { ndc, rect } = this._ndcFromClient(clientX, clientY);
    this._raycaster.setFromCamera(ndc, camera);

    let best = null; // { id, dist }
    for (const p of this.sceneEnv.platforms) {
      if (!p) continue;
      if (p.focus) {
        const hits = this._raycaster.intersectObject(p.focus, true);
        if (hits.length > 0) {
          const d = hits[0].distance;
          if (!best || d < best.dist) best = { id: p.id, dist: d };
          continue;
        }
      }
      const pos = (p.focus && p.focus.position) || p.tip;
      if (pos) {
        const dist = this._raycaster.ray.distanceToPoint(pos);
        if (dist <= BOARD_TAP_WORLD_TOLERANCE) {
          if (!best || dist < best.dist) best = { id: p.id, dist };
        }
      }
    }
    if (best) return best.id;

    // Screen-space fallback.
    let bestScreen = null;
    for (const p of this.sceneEnv.platforms) {
      if (!p) continue;
      const pos = (p.focus && p.focus.position) || p.tip;
      if (!pos) continue;
      this._tmpProj.copy(pos).project(camera);
      const sx = (this._tmpProj.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-this._tmpProj.y * 0.5 + 0.5) * rect.height + rect.top;
      const dx = sx - clientX;
      const dy = sy - clientY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= BOARD_TAP_SCREEN_RADIUS * BOARD_TAP_SCREEN_RADIUS) {
        if (!bestScreen || d2 < bestScreen.d2) bestScreen = { id: p.id, d2 };
      }
    }
    return bestScreen ? bestScreen.id : null;
  }

  // MEGA (docs/CONTRACTS-MEGA.md "M5"): raycast sceneEnv.balloon?.group,
  // falling back to a screen-space check near its projected world position
  // — same two-tier pattern as _hitTestBoard above. Guarded throughout since
  // scene.js/M1 may not have built `balloon` yet mid-parallel-dev.
  _hitTestBalloon(clientX, clientY, camera) {
    const balloon = this.sceneEnv && this.sceneEnv.balloon;
    const grp = balloon && balloon.group;
    if (!grp) return false;
    const { ndc, rect } = this._ndcFromClient(clientX, clientY);
    this._raycaster.setFromCamera(ndc, camera);
    try {
      if (this._raycaster.intersectObject(grp, true).length > 0) return true;
    } catch (_) {
      /* no-op — fall through to the screen-space fallback below */
    }
    try {
      if (typeof grp.getWorldPosition === 'function') {
        grp.getWorldPosition(this._tmpProj);
      } else if (grp.position) {
        this._tmpProj.copy(grp.position);
      } else {
        return false;
      }
    } catch (_) {
      return false;
    }
    this._tmpProj.project(camera);
    const sx = (this._tmpProj.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-this._tmpProj.y * 0.5 + 0.5) * rect.height + rect.top;
    const dx = sx - clientX;
    const dy = sy - clientY;
    return dx * dx + dy * dy <= BALLOON_TAP_SCREEN_RADIUS * BALLOON_TAP_SCREEN_RADIUS;
  }

  _pulseBoard(id) {
    const plat = this._platformById(id);
    if (!plat) return;
    // Best-effort: find the actual board mesh group (scene.js names it
    // `board-<id>`) so the pulse reads on the real board; fall back to the
    // (invisible) focus Object3D — still restores cleanly, just with no
    // visible scale effect — if that lookup ever fails.
    let target = null;
    try {
      if (this.sceneEnv && this.sceneEnv.scene && typeof this.sceneEnv.scene.getObjectByName === 'function') {
        target = this.sceneEnv.scene.getObjectByName('board-' + id);
      }
    } catch (_) {
      target = null;
    }
    if (!target) target = plat.focus;
    if (!target) return;

    const materials = [];
    if (typeof target.traverse === 'function') {
      target.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive) {
          materials.push({ mat: o.material, base: o.material.emissive.clone() });
        }
      });
    }
    this._boardPulse = {
      target,
      materials,
      baseScale: target.scale.clone(),
      t: 0,
    };
  }

  _updateBoardPulse(dt) {
    const p = this._boardPulse;
    if (!p) return;
    p.t += dt;
    const f = Math.min(1, p.t / BOARD_PULSE_DURATION);
    // Ease up over the first third, ease back down over the rest.
    const k = f < 0.35 ? f / 0.35 : Math.max(0, 1 - (f - 0.35) / 0.65);
    const s = 1 + BOARD_PULSE_SCALE * k;
    p.target.scale.set(p.baseScale.x * s, p.baseScale.y * s, p.baseScale.z * s);
    for (const m of p.materials) {
      m.mat.emissive.copy(m.base).lerp(BOARD_PULSE_COLOR, k);
    }
    if (f >= 1) {
      p.target.scale.copy(p.baseScale);
      for (const m of p.materials) m.mat.emissive.copy(m.base);
      this._boardPulse = null;
    }
  }

  // -- aim gesture → velocity ---------------------------------------------

  _computeAimVelocity(dxPx, dyPx, camera, out) {
    const vel = out || new THREE.Vector3();
    // "Forward" for the throw = from the current paw anchor toward the pool
    // center (0,0) — robust regardless of exact camera placement, and
    // matches "downward drag = forward+down power" (dragging down throws
    // further into the pool).
    const anchor = this._getPawAnchorPos(this._tmpAnchor);
    this._tmpForward.set(-anchor.x, 0, -anchor.z);
    if (this._tmpForward.lengthSq() < 1e-6) this._tmpForward.set(1, 0, 0);
    this._tmpForward.normalize();

    // "Right" for lateral left/right drag = the camera's own screen-right
    // axis projected to the horizontal plane, so the gesture reads naturally
    // from the player's point of view.
    this._tmpRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this._tmpRight.y = 0;
    if (this._tmpRight.lengthSq() < 1e-6) this._tmpRight.set(0, 0, 1);
    this._tmpRight.normalize();

    const lateral = dxPx * PX_TO_MPS;
    const down = Math.max(0, dyPx) * PX_TO_MPS;
    const up = Math.max(0, -dyPx) * PX_TO_MPS;

    vel.set(0, 0, 0);
    vel.addScaledVector(this._tmpForward, down * FORWARD_GAIN);
    vel.addScaledVector(this._tmpRight, lateral * LATERAL_GAIN);
    vel.y = up * UP_GAIN - down * DOWN_BIAS;

    const mag = vel.length();
    if (mag > MAX_RELEASE_SPEED) vel.multiplyScalar(MAX_RELEASE_SPEED / mag);
    return vel;
  }

  // -- trajectory preview (owned InstancedMesh: 14 dots + 1 landing ring) ----

  _buildTrajectoryPreview() {
    const geo = new THREE.SphereGeometry(PREVIEW_DOT_RADIUS, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    // MEGA: capacity sized for the larger sky-drop dot count (22); normal
    // throws just draw fewer instances via mesh.count below (InstancedMesh
    // draws only the first `count` instances, so this never costs extra
    // draw calls or renders stale dots from a previous frame's larger arc).
    const total = PREVIEW_DOT_COUNT_MAX + 1; // + landing ring
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.count = PREVIEW_DOT_COUNT_NORMAL + 1;
    mesh.visible = false;
    mesh.frustumCulled = false;
    if (this.sceneEnv && this.sceneEnv.scene) this.sceneEnv.scene.add(mesh);
    this._previewMesh = mesh;
  }

  _updateTrajectoryPreview(vel) {
    const mesh = this._previewMesh;
    if (!mesh) return;
    const p0 = this._getPawAnchorPos(this._tmpAnchor);
    const x0 = p0.x;
    const y0 = p0.y;
    const z0 = p0.z;
    const vx = vel.x;
    const vy = vel.y;
    const vz = vel.z;

    // MEGA: sky drops start far higher than any normal platform — a longer
    // dotted arc (~22 vs 14 dots) reads better, and the landing point clamps
    // tighter (0.55*WATER_RADIUS, matching M4's own sky aim-assist radius —
    // "big objects need center room") instead of the normal 0.82 fraction.
    const startHigh = y0 > SKY_AIM_HEIGHT_THRESHOLD;
    const dotCount = startHigh ? PREVIEW_DOT_COUNT_SKY : PREVIEW_DOT_COUNT_NORMAL;
    const clampFraction = startHigh ? SKY_AIM_CLAMP_FRACTION : POOL_CLAMP_FRACTION;

    // Vertical-only ballistic solve for the impact time (y(t)=0). Horizontal
    // clamping (below) never touches timing, matching Physics' own
    // aim-assist which "bends the horizontal velocity/direction" only.
    const disc = vy * vy + 2 * G * y0;
    let tImpact = disc > 0 ? (vy + Math.sqrt(disc)) / G : 0.05;
    if (!isFinite(tImpact) || tImpact <= 0) tImpact = 0.05;
    tImpact = Math.min(tImpact, 3.5);

    let landX = x0 + vx * tImpact;
    let landZ = z0 + vz * tImpact;
    const landR = Math.hypot(landX, landZ);
    const maxR = clampFraction * POOL.WATER_RADIUS;
    if (landR > maxR && landR > 1e-6) {
      const s = maxR / landR;
      landX *= s;
      landZ *= s;
    }

    mesh.count = dotCount + 1;
    for (let i = 0; i < dotCount; i++) {
      const f = (i + 1) / dotCount; // skip t=0 (that's the paw, not the arc)
      const t = f * tImpact;
      const y = Math.max(0, y0 + vy * t - 0.5 * G * t * t);
      // Linear interpolation toward the (possibly clamped) landing point —
      // exactly matches constant-velocity horizontal motion when unclamped,
      // and "bends" smoothly/honestly toward the clamped point otherwise.
      const x = x0 + (landX - x0) * f;
      const z = z0 + (landZ - z0) * f;
      this._tmpMatrix.makeScale(1, 1, 1);
      this._tmpMatrix.setPosition(x, y, z);
      mesh.setMatrixAt(i, this._tmpMatrix);
    }
    // Landing/target ring: bigger dot right at the (clamped) impact point.
    this._tmpMatrix.makeScale(PREVIEW_RING_SCALE, PREVIEW_RING_SCALE, PREVIEW_RING_SCALE);
    this._tmpMatrix.setPosition(landX, 0.02, landZ);
    mesh.setMatrixAt(dotCount, this._tmpMatrix);

    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = true;
  }

  _hideTrajectoryPreview() {
    if (this._previewMesh) this._previewMesh.visible = false;
  }

  // -- aim lifecycle -----------------------------------------------------------

  _cancelAim() {
    this._aiming = false;
    this._hideTrajectoryPreview();
    if (this.gameflow && typeof this.gameflow.cancelAim === 'function') {
      try {
        this.gameflow.cancelAim();
      } catch (err) {
        console.error(err);
      }
    }
  }

  // -- 3D pointer interaction ------------------------------------------------

  _onDomPointerDown(e) {
    if (this._activePointerId !== null) return; // first pointer wins
    // Not starting on a DOM button (toy buttons live outside the 3D view,
    // but this stays defensive in case `dom` ever wraps them).
    if (this._toyBar && e.target && this._toyBar.contains(e.target)) return;

    this._activePointerId = e.pointerId;
    this._pointerStartX = e.clientX;
    this._pointerStartY = e.clientY;
    this._pointerStartT = performance.now();
    this._pointerMoved = false;
    this._aiming = false;

    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch (_) {
      /* no-op, not fatal */
    }
  }

  _onDomPointerMove(e) {
    if (e.pointerId !== this._activePointerId) return;
    const dx = e.clientX - this._pointerStartX;
    const dy = e.clientY - this._pointerStartY;
    const dist = Math.hypot(dx, dy);
    if (dist >= MOVE_THRESHOLD) this._pointerMoved = true;

    const state = this.gameflow && this.gameflow.state;

    if (!this._aiming && this._pointerMoved && state === 'ready') {
      this._aiming = true;
      if (this.gameflow && typeof this.gameflow.beginAim === 'function') {
        try {
          this.gameflow.beginAim();
        } catch (err) {
          console.error(err);
        }
      }
    }

    if (this._aiming) {
      if (state !== 'ready') {
        // State moved on mid-drag (e.g. something else forced a transition).
        this._cancelAim();
        return;
      }
      const camera = this.getCamera();
      if (!camera) return;
      const vel = this._computeAimVelocity(dx, dy, camera, this._tmpVel);
      if (this.gameflow && typeof this.gameflow.updateAim === 'function') {
        try {
          this.gameflow.updateAim(vel);
        } catch (err) {
          console.error(err);
        }
      }
      this._updateTrajectoryPreview(vel);
    }
  }

  _onDomPointerUp(e) {
    if (e.pointerId !== this._activePointerId) return;
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* no-op */
    }

    const dx = e.clientX - this._pointerStartX;
    const dy = e.clientY - this._pointerStartY;
    const dt = performance.now() - this._pointerStartT;
    const moved = Math.hypot(dx, dy);
    const wasAiming = this._aiming;

    if (wasAiming) {
      const camera = this.getCamera();
      const vel = camera
        ? this._computeAimVelocity(dx, dy, camera, this._tmpVel)
        : new THREE.Vector3(0, 0, 0);
      this._aiming = false;
      this._hideTrajectoryPreview();
      if (this.gameflow && typeof this.gameflow.commitThrow === 'function') {
        try {
          this.gameflow.commitThrow(vel);
        } catch (err) {
          console.error(err);
        }
      }
      if (this.audio && typeof this.audio.onRelease === 'function') {
        try {
          this.audio.onRelease(this.currentToyDef);
        } catch (err) {
          console.error(err);
        }
      }
    } else if (dt < TAP_MAX_MS && moved < MOVE_THRESHOLD) {
      const state = this.gameflow && this.gameflow.state;
      if (state === 'ready' || state === 'busy') {
        const camera = this.getCamera();
        if (camera && this._hitTestBalloon(e.clientX, e.clientY, camera)) {
          // MEGA: balloon tap -> requestPlatform('sky'). No board-pulse
          // feedback here (that's a board-only affordance); GameFlow's own
          // busy->ready transition (climb/board/ascend/fetch) is the tell.
          if (this.gameflow && typeof this.gameflow.requestPlatform === 'function') {
            try {
              this.gameflow.requestPlatform('sky');
            } catch (err) {
              console.error(err);
            }
          }
        } else if (camera) {
          const id = this._hitTestBoard(e.clientX, e.clientY, camera);
          if (id) {
            if (this.gameflow && typeof this.gameflow.requestPlatform === 'function') {
              try {
                this.gameflow.requestPlatform(id);
              } catch (err) {
                console.error(err);
              }
            }
            this._pulseBoard(id);
          } else if (state === 'ready') {
            // Contract (docs/CONTRACTS-RABBIT.md, input.js AIM & THROW +
            // Verification): "tiny drag or plain tap = near-zero straight
            // drop". A quick tap that hits no board still needs to commit a
            // throw — without this branch a tap that missed every board did
            // nothing at all (no aim was ever begun, since aiming only
            // starts once the pointer crosses MOVE_THRESHOLD).
            if (this.gameflow && typeof this.gameflow.commitThrow === 'function') {
              this._tmpVel.set(0, 0, 0);
              try {
                this.gameflow.commitThrow(this._tmpVel);
              } catch (err) {
                console.error(err);
              }
            }
            if (this.audio && typeof this.audio.onRelease === 'function') {
              try {
                this.audio.onRelease(this.currentToyDef);
              } catch (err) {
                console.error(err);
              }
            }
          }
        }
      }
    }

    this._activePointerId = null;
    this._pointerMoved = false;
  }

  _onDomPointerCancel(e) {
    if (e.pointerId !== this._activePointerId) return;
    if (this._aiming) this._cancelAim();
    this._activePointerId = null;
    this._pointerMoved = false;
  }

  // -- public API ------------------------------------------------------------

  update(dt) {
    this._updateBoardPulse(dt);
    this._updateToySelectionUI();
    // MEGA: cheap per-frame poll (a single boolean compare) so a skyMode
    // flip mid-'busy' (e.g. _doSkyExit clearing it before 'ready') still
    // rebuilds the toy bar promptly even though no onStateChange fires at
    // that exact moment.
    this._syncToyBarForSkyMode();
  }
}
