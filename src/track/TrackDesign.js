// AQUA VELOCITY — A2 TRACK
// src/track/TrackDesign.js
//
// The stage layout (SPEC.md §4.2). The node list is generated
// parametrically (arcs of guaranteed horizontal/vertical radius chained
// through a small "cursor" — position + horizontal heading + pitch) rather
// than hand-typed, so every constraint in SPEC §4.2 (length, elevation
// change, minimum curve radius, no self-crossing) can be tuned by editing a
// handful of named constants instead of hundreds of coordinates.
//
// Section order along the course (all letters map to a contiguous s-range,
// exported below as SECTION_BOUNDS for the other modules / TrackMaterial):
//   A Launch -> B High-speed helix -> C Dark tunnel -> D Bowl / wave
//   -> E Airtime kicker -> F Last drop -> pool

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ *
 *  Cursor-based path builders
 *
 *  cursor = { pos: Vector3, heading: Vector3 (unit, y=0), pitch: number }
 *  pitch is the descent angle of the direction of travel below horizontal
 *  (radians, positive = descending). Actual 3D direction of travel is
 *  heading*cos(pitch) - UP*sin(pitch).
 * ------------------------------------------------------------------ */

function cloneCursor(c) {
  return { pos: c.pos.clone(), heading: c.heading.clone(), pitch: c.pitch };
}

function travelDir(cursor) {
  const d = cursor.heading.clone().multiplyScalar(Math.cos(cursor.pitch));
  d.y = -Math.sin(cursor.pitch);
  return d;
}

// Straight run (constant heading, constant pitch).
function straightRun(cursor, dist, steps) {
  const dir = travelDir(cursor);
  const stepDist = dist / steps;
  const pos = cursor.pos.clone();
  const nodes = [];
  for (let i = 1; i <= steps; i++) {
    pos.addScaledVector(dir, stepDist);
    nodes.push(pos.clone());
  }
  return { nodes, cursor: { pos: pos.clone(), heading: cursor.heading.clone(), pitch: cursor.pitch } };
}

// Vertical-plane curve: heading fixed, pitch ramps cursor.pitch -> pitchEnd.
// `radius` is the true radius of curvature of the vertical arc (>=12 keeps
// SPEC's curve-radius requirement satisfied by construction).
function pitchRun(cursor, pitchEnd, radius, steps) {
  const pitchStart = cursor.pitch;
  const sweep = pitchEnd - pitchStart;
  const arcLen = Math.abs(sweep) * radius;
  const stepArc = arcLen / steps;
  const pos = cursor.pos.clone();
  const nodes = [];
  for (let i = 1; i <= steps; i++) {
    const pitch = pitchStart + sweep * (i / steps);
    const dir = cursor.heading.clone().multiplyScalar(Math.cos(pitch));
    dir.y = -Math.sin(pitch);
    pos.addScaledVector(dir, stepArc);
    nodes.push(pos.clone());
  }
  return { nodes, cursor: { pos: pos.clone(), heading: cursor.heading.clone(), pitch: pitchEnd } };
}

// Horizontal turn (heading rotates by turn*sweepRad, turn=+1 left/-1 right)
// swept at constant pitch, so it also steadily descends like a helix when
// pitch != 0. `radius` is the horizontal turn radius.
function turnRun(cursor, turn, radius, sweepRad, steps) {
  const H0 = cursor.heading.clone();
  const leftN = H0.clone().applyAxisAngle(UP, Math.PI / 2);
  const center = cursor.pos.clone().addScaledVector(leftN, radius * turn);
  const radiusVec0 = new THREE.Vector3().subVectors(cursor.pos, center);
  radiusVec0.y = 0;

  const arcLenTotal = radius * sweepRad;
  const drop = Math.tan(cursor.pitch) * arcLenTotal;

  const nodes = [];
  for (let i = 1; i <= steps; i++) {
    const frac = i / steps;
    const alpha = turn * sweepRad * frac;
    const rv = radiusVec0.clone().applyAxisAngle(UP, alpha);
    const p = center.clone().add(rv);
    p.y = cursor.pos.y - drop * frac;
    nodes.push(p);
  }
  const endHeading = H0.clone().applyAxisAngle(UP, turn * sweepRad);
  const last = nodes[nodes.length - 1];
  return { nodes, cursor: { pos: last.clone(), heading: endHeading, pitch: cursor.pitch } };
}

/* ------------------------------------------------------------------ *
 *  Course generation
 * ------------------------------------------------------------------ */

