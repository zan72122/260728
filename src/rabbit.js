// src/rabbit.js — S1 (Rabbit Experience Overhaul, docs/CONTRACTS-RABBIT.md)
//
// Procedural, code-animated white rabbit character: climbs the diving
// tower, fetches/stows a toy from a per-platform crate, aims, winds up and
// throws, cheers, and watches a world point. No skinned meshes/clips — every
// motion is a hand-written ease/spring driving a small hierarchy of
// Object3D pivots. Draw-call budget (<=10 total, incl. the 3 toy crates)
// is hit by using THREE.InstancedMesh for every left/right or per-platform
// repeated part (ears, arms, legs, crates, peeking balls) and a canvas face
// texture on the head instead of separate eye/nose/cheek meshes.
//
// Mega splash tier (docs/CONTRACTS-MEGA.md "M1"): boardGondola/exitGondola/
// fetchGiantToy/heaveThrow reuse the exact same pivots/springs above — no
// new meshes. See the block of constants above GONDOLA_HOP_DUR for the
// gondola-riding tunables and the pawAnchor clearance tradeoff.
//
// pawAnchor placement note (see constructor comment above PAW_HOLD_Y_OFFSET):
// the contract's literal "tip.y + ~0.15" sits only ~3cm above the physical
// board-top surface (tip.y is the board's CENTER height in scene.js, top is
// tip.y+0.12) — too low to read as "paws held overhead" for a rabbit that
// must stand ON TOP of the board (never sunk into it). This file keeps the
// pawAnchor directly above the tip (same x/z, preserving throw-origin
// continuity) but raises the y offset enough that the visual "offering the
// toy overhead" pose the contract's own validation step requires actually
// reads that way; see the constant + report for the exact value chosen.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Small math helpers (no per-frame allocation).
// ---------------------------------------------------------------------------
function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
function easeOutCubic(t) {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}
function easeInCubic(t) {
  const c = clamp01(t);
  return c * c * c;
}
function easeInOutCubic(t) {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
function easeOutBack(t) {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  const c = clamp01(t);
  return c < 0.5
    ? (Math.pow(2 * c, 2) * ((c2 + 1) * 2 * c - c2)) / 2
    : (Math.pow(2 * c - 2, 2) * ((c2 + 1) * (c * 2 - 2) + c2) + 2) / 2;
}
// Damped approach toward a target, framerate independent (exponential decay).
function damp(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(2, -dt / halfLife);
  return current + (target - current) * t;
}
// Explicit spring integrator (semi-implicit Euler): state = {v, vel}.
function springStep(state, target, k, c, dt) {
  const accel = -k * (state.v - target) - c * state.vel;
  state.vel += accel * dt;
  state.v += state.vel * dt;
}

// ---------------------------------------------------------------------------
// Tunable dimensions (meters). Chosen so total standing height (feet to ear
// tip, ears upright) reads as "~0.55m tall" next to the PLATFORMS boards.
// ---------------------------------------------------------------------------
const LEG_LEN = 0.075;
const LEG_R = 0.032;
const BODY_H = 0.21; // hip to neck
const BODY_R_BOTTOM = 0.1;
const BODY_R_TOP = 0.045;
const HEAD_R = 0.078;
const EAR_LEN = 0.15;
const EAR_R = 0.024;
const ARM_LEN = 0.11;
const ARM_R = 0.026;
const TAIL_R = 0.05;

// Board-top surface sits this far above a PLATFORMS[i].tip.y (matches
// scene.js: board center = tip.y, BOARD_THICK = 0.24 -> top = tip.y+0.12).
const FOOT_Y_OFFSET = 0.12;
// scene.js's tip-end cap is a SPHERE (radius = BOARD_WIDTH/2 = 0.5) whose
// dome only reaches the full FOOT_Y_OFFSET height at its own local center —
// which sits exactly BOARD_WIDTH/2 back from tip.x, with the flat mid-board
// box picking up from there. Standing the rabbit exactly ON tip.x (the very
// rim of that dome) put its feet a full 0.12m ABOVE the true local surface
// there (the dome curves down to meet `height`, not `height+0.12`, right at
// the rim) — a visible floating gap. Standing this far back lands on the
// flat box/dome-apex seam instead (exactly FOOT_Y_OFFSET, no curvature
// error), while still reading as "right at the tip". pawAnchor and the toy
// crates still key off the raw tip — only the rabbit's own feet move back.
const STAND_BACK_FROM_TIP = 0.5;
// Approx ladder-side X offset (from a platform tip) used to route climbTo
// without ever cutting through a board; scene.js's actual pillars sit near
// tip.x-2.6, this stays short of that (a stylized "climb to the rail side"
// rather than literally reaching the pillar mesh).
const LADDER_DX = -2.3;
// See file-header note: raised from the contract's literal "~0.15" so the
// held toy visually sits at/near the rabbit's raised paws instead of its
// ankles. Same (x,z) as the tip either way.
const PAW_HOLD_Y_OFFSET = 0.46;

const MAX_LEAN = (20 * Math.PI) / 180; // aimLean clamp, per contract

// ---------------------------------------------------------------------------
// Mega splash tier additions (docs/CONTRACTS-MEGA.md "M1 — balloon, sky
// access, rabbit"): boardGondola/exitGondola/fetchGiantToy/heaveThrow, plus
// gondola-riding. These reuse the same pivots/springs as the ground
// workflow above — no new meshes, no new draw calls.
// ---------------------------------------------------------------------------
const GONDOLA_HOP_DUR = 0.65; // boardGondola hop, scaled seconds
const EXIT_HOP_DUR = 0.6; // exitGondola hop, scaled seconds
const FETCH_GIANT_DUR = 1.0; // two-arm heave from the giant crate, per contract "~1.0s"
const HEAVE_THROW_DUR = 0.8; // slow whole-body push, per contract "~0.8s"
// Paw-hold height while gondola-riding, measured from the basket floor
// (== gondolaAnchor, == root position while riding). The contract asks for
// enough clearance that a toy of radius up to 1.5m clears BOTH the basket
// rim and the balloon ropes, but scene.js's own geometry makes that
// impossible to satisfy literally for anything bigger than ~0.75m radius:
// the rim sits at BASKET_H=0.95 and the rope cone doesn't finish
// narrowing to the envelope neck until NECK_Y=2.45 — a 1.5m-radius (or
// even the validation harness's 1.1m) sphere is simply taller than that
// 1.5m gap. The contract explicitly allows deviation here, so this offset
// picks the LESS-bad tradeoff: clear the basket RIM (the solid, opaque,
// immediately-obvious obstruction — a toy sliced by a solid wicker edge
// reads as broken) by a visible margin, and accept that the widest giant
// toys' upper hemisphere may overlap the thin, mostly-open rope cone and
// the envelope's own lower curve — a few thin ropes crossing in front of
// a giant ball reads as "held up near the balloon", not as clipping. See
// report for the exact number and the geometric reasoning above.
const GONDOLA_PAW_Y_OFFSET = 2.2;

// ---------------------------------------------------------------------------
// Canvas face texture (baked once, shared by every Rabbit instance).
// Sphere UV: u=0.5,v=0.5 lands on local +X at the equator for a default
// THREE.SphereGeometry — exactly our "forward" direction — so the face can
// be painted dead-center on the canvas with no extra head rotation needed.
// ---------------------------------------------------------------------------
let _faceTexture = null;
function getFaceTexture() {
  if (_faceTexture) return _faceTexture;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');

  // Base fur color (warm soft white) everywhere.
  ctx.fillStyle = '#fdf6ee';
  ctx.fillRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.46; // slightly above the equator (toward the top pole)

  // Blush cheeks.
  ctx.fillStyle = 'rgba(255,150,170,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.19, cy + size * 0.09, size * 0.075, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.19, cy + size * 0.09, size * 0.075, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dot eyes (with a tiny white glint each, for life).
  ctx.fillStyle = '#2a2320';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.1, cy, size * 0.024, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.1, cy, size * 0.024, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(cx - size * 0.1 + 3, cy - 4, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.1 + 3, cy - 4, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Small "Y" nose+mouth: a pink triangle nose and a thin Y stitch below it.
  ctx.fillStyle = '#ff8fa8';
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.06);
  ctx.lineTo(cx - size * 0.018, cy + size * 0.045);
  ctx.lineTo(cx + size * 0.018, cy + size * 0.045);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,90,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.06);
  ctx.lineTo(cx, cy + size * 0.085);
  ctx.moveTo(cx, cy + size * 0.085);
  ctx.lineTo(cx - size * 0.028, cy + size * 0.11);
  ctx.moveTo(cx, cy + size * 0.085);
  ctx.lineTo(cx + size * 0.028, cy + size * 0.11);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _faceTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry builders (each called once per Rabbit instance / once globally
// for the shared limb/ear geometries below).
// ---------------------------------------------------------------------------
function buildBodyGeometry() {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(BODY_R_BOTTOM * 0.72, 0.018),
    new THREE.Vector2(BODY_R_BOTTOM, 0.05),
    new THREE.Vector2(BODY_R_BOTTOM * 0.96, BODY_H * 0.42),
    new THREE.Vector2(BODY_R_BOTTOM * 0.66, BODY_H * 0.74),
    new THREE.Vector2(BODY_R_TOP, BODY_H * 0.92),
    new THREE.Vector2(0, BODY_H),
  ];
  const geo = new THREE.LatheGeometry(pts, 16);
  return geo;
}

// A limb capsule that hangs DOWN from its pivot (local -Y) at rest — so a
// pivot rotation of 0 means "hanging straight down" (arms/legs at rest) and
// rotation.z == PI means "pointing straight up" (paws held overhead).
function buildHangingCapsule(radius, length) {
  const geo = new THREE.CapsuleGeometry(radius, length, 4, 8);
  geo.translate(0, -(length / 2 + radius), 0);
  return geo;
}

// Flattened "paddle" ear: a capsule standing UP from its pivot (local +Y),
// meant to be flattened along local X via a non-uniform instance scale so
// its broad face reads from the front (+X, our forward axis).
function buildEarCapsule(radius, length) {
  const geo = new THREE.CapsuleGeometry(radius, length, 3, 8);
  geo.translate(0, length / 2 + radius, 0);
  return geo;
}

// Open toy crate: a thin 5-face shell (bottom + 4 walls), DoubleSide so the
// interior reads from the diagonal game camera. Per-instance color via
// InstancedMesh.setColorAt (auto-detected by three.js, no vertexColors flag
// needed — see WebGLProgram's `instancingColor` parameter).
function buildCrateGeometry(w, h, d) {
  const hw = w / 2;
  const hd = d / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  function quad(p0, p1, p2, p3, n) {
    const pts = [p0, p1, p2, p0, p2, p3];
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1],
    ];
    for (let i = 0; i < 6; i++) {
      positions.push(pts[i][0], pts[i][1], pts[i][2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uv[i][0], uv[i][1]);
    }
  }
  quad([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [0, 1, 0]); // floor
  quad([-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [hw, 0, -hd], [0, 0, -1]); // front wall
  quad([hw, 0, hd], [hw, h, hd], [-hw, h, hd], [-hw, 0, hd], [0, 0, 1]); // back wall
  quad([-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-hw, 0, -hd], [-1, 0, 0]); // left wall
  quad([hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [hw, 0, hd], [1, 0, 0]); // right wall

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

// ---------------------------------------------------------------------------
// Rabbit
// ---------------------------------------------------------------------------
export class Rabbit {
  constructor(scene, sceneEnv) {
    this.scene = scene;
    this.sceneEnv = sceneEnv;

    // ---- platform lookup (tip position per id), from the live SceneEnv ----
    this._tips = new Map(); // id -> THREE.Vector3
    const platforms = (sceneEnv && sceneEnv.platforms) || [];
    for (const p of platforms) {
      this._tips.set(p.id, p.tip.clone());
    }
    // Fallback if sceneEnv didn't provide platforms for some reason.
    if (this._tips.size === 0) {
      this._tips.set('low', new THREE.Vector3(-3.4, 2.2, 0));
      this._tips.set('mid', new THREE.Vector3(-3.4, 4.4, 0));
      this._tips.set('high', new THREE.Vector3(-3.4, 7.2, 0));
    }

    // ---- public contract fields ----
    this.currentPlatformId = 'mid';
    this.state = 'idle';
    this.pawAnchor = new THREE.Object3D();

    // ---- internal animation state ----
    this._action = null; // {type, t, dur, ...} while climb/fetch/stow/windup/cheer runs
    this._holdingToy = false;
    // Mega splash tier: true from the moment boardGondola's hop lands until
    // exitGondola's hop begins — while true, update() locks root.position
    // onto balloon.gondolaAnchor every frame (contract) instead of running
    // the ground idle pose.
    this._riding = false;
    // True while holding the giant toy (between fetchGiantToy's onTakeOut
    // and heaveThrow's onRelease) — drives the "still straining a little"
    // hold pose and the gondola pawAnchor height.
    this._holdingGiant = false;
    this._breathT = Math.random() * 10;
    this._twitchTimer = 1.5 + Math.random() * 2.5;
    this._twitchSide = 0; // spring impulse applied to one ear
    this._twitchAmt = { v: 0, vel: 0 };

    // aim lean state (current damped values + last requested target)
    this._aimTargetX = 0;
    this._aimTargetZ = 0;
    this._aimStrength = 0;
    this._aimYaw = { v: 0, vel: 0 };
    this._aimTiltF = { v: 0, vel: 0 }; // forward/back tilt
    this._aimTiltS = { v: 0, vel: 0 }; // side tilt

    // watchPoint state
    this._watchTarget = null;
    this._headYaw = { v: 0, vel: 0 };
    this._headPitch = { v: 0, vel: 0 };

    // ear springs: {fb: forward/back tilt (rotation.z), side: lateral (rotation.x)}
    this._earL = { fb: { v: 0, vel: 0 }, side: { v: 0, vel: 0 } };
    this._earR = { fb: { v: 0, vel: 0 }, side: { v: 0, vel: 0 } };
    this._earDriveFB = 0; // shared forward/back drive signal (body lean/bounce)
    this._earDriveSideL = 0;
    this._earDriveSideR = 0;

    // pose values applied every frame to pivots (updated by whichever
    // system currently owns them: idle/aim/windup/etc).
    this._bodySquashY = 1;
    this._bodySquashXZ = 1;
    this._legAngle = { l: 0, r: 0 };
    this._armAngle = { l: 0, r: 0 };

    // scratch objects (no per-frame allocation)
    this._pawTargetScratch = new THREE.Vector3();
    this._pawLocalScratch = new THREE.Vector3();
    this._instMtx = new THREE.Matrix4();
    this._instDummy = new THREE.Object3D();
    this._lookScratch = new THREE.Vector3();

    this._buildRig();
    this._buildCrates(platforms.length ? platforms : Array.from(this._tips, ([id, tip]) => ({ id, tip })));

    // Start standing at the 'mid' tip, facing +X (toward the pool).
    this._snapToPlatform(this.currentPlatformId);
  }

  // -----------------------------------------------------------------------
  // Rig construction
  // -----------------------------------------------------------------------
  _buildRig() {
    const furMat = new THREE.MeshStandardMaterial({ color: 0xfdf6ee, roughness: 0.6, metalness: 0.02 });
    const innerEarMat = new THREE.MeshStandardMaterial({ color: 0xffb3c6, roughness: 0.7, metalness: 0 });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: getFaceTexture(),
      roughness: 0.55,
      metalness: 0.02,
    });

    const root = new THREE.Group();
    root.name = 'rabbitRoot';
    this.scene.add(root);
    this.root = root;

    // -- legs (hip pivots, direct children of root; feet touch y=0) --
    const legPivotL = new THREE.Object3D();
    legPivotL.position.set(0, LEG_LEN, -0.055);
    const legPivotR = new THREE.Object3D();
    legPivotR.position.set(0, LEG_LEN, 0.055);
    root.add(legPivotL, legPivotR);
    this._legPivots = [legPivotL, legPivotR];

    // -- body pivot (squash/lean/bob) --
    const bodyPivot = new THREE.Object3D();
    bodyPivot.position.set(0, LEG_LEN, 0);
    root.add(bodyPivot);
    this._bodyPivot = bodyPivot;

    const bodyMesh = new THREE.Mesh(buildBodyGeometry(), furMat);
    bodyMesh.castShadow = true;
    bodyPivot.add(bodyMesh);

    const tailMesh = new THREE.Mesh(new THREE.SphereGeometry(TAIL_R, 12, 10), furMat);
    tailMesh.position.set(-BODY_R_BOTTOM * 0.85, BODY_H * 0.18, 0);
    bodyPivot.add(tailMesh);

    // -- arm pivots (children of bodyPivot, hang down at rest) --
    const armPivotL = new THREE.Object3D();
    armPivotL.position.set(0.01, BODY_H * 0.7, -(BODY_R_TOP + 0.05));
    const armPivotR = new THREE.Object3D();
    armPivotR.position.set(0.01, BODY_H * 0.7, BODY_R_TOP + 0.05);
    bodyPivot.add(armPivotL, armPivotR);
    this._armPivots = [armPivotL, armPivotR];

    // -- head pivot (look yaw/pitch), sits atop the body --
    const headPivot = new THREE.Object3D();
    headPivot.position.set(0, BODY_H, 0);
    bodyPivot.add(headPivot);
    this._headPivot = headPivot;

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 22, 16), headMat);
    headMesh.position.set(0, HEAD_R * 0.95, 0);
    headMesh.castShadow = true;
    headPivot.add(headMesh);

    // -- ear pivots (children of headPivot, near the top of the head) --
    const earBaseY = HEAD_R * 1.75;
    const earPivotL = new THREE.Object3D();
    earPivotL.position.set(HEAD_R * 0.18, earBaseY, -HEAD_R * 0.42);
    earPivotL.rotation.x = -0.16; // static outward splay
    const earPivotR = new THREE.Object3D();
    earPivotR.position.set(HEAD_R * 0.18, earBaseY, HEAD_R * 0.42);
    earPivotR.rotation.x = 0.16;
    headPivot.add(earPivotL, earPivotR);
    this._earPivots = [earPivotL, earPivotR];

    // -- instanced repeated parts: legs, arms, ears (outer+inner) --
    // NOTE: frustumCulled = false on every instanced part below. three.js
    // lazily computes InstancedMesh.boundingSphere ONCE (on first frustum
    // test) and then caches it forever — it is never recomputed as
    // setMatrixAt moves instances around later. Since these instances
    // follow the animated leg/arm/ear pivots every frame (the rabbit walks
    // the length of a board and climbs several meters), that stale sphere
    // very quickly stops covering their real position and three.js starts
    // silently culling the whole mesh the moment the camera no longer
    // intersects the long-stale sphere. These are a handful of tiny
    // capsules, so disabling culling is free.
    const legGeo = buildHangingCapsule(LEG_R, LEG_LEN * 0.55);
    this._legMesh = new THREE.InstancedMesh(legGeo, furMat, 2);
    this._legMesh.castShadow = true;
    this._legMesh.frustumCulled = false;
    this.scene.add(this._legMesh);

    const armGeo = buildHangingCapsule(ARM_R, ARM_LEN * 0.6);
    this._armMesh = new THREE.InstancedMesh(armGeo, furMat, 2);
    this._armMesh.castShadow = true;
    this._armMesh.frustumCulled = false;
    this.scene.add(this._armMesh);

    const earOuterGeo = buildEarCapsule(EAR_R, EAR_LEN * 0.72);
    this._earOuterMesh = new THREE.InstancedMesh(earOuterGeo, furMat, 2);
    this._earOuterMesh.castShadow = true;
    this._earOuterMesh.frustumCulled = false;
    this.scene.add(this._earOuterMesh);

    const earInnerGeo = buildEarCapsule(EAR_R * 0.55, EAR_LEN * 0.6);
    this._earInnerMesh = new THREE.InstancedMesh(earInnerGeo, innerEarMat, 2);
    this._earInnerMesh.frustumCulled = false;
    this.scene.add(this._earInnerMesh);
  }

  // Toy crates + peeking balls: static props, one crate per platform, built
  // once (matrices never change after construction).
  _buildCrates(platforms) {
    const crateColors = [0xff7a8a, 0xffe066, 0x5fd8e6, 0xb28aff, 0x8ce27a];
    const CW = 0.34;
    const CH = 0.16;
    const CD = 0.26;
    const crateGeo = buildCrateGeometry(CW, CH, CD);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const n = Math.max(1, platforms.length);
    const crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, n);
    crateMesh.castShadow = true;
    crateMesh.receiveShadow = true;

    const ballColors = [0xff5b5b, 0xffd23f, 0x4fb0ff, 0x66d97a, 0xff8fc7];
    const ballsPerCrate = 3;
    const ballGeo = new THREE.SphereGeometry(0.045, 8, 6);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, n * ballsPerCrate);

    const dummy = this._instDummy;
    const color = new THREE.Color();
    let ballIdx = 0;
    this._crateOffset = { x: -1.4, z: 0.5 }; // relative to a platform's tip; "near the ladder end"

    platforms.forEach((p, i) => {
      const tip = this._tips.get(p.id) || p.tip;
      const cx = tip.x + this._crateOffset.x;
      const cy = tip.y + FOOT_Y_OFFSET;
      const cz = tip.z + this._crateOffset.z;

      dummy.position.set(cx, cy, cz);
      dummy.rotation.set(0, 0.15, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      crateMesh.setMatrixAt(i, dummy.matrix);
      crateMesh.setColorAt(i, color.set(crateColors[i % crateColors.length]));

      // A few colored balls peeking above the rim, scattered inside the
      // crate footprint.
      const spots = [
        [-0.07, 0.02],
        [0.05, -0.05],
        [0.06, 0.06],
      ];
      for (let b = 0; b < ballsPerCrate; b++) {
        const [ox, oz] = spots[b % spots.length];
        dummy.position.set(cx + ox, cy + CH * 0.8, cz + oz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.85 + 0.3 * ((b * 37 + i * 13) % 5) / 5);
        dummy.updateMatrix();
        ballMesh.setMatrixAt(ballIdx, dummy.matrix);
        ballMesh.setColorAt(ballIdx, color.set(ballColors[(b + i * 2) % ballColors.length]));
        ballIdx++;
      }
    });
    crateMesh.instanceMatrix.needsUpdate = true;
    if (crateMesh.instanceColor) crateMesh.instanceColor.needsUpdate = true;
    ballMesh.instanceMatrix.needsUpdate = true;
    if (ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;

    this.scene.add(crateMesh);
    this.scene.add(ballMesh);
    this._crateMesh = crateMesh;
    this._ballMesh = ballMesh;
  }

  // -----------------------------------------------------------------------
  // Placement helpers
  // -----------------------------------------------------------------------
  _tipOf(platformId) {
    return this._tips.get(platformId) || this._tips.get('mid');
  }

  _standX(tip) {
    return tip.x - STAND_BACK_FROM_TIP;
  }

  _snapToPlatform(platformId) {
    const tip = this._tipOf(platformId);
    this.root.position.set(this._standX(tip), tip.y + FOOT_Y_OFFSET, tip.z);
    this.root.rotation.set(0, 0, 0);
    this.currentPlatformId = platformId;
  }

  // -----------------------------------------------------------------------
  // Public API — climbTo
  // -----------------------------------------------------------------------
  climbTo(platformId, onDone) {
    const fromTip = this._tipOf(this.currentPlatformId).clone();
    const toTip = this._tipOf(platformId).clone();
    if (platformId === this.currentPlatformId) {
      // Nothing to do — still honor the async contract.
      this._action = null;
      this.state = 'idle';
      if (onDone) onDone();
      return;
    }
    const dyAbs = Math.abs(toTip.y - fromTip.y);
    let climbDur = clamp(0.12 + dyAbs * 0.12, 0.3, 0.9);
    let walkDur = 0.27;
    let total = walkDur * 2 + climbDur;
    // Keep within the contract's 0.8-1.6s scaled window even for degenerate
    // inputs (proportional rescale, phase ratios preserved).
    if (total < 0.8) {
      const s = 0.8 / total;
      climbDur *= s;
      walkDur *= s;
      total = 0.8;
    } else if (total > 1.6) {
      const s = 1.6 / total;
      climbDur *= s;
      walkDur *= s;
      total = 1.6;
    }

    const ladderX = fromTip.x + LADDER_DX;
    this.state = 'climb';
    this._holdingToy = false; // contract: stow before climbing
    this._action = {
      type: 'climb',
      t: 0,
      dur: total,
      walkDur,
      climbDur,
      fromTip,
      toTip,
      ladderX,
      climbSign: toTip.y >= fromTip.y ? 1 : -1,
      targetPlatformId: platformId,
      onDone: onDone || null,
    };
  }

  _stepClimb(dt) {
    const a = this._action;
    a.t += dt;
    const t = Math.min(a.t, a.dur);
    const walkEnd = a.walkDur;
    const climbEnd = a.walkDur + a.climbDur;

    let x, y, z, facingY;
    const waddleFreq = 9.5;
    let waddlePhase = 0;
    let legAmt = 0;
    let armAmt = 0;

    if (t <= walkEnd) {
      // Phase A: walk from old tip to the ladder side.
      const p = walkEnd > 0 ? clamp01(t / walkEnd) : 1;
      const e = smoothstep(p);
      x = lerp(this._standX(a.fromTip), a.ladderX, e);
      y = a.fromTip.y + FOOT_Y_OFFSET;
      z = a.fromTip.z;
      facingY = Math.PI; // walking toward -X
      waddlePhase = t * waddleFreq * Math.PI * 2;
      legAmt = 1;
      armAmt = 0.35;
    } else if (t <= climbEnd) {
      // Phase B: climb the ladder (paw-over-paw), same X, Y ramps.
      const dur = a.climbDur || 1e-6;
      const p = clamp01((t - walkEnd) / dur);
      const e = easeInOutCubic(p);
      x = a.ladderX;
      y = lerp(a.fromTip.y + FOOT_Y_OFFSET, a.toTip.y + FOOT_Y_OFFSET, e);
      z = a.fromTip.z;
      facingY = Math.PI / 2; // face the rungs (sideways to the walk direction)
      waddlePhase = t * waddleFreq * 1.15 * Math.PI * 2;
      legAmt = 0.8;
      armAmt = 1; // full paw-over-paw reach
    } else {
      // Phase C: walk out from the ladder to the new tip.
      const dur = a.dur - climbEnd || 1e-6;
      const p = clamp01((t - climbEnd) / dur);
      const e = smoothstep(p);
      x = lerp(a.ladderX, this._standX(a.toTip), e);
      y = a.toTip.y + FOOT_Y_OFFSET;
      z = a.toTip.z;
      facingY = 0; // walking toward +X, back to idle facing
      waddlePhase = t * waddleFreq * Math.PI * 2;
      legAmt = 1;
      armAmt = 0.35;
    }

    this.root.position.set(x, y, z);
    // Smoothly turn to face the direction of travel (short, monotonic hops
    // between 0 / PI/2 / PI — never wraps the long way around).
    this.root.rotation.y = damp(this.root.rotation.y, facingY, 0.08, dt);

    // Waddle bounce + body rock.
    const bounce = Math.abs(Math.sin(waddlePhase)) * 0.018 * legAmt;
    this._bodyPivot.position.y = LEG_LEN + bounce;
    this._bodyPivot.rotation.z = Math.sin(waddlePhase) * 0.12 * legAmt;
    this._bodyPivot.rotation.x = Math.sin(waddlePhase * 0.5) * 0.05;

    // Alternating legs.
    this._legAngle.l = Math.sin(waddlePhase) * 0.55 * legAmt;
    this._legAngle.r = Math.sin(waddlePhase + Math.PI) * 0.55 * legAmt;

    // Arms: brisk paw-over-paw reach while climbing, gentle swing while
    // walking the boards.
    if (t > walkEnd && t <= climbEnd) {
      const reachL = 2.0 + Math.sin(waddlePhase) * 0.9;
      const reachR = 2.0 + Math.sin(waddlePhase + Math.PI) * 0.9;
      this._armAngle.l = reachL;
      this._armAngle.r = reachR;
      // Look up while ascending, down while descending.
      this._headPitch.v = damp(this._headPitch.v, a.climbSign > 0 ? -0.45 : 0.35, 0.15, dt);
    } else {
      this._armAngle.l = Math.sin(waddlePhase + Math.PI) * 0.5 * armAmt;
      this._armAngle.r = Math.sin(waddlePhase) * 0.5 * armAmt;
      this._headPitch.v = damp(this._headPitch.v, 0, 0.2, dt);
    }

    // Feed the ear spring driver from body rock/bounce for lag+overshoot.
    this._earDriveFB = this._bodyPivot.rotation.x * 1.6 + (facingY === Math.PI ? 0.25 : facingY === 0 ? -0.25 : 0);
    this._earDriveSideL = this._bodyPivot.rotation.z * 1.2;
    this._earDriveSideR = -this._bodyPivot.rotation.z * 1.2;

    if (a.t >= a.dur) {
      this.currentPlatformId = a.targetPlatformId;
      this._snapToPlatform(a.targetPlatformId);
      this._bodyPivot.position.y = LEG_LEN;
      this._bodyPivot.rotation.set(0, 0, 0);
      this._legAngle.l = this._legAngle.r = 0;
      this._armAngle.l = this._armAngle.r = 0;
      this._action = null;
      this.state = 'idle';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // -----------------------------------------------------------------------
  // Public API — fetchToy / stowToy
  //
  // Design note: the toy crate for the CURRENT platform sits further back
  // along the board (near the ladder end, per the contract), while the
  // rabbit stands out at the tip. fetchToy/stowToy are deliberately a
  // stylized turn-and-lean gesture in place (rotate partway toward the
  // crate's side, lean/reach, straighten back up) rather than a full extra
  // walk cycle over to the box and back — the contract's own description
  // of this method ("turn to the crate, lean in ... straighten up") only
  // asks for a lean/reach, and GameFlow already owns exactly when a toy
  // mesh appears/disappears via onTakeOut/onStowed, so nothing depends on
  // the rabbit's feet literally reaching the crate's world position.
  // -----------------------------------------------------------------------
  fetchToy(onTakeOut, onDone) {
    this.state = 'fetch';
    this._action = {
      type: 'fetch',
      t: 0,
      dur: 0.7,
      takeOutAt: 0.28,
      takenOut: false,
      onTakeOut: onTakeOut || null,
      onDone: onDone || null,
    };
  }

  _stepFetch(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const leanEnd = 0.28;
    const riseEnd = 0.55;

    if (t <= leanEnd) {
      const p = easeInCubic(clamp01(t / leanEnd));
      this.root.rotation.y = lerp(0, -0.85, p);
      this._bodyPivot.rotation.z = lerp(0, -0.5, p); // lean forward/down toward crate
      this._bodyPivot.position.y = LEG_LEN - 0.02 * p;
      this._armAngle.l = lerp(0, -0.9, p);
      this._armAngle.r = lerp(0, -0.9, p);
      this._earDriveFB = -1.1 * p; // ears flop forward
    } else if (t <= riseEnd) {
      const p = easeOutBack(clamp01((t - leanEnd) / (riseEnd - leanEnd)));
      this.root.rotation.y = lerp(-0.85, 0, clamp01(p));
      this._bodyPivot.rotation.z = lerp(-0.5, 0, clamp01(p));
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.02, LEG_LEN + 0.01, clamp01(p));
      this._armAngle.l = lerp(-0.9, Math.PI, clamp01(p));
      this._armAngle.r = lerp(-0.9, Math.PI, clamp01(p));
      this._earDriveFB = lerp(-1.1, 0.4, clamp01(p));
    } else {
      const p = clamp01((t - riseEnd) / (a.dur - riseEnd));
      this._bodyPivot.position.y = lerp(LEG_LEN + 0.01, LEG_LEN, p);
      this._armAngle.l = lerp(Math.PI + 0.15, Math.PI, p);
      this._armAngle.r = lerp(Math.PI + 0.15, Math.PI, p);
      this._earDriveFB = lerp(0.4, 0, p);
      this._holdingToy = true;
    }

    if (!a.takenOut && t >= a.takeOutAt) {
      a.takenOut = true;
      if (a.onTakeOut) a.onTakeOut();
    }

    if (t >= a.dur) {
      this.root.rotation.y = 0;
      this._bodyPivot.rotation.z = 0;
      this._bodyPivot.position.y = LEG_LEN;
      this._armAngle.l = this._armAngle.r = Math.PI;
      this._holdingToy = true;
      this._action = null;
      this.state = 'idle';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  stowToy(onStowed) {
    this.state = 'fetch'; // no dedicated 'stow' state in the contract enum
    this._action = {
      type: 'stow',
      t: 0,
      dur: 0.55,
      stowAt: 0.3,
      stowed: false,
      onStowed: onStowed || null,
    };
  }

  _stepStow(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const downEnd = 0.3;

    if (t <= downEnd) {
      const p = easeInCubic(clamp01(t / downEnd));
      this.root.rotation.y = lerp(0, -0.85, p);
      this._bodyPivot.rotation.z = lerp(0, -0.5, p);
      this._bodyPivot.position.y = lerp(LEG_LEN, LEG_LEN - 0.02, p);
      this._armAngle.l = lerp(Math.PI, -0.9, p);
      this._armAngle.r = lerp(Math.PI, -0.9, p);
      this._earDriveFB = lerp(0, -1.1, p);
    } else {
      const p = clamp01((t - downEnd) / (a.dur - downEnd));
      const e = smoothstep(p);
      this.root.rotation.y = lerp(-0.85, 0, e);
      this._bodyPivot.rotation.z = lerp(-0.5, 0, e);
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.02, LEG_LEN, e);
      this._armAngle.l = lerp(-0.9, 0, e);
      this._armAngle.r = lerp(-0.9, 0, e);
      this._earDriveFB = lerp(-1.1, 0, e);
    }

    if (!a.stowed && t >= a.stowAt) {
      a.stowed = true;
      this._holdingToy = false;
      if (a.onStowed) a.onStowed();
    }

    if (t >= a.dur) {
      this.root.rotation.y = 0;
      this._bodyPivot.rotation.z = 0;
      this._bodyPivot.position.y = LEG_LEN;
      this._armAngle.l = this._armAngle.r = 0;
      this._action = null;
      this.state = 'idle';
    }
  }

  // -----------------------------------------------------------------------
  // Public API — aimLean / watchPoint
  // -----------------------------------------------------------------------
  aimLean(dirX, dirZ, strength01) {
    this._aimTargetX = dirX || 0;
    this._aimTargetZ = dirZ || 0;
    this._aimStrength = clamp01(strength01 || 0);
  }

  _updateAim(dt) {
    const len = Math.hypot(this._aimTargetX, this._aimTargetZ);
    const nx = len > 1e-4 ? this._aimTargetX / len : 0;
    const nz = len > 1e-4 ? this._aimTargetZ / len : 0;
    const s = this._aimStrength;

    const targetYaw = clamp(Math.atan2(nz, nx) * 0.4, -MAX_LEAN, MAX_LEAN) * s;
    const targetTiltF = clamp(nx * MAX_LEAN * 0.85, -MAX_LEAN, MAX_LEAN) * s;
    const targetTiltS = clamp(nz * MAX_LEAN * 0.85, -MAX_LEAN, MAX_LEAN) * s;

    springStep(this._aimYaw, targetYaw, 90, 13, dt);
    springStep(this._aimTiltF, targetTiltF, 90, 13, dt);
    springStep(this._aimTiltS, targetTiltS, 90, 13, dt);

    // Only claim the 'aim' state if no bigger action owns the body right
    // now, and only while there's a meaningful lean; otherwise fall back
    // to idle so climb/fetch/windup/cheer aren't clobbered.
    if (!this._action) {
      this.state = Math.abs(this._aimYaw.v) + Math.abs(this._aimTiltF.v) + Math.abs(this._aimTiltS.v) > 0.01
        ? 'aim'
        : 'idle';
    }
  }

  watchPoint(point) {
    if (point) {
      // Store a plain copy so callers can safely mutate/discard their vector.
      if (!this._watchStore) this._watchStore = new THREE.Vector3();
      this._watchStore.copy(point);
      this._watchTarget = this._watchStore;
    } else {
      this._watchTarget = null;
    }
  }

  _updateWatch(dt) {
    let targetYaw = 0;
    let targetPitch = 0;
    if (this._watchTarget) {
      // Direction from the head (world) to the target, expressed relative
      // to the root's current facing.
      this._headPivot.getWorldPosition(this._pawTargetScratch);
      const dx = this._watchTarget.x - this._pawTargetScratch.x;
      const dy = this._watchTarget.y - this._pawTargetScratch.y;
      const dz = this._watchTarget.z - this._pawTargetScratch.z;
      const worldYaw = Math.atan2(dz, dx);
      const rootYaw = this.root.rotation.y;
      let relYaw = worldYaw - rootYaw;
      // Wrap into [-PI, PI].
      relYaw = Math.atan2(Math.sin(relYaw), Math.cos(relYaw));
      const horiz = Math.hypot(dx, dz);
      targetYaw = clamp(relYaw, -0.9, 0.9);
      targetPitch = clamp(-Math.atan2(dy, Math.max(horiz, 0.001)), -0.7, 0.7);
    }
    // windupAndThrow drives its own head look during release; don't fight it.
    if (this._action && this._action.type === 'windup') return;
    this._headYaw.v = damp(this._headYaw.v, targetYaw, 0.1, dt);
    this._headPitch.v = damp(this._headPitch.v, targetPitch, 0.12, dt);
    this._earDriveSideL += targetYaw * 0.15;
    this._earDriveSideR += targetYaw * 0.15;
  }

  // -----------------------------------------------------------------------
  // Public API — windupAndThrow
  // -----------------------------------------------------------------------
  windupAndThrow(onRelease, onDone) {
    this.state = 'windup';
    this._action = {
      type: 'windup',
      t: 0,
      dur: 0.6,
      windupEnd: 0.2,
      releaseAt: 0.35,
      released: false,
      onRelease: onRelease || null,
      onDone: onDone || null,
    };
  }

  _stepWindup(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const windupEnd = a.windupEnd;
    const releaseAt = a.releaseAt;

    if (t <= windupEnd) {
      // Crouch + squash, arms swing back past overhead (cocking).
      const p = easeInCubic(clamp01(t / windupEnd));
      this._bodySquashY = lerp(1, 0.82, p);
      this._bodySquashXZ = lerp(1, 1.12, p);
      this._bodyPivot.position.y = lerp(LEG_LEN, LEG_LEN - 0.035, p);
      this._armAngle.l = this._armAngle.r = lerp(Math.PI, Math.PI + 0.55, p);
      this._legAngle.l = this._legAngle.r = lerp(0, -0.3, p);
      this._headPitch.v = lerp(0, -0.2, p);
      this._earDriveFB = -0.5 * p;
    } else if (t <= releaseAt) {
      // Explosive extend toward release.
      const p = clamp01((t - windupEnd) / (releaseAt - windupEnd));
      const e = easeOutCubic(p);
      this._bodySquashY = lerp(0.82, 1.18, e);
      this._bodySquashXZ = lerp(1.12, 0.9, e);
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.035, LEG_LEN + 0.04, e);
      this._armAngle.l = this._armAngle.r = lerp(Math.PI + 0.55, 0.25, e);
      this._legAngle.l = this._legAngle.r = lerp(-0.3, 0.5, e);
      this._headPitch.v = lerp(-0.2, 0.15, e);
      this._earDriveFB = lerp(-0.5, 1.4, e);
    } else {
      // Follow-through + settle wobble.
      const p = clamp01((t - releaseAt) / (a.dur - releaseAt));
      const settle = easeOutCubic(p);
      this._bodySquashY = lerp(1.18, 1, settle);
      this._bodySquashXZ = lerp(0.9, 1, settle);
      this._bodyPivot.position.y = lerp(LEG_LEN + 0.04, LEG_LEN, settle);
      const wobble = Math.sin(p * Math.PI * 2.4) * 0.35 * (1 - p);
      this._armAngle.l = this._armAngle.r = lerp(0.25, 0.7, settle) + wobble;
      this._legAngle.l = this._legAngle.r = lerp(0.5, 0, settle);
      this._headPitch.v = lerp(0.15, 0, settle);
      this._earDriveFB = lerp(1.4, 0, settle) + wobble * 1.2;
    }

    if (!a.released && t >= releaseAt) {
      a.released = true;
      this._holdingToy = false;
      if (a.onRelease) a.onRelease();
    }

    if (t >= a.dur) {
      this._bodySquashY = this._bodySquashXZ = 1;
      this._bodyPivot.position.y = LEG_LEN;
      this._armAngle.l = this._armAngle.r = 0.7;
      this._legAngle.l = this._legAngle.r = 0;
      this._action = null;
      this.state = 'idle';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // -----------------------------------------------------------------------
  // Mega splash tier — gondola riding + giant-toy heave
  // -----------------------------------------------------------------------
  _gondolaAnchor() {
    const b = this.sceneEnv && this.sceneEnv.balloon;
    return (b && b.gondolaAnchor) || null;
  }

  // Hop from wherever the rabbit currently stands (the tower-top area, per
  // gameflow's own sequencing) into the gondola basket. Once the hop lands,
  // `_riding` goes true and every subsequent update() locks root.position
  // onto balloon.gondolaAnchor (contract) until exitGondola.
  boardGondola(onDone) {
    const from = this.root.position.clone();
    this.state = 'board';
    this._riding = false; // only becomes true once the hop actually lands
    this._action = {
      type: 'board',
      t: 0,
      dur: GONDOLA_HOP_DUR,
      from,
      onDone: onDone || null,
    };
  }

  _stepBoard(dt) {
    const a = this._action;
    a.t += dt;
    const t = Math.min(a.t, a.dur);
    const p = clamp01(t / a.dur);
    const e = easeInOutCubic(p);

    const anchor = this._gondolaAnchor();
    if (anchor) anchor.getWorldPosition(this._pawTargetScratch);
    else this._pawTargetScratch.copy(a.from);
    const target = this._pawTargetScratch;

    const x = lerp(a.from.x, target.x, e);
    const y = lerp(a.from.y, target.y, e) + Math.sin(p * Math.PI) * 0.4; // hop arc
    const z = lerp(a.from.z, target.z, e);
    this.root.position.set(x, y, z);
    this.root.rotation.y = damp(this.root.rotation.y, 0, 0.12, dt);

    const legKick = Math.sin(p * Math.PI) * 0.6;
    this._legAngle.l = this._legAngle.r = -legKick;
    this._armAngle.l = this._armAngle.r = lerp(this._armAngle.l, 0.4 + legKick * 0.3, 0.5);
    this._bodyPivot.rotation.x = -legKick * 0.15;
    this._earDriveFB = legKick * 0.8;

    if (a.t >= a.dur) {
      this.root.position.copy(target);
      this._riding = true;
      this._legAngle.l = this._legAngle.r = 0;
      this._bodyPivot.rotation.x = 0;
      this._action = null;
      this.state = 'ride';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // Hop back out of the gondola to the top platform (contract: "the top
  // platform" — the tower's highest board, where sky access begins).
  exitGondola(onDone) {
    const from = this.root.position.clone();
    const tip = this._tipOf(this.currentPlatformId);
    const target = new THREE.Vector3(this._standX(tip), tip.y + FOOT_Y_OFFSET, tip.z);
    this.state = 'exit';
    this._riding = false;
    this._action = {
      type: 'exit',
      t: 0,
      dur: EXIT_HOP_DUR,
      from,
      target,
      onDone: onDone || null,
    };
  }

  _stepExit(dt) {
    const a = this._action;
    a.t += dt;
    const p = clamp01(a.t / a.dur);
    const e = easeInOutCubic(p);
    const x = lerp(a.from.x, a.target.x, e);
    const y = lerp(a.from.y, a.target.y, e) + Math.sin(p * Math.PI) * 0.35;
    const z = lerp(a.from.z, a.target.z, e);
    this.root.position.set(x, y, z);
    this.root.rotation.y = damp(this.root.rotation.y, 0, 0.12, dt);

    const legKick = Math.sin(p * Math.PI) * 0.6;
    this._legAngle.l = this._legAngle.r = -legKick;
    this._bodyPivot.rotation.x = -legKick * 0.12;
    this._earDriveFB = legKick * 0.7;

    if (a.t >= a.dur) {
      this._snapToPlatform(this.currentPlatformId);
      this._legAngle.l = this._legAngle.r = 0;
      this._bodyPivot.rotation.x = 0;
      this._action = null;
      this.state = 'idle';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // Two-arm heave from the giant crate: reach down (knees bend), a brief
  // stagger under the (about to be revealed) weight, then a SLOW heavy
  // extend upward, settling into a "still straining a little" hold pose.
  // onTakeOut fires at the lift moment (contract), roughly mid-animation.
  fetchGiantToy(onTakeOut, onDone) {
    this.state = 'fetchGiant';
    const dur = FETCH_GIANT_DUR;
    this._action = {
      type: 'fetchGiant',
      t: 0,
      dur,
      reachEnd: dur * 0.32,
      liftAt: dur * 0.5,
      riseEnd: dur * 0.78,
      liftedOut: false,
      onTakeOut: onTakeOut || null,
      onDone: onDone || null,
    };
  }

  _stepFetchGiant(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const { reachEnd, liftAt, riseEnd } = a;

    if (t <= reachEnd) {
      // Reach down toward the crate; knees bend, arms extend low.
      const p = easeInCubic(clamp01(t / reachEnd));
      this._bodyPivot.rotation.z = lerp(0, -0.55, p);
      this._bodyPivot.position.y = lerp(LEG_LEN, LEG_LEN - 0.05, p);
      this._legAngle.l = this._legAngle.r = lerp(0, -0.5, p);
      this._armAngle.l = this._armAngle.r = lerp(this._holdingToy ? Math.PI : 0, -0.75, p);
      this._earDriveFB = -1.0 * p;
      this._bodySquashY = lerp(1, 0.88, p);
      this._bodySquashXZ = lerp(1, 1.1, p);
    } else if (t <= liftAt) {
      // Grip the crate; a brief stagger-in-place under the hidden weight.
      const span = Math.max(liftAt - reachEnd, 1e-6);
      const p = clamp01((t - reachEnd) / span);
      const wobble = Math.sin(p * Math.PI * 3) * 0.08 * (1 - p);
      this._bodyPivot.rotation.x = wobble;
      this._bodyPivot.rotation.z = -0.55 + wobble * 0.3;
    } else if (t <= riseEnd) {
      // Slow, heavy heave upward — knees straighten with visible effort,
      // a big side-to-side stagger selling the comic weight.
      const span = Math.max(riseEnd - liftAt, 1e-6);
      const p = easeInOutCubic(clamp01((t - liftAt) / span));
      this._bodyPivot.rotation.z = lerp(-0.55, 0.08, p);
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.05, LEG_LEN + 0.02, p);
      const stagger = Math.sin(t * 9) * 0.14 * (1 - p);
      this._legAngle.l = lerp(-0.5, 0.15, p) + stagger;
      this._legAngle.r = lerp(-0.5, 0.15, p) - stagger;
      this._armAngle.l = this._armAngle.r = lerp(-0.75, Math.PI, p);
      this._bodySquashY = lerp(0.88, 1.06, p);
      this._bodySquashXZ = lerp(1.1, 0.96, p);
      this._bodyPivot.rotation.x = Math.sin(t * 7) * 0.1 * (1 - p);
      this._earDriveFB = lerp(-1.0, 1.1, p);
    } else {
      // Settle into the "holding it up, straining a little" pose.
      const span = Math.max(a.dur - riseEnd, 1e-6);
      const p = clamp01((t - riseEnd) / span);
      const e = easeOutCubic(p);
      this._bodyPivot.rotation.z = lerp(0.08, 0.02, e);
      this._bodyPivot.rotation.x = lerp(this._bodyPivot.rotation.x, 0, e);
      this._bodyPivot.position.y = lerp(LEG_LEN + 0.02, LEG_LEN - 0.01, e); // knees stay bent — it's heavy
      this._legAngle.l = lerp(this._legAngle.l, 0.12, e);
      this._legAngle.r = lerp(this._legAngle.r, 0.12, e);
      this._armAngle.l = this._armAngle.r = Math.PI;
      this._bodySquashY = lerp(this._bodySquashY, 1.03, e);
      this._bodySquashXZ = lerp(this._bodySquashXZ, 0.98, e);
      this._earDriveFB = lerp(this._earDriveFB, 0.3, e);
    }

    if (!a.liftedOut && t >= liftAt) {
      a.liftedOut = true;
      this._holdingGiant = true;
      this._holdingToy = true;
      if (a.onTakeOut) a.onTakeOut();
    }

    if (t >= a.dur) {
      this._bodyPivot.rotation.set(0, this._bodyPivot.rotation.y, 0);
      this._bodyPivot.position.y = LEG_LEN - 0.01;
      this._legAngle.l = this._legAngle.r = 0.12;
      this._armAngle.l = this._armAngle.r = Math.PI;
      this._bodySquashY = 1.03;
      this._bodySquashXZ = 0.98;
      this._action = null;
      this.state = 'ride';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // Slow whole-body push (~0.8s per contract) with a big anticipation
  // squash-crouch, then a heavy explosive extend; onRelease fires at full
  // extension (the release pose moment — gameflow calls physics.release
  // then, same convention as windupAndThrow).
  heaveThrow(onRelease, onDone) {
    this.state = 'heave';
    const dur = HEAVE_THROW_DUR;
    this._action = {
      type: 'heave',
      t: 0,
      dur,
      anticipateEnd: dur * 0.45,
      releaseAt: dur * 0.72,
      released: false,
      onRelease: onRelease || null,
      onDone: onDone || null,
    };
  }

  _stepHeave(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const { anticipateEnd, releaseAt } = a;

    if (t <= anticipateEnd) {
      // Big anticipation: deep crouch, hard squash, holding the giant back.
      const p = easeInCubic(clamp01(t / anticipateEnd));
      this._bodySquashY = lerp(1.03, 0.74, p);
      this._bodySquashXZ = lerp(0.98, 1.22, p);
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.01, LEG_LEN - 0.07, p);
      this._legAngle.l = this._legAngle.r = lerp(0.12, -0.55, p);
      this._armAngle.l = this._armAngle.r = lerp(Math.PI, Math.PI + 0.4, p);
      this._bodyPivot.rotation.x = lerp(0, -0.22, p);
      this._earDriveFB = -0.8 * p;
    } else if (t <= releaseAt) {
      // Slow, heavy explosive extend to full stretch — release at the top.
      const span = Math.max(releaseAt - anticipateEnd, 1e-6);
      const p = easeOutCubic(clamp01((t - anticipateEnd) / span));
      this._bodySquashY = lerp(0.74, 1.28, p);
      this._bodySquashXZ = lerp(1.22, 0.86, p);
      this._bodyPivot.position.y = lerp(LEG_LEN - 0.07, LEG_LEN + 0.06, p);
      this._legAngle.l = this._legAngle.r = lerp(-0.55, 0.65, p);
      this._armAngle.l = this._armAngle.r = lerp(Math.PI + 0.4, 0.15, p);
      this._bodyPivot.rotation.x = lerp(-0.22, 0.28, p);
      this._earDriveFB = lerp(-0.8, 1.5, p);
    } else {
      // Follow-through + settle wobble.
      const span = Math.max(a.dur - releaseAt, 1e-6);
      const p = clamp01((t - releaseAt) / span);
      const settle = easeOutCubic(p);
      const wobble = Math.sin(p * Math.PI * 2.2) * 0.3 * (1 - p);
      this._bodySquashY = lerp(1.28, 1, settle);
      this._bodySquashXZ = lerp(0.86, 1, settle);
      this._bodyPivot.position.y = lerp(LEG_LEN + 0.06, LEG_LEN, settle);
      this._legAngle.l = this._legAngle.r = lerp(0.65, 0, settle);
      this._armAngle.l = this._armAngle.r = lerp(0.15, 0.6, settle) + wobble;
      this._bodyPivot.rotation.x = lerp(0.28, 0, settle);
      this._earDriveFB = lerp(1.5, 0, settle) + wobble;
    }

    if (!a.released && t >= releaseAt) {
      a.released = true;
      this._holdingGiant = false;
      this._holdingToy = false;
      if (a.onRelease) a.onRelease();
    }

    if (t >= a.dur) {
      this._bodySquashY = this._bodySquashXZ = 1;
      this._bodyPivot.position.y = LEG_LEN;
      this._bodyPivot.rotation.x = 0;
      this._legAngle.l = this._legAngle.r = 0;
      this._armAngle.l = this._armAngle.r = 0.6;
      this._action = null;
      this.state = 'ride';
      const cb = a.onDone;
      if (cb) cb();
    }
  }

  // Idle-equivalent while gondola-riding: locks root.position onto
  // balloon.gondolaAnchor every frame (contract), plus breathing/twitch as
  // in ground idle, plus altitude-wind ear reaction (stronger once
  // balloon.progress > 0.3, per contract).
  _updateRideIdle(dt) {
    const anchor = this._gondolaAnchor();
    if (anchor) {
      anchor.getWorldPosition(this._pawTargetScratch);
      this.root.position.copy(this._pawTargetScratch);
    }

    this._breathT += dt;
    const breath = Math.sin(this._breathT * 2.1);
    const restLeg = this._holdingGiant ? 0.12 : 0;
    const restArm = this._holdingGiant || this._holdingToy ? Math.PI : 0;
    this._bodyPivot.position.y = LEG_LEN + breath * 0.008 - (this._holdingGiant ? 0.01 : 0);
    this._bodySquashY = 1 + breath * 0.012;
    this._bodySquashXZ = 1 - breath * 0.008;
    this._armAngle.l = damp(this._armAngle.l, restArm, 0.15, dt);
    this._armAngle.r = damp(this._armAngle.r, restArm, 0.15, dt);
    this._legAngle.l = damp(this._legAngle.l, restLeg, 0.15, dt);
    this._legAngle.r = damp(this._legAngle.r, restLeg, 0.15, dt);
    this._bodyPivot.rotation.z = damp(this._bodyPivot.rotation.z, 0, 0.15, dt);
    this._bodyPivot.rotation.x = damp(this._bodyPivot.rotation.x, 0, 0.15, dt);

    // Altitude wind: ears stream backward, stronger once progress > 0.3.
    const progress = (this.sceneEnv && this.sceneEnv.balloon && this.sceneEnv.balloon.progress) || 0;
    const windAmt = progress > 0.3 ? clamp01((progress - 0.3) / 0.7) : 0;
    const windDrive = -0.95 * windAmt;

    this._twitchTimer -= dt;
    if (this._twitchTimer <= 0) {
      this._twitchTimer = 2.5 + Math.random() * 3.5;
      this._twitchSide = Math.random() < 0.5 ? -1 : 1;
      this._twitchAmt.vel += 6;
    }
    springStep(this._twitchAmt, 0, 220, 16, dt);

    this._earDriveFB = damp(this._earDriveFB, breath * 0.06 + windDrive, 0.2, dt);
    this._earDriveSideL = (this._twitchSide < 0 ? this._twitchAmt.v : 0) + windAmt * 0.18;
    this._earDriveSideR = (this._twitchSide > 0 ? this._twitchAmt.v : 0) - windAmt * 0.18;
  }

  // -----------------------------------------------------------------------
  // Public API — cheer
  // -----------------------------------------------------------------------
  cheer() {
    const hops = 2 + Math.round(Math.random());
    this.state = 'cheer';
    this._action = {
      type: 'cheer',
      t: 0,
      hops,
      hopDur: 0.38,
      dur: hops * 0.38 + 0.2,
    };
  }

  _stepCheer(dt) {
    const a = this._action;
    a.t += dt;
    const t = a.t;
    const activeDur = a.hops * a.hopDur;

    if (t <= activeDur) {
      const hopIdx = Math.min(a.hops - 1, Math.floor(t / a.hopDur));
      const localT = clamp01((t - hopIdx * a.hopDur) / a.hopDur);
      const hopArc = Math.sin(localT * Math.PI); // 0 -> 1 -> 0
      this._bodyPivot.position.y = LEG_LEN + hopArc * 0.09;
      this._legAngle.l = this._legAngle.r = -hopArc * 0.6;
      const wave = Math.sin(t * 14);
      this._armAngle.l = Math.PI * 0.55 + wave * 0.5;
      this._armAngle.r = Math.PI * 0.55 - wave * 0.5;
      this._bodyPivot.rotation.z = Math.sin(t * 10) * 0.08;
      // Landing impulse feeds the ear springs (flop on each landing).
      if (localT > 0.85) {
        this._earDriveFB = 1.0;
      } else {
        this._earDriveFB = -0.3 * hopArc;
      }
    } else {
      const p = clamp01((t - activeDur) / (a.dur - activeDur));
      const e = easeOutCubic(p);
      this._bodyPivot.position.y = lerp(LEG_LEN, LEG_LEN, e);
      this._bodyPivot.rotation.z = lerp(this._bodyPivot.rotation.z, 0, e);
      this._legAngle.l = lerp(this._legAngle.l, 0, e);
      this._legAngle.r = lerp(this._legAngle.r, 0, e);
      this._armAngle.l = lerp(this._armAngle.l, this._holdingToy ? Math.PI : 0, e);
      this._armAngle.r = lerp(this._armAngle.r, this._holdingToy ? Math.PI : 0, e);
      this._earDriveFB = lerp(this._earDriveFB, 0, e);
    }

    if (t >= a.dur) {
      this._bodyPivot.position.y = LEG_LEN;
      this._bodyPivot.rotation.z = 0;
      this._legAngle.l = this._legAngle.r = 0;
      this._armAngle.l = this._armAngle.r = this._holdingToy ? Math.PI : 0;
      this._action = null;
      this.state = 'idle';
    }
  }

  // -----------------------------------------------------------------------
  // Idle
  // -----------------------------------------------------------------------
  _updateIdle(dt) {
    this._breathT += dt;
    const breath = Math.sin(this._breathT * 2.1);
    this._bodyPivot.position.y = LEG_LEN + breath * 0.008;
    this._bodySquashY = 1 + breath * 0.012;
    this._bodySquashXZ = 1 - breath * 0.008;
    this._armAngle.l = damp(this._armAngle.l, this._holdingToy ? Math.PI : 0, 0.15, dt);
    this._armAngle.r = damp(this._armAngle.r, this._holdingToy ? Math.PI : 0, 0.15, dt);
    this._legAngle.l = damp(this._legAngle.l, 0, 0.15, dt);
    this._legAngle.r = damp(this._legAngle.r, 0, 0.15, dt);
    this._bodyPivot.rotation.z = damp(this._bodyPivot.rotation.z, 0, 0.15, dt);
    this._bodyPivot.rotation.x = damp(this._bodyPivot.rotation.x, 0, 0.15, dt);

    // Occasional ear twitch.
    this._twitchTimer -= dt;
    if (this._twitchTimer <= 0) {
      this._twitchTimer = 2.5 + Math.random() * 3.5;
      this._twitchSide = Math.random() < 0.5 ? -1 : 1;
      this._twitchAmt.vel += 6; // quick flick impulse
    }
    springStep(this._twitchAmt, 0, 220, 16, dt);

    this._earDriveFB = damp(this._earDriveFB, breath * 0.06, 0.2, dt);
    this._earDriveSideL = this._twitchSide < 0 ? this._twitchAmt.v : 0;
    this._earDriveSideR = this._twitchSide > 0 ? this._twitchAmt.v : 0;
  }

  // -----------------------------------------------------------------------
  // Shared per-frame systems (ears, pose apply, paw anchor, instancing)
  // -----------------------------------------------------------------------
  _updateEars(dt) {
    // Body-lean contribution layered on top of whatever the current action
    // set as the shared drive signal.
    const driveFB = this._earDriveFB + this._aimTiltF.v * -1.3;
    const driveSideL = this._earDriveSideL + this._aimTiltS.v * -1.1;
    const driveSideR = this._earDriveSideR + this._aimTiltS.v * -1.1;

    springStep(this._earL.fb, driveFB, 130, 9, dt);
    springStep(this._earL.side, driveSideL, 130, 9, dt);
    springStep(this._earR.fb, driveFB, 130, 9, dt);
    springStep(this._earR.side, driveSideR, 130, 9, dt);
  }

  _updatePose(dt) {
    // Apply eased limb angles to their pivots (rotation.z: hanging-down ->
    // straight-up sweep, per buildHangingCapsule's local convention).
    this._legPivots[0].rotation.z = this._legAngle.l;
    this._legPivots[1].rotation.z = this._legAngle.r;
    this._armPivots[0].rotation.z = this._armAngle.l;
    this._armPivots[1].rotation.z = this._armAngle.r;

    this._earPivots[0].rotation.z = -0.1 + this._earL.fb.v;
    this._earPivots[0].rotation.x = -0.16 + this._earL.side.v;
    this._earPivots[1].rotation.z = -0.1 + this._earR.fb.v;
    this._earPivots[1].rotation.x = 0.16 + this._earR.side.v;

    this._headPivot.rotation.y = this._headYaw.v + this._aimYaw.v * 0.3;
    this._headPivot.rotation.x = this._headPitch.v;

    this._bodyPivot.rotation.y = this._aimYaw.v;
    // rotation.x/.z already carry idle/action lean; add the aim tilt on top
    // (small, so it doesn't fight the bigger action poses).
    if (!this._action) {
      this._bodyPivot.rotation.z += this._aimTiltF.v;
      this._bodyPivot.rotation.x += this._aimTiltS.v;
    }

    this._bodyPivot.scale.set(this._bodySquashXZ, this._bodySquashY, this._bodySquashXZ);
  }

  _updatePawAnchor() {
    if (this._riding) {
      // Gondola-riding: hold point is above the basket floor (== root
      // position while riding), not above a board tip. See
      // GONDOLA_PAW_Y_OFFSET's comment for the clearance tradeoff.
      const anchor = this._gondolaAnchor();
      if (anchor) anchor.getWorldPosition(this._pawTargetScratch);
      else this._pawTargetScratch.copy(this.root.position);
      this._pawTargetScratch.y += GONDOLA_PAW_Y_OFFSET;
      this.root.updateMatrixWorld(true);
      this._pawLocalScratch.copy(this._pawTargetScratch);
      this.root.worldToLocal(this._pawLocalScratch);
      this.pawAnchor.position.copy(this._pawLocalScratch);
      if (this.pawAnchor.parent !== this.root) this.root.add(this.pawAnchor);
      return;
    }
    const tip = this._tipOf(this.currentPlatformId);
    this._pawTargetScratch.set(tip.x, tip.y + PAW_HOLD_Y_OFFSET, tip.z);
    this.root.updateMatrixWorld(true);
    this._pawLocalScratch.copy(this._pawTargetScratch);
    this.root.worldToLocal(this._pawLocalScratch);
    this.pawAnchor.position.copy(this._pawLocalScratch);
    if (this.pawAnchor.parent !== this.root) this.root.add(this.pawAnchor);
  }

  _updateInstances() {
    this.root.updateMatrixWorld(true);
    const dummy = this._instDummy;
    const mtx = this._instMtx;

    // Legs (hang straight down, no extra offset needed — baked into geo).
    for (let i = 0; i < 2; i++) {
      mtx.copy(this._legPivots[i].matrixWorld);
      this._legMesh.setMatrixAt(i, mtx);
    }
    this._legMesh.instanceMatrix.needsUpdate = true;

    // Arms.
    for (let i = 0; i < 2; i++) {
      mtx.copy(this._armPivots[i].matrixWorld);
      this._armMesh.setMatrixAt(i, mtx);
    }
    this._armMesh.instanceMatrix.needsUpdate = true;

    // Ears: outer (flattened along local X so the broad face reads from the
    // front) and a nested inner pink paddle offset slightly toward +X.
    for (let i = 0; i < 2; i++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.4, 1, 1.15);
      dummy.updateMatrix();
      mtx.multiplyMatrices(this._earPivots[i].matrixWorld, dummy.matrix);
      this._earOuterMesh.setMatrixAt(i, mtx);

      dummy.position.set(0.01, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.3, 1, 0.7);
      dummy.updateMatrix();
      mtx.multiplyMatrices(this._earPivots[i].matrixWorld, dummy.matrix);
      this._earInnerMesh.setMatrixAt(i, mtx);
    }
    this._earOuterMesh.instanceMatrix.needsUpdate = true;
    this._earInnerMesh.instanceMatrix.needsUpdate = true;
  }

  // -----------------------------------------------------------------------
  // update(dt, time) — dt is SCALED time (slow-mo affects the rabbit too).
  // -----------------------------------------------------------------------
  update(dt, time) {
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 1 / 20);

    if (this._action) {
      switch (this._action.type) {
        case 'climb':
          this._stepClimb(dt);
          break;
        case 'fetch':
          this._stepFetch(dt);
          break;
        case 'stow':
          this._stepStow(dt);
          break;
        case 'windup':
          this._stepWindup(dt);
          break;
        case 'cheer':
          this._stepCheer(dt);
          break;
        case 'board':
          this._stepBoard(dt);
          break;
        case 'exit':
          this._stepExit(dt);
          break;
        case 'fetchGiant':
          this._stepFetchGiant(dt);
          break;
        case 'heave':
          this._stepHeave(dt);
          break;
        default:
          break;
      }
    } else if (this._riding) {
      this._updateRideIdle(dt);
    } else {
      this._updateIdle(dt);
    }

    // Overlays that run regardless of the current action.
    this._updateAim(dt);
    this._updateWatch(dt);
    this._updateEars(dt);
    this._updatePose(dt);
    this._updatePawAnchor();
    this._updateInstances();
  }
}
