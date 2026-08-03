// src/underwater.js — E (cavity / bubbles / central jet)
// See docs/CONTRACTS.md "src/underwater.js — E" for the contract.
// Never edited by other modules; this module never touches other files.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { G } from './constants.js';

const CAVITY_POOL = 6;
const JET_POOL = 4;
const BUBBLE_CAP = 140;
const JET_DROPLET_CAP = 24;

// Shared "toy water" look: glossy white-blue, not gray smoke.
const WATER_WHITE = new THREE.Color(0xeaf8ff);
const WATER_BLUE = new THREE.Color(0x4dd0e6);
const UNDERWATER_TINT = new THREE.Color(0x2a6fb0); // slight blue fog tint

// ---------------------------------------------------------------------------
// Air cavity: a teardrop/cone mesh growing down from the impact point, then
// pinching closed in the middle at collapse.
// Built from a LatheGeometry-like ring-stack BufferGeometry we deform per
// frame via a position attribute (cheap, CPU-side, capacity is tiny: pooled
// count * ~ (rings*segments) verts).
// ---------------------------------------------------------------------------
const CAVITY_RINGS = 10; // rings along depth (0 = surface, RINGS-1 = tip)
const CAVITY_SEGS = 12; // radial segments per ring

function buildCavityGeometry() {
  // Unit geometry: rings go from y=0 (surface) to y=-1 (tip), radius profile
  // baked at build time into a per-vertex attribute "ringT" (0..1) so the
  // update loop can reshape radius/depth/pinch cheaply without recompute.
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

// Base (undeformed) unit positions, kept around so we can re-derive shaped
// positions each frame without accumulating drift.
function cavityBasePositions() {
  const positions = new Float32Array(CAVITY_RINGS * CAVITY_SEGS * 3);
  const angles = new Float32Array(CAVITY_SEGS);
  for (let s = 0; s < CAVITY_SEGS; s++) angles[s] = (s / CAVITY_SEGS) * Math.PI * 2;
  for (let r = 0; r < CAVITY_RINGS; r++) {
    const t = r / (CAVITY_RINGS - 1);
    for (let s = 0; s < CAVITY_SEGS; s++) {
      const idx = r * CAVITY_SEGS + s;
      positions[idx * 3 + 0] = Math.cos(angles[s]);
      positions[idx * 3 + 1] = -t;
      positions[idx * 3 + 2] = Math.sin(angles[s]);
    }
  }
  return positions;
}

class CavityInstance {
  constructor(geometry, baseCosSin) {
    this.geometry = geometry.clone();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAVITY_RINGS * CAVITY_SEGS * 3), 3));
    this.material = new THREE.MeshPhysicalMaterial({
      color: WATER_WHITE,
      transparent: true,
      opacity: 0.35,
      roughness: 0.15,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
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
    this.material.opacity = 0.35 * fadeOut;
  }
}

// ---------------------------------------------------------------------------
// Bubbles: single InstancedMesh, glossy cheap look.
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
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  spawn(x, y, z, scale, speedY, rand) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
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
// Central jet (Worthington column): lathe-ish mesh that rises, overshoots,
// pinches droplets off the tip, then sinks back.
// ---------------------------------------------------------------------------
const JET_RINGS = 8;
const JET_SEGS = 10;

function jetBaseCosSin() {
  const arr = new Float32Array(JET_SEGS * 2);
  for (let s = 0; s < JET_SEGS; s++) {
    const a = (s / JET_SEGS) * Math.PI * 2;
    arr[s * 2] = Math.cos(a);
    arr[s * 2 + 1] = Math.sin(a);
  }
  return arr;
}

