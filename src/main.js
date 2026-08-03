// Bootstrap — owner A. Wires every subsystem together exactly per
// docs/CONTRACTS.md. Keep this file defensive: a failure in one subsystem
// must not prevent the others (or the debug API) from working.

import * as THREE from 'three';
import { PLATFORMS } from './constants.js';
import { SceneEnv } from './scene.js';
import { WaterSurface } from './water.js';
import { SplashFX } from './splash.js';
import { UnderwaterFX } from './underwater.js';
import { TOYS } from './toys.js';
import { Physics } from './physics.js';
import { InputController } from './input.js';
import { CameraFX } from './cameraFX.js';
import { AudioFX } from './audio.js';
import { WATER_LAYER, GrabPass, sharedWaterUniforms } from './watershading.js';
import { DropletSystem } from './droplets.js';

// ---------------------------------------------------------------------
// __lab debug API — set up FIRST so window.onerror can record failures
// that happen while the rest of this module boots.
// ---------------------------------------------------------------------
window.__lab = {
  ready: false,
  errors: [],
  drop: () => null,
  state: () => ({ bodies: 0, lastImpact: null, fps: 0 }),
};

function recordError(err) {
  try {
    const msg = err && err.stack ? err.stack : err && err.message ? err.message : String(err);
    window.__lab.errors.push(msg);
  } catch (_) {
    /* never let error recording itself throw */
  }
  // console.error is allowed (no console.log spam rule only bans log spam).
  console.error(err);
}

window.onerror = function (message, source, lineno, colno, error) {
  try {
    window.__lab.errors.push(
      `${message} @ ${source || '?'}:${lineno || 0}:${colno || 0}`
    );
  } catch (_) {
    /* ignore */
  }
  return false; // let the browser also log it to devtools
};

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event && event.reason;
    const msg = reason && reason.stack ? reason.stack : reason && reason.message ? reason.message : String(reason);
    window.__lab.errors.push(`unhandledrejection: ${msg}`);
  } catch (_) {
    /* ignore */
  }
});

// ---------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------
const canvas = document.getElementById('canvas');

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Cheerful fallback clear color for the first frame or two before
  // SceneEnv installs its sky background.
  renderer.setClearColor(0x7fd8ff, 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
} catch (err) {
  recordError(err);
}

const scene = new THREE.Scene();

// ---------------------------------------------------------------------
// Water shading infra (R1, docs/CONTRACTS-SPLASH2.md) — the grab-pass and
// shared uniforms are created before any water-layer consumer so waterCtx
// is ready for their constructors. WebGL1 (or a renderer that failed to
// init) degrades gracefully: grabPass stays null, uSceneTex stays null,
// and consumers are expected to fall back to the NO_GRAB look.
// ---------------------------------------------------------------------
let grabPass = null;
if (renderer && renderer.capabilities && renderer.capabilities.isWebGL2) {
  try {
    grabPass = new GrabPass(renderer);
  } catch (err) {
    recordError(err);
    grabPass = null;
  }
}
const waterUniforms = sharedWaterUniforms(grabPass);
// waterCtx.droplets starts null per the droplets.js contract (the
// DropletSystem constructor receives this same object before it exists
// yet) and is filled in right after DropletSystem is constructed below.
const waterCtx = { grabPass, uniforms: waterUniforms, droplets: null };
const _drawingBufferScratch = new THREE.Vector2();

// ---------------------------------------------------------------------
// Subsystems — each construction is isolated so one broken module
// doesn't take the whole app down.
// ---------------------------------------------------------------------
let sceneEnv = null;
let water = null;
let splash = null;
let underwater = null;
let droplets = null;
let physics = null;
let cameraFX = null;
let audio = null;
let input = null;

try {
  sceneEnv = new SceneEnv(scene);
} catch (err) {
  recordError(err);
}

