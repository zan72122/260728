// dev/megawater-test.js — standalone visual/regression test harness for the
// M3 mega-splash extensions to src/water.js (docs/CONTRACTS-MEGA.md "M3").
// NOT part of the game; verification only.
//
// Scene: a real WaterSurface (instance A, rendered) sitting inside a simple
// torus "deck ring" standing in for the pool rim (so the deck-overflow ring
// washing over it is visible), plus a second WaterSurface (instance B) that
// is NEVER mega-triggered and is never even added to a rendered scene — it
// exists purely as a same-formula baseline so displacementAt() at a fixed
// point can be diffed frame-by-frame against instance A to prove the
// pre-megaImpact regression gate (bit-for-bit no-op) holds.
//
// Sequence (real time): idle 1s (screenshot moment) -> megaImpact(-1, 0, 1.0)
// on instance A only -> ~8s of frames (screenshot moments logged to the HUD
// and to window.__test.shotTimes so an external screenshot series can key
// off them).

import * as THREE from 'three';
import { WaterSurface } from '../src/water.js';
import { POOL } from '../src/constants.js';

window.__test = {
  ready: false,
  errors: [],
  triggeredAt: null,
  fixedPoint: { x: 1.5, z: 0 },
  impactPoint: { x: -1, z: 0 },
  preImpactSamples: [],   // { t, a, b } — instance A vs baseline B, before megaImpact
  postImpactSamples: [],  // { t, a, slosh } — instance A after megaImpact
  shotTimes: [1.0, 1.3, 1.6, 2.0, 2.4, 2.9, 3.5, 4.2, 5.0, 6.0, 7.2, 9.0],
  time: () => simTime,
  isTriggered: () => triggered,
  overflowVisible: () => (water ? water.overflowMesh.visible : false),
  // Generic passthroughs (any x,z), for numeric profile probing — beyond the
  // fixed-point samples already collected every frame above.
  displacementAt: (x, z) => (water ? water.displacementAt(x, z) : 0),
  sloshOffsetAt: (x, z) => (water ? water.sloshOffsetAt(x, z) : 0),
  summary,
};

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

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
} catch (err) {
  recordError(err);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0e8);

// Gameplay-angle camera: +X side, slightly high, framing the whole pool —
// mirrors CameraFX's documented default view.
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.4, 4.6, 9.6);
camera.lookAt(0, 0, 0);

// -- lights -----------------------------------------------------------------
const dir = new THREE.DirectionalLight(0xffffff, 2.2);
dir.position.set(4, 8, 3);
scene.add(dir);
const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x224455, 0.9);
scene.add(hemi);

