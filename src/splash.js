// src/splash.js — D (above-water splash) — see docs/CONTRACTS.md.
// THE STAR OF THE GAME. Layered crown + sheet + droplets + mist, all pooled.
//
// update(dt, time): dt is SCALED (slow-mo already applied). Every splash
// animates from its own accumulated `age` so slow-motion just naturally
// stretches the curves below — no wall-clock dependence anywhere.

import * as THREE from 'three';
import { G } from './constants.js';
import { mulberry32 } from './rng.js';

// ---- tunables -------------------------------------------------------
const MAX_SPLASHES = 4;      // ≥3 concurrent required; 4 gives headroom
const CROWN_COLUMNS = 32;    // rim columns around the lathe ring
const CROWN_LIFE = 0.9;      // seconds (scaled) — rise/flare/fall
const SHEET_LIFE = 0.6;      // seconds (scaled) — sheet fades out by then, peak ~0.25s
const DROPLET_CAP = 300;
const MIST_SPRITES = 2;      // per splash slot

// ---- small reusable scratch (no per-frame allocations) --------------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

// Build a canvas radial-gradient texture for mist sprites (once, shared).
function makeMistTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(235,248,255,0.55)');
  g.addColorStop(1.0, 'rgba(220,245,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Build the (shared, static-topology) thick-walled crown ring geometry.
// Two vertex rings per wall (inner+outer) × top/bottom, so it has real
// thickness. Per-instance jitter is applied by overwriting the position
// buffer of each splash's own geometry clone at trigger() time — the
// column count/topology never changes, only per-column height/radius, so
// we can keep one index buffer shared across all pooled crowns.
function buildCrownGeometry() {
  const cols = CROWN_COLUMNS;
  // Ring layout per column: 0=outerBottom 1=innerBottom 2=innerTop 3=outerTop
  const ringsPerCol = 4;
  const vertCount = cols * ringsPerCol;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];
  for (let i = 0; i < cols; i++) {
    const i0 = i * ringsPerCol;
    const j = (i + 1) % cols;
    const j0 = j * ringsPerCol;
    // outer wall quad (outerBottom, outerTop) -> facing outward
    indices.push(i0 + 0, j0 + 0, j0 + 3, i0 + 0, j0 + 3, i0 + 3);
    // inner wall quad (innerBottom, innerTop) -> facing inward (reverse winding)
    indices.push(i0 + 1, i0 + 2, j0 + 2, i0 + 1, j0 + 2, j0 + 1);
    // top rim cap (innerTop -> outerTop)
    indices.push(i0 + 2, i0 + 3, j0 + 3, i0 + 2, j0 + 3, j0 + 2);
    // bottom cap (outerBottom -> innerBottom) — mostly hidden but seals geometry
    indices.push(i0 + 0, i0 + 1, j0 + 1, i0 + 0, j0 + 1, j0 + 0);
  }
  for (let i = 0; i < cols; i++) {
    const v = i / cols;
    const base = i * ringsPerCol * 2;
    uvs[base + 0] = v; uvs[base + 1] = 0;
    uvs[base + 2] = v; uvs[base + 3] = 0;
    uvs[base + 4] = v; uvs[base + 5] = 1;
    uvs[base + 6] = v; uvs[base + 7] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
  return geo;
}

// Fill the crown's live position buffer for a given splash slot's params.
// Called once at trigger() time (shape is deterministic from seed) and
// re-derived each frame only via a uniform-driven vertex transform done
// on the CPU in update() (cheap: 24 cols × 4 rings = 96 verts).
function layoutCrown(slot, spec) {
  const rng = mulberry32(spec.seed);
  const cols = CROWN_COLUMNS;
  const energy = spec.energy;
  const flat = spec.flatness;
  const soft = spec.def && spec.def.softness ? spec.def.softness : 0;
  const baseHeight = 0.35 + energy * 1.55 * (1 - flat * 0.6);
  const baseWidth = spec.size * 0.9 + energy * (0.55 + flat * 1.15) + soft * 0.15;
  const wallThickness = 0.05 + energy * 0.05 + soft * 0.03;
  const obliqueAmt = spec.oblique > 0.3 ? (spec.oblique - 0.3) / 0.7 : 0;
  const dirX = spec.dir ? spec.dir.x : 0;
  const dirZ = spec.dir ? spec.dir.y : 0; // dir is a Vector2 (x, z)

  const cols4 = cols * 4;
  const heights = slot.crownHeights || (slot.crownHeights = new Float32Array(cols));
  const outerR = slot.crownOuterR || (slot.crownOuterR = new Float32Array(cols));
  const innerR = slot.crownInnerR || (slot.crownInnerR = new Float32Array(cols));
  const tipStretch = slot.crownTipStretch || (slot.crownTipStretch = new Float32Array(cols));

  for (let i = 0; i < cols; i++) {
    const ang = (i / cols) * Math.PI * 2;
    const cx = Math.cos(ang), cz = Math.sin(ang);
    // one-sided fan bias: dot with dir in [-1,1] -> weight in [suppressed..boosted]
    let dirWeight = 1;
    if (obliqueAmt > 0) {
      const dot = cx * dirX + cz * dirZ; // -1 near side .. +1 far side
      dirWeight = 1 + obliqueAmt * (dot * 1.4);
      dirWeight = Math.max(0.15, dirWeight);
    }
    // gentler per-column variance than before (was 0.75-1.25) — the raw
    // silhouette is smoothed below, so we don't need huge raw jitter to
    // still read as an irregular, organic (not perfectly circular) rim.
    const jitter = 0.85 + rng() * 0.3;
    heights[i] = baseHeight * jitter * dirWeight;
    const wJit = 0.9 + rng() * 0.2;
    outerR[i] = baseWidth * wJit * (0.7 + 0.3 * dirWeight);
    tipStretch[i] = 0.6 + rng() * 0.8; // rim tip elongation factor at peak
  }
  // Smooth the rim (circular moving-average, a couple of light passes) so
  // neighbouring columns don't jump wildly — turns the spiky paper-cutout
  // silhouette into soft, rounded lobes like real thick water, while still
  // keeping an organic (non-circular) outline from the underlying jitter.
  smoothCircular(heights, 2);
  smoothCircular(outerR, 2);
  smoothCircular(tipStretch, 2);
  for (let i = 0; i < cols; i++) {
    innerR[i] = Math.max(0.05, outerR[i] - wallThickness * (0.8 + rng() * 0.4));
  }
  slot.crownBaseHeight = baseHeight;
  slot.crownWallThickness = wallThickness;
}

// Circular moving-average smoothing (wraps around, in place) — rounds off
// per-column jitter into soft lobes instead of sharp spikes.
function smoothCircular(arr, passes) {
  const n = arr.length;
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const prev = arr[(i - 1 + n) % n];
      const next = arr[(i + 1) % n];
      tmp[i] = prev * 0.25 + arr[i] * 0.5 + next * 0.25;
    }
    arr.set(tmp);
  }
}

