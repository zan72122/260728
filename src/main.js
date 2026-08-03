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
// Subsystems — each construction is isolated so one broken module
// doesn't take the whole app down.
// ---------------------------------------------------------------------
let sceneEnv = null;
let water = null;
let splash = null;
let underwater = null;
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
  water = new WaterSurface(scene);
} catch (err) {
  recordError(err);
}

try {
  splash = new SplashFX(scene);
} catch (err) {
  recordError(err);
}

try {
  underwater = new UnderwaterFX(scene);
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

if (splash) {
  splash.onDropletLand = (x, z, r) => {
    try {
      if (water) water.addRipple(x, z, 0.06);
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

function drop(toyId, platformId, vx = 0, vy = 0, vz = 0) {
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
      cupTrap: s.cupTrap,
      seed: s.seed,
      isSecondary: !!s.isSecondary,
      toyId: s.def && s.def.id ? s.def.id : null,
    };
  }
  return { bodies, lastImpact, fps: Math.round(fpsAvg * 10) / 10 };
}

window.__lab.drop = drop;
window.__lab.state = state;

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

  try {
    if (renderer && cameraFX && cameraFX.camera) {
      renderer.render(scene, cameraFX.camera);
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
