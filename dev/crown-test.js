// Standalone shape/motion harness for src/splash.js (R2).
//
// watershading.js and droplets.js don't exist yet (parallel development),
// so this stubs a minimal waterCtx: grabPass:null (NO_GRAB fallback path
// inside splash.js's own fallback WATER_GLSL) and a tiny DropletSystem
// stand-in that visualizes emit()/emitSpray() calls as simple instanced
// spheres, purely so finger pinch-off timing/position/velocity can be
// judged visually. This file is dev-only scaffolding, not shipped.

import * as THREE from 'three';
import { SplashFX } from '../src/splash.js';

const WATER_LAYER = 1; // matches splash.js's contract-default fallback

const canvas = document.getElementById('canvas');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(960, 720, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x1a2c3d, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2c3d);

const camera = new THREE.PerspectiveCamera(42, 960 / 720, 0.05, 50);
camera.layers.enable(WATER_LAYER); // splash meshes live on WATER_LAYER

const sun = new THREE.DirectionalLight(0xfff3d6, 2.2);
sun.position.set(0.4, 0.82, 0.35).multiplyScalar(6);
sun.layers.enableAll();
scene.add(sun);
const ambient = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a2a, 0.8);
ambient.layers.enableAll();
scene.add(ambient);

// ---- simple blue "pool" plane with a light grid for parallax/scale cues ----
function makeGridTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e6fa8';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  const step = size / 16;
  for (let i = 0; i <= 16; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const planeGeo = new THREE.CircleGeometry(6, 64);
const planeMat = new THREE.MeshStandardMaterial({ map: makeGridTexture(), roughness: 0.6, metalness: 0.0 });
const plane = new THREE.Mesh(planeGeo, planeMat);
plane.rotation.x = -Math.PI / 2;
plane.layers.enableAll();
scene.add(plane);

// ---- minimal DropletSystem stub implementing the R3 contract signature ----
class StubDroplets {
  constructor(scene) {
    this.scene = scene;
    this.max = 600;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcdeeff, transparent: true, opacity: 0.9, roughness: 0.1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.count = 0;
    this.mesh.layers.enableAll();
    scene.add(this.mesh);
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.age = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.active = new Uint8Array(this.max);
    this.cursor = 0;

    this.sprayMax = 1200;
    const sgeo = new THREE.SphereGeometry(1, 6, 5);
    const smat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    this.sprayMesh = new THREE.InstancedMesh(sgeo, smat, this.sprayMax);
    this.sprayMesh.count = 0;
    this.sprayMesh.layers.enableAll();
    scene.add(this.sprayMesh);
    this.sPos = new Float32Array(this.sprayMax * 3);
    this.sVel = new Float32Array(this.sprayMax * 3);
    this.sLife = new Float32Array(this.sprayMax);
    this.sAge = new Float32Array(this.sprayMax);
    this.sActive = new Uint8Array(this.sprayMax);
    this.sCursor = 0;

    this.emitLog = []; // for debugging/inspection from playwright
  }

  emit(opts) {
    const rng = opts.rng || Math.random;
    const n = opts.count || 1;
    this.emitLog.push({ type: 'emit', t: this._t, origin: opts.origin.clone(), n });
    for (let i = 0; i < n; i++) {
      const idx = this.cursor % this.max; this.cursor++;
      if (!this.active[idx]) this.active[idx] = 1;
      const b = idx * 3;
      this.pos[b] = opts.origin.x; this.pos[b + 1] = opts.origin.y; this.pos[b + 2] = opts.origin.z;
      const spread = opts.spread || 0;
      const jx = (rng() - 0.5) * spread, jy = (rng() - 0.5) * spread * 0.5, jz = (rng() - 0.5) * spread;
      let vx = opts.dir.x + jx, vy = opts.dir.y + jy, vz = opts.dir.z + jz;
      const len = Math.hypot(vx, vy, vz) || 1;
      const spd = opts.speed[0] + rng() * (opts.speed[1] - opts.speed[0]);
      vx = (vx / len) * spd; vy = (vy / len) * spd; vz = (vz / len) * spd;
      this.vel[b] = vx; this.vel[b + 1] = vy; this.vel[b + 2] = vz;
      this.life[idx] = 1.1 + rng() * 0.4;
      this.age[idx] = 0;
      this.size[idx] = opts.size ? opts.size[0] + rng() * (opts.size[1] - opts.size[0]) : 0.04;
    }
  }

  emitSpray(opts) {
    const rng = opts.rng || Math.random;
    const n = opts.count || 1;
    this.emitLog.push({ type: 'spray', t: this._t, origin: opts.origin.clone(), n });
    for (let i = 0; i < n; i++) {
      const idx = this.sCursor % this.sprayMax; this.sCursor++;
      this.sActive[idx] = 1;
      const b = idx * 3;
      this.sPos[b] = opts.origin.x; this.sPos[b + 1] = opts.origin.y; this.sPos[b + 2] = opts.origin.z;
      const spread = opts.spread || 0.3;
      const jx = (rng() - 0.5) * spread * 2, jy = (rng() - 0.5) * spread, jz = (rng() - 0.5) * spread * 2;
      let vx = opts.dir.x + jx, vy = Math.max(0.05, opts.dir.y + jy), vz = opts.dir.z + jz;
      const len = Math.hypot(vx, vy, vz) || 1;
      const spd = opts.speed[0] + rng() * (opts.speed[1] - opts.speed[0]);
      vx = (vx / len) * spd; vy = (vy / len) * spd; vz = (vz / len) * spd;
      this.sVel[b] = vx; this.sVel[b + 1] = vy; this.sVel[b + 2] = vz;
      const lr = opts.life || [0.2, 0.5];
      this.sLife[idx] = lr[0] + rng() * (lr[1] - lr[0]);
      this.sAge[idx] = 0;
    }
  }

  isAlive() { return this.cursor > 0 || this.sCursor > 0; }

  update(dt, time) {
    this._t = time;
    const G = 12.5;
    let w = 0;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.active[i] = 0; continue; }
      const b = i * 3;
      this.vel[b + 1] -= G * dt;
      this.pos[b] += this.vel[b] * dt;
      this.pos[b + 1] += this.vel[b + 1] * dt;
      this.pos[b + 2] += this.vel[b + 2] * dt;
      if (this.pos[b + 1] < 0) { this.pos[b + 1] = 0; this.active[i] = 0; continue; }
      _mtx.compose(
        _vecA.set(this.pos[b], this.pos[b + 1], this.pos[b + 2]),
        _quatA.identity(),
        _scaleA.setScalar(this.size[i])
      );
      this.mesh.setMatrixAt(w, _mtx);
      w++;
      if (w >= this.max) break;
    }
    this.mesh.count = w;
    if (w > 0) this.mesh.instanceMatrix.needsUpdate = true;

    let ws = 0;
    for (let i = 0; i < this.sprayMax; i++) {
      if (!this.sActive[i]) continue;
      this.sAge[i] += dt;
      if (this.sAge[i] >= this.sLife[i]) { this.sActive[i] = 0; continue; }
      const b = i * 3;
      this.sVel[b + 1] -= G * 0.3 * dt;
      this.sPos[b] += this.sVel[b] * dt;
      this.sPos[b + 1] += this.sVel[b + 1] * dt;
      this.sPos[b + 2] += this.sVel[b + 2] * dt;
      const fade = 1 - this.sAge[i] / this.sLife[i];
      _mtx.compose(
        _vecA.set(this.sPos[b], this.sPos[b + 1], this.sPos[b + 2]),
        _quatA.identity(),
        _scaleA.setScalar(0.02 * (0.5 + fade))
      );
      this.sprayMesh.setMatrixAt(ws, _mtx);
      ws++;
      if (ws >= this.sprayMax) break;
    }
    this.sprayMesh.count = ws;
    if (ws > 0) this.sprayMesh.instanceMatrix.needsUpdate = true;
  }
}
const _vecA = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _scaleA = new THREE.Vector3();
const _mtx = new THREE.Matrix4();

