// dev/jet-test.js — standalone visual test harness for the R4 Worthington
// jet rewrite in src/underwater.js. NOT part of the game; verification only.
//
// Scene: patterned backdrop (grid wall, to reveal refraction bending) +
// water-blue ground plane representing the pool surface at y=0. Instantiates
// UnderwaterFX with a real waterCtx (GrabPass + sharedWaterUniforms from
// watershading.js, plus a real DropletSystem from droplets.js if it loads —
// wrapped so pinch-off emits are also logged to the HUD/console; falls back
// to a tiny console-logging stub droplets object if droplets.js is missing
// or throws, per the R4 task spec), then fires a single synthetic
// high-energy clean-entry ImpactSpec and lets the jet play out in real time
// so a screenshot time-series can capture its full life (mound -> rise ->
// neck -> pinch-off -> fall).

import * as THREE from 'three';
import { UnderwaterFX } from '../src/underwater.js';

window.__test = {
  ready: false,
  errors: [],
  triggeredAt: 0,
  jetsInfo: () => [],
  cavitiesInfo: () => [],
  isActive: () => false,
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
scene.background = new THREE.Color(0x1a3a52);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0.2, 2.0, 6.2);
camera.lookAt(0, 1.2, 0);

// -- lights ---------------------------------------------------------------
const dir = new THREE.DirectionalLight(0xffffff, 2.4);
dir.position.set(4, 6, 3);
scene.add(dir);
const hemi = new THREE.HemisphereLight(0xaaddff, 0x334455, 0.8);
scene.add(hemi);

// -- patterned backdrop (grid wall) so refraction bending is unmistakable --
function makeGridTexture(bg, line) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 5;
  const step = size / 12;
  for (let i = 0; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  // A few bright accent squares so distortion of a "tower" pattern reads
  // clearly, echoing the acceptance-test backdrop style used elsewhere.
  ctx.fillStyle = '#ff5d5d';
  ctx.fillRect(step * 2, step * 2, step * 2, step * 8);
  ctx.fillStyle = '#5dff8f';
  ctx.fillRect(step * 8, step * 1, step * 2, step * 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}
const backdropTex = makeGridTexture('#ffe14d', '#8a1f6e');
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 8),
  new THREE.MeshStandardMaterial({ map: backdropTex, roughness: 0.8 })
);
backdrop.position.set(0, 2.5, -3.5);
scene.add(backdrop);

// -- water-blue ground plane (stands in for the pool surface at y=0) ------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a7fb0, roughness: 0.35, metalness: 0.05 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// -------------------------------------------------------------------
// waterCtx: GrabPass + sharedWaterUniforms from watershading.js (imported
// directly since it's a hard dependency of underwater.js anyway — if this
// import fails, underwater.js itself would already have failed to load, so
// there is no meaningful "inline stub" path distinct from that failure).
// droplets: the real DropletSystem from droplets.js, wrapped so pinch-off
// emits are visible in the HUD; falls back to a console-logging stub if
// droplets.js is missing or throws, per the R4 task spec.
// -------------------------------------------------------------------
let WS = null;
try {
  WS = await import('../src/watershading.js');
} catch (err) {
  recordError(err);
}

let grabPass = null;
let uniforms;
if (WS) {
  if (renderer && renderer.capabilities && renderer.capabilities.isWebGL2) {
    try {
      grabPass = new WS.GrabPass(renderer);
    } catch (err) {
      recordError(err);
    }
  }
  uniforms = WS.sharedWaterUniforms(grabPass);
} else {
  // Minimal inline stub matching sharedWaterUniforms' shape, only reached if
  // watershading.js itself is entirely absent/broken.
  uniforms = {
    uSceneTex: { value: null },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
    uWaterAbsorb: { value: new THREE.Vector3(0.35, 0.09, 0.06) },
    uTimeW: { value: 0 },
  };
}
uniforms.uSunDir.value.set(0.45, 0.82, 0.25).normalize();

const waterCtx = { grabPass, uniforms, droplets: null };

let dropletEmitLog = 0;
try {
  const { DropletSystem } = await import('../src/droplets.js');
  const real = new DropletSystem(scene, waterCtx);
  // Wrap emit() so we can see pinch-off calls land in the HUD without
  // altering droplets.js's own behavior/ownership.
  const realEmit = real.emit.bind(real);
  real.emit = (opts) => {
    dropletEmitLog++;
    console.log('[jet-test] droplets.emit()', { count: opts.count, size: opts.size, origin: opts.origin && opts.origin.toArray ? opts.origin.toArray() : opts.origin });
    return realEmit(opts);
  };
  waterCtx.droplets = real;
} catch (err) {
  console.error('[jet-test] droplets.js unavailable, using console-logging stub:', err);
  waterCtx.droplets = {
    emit(opts) {
      dropletEmitLog++;
      console.log('[jet-test] STUB droplets.emit()', opts);
    },
    emitSpray() {},
    isAlive: () => false,
    update() {},
  };
}

// -------------------------------------------------------------------
// UnderwaterFX under test.
// -------------------------------------------------------------------
let underwater = null;
try {
  underwater = new UnderwaterFX(scene, waterCtx);
} catch (err) {
  recordError(err);
}

