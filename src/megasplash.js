// src/megasplash.js — M2 (mega splash tier, "そらのだい")
// See docs/CONTRACTS-MEGA.md ("M2 — megasplash.js + mega jet") for the full
// spec, plus docs/CONTRACTS-SPLASH2.md (watershading/droplets APIs reused
// here) and docs/CONTRACTS.md (ImpactSpec / determinism rules). This module
// owns the depth-charge mega splash's above-water phases:
//   ① Impact disc + flash   (0    - 0.15s)
//   ② White boiling dome    (0.1  - 1.4s, grow 0.1-0.8s / collapse 0.8-1.4s)
//   ⑤ Mushroom rain         (3.0  - 5.0s, scheduled droplets/spray bursts)
//   ⑦ Activity window       (isActive() true until ~5.5s)
// Phases ③④⑥ (wall wave/overflow/slosh, the mega jet, whitening decay) live
// in water.js (M3) and underwater.js (M2's triggerMegaJet — this module
// never touches underwater.js's pooled jet directly, main.js calls both).
//
// Exactly ONE concurrent mega splash is pooled (contract: "Pool exactly 1
// concurrent mega (retrigger replaces)") — rather than an array of pooled
// slots like splash.js/underwater.js, this class just keeps its single
// timeline directly on `this` and trigger() resets it in place.
//
// Draw calls: sheet(1) + flash sprite(1) + dome(1) = 3, well within the
// contract's ≤6 budget. All three meshes live on WATER_LAYER.
//
// Determinism: the whole macro shape (dome ragged-rim jitter, roil-wave
// phases, rain-burst schedule/counts) is derived from mulberry32(spec.seed)
// at trigger() time, per docs/CONTRACTS.md's determinism rule. Small
// per-particle sparkle inside droplets/spray is allowed to vary (droplets.js
// already owns that RNG boundary).

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { WATER_LAYER, sharedWaterUniforms, waterGlslCommon } from './watershading.js';

// ---- tunables --------------------------------------------------------
const SHEET_THETA = 64; // ① annular burst sheet angular segments
const DOME_SEGS = 48; // ② dome angular segments (contract: ~48)
const DOME_RINGS = 20; // ② dome radial rings (contract: ~20)
const RAIN_BURST_COUNT = 6; // ⑤ contract: "~6 bursts of 40-60"

const HALF_PI = Math.PI * 0.5;

// ---- small math helpers (no allocations) ------------------------------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

// =========================================================================
// Fallback WATER_GLSL resolution — mirrors the pattern used by splash.js /
// droplets.js / underwater.js: watershading.js is a hard dependency in
// practice (main.js always constructs it first), but this module still
// tolerates waterCtx.uniforms being absent (standalone/dev use) by owning a
// local uniforms object in that case. waterGlslCommon() itself is imported
// directly (not re-implemented) since by contract this file is written
// against watershading.js existing.
// =========================================================================

// =========================================================================
// Geometry builders
// =========================================================================

