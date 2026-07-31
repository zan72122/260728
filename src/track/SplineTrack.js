// AQUA VELOCITY — A2 TRACK
// src/track/SplineTrack.js
//
// Owns the 3D centre-line spline of the water-slide, its arc-length
// parameterisation, a Rotation-Minimizing (Parallel Transport) Frame for
// stable/roll-free camera & physics frames, the U-shaped cross-section
// surface query, and the four geometry builders (chute / shell / water /
// supports). See SPEC.md §3, §4.1 for the exact contract every other
// module relies on — do not change the public API shape.

import * as THREE from 'three';
import { createShellMaterial } from './TrackMaterial.js';

/* ------------------------------------------------------------------ *
 *  Tunable shape constants
 * ------------------------------------------------------------------ */

const ANGLE_MAX = 1.25;            // rad — half-pipe wall sweep, lateral=±1
const FLARE_START = 0.8;           // |lateral| where the top lip starts flaring outward
const FLARE_AMOUNT = 0.22;         // m — extra outward bulge at |lateral| = 1
const LUT_SAMPLES = 6000;          // uniform-t samples backing the arc-length / frame LUT

const SHELL_THICKNESS = 0.24;      // m — outward offset of the shell from the chute surface
const SHELL_ROOF_THICKNESS = 0.18; // m — outward offset of the tunnel roof shell

const WATER_LATERAL = 0.85;        // water spans lateral in [-WATER_LATERAL, WATER_LATERAL]
const WATER_LIFT_MIN = 0.06;       // m — water height above the chute floor near the edges
const WATER_LIFT_MAX = 0.25;       // m — water height above the chute floor at the centre

const SLIT_SPACING = 6.0;          // m — spacing between tunnel ceiling light-slits
const SLIT_WIDTH = 0.9;            // m — arc-length width of each slit
const SLIT_U0 = 0.40;              // roof-u band that a slit interrupts (u=0.5 is the apex)
const SLIT_U1 = 0.60;

const SUPPORT_SPACING = 25;        // m — nominal distance between support towers
const SUPPORT_MIN_HEIGHT = 1.35;   // m — towers shorter than this are skipped (rides a berm instead)
const SUPPORT_LEG_SPREAD = 2.35;   // m — half-width of the truss footprint at deck level
const SUPPORT_BASE_SPREAD_SCALE = 0.55;

const EPS = 1e-6;

/* ------------------------------------------------------------------ *
 *  Small stand-alone math helpers
 * ------------------------------------------------------------------ */

// Cubic derivative of THREE.MathUtils.smoothstep(x, edge0, edge1) w.r.t x.
function smoothstepDeriv(x, edge0, edge1) {
  if (edge0 === edge1) return 0;
  if (x <= edge0 || x >= edge1) return 0;
  const t = (x - edge0) / (edge1 - edge0);
  return (6 * t - 6 * t * t) / (edge1 - edge0);
}

// Uniform Catmull-Rom (tension 0.5) interpolation of a scalar sequence.
function catmullRom1D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (p2 - p0) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (3 * p1 - p0 - 3 * p2 + p3) * t3
  );
}

function isSlitAt(s) {
  const m = THREE.MathUtils.euclideanModulo(s, SLIT_SPACING);
  return m < SLIT_WIDTH;
}

// Scratch objects reused by internal math only — never handed back to callers.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();
const _tmpN = new THREE.Vector3();
const _tmpT = new THREE.Vector3();
const _tmpAcross = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpMid = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _tmpMat = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Double-reflection parallel-transport step (Wang / Jüttler / Zheng / Liu,
 * "Computation of Rotation Minimizing Frames", ACM TOG 2008). Transports the
 * unit reference vector r0 (⟂ t0) living at p0 to a unit vector ⟂ t1 at p1,
 * with (to 2nd order) zero unnecessary twist — this is what keeps the track
 * frame from rolling/flipping at inflection points the way a naive Frenet
 * frame does.
 */