window.__test.jetsInfo = () => {
  if (!underwater) return [];
  return underwater.jets.map((j) => ({
    state: j.state,
    activeAge: Number(j.activeAge.toFixed(3)),
    curTopY: Number(j.curTopY.toFixed(3)),
    height: Number(j.height.toFixed(3)),
    severed: j.severed,
    pinchFired: j.pinchFired,
    visible: j.mesh.visible,
  }));
};
window.__test.cavitiesInfo = () => {
  if (!underwater) return [];
  return underwater.cavities
    .filter((c) => c.active)
    .map((c) => ({ age: Number(c.age.toFixed(3)), life: Number(c.life.toFixed(3)) }));
};
window.__test.isActive = () => (underwater ? underwater.isActive() : false);
window.__test.dropletEmitCount = () => dropletEmitLog;

// A synthetic high-energy clean-entry ImpactSpec (heavy-ball-like, straight
// drop from the high platform): energy=1 (max), flatness low (narrow clean
// entry -> strong delayed jet), no oblique/spin/cupTrap.
const SYNTHETIC_SPEC = {
  point: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(0, -9.5, 0),
  speed: 9.5,
  energy: 1.0,
  size: 0.35,
  def: { id: 'heavyball', softness: 0 },
  flatness: 0.06,
  oblique: 0,
  dir: new THREE.Vector2(0, 0),
  cupTrap: 0,
  spin: 0,
  seed: 0xC0FFEE,
  isSecondary: false,
};

function triggerJet() {
  if (!underwater) return;
  try {
    underwater.trigger(SYNTHETIC_SPEC);
    window.__test.triggeredAt = performance.now() / 1000;
    console.log('[jet-test] triggered synthetic spec', SYNTHETIC_SPEC);
  } catch (err) {
    recordError(err);
  }
}
window.__test.trigger = triggerJet;
// Exposed for ad-hoc QA only (causality / pooling checks) — not part of the
// production contract.
window.__test.underwater = underwater;
window.__test.SYNTHETIC_SPEC = SYNTHETIC_SPEC;

// -------------------------------------------------------------------
// Resize
// -------------------------------------------------------------------
const sizeScratch = new THREE.Vector2();
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (renderer) renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (renderer) {
    const size = renderer.getDrawingBufferSize(sizeScratch);
    if (grabPass) grabPass.setSize(size.x, size.y);
    uniforms.uViewport.value.set(size.x, size.y);
  }
}
window.addEventListener('resize', handleResize);
handleResize();

// -------------------------------------------------------------------
// Two-pass render loop, mirroring the main.js contract exactly:
//   1. opaque pass (WATER_LAYER disabled)
//   2. grab-pass capture + WATER_LAYER-only pass
// -------------------------------------------------------------------
const WATER_LAYER = (WS && typeof WS.WATER_LAYER === 'number') ? WS.WATER_LAYER : 1;
scene.traverse((obj) => {
  if (obj.isLight) obj.layers.enableAll();
});

let firstFrame = false;
let frameCount = 0;
let lastNow = performance.now();
let started = false;

function animate(now) {
  requestAnimationFrame(animate);
  let dtReal = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
  dtReal = Math.min(dtReal, 0.1);
  const dt = Math.min(dtReal, 1 / 30);
  const t = now / 1000;

  uniforms.uTimeW.value = t;
  if (renderer) {
    const size = renderer.getDrawingBufferSize(sizeScratch);
    uniforms.uViewport.value.set(size.x, size.y);
  }

  try {
    if (underwater) underwater.update(dt, t);
    if (waterCtx.droplets && typeof waterCtx.droplets.update === 'function') waterCtx.droplets.update(dt, t);
  } catch (err) {
    recordError(err);
  }

  try {
    if (renderer) {
      camera.layers.disable(WATER_LAYER);
      renderer.render(scene, camera);

      const active = (underwater ? underwater.isActive() : false) || (waterCtx.droplets && waterCtx.droplets.isAlive && waterCtx.droplets.isAlive());
      if (active) {
        if (grabPass) grabPass.capture(renderer);
        renderer.autoClear = false;
        camera.layers.enable(WATER_LAYER);
        camera.layers.disable(0);
        try {
          renderer.render(scene, camera);
        } finally {
          camera.layers.enable(0);
          camera.layers.disable(WATER_LAYER);
          renderer.autoClear = true;
        }
      }
    }
  } catch (err) {
    recordError(err);
  }

  frameCount++;
  if (!firstFrame) {
    firstFrame = true;
    window.__test.ready = true;
  }
  if (!started) {
    started = true;
    // Trigger on the very first real frame so external timers (screenshot
    // series) can key off page-load time.
    triggerJet();
  }

  const jt = window.__test.jetsInfo()[0] || {};
  hud.textContent =
    `frame: ${frameCount}\n` +
    `t-since-trigger: ${(t - window.__test.triggeredAt).toFixed(3)}s\n` +
    `jet0: ${jt.state} age=${jt.activeAge} topY=${jt.curTopY}/${jt.height} severed=${jt.severed}\n` +
    `dropletEmits: ${dropletEmitLog}\n` +
    `isActive: ${window.__test.isActive()}\n` +
    `errors: ${window.__test.errors.length}`;
}

requestAnimationFrame(animate);
