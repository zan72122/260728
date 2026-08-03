// dev/input-test.js — standalone verification harness for src/input.js (S4).
// NOT part of the game. Real SceneEnv + a fixed camera + a STUB GameFlow
// object (records every call it receives, state settable from the page) +
// the real InputController under test. See docs/CONTRACTS-RABBIT.md
// "src/input.js — S4" for what this is verifying.

import * as THREE from 'three';
import { SceneEnv } from '../src/scene.js';
import { InputController } from '../src/input.js';
import { TOYS } from '../src/toys.js';
import { PLATFORMS } from '../src/constants.js';

window.__test = { ready: false, errors: [] };
function recordError(err) {
  const msg = err && err.stack ? err.stack : err && err.message ? err.message : String(err);
  window.__test.errors.push(msg);
  console.error(err);
}
window.onerror = (message, source, lineno, colno) => {
  window.__test.errors.push(`${message} @ ${source || '?'}:${lineno || 0}:${colno || 0}`);
  return false;
};
window.addEventListener('unhandledrejection', (e) => recordError(e && e.reason));

const hud = document.getElementById('hud');
const canvas = document.getElementById('canvas');

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (err) {
  recordError(err);
}

const scene = new THREE.Scene();

// Real SceneEnv — gives us the actual `platforms[].{id,tip,focus}` shape
// input.js's board-tap hit-test consumes, plus the actual scene graph
// (board mesh names) the pulse feedback best-effort-looks-up.
let sceneEnv = null;
try {
  sceneEnv = new SceneEnv(scene);
} catch (err) {
  recordError(err);
}

// Fixed camera, framing the tower + pool the same way the real game does
// (+X side, slightly high) — independent of cameraFX.js (S2's file is mid
// rework in parallel; this harness must not depend on it).
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(9, 6, 9);
camera.lookAt(-1, 3.2, 0);
camera.updateMatrixWorld();

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (renderer) renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', handleResize);
handleResize();

// ---------------------------------------------------------------------
// STUB GameFlow — records every call, state settable from the page.
// Shape matches docs/CONTRACTS-RABBIT.md "src/gameflow.js" exactly enough
// for input.js's guarded calls to exercise every path.
// ---------------------------------------------------------------------
const stub = {
  state: 'ready',
  onStateChange: null,
  currentToyDef: TOYS.find((t) => t.id === 'heavyball') || TOYS[0],
  currentPlatformId: 'mid',
  heldBody: null, // null on purpose: exercises input.js's sceneEnv-tip fallback
  log: [],
  requestPlatform(id) {
    this.log.push(['requestPlatform', id]);
  },
  requestToy(def) {
    this.log.push(['requestToy', def && def.id]);
  },
  beginAim() {
    this.log.push(['beginAim']);
  },
  updateAim(v) {
    this.log.push(['updateAim', v ? { x: v.x, y: v.y, z: v.z } : null]);
  },
  cancelAim() {
    this.log.push(['cancelAim']);
  },
  commitThrow(v) {
    this.log.push(['commitThrow', v ? { x: v.x, y: v.y, z: v.z } : null]);
  },
};

const audioStub = {
  log: [],
  unlock() {
    this.log.push('unlock');
  },
  onRelease(def) {
    this.log.push('onRelease:' + (def && def.id));
  },
};

let input = null;
try {
  input = new InputController({
    dom: canvas,
    getCamera: () => camera,
    physics: null,
    sceneEnv,
    audio: audioStub,
    gameflow: stub,
  });
} catch (err) {
  recordError(err);
}

// ---------------------------------------------------------------------
// Test-facing handles (read directly by the Playwright script).
// ---------------------------------------------------------------------
window.__stub = stub;
window.__audioStub = audioStub;
window.__input = input;
window.__camera = camera;
window.__sceneEnv = sceneEnv;

// Drive GameFlow's own state-transition contract exactly:
// `this.state = next; onStateChange(next, prev);` — so input.js's chained
// handler fires precisely as it would from the real GameFlow.
window.__test.setState = (next) => {
  const prev = stub.state;
  stub.state = next;
  if (typeof stub.onStateChange === 'function') stub.onStateChange(next, prev);
};

// Project a world point to page/client screen coordinates (canvas fills the
// viewport, so this is also just page coordinates).
window.__test.projectToScreen = (x, y, z) => {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
  };
};

window.__test.tipScreenPos = (id) => {
  const p = PLATFORMS.find((pp) => pp.id === id);
  if (!p) return null;
  return window.__test.projectToScreen(p.tip.x, p.tip.y, p.tip.z);
};

// ---------------------------------------------------------------------
// Render loop.
// ---------------------------------------------------------------------
let last = performance.now();
let frameCount = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  const time = now / 1000;

  try {
    if (sceneEnv) sceneEnv.update(dt, time);
    if (input) input.update(dt);
    if (renderer) renderer.render(scene, camera);
  } catch (err) {
    recordError(err);
  }

  frameCount++;
  if (!window.__test.ready) window.__test.ready = true;

  hud.textContent =
    `frame: ${frameCount}\n` +
    `gameflow.state: ${stub.state}\n` +
    `toyBar opacity: ${input && input._toyBar ? input._toyBar.style.opacity : 'n/a'}\n` +
    `preview visible: ${input && input._previewMesh ? input._previewMesh.visible : 'n/a'}\n` +
    `log entries: ${stub.log.length}\n` +
    `errors: ${window.__test.errors.length}`;
}

requestAnimationFrame(animate);
