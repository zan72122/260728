// dev/mega-test.js — standalone visual test harness for M2's
// src/megasplash.js (MegaSplashFX) + src/underwater.js's triggerMegaJet().
// NOT part of the game; verification only. Mirrors dev/jet-test.js's
// real two-pass render loop (GrabPass + shared water uniforms), plus a real
// DropletSystem and a real UnderwaterFX.
//
// Modes (via ?mode=... query param):
//   mega   (default) — fires a synthetic giantheavy-like mega ImpactSpec
//                       through BOTH megasplash.trigger() and
//                       underwater.triggerMegaJet() together, real time.
//   normal — fires a synthetic NORMAL (non-mega) heavyball-like ImpactSpec
//            through underwater.trigger() ONLY (megasplash never touched),
//            for a side-by-side regression comparison against the
//            unmodified jet look.

import * as THREE from 'three';
import { MegaSplashFX } from '../src/megasplash.js';
import { UnderwaterFX } from '../src/underwater.js';

window.__test = {
  ready: false,
  errors: [],
  triggeredAt: 0,
  mode: 'mega',
  megaInfo: () => null,
  jetsInfo: () => [],
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

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'normal' ? 'normal' : 'mega';
// ?auto=0 skips the built-in "trigger on first frame" behavior, so a test
// script can call pauseAtAge() BEFORE anything advances the sim clock (the
// render loop keeps running via requestAnimationFrame regardless of what a
// Playwright script does between commands, so priming the pause target
// after the trigger already fired is a race — this closes it).
const autoTrigger = params.get('auto') !== '0';
window.__test.mode = mode;

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
scene.background = new THREE.Color(0x123044);

// A wide, distant camera for mega mode (the column reaches 6-8m + a ~3m
// dome), a tighter one for the normal-jet regression comparison.
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
if (mode === 'mega') {
  camera.position.set(1.5, 6.5, 15);
  camera.lookAt(-1, 3.0, 0);
} else {
  camera.position.set(0.2, 2.0, 6.2);
  camera.lookAt(0, 1.2, 0);
}

// -- lights ---------------------------------------------------------------
const dir = new THREE.DirectionalLight(0xffffff, 2.4);
dir.position.set(4, 8, 3);
scene.add(dir);
const hemi = new THREE.HemisphereLight(0xaaddff, 0x334455, 0.8);
scene.add(hemi);

// -- tiled backdrop (grid wall) so refraction bending is unmistakable -----
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
  ctx.fillStyle = '#ff5d5d';
  ctx.fillRect(step * 2, step * 2, step * 2, step * 8);
  ctx.fillStyle = '#5dff8f';
  ctx.fillRect(step * 8, step * 1, step * 2, step * 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}
const backdropTex = makeGridTexture('#ffe14d', '#8a1f6e');
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 16),
  new THREE.MeshStandardMaterial({ map: backdropTex, roughness: 0.8 })
);
backdrop.position.set(0, 4, -7);
scene.add(backdrop);

