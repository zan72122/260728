// Standalone visual harness for src/rabbit.js (S1). Builds the real
// SceneEnv (tower/boards/pool/lights) + a simple water-blue disc placeholder
// (WaterSurface is owned by another module and not needed here), then
// exercises every Rabbit method either via the on-screen buttons or the
// automatic cycle exposed as window.__test.runCycle().
import * as THREE from 'three';
import { POOL, PLATFORMS } from '../src/constants.js';
import { SceneEnv } from '../src/scene.js';
import { Rabbit } from '../src/rabbit.js';

const canvas = document.getElementById('canvas');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
// Same vantage as the game's default: +X side, ~25deg azimuth toward +Z,
// slightly high, looking back toward the tower. Pulled back a bit further
// than cameraFX's cinematic default so the FULL tower height (up to the
// 'high' platform at y=7.2) stays in frame across every climb step.
const AZ = (25 * Math.PI) / 180;
const CAM_R = 13.5;
camera.position.set(CAM_R * Math.cos(AZ), 6.4, CAM_R * Math.sin(AZ));
camera.lookAt(-1.2, 3.2, 0);

let sceneEnv = null;
let rabbit = null;
const errors = [];
window.onerror = (msg, src, line, col, err) => {
  errors.push(`${msg} @ ${line}:${col}`);
  console.error(err || msg);
};

try {
  sceneEnv = new SceneEnv(scene);
} catch (err) {
  errors.push(String(err && err.stack ? err.stack : err));
  console.error(err);
}

// Simple water-blue disc placeholder (WaterSurface is owned by module C and
// not part of this harness — the contract explicitly calls for a stand-in).
const waterGeo = new THREE.CircleGeometry(POOL.WATER_RADIUS, 64);
const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f8fd6, roughness: 0.25, metalness: 0.1 });
const waterMesh = new THREE.Mesh(waterGeo, waterMat);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = 0.01;
scene.add(waterMesh);

try {
  rabbit = new Rabbit(scene, sceneEnv);
} catch (err) {
  errors.push(String(err && err.stack ? err.stack : err));
  console.error(err);
}

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', handleResize);

// ---------------------------------------------------------------------
// Watch-point demo target: a little marker orbiting near the pool so
// watchPoint() has something visible to track.
// ---------------------------------------------------------------------
const watchMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xff3355 })
);
watchMarker.visible = false;
scene.add(watchMarker);
let watchDemoOn = false;

// ---------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------
let lastNow = performance.now();
let ready = false;

function animate(now) {
  requestAnimationFrame(animate);
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 1 / 20);
  const time = now / 1000;

  try {
    if (sceneEnv) sceneEnv.update(dt, time);
  } catch (err) {
    errors.push(String(err && err.stack ? err.stack : err));
  }

  if (watchDemoOn) {
    watchMarker.position.set(-1.5 + Math.sin(time * 0.8) * 1.4, 2.5 + Math.sin(time * 1.3) * 1.2, Math.cos(time * 0.8) * 1.4);
    if (rabbit) rabbit.watchPoint(watchMarker.position);
  }

  try {
    if (rabbit) rabbit.update(dt, time);
  } catch (err) {
    errors.push(String(err && err.stack ? err.stack : err));
  }

  renderer.render(scene, camera);

  if (!ready) {
    ready = true;
  }
  hud.textContent =
    `rabbit state: ${rabbit ? rabbit.state : '(none)'}\n` +
    `platform: ${rabbit ? rabbit.currentPlatformId : '(none)'}\n` +
    `errors: ${errors.length}` +
    (errors.length ? `\n${errors[errors.length - 1]}` : '');
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------------
// Test/demo API — used by both the on-screen buttons and Playwright.
// ---------------------------------------------------------------------
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function callbackToPromise(fn) {
  return new Promise((resolve) => fn(resolve));
}

async function doClimb(platformId) {
  if (!rabbit) return;
  await callbackToPromise((resolve) => rabbit.climbTo(platformId, resolve));
}
async function doFetch() {
  if (!rabbit) return;
  let takeOutFired = false;
  await new Promise((resolve) => {
    rabbit.fetchToy(
      () => {
        takeOutFired = true;
      },
      () => resolve(takeOutFired)
    );
  });
}
async function doStow() {
  if (!rabbit) return;
  await new Promise((resolve) => {
    rabbit.stowToy(() => resolve(true));
  });
}
async function doThrow() {
  if (!rabbit) return;
  let releaseFired = false;
  await new Promise((resolve) => {
    rabbit.windupAndThrow(
      () => {
        releaseFired = true;
      },
      () => resolve(releaseFired)
    );
  });
}
async function doAimSweep(durationMs = 1400) {
  if (!rabbit) return;
  const start = performance.now();
  while (performance.now() - start < durationMs) {
    const p = (performance.now() - start) / durationMs;
    const angle = p * Math.PI * 2;
    rabbit.aimLean(Math.cos(angle), Math.sin(angle), 0.5 + 0.5 * Math.sin(p * Math.PI));
    await wait(16);
  }
  rabbit.aimLean(0, 0, 0);
  await wait(300);
}
function doCheer() {
  if (!rabbit) return;
  rabbit.cheer();
}
function toggleWatch(on) {
  watchDemoOn = on !== undefined ? on : !watchDemoOn;
  watchMarker.visible = watchDemoOn;
  if (!watchDemoOn && rabbit) rabbit.watchPoint(null);
}

async function runCycle() {
  toggleWatch(false);
  await wait(600); // idle
  await doClimb('high');
  await wait(200);
  await doFetch();
  await wait(200);
  await doAimSweep(1400);
  await wait(150);
  await doThrow();
  await wait(150);
  doCheer();
  await wait(1300);
  await doClimb('low');
  await wait(200);
  await doStow();
  await wait(200);
  await doFetch();
  await wait(400);
}

window.__test = {
  ready: () => ready,
  errors,
  rabbit: () => rabbit,
  state: () => (rabbit ? { state: rabbit.state, platform: rabbit.currentPlatformId } : null),
  climbTo: doClimb,
  fetch: doFetch,
  stow: doStow,
  throw: doThrow,
  aimSweep: doAimSweep,
  cheer: doCheer,
  watch: toggleWatch,
  runCycle,
  setCamera: (pos, look) => {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
  },
  resetCamera: () => {
    camera.position.set(CAM_R * Math.cos(AZ), 6.4, CAM_R * Math.sin(AZ));
    camera.lookAt(-1.2, 3.2, 0);
  },
  pawAnchorWorld: () => {
    if (!rabbit) return null;
    const v = new THREE.Vector3();
    rabbit.pawAnchor.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  },
};

document.getElementById('buttons').addEventListener('click', (ev) => {
  const act = ev.target && ev.target.dataset ? ev.target.dataset.act : null;
  if (!act) return;
  switch (act) {
    case 'idle':
      toggleWatch(false);
      break;
    case 'climbLow':
      doClimb('low');
      break;
    case 'climbMid':
      doClimb('mid');
      break;
    case 'climbHigh':
      doClimb('high');
      break;
    case 'fetch':
      doFetch();
      break;
    case 'stow':
      doStow();
      break;
    case 'aimSweep':
      doAimSweep();
      break;
    case 'throw':
      doThrow();
      break;
    case 'cheer':
      doCheer();
      break;
    case 'watch':
      toggleWatch();
      break;
    case 'cycle':
      runCycle();
      break;
    default:
      break;
  }
});

// Keep PLATFORMS imported so this stays wired even if a future edit removes
// the direct sceneEnv usage above (avoids an unused-import lint surprise).
void PLATFORMS;