function transportReference(p0, t0, r0, p1, t1, target) {
  const v1 = _v1.subVectors(p1, p0);
  const c1 = v1.dot(v1);

  let rLx = r0.x, rLy = r0.y, rLz = r0.z;
  let tLx = t0.x, tLy = t0.y, tLz = t0.z;

  if (c1 > EPS) {
    const rk = (2 * v1.dot(r0)) / c1;
    rLx -= rk * v1.x; rLy -= rk * v1.y; rLz -= rk * v1.z;
    const tk = (2 * v1.dot(t0)) / c1;
    tLx -= tk * v1.x; tLy -= tk * v1.y; tLz -= tk * v1.z;
  }

  const v2x = t1.x - tLx, v2y = t1.y - tLy, v2z = t1.z - tLz;
  const c2 = v2x * v2x + v2y * v2y + v2z * v2z;

  if (c2 > EPS) {
    const rk2 = (2 * (v2x * rLx + v2y * rLy + v2z * rLz)) / c2;
    target.set(rLx - rk2 * v2x, rLy - rk2 * v2y, rLz - rk2 * v2z);
  } else {
    target.set(rLx, rLy, rLz);
  }

  // Defensive re-orthogonalisation against fp drift accumulated over samples.
  target.addScaledVector(t1, -target.dot(t1));
  if (target.lengthSq() < EPS) {
    // Degenerate (t1 ≈ ±reference) — fall back to an arbitrary perpendicular.
    target.copy(Math.abs(t1.x) < 0.9 ? _v2.set(1, 0, 0) : _v2.set(0, 1, 0));
    target.addScaledVector(t1, -target.dot(t1));
  }
  target.normalize();
  return target;
}

/**
 * The 3D water-slide centre-line: arc-length parameterisation, a stable
 * Parallel-Transport cross-section frame, the U-shaped surface query, and
 * the geometry builders for the chute / shell / water / supports.
 */
