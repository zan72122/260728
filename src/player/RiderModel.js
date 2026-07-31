import * as THREE from 'three';

/**
 * RiderModel — procedural float-tube + rider character.
 *
 * `object3D`'s local origin is the center of the float tube. Per SPEC §4.5,
 * `update(dt, state)` is responsible for placing `object3D` itself (position
 * + quaternion) from `state` — callers (main.js) never touch it directly.
 * Everything below the root is built from primitives (Torus/Capsule/Sphere)
 * with procedural CanvasTexture maps — no external assets.
 */

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Small seeded PRNG so texture noise is stable frame to frame / rebuild to rebuild. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Yellow x white candy-stripe pattern for the float tube, wrapped around its big circumference. */
function createTubeColorTexture() {
  const w = 1024, h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const stripes = 14;
  const rand = mulberry32(1234);
  for (let i = 0; i < stripes; i++) {
    const x0 = Math.round((i / stripes) * w);
    const x1 = Math.round(((i + 1) / stripes) * w);
    const yellow = i % 2 === 0;
    const base = yellow ? [255, 205, 25] : [250, 248, 240];
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.fillRect(x0, 0, x1 - x0, h);
    // soft edge highlight/shadow between stripes for a stitched-seam look
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.12)');
    grad.addColorStop(0.12, 'rgba(0,0,0,0)');
    grad.addColorStop(0.88, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, x1 - x0, h);
  }
  // subtle vinyl sheen speckle
  for (let i = 0; i < 900; i++) {
    const x = rand() * w, y = rand() * h;
    const r = 0.5 + rand() * 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // a printed "brand" band around the middle for visual interest
  ctx.fillStyle = 'rgba(30,90,160,0.85)';
  ctx.fillRect(0, h * 0.42, w, h * 0.16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Generic subtle bump normal map (RGB-encoded) for adding non-flat micro detail to any material. */
function createNoiseNormalTexture(size = 256, strength = 0.6, seed = 42, scale = 10) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  // build a small heightfield via layered blobs, then derive a normal map from it
  const height = new Float32Array(size * size);
  const blobs = 90;
  for (let i = 0; i < blobs; i++) {
    const cx = rand() * size, cy = rand() * size, rad = scale * (0.4 + rand());
    const amp = (rand() * 2 - 1);
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(size, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(size, Math.ceil(cy + rad));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d < 1) height[y * size + x] += amp * (1 - d * d);
      }
    }
  }
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = height[y * size + Math.max(0, x - 1)];
      const xr = height[y * size + Math.min(size - 1, x + 1)];
      const yu = height[Math.max(0, y - 1) * size + x];
      const yd = height[Math.min(size - 1, y + 1) * size + x];
      let nx = -(xr - xl) * strength;
      let ny = -(yd - yu) * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      img.data[idx] = (nx * 0.5 + 0.5) * 255;
      img.data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Skin tone with very subtle warm/cool mottling so it isn't a flat color. */