try {
  if (sceneEnv) {
    // Pass 2 (WATER_LAYER-only render) restricts the camera to layer
    // WATER_LAYER; lights are filtered by the same camera.layers test as
    // meshes, so every light must be visible on ALL layers or water-layer
    // materials would go unlit in pass 2 (and pass 1 would lose nothing
    // since layer 0 stays enabled there too).
    scene.traverse((obj) => {
      if (obj && obj.isLight && obj.layers && typeof obj.layers.enableAll === 'function') {
        obj.layers.enableAll();
      }
    });
    // uSunDir: world-space direction TO the sun, matching scene.js's
    // DirectionalLight (position-to-target, normalized).
    const sun = sceneEnv.sun;
    if (sun && sun.position) {
      const targetPos = sun.target && sun.target.position ? sun.target.position : new THREE.Vector3(0, 0, 0);
      waterUniforms.uSunDir.value.copy(sun.position).sub(targetPos).normalize();
    }
  }
} catch (err) {
  recordError(err);
}

try {
  water = new WaterSurface(scene);
} catch (err) {
  recordError(err);
}

try {
  droplets = new DropletSystem(scene, waterCtx);
} catch (err) {
  recordError(err);
}
waterCtx.droplets = droplets;

try {
  splash = new SplashFX(scene, waterCtx);
} catch (err) {
  recordError(err);
}

try {
  underwater = new UnderwaterFX(scene, waterCtx);
} catch (err) {
  recordError(err);
}

try {
  physics = new Physics({
    scene,
    getWaterHeight: (x, z) => (water ? water.displacementAt(x, z) : 0),
  });
} catch (err) {
  recordError(err);
}

try {
  cameraFX = renderer ? new CameraFX(renderer) : null;
} catch (err) {
  recordError(err);
}

try {
  audio = new AudioFX();
} catch (err) {
  recordError(err);
}

try {
  input = new InputController({
    dom: canvas,
    getCamera: () => (cameraFX ? cameraFX.camera : null),
    physics,
    sceneEnv,
    audio,
    onPlatformChange: () => {
      /* InputController owns respawn behavior per contract; no extra
         bookkeeping needed here. */
    },
  });
} catch (err) {
  recordError(err);
}

// ---------------------------------------------------------------------
// Callback wiring — exactly per docs/CONTRACTS.md "src/main.js — A".
// ---------------------------------------------------------------------
let lastImpactSpec = null;

if (physics) {
  physics.onImpact = (spec) => {
    lastImpactSpec = spec;
    try {
      if (water) water.addRipple(spec.point.x, spec.point.z, Math.min(1, spec.energy + 0.15));
      if (splash) splash.trigger(spec);
      if (underwater) underwater.trigger(spec);
      if (cameraFX) cameraFX.onImpact(spec);
      if (audio) audio.onImpact(spec);
    } catch (err) {
      recordError(err);
    }
  };

  physics.onResurface = (pos, def) => {
    try {
      if (water) water.addRipple(pos.x, pos.z, 0.3);
      if (underwater) underwater.triggerResurface(pos, def);
      if (audio) audio.onResurface(def);
    } catch (err) {
      recordError(err);
    }
  };
}

// Per docs/CONTRACTS-SPLASH2.md v2: droplet-landing ripples now come from
// DropletSystem, not SplashFX — `splash.onDropletLand` is REMOVED in the v2
// contract (R2 keeps a no-op setter there for backward safety only). Wire
// the new callback instead; typeof-guard so this stays inert if droplets
// briefly lacks the property during parallel development.
if (droplets) {
  droplets.onDropletLand = (x, z, size) => {
    try {
      if (water) water.addRipple(x, z, Math.min(0.12, size * 0.5));
      if (splash && typeof splash.microSplash === 'function') splash.microSplash(x, z, size);
    } catch (err) {
      recordError(err);
    }
  };
}