// -- blue water disc (stands in for the pool surface at y=0) --------------
const water = new THREE.Mesh(
  new THREE.CircleGeometry(9, 96),
  new THREE.MeshStandardMaterial({ color: 0x2a7fb0, roughness: 0.3, metalness: 0.05 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0;
scene.add(water);

// -------------------------------------------------------------------
// waterCtx: real GrabPass + sharedWaterUniforms from watershading.js.
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
let sprayEmitLog = 0;
try {
  const { DropletSystem } = await import('../src/droplets.js');
  const real = new DropletSystem(scene, waterCtx);
  const realEmit = real.emit.bind(real);
  real.emit = (opts) => {
    dropletEmitLog++;
    return realEmit(opts);
  };
  const realEmitSpray = real.emitSpray.bind(real);
  real.emitSpray = (opts) => {
    sprayEmitLog++;
    return realEmitSpray(opts);
  };
  waterCtx.droplets = real;
} catch (err) {
  console.error('[mega-test] droplets.js unavailable, using console-logging stub:', err);
  waterCtx.droplets = {
    emit() { dropletEmitLog++; },
    emitSpray() { sprayEmitLog++; },
    isAlive: () => false,
    update() {},
  };
}

// -------------------------------------------------------------------
// UnderwaterFX + MegaSplashFX under test.
// -------------------------------------------------------------------
let underwater = null;
let megasplash = null;
try {
  underwater = new UnderwaterFX(scene, waterCtx);
} catch (err) {
  recordError(err);
}
try {
  megasplash = new MegaSplashFX(scene, waterCtx);
} catch (err) {
  recordError(err);
}

window.__test.jetsInfo = () => {
  if (!underwater) return [];
  return underwater.jets.map((j) => ({
    state: j.state,
    mega: j.mega,
    activeAge: Number(j.activeAge.toFixed(3)),
    curTopY: Number(j.curTopY.toFixed(3)),
    height: Number(j.height.toFixed(3)),
    baseRadius: Number(j.baseRadius.toFixed(3)),
    severed: j.severed,
    pinchFired: j.pinchFired,
    visible: j.mesh.visible,
  }));
};
window.__test.megaInfo = () => {
  if (!megasplash) return null;
  return {
    active: megasplash.active,
    age: Number(megasplash.age.toFixed(3)),
    sheetVisible: megasplash._sheetMesh.visible,
    flashVisible: megasplash._flashSprite.visible,
    domeVisible: megasplash._domeMesh.visible,
    domeOpacity: Number(megasplash._domeMat.uniforms.uOpacity.value.toFixed(3)),
    domeRadius: Number(megasplash._domeRadius.toFixed(3)),
    rainFired: megasplash._rainSchedule ? megasplash._rainSchedule.filter((b) => b.fired).length : 0,
    rainTotal: megasplash._rainSchedule ? megasplash._rainSchedule.length : 0,
  };
};
window.__test.isActive = () => ({
  underwater: underwater ? underwater.isActive() : false,
  megasplash: megasplash ? megasplash.isActive() : false,
  dropletsAlive: waterCtx.droplets && waterCtx.droplets.isAlive ? waterCtx.droplets.isAlive() : false,
});
window.__test.dropletEmitCount = () => dropletEmitLog;
window.__test.sprayEmitCount = () => sprayEmitLog;

// A synthetic giantheavy-like mega ImpactSpec (per the M2 task brief):
// point (-1,0,0), speed 18 (terminal velocity cap), energy 1, mega true,
// megaScale 3.1, size/def.radius 1.1, fixed seed.
const GIANTHEAVY_DEF = { id: 'giantheavy', radius: 1.1, density: 2.6, softness: 0, mega: true };
const MEGA_SPEC = {
  point: new THREE.Vector3(-1, 0, 0),
  velocity: new THREE.Vector3(0, -18, 0),
  speed: 18,
  energy: 1.0,
  size: 1.1,
  def: GIANTHEAVY_DEF,
  flatness: 0.1,
  oblique: 0,
  dir: new THREE.Vector2(0, 0),
  cupTrap: 0,
  spin: 0,
  seed: 0x5ea1abcd,
  isSecondary: false,
  mega: true,
  megaScale: 3.1,
};

// A synthetic NORMAL (non-mega) heavyball-like ImpactSpec, for the
// regression comparison frame — identical in spirit to jet-test.js's own
// synthetic spec, run through underwater.trigger() alone (megasplash is
// never invoked for a normal impact, per the "Mega impact routing" shared
// definition in docs/CONTRACTS-MEGA.md).
const NORMAL_SPEC = {
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

// Mode-agnostic "time since trigger" accumulator, driven by the same dt as
// megasplash/underwater (see animate() below) — used by the pauseAtAge()
// hook so it works identically in mega mode (where megasplash.age already
// tracks this) and normal mode (where megasplash is never triggered at all,
// so megasplash.age would stay 0 forever). Gated behind hasTriggered so it
// stays at exactly 0 (never satisfying an armed pauseAtAge() target) until
// a trigger function actually runs — otherwise a pauseAtAge() call made
// before triggering (to arm it ahead of the always-running rAF loop, see
// the hook's own comment) could itself already be satisfied by idle-frame
// drift and freeze the loop before the trigger/camera-move code even runs.
let simAge = 0;
let hasTriggered = false;

function triggerMega() {
  try {
    if (underwater) underwater.triggerMegaJet(MEGA_SPEC);
    if (megasplash) megasplash.trigger(MEGA_SPEC);
    window.__test.triggeredAt = performance.now() / 1000;
    simAge = 0;
    hasTriggered = true;
    console.log('[mega-test] triggered synthetic MEGA spec', MEGA_SPEC);
  } catch (err) {
    recordError(err);
  }
}
function triggerNormal() {
  try {
    if (underwater) underwater.trigger(NORMAL_SPEC);
    window.__test.triggeredAt = performance.now() / 1000;
    simAge = 0;
    hasTriggered = true;
    console.log('[mega-test] triggered synthetic NORMAL spec (regression)', NORMAL_SPEC);
  } catch (err) {
    recordError(err);
  }
}
window.__test.triggerMega = triggerMega;
window.__test.triggerNormal = triggerNormal;
window.__test.underwater = underwater;
window.__test.megasplash = megasplash;
window.__test.camera = camera;
window.__test.MEGA_SPEC = MEGA_SPEC;
window.__test.NORMAL_SPEC = NORMAL_SPEC;

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
// Two-pass render loop, mirroring dev/jet-test.js / main.js's contract:
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

// Pause-at-simulated-age hook: this sandbox's headless renderer is far
// slower than real time, and a single Playwright round-trip (evaluate +
// screenshot) can itself take long enough for several more simulated frames
// to elapse — enough to blow straight through a ~0.07s-long phase like the
// flash. pauseAtAge() freezes the loop (stops updating/rendering) the
// instant megasplash.age crosses the target, so a screenshot taken any time
// afterward still reflects that exact simulated moment.
let pauseAge = null;
let paused = false;
window.__test.pauseAtAge = (age) => { pauseAge = age; paused = false; };
window.__test.resume = () => { pauseAge = null; paused = false; };
window.__test.isPaused = () => paused;
window.__test.simAge = () => simAge;

function animate(now) {
  requestAnimationFrame(animate);
  if (paused) return;
  let dtReal = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
  dtReal = Math.min(dtReal, 0.1);
  const dt = Math.min(dtReal, 1 / 30);
  const t = now / 1000;

  if (hasTriggered) simAge += dt;

  uniforms.uTimeW.value = t;
  if (renderer) {
    const size = renderer.getDrawingBufferSize(sizeScratch);
    uniforms.uViewport.value.set(size.x, size.y);
  }

  try {
    if (underwater) underwater.update(dt, t);
    if (megasplash) megasplash.update(dt, t);
    if (waterCtx.droplets && typeof waterCtx.droplets.update === 'function') waterCtx.droplets.update(dt, t);
  } catch (err) {
    recordError(err);
  }

  // Freeze AFTER this frame renders (below) once the target simulated age
  // is reached, so the frame that gets frozen on-screen is the one at (or
  // just past) pauseAge — see the pauseAtAge() hook above.
  const willPauseAfterThisFrame = pauseAge !== null && simAge >= pauseAge;

  try {
    if (renderer) {
      camera.layers.disable(WATER_LAYER);
      renderer.render(scene, camera);

      const active =
        (underwater ? underwater.isActive() : false) ||
        (megasplash ? megasplash.isActive() : false) ||
        (waterCtx.droplets && waterCtx.droplets.isAlive && waterCtx.droplets.isAlive());
      if (active) {
        if (grabPass) grabPass.capture(renderer);
        renderer.autoClear = false;
        camera.layers.enable(WATER_LAYER);
        camera.layers.disable(0);
        const bg = scene.background;
        scene.background = null;
        try {
          renderer.render(scene, camera);
        } finally {
          camera.layers.enable(0);
          camera.layers.disable(WATER_LAYER);
          renderer.autoClear = true;
          scene.background = bg;
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
  if (!started && autoTrigger) {
    started = true;
    if (mode === 'normal') triggerNormal();
    else triggerMega();
  }

  const mi = window.__test.megaInfo();
  const jt = window.__test.jetsInfo().find((j) => j.mega) || window.__test.jetsInfo()[0] || {};
  hud.textContent =
    `mode: ${mode}\n` +
    `frame: ${frameCount}\n` +
    `t-since-trigger: ${(t - window.__test.triggeredAt).toFixed(3)}s\n` +
    `jet: ${jt.state} mega=${jt.mega} age=${jt.activeAge} topY=${jt.curTopY}/${jt.height} severed=${jt.severed}\n` +
    (mi ? `dome: vis=${mi.domeVisible} op=${mi.domeOpacity} r=${mi.domeRadius} rain=${mi.rainFired}/${mi.rainTotal}\n` : '') +
    `dropletEmits: ${dropletEmitLog} sprayEmits: ${sprayEmitLog}\n` +
    `errors: ${window.__test.errors.length}`;

  if (willPauseAfterThisFrame) paused = true;
}

requestAnimationFrame(animate);