// Write the crown geometry's position buffer for the current animation
// phase `k` (0..1 shape progress) and vertical rise `rise` (0..1).
function writeCrownPositions(slot, k, riseK, flareK, fallK) {
  const geo = slot.crownGeo;
  const pos = geo.attributes.position.array;
  const cols = CROWN_COLUMNS;
  const heights = slot.crownHeights;
  const outerR = slot.crownOuterR;
  const innerR = slot.crownInnerR;
  const tipStretch = slot.crownTipStretch;
  const wallThickness = slot.crownWallThickness;
  for (let i = 0; i < cols; i++) {
    const ang = (i / cols) * Math.PI * 2;
    const cx = Math.cos(ang), cz = Math.sin(ang);
    const h = heights[i] * riseK * (1 + tipStretch[i] * flareK * 0.6) * fallK;
    const flare = 1 + flareK * 0.5 * tipStretch[i];
    const oR = outerR[i] * (0.35 + 0.65 * riseK) * flare;
    const iR = Math.max(0.02, oR - wallThickness);
    const base = i * 4 * 3;
    // outerBottom
    pos[base + 0] = cx * (iR + wallThickness * 0.3); pos[base + 1] = 0.0; pos[base + 2] = cz * (iR + wallThickness * 0.3);
    // innerBottom
    pos[base + 3] = cx * iR; pos[base + 4] = 0.0; pos[base + 5] = cz * iR;
    // innerTop
    pos[base + 6] = cx * (iR * 0.9); pos[base + 7] = h; pos[base + 8] = cz * (iR * 0.9);
    // outerTop (rim tip — flares out and elongates)
    pos[base + 9] = cx * oR; pos[base + 10] = h * (1 + flareK * 0.25); pos[base + 11] = cz * oR;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
}

// Vertical gradient vertex colors: whiter near rim (top), blue-white base.
function writeCrownColors(geo) {
  const col = geo.attributes.color.array;
  const pos = geo.attributes.position.array;
  let maxH = 0.001;
  for (let i = 1; i < pos.length; i += 3) maxH = Math.max(maxH, pos[i]);
  for (let i = 0, c = 0; i < pos.length; i += 3, c += 3) {
    const t = Math.min(1, Math.max(0, pos[i + 1] / maxH));
    // base: saturated blue-white (liquid, in-shadow), rim: bright near-pure
    // white (catches the light) — stronger gradient reads as glossy/thick
    // water instead of a flat matte cutout.
    col[c + 0] = 0.52 + 0.46 * t;
    col[c + 1] = 0.74 + 0.25 * t;
    col[c + 2] = 0.94 + 0.06 * t;
  }
  geo.attributes.color.needsUpdate = true;
}

export class SplashFX {
  constructor(scene) {
    this.scene = scene;
    this.onDropletLand = null;

    this._mistTex = makeMistTexture();

    // ---- pooled slots (crown mesh + sheet mesh + mist sprites each) ----
    this.slots = [];
    for (let s = 0; s < MAX_SPLASHES; s++) {
      const crownGeo = buildCrownGeometry();
      const crownMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const crownMesh = new THREE.Mesh(crownGeo, crownMat);
      crownMesh.visible = false;
      crownMesh.frustumCulled = false;
      scene.add(crownMesh);

      const sheetGeo = new THREE.RingGeometry(0.05, 0.12, 40, 1);
      const sheetMat = new THREE.MeshBasicMaterial({
        color: 0xe8faff,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const sheetMesh = new THREE.Mesh(sheetGeo, sheetMat);
      sheetMesh.rotation.x = -Math.PI / 2;
      sheetMesh.visible = false;
      sheetMesh.frustumCulled = false;
      scene.add(sheetMesh);

      const mistSprites = [];
      for (let m = 0; m < MIST_SPRITES; m++) {
        const spriteMat = new THREE.SpriteMaterial({
          map: this._mistTex,
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
          blending: THREE.NormalBlending,
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.visible = false;
        scene.add(sprite);
        mistSprites.push(sprite);
      }

      this.slots.push({
        active: false,
        age: 0,
        spec: null,
        crownMesh, crownGeo, crownMat,
        sheetMesh, sheetMat,
        mistSprites,
        // per-column jitter arrays populated in layoutCrown()
        crownHeights: null, crownOuterR: null, crownInnerR: null, crownTipStretch: null,
        crownBaseHeight: 1, crownWallThickness: 0.05,
        sheetBaseRadius: 1, sheetScaleX: 1, sheetScaleZ: 1,
        mistBaseScale: 0.5,
      });
    }
    this._nextSlot = 0;

    // ---- shared droplet InstancedMesh (all splashes draw from ONE pool) ----
    // subdivision 1 (80 faces) so droplets read as small round beads of
    // water rather than crystalline low-poly chunks; still cheap at 300
    // instances (~24k tris for the whole pool).
    const dropGeo = new THREE.IcosahedronGeometry(1, 1); // unit radius, scaled per-instance
    // NOTE: do NOT set `vertexColors: true` here. This geometry has no
    // 'color' attribute, but three.js still defines USE_COLOR from the
    // material flag alone; the vertex shader then does `vColor *= color`
    // against a missing attribute (which reads as black), zeroing vColor
    // *before* it gets multiplied by instanceColor — every droplet renders
    // solid black regardless of the instance color set below. instanceColor
    // is picked up automatically (USE_INSTANCING_COLOR) without needing
    // material.vertexColors at all, so just omit it.
    const dropMat = new THREE.MeshBasicMaterial({
      color: 0xeaf9ff, // bright white with a slight blue tint
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });
    this.dropletMesh = new THREE.InstancedMesh(dropGeo, dropMat, DROPLET_CAP);
    this.dropletMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DROPLET_CAP * 3), 3);
    this.dropletMesh.frustumCulled = false;
    this.dropletMesh.count = 0;
    scene.add(this.dropletMesh);

    // droplet pool state (SoA, preallocated)
    this.dCap = DROPLET_CAP;
    this.dActive = new Uint8Array(DROPLET_CAP);
    this.dPos = new Float32Array(DROPLET_CAP * 3);
    this.dVel = new Float32Array(DROPLET_CAP * 3);
    this.dLife = new Float32Array(DROPLET_CAP);
    this.dAge = new Float32Array(DROPLET_CAP);
    this.dSize = new Float32Array(DROPLET_CAP);
    this.dCursor = 0; // ring-buffer allocation cursor
    this.dCount = 0;  // number currently active (contiguous not required)
  }

  // -------------------------------------------------------------- trigger
  trigger(spec) {
    const slot = this.slots[this._nextSlot];
    this._nextSlot = (this._nextSlot + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.spec = spec;

    layoutCrown(slot, spec);
    writeCrownColors(slot.crownGeo);
    slot.crownMesh.position.set(spec.point.x, 0, spec.point.z);
    slot.crownMesh.rotation.y = 0;
    slot.crownMesh.visible = true;
    slot.crownMat.opacity = 0;

    const flat = spec.flatness;
    const energy = spec.energy;
    slot.sheetBaseRadius = 0.15 + spec.size + energy * (0.5 + flat * 1.6);
    slot.sheetBaseRadius = Math.min(2.6, slot.sheetBaseRadius);
    const obliqueAmt = spec.oblique > 0.3 ? (spec.oblique - 0.3) / 0.7 : 0;
    slot.sheetScaleX = 1 + obliqueAmt * 0.9;
    slot.sheetScaleZ = 1 - obliqueAmt * 0.35;
    slot.sheetMesh.position.set(spec.point.x, 0.03, spec.point.z);
    const dirAngle = spec.dir && (spec.dir.x !== 0 || spec.dir.y !== 0)
      ? Math.atan2(spec.dir.y, spec.dir.x) : 0;
    slot.sheetMesh.rotation.set(-Math.PI / 2, 0, 0);
    slot.sheetMesh.rotation.z = -dirAngle; // stretch axis toward dir after scale
    slot.sheetMesh.visible = true;
    slot.sheetMat.opacity = 0;

    const soft = spec.def && spec.def.softness ? spec.def.softness : 0;
    slot.mistBaseScale = 0.4 + energy * 1.1 + soft * 0.2;
    for (let m = 0; m < slot.mistSprites.length; m++) {
      const spr = slot.mistSprites[m];
      const ox = (m === 0 ? 0 : (Math.random() - 0.5) * spec.size * 1.5);
      const oz = (m === 0 ? 0 : (Math.random() - 0.5) * spec.size * 1.5);
      spr.position.set(spec.point.x + ox, 0.05 + m * 0.03, spec.point.z + oz);
      spr.visible = true;
      spr.material.opacity = 0;
      spr.scale.setScalar(slot.mistBaseScale * (m === 0 ? 1 : 0.6));
    }

    this._spawnDroplets(spec);
  }

  // ---------------------------------------------------------- droplets
  _allocDroplet() {
    // simple ring-buffer allocator: reuse slot at cursor regardless of
    // whether it's active (oldest droplet gets recycled under pressure —
    // acceptable, keeps this allocation O(1) with zero per-frame cost).
    const idx = this.dCursor;
    this.dCursor = (this.dCursor + 1) % this.dCap;
    if (!this.dActive[idx]) this.dCount++;
    this.dActive[idx] = 1;
    return idx;
  }

  _spawnDroplets(spec) {
    const rng = mulberry32(spec.seed ^ 0x9e3779b9);
    const energy = spec.energy;
    const flat = spec.flatness;
    const soft = spec.def && spec.def.softness ? spec.def.softness : 0;
    const oblique = spec.oblique || 0;
    const obliqueAmt = oblique > 0.3 ? (oblique - 0.3) / 0.7 : 0;
    const dirX = spec.dir ? spec.dir.x : 0;
    const dirZ = spec.dir ? spec.dir.y : 0;
    const px = spec.point.x, pz = spec.point.z;

    // --- big chunky droplets: deterministic, launched from crown rim ---
    const bigCount = Math.round(10 + energy * 26 * (0.6 + flat * 0.4));
    for (let i = 0; i < bigCount; i++) {
      const ang = rng() * Math.PI * 2;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      let dirWeight = 1;
      if (obliqueAmt > 0) {
        const dot = cx * dirX + cz * dirZ;
        dirWeight = Math.max(0.15, 1 + obliqueAmt * (dot * 1.4));
      }
      const rimR = (spec.size * 0.9 + energy * (0.55 + flat * 1.15)) * (0.7 + 0.3 * dirWeight) * (0.7 + rng() * 0.5);
      const speed = (2.2 + energy * 6.5) * (0.7 + rng() * 0.6) * dirWeight * (1 - soft * 0.25);
      const upBias = (0.55 + rng() * 0.45) * (1 - flat * 0.35);
      const idx = this._allocDroplet();
      const b = idx * 3;
      this.dPos[b + 0] = px + cx * rimR * 0.4;
      this.dPos[b + 1] = 0.05 + rng() * 0.1;
      this.dPos[b + 2] = pz + cz * rimR * 0.4;
      this.dVel[b + 0] = cx * speed;
      this.dVel[b + 1] = speed * upBias * 1.3;
      this.dVel[b + 2] = cz * speed;
      this.dLife[idx] = 1.0 + rng() * 0.6 + soft * 0.3;
      this.dAge[idx] = 0;
      this.dSize[idx] = (0.045 + rng() * 0.05 + soft * 0.025) * (0.7 + energy * 0.6);
    }

    // --- fine spray: Math.random, more numerous & smaller ---
    const fineCount = Math.round(20 + energy * 55);
    for (let i = 0; i < fineCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      let dirWeight = 1;
      if (obliqueAmt > 0) {
        const dot = cx * dirX + cz * dirZ;
        dirWeight = Math.max(0.15, 1 + obliqueAmt * (dot * 1.4));
      }
      const speed = (2.5 + energy * 8) * (0.6 + Math.random() * 0.8) * dirWeight;
      const upBias = 0.4 + Math.random() * 0.8;
      const idx = this._allocDroplet();
      const b = idx * 3;
      const r0 = spec.size * 0.5 * Math.random();
      this.dPos[b + 0] = px + cx * r0;
      this.dPos[b + 1] = 0.03 + Math.random() * 0.08;
      this.dPos[b + 2] = pz + cz * r0;
      this.dVel[b + 0] = cx * speed;
      this.dVel[b + 1] = speed * upBias;
      this.dVel[b + 2] = cz * speed;
      this.dLife[idx] = 0.5 + Math.random() * 0.5;
      this.dAge[idx] = 0;
      this.dSize[idx] = 0.015 + Math.random() * 0.02 + soft * 0.01;
    }
  }

  // -------------------------------------------------------------- update
  update(dt, time) {
    this._updateCrownsAndSheets(dt);
    this._updateDroplets(dt);
  }

  _updateCrownsAndSheets(dt) {
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (!slot.active) continue;
      slot.age += dt;
      const spec = slot.spec;
      const soft = spec.def && spec.def.softness ? spec.def.softness : 0;

      // ---- crown timeline (0..CROWN_LIFE, scaled) ----
      const ct = slot.age / CROWN_LIFE;
      if (ct >= 1) {
        slot.crownMesh.visible = false;
      } else {
        // rise fast (0-0.28), flare (0.15-0.55), fall/fade (0.5-1.0)
        const riseK = smooth01(clamp01(ct / 0.28));
        const flareK = smooth01(clamp01((ct - 0.12) / 0.45));
        const fallK = 1 - smooth01(clamp01((ct - 0.45) / 0.55)) * (1 - 0.15 - soft * 0.1);
        writeCrownPositions(slot, ct, riseK, flareK, fallK);
        let alpha;
        if (ct < 0.1) alpha = smooth01(ct / 0.1);
        else alpha = 1 - smooth01(clamp01((ct - 0.55) / 0.45));
        // slight transparency (glossy film, not solid paper): peak ~0.85
        slot.crownMat.opacity = Math.min(0.9, alpha * 0.85);
      }

      // ---- sheet timeline (0..SHEET_LIFE) ----
      const st = slot.age / SHEET_LIFE;
      if (st >= 1) {
        slot.sheetMesh.visible = false;
      } else {
        const growK = smooth01(clamp01(st / 0.42)); // peaks ~0.25s scaled fraction
        const r = 0.08 + slot.sheetBaseRadius * growK;
        const inner = Math.max(0.02, r * 0.55);
        rebuildRing(slot.sheetMesh.geometry, inner, r, slot.sheetScaleX, slot.sheetScaleZ);
        const alpha = st < 0.15 ? smooth01(st / 0.15) : 1 - smooth01(clamp01((st - 0.3) / 0.7));
        // thin glossy film, not solid paper: keep it visibly translucent
        slot.sheetMat.opacity = Math.min(0.42, alpha * 0.38);
      }

      // ---- mist timeline (quick puff, ~0.5s) ----
      const mt = slot.age / 0.55;
      for (let m = 0; m < slot.mistSprites.length; m++) {
        const spr = slot.mistSprites[m];
        if (mt >= 1) { spr.visible = false; continue; }
        const growK = smooth01(clamp01(mt / 0.3));
        const fadeK = 1 - smooth01(clamp01((mt - 0.25) / 0.75));
        const sc = slot.mistBaseScale * (m === 0 ? 1 : 0.6) * (0.6 + growK * 0.7);
        spr.scale.setScalar(sc);
        spr.material.opacity = Math.min(0.6, fadeK * 0.55);
      }

      // ---- retire slot once everything finished ----
      if (ct >= 1 && st >= 1 && mt >= 1) {
        slot.active = false;
        slot.spec = null;
      }
    }
  }

  _updateDroplets(dt) {
    const cap = this.dCap;
    const active = this.dActive;
    const pos = this.dPos, vel = this.dVel, life = this.dLife, age = this.dAge, size = this.dSize;
    let writeIdx = 0;
    const mesh = this.dropletMesh;
    for (let i = 0; i < cap; i++) {
      if (!active[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) {
        active[i] = 0;
        this.dCount--;
        continue;
      }
      const b = i * 3;
      // ballistic integration
      vel[b + 1] -= G * dt;
      pos[b + 0] += vel[b + 0] * dt;
      pos[b + 1] += vel[b + 1] * dt;
      pos[b + 2] += vel[b + 2] * dt;

      if (pos[b + 1] <= 0) {
        pos[b + 1] = 0;
        if (this.onDropletLand) {
          this.onDropletLand(pos[b + 0], pos[b + 2], size[i]);
        }
        active[i] = 0;
        this.dCount--;
        continue;
      }

      // write instance transform: position + velocity-aligned stretch
      _v0.set(pos[b + 0], pos[b + 1], pos[b + 2]);
      const speed = Math.sqrt(vel[b] * vel[b] + vel[b + 1] * vel[b + 1] + vel[b + 2] * vel[b + 2]);
      const lifeT = age[i] / life[i];
      const fade = lifeT > 0.7 ? 1 - (lifeT - 0.7) / 0.3 : 1;
      const s = size[i] * (0.6 + 0.4 * fade);
      const stretchY = 1 + Math.min(1.6, speed * 0.05);
      if (speed > 0.001) {
        _v1.set(vel[b], vel[b + 1], vel[b + 2]).normalize();
        _quat.setFromUnitVectors(_up, _v1);
      } else {
        _quat.identity();
      }
      _scale.set(s, s * stretchY, s);
      _mat4.compose(_v0, _quat, _scale);
      mesh.setMatrixAt(writeIdx, _mat4);
      // per-droplet deterministic sparkle: a cheap index hash gives each
      // droplet a slightly different brightness so the cluster reads as
      // glinting water rather than a flat mass of identical chunks.
      const hash = ((i * 2654435761) >>> 0) / 4294967295;
      const sparkle = 0.92 + 0.14 * hash;
      _color.setRGB(
        Math.min(1, (0.82 + 0.18 * fade) * sparkle),
        Math.min(1, (0.92 + 0.08 * fade) * sparkle),
        1.0
      );
      mesh.instanceColor.setXYZ(writeIdx, _color.r, _color.g, _color.b);
      writeIdx++;
      if (writeIdx >= cap) break;
    }
    mesh.count = writeIdx;
    if (writeIdx > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---- small math helpers ---------------------------------------------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x) { return x * x * (3 - 2 * x); }

// Rebuild a RingGeometry's vertices in place to the given inner/outer
// radius with elliptical (oblique fan) scaling — avoids allocating a new
// geometry every frame (only touches the position buffer).
function rebuildRing(geo, inner, outer, scaleX, scaleZ) {
  const posAttr = geo.attributes.position;
  const arr = posAttr.array;
  const segCount = (arr.length / 3 - 1) / 2 | 0; // approx segments+1 per ring from RingGeometry layout
  // RingGeometry lays out vertices ring-by-ring (phiSegments+1) each with
  // (thetaSegments+1) points; original was built with thetaSegments=40,
  // phiSegments=1 -> 2 rings of 41 verts = 82 verts.
  const thetaSeg = 40;
  const vertsPerRing = thetaSeg + 1;
  for (let ring = 0; ring < 2; ring++) {
    const r = ring === 0 ? inner : outer;
    for (let t = 0; t <= thetaSeg; t++) {
      const idx = ring * vertsPerRing + t;
      const angle = (t / thetaSeg) * Math.PI * 2;
      const x = Math.cos(angle) * r * scaleX;
      const y = Math.sin(angle) * r * scaleZ;
      const base = idx * 3;
      arr[base + 0] = x;
      arr[base + 1] = y;
      arr[base + 2] = 0;
    }
  }
  posAttr.needsUpdate = true;
}
