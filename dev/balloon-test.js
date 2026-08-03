// Standalone visual harness for the mega splash tier's M1 additions:
// scene.js's balloon+gondola+giant-crate+cloud-layers, and rabbit.js's
// boardGondola/exitGondola/fetchGiantToy/heaveThrow + gondola-riding.
// Builds the REAL SceneEnv + Rabbit (no mocks). setProgress's animation
// timing is normally owned by gameflow (M5) — here the harness drives it
// itself, exactly the way gameflow would (call setProgress(p) every frame
// with p eased over real time).
import * as THREE from 'three';
import { POOL, PLATFORMS, SKY } from '../src/constants.js';
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
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);

// ---------------------------------------------------------------------
// Two camera presets: the game's normal vantage (matches rabbit-test.js /
// cameraFX's default idle azimuth), and a "sky" vantage parked up near the
// balloon's flight path so the cloud layers and gondola detail are visible
// close-up during the ascent and at progress=1.
// ---------------------------------------------------------------------
const AZ = (25 * Math.PI) / 180;
const CAM_R = 16.5;
function setGameCamera() {
  camera.position.set(CAM_R * Math.cos(AZ), 8.0, CAM_R * Math.sin(AZ));
  camera.lookAt(-1.2, 7.6, 0.6);
}
// "Up near the balloon" — dynamically framed from the balloon's OWN current
// world position (read from gondolaAnchor) so it stays a good close-up at
// any progress, not just p=1: above and to the side, angled DOWN into the
// open-top gondola so the rabbit riding inside is actually visible (a
// camera level with or below the basket rim can't see over the wicker
// walls into an open-top box — that's the real geometry, not a bug; this
// is simply a better vantage for verifying the ride, matching the kind of
// shot the real E3 "gondola looking down at the rabbit" cut would use).
function setSkyCamera() {
  const b = sceneEnv && sceneEnv.balloon;
  const g = new THREE.Vector3(-1.2, 25.5, 0);
  if (b) b.gondolaAnchor.getWorldPosition(g);
  camera.position.set(g.x + 2.4, g.y + 4.6, g.z + 3.6);
  camera.lookAt(g.x, g.y + 0.3, g.z);
}
let camMode = 'game';
setGameCamera();

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

// Simple water-blue disc placeholder (WaterSurface is owned by another
// module and not needed for this harness).
const waterGeo = new THREE.CircleGeometry(POOL.WATER_RADIUS, 64);
const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f8fd6, roughness: 0.25, metalness: 0.1 });
const waterMesh = new THREE.Mesh(waterGeo, waterMat);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = 0.01;
scene.add(waterMesh);

// A small marker at SKY.drop so the intended p=1 hover point is visible
// even before the balloon settles exactly on it.
const dropMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.22, 24),
  new THREE.MeshBasicMaterial({ color: 0xff3355, side: THREE.DoubleSide })
);
dropMarker.rotation.x = -Math.PI / 2;
dropMarker.position.set(SKY.drop.x, 0.02, SKY.drop.z);
scene.add(dropMarker);

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
// Placeholder giant toy: a 1.1m-radius sphere (contract's own validation
// spec), NOT part of any owned module — a stand-in for the real giant toy
// mesh M4 builds. Hidden until fetchGiantToy's onTakeOut fires; rides the
// rabbit's pawAnchor (world position copied every frame) while held;
// released (with a simple ballistic fall, just for a legible screenshot)
// at heaveThrow's onRelease.
// ---------------------------------------------------------------------
const GIANT_R = 1.1;
const giantToy = new THREE.Mesh(
  new THREE.SphereGeometry(GIANT_R, 24, 18),
  new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.4, metalness: 0.05 })
);
giantToy.visible = false;
scene.add(giantToy);
let giantHeld = false;
let giantFlying = false;
const giantVel = new THREE.Vector3();
const G = 12.5;

function takeOutGiant() {
  giantToy.visible = true;
  giantHeld = true;
  giantFlying = false;
}
function releaseGiant() {
  giantHeld = false;
  giantFlying = true;
  const p = new THREE.Vector3();
  rabbit.pawAnchor.getWorldPosition(p);
  giantToy.position.copy(p);
  // A gentle lob outward/down, just so the release reads clearly.
  giantVel.set(1.4, -0.6, 0.3);
}
function resetGiant() {
  giantToy.visible = false;
  giantHeld = false;
  giantFlying = false;
}

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

  try {
    if (rabbit) rabbit.update(dt, time);
  } catch (err) {
    errors.push(String(err && err.stack ? err.stack : err));
  }

  if (giantHeld && rabbit) {
    rabbit.pawAnchor.getWorldPosition(giantToy.position);
  } else if (giantFlying) {
    giantVel.y -= G * dt;
    giantToy.position.addScaledVector(giantVel, dt);
    if (giantToy.position.y < -POOL.DEPTH - 2) {
      resetGiant();
    }
  }

  renderer.render(scene, camera);
  ready = true;

  const b = sceneEnv && sceneEnv.balloon;
  hud.textContent =
    `rabbit state: ${rabbit ? rabbit.state : '(none)'}\n` +
    `riding: ${rabbit ? rabbit._riding : '(none)'}  holdingGiant: ${rabbit ? rabbit._holdingGiant : '(none)'}\n` +
    `balloon.progress: ${b ? b.progress.toFixed(2) : '(none)'}\n` +
    `camera: ${camMode}\n` +
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

