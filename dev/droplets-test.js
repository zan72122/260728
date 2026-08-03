// Standalone visual test harness for src/droplets.js — NOT part of the game.
// Renders a bright sky + patterned ground/backdrop so refraction distortion
// through the chunky droplets is visible, sets up a minimal grab-pass (since
// src/watershading.js may not exist yet — R1's parallel work), fires a few
// deterministic emit() bursts + emitSpray() calls, and exposes small debug
// hooks for the Playwright verification script.

import * as THREE from 'three';
import { DropletSystem } from '../src/droplets.js';
import { mulberry32 } from '../src/rng.js';

const WATER_LAYER = 1;

const canvas = document.getElementById('canvas');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd7ff);
scene.fog = new THREE.Fog(0xbdeeff, 20, 60);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 1.7, 5.2);
camera.lookAt(0, 1.1, 0);

// ---------------------------------------------------------------------
// Sky dome (cheap gradient, matches scene.js's approach)
// ---------------------------------------------------------------------
{
  const geo = new THREE.SphereGeometry(50, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x3fa9f5) },
      bottomColor: { value: new THREE.Color(0xe7f8ff) },
    },
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 topColor; uniform vec3 bottomColor;
      void main() { float h = clamp(vPos.y / 50.0, 0.0, 1.0); gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.55)), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  scene.add(dome);
}

// ---------------------------------------------------------------------
// Sun (directional light) — direction TO the sun is normalize(position).
// ---------------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.position.set(3.5, 6, 3);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfe9ff, 0xfff0cf, 0.9));
const uSunDirValue = sun.position.clone().normalize();

// ---------------------------------------------------------------------
// Patterned ground plane (checkerboard) — refraction target for droplets
// flying above it.
// ---------------------------------------------------------------------
function makeCheckerTexture() {
  // Calm two-tone tile grid (like a real pool floor) with grout lines —
  // low enough frequency that lens-bending through a droplet reads as a
  // clean wobble/wave instead of a scrambled kaleidoscope.
  const n = 6, cell = 64, size = n * cell;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#57c6e8' : '#2f8fd4';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const groundGeo = new THREE.PlaneGeometry(24, 24, 1, 1);
const groundMat = new THREE.MeshBasicMaterial({ map: makeCheckerTexture() });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// A striped vertical backdrop behind the emission point, so droplets in
// mid-air (not just those near the ground) also read against a
// high-contrast pattern.
function makeStripeTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ff8fb1' : '#ffe066';
    ctx.fillRect((i * size) / stripes, 0, size / stripes, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1.5, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 8),
  new THREE.MeshBasicMaterial({ map: makeStripeTexture() })
);
backdrop.position.set(0, 3, -3.5);
scene.add(backdrop);

// ---------------------------------------------------------------------
// Minimal GrabPass stub (src/watershading.js may not exist yet). Renders
// the opaque (non-WATER_LAYER) scene into an offscreen render target once
// per frame; droplets.js's fallback shading samples this exactly like the
// real grab pass would sample a copied framebuffer.
// ---------------------------------------------------------------------
class GrabPassStub {
  constructor(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      colorSpace: THREE.SRGBColorSpace,
    });
    this.texture = this.target.texture;
  }
  setSize(w, h) {
    this.target.setSize(w, h);
  }
  capture(renderer, scene, camera) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
  }
}

const grabPass = new GrabPassStub(renderer);
const sharedUniforms = {
  uSceneTex: { value: grabPass.texture },
  uViewport: { value: new THREE.Vector2(1, 1) },
  uSunDir: { value: uSunDirValue },
  uWaterAbsorb: { value: new THREE.Vector3(0.35, 0.12, 0.08) },
  uTimeW: { value: 0 },
};

const waterCtx = { grabPass, uniforms: sharedUniforms, droplets: null };
const droplets = new DropletSystem(scene, waterCtx);
waterCtx.droplets = droplets;

let landCount = 0;
droplets.onDropletLand = (x, z, size) => {
  landCount++;
};

// ---------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  grabPass.setSize(buf.x, buf.y);
  sharedUniforms.uViewport.value.set(buf.x, buf.y);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------