// ---------------------------------------------------------------------
// __lab.drop / __lab.state
// ---------------------------------------------------------------------
function findToyDef(toyId) {
  if (!Array.isArray(TOYS)) return null;
  for (let i = 0; i < TOYS.length; i++) {
    if (TOYS[i].id === toyId) return TOYS[i];
  }
  return null;
}

function findPlatform(platformId) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    if (PLATFORMS[i].id === platformId) return PLATFORMS[i];
  }
  return PLATFORMS[0];
}

function drop(toyId, platformId, vx = 0, vy = 0, vz = 0, opts = null) {
  try {
    if (!physics) return null;
    const def = findToyDef(toyId);
    if (!def) {
      recordError(new Error(`__lab.drop: unknown toyId "${toyId}"`));
      return null;
    }
    const platform = findPlatform(platformId);
    const tip = platform.tip;
    const pos = new THREE.Vector3(tip.x, tip.y, tip.z);
    const body = physics.spawnToy(def, pos);
    if (opts) {
      if (opts.rotX !== undefined || opts.rotY !== undefined || opts.rotZ !== undefined) {
        const euler = new THREE.Euler(opts.rotX || 0, opts.rotY || 0, opts.rotZ || 0, 'XYZ');
        const q = new THREE.Quaternion().setFromEuler(euler);
        body.quat.copy(q);
        body.mesh.quaternion.copy(q);
      }
      if (opts.spin !== undefined) {
        body.angVel.set(opts.spin, 0, 0);
      }
    }
    physics.release(body, new THREE.Vector3(vx, vy, vz));
    return body;
  } catch (err) {
    recordError(err);
    return null;
  }
}

function state() {
  const bodies = physics && Array.isArray(physics.bodies) ? physics.bodies.length : 0;
  let lastImpact = null;
  if (lastImpactSpec) {
    const s = lastImpactSpec;
    lastImpact = {
      point: s.point ? { x: s.point.x, y: s.point.y, z: s.point.z } : null,
      speed: s.speed,
      energy: s.energy,
      flatness: s.flatness,
      oblique: s.oblique,
      dir: s.dir ? { x: s.dir.x, z: s.dir.y } : null,
      cupTrap: s.cupTrap,
      spin: s.spin,
      seed: s.seed,
      isSecondary: !!s.isSecondary,
      toyId: s.def && s.def.id ? s.def.id : null,
    };
  }
  return { bodies, lastImpact, fps: Math.round(fpsAvg * 10) / 10 };
}

window.__lab.drop = drop;
window.__lab.state = state;

