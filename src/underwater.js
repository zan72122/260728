// src/underwater.js — R4 (cavity / bubbles / photoreal Worthington jet)
// See docs/CONTRACTS.md "src/underwater.js — E" (base contract) and
// docs/CONTRACTS-SPLASH2.md "src/underwater.js jet rewrite — R4" (jet
// rewrite contract) for the full spec. Never edited by other modules; this
// module never touches other files.
//
// KEEP working, unchanged in spirit: air cavity + bubbles + triggerResurface
// (light tuning welcome). They stay OFF the water layer (render normally in
// pass 1, same as before).
//
// REWRITTEN: the central Worthington jet is now a pooled, smooth glassy tube
// mesh (32 angular x 24 vertical segments) shaded with the shared
// watershading.js `waterShade` (refraction/fresnel/sun-glint/foam), living on
// WATER_LAYER. Profile is time-evolving per-frame (CPU position/attribute
// update): emergence mound -> ballistic rise with natural overshoot (tip
// velocity decays under gravity) -> necking below the tip -> pinch-off (tip
// volume detaches, 1-3 satellite droplets emitted via waterCtx.droplets.emit)
// -> stub sags and sinks back with a soft base ring-wave.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { G } from './constants.js';
import { WATER_LAYER, sharedWaterUniforms, waterGlslCommon } from './watershading.js';

const CAVITY_POOL = 6;
const JET_POOL = 4; // >= 3 required by contract
const BUBBLE_CAP = 140;
const JET_DROPLET_FALLBACK_CAP = 24; // used only when waterCtx.droplets is absent

// Shared "toy water" look for the non-water-layer elements (cavity/bubbles),
// glossy white-blue, not gray smoke.
const WATER_WHITE = new THREE.Color(0xeaf8ff);
const WATER_BLUE = new THREE.Color(0x4dd0e6);
const UNDERWATER_TINT = new THREE.Color(0x2a6fb0); // slight blue fog tint

// ---------------------------------------------------------------------------
// Air cavity: a teardrop/cone mesh growing down from the impact point, then
// pinching closed in the middle at collapse. UNCHANGED behavior (light tuning
// only: collapse-mark timing nudged so it reliably precedes the jet's rise,
// per "cavity collapse still visually precedes/feeds the jet").
// Built from a LatheGeometry-like ring-stack BufferGeometry we deform per
// frame via a position attribute (cheap, CPU-side, capacity is tiny: pooled
// count * ~ (rings*segments) verts).
// ---------------------------------------------------------------------------
const CAVITY_RINGS = 10; // rings along depth (0 = surface, RINGS-1 = tip)
const CAVITY_SEGS = 12; // radial segments per ring