// ① annular burst sheet: a flat two-ring annulus (inner/outer), rebuilt on
// the CPU each frame while phase ① is alive (only ~0.15s of life, so this is
// cheap and never runs long). Mirrors splash.js's lamella/sheet approach but
// kept local/self-contained here (per contract: "reuse your own simplified
// version of the crown-sheet shader approach at megaScale").
function buildSheetGeometry(thetaSeg) {
  const vertsPerRing = thetaSeg + 1;
  const vertCount = vertsPerRing * 2;
  const position = new Float32Array(vertCount * 3);
  const aRad = new Float32Array(vertCount);
  for (let ring = 0; ring < 2; ring++) {
    for (let t = 0; t <= thetaSeg; t++) {
      aRad[ring * vertsPerRing + t] = ring; // 0 inner, 1 outer
    }
  }
  const indices = [];
  for (let t = 0; t < thetaSeg; t++) {
    const i0 = t, i1 = t + 1;
    const o0 = vertsPerRing + t, o1 = vertsPerRing + t + 1;
    indices.push(i0, o0, o1, i0, o1, i1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aRad', new THREE.BufferAttribute(aRad, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);
  return geo;
}

function writeSheetPositions(geo, thetaSeg, inner, outer, y) {
  const arr = geo.attributes.position.array;
  const vertsPerRing = thetaSeg + 1;
  for (let ring = 0; ring < 2; ring++) {
    const r = ring === 0 ? inner : outer;
    for (let t = 0; t <= thetaSeg; t++) {
      const idx = ring * vertsPerRing + t;
      const theta = (t / thetaSeg) * Math.PI * 2;
      const base = idx * 3;
      arr[base + 0] = Math.cos(theta) * r;
      arr[base + 1] = y;
      arr[base + 2] = Math.sin(theta) * r;
    }
  }
  geo.attributes.position.needsUpdate = true;
}

// ② hemisphere dome: DOME_SEGS angular x DOME_RINGS radial, position/normal/
// thickness/foam rebuilt on the CPU each frame (cavity/jet-style pattern
// from underwater.js) — v=0 at the rim/equator, v=1 at the pole.
function buildDomeGeometry() {
  const vertCount = DOME_SEGS * DOME_RINGS;
  const position = new Float32Array(vertCount * 3);
  const normal = new Float32Array(vertCount * 3);
  const aThickness = new Float32Array(vertCount);
  const aFoam = new Float32Array(vertCount);
  const indices = [];
  for (let s = 0; s < DOME_SEGS; s++) {
    const s2 = (s + 1) % DOME_SEGS;
    for (let r = 0; r < DOME_RINGS - 1; r++) {
      const a = s * DOME_RINGS + r;
      const b = s * DOME_RINGS + r + 1;
      const c = s2 * DOME_RINGS + r;
      const d = s2 * DOME_RINGS + r + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('aThickness', new THREE.BufferAttribute(aThickness, 1));
  geo.setAttribute('aFoam', new THREE.BufferAttribute(aFoam, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);
  return geo;
}

// Canvas texture for the ① flash sprite: a hot white core falling off to
// transparent, so an additive sprite reads as a single bright pop rather
// than a flat disc.
function makeFlashTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.25)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// =========================================================================
// Materials
// =========================================================================
function buildSheetMaterial(uniformsShared, fragChunk) {
  const uniforms = Object.assign({}, uniformsShared, { uOpacity: { value: 0 } });
  const vertexShader = `
    attribute float aRad;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vThickness;
    varying float vFoam;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
      vThickness = mix(0.022, 0.006, aRad);
      vFoam = 0.72 - aRad * 0.18;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    uniform float uOpacity;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vThickness;
    varying float vFoam;
    ${fragChunk}
    void main() {
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec2 screenUV = gl_FragCoord.xy / uViewport;
      vec4 shaded = waterShade(N, V, screenUV, vThickness, vFoam);
      gl_FragColor = vec4(shaded.rgb, clamp(shaded.a * uOpacity, 0.0, 1.0));
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

function buildDomeMaterial(uniformsShared, fragChunk) {
  const uniforms = Object.assign({}, uniformsShared, { uOpacity: { value: 0 } });
  const vertexShader = `
    attribute float aThickness;
    attribute float aFoam;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vThickness;
    varying float vFoam;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vThickness = aThickness;
      vFoam = aFoam;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;
  const fragmentShader = `
    uniform float uOpacity;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vThickness;
    varying float vFoam;
    ${fragChunk}
    void main() {
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(cameraPosition - vWorldPos);
      if (dot(N, V) < 0.0) N = -N;
      // Boiling shimmer: two low-frequency travelling waves perturb the
      // normal (so refraction/fresnel shimmer), plus a faster small-scale
      // flicker feeding extra foam variance — reads as agitated white water
      // rather than a static gray dome.
      float n1 = sin(vWorldPos.x * 5.0 + uTimeW * 3.0) * cos(vWorldPos.z * 4.0 - uTimeW * 2.2);
      float n2 = sin(vWorldPos.y * 9.0 - uTimeW * 4.5 + vWorldPos.x * 2.0);
      vec3 pn = normalize(N + vec3(n1, 0.0, n2) * 0.07);
      float boil = 0.08 * sin(vWorldPos.x * 11.0 + vWorldPos.z * 13.0 + uTimeW * 6.0);
      float foam = clamp(vFoam + boil, 0.0, 1.0);
      vec2 screenUV = gl_FragCoord.xy / uViewport;
      vec4 shaded = waterShade(pn, V, screenUV, vThickness, foam);
      gl_FragColor = vec4(shaded.rgb, clamp(shaded.a * uOpacity, 0.0, 1.0));
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// =========================================================================
// MegaSplashFX
// =========================================================================
export class MegaSplashFX {
  constructor(scene, waterCtx) {
    this.scene = scene;
    this.waterCtx = waterCtx || null;
    this.time = 0;

    this._ownsUniforms = !(this.waterCtx && this.waterCtx.uniforms);
    this.uniforms = this._ownsUniforms ? sharedWaterUniforms(null) : this.waterCtx.uniforms;
    const hasGrab = !!(this.uniforms.uSceneTex && this.uniforms.uSceneTex.value);
    this._fragChunk = waterGlslCommon(hasGrab);

    // ---- ① sheet ----
    this._sheetGeo = buildSheetGeometry(SHEET_THETA);
    this._sheetMat = buildSheetMaterial(this.uniforms, this._fragChunk);
    this._sheetMesh = new THREE.Mesh(this._sheetGeo, this._sheetMat);
    this._sheetMesh.visible = false;
    this._sheetMesh.frustumCulled = false;
    this._sheetMesh.layers.set(WATER_LAYER);
    scene.add(this._sheetMesh);

    // ---- ① flash sprite ----
    this._flashTex = makeFlashTexture();
    this._flashMat = new THREE.SpriteMaterial({
      map: this._flashTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._flashSprite = new THREE.Sprite(this._flashMat);
    this._flashSprite.visible = false;
    this._flashSprite.layers.set(WATER_LAYER);
    scene.add(this._flashSprite);

    // ---- ② dome ----
    this._domeGeo = buildDomeGeometry();
    this._domeMat = buildDomeMaterial(this.uniforms, this._fragChunk);
    this._domeMesh = new THREE.Mesh(this._domeGeo, this._domeMat);
    this._domeMesh.visible = false;
    this._domeMesh.frustumCulled = false;
    this._domeMesh.layers.set(WATER_LAYER);
    scene.add(this._domeMesh);

    // Precompute the unit-hemisphere ring profile (v=0 rim -> v=1 pole).
    this._domeRingCos = new Float32Array(DOME_RINGS);
    this._domeRingSin = new Float32Array(DOME_RINGS);
    for (let r = 0; r < DOME_RINGS; r++) {
      const v = r / (DOME_RINGS - 1);
      const theta = v * HALF_PI;
      this._domeRingCos[r] = Math.cos(theta); // radial factor, 1 at rim -> 0 at pole
      this._domeRingSin[r] = Math.sin(theta); // height factor, 0 at rim -> 1 at pole
    }
    this._domeAngleCos = new Float32Array(DOME_SEGS);
    this._domeAngleSin = new Float32Array(DOME_SEGS);
    for (let s = 0; s < DOME_SEGS; s++) {
      const a = (s / DOME_SEGS) * Math.PI * 2;
      this._domeAngleCos[s] = Math.cos(a);
      this._domeAngleSin[s] = Math.sin(a);
    }
    this._domeRimJitter = new Float32Array(DOME_SEGS);
    this._domeWaveSeeds = new Float32Array(3);

    // ---- single-slot mega timeline state (pool of exactly 1) ----
    this.active = false;
    this.age = 0;
    this.spec = null;
    this.point = new THREE.Vector3();
    this.rand = null;
    this._rainRand = null;
    this._rainSchedule = null;
    this._sheetMaxRadius = 2.0;
    this._domeRadius = 2.5;

    // reused scratch (no per-frame allocations in update())
    this._tmpVec = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3(0, -1, 0);
  }

  // ---------------------------------------------------------------- trigger
  trigger(spec) {
    this.active = true;
    this.age = 0;
    this.spec = spec;
    this.point.copy(spec.point);
    const rand = mulberry32(spec.seed >>> 0);
    this.rand = rand;

    const sizeRef = (spec.def && spec.def.radius) || spec.size || 1.1;
    const megaScale = spec.megaScale || sizeRef / 0.35;

    // ---- ① sheet: "radius up to ~3.5m", scaled by megaScale, capped.
    this._sheetMaxRadius = Math.min(3.5, 0.9 + megaScale * 0.8);
    this._sheetMesh.position.set(this.point.x, 0.03, this.point.z);
    this._sheetMesh.visible = false;

    // ---- ① flash: big, sun-of-impact, instant decay.
    const flashSize = 1.6 + sizeRef * 1.6 + megaScale * 0.35;
    this._flashSprite.position.set(this.point.x, 0.2, this.point.z);
    this._flashSprite.scale.set(flashSize, flashSize, 1);
    this._flashSprite.visible = true;
    this._flashMat.opacity = 1;

    // ---- ② dome: radius ≈ 1.4*def.radius + 1.0.
    this._domeRadius = 1.4 * sizeRef + 1.0;
    this._domeMesh.position.set(this.point.x, 0, this.point.z);
    this._domeMesh.visible = false;
    for (let s = 0; s < DOME_SEGS; s++) this._domeRimJitter[s] = (rand() - 0.5) * 2;
    this._domeWaveSeeds[0] = rand() * Math.PI * 2;
    this._domeWaveSeeds[1] = rand() * Math.PI * 2;
    this._domeWaveSeeds[2] = rand() * Math.PI * 2;

    // ---- ⑤ mushroom rain: schedule, time-based, no cross-module events.
    // A separate deterministic rng stream (spec.seed ^ 0x6d6567 = "meg") so
    // the rain layout doesn't perturb the dome/sheet macro shape above.
    this._rainRand = mulberry32((spec.seed ^ 0x6d6567) >>> 0);
    const rr = this._rainRand;
    const schedule = [];
    for (let i = 0; i < RAIN_BURST_COUNT; i++) {
      const tBase = 3.0 + (i / (RAIN_BURST_COUNT - 1)) * 2.0;
      const time = Math.max(3.0, tBase + (rr() - 0.5) * 0.15);
      const count = 40 + Math.floor(rr() * 20); // 40-60, per contract
      const y = THREE.MathUtils.lerp(6.0, 5.0, i / (RAIN_BURST_COUNT - 1)) + (rr() - 0.5) * 0.3; // descending 5-6m
      schedule.push({ time, count, y, fired: false });
    }
    this._rainSchedule = schedule;
  }

  // ---------------------------------------------------------------- update
  update(dt, time) {
    this.time = time;
    if (this._ownsUniforms) this.uniforms.uTimeW.value = time;
    if (!this.active) return;

    this.age += dt;

    this._updateSheet(this.age);
    this._updateFlash(this.age);
    this._updateDome(this.age);
    this._updateRain(this.age);

    // ⑦ activity window: nothing rendered after ~5s, but isActive() must
    // keep reporting true until ~5.5s (main's pass-2 + gameflow's
    // splashView predicate both read it).
    if (this.age >= 5.5) {
      this.active = false;
    }
  }

  _updateSheet(age) {
    const life = 0.15;
    if (age >= life) {
      if (this._sheetMesh.visible) this._sheetMesh.visible = false;
      return;
    }
    const t = age / life;
    // Very fast expand (within the first ~60% of its short life), thin
    // annular shockwave reading, then a quick alpha-out.
    const growT = Math.min(1, t / 0.6);
    const outer = this._sheetMaxRadius * smooth01(growT);
    const inner = Math.max(0.06, outer * 0.5);
    writeSheetPositions(this._sheetGeo, SHEET_THETA, inner, outer, 0.03);
    const alphaIn = smooth01(t / 0.12);
    const alphaOut = 1 - smooth01((t - 0.35) / 0.65);
    this._sheetMat.uniforms.uOpacity.value = Math.min(alphaIn, alphaOut) * 0.85;
    this._sheetMesh.visible = true;
  }

  _updateFlash(age) {
    const decay = 0.07; // "1-frame" instant decay, stretched to a short readable window
    if (age >= decay) {
      if (this._flashSprite.visible) this._flashSprite.visible = false;
      return;
    }
    const t = age / decay;
    this._flashMat.opacity = Math.max(0, 1 - t * t);
    this._flashSprite.visible = true;
  }

  _updateDome(age) {
    const growStart = 0.1, growEnd = 0.8, collapseEnd = 1.4;
    if (age < growStart || age >= collapseEnd) {
      if (this._domeMesh.visible) this._domeMesh.visible = false;
      return;
    }

    let scaleXZ, scaleY, alpha;
    if (age <= growEnd) {
      const t = smooth01((age - growStart) / (growEnd - growStart));
      scaleXZ = t;
      scaleY = t;
      alpha = Math.min(1, t * 1.5);
    } else {
      // ② collapse (0.8-1.4s): "collapse downward/inward (scale y down +
      // alpha)" — height melts to ~0 while radius recedes moderately inward,
      // as the mega jet (underwater.js, driven by main) rises through the
      // dome's center.
      const t = smooth01((age - growEnd) / (collapseEnd - growEnd));
      scaleXZ = 1 - t * 0.35;
      scaleY = Math.max(0.02, 1 - t);
      alpha = 1 - t;
    }

    this._writeDomeGeometry(age, scaleXZ, scaleY);
    this._domeMat.uniforms.uOpacity.value = alpha * 0.95;
    this._domeMesh.visible = true;
  }

  _writeDomeGeometry(age, scaleXZ, scaleY) {
    const geo = this._domeGeo;
    const pos = geo.attributes.position.array;
    const thick = geo.attributes.aThickness.array;
    const foamArr = geo.attributes.aFoam.array;
    const ringCos = this._domeRingCos, ringSin = this._domeRingSin;
    const angCos = this._domeAngleCos, angSin = this._domeAngleSin;
    const rimJitter = this._domeRimJitter;
    const seeds = this._domeWaveSeeds;
    const R = this._domeRadius;

    for (let s = 0; s < DOME_SEGS; s++) {
      const angIdx = s / DOME_SEGS; // 0..1 around the dome, for wave phase
      const cx = angCos[s], cz = angSin[s];
      const jitter = rimJitter[s];
      for (let r = 0; r < DOME_RINGS; r++) {
        const v = r / (DOME_RINGS - 1);
        // Two-to-three travelling low-frequency waves (surface roil),
        // varying with both angle and v so they read as crawling across the
        // boiling surface rather than a uniform pulse.
        const wave =
          0.05 * Math.sin(angIdx * Math.PI * 8 + v * 5.0 - age * 3.0 + seeds[0]) +
          0.035 * Math.sin(angIdx * Math.PI * 14 - v * 3.0 + age * 2.2 + seeds[1]) +
          0.025 * Math.sin(angIdx * Math.PI * 4 + v * 9.0 + age * 4.0 + seeds[2]);
        // Ragged rim: fixed per-column jitter, weighted to the rim only.
        const raggedWeight = Math.max(0, 1 - v / 0.3);
        const ragged = jitter * raggedWeight * 0.1;

        const radiusFactor = ringCos[r] * (1 + wave + ragged);
        const heightFactor = ringSin[r] * (1 + wave * 0.6);

        const idx = s * DOME_RINGS + r;
        pos[idx * 3 + 0] = cx * radiusFactor * R * scaleXZ;
        pos[idx * 3 + 1] = Math.max(0, heightFactor * R * scaleY);
        pos[idx * 3 + 2] = cz * radiusFactor * R * scaleXZ;

        // Thick at the rim (contract: "slight refraction at the lower rim
        // where thickness varying is larger"), thin near the pole.
        thick[idx] = THREE.MathUtils.lerp(0.16, 0.03, Math.pow(v, 0.6));
        // Solid boiling white (foam≈1) almost everywhere; a touch less at
        // the rim so its extra thickness shows a hint of refraction/body
        // color through the foam mix instead of reading as flat opaque.
        foamArr[idx] = THREE.MathUtils.lerp(0.8, 1.0, v);
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aThickness.needsUpdate = true;
    geo.attributes.aFoam.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ⑤ mushroom rain: time-based schedule fired against real accumulated
  // age — no cross-module event needed (per contract). Each burst emits
  // from several points around a ~1m ring above the column, descending in
  // y burst-to-burst, so the rain reads as falling from the collapsing jet
  // tip and scatters pool-wide.
  _updateRain(age) {
    const schedule = this._rainSchedule;
    if (!schedule) return;
    for (let i = 0; i < schedule.length; i++) {
      const b = schedule[i];
      if (b.fired || age < b.time) continue;
      b.fired = true;
      this._fireRainBurst(b);
    }
  }

  _fireRainBurst(burst) {
    const dc = this.waterCtx && this.waterCtx.droplets;
    if (!dc) return;
    const rng = this._rainRand || Math.random;

    const ringR = 0.9 + rng() * 0.2; // "origin ring radius ~1m"
    const subOrigins = 4;
    const perOrigin = Math.max(1, Math.round(burst.count / subOrigins));

    for (let k = 0; k < subOrigins; k++) {
      const ang = (k / subOrigins) * Math.PI * 2 + rng() * 0.6;
      const ox = this.point.x + Math.cos(ang) * ringR;
      const oz = this.point.z + Math.sin(ang) * ringR;
      this._tmpVec.set(ox, burst.y, oz);

      if (typeof dc.emit === 'function') {
        dc.emit({
          origin: this._tmpVec.clone(),
          dir: this._tmpDir,
          count: perOrigin,
          speed: [2.4, 5.2],
          size: [0.05, 0.14], // big drops, per contract
          spread: 0.85, // wide cone -> pool-wide scattering
          rng,
          gravityScale: 1.6, // shorter lives so the shared droplet pool recycles fast
          stretch: 1.2,
        });
      }
      if (typeof dc.emitSpray === 'function') {
        dc.emitSpray({
          origin: this._tmpVec.clone(),
          dir: this._tmpDir,
          count: Math.round(perOrigin * 1.4),
          speed: [1.4, 3.4],
          spread: 0.9,
          life: [0.35, 0.85],
        });
      }
    }
  }

  // ---------------------------------------------------------------- state
  isActive() {
    return this.active;
  }
}