// QA helper (engineer N, input-flow verification): CSS-pixel screen position
// of the currently-held toy's mesh, or null if nothing is held. Reuses the
// same "held body" scan as computeFocusPoint() below — no reach into
// InputController internals needed.
const _heldScreenScratch = new THREE.Vector3();
function heldScreenPos() {
  try {
    if (!physics || !Array.isArray(physics.bodies) || !cameraFX || !cameraFX.camera) return null;
    let body = null;
    for (let i = 0; i < physics.bodies.length; i++) {
      if (physics.bodies[i].state === 'held') {
        body = physics.bodies[i];
        break;
      }
    }
    if (!body || !body.mesh) return null;
    const camera = cameraFX.camera;
    _heldScreenScratch.copy(body.mesh.position).project(camera);
    const el = (renderer && renderer.domElement) || canvas;
    const rect = el.getBoundingClientRect();
    return {
      x: (_heldScreenScratch.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-_heldScreenScratch.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  } catch (err) {
    recordError(err);
    return null;
  }
}
window.__lab.heldScreenPos = heldScreenPos;

// QA helper (final acceptance pass): expose renderer.info.render so headless
// perf checks can read draw calls / triangles without instrumenting the
// render loop. Read-only snapshot, no behavior change.
function renderInfo() {
  try {
    if (!renderer || !renderer.info || !renderer.info.render) return null;
    const r = renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  } catch (err) {
    recordError(err);
    return null;
  }
}
window.__lab.renderInfo = renderInfo;

// ---------------------------------------------------------------------
// Water-layer render-loop helpers (R1, docs/CONTRACTS-SPLASH2.md).
// ---------------------------------------------------------------------
// Resilience: R2/R3/R4 (splash/droplets/underwater) may briefly lack the
// isActive()/isAlive() method the contract requires while under active
// development. Guard with typeof checks so main keeps working either way:
// if the object exists but doesn't have the method yet, ASSUME active
// (safer for co-developers to see their in-progress work rendered) rather
// than silently skipping pass 2; if the object never got constructed at
// all there is nothing to render, so treat that as inactive.
function isModuleActive(obj, methodName) {
  if (!obj) return false;
  if (typeof obj[methodName] !== 'function') return true;
  try {
    return !!obj[methodName]();
  } catch (err) {
    recordError(err);
    return true;
  }
}

function splashSystemsActive() {
  return (
    isModuleActive(splash, 'isActive') ||
    isModuleActive(underwater, 'isActive') ||
    isModuleActive(droplets, 'isAlive')
  );
}

let lastPass2Active = false;

// __lab.waterDebug() — mandated by the addendum for automated verification.
window.__lab.waterDebug = () => ({
  pass2Active: lastPass2Active,
  dropletsAlive: droplets && typeof droplets.isAlive === 'function' ? !!droplets.isAlive() : false,
  // DropletSystem doesn't expose a separate spray-only accessor in the
  // contract (only the combined isAlive()); use isSprayAlive() if a
  // consumer ever adds one, otherwise mirror isAlive() as the best
  // available signal.
  sprayAlive:
    droplets && typeof droplets.isSprayAlive === 'function'
      ? !!droplets.isSprayAlive()
      : droplets && typeof droplets.isAlive === 'function'
        ? !!droplets.isAlive()
        : false,
});

// ---------------------------------------------------------------------
// Resize / orientation handling
// ---------------------------------------------------------------------
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  try {
    if (renderer) renderer.setSize(w, h);
  } catch (err) {
    recordError(err);
  }
  try {
    // GrabPass must be sized in drawing-buffer pixels (post devicePixelRatio),
    // not CSS pixels, and uViewport (used by screenUV = gl_FragCoord/uViewport
    // in WATER_GLSL) must match exactly.
    if (renderer) {
      const size = renderer.getDrawingBufferSize(_drawingBufferScratch);
      if (grabPass) grabPass.setSize(size.x, size.y);
      waterUniforms.uViewport.value.set(size.x, size.y);
    }
  } catch (err) {
    recordError(err);
  }
  try {
    if (cameraFX) cameraFX.handleResize(w, h);
  } catch (err) {
    recordError(err);
  }
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => {
  // Mobile browsers can report stale innerWidth/innerHeight for a beat
  // right after the rotation event fires.
  setTimeout(handleResize, 60);
});

// ---------------------------------------------------------------------
// Main loop — real dt drives the camera, scaled dt (hit-stop/slow-mo)
// drives everything else.
// ---------------------------------------------------------------------
let lastNow = performance.now();
let fpsAvg = 60;
let firstFrameRendered = false;
const focusScratch = new THREE.Vector3(0, 0.3, 0);
// Scaled game-time accumulator for uTimeW — advances with dtScaled (so it
// slows/pauses during hit-stop and slow-mo, same as the splash/underwater
// update loops), NOT with wall-clock time.
let waterTimeAccum = 0;

function computeFocusPoint() {
  const bodies = (physics && physics.bodies) || [];
  let target = null;
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].state === 'held') {
      target = bodies[i];
      break;
    }
  }
  if (!target) {
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].state === 'flying') {
        target = bodies[i];
        break;
      }
    }
  }
  if (target && target.pos) {
    focusScratch.copy(target.pos);
  } else if (lastImpactSpec && lastImpactSpec.point) {
    focusScratch.copy(lastImpactSpec.point);
  } else {
    focusScratch.set(0, 0.3, 0);
  }
  return focusScratch;
}

