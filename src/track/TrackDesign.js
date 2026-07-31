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
// Node spacing is derived from each segment's own arc length via a single
// target-spacing constant (roughly constant metres/node everywhere) so that
// no two adjacent segments meet with wildly mismatched spacing — that
// mismatch is what makes a centripetal Catmull-Rom spline overshoot into a
// sharp, unwanted kink at the seam.
//
// Section order along the course (all letters map to a contiguous s-range,
// exported below as SECTION_BOUNDS for the other modules / TrackMaterial):
//   A Launch -> B High-speed helix -> C Dark tunnel -> D Bowl / wave
//   -> E Airtime kicker -> F Last drop -> pool

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

const SPACING = 6.5;         // default metres/node for curved (pitch/turn) segments
const STRAIGHT_SPACING = 13; // straight segments have no curvature to track, so can be sparser
const HELIX_SPACING = 8.5;   // the helix has a large radius so can afford somewhat sparser nodes

function stepsFor(arcLen, spacing = SPACING) {
  return Math.max(1, Math.round(arcLen / spacing));
}

/* ------------------------------------------------------------------ *
 *  Cursor-based path builders
 *
 *  cursor = { pos: Vector3, heading: Vector3 (unit, y=0), pitch: number }
 *  pitch is the descent angle of the direction of travel below horizontal
 *  (radians, positive = descending). Actual 3D direction of travel is
 *  heading*cos(pitch) - UP*sin(pitch).
 * ------------------------------------------------------------------ */