async function doClimbHigh() {
  if (!rabbit) return;
  await callbackToPromise((resolve) => rabbit.climbTo('high', resolve));
}
async function doBoard() {
  if (!rabbit) return;
  await callbackToPromise((resolve) => rabbit.boardGondola(resolve));
}
async function doExit() {
  if (!rabbit) return;
  await callbackToPromise((resolve) => rabbit.exitGondola(resolve));
}
async function doFetchGiant() {
  if (!rabbit) return;
  let takeOutFired = false;
  await new Promise((resolve) => {
    rabbit.fetchGiantToy(
      () => {
        takeOutFired = true;
        takeOutGiant();
      },
      () => resolve(takeOutFired)
    );
  });
}
async function doHeave() {
  if (!rabbit) return;
  let releaseFired = false;
  await new Promise((resolve) => {
    rabbit.heaveThrow(
      () => {
        releaseFired = true;
        releaseGiant();
      },
      () => resolve(releaseFired)
    );
  });
}
// Drives balloon.setProgress(p) over real time, exactly the way gameflow
// (M5) is specified to: p eased 0..1 (or 1..0) over `ms` milliseconds.
async function progressTo(target, ms = 1400) {
  if (!sceneEnv || !sceneEnv.balloon) return;
  const start = sceneEnv.balloon.progress;
  const t0 = performance.now();
  while (true) {
    const e = Math.min(1, (performance.now() - t0) / ms);
    const eased = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
    sceneEnv.balloon.setProgress(start + (target - start) * eased);
    if (e >= 1) break;
    await wait(16);
  }
  sceneEnv.balloon.setProgress(target);
}

function setCam(mode) {
  camMode = mode;
  if (mode === 'sky') setSkyCamera();
  else setGameCamera();
}

async function runFullSequence() {
  setCam('game');
  await wait(400);
  await doClimbHigh();
  await wait(200);
  await doBoard();
  await wait(200);
  await progressTo(1, 3200);
  await wait(300);
  setCam('sky');
  await wait(300);
  await doFetchGiant();
  await wait(300);
  await doHeave();
  await wait(700);
  resetGiant();
  setCam('game');
  await progressTo(0, 2400);
  await wait(200);
  await doExit();
  await wait(200);
}

window.__test = {
  ready: () => ready,
  errors,
  rabbit: () => rabbit,
  sceneEnv: () => sceneEnv,
  state: () => ({
    rabbitState: rabbit ? rabbit.state : null,
    riding: rabbit ? rabbit._riding : null,
    holdingGiant: rabbit ? rabbit._holdingGiant : null,
    progress: sceneEnv && sceneEnv.balloon ? sceneEnv.balloon.progress : null,
  }),
  climbHigh: doClimbHigh,
  board: doBoard,
  exit: doExit,
  fetchGiant: doFetchGiant,
  heave: doHeave,
  progressTo,
  resetGiant,
  setCam,
  runFullSequence,
  setCameraRaw: (pos, look) => {
    camMode = 'custom';
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
  },
  pawAnchorWorld: () => {
    if (!rabbit) return null;
    const v = new THREE.Vector3();
    rabbit.pawAnchor.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  },
  gondolaAnchorWorld: () => {
    if (!sceneEnv || !sceneEnv.balloon) return null;
    const v = new THREE.Vector3();
    sceneEnv.balloon.gondolaAnchor.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  },
  drawCallInfo: () => {
    // Toggle the balloon group's visibility and diff renderer.info.render
    // calls across two manual renders, to measure the balloon's own
    // draw-call growth in isolation (used by the drawcalls.mjs check).
    if (!sceneEnv || !sceneEnv.balloon) return null;
    renderer.render(scene, camera);
    const withBalloon = renderer.info.render.calls;
    sceneEnv.balloon.group.visible = false;
    renderer.info.reset();
    renderer.render(scene, camera);
    const withoutBalloon = renderer.info.render.calls;
    sceneEnv.balloon.group.visible = true;
    renderer.info.reset();
    renderer.render(scene, camera);
    const withBalloon2 = renderer.info.render.calls;
    return { withBalloon, withoutBalloon, withBalloon2, delta: withBalloon2 - withoutBalloon };
  },
};

document.getElementById('buttons').addEventListener('click', (ev) => {
  const act = ev.target && ev.target.dataset ? ev.target.dataset.act : null;
  if (!act) return;
  switch (act) {
    case 'camGame':
      setCam('game');
      break;
    case 'camSky':
      setCam('sky');
      break;
    case 'board':
      doBoard();
      break;
    case 'progress0':
      progressTo(0);
      break;
    case 'progress1':
      progressTo(1);
      break;
    case 'fetchGiant':
      doFetchGiant();
      break;
    case 'heave':
      doHeave();
      break;
    case 'exit':
      doExit();
      break;
    case 'runAll':
      runFullSequence();
      break;
    default:
      break;
  }
});

// Keep PLATFORMS imported so this stays wired even if a future edit removes
// the direct sceneEnv usage above (avoids an unused-import lint surprise).
void PLATFORMS;