function animate(now) {
  requestAnimationFrame(animate);

  let dtReal = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
  // Guard against huge jumps after a backgrounded tab / device sleep.
  dtReal = Math.min(dtReal, 0.25);

  const timeScale = cameraFX ? cameraFX.timeScale : 1;
  const dtScaled = Math.min(dtReal, 1 / 30) * timeScale;
  const timeSec = now / 1000;

  try {
    if (sceneEnv) sceneEnv.update(dtScaled, timeSec);
  } catch (err) {
    recordError(err);
  }
  try {
    if (water) water.update(dtScaled, timeSec);
  } catch (err) {
    recordError(err);
  }
  try {
    if (physics) physics.update(dtScaled);
  } catch (err) {
    recordError(err);
  }
  try {
    if (splash) splash.update(dtScaled, timeSec);
  } catch (err) {
    recordError(err);
  }
  try {
    if (underwater) underwater.update(dtScaled, timeSec);
  } catch (err) {
    recordError(err);
  }
  try {
    if (droplets) droplets.update(dtScaled, timeSec);
  } catch (err) {
    recordError(err);
  }
  try {
    if (input) input.update(dtScaled);
  } catch (err) {
    recordError(err);
  }
  try {
    if (cameraFX) cameraFX.setFocus(computeFocusPoint());
  } catch (err) {
    recordError(err);
  }
  try {
    if (cameraFX) cameraFX.update(dtReal, timeSec);
  } catch (err) {
    recordError(err);
  }

  // Keep the shared water uniforms fresh every frame (contract: uTimeW and
  // uViewport update every frame/resize, not just on resize).
  try {
    waterTimeAccum += dtScaled;
    waterUniforms.uTimeW.value = waterTimeAccum;
    if (renderer) {
      const size = renderer.getDrawingBufferSize(_drawingBufferScratch);
      waterUniforms.uViewport.value.set(size.x, size.y);
    }
  } catch (err) {
    recordError(err);
  }

  // -------------------------------------------------------------------
  // Two-pass render (docs/CONTRACTS-SPLASH2.md "main.js render-loop
  // change"): pass 1 is the opaque scene with WATER_LAYER hidden; pass 2
  // (skipped when idle) grabs pass 1's framebuffer for refraction, then
  // renders ONLY WATER_LAYER objects on top without clearing.
  // -------------------------------------------------------------------
  try {
    const camera = cameraFX && cameraFX.camera;
    if (renderer && camera) {
      camera.layers.disable(WATER_LAYER);
      renderer.render(scene, camera);

      const pass2Active = splashSystemsActive();
      lastPass2Active = pass2Active;

      if (pass2Active) {
        if (grabPass) grabPass.capture(renderer);
        renderer.autoClear = false;
        camera.layers.enable(WATER_LAYER);
        camera.layers.disable(0);
        try {
          renderer.render(scene, camera);
        } finally {
          // Always restore, even if pass 2 itself throws mid-render, so a
          // broken splash frame can't leave every subsequent frame dark
          // (layer 0 disabled) or smeared (autoClear left off).
          camera.layers.enable(0);
          camera.layers.disable(WATER_LAYER);
          renderer.autoClear = true;
        }
      }
    }
  } catch (err) {
    recordError(err);
  }

  // Rolling average fps (exponential moving average).
  const instFps = dtReal > 0.00001 ? 1 / dtReal : fpsAvg;
  fpsAvg += (instFps - fpsAvg) * 0.1;

  if (!firstFrameRendered) {
    firstFrameRendered = true;
    window.__lab.ready = true;
    const loadingEl = document.getElementById('loading-fallback');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

handleResize();
requestAnimationFrame(animate);