// Straight run (constant heading, constant pitch).
function straightRun(cursor, dist, spacing = STRAIGHT_SPACING) {
  const steps = stepsFor(dist, spacing);
  const dir = cursor.heading.clone().multiplyScalar(Math.cos(cursor.pitch));
  dir.y = -Math.sin(cursor.pitch);
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
function pitchRun(cursor, pitchEnd, radius, spacing = SPACING) {
  const pitchStart = cursor.pitch;
  const sweep = pitchEnd - pitchStart;
  const arcLen = Math.abs(sweep) * radius;
  const steps = stepsFor(arcLen, spacing);
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
function turnRun(cursor, turn, radius, sweepRad, spacing = SPACING) {
  const H0 = cursor.heading.clone();
  const leftN = H0.clone().applyAxisAngle(UP, Math.PI / 2);
  const center = cursor.pos.clone().addScaledVector(leftN, radius * turn);
  const radiusVec0 = new THREE.Vector3().subVectors(cursor.pos, center);
  radiusVec0.y = 0;

  const arcLenTotal = radius * sweepRad;
  const steps = stepsFor(arcLenTotal, spacing);
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
    for (const p of nodes) raw.push({ p, section, ...attrs });
  };

  const HELIX_CRUISE_PITCH = 0.082;

  /* ---- A. Launch: short runway then a swooping drop into the helix's
   *       cruise pitch (lands exactly on HELIX_CRUISE_PITCH so B can start
   *       turning immediately with no separate "settle" segment — those
   *       tend to be short relative to their neighbours and make a
   *       Catmull-Rom spline overshoot at the seam). ---- */
  {
    let r;
    r = straightRun(cursor, 16); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.72, 20); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = pitchRun(cursor, HELIX_CRUISE_PITCH, 33, 5); push(r.nodes, 'A', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
  }

  /* ---- B. High-speed helix: ~1.95 turns, strong bank ---- */
  {
    const turn = 1; // left-handed spiral
    const sweepRad = 1.95 * Math.PI * 2;
    const r = turnRun(cursor, turn, 21, sweepRad, HELIX_SPACING);
    const nNodes = r.nodes.length;
    for (let i = 0; i < nNodes; i++) {
      const frac = (i + 1) / nNodes;
      const ramp = THREE.MathUtils.smoothstep(frac, 0, 0.16) * (1 - THREE.MathUtils.smoothstep(frac, 0.84, 1));
      const bankMag = 0.55 + 0.30 * ramp; // 0.55 .. 0.85 rad through the body of the spiral
      raw.push({ p: r.nodes[i], section: 'B', radius: 5.5, bank: -turn * bankMag, tunnel: false, widthScale: 1.0 });
    }
    cursor = r.cursor;
  }

  /* ---- C. Dark tunnel: mostly straight, one gentle bend, closed tube.
   *       Pitch barely changes from the helix's cruise value, so no settle
   *       segment is inserted before it either. ---- */
  {
    let r;
    r = straightRun(cursor, 56); push(r.nodes, 'C', { radius: 4.9, bank: 0, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
    r = turnRun(cursor, -1, 32, 0.4); push(r.nodes, 'C', { radius: 4.9, bank: -0.12, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
    r = straightRun(cursor, 50); push(r.nodes, 'C', { radius: 4.9, bank: 0, tunnel: true, widthScale: 0.92 }); cursor = r.cursor;
  }

  /* ---- D. Bowl / wave: alternating S-bends, lateral G. No pitch "settle"
   *       segment here — C already leaves the cursor at a pitch close
   *       enough that the first bend can absorb the difference itself,
   *       which avoids a lone short node between two long-arc neighbours
   *       (that mismatch is what overshoots into a sub-12m kink). ---- */
  {
    let r;
    const bends = [
      { turn: 1, radius: 21, sweep: 0.85 },
      { turn: -1, radius: 20, sweep: 1.05 },
      { turn: 1, radius: 23, sweep: 0.95 },
      { turn: -1, radius: 21, sweep: 0.90 },
      { turn: 1, radius: 26, sweep: 0.75 },
    ];
    for (const b of bends) {
      r = turnRun(cursor, b.turn, b.radius, b.sweep);
      const nNodes = r.nodes.length;
      for (let i = 0; i < nNodes; i++) {
        const frac = (i + 1) / nNodes;
        const ramp = THREE.MathUtils.smoothstep(frac, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(frac, 0.7, 1));
        raw.push({ p: r.nodes[i], section: 'D', radius: 5.7, bank: -b.turn * 0.42 * (0.4 + 0.6 * ramp), tunnel: false, widthScale: 1.12 });
      }
      cursor = r.cursor;
    }
  }

  /* ---- E. Airtime: short kicker up, crest, short descent. Pitch swings
   *       fairly quickly here, so use bigger radii and denser spacing than
   *       the default — a sparse node chain tracks an intended arc poorly
   *       right where several direction changes are stacked close together,
   *       and the realised (spline) curvature can overshoot well past any
   *       single segment's own design radius. ---- */
  {
    let r;
    const eSpacing = 3.75;
    r = pitchRun(cursor, -0.13, 36, eSpacing); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = straightRun(cursor, 10, eSpacing); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.17, 38, eSpacing); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
    r = straightRun(cursor, 9, eSpacing); push(r.nodes, 'E', { radius: 5.0, bank: 0, tunnel: false, widthScale: 1.0 }); cursor = r.cursor;
  }

  /* ---- F. Last drop: steep (not literally vertical) plunge, then a
   *       generous pull-out curve into a short flat run-in to the pool.
   *       Denser spacing at both pitch transitions for the same reason
   *       as section E. ---- */
  {
    let r;
    r = pitchRun(cursor, 0.68, 30, 4.5); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = straightRun(cursor, 18); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.05 }); cursor = r.cursor;
    r = pitchRun(cursor, 0.05, 28, 6); push(r.nodes, 'F', { radius: 5.3, bank: 0, tunnel: false, widthScale: 1.1 }); cursor = r.cursor;
    r = straightRun(cursor, 14); push(r.nodes, 'F', { radius: 5.2, bank: 0, tunnel: false, widthScale: 1.1 }); cursor = r.cursor;
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
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  let idx = 0;
  for (const key of order) {
    let endIdx = idx;
    while (endIdx < raw.length && raw[endIdx].section === key) endIdx++;
    const sStart = idx === 0 ? 0 : sAtNode(idx);
    const sEnd = endIdx >= l ? total : sAtNode(endIdx);
    bounds[key] = [sStart, sEnd];
    idx = endIdx;
  }

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