export class SplineTrack {
  constructor(design) {
    this.design = design;

    const nodes = design.nodes;
    const points = nodes.map((n) => new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]));

    /** @type {THREE.Curve} */
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.curve.arcLengthDivisions = LUT_SAMPLES;

    this._buildLUT(nodes);

    /** @type {number} total arc length [m] */
    this.length = this._length;

    // Query cache for the s -> LUT-index search (helps sequential access
    // patterns, which is the overwhelmingly common case at runtime).
    this._cacheIdx = 0;
  }

  /* ---------------------------------------------------------------- *
   *  LUT construction (arc length, tangent, PTF, node-scalar fields)
   * ---------------------------------------------------------------- */

  _buildLUT(nodes) {
    const N = LUT_SAMPLES;
    const l = nodes.length;
    const curve = this.curve;

    const positions = new Array(N + 1);
    const tVals = new Float64Array(N + 1);
    const arcLen = new Float64Array(N + 1);

    let prev = curve.getPoint(0);
    positions[0] = prev;
    let sum = 0;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const p = curve.getPoint(t);
      sum += p.distanceTo(prev);
      positions[i] = p;
      tVals[i] = t;
      arcLen[i] = sum;
      prev = p;
    }
    this._length = sum;

    const tangents = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      tangents[i] = curve.getTangent(tVals[i]).normalize();
    }

    // Parallel transport frame, seeded from world-up projected ⟂ to tangent[0].
    const normals = new Array(N + 1);
    const binormals = new Array(N + 1);
    const r0 = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tangents[0].dot(r0)) > 0.995) r0.set(1, 0, 0);
    r0.addScaledVector(tangents[0], -tangents[0].dot(r0)).normalize();
    normals[0] = r0;
    binormals[0] = new THREE.Vector3().crossVectors(tangents[0], r0);

    for (let i = 1; i <= N; i++) {
      const ri = new THREE.Vector3();
      transportReference(positions[i - 1], tangents[i - 1], normals[i - 1], positions[i], tangents[i], ri);
      normals[i] = ri;
      binormals[i] = new THREE.Vector3().crossVectors(tangents[i], ri);
    }

    // Basis convention: local X = binormal, Y = normal, Z = -tangent. This is
    // a proper right-handed (det +1) basis because binormal = tangent×normal
    // implies binormal×normal = -tangent, i.e. X×Y=Z when Z=-tangent.
    const quats = new Array(N + 1);
    const basisMat = new THREE.Matrix4();
    const negT = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      negT.copy(tangents[i]).negate();
      basisMat.makeBasis(binormals[i], normals[i], negT);
      quats[i] = new THREE.Quaternion().setFromRotationMatrix(basisMat);
    }

    // Node-indexed scalar fields (radius / bank / widthScale / tunnel),
    // resampled at the same t_i as the position LUT via a Catmull-Rom blend
    // across the node sequence (tunnel uses nearest-node, it's a hard flag).
    const nodeRadius = nodes.map((n) => (n.radius != null ? n.radius : 5));
    const nodeBank = nodes.map((n) => (n.bank != null ? n.bank : 0));
    const nodeWidth = nodes.map((n) => (n.widthScale != null ? n.widthScale : 1));
    const nodeTunnel = nodes.map((n) => !!n.tunnel);

    const radii = new Float64Array(N + 1);
    const banks = new Float64Array(N + 1);
    const widthScales = new Float64Array(N + 1);
    const tunnels = new Uint8Array(N + 1);

    for (let i = 0; i <= N; i++) {
      const p = tVals[i] * (l - 1);
      let i0 = Math.floor(p);
      if (i0 > l - 2) i0 = l - 2;
      if (i0 < 0) i0 = 0;
      const frac = p - i0;
      const im1 = Math.max(0, i0 - 1);
      const i1 = i0 + 1;
      const i2 = Math.min(l - 1, i0 + 2);

      radii[i] = catmullRom1D(nodeRadius[im1], nodeRadius[i0], nodeRadius[i1], nodeRadius[i2], frac);
      banks[i] = catmullRom1D(nodeBank[im1], nodeBank[i0], nodeBank[i1], nodeBank[i2], frac);
      widthScales[i] = catmullRom1D(nodeWidth[im1], nodeWidth[i0], nodeWidth[i1], nodeWidth[i2], frac);
      tunnels[i] = (frac < 0.5 ? nodeTunnel[i0] : nodeTunnel[i1]) ? 1 : 0;
    }

    // Curvature (signed, + = left turn) and slope (sin, downhill positive).
    const curvature = new Float64Array(N + 1);
    const slope = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      slope[i] = -tangents[i].y;
      const iP = Math.max(0, i - 1);
      const iN = Math.min(N, i + 1);
      const ds = arcLen[iN] - arcLen[iP];
      if (ds > 1e-6) {
        const dTx = (tangents[iN].x - tangents[iP].x) / ds;
        const dTy = (tangents[iN].y - tangents[iP].y) / ds;
        const dTz = (tangents[iN].z - tangents[iP].z) / ds;
        const b = binormals[i];
        curvature[i] = -(dTx * b.x + dTy * b.y + dTz * b.z);
      }
    }

    this._N = N;
    this._arcLen = arcLen;
    this._positions = positions;
    this._quats = quats;
    this._radii = radii;
    this._banks = banks;
    this._widthScales = widthScales;
    this._tunnels = tunnels;
    this._curvature = curvature;
    this._slope = slope;
  }

  /** Binary-search (with a short walk from the last hit) for the LUT bracket containing s. */
  _findSegment(s) {
    const arr = this._arcLen;
    const N = this._N;
    const total = arr[N];

    if (s <= 0) return { i0: 0, i1: 1, frac: 0 };
    if (s >= total) return { i0: N - 1, i1: N, frac: 1 };

    let lo = this._cacheIdx;
    if (!(lo >= 0 && lo < N)) lo = 0;

    if (!(arr[lo] <= s && s <= arr[lo + 1])) {
      let steps = 0;
      while (lo > 0 && arr[lo] > s && steps < 48) { lo--; steps++; }
      while (lo < N - 1 && arr[lo + 1] < s && steps < 48) { lo++; steps++; }

      if (!(arr[lo] <= s && s <= arr[lo + 1])) {
        let low = 0, high = N;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (arr[mid] < s) low = mid + 1; else high = mid;
        }
        lo = Math.max(0, Math.min(N - 1, low - 1));
      }
    }

    this._cacheIdx = lo;
    const segLen = arr[lo + 1] - arr[lo];
    const frac = segLen > 1e-9 ? (s - arr[lo]) / segLen : 0;
    return { i0: lo, i1: lo + 1, frac };
  }

  /* ---------------------------------------------------------------- *
   *  Public frame / surface query
   * ---------------------------------------------------------------- */

  frameAt(s) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    const { i0, i1, frac } = this._findSegment(s);

    const position = this._positions[i0].clone().lerp(this._positions[i1], frac);

    const q = _scratchQuat.slerpQuaternions(this._quats[i0], this._quats[i1], frac);
    const tangent = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const binormal = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

    const bank = THREE.MathUtils.lerp(this._banks[i0], this._banks[i1], frac);
    if (Math.abs(bank) > 1e-9) {
      _bankQuat.setFromAxisAngle(tangent, bank);
      normal.applyQuaternion(_bankQuat);
      binormal.applyQuaternion(_bankQuat);
    }

    const radius = THREE.MathUtils.lerp(this._radii[i0], this._radii[i1], frac);
    const widthScale = THREE.MathUtils.lerp(this._widthScales[i0], this._widthScales[i1], frac);
    const curvature = THREE.MathUtils.lerp(this._curvature[i0], this._curvature[i1], frac);
    const slope = THREE.MathUtils.lerp(this._slope[i0], this._slope[i1], frac);
    const tunnel = !!(frac < 0.5 ? this._tunnels[i0] : this._tunnels[i1]);

    return { position, tangent, normal, binormal, curvature, radius, bank, slope, tunnel, widthScale };
  }

  // Inward ("rider-side") unit normal to the circular profile at the given
  // angle, expressed in the (binormal, normal) plane of the given frame.
  // Shared by surfaceAt/surfaceNormalAt and the tunnel-roof geometry.
  _innerDirAt(frame, angle, target) {
    return target.set(0, 0, 0)
      .addScaledVector(frame.normal, Math.cos(angle))
      .addScaledVector(frame.binormal, -Math.sin(angle));
  }

  surfaceAt(s, lateral, lift = 0) {
    const f = this.frameAt(s);
    const r = f.radius * f.widthScale;
    const angle = lateral * ANGLE_MAX;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    const point = f.position; // already a fresh Vector3 from frameAt — safe to mutate
    point.addScaledVector(f.binormal, r * sa).addScaledVector(f.normal, r - r * ca);

    const abs = Math.abs(lateral);
    const flareT = THREE.MathUtils.smoothstep(abs, FLARE_START, 1.0);
    const inward = this._innerDirAt(f, angle, _tmpN);
    if (flareT > 0) point.addScaledVector(inward, -FLARE_AMOUNT * flareT);
    if (lift) point.addScaledVector(inward, lift);

    return point;
  }

  surfaceNormalAt(s, lateral) {
    const f = this.frameAt(s);
    const r = f.radius * f.widthScale;
    const angle = lateral * ANGLE_MAX;
    const abs = Math.abs(lateral);

    const flare = FLARE_AMOUNT * THREE.MathUtils.smoothstep(abs, FLARE_START, 1.0);
    const flareDeriv = FLARE_AMOUNT * smoothstepDeriv(abs, FLARE_START, 1.0) * Math.sign(lateral);

    const tProf = _tmpT.set(0, 0, 0)
      .addScaledVector(f.binormal, Math.cos(angle))
      .addScaledVector(f.normal, Math.sin(angle));
    const baseN = this._innerDirAt(f, angle, _tmpN);

    const n = new THREE.Vector3()
      .addScaledVector(tProf, flareDeriv)
      .addScaledVector(baseN, ANGLE_MAX * (r + flare));

    return n.normalize();
  }

  /* ---------------------------------------------------------------- *
   *  Geometry builders
   * ---------------------------------------------------------------- */

  buildChuteGeometry() {
    const length = this.length;
    const sStep = 0.4;
    const numS = Math.max(2, Math.floor(length / sStep) + 1);
    const latDiv = 40;
    const numLat = latDiv + 1;

    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < numS; i++) {
      const s = Math.min(length, i * sStep);
      for (let j = 0; j < numLat; j++) {
        const lateral = -1 + (2 * j) / latDiv;
        const p = this.surfaceAt(s, lateral, 0);
        const n = this.surfaceNormalAt(s, lateral);
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uvs.push((lateral + 1) / 2, s / 2);
      }
    }

    const indices = [];
    for (let i = 0; i < numS - 1; i++) {
      for (let j = 0; j < numLat - 1; j++) {
        const a = i * numLat + j;
        const b = i * numLat + j + 1;
        const c = (i + 1) * numLat + j;
        const d = (i + 1) * numLat + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Tunnel roof: continues the very same circle (radius r about
    // centre + normal*r) from ANGLE_MAX round to 2π-ANGLE_MAX, closing the
    // tube. Interrupted by periodic light-slits (real geometric holes).
    const roofLatDiv = 20;
    const roofNumLat = roofLatDiv + 1;
    const roofRowStart = new Array(numS).fill(-1);

    for (let i = 0; i < numS; i++) {
      const s = Math.min(length, i * sStep);
      const f = this.frameAt(s);
      if (!f.tunnel) continue;

      roofRowStart[i] = positions.length / 3;
      const r = f.radius * f.widthScale;
      for (let j = 0; j < roofNumLat; j++) {
        const u = j / roofLatDiv;
        const phi = ANGLE_MAX + u * (2 * Math.PI - 2 * ANGLE_MAX);
        const ca = Math.cos(phi);
        const sa = Math.sin(phi);
        const n = this._innerDirAt(f, phi, new THREE.Vector3());

        const p = f.position.clone()
          .addScaledVector(f.normal, r * (1 - ca))
          .addScaledVector(f.binormal, r * sa);
        // Fade the same wall-lip flare in from both seams (u=0 / u=1) so the
        // roof meets the chute's flared top edge with no visible step.
        const seamFade = Math.max(
          1 - THREE.MathUtils.smoothstep(u, 0, 0.15),
          THREE.MathUtils.smoothstep(u, 0.85, 1)
        );
        if (seamFade > 0) p.addScaledVector(n, -FLARE_AMOUNT * seamFade);

        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(1 + u, s / 2);
      }
    }

    for (let i = 0; i < numS - 1; i++) {
      const rowA = roofRowStart[i];
      const rowB = roofRowStart[i + 1];
      if (rowA < 0 || rowB < 0) continue;
      const sMid = Math.min(length, (i + 0.5) * sStep);
      const slit = isSlitAt(sMid);
      for (let j = 0; j < roofNumLat - 1; j++) {
        const uMid = (j + 0.5) / roofLatDiv;
        if (slit && uMid > SLIT_U0 && uMid < SLIT_U1) continue; // light-slit hole
        const a = rowA + j, b = rowA + j + 1, c = rowB + j, d = rowB + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  buildShellGeometry() {
    const length = this.length;
    const sStep = 1.0;
    const numS = Math.max(2, Math.floor(length / sStep) + 1);
    const latDiv = 20;
    const numLat = latDiv + 1;

    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < numS; i++) {
      const s = Math.min(length, i * sStep);
      for (let j = 0; j < numLat; j++) {
        const lateral = -1 + (2 * j) / latDiv;
        const inward = this.surfaceNormalAt(s, lateral);
        const p = this.surfaceAt(s, lateral, 0).addScaledVector(inward, -SHELL_THICKNESS);
        positions.push(p.x, p.y, p.z);
        normals.push(-inward.x, -inward.y, -inward.z);
        uvs.push((lateral + 1) / 2, s / 4);
      }
    }

    const indices = [];
    for (let i = 0; i < numS - 1; i++) {
      for (let j = 0; j < numLat - 1; j++) {
        const a = i * numLat + j, b = i * numLat + j + 1, c = (i + 1) * numLat + j, d = (i + 1) * numLat + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Tunnel roof shell (outer dome), offset outward, matching slit holes.
    const roofLatDiv = 14;
    const roofNumLat = roofLatDiv + 1;
    const roofRowStart = new Array(numS).fill(-1);

    for (let i = 0; i < numS; i++) {
      const s = Math.min(length, i * sStep);
      const f = this.frameAt(s);
      if (!f.tunnel) continue;

      roofRowStart[i] = positions.length / 3;
      const r = f.radius * f.widthScale;
      for (let j = 0; j < roofNumLat; j++) {
        const u = j / roofLatDiv;
        const phi = ANGLE_MAX + u * (2 * Math.PI - 2 * ANGLE_MAX);
        const ca = Math.cos(phi);
        const sa = Math.sin(phi);
        const inward = this._innerDirAt(f, phi, new THREE.Vector3());

        const seamFade = Math.max(
          1 - THREE.MathUtils.smoothstep(u, 0, 0.15),
          THREE.MathUtils.smoothstep(u, 0.85, 1)
        );

        const p = f.position.clone()
          .addScaledVector(f.normal, r * (1 - ca))
          .addScaledVector(f.binormal, r * sa)
          .addScaledVector(inward, -SHELL_ROOF_THICKNESS - FLARE_AMOUNT * seamFade);

        positions.push(p.x, p.y, p.z);
        normals.push(-inward.x, -inward.y, -inward.z);
        uvs.push(1 + u, s / 4);
      }
    }

    for (let i = 0; i < numS - 1; i++) {
      const rowA = roofRowStart[i];
      const rowB = roofRowStart[i + 1];
      if (rowA < 0 || rowB < 0) continue;
      const sMid = Math.min(length, (i + 0.5) * sStep);
      const slit = isSlitAt(sMid);
      for (let j = 0; j < roofNumLat - 1; j++) {
        const uMid = (j + 0.5) / roofLatDiv;
        if (slit && uMid > SLIT_U0 && uMid < SLIT_U1) continue;
        const a = rowA + j, b = rowA + j + 1, c = rowB + j, d = rowB + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  buildWaterGeometry() {
    const length = this.length;
    const sStep = 0.5;
    const numS = Math.max(2, Math.floor(length / sStep) + 1);
    const latDiv = 32;
    const numLat = latDiv + 1;

    const positions = [];
    const normals = [];
    const uvs = [];
    const aFlow = [];
    const aDepth = [];
    const aS = [];

    for (let i = 0; i < numS; i++) {
      const s = Math.min(length, i * sStep);
      const f = this.frameAt(s);
      for (let j = 0; j < numLat; j++) {
        const lateral = -WATER_LATERAL + (2 * WATER_LATERAL * j) / latDiv;
        const depthNorm = THREE.MathUtils.clamp(
          1 - Math.pow(Math.abs(lateral) / WATER_LATERAL, 1.6), 0, 1
        );
        const lift = WATER_LIFT_MIN + (WATER_LIFT_MAX - WATER_LIFT_MIN) * depthNorm;

        const p = this.surfaceAt(s, lateral, lift);
        const n = this.surfaceNormalAt(s, lateral);
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uvs.push((lateral + 1) / 2, s / 2);

        // Flow direction in UV space: mostly downstream (+v), nudged
        // sideways by local curvature (outward push in a turn) and a mild
        // re-centring pull so streaks don't pile up against the walls.
        const fx = f.curvature * 5.0 - lateral * 0.5;
        const fy = 1.0;
        const flen = Math.hypot(fx, fy) || 1;
        aFlow.push(fx / flen, fy / flen);
        aDepth.push(depthNorm);
        aS.push(s / length);
      }
    }

    const indices = [];
    for (let i = 0; i < numS - 1; i++) {
      for (let j = 0; j < numLat - 1; j++) {
        const a = i * numLat + j, b = i * numLat + j + 1, c = (i + 1) * numLat + j, d = (i + 1) * numLat + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(aFlow, 2));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(aDepth, 1));
    geometry.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  buildSupports() {
    const group = new THREE.Group();
    group.name = 'TrackSupports';

    const struts = []; // { a, b, radius }

    const length = this.length;
    let s = SUPPORT_SPACING * 0.5;
    while (s < length - 3) {
      const f = this.frameAt(s);
      const groundY = 0;
      const deckY = f.position.y - f.radius * f.widthScale * 0.3;
      const height = deckY - groundY;

      if (height > SUPPORT_MIN_HEIGHT) {
        const across = _tmpAcross.set(f.binormal.x, 0, f.binormal.z);
        if (across.lengthSq() < 1e-6) across.set(1, 0, 0); else across.normalize();

        const topCenter = new THREE.Vector3(f.position.x, deckY - 0.3, f.position.z);
        const baseCenter = new THREE.Vector3(f.position.x, groundY, f.position.z);

        const legL_top = topCenter.clone().addScaledVector(across, -SUPPORT_LEG_SPREAD);
        const legR_top = topCenter.clone().addScaledVector(across, SUPPORT_LEG_SPREAD);
        const legL_base = baseCenter.clone().addScaledVector(across, -SUPPORT_LEG_SPREAD * SUPPORT_BASE_SPREAD_SCALE);
        const legR_base = baseCenter.clone().addScaledVector(across, SUPPORT_LEG_SPREAD * SUPPORT_BASE_SPREAD_SCALE);

        struts.push({ a: legL_base, b: legL_top, radius: 0.22 });
        struts.push({ a: legR_base, b: legR_top, radius: 0.22 });

        // X-bracing plus a mid tie for a believable open-truss look.
        const midL = legL_base.clone().lerp(legL_top, 0.5);
        const midR = legR_base.clone().lerp(legR_top, 0.5);
        struts.push({ a: legL_base, b: midR, radius: 0.08 });
        struts.push({ a: legR_base, b: midL, radius: 0.08 });
        struts.push({ a: midL, b: legR_top, radius: 0.08 });
        struts.push({ a: midR, b: legL_top, radius: 0.08 });
        struts.push({ a: midL, b: midR, radius: 0.07 });
        struts.push({ a: legL_top, b: legR_top, radius: 0.09 });
      }
      s += SUPPORT_SPACING;
    }

    const material = createShellMaterial();
    const postGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
    const braceGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);

    const posts = struts.filter((st) => st.radius >= 0.15);
    const braces = struts.filter((st) => st.radius < 0.15);

    const postMesh = new THREE.InstancedMesh(postGeo, material, Math.max(1, posts.length));
    const braceMesh = new THREE.InstancedMesh(braceGeo, material, Math.max(1, braces.length));
    postMesh.count = posts.length;
    braceMesh.count = braces.length;

    const writeInstances = (mesh, list) => {
      list.forEach((strut, idx) => {
        _tmpDir.subVectors(strut.b, strut.a);
        const len = Math.max(0.001, _tmpDir.length());
        _tmpDir.normalize();
        _tmpQuat.setFromUnitVectors(_UP, _tmpDir);
        _tmpMid.addVectors(strut.a, strut.b).multiplyScalar(0.5);
        _tmpScale.set(strut.radius, len, strut.radius);
        _tmpMat.compose(_tmpMid, _tmpQuat, _tmpScale);
        mesh.setMatrixAt(idx, _tmpMat);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
    };

    writeInstances(postMesh, posts);
    writeInstances(braceMesh, braces);

    group.add(postMesh, braceMesh);
    return group;
  }
}

export { ANGLE_MAX };