const droplets = new StubDroplets(scene);
const waterCtx = { grabPass: null, uniforms: null, droplets };

const splash = new SplashFX(scene, waterCtx);

// ---- synthetic ImpactSpecs (per docs/CONTRACTS.md ImpactSpec shape) ----
function heavyballSpec() {
  return {
    point: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0.4, -9.2, 0),
    speed: 9.2,
    energy: 0.88,
    size: 0.35,
    def: { id: 'heavyball', density: 2.6, softness: 0, radius: 0.35, color: 0x3355ff },
    flatness: 0.1,
    oblique: 0.04,
    dir: new THREE.Vector2(1, 0),
    cupTrap: 0,
    spin: 0.5,
    seed: 0x1234abcd >>> 0,
    isSecondary: false,
  };
}
function discSpec() {
  return {
    point: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(-2.1, -5.4, 2.0),
    speed: 6.2,
    energy: 0.6,
    size: 0.42,
    def: { id: 'disc', density: 1.3, softness: 0, radius: 0.42, color: 0xff9933 },
    flatness: 0.92,
    oblique: 0.42,
    dir: new THREE.Vector2(-0.72, 0.69),
    cupTrap: 0,
    spin: 2.1,
    seed: 0x9f7a3e11 >>> 0,
    isSecondary: false,
  };
}

function frameCamera(kind) {
  // Crowns can rise well past 2m and fling droplets ~1.5-2m out radially,
  // so frame generously (wide enough to keep the whole rise/flare/finger/
  // pinch-off/fall arc plus flying droplets in shot for all 6 time points).
  if (kind === 'disc') {
    camera.position.set(3.1, 2.1, 3.9);
  } else {
    camera.position.set(3.0, 2.3, 4.1);
  }
  camera.lookAt(0, 0.9, 0);
}

let t = 0;
window.__test = {
  ready: false,
  run(kind) {
    const spec = kind === 'disc' ? discSpec() : heavyballSpec();
    t = 0;
    frameCamera(kind);
    splash.trigger(spec);
    droplets.update(0, 0);
    renderer.render(scene, camera);
    return { life: splash.slots.find((s) => s.spec === spec)?.life };
  },
  advanceTo(target, stepDt) {
    const dt = stepDt || 1 / 90;
    while (t < target - 1e-6) {
      const step = Math.min(dt, target - t);
      splash.update(step, t);
      droplets.update(step, t);
      t += step;
    }
    renderer.render(scene, camera);
    return { t, active: splash.isActive() };
  },
  isActive() { return splash.isActive(); },
  emitLog() { return droplets.emitLog; },
};

renderer.render(scene, camera);
window.__test.ready = true;
window.__testDebug = { scene, camera, droplets, splash, renderer, THREE, heavyballSpec, discSpec };
hud.textContent = 'ready';