// -- pool basin floor (simple dark disc for depth context) ------------------
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(POOL.WATER_RADIUS, 48),
  new THREE.MeshStandardMaterial({ color: 0x0e3d55, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.6;
scene.add(floor);

// -- deck ring (torus standing in for the pool rim/deck) --------------------
// Sits just outside the water radius, at y≈0, so the overflow ring visibly
// washes up and over it.
const deck = new THREE.Mesh(
  new THREE.TorusGeometry(POOL.RADIUS, 0.22, 14, 64),
  new THREE.MeshStandardMaterial({ color: 0xe8d9a0, roughness: 0.85 })
);
deck.rotation.x = Math.PI / 2;
deck.position.y = 0.02;
scene.add(deck);

// -------------------------------------------------------------------
// WaterSurface under test.
// Instance A: real, rendered, the one megaImpact() is called on.
// Instance B: baseline, built into a throwaway (never rendered) scene, and
// NEVER mega-triggered — used purely as a frame-by-frame regression oracle.
// -------------------------------------------------------------------
let water = null;
let waterBaseline = null;
try {
  water = new WaterSurface(scene);
} catch (err) {
  recordError(err);
}
try {
  const throwawayScene = new THREE.Scene();
  waterBaseline = new WaterSurface(throwawayScene);
} catch (err) {
  recordError(err);
}

const FIXED = window.__test.fixedPoint;
const IMPACT = window.__test.impactPoint;
const IDLE_DURATION = 1.0;
const RUN_DURATION = 9.0; // idle + ~8s of mega playback

let simTime = 0;
let triggered = false;
let lastNow = performance.now();
let firstFrame = false;
let frameCount = 0;

function sampleFrame() {
  if (!water || !waterBaseline) return;
  const a = water.displacementAt(FIXED.x, FIXED.z);
  if (!triggered) {
    const b = waterBaseline.displacementAt(FIXED.x, FIXED.z);
    window.__test.preImpactSamples.push({ t: Number(simTime.toFixed(4)), a, b, diff: Math.abs(a - b) });
  } else {
    const slosh = water.sloshOffsetAt(FIXED.x, FIXED.z);
    window.__test.postImpactSamples.push({ t: Number(simTime.toFixed(4)), a, slosh });
  }
}

function summary() {
  const pre = window.__test.preImpactSamples;
  const post = window.__test.postImpactSamples;
  const maxPreDiff = pre.reduce((m, s) => Math.max(m, s.diff), 0);
  const baselineMatches = pre.length > 0 && maxPreDiff === 0;

  // Wall wave reaches FIXED (dist 2.5m from impact) at ~2.5/2.2 = 1.136s
  // after the trigger; look for a displacement spike near there.
  const wallEta = window.__test.triggeredAt + 2.5 / 2.2;
  let peakNear = 0;
  for (const s of post) {
    if (Math.abs(s.t - wallEta) < 0.6) peakNear = Math.max(peakNear, Math.abs(s.a));
  }

  // Sloshing: look at the sign of the slosh term across the post-impact
  // window — a genuine decaying oscillation crosses zero repeatedly.
  let signChanges = 0;
  let prevSign = 0;
  let maxSlosh = 0;
  for (const s of post) {
    maxSlosh = Math.max(maxSlosh, Math.abs(s.slosh));
    const sign = s.slosh > 1e-4 ? 1 : s.slosh < -1e-4 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) signChanges++;
    if (sign !== 0) prevSign = sign;
  }

  return {
    baselineMatches,
    maxPreDiff,
    preSampleCount: pre.length,
    wallSpikeNearEta: peakNear > 0.25, // wall amplitude up to 0.9m*strength; 0.25 is a safe "clearly spiked" bar
    wallSpikePeak: peakNear,
    sloshOscillates: signChanges >= 3 && maxSlosh > 0.01,
    sloshSignChanges: signChanges,
    sloshMaxAbs: maxSlosh,
    overflowTriggered: water ? water.overflowMesh.visible || window.__test._overflowSeenVisible === true : false,
  };
}

function animate(now) {
  requestAnimationFrame(animate);
  let dtReal = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
  dtReal = Math.min(dtReal, 0.1);
  simTime += dtReal;

  if (!triggered && simTime >= IDLE_DURATION && water) {
    water.megaImpact(IMPACT.x, IMPACT.z, 1.0);
    window.__test.triggeredAt = simTime;
    triggered = true;
    console.log('[megawater-test] megaImpact fired at t=', simTime.toFixed(3));
  }

  try {
    if (water) water.update(dtReal, simTime);
    if (waterBaseline) waterBaseline.update(dtReal, simTime); // same clock, never triggered
  } catch (err) {
    recordError(err);
  }

  if (water && water.overflowMesh.visible) window.__test._overflowSeenVisible = true;

  sampleFrame();

  try {
    if (renderer) renderer.render(scene, camera);
  } catch (err) {
    recordError(err);
  }

  frameCount++;
  if (!firstFrame) {
    firstFrame = true;
    window.__test.ready = true;
  }

  hud.textContent =
    `frame: ${frameCount}\n` +
    `simTime: ${simTime.toFixed(3)}s  triggered: ${triggered}\n` +
    `displacementAt(fixed): ${water ? water.displacementAt(FIXED.x, FIXED.z).toFixed(4) : 'n/a'}\n` +
    `sloshOffsetAt(fixed): ${water ? water.sloshOffsetAt(FIXED.x, FIXED.z).toFixed(4) : 'n/a'}\n` +
    `overflow visible: ${water ? water.overflowMesh.visible : 'n/a'}\n` +
    `preSamples: ${window.__test.preImpactSamples.length}  postSamples: ${window.__test.postImpactSamples.length}\n` +
    `errors: ${window.__test.errors.length}`;

  if (simTime > RUN_DURATION + 1) {
    // Stop growing the sample arrays once the scripted window is over.
    // (Rendering keeps going so a late screenshot still shows something.)
  }
}

// -------------------------------------------------------------------
// Resize
// -------------------------------------------------------------------
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (renderer) renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', handleResize);
handleResize();

requestAnimationFrame(animate);