// Deterministic emit() bursts + emitSpray() calls, scheduled by elapsed
// (scaled) time so the sequence is reproducible across runs.
// ---------------------------------------------------------------------
const originA = new THREE.Vector3(-0.6, 0.05, 0);
const originB = new THREE.Vector3(0.7, 0.05, -0.4);
const originC = new THREE.Vector3(0, 0.05, 0.3);

function fireBurst1() {
  // steep, narrow, fast — crown-rim style chunky droplets
  const rng = mulberry32(12345);
  droplets.emit({
    origin: originA,
    dir: new THREE.Vector3(0, 1, 0),
    count: 90,
    speed: [2.5, 6.5],
    size: [0.02, 0.11],
    spread: 0.55,
    rng,
    gravityScale: 1,
    stretch: 1.4,
  });
  droplets.emitSpray({
    origin: originA,
    dir: new THREE.Vector3(0, 1, 0),
    count: 140,
    speed: [1.0, 3.0],
    spread: 0.8,
    life: [0.4, 0.9],
  });
}

function fireBurst2() {
  // wide, flat, oblique — flat-slap style spray-heavy burst
  const rng = mulberry32(67890);
  droplets.emit({
    origin: originB,
    dir: new THREE.Vector3(1, 0.6, -0.3).normalize(),
    count: 130,
    speed: [3.0, 8.0],
    size: [0.015, 0.09],
    spread: 0.8,
    rng,
    gravityScale: 1,
    stretch: 1.8,
  });
  droplets.emitSpray({
    origin: originB,
    dir: new THREE.Vector3(1, 0.5, -0.3).normalize(),
    count: 220,
    speed: [1.5, 4.0],
    spread: 0.95,
    life: [0.3, 0.75],
  });
}

function fireBurst3() {
  // big single droplets — good for checking sphere impostor / glint at
  // close range
  const rng = mulberry32(55555);
  droplets.emit({
    origin: originC,
    dir: new THREE.Vector3(-0.2, 1, 0.1).normalize(),
    count: 24,
    speed: [1.5, 3.0],
    size: [0.09, 0.16],
    spread: 0.25,
    rng,
    gravityScale: 1,
    stretch: 0.8,
  });
  droplets.emitSpray({
    origin: originC,
    dir: new THREE.Vector3(0, 1, 0),
    count: 80,
    speed: [0.8, 2.0],
    spread: 0.6,
    life: [0.5, 1.0],
  });
}

const schedule = [
  { t: 0.15, fn: fireBurst1, fired: false },
  { t: 1.3, fn: fireBurst2, fired: false },
  { t: 2.4, fn: fireBurst3, fired: false },
];

// ---------------------------------------------------------------------
// Render loop: pass 1 = opaque (grab target + screen), pass 2 = WATER_LAYER
// only, drawn on top of the screen using the grabbed texture.
// ---------------------------------------------------------------------
function renderFrame() {
  camera.layers.disable(WATER_LAYER);
  grabPass.capture(renderer, scene, camera);
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.render(scene, camera);

  if (droplets.isAlive()) {
    camera.layers.enable(WATER_LAYER);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    camera.layers.disable(WATER_LAYER);
    renderer.autoClear = true;
  }
}

const clock = new THREE.Clock();
let elapsed = 0;
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  elapsed += dt;
  sharedUniforms.uTimeW.value = elapsed;

  for (const item of schedule) {
    if (!item.fired && elapsed >= item.t) {
      item.fired = true;
      item.fn();
    }
  }

  droplets.update(dt, elapsed);
  renderFrame();
  frameCount++;

  hud.textContent =
    `t=${elapsed.toFixed(2)}s frame=${frameCount}\n` +
    `dropletsAlive=${droplets.dCount} sprayAlive=${droplets.sCount}\n` +
    `landed=${landCount}`;

  window.__test = {
    ready: true,
    elapsed,
    frameCount,
    dropletsAlive: droplets.dCount,
    sprayAlive: droplets.sCount,
    landed: landCount,
    isAlive: droplets.isAlive(),
  };
}

window.__errors = [];
window.onerror = (msg) => { window.__errors.push(String(msg)); };

// Debug-only handles for the Playwright verification script (camera
// repositioning for close-up checks). Not part of the DropletSystem API.
window.__scene = { camera, renderer, droplets, originC };

animate();