function buildCavityGeometry() {
  const ringT = new Float32Array(CAVITY_RINGS * CAVITY_SEGS);
  const positions = new Float32Array(CAVITY_RINGS * CAVITY_SEGS * 3);
  const angles = new Float32Array(CAVITY_SEGS);
  for (let s = 0; s < CAVITY_SEGS; s++) angles[s] = (s / CAVITY_SEGS) * Math.PI * 2;

  for (let r = 0; r < CAVITY_RINGS; r++) {
    const t = r / (CAVITY_RINGS - 1);
    for (let s = 0; s < CAVITY_SEGS; s++) {
      const idx = r * CAVITY_SEGS + s;
      ringT[idx] = t;
      positions[idx * 3 + 0] = Math.cos(angles[s]);
      positions[idx * 3 + 1] = -t;
      positions[idx * 3 + 2] = Math.sin(angles[s]);
    }
  }

  const indices = [];
  for (let r = 0; r < CAVITY_RINGS - 1; r++) {
    for (let s = 0; s < CAVITY_SEGS; s++) {
      const s2 = (s + 1) % CAVITY_SEGS;
      const a = r * CAVITY_SEGS + s;
      const b = r * CAVITY_SEGS + s2;
      const c = (r + 1) * CAVITY_SEGS + s;
      const d = (r + 1) * CAVITY_SEGS + s2;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('ringT', new THREE.BufferAttribute(ringT, 1));
  geom.setIndex(indices);
  geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  return geom;
}

class CavityInstance {
  constructor(geometry, baseCosSin) {
    this.geometry = geometry.clone();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAVITY_RINGS * CAVITY_SEGS * 3), 3));
    this.material = new THREE.MeshPhysicalMaterial({
      color: WATER_WHITE,
      transparent: true,
      opacity: 0.55,
      roughness: 0.15,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      // A touch of self-glow so the cavity still reads clearly at the new
      // low, close camera angle (cameraFX's underwater dip) even where the
      // scene's directional light doesn't hit its walls directly — keeps
      // it bright/toy-like rather than a dark hole in the water.
      emissive: WATER_WHITE,
      emissiveIntensity: 0.35,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.baseCosSin = baseCosSin; // Float32Array [cos0,sin0,cos1,sin1,...]
    this.active = false;
    this.age = 0;
    this.life = 0.5;
    this.depth = 0.5;
    this.radius = 0.3;
    this.point = new THREE.Vector3();
    this.wobbleSeed = 0;
    this.rand = null;
    this.wobbleAmps = new Float32Array(4);
    this.collapseMark = 0.35;
    this._bubblesSpawned = false;
  }

  start(spec, rand) {
    this.active = true;
    this.mesh.visible = true;
    this.age = 0;
    this.point.copy(spec.point);
    this.mesh.position.set(spec.point.x, 0, spec.point.z);
    const energy = spec.energy;
    const flatness = spec.flatness;
    // Deep narrow tube for clean heavy entries; shallow dish for flat slaps.
    this.depth = THREE.MathUtils.clamp(0.25 + energy * (1 - flatness) * 1.6, 0.12, 1.7);
    this.radius = spec.size * (0.9 + flatness * 1.8) * (0.6 + energy * 0.6);
    this.life = 0.5 + energy * 0.5; // ~0.5s/energy per contract wording
    // Deterministic wobble amplitudes/phases from seed.
    for (let i = 0; i < this.wobbleAmps.length; i++) {
      this.wobbleAmps[i] = 0.04 + rand() * 0.08;
    }
    this.wobbleSeed = rand() * Math.PI * 2;
    this.rand = rand;
    this._bubblesSpawned = false;
    // Collapse (bubble-spawn) mark: normally life*0.7, but capped so it lands
    // comfortably before the jet's own arm-to-rise wait time — keeps the
    // causal read "cavity collapses, THEN the jet answers" intact across the
    // whole energy range.
    const jetWait = 0.3 + 0.15 * energy;
    this.collapseMark = Math.min(this.life * 0.7, jetWait * 0.82);
  }

  update(dt, time) {
    if (!this.active) return;
    this.age += dt;
    const t = this.age / this.life;
    if (t >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    // Growth: quick open, slow-ish hold, then collapse handled via pinch.
    const openT = Math.min(1, this.age / (this.life * 0.35));
    const growEase = 1 - Math.pow(1 - openT, 3);
    const curDepth = this.depth * growEase;
    const curRadius = this.radius * (0.6 + 0.4 * growEase);

    // Collapse pinch: ramps up over the back half of life, peaks near the end.
    const collapseT = Math.max(0, (this.age - this.life * 0.45) / (this.life * 0.55));
    const pinch = Math.min(1, collapseT) ** 1.5;

    const pos = this.geometry.attributes.position.array;
    const bcs = this.baseCosSin;
    const amps = this.wobbleAmps;
    for (let r = 0; r < CAVITY_RINGS; r++) {
      const rt = r / (CAVITY_RINGS - 1);
      // Wobble: subtle per-ring, per-time sine noise, deterministic phase.
      const wob =
        1 +
        amps[0] * Math.sin(time * 3.1 + rt * 6.0 + this.wobbleSeed) * 0.5 +
        amps[1] * Math.sin(time * 5.3 + rt * 9.0 + this.wobbleSeed * 1.7) * 0.5;
      // Middle-pinch profile: multiplies radius down near ring t≈0.5 as pinch grows.
      const pinchProfile = 1 - pinch * Math.exp(-((rt - 0.5) * (rt - 0.5)) * 18);
      const ringRadius = curRadius * (0.25 + 0.75 * (1 - rt * 0.35)) * wob * Math.max(0.02, pinchProfile);
      const y = -curDepth * rt;
      for (let s = 0; s < CAVITY_SEGS; s++) {
        const idx = r * CAVITY_SEGS + s;
        const cos = bcs[s * 2];
        const sin = bcs[s * 2 + 1];
        pos[idx * 3 + 0] = cos * ringRadius;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = sin * ringRadius;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // Fade near end of life.
    const fadeOut = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
    this.material.opacity = 0.55 * fadeOut;
  }
}

// ---------------------------------------------------------------------------
// Bubbles: single InstancedMesh, glossy cheap look. UNCHANGED behavior, plus
// a cheap `liveCount` so isActive() doesn't have to scan the whole pool.
// ---------------------------------------------------------------------------
class BubbleField {
  constructor(scene) {
    const geom = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshPhysicalMaterial({
      color: WATER_WHITE,
      transparent: true,
      opacity: 0.8,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      depthWrite: false,
    });
    mat.color.lerp(UNDERWATER_TINT, 0.08);
    this.mesh = new THREE.InstancedMesh(geom, mat, BUBBLE_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // Hide all instances initially by zero-scaling.
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < BUBBLE_CAP; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);

    this.count = BUBBLE_CAP;
    this.active = new Uint8Array(BUBBLE_CAP);
    this.pos = new Float32Array(BUBBLE_CAP * 3);
    this.vel = new Float32Array(BUBBLE_CAP * 3);
    this.scale = new Float32Array(BUBBLE_CAP);
    this.phase = new Float32Array(BUBBLE_CAP);
    this.age = new Float32Array(BUBBLE_CAP);
    this.cursor = 0; // ring-buffer next-slot pointer
    this.liveCount = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  spawn(x, y, z, scale, speedY, rand) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    if (!this.active[i]) this.liveCount++;
    this.active[i] = 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = 0;
    this.vel[i * 3 + 1] = speedY;
    this.vel[i * 3 + 2] = 0;
    this.scale[i] = scale;
    this.phase[i] = rand() * Math.PI * 2;
    this.age[i] = 0;
    return i;
  }

  update(dt, time) {
    let anyDirty = false;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      anyDirty = true;
      this.age[i] += dt;
      // Accelerate upward (buoyancy), wobble side to side.
      this.vel[i * 3 + 1] += dt * 2.2;
      const spd = this.vel[i * 3 + 1];
      this.pos[i * 3 + 1] += spd * dt;
      const wob = Math.sin(time * 4.0 + this.phase[i]) * 0.08;
      const px = this.pos[i * 3] + wob * dt * 6.0;
      this.pos[i * 3] = px;
      const wobZ = Math.cos(time * 3.3 + this.phase[i]) * 0.08;
      this.pos[i * 3 + 2] += wobZ * dt * 6.0;

      if (this.pos[i * 3 + 1] >= -0.02) {
        // Pop near surface: recycle.
        this.active[i] = 0;
        this.liveCount--;
        this._m.copy(this._zero);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      const s = this.scale[i];
      this._m.makeScale(s, s, s);
      this._m.setPosition(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this._m);
    }
    if (anyDirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Central jet (Worthington column) — REWRITTEN per docs/CONTRACTS-SPLASH2.md.
//
// Profile model (deterministic macro from mulberry32(spec.seed ^ 0x9e3779b9)):
//   - height h = min(2.8, energy*(1-flatness*0.8)*3.0) meters (weak/no jet
//     for flat or tiny impacts, since h collapses toward 0).
//   - The tip is treated as a ballistic projectile launched with velocity v0
//     chosen so its natural (undamped) apex slightly overshoots h
//     (apexHeight = h * [1.12..1.22]), i.e. v0 = sqrt(2*G*apexHeight).
//     curTopY(age) = max(0, v0*age - 0.5*G*age^2) eased in over an
//     `emergeDur` window (smoothstep) so the very start reads as a small
//     mound bulging up rather than an instant spike — this alone gives the
//     "rapid rise, tip velocity decays under gravity, gentle overshoot" arc
//     the contract asks for, with no separate easing curve needed.
//   - Necking: once age crosses neckStartTime (a seeded fraction of the
//     ballistic apex time), a traveling narrow band pinches the radius
//     profile near the tip, deepening as age approaches pinchTime.
//   - Pinch-off: at pinchTime the tip volume is severed — 1-3 satellite
//     droplets are emitted upward via waterCtx.droplets.emit (rng seeded
//     from spec.seed ^ 0x9e37 per contract), the column is visually
//     shortened to `severFrac` of its pinch-time height, and a foam/ring-wave
//     pulse fires at the (now rounded-off) cut tip.
//   - Falling: the shortened stub continues on its residual velocity then
//     settles/sinks back to nothing, with a decaying ring-wave bump at the
//     base (soft surface wave) merging back into the pool.
// ---------------------------------------------------------------------------
const JET_SEGS = 32; // angular segments
const JET_RINGS = 24; // vertical rings

function jetBaseCosSin() {
  const arr = new Float32Array(JET_SEGS * 2);
  for (let s = 0; s < JET_SEGS; s++) {
    const a = (s / JET_SEGS) * Math.PI * 2;
    arr[s * 2] = Math.cos(a);
    arr[s * 2 + 1] = Math.sin(a);
  }
  return arr;
}

function smoothstep01(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Quiescent (no necking/mound) radius profile, in units of baseRadius, from
// base (rt=0) to current tip (rt=1). Piecewise-smoothstep interpolation
// between control points is C1-continuous at every knot (zero slope on both
// sides), which keeps the per-ring curvature gentle — a jagged/exponential
// profile here reads as faceted "ribbing" once only 24 rings are used, so
// smoothness of this curve matters more than its exact shape. Thick glassy
// base -> gently tapering shaft -> rounded tip, like a real Worthington jet
// column rather than a cone/spike.
// Deliberately kept fairly thick/uniform through the shaft with only a
// moderately rounded top (0.42) at rest — a sharp needle-point tip here
// would make the column read as a permanent cone rather than a cylindrical
// jet. The actual "it's about to pinch off" narrowing is done separately by
// the traveling necking gaussian below, so THAT is what visually reads as
// necking rather than the resting silhouette itself.
const JET_PROFILE = [
  { rt: 0.0, r: 1.3 },
  { rt: 0.16, r: 0.95 },
  { rt: 0.6, r: 0.74 },
  { rt: 0.88, r: 0.58 },
  { rt: 1.0, r: 0.42 },
];

function jetShaftFactor(rt) {
  for (let i = 0; i < JET_PROFILE.length - 1; i++) {
    const a = JET_PROFILE[i];
    const b = JET_PROFILE[i + 1];
    if (rt <= b.rt || i === JET_PROFILE.length - 2) {
      const span = Math.max(0.0001, b.rt - a.rt);
      const t = smoothstep01((rt - a.rt) / span);
      return a.r + (b.r - a.r) * t;
    }
  }
  return JET_PROFILE[JET_PROFILE.length - 1].r;
}

function buildJetIndices() {
  const indices = [];
  for (let r = 0; r < JET_RINGS - 1; r++) {
    for (let s = 0; s < JET_SEGS; s++) {
      const s2 = (s + 1) % JET_SEGS;
      const a = r * JET_SEGS + s;
      const b = r * JET_SEGS + s2;
      const c = (r + 1) * JET_SEGS + s;
      const d = (r + 1) * JET_SEGS + s2;
      indices.push(a, c, b, b, c, d);
    }
  }
  return indices;
}

// Build the photoreal ShaderMaterial for a jet mesh: waterShade-based,
// per-vertex thickness (local column diameter) and foam, plus a cheap
// flow-noise normal perturbation so refraction shimmers along the column.
function buildJetMaterial(uniforms, fragChunk) {
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
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vThickness;
    varying float vFoam;

    ${fragChunk}

    void main() {
      vec2 screenUV = gl_FragCoord.xy / uViewport;
      vec3 viewDirW = normalize(cameraPosition - vWorldPos);
      vec3 n = normalize(vNormalW);
      // Flow-noise normal perturbation: two travelling sine ripples along the
      // column so refraction shimmers, cheap (no texture lookups). Kept
      // low-frequency relative to the ring spacing so it reads as a gentle
      // flowing shimmer rather than amplifying per-ring faceting.
      float flow1 = sin(vWorldPos.y * 4.0 + uTimeW * 2.4 + vWorldPos.x * 2.0);
      float flow2 = sin(vWorldPos.y * 7.0 - uTimeW * 3.6 + vWorldPos.z * 2.5);
      vec3 pn = normalize(n + vec3(flow1 * 0.07, 0.0, flow2 * 0.05));
      gl_FragColor = waterShade(pn, viewDirW, screenUV, vThickness, vFoam);
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

class JetInstance {
  constructor(baseCosSin, sharedIndices, uniforms, fragChunk) {
    const vertCount = JET_RINGS * JET_SEGS;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const thickness = new Float32Array(vertCount);
    const foam = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aThickness', new THREE.BufferAttribute(thickness, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aFoam', new THREE.BufferAttribute(foam, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(sharedIndices.slice());

    this.material = buildJetMaterial(uniforms, fragChunk);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(WATER_LAYER);
    this.baseCosSin = baseCosSin;

    this.state = 'idle'; // idle | waiting | active
    this.waitAge = 0;
    this.waitTime = 0.3;
    this.activeAge = 0;
    this.point = new THREE.Vector3();

    // Macro shape (deterministic per-trigger, filled by arm()).
    this.energy = 0;
    this.flatness = 0;
    this.height = 0;
    this.baseRadius = 0;
    this.v0 = 0;
    this.emergeDur = 0.1;
    this.neckStartTime = 0.2;
    this.pinchTime = 0.3;
    this.severFrac = 0.8;
    this.fallDuration = 0.35;

    this.severed = false;
    this.pinchFired = false;
    this.curTopY = 0;
    this.severedTopY = 0;
    this.fallVelocity = 0;
    this.postPinchAge = 0;
    this.ringWaveEnergy = 0;
    this.foamPulse = 0;

    this.rand = null; // macro rng (spec.seed ^ 0x9e3779b9)
    this.dropletRand = null; // droplet rng (spec.seed ^ 0x9e37), per contract
  }

  arm(spec, rand, dropletRand) {
    this.state = 'waiting';
    this.waitAge = 0;
    // t ≈ 0.30 + 0.15*energy after trigger, per contract.
    this.waitTime = 0.3 + 0.15 * spec.energy;
    this.point.copy(spec.point);
    this.mesh.position.set(spec.point.x, 0, spec.point.z);
    this.energy = spec.energy;
    this.flatness = spec.flatness;
    // Peak height ∝ energy*(1-flatness*0.8), capped ~2.8m.
    this.height = Math.min(2.8, spec.energy * (1 - spec.flatness * 0.8) * 3.0);
    // Thick glassy base tapering up.
    this.baseRadius = Math.max(0.03, spec.size * (0.5 + spec.energy * 0.42));

    const overshoot = 1.12 + rand() * 0.1; // 1.12..1.22 — natural overshoot
    const apexHeight = Math.max(0.01, this.height * overshoot);
    this.v0 = Math.sqrt(2 * G * apexHeight);
    const apexTime = this.v0 / G;
    this.emergeDur = 0.06 + rand() * 0.05 + spec.energy * 0.03;
    const neckStartFrac = 0.55 + rand() * 0.15; // 0.55..0.70 of apex time
    const pinchFrac = neckStartFrac + 0.28 + rand() * 0.14; // ~0.83..1.14
    this.neckStartTime = apexTime * neckStartFrac;
    this.pinchTime = Math.max(this.neckStartTime + 0.03, apexTime * pinchFrac);
    this.severFrac = 0.78 + rand() * 0.12; // 0.78..0.90 of pinch-time height retained
    this.fallDuration = 0.32 + spec.energy * 0.18;

    this.rand = rand;
    this.dropletRand = dropletRand;
    this.severed = false;
    this.pinchFired = false;
    this.curTopY = 0;
    this.ringWaveEnergy = 0;
    this.foamPulse = 0;
    this.mesh.visible = false;
  }

  // spawnBaseBubbles(x, z, rand, count); dropletEmitFn(jetInstance, x, y, z, vAtPinch)
  update(dt, spawnBaseBubbles, dropletEmitFn) {
    if (this.state === 'idle') return;

    if (this.state === 'waiting') {
      this.waitAge += dt;
      if (this.waitAge >= this.waitTime) {
        this.state = 'active';
        this.activeAge = 0;
        this.severed = false;
        this.pinchFired = false;
        this.ringWaveEnergy = 1; // emergence mound/ring pulse
        this.foamPulse = 0.3;
        this.mesh.visible = this.height > 0.05;
        if (this.mesh.visible) spawnBaseBubbles(this.point.x, this.point.z, this.rand, 3);
      }
      return;
    }

    // state === 'active'
    if (this.height <= 0.05) {
      this.state = 'idle';
      this.mesh.visible = false;
      return;
    }
    this.activeAge += dt;
    const age = this.activeAge;

    // Decay the mound/ring-wave and foam pulses.
    this.ringWaveEnergy *= Math.exp(-dt * 4.5);
    this.foamPulse *= Math.exp(-dt * 6.0);

    let topY;
    if (!this.severed) {
      const ballisticY = Math.max(0, this.v0 * age - 0.5 * G * age * age);
      const emergeT = Math.min(1, age / this.emergeDur);
      const ee = emergeT * emergeT * (3 - 2 * emergeT); // smoothstep
      topY = ballisticY * ee;

      if (age >= this.pinchTime) {
        // --- PINCH-OFF: tip volume detaches ---
        this.severed = true;
        this.pinchFired = true;
        const severTopY = topY * this.severFrac;
        const vAtPinch = this.v0 - G * age;
        this.fallVelocity = Math.max(0.25, vAtPinch);
        this.severedTopY = severTopY;
        this.postPinchAge = 0;
        this.ringWaveEnergy = 1;
        this.foamPulse = 1;
        dropletEmitFn(this, this.point.x, topY, this.point.z, vAtPinch);
        spawnBaseBubbles(this.point.x, this.point.z, this.dropletRand || this.rand, 2);
        topY = severTopY;
      }
    } else {
      this.postPinchAge += dt;
      const t = Math.min(1, this.postPinchAge / this.fallDuration);
      const raw = this.severedTopY + this.fallVelocity * this.postPinchAge - 0.5 * G * this.postPinchAge * this.postPinchAge;
      topY = Math.max(0, raw) * (1 - t * t); // settle-down easing to guarantee it sinks away
      if (t >= 1 || topY <= 0.015) {
        this.state = 'idle';
        this.mesh.visible = false;
        return;
      }
    }

    this.curTopY = Math.max(0.015, topY);
    this._writeGeometry(age);
  }

  _writeGeometry(age) {
    const pos = this.geometry.attributes.position.array;
    const thick = this.geometry.attributes.aThickness.array;
    const foamArr = this.geometry.attributes.aFoam.array;
    const bcs = this.baseCosSin;
    const topY = this.curTopY;
    const baseR = this.baseRadius;

    // Necking factor: only while rising and inside the necking window.
    let neckCenter = -1;
    let neckDepth = 0;
    if (!this.severed && age >= this.neckStartTime) {
      const span = Math.max(0.001, this.pinchTime - this.neckStartTime);
      const progress = Math.min(1, (age - this.neckStartTime) / span);
      neckCenter = 0.6 + 0.4 * progress; // travels toward the tip as pinch nears
      neckDepth = progress;
    }

    const mound = this.ringWaveEnergy; // 0..1 decaying pulse (emergence + pinch)
    const foamPulse = this.foamPulse;

    for (let r = 0; r < JET_RINGS; r++) {
      const rt = r / (JET_RINGS - 1);
      const y = topY * rt;

      // Thick glassy base -> gently tapering shaft -> rounded tip (smooth,
      // C1-continuous control-point curve — see jetShaftFactor above).
      let radius = baseR * jetShaftFactor(rt);
      // Ring-wave / mound bump low on the shaft, just above the base flare
      // (base "ring wave" pulse: emergence + a second pulse at pinch-off).
      const waveEnv = Math.exp(-Math.pow((rt - 0.08) / 0.07, 2));
      radius += baseR * 0.5 * mound * waveEnv;
      // Necking pinch: a traveling narrow band that deepens toward pinch-off.
      if (neckCenter >= 0) {
        const neckWidth = 0.1;
        const factor = 1 - neckDepth * 0.85 * Math.exp(-Math.pow((rt - neckCenter) / neckWidth, 2));
        radius *= Math.max(0.08, factor);
      }
      // Freshly-severed cut pulls into a rounded meniscus at the new tip.
      if (this.severed && rt > 0.82) {
        const capT = (rt - 0.82) / 0.18;
        radius *= Math.max(0.45, 1 - capT * 0.4);
      }
      radius = Math.max(0.006, radius);

      let foam = 0.06 + waveEnv * mound * 0.5;
      if (rt > 0.8) foam += foamPulse * 0.8;
      foam = Math.min(1, foam);

      for (let s = 0; s < JET_SEGS; s++) {
        const idx = r * JET_SEGS + s;
        pos[idx * 3 + 0] = bcs[s * 2] * radius;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = bcs[s * 2 + 1] * radius;
        // vThickness ≈ local column diameter, clamped to the range the
        // shared absorb()/refractSample() curves were tuned for — beyond
        // ~0.16m both saturate to fully opaque/max-offset anyway, so this
        // just avoids a perfectly flat, over-saturated look at the thick
        // glassy base while leaving thin necked/tip regions untouched.
        thick[idx] = Math.min(0.16, radius * 2);
        foamArr[idx] = foam;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aThickness.needsUpdate = true;
    this.geometry.attributes.aFoam.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

// Small fallback InstancedMesh pool for the jet's pinch-off droplets, used
// ONLY when waterCtx.droplets is absent (e.g. R3's file not present yet, or
// a bare/standalone use of UnderwaterFX) so pinch-off still reads visually.
class JetDropletsFallback {
  constructor(scene) {
    const geom = new THREE.SphereGeometry(1, 6, 5);
    const mat = new THREE.MeshPhysicalMaterial({
      color: WATER_WHITE,
      transparent: true,
      opacity: 0.95,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      depthWrite: false,
    });
    mat.color.lerp(WATER_BLUE, 0.1);
    this.mesh = new THREE.InstancedMesh(geom, mat, JET_DROPLET_FALLBACK_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < JET_DROPLET_FALLBACK_CAP; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);

    this.count = JET_DROPLET_FALLBACK_CAP;
    this.active = new Uint8Array(JET_DROPLET_FALLBACK_CAP);
    this.pos = new Float32Array(JET_DROPLET_FALLBACK_CAP * 3);
    this.vel = new Float32Array(JET_DROPLET_FALLBACK_CAP * 3);
    this.scale = new Float32Array(JET_DROPLET_FALLBACK_CAP);
    this.cursor = 0;
    this.liveCount = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  spawn(x, y, z, vx, vy, vz, scale) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    if (!this.active[i]) this.liveCount++;
    this.active[i] = 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.scale[i] = scale;
  }

  update(dt) {
    let anyDirty = false;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      anyDirty = true;
      this.vel[i * 3 + 1] -= G * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0) {
        this.active[i] = 0;
        this.liveCount--;
        this._m.copy(this._zero);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      const s = this.scale[i];
      this._m.makeScale(s, s, s);
      this._m.setPosition(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this._m);
    }
    if (anyDirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export class UnderwaterFX {
  constructor(scene, waterCtx) {
    this.scene = scene;
    // waterCtx = { grabPass, uniforms, droplets } per docs/CONTRACTS-SPLASH2.md.
    // Guard: waterCtx (or pieces of it) may be absent — degrade gracefully.
    this.waterCtx = waterCtx || null;
    this.time = 0;

    // Own a local uniforms object when no shared one is supplied (standalone
    // use / before R1's main.js wiring lands) so the jet shader still has
    // somewhere to read uTimeW/uViewport/uSunDir from. When a shared object
    // IS supplied we never write uTimeW/uViewport ourselves — R1 owns that.
    this._ownsUniforms = !(this.waterCtx && this.waterCtx.uniforms);
    this.uniforms = this._ownsUniforms ? sharedWaterUniforms(null) : this.waterCtx.uniforms;
    const hasGrab = !!(this.uniforms.uSceneTex && this.uniforms.uSceneTex.value);
    this._jetFragChunk = waterGlslCommon(hasGrab);

    // Cavity pool.
    const cavityGeom = buildCavityGeometry();
    const baseCosSin = new Float32Array(CAVITY_SEGS * 2);
    for (let s = 0; s < CAVITY_SEGS; s++) {
      const a = (s / CAVITY_SEGS) * Math.PI * 2;
      baseCosSin[s * 2] = Math.cos(a);
      baseCosSin[s * 2 + 1] = Math.sin(a);
    }
    this.cavities = [];
    for (let i = 0; i < CAVITY_POOL; i++) {
      const c = new CavityInstance(cavityGeom, baseCosSin);
      scene.add(c.mesh);
      this.cavities.push(c);
    }
    this._cavityCursor = 0;

    // Bubbles (single InstancedMesh — 1 draw call). NOT on WATER_LAYER.
    this.bubbles = new BubbleField(scene);

    // Jet pool — each jet is 1 draw call, photoreal waterShade material on
    // WATER_LAYER.
    const jetBCS = jetBaseCosSin();
    const jetIndices = buildJetIndices();
    this.jets = [];
    for (let i = 0; i < JET_POOL; i++) {
      const j = new JetInstance(jetBCS, jetIndices, this.uniforms, this._jetFragChunk);
      scene.add(j.mesh);
      this.jets.push(j);
    }
    this._jetCursor = 0;

    // Fallback droplet pool, used only when waterCtx.droplets is absent.
    this.fallbackDroplets = new JetDropletsFallback(scene);

    // Reused scratch (no per-frame allocations in update()).
    this._tmpVec = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3(0, 1, 0);
  }

  trigger(spec) {
    const rand = mulberry32(spec.seed >>> 0);

    // Air cavity.
    const cav = this.cavities[this._cavityCursor];
    this._cavityCursor = (this._cavityCursor + 1) % this.cavities.length;
    cav.start(spec, rand);
    cav._cupTrap = spec.cupTrap;
    cav._energy = spec.energy;

    // Arm the delayed central jet with independent deterministic streams:
    // macro shape from spec.seed ^ 0x9e3779b9 (kept from v1 so existing
    // macro-shape determinism tests still see the same numbers), and the
    // pinch-off satellite-droplet rng from spec.seed ^ 0x9e37 exactly as the
    // jet contract specifies.
    const jetRand = mulberry32((spec.seed ^ 0x9e3779b9) >>> 0);
    const dropletRand = mulberry32((spec.seed ^ 0x9e37) >>> 0);
    const jet = this.jets[this._jetCursor];
    this._jetCursor = (this._jetCursor + 1) % this.jets.length;
    jet.arm(spec, jetRand, dropletRand);
  }

  triggerResurface(pos, def) {
    // Small burst of ~8 bubbles at pos.
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.08;
      const scale = 0.03 + Math.random() * 0.03;
      this.bubbles.spawn(
        pos.x + Math.cos(ang) * r,
        Math.min(-0.02, pos.y - 0.05 - Math.random() * 0.1),
        pos.z + Math.sin(ang) * r,
        scale,
        0.3 + Math.random() * 0.3,
        Math.random
      );
    }
  }

  _spawnCavityCollapseBubbles(cav) {
    const rand = cav.rand || Math.random;
    const cupTrap = cav._cupTrap || 0;
    const baseCount = 8 + Math.floor(cav._energy * 14);
    const count = cupTrap >= 0.5 ? baseCount + 20 : baseCount;
    for (let i = 0; i < count; i++) {
      const t = rand();
      const ang = rand() * Math.PI * 2;
      const r = cav.radius * (0.15 + 0.6 * rand());
      const depth = -cav.depth * t;
      const scale = 0.025 + rand() * 0.045;
      this.bubbles.spawn(
        cav.point.x + Math.cos(ang) * r,
        depth,
        cav.point.z + Math.sin(ang) * r,
        scale,
        0.5 + rand() * 0.8,
        rand
      );
    }
    if (cupTrap >= 0.5) {
      // One big "glug" bubble rising slower.
      this.bubbles.spawn(
        cav.point.x,
        -cav.depth * 0.6,
        cav.point.z,
        0.09 * 2.5 * 0.4, // ~2.5x a normal bubble's typical scale
        0.22,
        rand
      );
    }
  }

  // Base bubbles: a few small bubbles at jet emergence / pinch-off, reusing
  // the existing bubble system (per contract: "reuse of existing bubble
  // system for a few base bubbles").
  _spawnJetBaseBubbles(x, z, rand, count) {
    const r = rand || Math.random;
    for (let i = 0; i < count; i++) {
      const ang = r() * Math.PI * 2;
      const rad = r() * 0.15;
      const scale = 0.02 + r() * 0.025;
      this.bubbles.spawn(x + Math.cos(ang) * rad, -0.03 - r() * 0.06, z + Math.sin(ang) * rad, scale, 0.3 + r() * 0.3, r);
    }
  }

  // Pinch-off satellite droplets: routed to waterCtx.droplets.emit per the
  // droplets.js contract shape, guarded for absence (falls back to a local
  // pool so the visual read survives even without R3's module).
  _emitJetDroplets(jet, x, y, z, vAtPinch) {
    const rng = jet.dropletRand || Math.random;
    const n = 1 + Math.floor(rng() * 3); // 1-3 satellite droplets
    const dc = this.waterCtx && this.waterCtx.droplets;
    if (dc && typeof dc.emit === 'function') {
      this._tmpVec.set(x, y, z);
      dc.emit({
        origin: this._tmpVec.clone(),
        dir: this._tmpDir,
        count: n,
        speed: [0.8, 1.8 + jet.energy * 1.4],
        size: [0.02, 0.05],
        spread: 0.4,
        rng,
        gravityScale: 1,
        stretch: 1.15,
      });
    } else {
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const outSpeed = 0.3 + rng() * 0.8;
        const vx = Math.cos(ang) * outSpeed * 0.4;
        const vz = Math.sin(ang) * outSpeed * 0.4;
        const vy = Math.max(0.6, vAtPinch * 0.6) + rng() * 1.0;
        const scale = 0.02 + rng() * 0.03;
        this.fallbackDroplets.spawn(x, y, z, vx, vy, vz, scale);
      }
    }
  }

  // Any cavity, bubble, or jet currently alive — used by main to decide
  // whether the WATER_LAYER pass-2 render (and grab-pass capture) is needed.
  isActive() {
    for (let i = 0; i < this.cavities.length; i++) {
      if (this.cavities[i].active) return true;
    }
    for (let i = 0; i < this.jets.length; i++) {
      if (this.jets[i].state !== 'idle') return true;
    }
    if (this.bubbles.liveCount > 0) return true;
    if (this.fallbackDroplets.liveCount > 0) return true;
    return false;
  }

  update(dt, time) {
    this.time = time;
    if (this._ownsUniforms) {
      // Standalone use (no shared waterCtx.uniforms): keep our local
      // uniforms ticking so the flow-noise shimmer animates.
      this.uniforms.uTimeW.value = time;
    }

    // Cavities: update, detect collapse-complete moment to spawn bubbles.
    for (let i = 0; i < this.cavities.length; i++) {
      const c = this.cavities[i];
      if (!c.active) continue;
      const prevAge = c.age;
      c.update(dt, time);
      if (!c._bubblesSpawned) {
        if (prevAge < c.collapseMark && c.age >= c.collapseMark) {
          c._bubblesSpawned = true;
          this._spawnCavityCollapseBubbles(c);
        }
      }
      if (!c.active) c._bubblesSpawned = false;
    }

    // Jets.
    for (let i = 0; i < this.jets.length; i++) {
      const j = this.jets[i];
      if (j.state === 'idle') continue;
      j.update(
        dt,
        (x, z, rand, count) => this._spawnJetBaseBubbles(x, z, rand, count),
        (jetInst, x, y, z, vAtPinch) => this._emitJetDroplets(jetInst, x, y, z, vAtPinch)
      );
    }

    // Particle fields.
    this.bubbles.update(dt, time);
    this.fallbackDroplets.update(dt);
  }
}
