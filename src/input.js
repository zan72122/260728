// src/input.js — H (input & UI)
// Owns: bottom toy-picker bar, side platform-picker column, and all pointer
// gesture handling for grabbing/dragging/throwing the currently held toy.
// See docs/CONTRACTS.md "src/input.js — H" for the exact contract.

import * as THREE from 'three';
import { TOYS } from './toys.js';
import { PLATFORMS } from './constants.js';

// --- tunables -------------------------------------------------------------
const RESPAWN_DELAY = 1.2;       // seconds between release and next toy spawn
const DRAG_WINDOW_MS = 120;      // rolling buffer window for release velocity
const MAX_RELEASE_SPEED = 9;     // m/s clamp on computed release velocity
const THROW_SCALE = 1.5;         // amplifies a comfy flick into a nice arc
const SCREEN_GRAB_RADIUS = 120;  // px, generous toddler-proof grab tolerance
const SPHERE_TOLERANCE_MUL = 2.2; // multiplies toy radius for ray/sphere test
const PRESS_FEEDBACK_MS = 180;

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
}
.h-toybar::-webkit-scrollbar { display: none; }

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

.h-platformbar {
  position: fixed;
  left: calc(10px + env(safe-area-inset-left, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 14px;
  z-index: 40;
}

.h-platbtn {
  width: clamp(72px, 12vw, 92px);
  border: 4px solid rgba(255,255,255,0.85);
  border-radius: 20px;
  background: linear-gradient(180deg, #ffd166, #f77f00);
  box-shadow: 0 6px 14px rgba(0,0,0,.35);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  gap: 2px;
  cursor: pointer;
  padding: 6px 4px;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  touch-action: manipulation;
  color: #3a2200;
  font-weight: 700;
}
.h-platbtn-low { height: 76px; }
.h-platbtn-mid { height: 104px; }
.h-platbtn-high { height: 132px; }

.h-platbtn-bar {
  display: block;
  width: 60%;
  border-radius: 6px;
  background: rgba(255,255,255,.6);
}
.h-platbtn-low .h-platbtn-bar { height: 18px; }
.h-platbtn-mid .h-platbtn-bar { height: 34px; }
.h-platbtn-high .h-platbtn-bar { height: 54px; }

.h-platbtn-label { font-size: 13px; line-height: 1.15; text-align: center; }

.h-platbtn.selected {
  transform: scale(1.15);
  border-color: #7cfc9a;
  box-shadow: 0 8px 20px rgba(0,0,0,.4), 0 0 0 6px rgba(124,252,154,.35);
}
.h-platbtn.h-pressed { transform: scale(0.9); }

@media (max-width: 480px), ((orientation: portrait) and (max-height: 600px)) {
  .h-toybtn { width: clamp(64px, 15vw, 84px); height: clamp(64px, 15vw, 84px); font-size: clamp(28px, 8vw, 38px); }
  .h-platbtn { width: clamp(60px, 16vw, 78px); }
}

@media (orientation: landscape) and (max-height: 480px) {
  .h-toybar { padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  .h-toybtn { width: clamp(60px, 9vh, 80px); height: clamp(60px, 9vh, 80px); font-size: clamp(26px, 5vh, 34px); }
  .h-platformbar { gap: 8px; }
  .h-platbtn-low { height: 58px; }
  .h-platbtn-mid { height: 78px; }
  .h-platbtn-high { height: 98px; }
}
`;

export class InputController {
  constructor({ dom, getCamera, physics, sceneEnv, audio, onPlatformChange }) {
    this.dom = dom;
    this.getCamera = getCamera;
    this.physics = physics;
    this.sceneEnv = sceneEnv;
    this.audio = audio;
    this.onPlatformChange = onPlatformChange || (() => {});

    // Public contract fields.
    this.currentToyDef = TOYS.find((t) => t.id === 'heavyball') || TOYS[0];
    this.currentPlatformId = 'mid';

    // Internal state.
    this._heldBody = null;
    this._spawnTimer = 0;
    this._draggingPointerId = null;
    this._dragBuffer = [];
    this._dragPlane = new THREE.Plane();
    this._raycaster = new THREE.Raycaster();
    this._audioUnlocked = false;

    // Pre-allocated scratch objects (avoid per-event allocations where easy).
    this._tmpNdc = new THREE.Vector2();
    this._tmpDir = new THREE.Vector3();
    this._tmpProj = new THREE.Vector3();
    this._tmpWorld = new THREE.Vector3();

    this._toyButtons = {};
    this._platButtons = {};

    this._bindHandlers();
    this._buildUI();
    this._bindPointerEvents();

    // Vertical-slice default: a heavyball hovers at the mid platform tip.
    this._spawnHeldToy();
  }

  // -- setup ---------------------------------------------------------------

  _bindHandlers() {
    // Bind once so add/removeEventListener references stay stable.
    this._unlockAudioOnce = this._unlockAudioOnce.bind(this);
    this._onDomPointerDown = this._onDomPointerDown.bind(this);
    this._onDomPointerMove = this._onDomPointerMove.bind(this);
    this._endDrag = this._endDrag.bind(this);
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
    this._styleEl = style;

    // Bottom row: 8 big toy buttons.
    const toyBar = document.createElement('div');
    toyBar.className = 'h-toybar';
    TOYS.forEach((def) => {
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
      toyBar.appendChild(btn);
      this._toyButtons[def.id] = btn;
    });
    document.body.appendChild(toyBar);
    this._toyBar = toyBar;

    // Left column: 3 big platform buttons, visually increasing height.
    const platBar = document.createElement('div');
    platBar.className = 'h-platformbar';
    const dotsFor = { low: '●', mid: '●●', high: '●●●' };
    PLATFORMS.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `h-platbtn h-platbtn-${p.id}`;
      btn.setAttribute('aria-label', `platform ${p.id}`);
      btn.dataset.platformId = p.id;
      const dots = dotsFor[p.id] || '●';
      btn.innerHTML =
        '<span class="h-platbtn-bar"></span>' +
        `<span class="h-platbtn-label">🪜<br>${dots}</span>`;
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._pressFeedback(btn);
        this._selectPlatform(p.id);
      });
      platBar.appendChild(btn);
      this._platButtons[p.id] = btn;
    });
    document.body.appendChild(platBar);
    this._platBar = platBar;

    this._updateToySelectionUI();
    this._updatePlatformSelectionUI();
  }

  _pressFeedback(btn) {
    btn.classList.add('h-pressed');
    clearTimeout(btn._hPressTimeout);
    btn._hPressTimeout = setTimeout(() => btn.classList.remove('h-pressed'), PRESS_FEEDBACK_MS);
  }

  _updateToySelectionUI() {
    for (const id in this._toyButtons) {
      this._toyButtons[id].classList.toggle('selected', id === this.currentToyDef.id);
    }
  }

  _updatePlatformSelectionUI() {
    for (const id in this._platButtons) {
      this._platButtons[id].classList.toggle('selected', id === this.currentPlatformId);
    }
  }

  _bindPointerEvents() {
    // First pointerdown anywhere (canvas or UI) unlocks audio, exactly once.
    window.addEventListener('pointerdown', this._unlockAudioOnce, { capture: true, once: true });

    // Prevent the browser from panning/zooming the canvas while dragging.
    if (this.dom && this.dom.style) this.dom.style.touchAction = 'none';

    this.dom.addEventListener('pointerdown', this._onDomPointerDown);
    this.dom.addEventListener('pointermove', this._onDomPointerMove);
    this.dom.addEventListener('pointerup', this._endDrag);
    this.dom.addEventListener('pointercancel', this._endDrag);
  }

  _unlockAudioOnce() {
    if (this._audioUnlocked) return;
    this._audioUnlocked = true;
    try {
      this.audio.unlock();
    } catch (err) {
      console.error(err);
    }
  }

  // -- toy / platform selection --------------------------------------------

  _selectToy(def) {
    this.currentToyDef = def;
    this._replaceHeldToy();
    this._updateToySelectionUI();
  }

  _selectPlatform(id) {
    this.currentPlatformId = id;
    this._replaceHeldToy();
    this._updatePlatformSelectionUI();
    this.onPlatformChange(id);
  }

  _replaceHeldToy() {
    // Cancel any in-progress drag cleanly (shouldn't normally happen since
    // UI buttons live outside the 3D view, but a second finger could do it).
    if (this._draggingPointerId !== null) {
      try {
        this.dom.releasePointerCapture(this._draggingPointerId);
      } catch (_) {
        /* no-op */
      }
      this._draggingPointerId = null;
      this._dragBuffer.length = 0;
    }
    if (this._heldBody) {
      this.physics.removeBody(this._heldBody);
      this._heldBody = null;
    }
    this._spawnTimer = 0;
    this._spawnHeldToy();
  }

  _currentPlatform() {
    return PLATFORMS.find((p) => p.id === this.currentPlatformId) || PLATFORMS[1];
  }

  _spawnHeldToy() {
    const tip = this._currentPlatform().tip;
    const pos = new THREE.Vector3(tip.x, tip.y, tip.z);
    const body = this.physics.spawnToy(this.currentToyDef, pos);
    this.physics.grab(body);
    this._heldBody = body;
    this._spawnTimer = 0;
  }

  // -- 3D pointer interaction ------------------------------------------------

  _ndcFromClient(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    this._tmpNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    return { ndc: this._tmpNdc, rect };
  }

  _hitTestHeldToy(clientX, clientY, camera) {
    const body = this._heldBody;
    if (!body || !body.mesh) return false;
    const { ndc, rect } = this._ndcFromClient(clientX, clientY);
    this._raycaster.setFromCamera(ndc, camera);

    // 1) Direct hit against the toy's actual geometry.
    if (this._raycaster.intersectObject(body.mesh, true).length > 0) return true;

    // 2) Generous world-space sphere tolerance around the toy center.
    const radius = Math.max((body.def && body.def.radius) || 0.3, 0.3);
    const tol = radius * SPHERE_TOLERANCE_MUL;
    const dist = this._raycaster.ray.distanceToPoint(body.mesh.position);
    if (dist <= tol) return true;

    // 3) Screen-space distance fallback — a toddler can't miss.
    this._tmpProj.copy(body.mesh.position).project(camera);
    const sx = (this._tmpProj.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-this._tmpProj.y * 0.5 + 0.5) * rect.height + rect.top;
    const dx = sx - clientX;
    const dy = sy - clientY;
    return dx * dx + dy * dy <= SCREEN_GRAB_RADIUS * SCREEN_GRAB_RADIUS;
  }

  _raycastToDragPlane(clientX, clientY, camera) {
    const { ndc } = this._ndcFromClient(clientX, clientY);
    this._raycaster.setFromCamera(ndc, camera);
    const hit = this._raycaster.ray.intersectPlane(this._dragPlane, this._tmpWorld);
    return hit ? this._tmpWorld : null;
  }

  _pushDragSample(worldPos) {
    const now = performance.now();
    this._dragBuffer.push({ t: now, pos: worldPos.clone() });
    while (this._dragBuffer.length && now - this._dragBuffer[0].t > DRAG_WINDOW_MS) {
      this._dragBuffer.shift();
    }
  }

  _releaseVelocityFromBuffer() {
    const buf = this._dragBuffer;
    if (buf.length < 2) return new THREE.Vector3(0, 0, 0);
    const last = buf[buf.length - 1];
    const first = buf[0];
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.008) return new THREE.Vector3(0, 0, 0);
    const vel = last.pos.clone().sub(first.pos).divideScalar(dt);
    vel.multiplyScalar(THROW_SCALE);
    const mag = vel.length();
    if (mag > MAX_RELEASE_SPEED) vel.multiplyScalar(MAX_RELEASE_SPEED / mag);
    return vel;
  }

  _onDomPointerDown(e) {
    // Ignore extra fingers while one drag is already in progress.
    if (this._draggingPointerId !== null) return;
    if (!this._heldBody) return; // nothing to grab during the spawn delay

    const camera = this.getCamera();
    if (!camera) return;

    if (!this._hitTestHeldToy(e.clientX, e.clientY, camera)) return;

    e.preventDefault();
    this._draggingPointerId = e.pointerId;
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch (_) {
      /* no-op, not fatal */
    }

    camera.getWorldDirection(this._tmpDir);
    this._dragPlane.setFromNormalAndCoplanarPoint(this._tmpDir, this._heldBody.mesh.position);

    this._dragBuffer.length = 0;
    this._pushDragSample(this._heldBody.mesh.position);

    this.audio.onGrab(this.currentToyDef);
  }

  _onDomPointerMove(e) {
    if (e.pointerId !== this._draggingPointerId) return;
    if (!this._heldBody) return;
    const camera = this.getCamera();
    if (!camera) return;

    const worldPos = this._raycastToDragPlane(e.clientX, e.clientY, camera);
    if (worldPos) {
      this.physics.dragTo(this._heldBody, worldPos);
      this._pushDragSample(worldPos);
    }
  }

  _endDrag(e) {
    if (e.pointerId !== this._draggingPointerId) return;
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* no-op */
    }
    this._draggingPointerId = null;

    const body = this._heldBody;
    if (body) {
      const velocity = this._releaseVelocityFromBuffer();
      this.physics.release(body, velocity);
      this.audio.onRelease(this.currentToyDef);
      this._heldBody = null;
      this._spawnTimer = RESPAWN_DELAY;
    }
    this._dragBuffer.length = 0;
  }

  // -- public API ------------------------------------------------------------

  update(dt) {
    if (!this._heldBody && this._spawnTimer > 0) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = 0;
        this._spawnHeldToy();
      }
    }
  }
}