function createSkinTexture(hex) {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(hex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(7);
  for (let i = 0; i < 340; i++) {
    const x = rand() * size, y = rand() * size, r = 3 + rand() * 10;
    const warm = rand() > 0.5;
    const c = base.clone().offsetHSL(0, 0, warm ? 0.03 + rand() * 0.03 : -(0.03 + rand() * 0.03));
    ctx.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${0.10 + rand() * 0.10})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vivid swimsuit fabric: solid tone + a bold contrast side panel + fabric-weave speckle. */
function createSwimsuitTexture(hex, accentHex) {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(hex);
  const accent = new THREE.Color(accentHex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = `#${accent.getHexString()}`;
  ctx.fillRect(0, size * 0.38, size, size * 0.16);
  const rand = mulberry32(99);
  for (let i = 0; i < 2200; i++) {
    const x = rand() * size, y = rand() * size;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRoughnessTexture(size, base, variance, seed) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  const g = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, Math.round((base + (rand() - 0.5) * variance) * 255)));
    g.data[i * 4] = v; g.data[i * 4 + 1] = v; g.data[i * 4 + 2] = v; g.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(g, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const CAP_SEGMENTS = 8;
const RADIAL_SEGMENTS = 16;

function capsule(radius, totalLength) {
  const height = Math.max(0.01, totalLength - 2 * radius);
  return new THREE.CapsuleGeometry(radius, height, CAP_SEGMENTS, RADIAL_SEGMENTS);
}

function mkMesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A two-segment limb: an upper pivot (shoulder/hip) holding the upper mesh,
 * and a nested lower pivot (elbow/knee) holding the lower mesh. Both meshes
 * hang along local -Y from their pivot so rotating the pivot swings the limb
 * naturally around the joint.
 */
function buildLimb(parent, { attach, upperLen, upperRadius, lowerLen, lowerRadius, material, side }) {
  const upperPivot = new THREE.Group();
  upperPivot.position.copy(attach);
  parent.add(upperPivot);

  const upperMesh = mkMesh(capsule(upperRadius, upperLen), material);
  upperMesh.position.set(0, -upperLen / 2, 0);
  upperPivot.add(upperMesh);

  const lowerPivot = new THREE.Group();
  lowerPivot.position.set(0, -upperLen, 0);
  upperPivot.add(lowerPivot);

  const lowerMesh = mkMesh(capsule(lowerRadius, lowerLen), material);
  lowerMesh.position.set(0, -lowerLen / 2, 0);
  lowerPivot.add(lowerMesh);

  return { upperPivot, lowerPivot, side };
}

// ---------------------------------------------------------------------------
// RiderModel
// ---------------------------------------------------------------------------

const TUBE_MAJOR_RADIUS = 0.55;
const TUBE_TUBE_RADIUS = 0.22;

const TORSO_LEN = 0.46;
const TORSO_RADIUS = 0.125;
const HEAD_RADIUS = 0.105;
const UPPER_ARM_LEN = 0.27;
const UPPER_ARM_RADIUS = 0.05;
const FOREARM_LEN = 0.25;
const FOREARM_RADIUS = 0.042;
const THIGH_LEN = 0.30;
const THIGH_RADIUS = 0.072;
const SHIN_LEN = 0.30;
const SHIN_RADIUS = 0.055;

const HIP_Y = 0.15; // rider's hip height above the tube center (local space)

export class RiderModel {
  constructor() {
    this.object3D = new THREE.Group();
    this.object3D.name = 'RiderModel';

    this._buildTube();
    this._buildRider();

    // Damped animation parameters (all start at their resting target).
    this._a = {
      armSweepBack: 0.1,
      armOut: 0.35,
      elbowBend: 0.3,
      legForward: 0.16,
      kneeBend: 0.5,
      legSpread: 0,
      torsoRoll: 0,
      torsoPitch: -0.2,
      hipShiftX: 0,
      sinkY: 0,
      headBob: 0,
    };
  }

  setVisible(v) {
    this.object3D.visible = v;
  }

  // -------------------------------------------------------------------

  _buildTube() {
    const geo = new THREE.TorusGeometry(TUBE_MAJOR_RADIUS, TUBE_TUBE_RADIUS, 32, 96);
    const colorMap = createTubeColorTexture();
    colorMap.repeat.set(3, 1);
    const normalMap = createNoiseNormalTexture(256, 0.9, 11, 14);
    normalMap.repeat.set(6, 2);
    const mat = new THREE.MeshPhysicalMaterial({
      map: colorMap,
      normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.0,
    });
    const mesh = mkMesh(geo, mat);
    // TorusGeometry's default plane is XY (hole faces +Z); rotate so the hole
    // faces local +Y (the rider floats "inside" a horizontal ring).
    mesh.rotation.x = Math.PI / 2;
    this.object3D.add(mesh);
    this.tubeMesh = mesh;
  }

  _buildRider() {
    const skinTex = createSkinTexture(0xe0a878);
    const skinRough = createRoughnessTexture(64, 0.6, 0.15, 3);
    const skinNormal = createNoiseNormalTexture(128, 0.4, 21, 8);
    const skinMat = new THREE.MeshStandardMaterial({
      map: skinTex,
      normalMap: skinNormal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: skinRough,
      roughness: 0.6,
      metalness: 0.0,
    });

    const topTex = createSwimsuitTexture(0x1fb6c9, 0xff5a3c);
    const topRough = createRoughnessTexture(32, 0.45, 0.2, 55);
    const topMat = new THREE.MeshPhysicalMaterial({
      map: topTex,
      roughnessMap: topRough,
      roughness: 0.45,
      metalness: 0.0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
    });

    const bottomTex = createSwimsuitTexture(0xff5a3c, 0x1fb6c9);
    const bottomMat = new THREE.MeshPhysicalMaterial({
      map: bottomTex,
      roughness: 0.5,
      metalness: 0.0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
    });

    const hairTex = createSkinTexture(0x2c1c14);
    const hairMat = new THREE.MeshStandardMaterial({
      map: hairTex,
      roughness: 0.42,
      metalness: 0.05,
    });

    const rider = new THREE.Group();
    rider.position.set(0, HIP_Y, 0);
    this.object3D.add(rider);
    this.riderGroup = rider;

    const torsoPivot = new THREE.Group();
    rider.add(torsoPivot);
    this.torsoPivot = torsoPivot;

    const torsoMesh = mkMesh(capsule(TORSO_RADIUS, TORSO_LEN), topMat);
    torsoMesh.position.set(0, TORSO_LEN / 2, 0);
    torsoPivot.add(torsoMesh);

    // Shorts: a short, slightly larger-radius capsule sitting at the hip.
    const shortsMesh = mkMesh(capsule(TORSO_RADIUS * 1.12, TORSO_RADIUS * 1.8), bottomMat);
    shortsMesh.position.set(0, TORSO_RADIUS * 0.5, 0);
    torsoPivot.add(shortsMesh);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, TORSO_LEN + HEAD_RADIUS * 1.15, 0);
    torsoPivot.add(headGroup);
    this.headGroup = headGroup;

    const headMesh = mkMesh(new THREE.SphereGeometry(HEAD_RADIUS, 28, 20), skinMat);
    headGroup.add(headMesh);

    // Simple hair: a slightly-offset flattened sphere cap covering the back/top.
    const hairMesh = mkMesh(
      new THREE.SphereGeometry(HEAD_RADIUS * 1.08, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hairMat
    );
    hairMesh.position.set(0, HEAD_RADIUS * 0.18, 0);
    hairMesh.rotation.x = Math.PI * 0.03;
    headGroup.add(hairMesh);

    const shoulderY = TORSO_LEN - 0.045;
    const armAttachZ = 0.015;
    this.arms = [
      buildLimb(torsoPivot, {
        attach: new THREE.Vector3(TORSO_RADIUS + 0.02, shoulderY, armAttachZ),
        upperLen: UPPER_ARM_LEN, upperRadius: UPPER_ARM_RADIUS,
        lowerLen: FOREARM_LEN, lowerRadius: FOREARM_RADIUS,
        material: skinMat, side: 1,
      }),
      buildLimb(torsoPivot, {
        attach: new THREE.Vector3(-(TORSO_RADIUS + 0.02), shoulderY, armAttachZ),
        upperLen: UPPER_ARM_LEN, upperRadius: UPPER_ARM_RADIUS,
        lowerLen: FOREARM_LEN, lowerRadius: FOREARM_RADIUS,
        material: skinMat, side: -1,
      }),
    ];

    const hipOffsetX = 0.1;
    this.legs = [
      buildLimb(rider, {
        attach: new THREE.Vector3(hipOffsetX, 0.02, 0.01),
        upperLen: THIGH_LEN, upperRadius: THIGH_RADIUS,
        lowerLen: SHIN_LEN, lowerRadius: SHIN_RADIUS,
        material: skinMat, side: 1,
      }),
      buildLimb(rider, {
        attach: new THREE.Vector3(-hipOffsetX, 0.02, 0.01),
        upperLen: THIGH_LEN, upperRadius: THIGH_RADIUS,
        lowerLen: SHIN_LEN, lowerRadius: SHIN_RADIUS,
        material: skinMat, side: -1,
      }),
    ];
    // Legs point roughly forward/down at rest rather than straight down.
    for (const leg of this.legs) {
      leg.upperPivot.rotation.x = 1.15;
      leg.lowerPivot.rotation.x = -0.9;
    }
  }

  // -------------------------------------------------------------------

  /** @param {number} dt @param {import('./RiderPhysics.js').RiderPhysics['state']} state */
  update(dt, state) {
    // Root placement comes straight from physics — RiderModel owns applying it.
    this.object3D.position.copy(state.position);
    this.object3D.quaternion.copy(state.quaternion);

    const speedT = THREE.MathUtils.clamp(state.speed / 26, 0, 1);
    const lean = THREE.MathUtils.clamp(state.lean, -1, 1);
    const gExtra = Math.max(0, state.gForce - 1);
    const air = state.airborne ? 1 : 0;

    const a = this._a;
    const damp = (cur, target, rate) => THREE.MathUtils.damp(cur, target, rate, dt);

    // Arms trail back and out with speed; spread wide when airborne.
    const targetArmBack = THREE.MathUtils.lerp(0.05, 1.2, speedT) * (1 - 0.55 * air);
    const targetArmOut = THREE.MathUtils.lerp(0.32, 0.5, speedT) + air * 0.85;
    const targetElbowBend = THREE.MathUtils.lerp(0.22, 0.55, speedT) * (1 - air) + air * 0.1;
    a.armSweepBack = damp(a.armSweepBack, targetArmBack, 5);
    a.armOut = damp(a.armOut, targetArmOut, 5);
    a.elbowBend = damp(a.elbowBend, targetElbowBend, 6);

    // Legs tuck forward normally, spread wide when airborne.
    const targetLegForward = THREE.MathUtils.lerp(0.18, 0.08, speedT) * (1 - air) + air * -0.25;
    const targetKneeBend = THREE.MathUtils.lerp(0.6, 0.35, speedT) * (1 - air) + air * 0.15;
    const targetLegSpread = air * 0.42;
    a.legForward = damp(a.legForward, targetLegForward, 5);
    a.kneeBend = damp(a.kneeBend, targetKneeBend, 6);
    a.legSpread = damp(a.legSpread, targetLegSpread, 6);

    // Upper body leans with `lean`, and shifts weight toward the turn.
    const targetTorsoRoll = lean * 0.34;
    const targetTorsoPitch = -0.22 + speedT * 0.1 - gExtra * 0.06 + air * 0.12;
    const targetHipShiftX = lean * 0.065;
    a.torsoRoll = damp(a.torsoRoll, targetTorsoRoll, 6);
    a.torsoPitch = damp(a.torsoPitch, targetTorsoPitch, 5);
    a.hipShiftX = damp(a.hipShiftX, targetHipShiftX, 6);

    // Body sinks under high G (pressed down into the tube); floats up a touch
    // when weightless in the air.
    const targetSink = -gExtra * 0.05 + air * 0.02;
    a.sinkY = damp(a.sinkY, targetSink, 8);

    // Tiny idle head bob from splashing/vibration for extra life.
    const targetHeadBob = Math.min(1, state.splashRate) * 0.015;
    a.headBob = damp(a.headBob, targetHeadBob, 7);

    this.torsoPivot.rotation.set(a.torsoPitch, 0, a.torsoRoll);
    this.riderGroup.position.set(a.hipShiftX, HIP_Y + a.sinkY, 0);
    this.headGroup.position.y = TORSO_LEN + HEAD_RADIUS * 1.15 + a.headBob;

    for (const arm of this.arms) {
      arm.upperPivot.rotation.set(-a.armSweepBack, 0, arm.side * a.armOut);
      arm.lowerPivot.rotation.set(-a.elbowBend, 0, 0);
    }
    for (const leg of this.legs) {
      leg.upperPivot.rotation.set(1.15 + a.legForward, 0, leg.side * a.legSpread);
      leg.lowerPivot.rotation.set(-0.9 + a.kneeBend * 0.4, 0, 0);
    }
  }
}