function buildCourse() {
  const raw = []; // { p: Vector3, radius, bank, tunnel, widthScale, section }
  let cursor = { pos: new THREE.Vector3(0, 74, 0), heading: new THREE.Vector3(0, 0, -1), pitch: 0.06 };
  const start = cursor.pos.clone();

  const push = (nodes, section, attrs) => {
    for (const p of nodes) {
      raw.push({ p, section, ...attrs });
    }
  };

  /* ---- A. Launch: short runway then a swooping drop ---- */
  {
    let r;
    r = straightRun(cursor, 12, 3); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.95, 17, 4); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.30, 19, 3); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
  }

  /* ---- B. High-speed helix: ~1.9 turns, strong bank ---- */
  {
    let r;
    r = pitchRun(cursor, 0.12, 20, 2); push(r.nodes, 'B', { radius: 5.5, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;

    const turn = 1; // left-handed spiral
    const sweepRad = 1.9 * Math.PI * 2;
    const steps = 18;
    r = turnRun(cursor, turn, 17, sweepRad, steps);
    for (let i = 0; i < r.nodes.length; i++) {
      const frac = (i + 1) / r.nodes.length;
      const ramp = THREE.MathUtils.smoothstep(frac, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(frac, 0.82, 1));
      const bankMag = 0.55 + 0.30 * ramp; // 0.55 .. 0.85 rad through the body of the spiral
      raw.push({ p: r.nodes[i], section: 'B', radius: 5.5, bank: -turn * bankMag, tunnel: false, widthScale: 1.0 });
    }
    cursor = r.cursor;
  }

  /* ---- C. Dark tunnel: mostly straight, one gentle bend, closed tube ---- */
  {
    let r;
    r = pitchRun(cursor, 0.085, 26, 2); push(r.nodes, 'C', { radius: 4.9, bank: 0, tunnel: false, widthScale: 0.95 }); cursor = r.cursor;
    r = straightRun(cursor, 42, 5); push(r.nodes, 'C', { radius: 4.9, bank: 0, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
    r = turnRun(cursor, -1, 34, 0.4, 4); push(r.nodes, 'C', { radius: 4.9, bank: -0.12, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
    r = straightRun(cursor, 34, 4); push(r.nodes, 'C', { radius: 4.9, bank: 0, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
  }

  /* ---- D. Bowl / wave: alternating S-bends, lateral G ---- */
  {
    let r;
    r = pitchRun(cursor, 0.15, 22, 2); push(r.nodes, 'D', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;

    const bends = [
      { turn: 1, radius: 19, sweep: 0.85, steps: 3 },
      { turn: -1, radius: 18, sweep: 1.05, steps: 4 },
      { turn: 1, radius: 21, sweep: 0.95, steps: 3 },
      { turn: -1, radius: 19, sweep: 0.90, steps: 3 },
    ];
    for (const b of bends) {
      r = turnRun(cursor, b.turn, b.radius, b.sweep, b.steps);
      const bankMag = 0.42;
      for (let i = 0; i < r.nodes.length; i++) {
        const frac = (i + 1) / r.nodes.length;
        const ramp = THREE.MathUtils.smoothstep(frac, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(frac, 0.7, 1));
        raw.push({ p: r.nodes[i], section: 'D', radius: 5.7, bank: -b.turn * bankMag * (0.4 + 0.6 * ramp), tunnel: false, widthScale: 1.12 });
      }
      cursor = r.cursor;
    }
  }

  /* ---- E. Airtime: short kicker up, crest, short descent ---- */
  {
    let r;
    r = pitchRun(cursor, -0.24, 15, 3); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = straightRun(cursor, 8, 2); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.30, 16, 4); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = straightRun(cursor, 7, 2); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
  }

  /* ---- F. Last drop: near-vertical plunge into the pool ---- */
  {
    let r;
    r = pitchRun(cursor, 1.18, 23, 6); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = straightRun(cursor, 20, 3); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.04, 25, 6); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.1 }); cursor = r.cursor;
    r = straightRun(cursor, 9, 2); push(r.nodes, 'F', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.1 }); cursor = r.cursor;
  }

  return { start, raw, endCursor: cursor };
}

const { start, raw, endCursor } = buildCourse();

const nodes = raw.map((n) => ({
  pos: [n.p.x, n.p.y, n.p.z],
  radius: n.radius,
  bank: n.bank,
  tunnel: n.tunnel,
  widthScale: n.widthScale,
}));

/* ------------------------------------------------------------------ *
 *  Derived fields (arc length, section s-ranges) via a throwaway curve
 *  built exactly the way SplineTrack.js builds its own — keeps finishS /
 *  SECTION_BOUNDS consistent with what SplineTrack computes at runtime.
 * ------------------------------------------------------------------ */

function computeDerived() {
  const points = nodes.map((n) => new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = 6000;
  const lengths = curve.getLengths(6000); // cumulative length at uniform t samples

  const lengthAtT = (t) => {
    const f = t * 6000;
    const i0 = Math.min(5999, Math.floor(f));
    const frac = f - i0;
    return THREE.MathUtils.lerp(lengths[i0], lengths[i0 + 1], frac);
  };

  const total = lengths[6000];
  const l = nodes.length;

  // s-value at the boundary just *before* node index i (i.e. where node i's
  // segment starts), used to build per-section [sStart, sEnd] ranges.
  const sAtNode = (i) => lengthAtT(i / (l - 1));

  const bounds = {};
  let boundaryStart = 0;
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  let idx = 0;
  for (const key of order) {
    let endIdx = idx;
    while (endIdx < raw.length && raw[endIdx].section === key) endIdx++;
    const sStart = idx === 0 ? 0 : sAtNode(idx);
    const sEnd = endIdx >= l ? total : sAtNode(endIdx);
    bounds[key] = [sStart, sEnd];
    idx = endIdx;
    boundaryStart = sEnd;
  }
  void boundaryStart;

  return { total, bounds };
}

const { total: TOTAL_LENGTH, bounds: S_BOUNDS } = computeDerived();

/** Absolute s-ranges [start, end] in metres for each named section A-F. */
export const SECTION_BOUNDS = S_BOUNDS;

/** Same ranges normalised to the 0..1 course fraction, handy for shaders. */
export const SECTION_BOUNDS_01 = Object.fromEntries(
  Object.entries(S_BOUNDS).map(([k, [a, b]]) => [k, [a / TOTAL_LENGTH, b / TOTAL_LENGTH]])
);

const poolCenter = endCursor.pos.clone().addScaledVector(endCursor.heading, 9);
poolCenter.y = 0.6;

export const TRACK_DESIGN = {
  start,
  nodes,
  finishS: Math.max(0, TOTAL_LENGTH - 2.5),
  poolCenter: [poolCenter.x, poolCenter.y, poolCenter.z],
  poolRadius: 16,
};