class JetInstance {
  constructor(baseCosSin) {
    const positions = new Float32Array(JET_RINGS * JET_SEGS * 3);
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
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshPhysicalMaterial({
      color: WATER_WHITE,
      transparent: true,
      opacity: 0.9,
      roughness: 0.1,
      metalness: 0,
      clearcoat: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.material.color.lerp(WATER_BLUE, 0.12);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.baseCosSin = baseCosSin;

    this.state = 'idle'; // idle | waiting | rising | falling
    this.waitTime = 0;
    this.age = 0;
    this.riseDuration = 0;
    this.height = 0;
    this.baseRadius = 0;
    this.point = new THREE.Vector3();
    this.pinched = false;
    this.rand = null;
    this.energy = 0;
    this.flatness = 0;
    this.spawnedDroplets = false;
  }

  arm(spec, rand) {
    this.state = 'waiting';
    this.waitTime = 0.3 + 0.15 * spec.energy; // t ≈ 0.30 + 0.15*energy after trigger
    this.age = 0;
    this.point.copy(spec.point);
    this.mesh.position.set(spec.point.x, 0, spec.point.z);
    this.energy = spec.energy;
    this.flatness = spec.flatness;
    this.height = Math.min(2.8, spec.energy * (1 - spec.flatness * 0.8) * 3.0);
    this.baseRadius = spec.size * (0.55 + spec.energy * 0.35);
    this.riseDuration = 0.22 + spec.energy * 0.1;
    this.rand = rand;
    this.pinched = false;
    this.spawnedDroplets = false;
    this.mesh.visible = false;
  }

  // Returns spawn info for droplets when the tip pinches off, else null.
  update(dt, bubbleSpawnFn, dropletSpawnFn) {
    if (this.state === 'idle') return;
    if (this.state === 'waiting') {
      this.age += dt;
      if (this.age >= this.waitTime) {
        this.state = 'rising';
        this.age = 0;
        this.mesh.visible = this.height > 0.05;
      }
      return;
    }
    if (this.state === 'rising' || this.state === 'falling') {
      this.age += dt;
    }
    if (this.height <= 0.05) {
      this.state = 'idle';
      this.mesh.visible = false;
      return;
    }

    let curHeight;
    let radiusScale = 1;
    if (this.state === 'rising') {
      const t = Math.min(1, this.age / this.riseDuration);
      // Overshoot ease (back-out).
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      curHeight = this.height * Math.max(0, eased);
      radiusScale = 1 - t * 0.25;
      if (t >= 1) {
        this.state = 'falling';
        this.age = 0;
        if (!this.spawnedDroplets) {
          this.spawnedDroplets = true;
          dropletSpawnFn(this.point.x, this.height, this.point.z, this.energy, this.rand);
        }
      }
    } else {
      // Falling: sink back down over a similar-ish duration.
      const fallDuration = 0.28 + this.energy * 0.12;
      const t = Math.min(1, this.age / fallDuration);
      curHeight = this.height * (1 - t) * (1 - t);
      radiusScale = (0.75 + 0.25 * (1 - t));
      if (t >= 1) {
        this.state = 'idle';
        this.mesh.visible = false;
        return;
      }
    }

    const pos = this.geometry.attributes.position.array;
    const bcs = this.baseCosSin;
    for (let r = 0; r < JET_RINGS; r++) {
      const rt = r / (JET_RINGS - 1);
      // Thick base, rounded/tapered tip.
      const taper = 1 - Math.pow(rt, 2.2) * 0.75;
      const rimRound = rt > 0.85 ? (1 - rt) / 0.15 : 1; // rounds off near tip
      const ringRadius = this.baseRadius * radiusScale * taper * Math.max(0.15, rimRound);
      const y = curHeight * rt;
      for (let s = 0; s < JET_SEGS; s++) {
        const idx = r * JET_SEGS + s;
        pos[idx * 3 + 0] = bcs[s * 2] * ringRadius;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = bcs[s * 2 + 1] * ringRadius;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

// Small dedicated instanced pool for the jet's pinch-off droplets.
class JetDroplets {
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
    this.mesh = new THREE.InstancedMesh(geom, mat, JET_DROPLET_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < JET_DROPLET_CAP; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);

    this.count = JET_DROPLET_CAP;
    this.active = new Uint8Array(JET_DROPLET_CAP);
    this.pos = new Float32Array(JET_DROPLET_CAP * 3);
    this.vel = new Float32Array(JET_DROPLET_CAP * 3);
    this.scale = new Float32Array(JET_DROPLET_CAP);
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  spawn(x, y, z, vx, vy, vz, scale) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
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
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // Cavity pool.
    const cavityGeom = buildCavityGeometry();
    const baseFlat = cavityBasePositions();
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

    // Bubbles (single InstancedMesh — 1 draw call).
    this.bubbles = new BubbleField(scene);

    // Jet pool.
    const jetBCS = jetBaseCosSin();
    this.jets = [];
    for (let i = 0; i < JET_POOL; i++) {
      const j = new JetInstance(jetBCS);
      scene.add(j.mesh);
      this.jets.push(j);
    }
    this._jetCursor = 0;

    // Jet droplets (single InstancedMesh — 1 draw call).
    this.jetDroplets = new JetDroplets(scene);

    // Reused scratch vector to avoid per-frame allocation.
    this._tmp = new THREE.Vector3();
  }

  trigger(spec) {
    const rand = mulberry32(spec.seed >>> 0);

    // Air cavity.
    const cav = this.cavities[this._cavityCursor];
    this._cavityCursor = (this._cavityCursor + 1) % this.cavities.length;
    cav.start(spec, rand);

    // Arm the delayed central jet with an independent deterministic stream
    // (advance a few draws so it doesn't reuse the same numbers as cavity).
    const jetRand = mulberry32((spec.seed ^ 0x9e3779b9) >>> 0);
    const jet = this.jets[this._jetCursor];
    this._jetCursor = (this._jetCursor + 1) % this.jets.length;
    jet.arm(spec, jetRand);
    // Stash spec-derived info needed at collapse time for bubble spawning.
    jet._cupTrap = spec.cupTrap;
    jet._entrySeed = spec.seed;

    // Remember cavity <-> spec linkage for collapse-triggered bubbles.
    cav._cupTrap = spec.cupTrap;
    cav._energy = spec.energy;
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

  _spawnJetDroplets(x, topY, z, energy, rand) {
    const r = rand || Math.random;
    const n = 2 + Math.floor(r() * 3); // 2-4 big droplets
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r() * 0.6;
      const outSpeed = 0.6 + r() * 1.2 + energy * 0.8;
      const vx = Math.cos(ang) * outSpeed * 0.5;
      const vz = Math.sin(ang) * outSpeed * 0.5;
      const vy = 1.0 + r() * 1.5 + energy * 1.0;
      const scale = 0.06 + r() * 0.05 + energy * 0.03;
      this.jetDroplets.spawn(x, topY, z, vx, vy, vz, scale);
    }
  }

  update(dt, time) {
    this.time = time;

    // Cavities: update, detect collapse-complete moment to spawn bubbles.
    for (let i = 0; i < this.cavities.length; i++) {
      const c = this.cavities[i];
      if (!c.active) continue;
      const prevAge = c.age;
      c.update(dt, time);
      // Spawn bubbles once, when the collapse pinch crosses its peak point
      // (roughly life*0.7), matching "spawned mainly at cavity collapse".
      if (!c._bubblesSpawned) {
        const collapseMark = c.life * 0.7;
        if (prevAge < collapseMark && c.age >= collapseMark) {
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
        null,
        (x, topY, z, energy, rand) => this._spawnJetDroplets(x, topY, z, energy, rand)
      );
    }

    // Particle fields.
    this.bubbles.update(dt, time);
    this.jetDroplets.update(dt);
  }
}
