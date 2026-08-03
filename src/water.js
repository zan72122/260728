// Water surface — see docs/CONTRACTS.md "src/water.js — C".
// Single circular mesh, custom ShaderMaterial, one draw call.
// GPU (vertex shader) and CPU (displacementAt) share the exact same
// ambient-wave + ripple-ring math and constants so bobbing toys match what
// is rendered, and so slow-motion (scaled `time`) affects both identically.
import * as THREE from 'three';
import { POOL } from './constants.js';

// --- geometry resolution --------------------------------------------------
const RADIAL_SEGMENTS = 64;   // rings from center to edge — enough for smooth ripples
const ANGULAR_SEGMENTS = 96;  // points per ring

// --- ripple pool -----------------------------------------------------------
const RIPPLE_COUNT = 12;

// --- shared ripple/wave constants (mirrored on CPU and in GLSL) -----------
const RIPPLE_WAVELENGTH = 0.55;      // meters between crests
const RIPPLE_SPEED = 1.6;            // m/s outward expansion speed
const RIPPLE_AMP_MAX = 0.14;         // meters, at strength = 1
const RIPPLE_DECAY = 1.15;           // exponential time decay rate (~3.5s to fade out)
const RIPPLE_BAND = RIPPLE_WAVELENGTH * 4.5; // trailing width of the ring "wave packet" (several visible rings)
const RIPPLE_K = (Math.PI * 2) / RIPPLE_WAVELENGTH;

// ambient gentle wave constants (sum of 3 small traveling sines)
const AMB1_FX = 0.9, AMB1_FT = 0.6, AMB1_AMP = 0.015;
const AMB2_FZ = 1.3, AMB2_FT = -0.45, AMB2_PHASE = 1.7, AMB2_AMP = 0.012;
const AMB3_F = 0.6, AMB3_FT = 0.33, AMB3_AMP = 0.01;

const MAX_DISPLACEMENT = 0.4; // clamp for both GPU and CPU height

// --- Mega extensions (M3: wall wave, sloshing, overflow ring, foam field) --
// Strict no-op design: every mega term is gated by a *StrengthUniform that
// defaults to 0, so `0 * (anything finite)` is exactly 0 regardless of the
// sentinel start-times below (which push their own exp()/sin() terms toward
// tiny-but-finite values, never NaN/Infinity) — normal play is bit-identical
// to pre-mega behavior without needing an extra "active" branch, mirroring
// the existing ripple-slot convention (strength 0 => contributes nothing).

// (b) WALL WAVE — one dedicated large-amplitude solitary ring, separate from
// the 12 ripple slots. Asymmetric profile: sharp leading face, long trailing
// slope, decaying with distance traveled.
const WALL_SPEED = 2.2;                 // m/s outward
const WALL_AMP_MAX = 0.9;               // meters, at strength = 1
const WALL_FRONT_WIDTH = 0.18;          // meters — steep leading face
const WALL_TRAIL_WIDTH = 1.2;           // meters — long trailing slope ("width ~1.2m")
const WALL_DECAY_PER_METER = 0.35;      // ~35% amplitude loss per meter traveled
const WALL_DECAY_K = -Math.log(1 - WALL_DECAY_PER_METER);
const WALL_DT_CLAMP = 8.0;              // seconds — matches ripple's own dt clamp style

// (c) SLOSHING — first-mode standing wave / whole-pool tilt.
const SLOSH_PERIOD = 1.8;               // seconds
const SLOSH_OMEGA = (Math.PI * 2) / SLOSH_PERIOD;
const SLOSH_LAMBDA = 0.7;               // decay rate -> ~3 visible periods over ~4-6s
const SLOSH_AMP_MAX = 0.15;             // meters, at strength = 1, r = R
const SLOSH_DELAY = (POOL.WATER_RADIUS / 2) / WALL_SPEED; // starts when wall is ~halfway out
const SLOSH_DT_CLAMP = 20.0;

// Mega terms (wall + slosh) are clamped separately from the untouched
// ambient+ripple clamp above, then summed — so normal play's clamp path is
// byte-for-byte the same code as before this change (regression-safe) while
// the wall wave can still reach its full ~0.9m amplitude.
const MEGA_MAX_DISPLACEMENT = 1.1;

// (d) SURFACE FOAM FIELD — fragment-only radial whitening mask.
const FOAM_MAX_RADIUS = 3.5;            // meters
const FOAM_GROW_TIME = 1.4;             // seconds to reach full radius
const FOAM_FADE_TIME = 11.0;            // seconds, ~10-12s total decay

// (b2) DECK OVERFLOW RING — separate mesh, the +1 allowed draw call.
const OVERFLOW_DURATION = 1.5;          // seconds, expand-then-retreat total
const OVERFLOW_REACH = 0.8;             // meters past the rim at peak
const OVERFLOW_BAND_WIDTH = 0.45;       // meters, soft band width
const OVERFLOW_INNER = POOL.WATER_RADIUS - 0.35;
const OVERFLOW_OUTER = POOL.WATER_RADIUS + OVERFLOW_REACH + OVERFLOW_BAND_WIDTH;
const OVERFLOW_SEGMENTS = 64;

function hexToVec3(hex) {
  return new THREE.Vector3(
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255
  );
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Build a circular grid (concentric rings, polar) so triangle density is
// spent entirely on the disc — no wasted corner geometry like a clipped
// square plane would have, while still giving good radial ripple resolution.
function buildWaterGeometry(radius, radialSegments, angularSegments) {
  const positions = [];
  const normals = [];
  const uvs = [];

  // center vertex
  positions.push(0, 0, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);

  for (let i = 1; i <= radialSegments; i++) {
    const r = (i / radialSegments) * radius;
    for (let j = 0; j < angularSegments; j++) {
      const theta = (j / angularSegments) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(x / (2 * radius) + 0.5, z / (2 * radius) + 0.5);
    }
  }

  const indices = [];

  // ring index helper: ring 0 = center (single vertex), ring i>=1 has
  // angularSegments vertices starting at offset 1 + (i-1)*angularSegments
  const ringStart = (i) => 1 + (i - 1) * angularSegments;

  // center fan -> first ring. Winding chosen so cross(v1-v0, v2-v0) points +Y
  // (verified: order (center, laterTheta, earlierTheta) faces +Y).
  const r1 = ringStart(1);
  for (let j = 0; j < angularSegments; j++) {
    const a = 0; // center
    const b = r1 + j;
    const c = r1 + ((j + 1) % angularSegments);
    indices.push(a, c, b);
  }

  // quads between ring i and ring i+1
  for (let i = 1; i < radialSegments; i++) {
    const rowA = ringStart(i);
    const rowB = ringStart(i + 1);
    for (let j = 0; j < angularSegments; j++) {
      const j1 = (j + 1) % angularSegments;
      const a = rowA + j;
      const b = rowA + j1;
      const c = rowB + j;
      const d = rowB + j1;
      // triangles (a,d,c) and (a,b,d) — verified to face +Y
      indices.push(a, d, c);
      indices.push(a, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Flat annulus (inner ring + outer ring of vertices) in the XZ plane for the
// deck-overflow ring mesh — same polar-grid spirit as buildWaterGeometry but
// without a center fan, since the middle is empty (it hugs the rim only).
function buildOverflowRingGeometry(innerRadius, outerRadius, segments) {
  const positions = [];
  for (let ring = 0; ring < 2; ring++) {
    const r = ring === 0 ? innerRadius : outerRadius;
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(theta) * r, 0, Math.sin(theta) * r);
    }
  }

  const indices = [];
  const segW = segments + 1;
  for (let j = 0; j < segments; j++) {
    const a = j;          // inner ring
    const b = j + 1;
    const c = segW + j;   // outer ring
    const d = segW + j + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vFoam;

uniform float uTime;
uniform vec2 uRippleCenter[${RIPPLE_COUNT}];
uniform float uRippleStart[${RIPPLE_COUNT}];
uniform float uRippleStrength[${RIPPLE_COUNT}];

// MEGA: wall wave — one dedicated slot, separate from the 12 ripples above.
uniform vec2 uWallCenter;
uniform float uWallStart;
uniform float uWallStrength;

// MEGA: sloshing — first-mode standing tilt toward the impact direction.
uniform vec2 uSloshDir;      // unit vector, pool-center -> impact point
uniform float uSloshStart;
uniform float uSloshStrength;

const float RIPPLE_WAVELENGTH = ${RIPPLE_WAVELENGTH.toFixed(6)};
const float RIPPLE_SPEED = ${RIPPLE_SPEED.toFixed(6)};
const float RIPPLE_AMP_MAX = ${RIPPLE_AMP_MAX.toFixed(6)};
const float RIPPLE_DECAY = ${RIPPLE_DECAY.toFixed(6)};
const float RIPPLE_BAND = ${RIPPLE_BAND.toFixed(6)};
const float RIPPLE_K = ${RIPPLE_K.toFixed(6)};
const float MAX_DISPLACEMENT = ${MAX_DISPLACEMENT.toFixed(6)};

const float WALL_SPEED = ${WALL_SPEED.toFixed(6)};
const float WALL_AMP_MAX = ${WALL_AMP_MAX.toFixed(6)};
const float WALL_FRONT_WIDTH = ${WALL_FRONT_WIDTH.toFixed(6)};
const float WALL_TRAIL_WIDTH = ${WALL_TRAIL_WIDTH.toFixed(6)};
const float WALL_DECAY_K = ${WALL_DECAY_K.toFixed(6)};
const float WALL_DT_CLAMP = ${WALL_DT_CLAMP.toFixed(6)};

const float SLOSH_OMEGA = ${SLOSH_OMEGA.toFixed(6)};
const float SLOSH_LAMBDA = ${SLOSH_LAMBDA.toFixed(6)};
const float SLOSH_AMP_MAX = ${SLOSH_AMP_MAX.toFixed(6)};
const float SLOSH_DT_CLAMP = ${SLOSH_DT_CLAMP.toFixed(6)};
const float POOL_WATER_RADIUS = ${POOL.WATER_RADIUS.toFixed(6)};
const float MEGA_MAX_DISPLACEMENT = ${MEGA_MAX_DISPLACEMENT.toFixed(6)};

void main() {
  vec3 pos = position;
  float x = pos.x;
  float z = pos.z;

  // --- gentle ambient waves (height + analytic slope) ---
  float h = 0.0;
  float dhx = 0.0;
  float dhz = 0.0;

  h += sin(x * ${AMB1_FX.toFixed(4)} + uTime * ${AMB1_FT.toFixed(4)}) * ${AMB1_AMP.toFixed(4)};
  dhx += cos(x * ${AMB1_FX.toFixed(4)} + uTime * ${AMB1_FT.toFixed(4)}) * ${AMB1_FX.toFixed(4)} * ${AMB1_AMP.toFixed(4)};

  h += sin(z * ${AMB2_FZ.toFixed(4)} + uTime * ${AMB2_FT.toFixed(4)} + ${AMB2_PHASE.toFixed(4)}) * ${AMB2_AMP.toFixed(4)};
  dhz += cos(z * ${AMB2_FZ.toFixed(4)} + uTime * ${AMB2_FT.toFixed(4)} + ${AMB2_PHASE.toFixed(4)}) * ${AMB2_FZ.toFixed(4)} * ${AMB2_AMP.toFixed(4)};

  float amb3c = cos((x + z) * ${AMB3_F.toFixed(4)} + uTime * ${AMB3_FT.toFixed(4)}) * ${AMB3_F.toFixed(4)} * ${AMB3_AMP.toFixed(4)};
  h += sin((x + z) * ${AMB3_F.toFixed(4)} + uTime * ${AMB3_FT.toFixed(4)}) * ${AMB3_AMP.toFixed(4)};
  dhx += amb3c;
  dhz += amb3c;

  float foam = 0.0;

  // --- ripple rings: expanding damped sine, several visible rings per ripple ---
  for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
    float strength = uRippleStrength[i];
    vec2 c = uRippleCenter[i];
    float dx = x - c.x;
    float dz = z - c.y;
    float dist = sqrt(dx * dx + dz * dz + 1e-5);
    float dt = clamp(uTime - uRippleStart[i], 0.0, 8.0);
    float front = dt * RIPPLE_SPEED;
    float behind = front - dist; // >0 once the ring has passed this point
    // trailing "wave packet": soft leading edge, fades out over RIPPLE_BAND
    float band = smoothstep(-0.12, 0.15, behind) * (1.0 - smoothstep(0.0, RIPPLE_BAND, behind));
    float envelope = strength * exp(-dt * RIPPLE_DECAY) * band;
    float phase = behind * RIPPLE_K;
    float wave = sin(phase);
    h += wave * envelope * RIPPLE_AMP_MAX;
    foam += max(wave, 0.0) * envelope;

    // analytic slope (approximate: treats envelope/band as locally constant)
    float invDist = 1.0 / dist;
    float dWaveDBehind = cos(phase) * RIPPLE_K;
    dhx += -dWaveDBehind * envelope * RIPPLE_AMP_MAX * dx * invDist;
    dhz += -dWaveDBehind * envelope * RIPPLE_AMP_MAX * dz * invDist;
  }

  // --- MEGA: wall wave — asymmetric solitary pulse (sharp front, long tail) ---
  float wallH = 0.0;
  {
    float wdx = x - uWallCenter.x;
    float wdz = z - uWallCenter.y;
    float wdist = sqrt(wdx * wdx + wdz * wdz + 1e-5);
    float dtw = clamp(uTime - uWallStart, 0.0, WALL_DT_CLAMP);
    float front = dtw * WALL_SPEED;
    float behind = front - wdist; // >0 once the wall has passed this point
    float shape = behind < 0.0
      ? exp(behind / WALL_FRONT_WIDTH)
      : exp(-behind / WALL_TRAIL_WIDTH);
    float travelDecay = exp(-front * WALL_DECAY_K);
    float wallEnv = uWallStrength * travelDecay * shape;
    wallH = wallEnv * WALL_AMP_MAX;
    foam += wallEnv * 1.4; // crest gets strong foam brightening

    // analytic slope (approximate, envelope treated as locally constant)
    float invWDist = 1.0 / wdist;
    float dShapeDBehind = behind < 0.0 ? shape / WALL_FRONT_WIDTH : -shape / WALL_TRAIL_WIDTH;
    float dWallDBehind = uWallStrength * travelDecay * dShapeDBehind * WALL_AMP_MAX;
    dhx += -dWallDBehind * wdx * invWDist;
    dhz += -dWallDBehind * wdz * invWDist;
  }

  // --- MEGA: sloshing — first-mode standing tilt toward the impact dir ---
  float sloshH = 0.0;
  {
    float r = sqrt(x * x + z * z);
    float dts = clamp(uTime - uSloshStart, 0.0, SLOSH_DT_CLAMP);
    float cosRel = (r > 1e-4) ? (x * uSloshDir.x + z * uSloshDir.y) / r : 0.0;
    float sloshEnv = uSloshStrength * SLOSH_AMP_MAX * sin(dts * SLOSH_OMEGA) * exp(-dts * SLOSH_LAMBDA);
    sloshH = sloshEnv * (r / POOL_WATER_RADIUS) * cosRel;
    // slope omitted: subtle whole-pool tilt, not worth the per-vertex cost
  }

  // Ambient+ripple clamp is untouched (byte-identical to pre-mega code) so
  // normal play cannot change; mega terms are clamped separately, then added.
  float hBase = clamp(h, -MAX_DISPLACEMENT, MAX_DISPLACEMENT);
  float hMega = clamp(wallH + sloshH, -MEGA_MAX_DISPLACEMENT, MEGA_MAX_DISPLACEMENT);
  h = hBase + hMega;
  pos.y += h;

  vNormal = normalize(mat3(modelMatrix) * normalize(vec3(-dhx, 1.0, -dhz)));
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vFoam = clamp(foam, 0.0, 1.0);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vFoam;

uniform float uOpacity;
uniform vec3 uColorShallow;
uniform vec3 uColorDeep;
uniform float uRadius;
uniform float uTime;

// MEGA: surface foam field (radial whitening mask around the impact point).
uniform vec2 uFoamCenter;
uniform float uFoamStart;
uniform float uFoamStrength;

const float FOAM_MAX_RADIUS = ${FOAM_MAX_RADIUS.toFixed(6)};
const float FOAM_GROW_TIME = ${FOAM_GROW_TIME.toFixed(6)};
const float FOAM_FADE_TIME = ${FOAM_FADE_TIME.toFixed(6)};

void main() {
  vec3 N = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  // depth-gradient: shallow color at the rim, deep color toward the center
  float distFromCenter = length(vWorldPos.xz);
  float t = clamp(distFromCenter / uRadius, 0.0, 1.0);
  vec3 baseColor = mix(uColorDeep, uColorShallow, t);

  // soft fresnel sparkle toward grazing angles
  float fresnel = pow(1.0 - clamp(dot(N, viewDir), 0.0, 1.0), 3.0);
  vec3 sparkleColor = vec3(0.85, 0.98, 1.0);
  baseColor = mix(baseColor, sparkleColor, fresnel * 0.55);

  // cheap twinkly glints, brighter at grazing angles
  float glintPattern = sin(vWorldPos.x * 41.0 + vWorldPos.z * 29.0 + uTime * 1.3) *
                        sin(vWorldPos.x * 17.0 - vWorldPos.z * 37.0 - uTime * 0.9);
  float glint = pow(clamp(glintPattern, 0.0, 1.0), 6.0) * fresnel;
  baseColor += vec3(glint) * 0.5;

  // foam-ish tint on ripple crests so rings read even at glancing angles
  vec3 foamColor = vec3(0.92, 1.0, 1.0);
  baseColor = mix(baseColor, foamColor, clamp(vFoam * 1.6, 0.0, 0.65));

  // MEGA: surface foam field — grows to FOAM_MAX_RADIUS, fades over
  // FOAM_FADE_TIME, with cheap animated bubbly noise so it reads as churned
  // water slowly clearing. uFoamStrength defaults to 0 so this is an exact
  // no-op (0 * finite = 0) until megaImpact() is called.
  float distFoam = length(vWorldPos.xz - uFoamCenter);
  float dtf = max(uTime - uFoamStart, 0.0);
  float growT = clamp(dtf / FOAM_GROW_TIME, 0.0, 1.0);
  float foamRadiusNow = growT * FOAM_MAX_RADIUS;
  float fadeT = clamp(1.0 - dtf / FOAM_FADE_TIME, 0.0, 1.0);
  float foamMask = (1.0 - smoothstep(foamRadiusNow * 0.55, max(foamRadiusNow, 0.001), distFoam));
  foamMask *= fadeT * uFoamStrength;
  float bubn = sin(vWorldPos.x * 12.0 + uTime * 3.1) * sin(vWorldPos.z * 9.0 - uTime * 2.3)
             + 0.5 * sin(vWorldPos.x * 23.0 - uTime * 4.7) * sin(vWorldPos.z * 19.0 + uTime * 3.9);
  bubn = clamp(bubn * 0.25 + 0.75, 0.0, 1.0);
  foamMask = clamp(foamMask * bubn, 0.0, 1.0);
  baseColor = mix(baseColor, foamColor, foamMask * 0.85);

  float alpha = clamp(uOpacity + fresnel * 0.1 + vFoam * 0.12 + foamMask * 0.15, 0.0, 1.0);

  gl_FragColor = vec4(baseColor, alpha);
}
`;

// --- Deck overflow ring (the +1 allowed draw call) -------------------------
// A thin ring mesh hugging the deck just above the rim; a soft bright band
// sweeps outward past the rim then retreats, driven by a single sine arc so
// "expand" and "retreat" share one continuous envelope. Strict no-op: mesh
// starts invisible (0 draw calls) and its material zeroes out via
// uOverflowStrength = 0 as a second safety net.
const OVERFLOW_VERTEX = /* glsl */ `
varying float vR;
varying vec2 vWorldXZ;

void main() {
  vR = length(position.xz);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldXZ = worldPos.xz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const OVERFLOW_FRAGMENT = /* glsl */ `
varying float vR;
varying vec2 vWorldXZ;

uniform float uTime;
uniform float uOverflowStart;
uniform float uOverflowStrength;

const float RIM_RADIUS = ${POOL.WATER_RADIUS.toFixed(6)};
const float REACH = ${OVERFLOW_REACH.toFixed(6)};
const float DURATION = ${OVERFLOW_DURATION.toFixed(6)};
const float BAND_WIDTH = ${OVERFLOW_BAND_WIDTH.toFixed(6)};

void main() {
  float t = clamp(uTime - uOverflowStart, 0.0, DURATION);
  float lifeEnv = sin(clamp(t / DURATION, 0.0, 1.0) * 3.14159265); // 0 -> 1 -> 0
  float bandR = RIM_RADIUS + REACH * lifeEnv;
  float d = abs(vR - bandR);
  float band = 1.0 - smoothstep(0.0, BAND_WIDTH, d);
  // fade the innermost sliver so the band reads as washing over the rim,
  // not as a hard-edged disc appearing out of nowhere
  float innerFade = smoothstep(RIM_RADIUS - 0.35, RIM_RADIUS, vR);
  float bubn = sin(vWorldXZ.x * 14.0 + uTime * 5.0) * sin(vWorldXZ.y * 11.0 - uTime * 4.2);
  bubn = clamp(bubn * 0.3 + 0.7, 0.0, 1.0);
  float alpha = band * lifeEnv * innerFade * bubn * uOverflowStrength * 0.9;
  gl_FragColor = vec4(0.95, 1.0, 1.0, clamp(alpha, 0.0, 1.0));
}
`;

export class WaterSurface {
  constructor(scene) {
    const geometry = buildWaterGeometry(POOL.WATER_RADIUS, RADIAL_SEGMENTS, ANGULAR_SEGMENTS);

    const rippleCenters = [];
    for (let i = 0; i < RIPPLE_COUNT; i++) rippleCenters.push(new THREE.Vector2(0, 0));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRippleCenter: { value: rippleCenters },
        uRippleStart: { value: new Float32Array(RIPPLE_COUNT).fill(-9999) },
        uRippleStrength: { value: new Float32Array(RIPPLE_COUNT) },
        uOpacity: { value: 0.82 },
        uColorShallow: { value: hexToVec3(0x4dd0e6) },
        uColorDeep: { value: hexToVec3(0x1a7ac4) },
        uRadius: { value: POOL.WATER_RADIUS },
        // MEGA — all default to strength 0 / sentinel start times, an exact
        // no-op (see shader comments) until megaImpact() is called.
        uWallCenter: { value: new THREE.Vector2(0, 0) },
        uWallStart: { value: -9999 },
        uWallStrength: { value: 0 },
        uSloshDir: { value: new THREE.Vector2(1, 0) },
        uSloshStart: { value: -9999 },
        uSloshStrength: { value: 0 },
        uFoamCenter: { value: new THREE.Vector2(0, 0) },
        uFoamStart: { value: -9999 },
        uFoamStrength: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, 0);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    // ring-buffer slot cursor: addRipple always recycles the oldest slot
    this._rippleCursor = 0;
    this._time = 0;

    // --- MEGA state (CPU mirror of the uniforms above, plus overflow ring) --
    this._wallCenter = { x: 0, z: 0 };
    this._wallStart = -9999;
    this._wallStrength = 0;
    this._sloshDir = { x: 1, z: 0 };
    this._sloshStart = -9999;
    this._sloshStrength = 0;
    this._overflowTriggered = true; // nothing to trigger until megaImpact() runs
    this._overflowStartTime = -9999;

    // Deck overflow ring: separate mesh/material, the +1 allowed draw call.
    // Starts invisible (0 draw calls, 0 visual change) until the wall wave
    // reaches POOL.WATER_RADIUS.
    const overflowGeometry = buildOverflowRingGeometry(OVERFLOW_INNER, OVERFLOW_OUTER, OVERFLOW_SEGMENTS);
    this.overflowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOverflowStart: { value: -9999 },
        uOverflowStrength: { value: 0 },
      },
      vertexShader: OVERFLOW_VERTEX,
      fragmentShader: OVERFLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.overflowMesh = new THREE.Mesh(overflowGeometry, this.overflowMaterial);
    this.overflowMesh.position.set(0, 0.06, 0);
    this.overflowMesh.renderOrder = 2;
    this.overflowMesh.visible = false;
    scene.add(this.overflowMesh);
  }

  // Launches the mega-splash wall wave, deck overflow (triggered once the
  // wall reaches the rim, see update()), sloshing, and surface foam field.
  // strength01: 0..1. Strict no-op for anything already in flight from a
  // normal (non-mega) ripple — this only touches the dedicated mega uniforms.
  megaImpact(x, z, strength01) {
    const strength = clamp(strength01, 0, 1);
    const t = this._time;

    // (b) wall wave — one dedicated ring, separate from the 12 ripple slots.
    this.material.uniforms.uWallCenter.value.set(x, z);
    this.material.uniforms.uWallStart.value = t;
    this.material.uniforms.uWallStrength.value = strength;
    this._wallCenter.x = x;
    this._wallCenter.z = z;
    this._wallStart = t;
    this._wallStrength = strength;
    this._overflowTriggered = false; // allow this wave to fire the overflow ring once

    // (c) sloshing — first-mode tilt, phased toward the impact direction,
    // kicking in once the wall wave is roughly halfway to the rim.
    const dist = Math.sqrt(x * x + z * z) || 1e-5;
    const dirX = x / dist;
    const dirZ = z / dist;
    this.material.uniforms.uSloshDir.value.set(dirX, dirZ);
    this.material.uniforms.uSloshStart.value = t + SLOSH_DELAY;
    this.material.uniforms.uSloshStrength.value = strength;
    this._sloshDir.x = dirX;
    this._sloshDir.z = dirZ;
    this._sloshStart = t + SLOSH_DELAY;
    this._sloshStrength = strength;

    // (d) surface foam field, centered at the impact point.
    this.material.uniforms.uFoamCenter.value.set(x, z);
    this.material.uniforms.uFoamStart.value = t;
    this.material.uniforms.uFoamStrength.value = strength;
  }

  // CPU mirror of the wall-wave height at (x, z) — see the vertex shader's
  // matching block for the annotated version of this same formula.
  _wallHeightAt(x, z) {
    if (this._wallStrength <= 0) return 0;
    const t = this._time;
    const dx = x - this._wallCenter.x;
    const dz = z - this._wallCenter.z;
    const dist = Math.sqrt(dx * dx + dz * dz + 1e-5);
    const dtw = clamp(t - this._wallStart, 0, WALL_DT_CLAMP);
    const front = dtw * WALL_SPEED;
    const behind = front - dist;
    const shape = behind < 0
      ? Math.exp(behind / WALL_FRONT_WIDTH)
      : Math.exp(-behind / WALL_TRAIL_WIDTH);
    const travelDecay = Math.exp(-front * WALL_DECAY_K);
    return this._wallStrength * travelDecay * shape * WALL_AMP_MAX;
  }

  // Just the sloshing (first-mode standing wave) term, exposed so physics
  // can rock floating bodies with the same tilt the surface renders.
  sloshOffsetAt(x, z) {
    if (this._sloshStrength <= 0) return 0;
    const t = this._time;
    const dts = clamp(t - this._sloshStart, 0, SLOSH_DT_CLAMP);
    const r = Math.sqrt(x * x + z * z);
    const cosRel = r > 1e-4 ? (x * this._sloshDir.x + z * this._sloshDir.z) / r : 0;
    const env = this._sloshStrength * SLOSH_AMP_MAX * Math.sin(dts * SLOSH_OMEGA) * Math.exp(-dts * SLOSH_LAMBDA);
    return env * (r / POOL.WATER_RADIUS) * cosRel;
  }

  // Starts the deck-overflow ring's expand-then-retreat animation. Called
  // once per mega impact, when the wall wave's radius reaches WATER_RADIUS.
  _triggerOverflow(time) {
    this.overflowMaterial.uniforms.uOverflowStart.value = time;
    this.overflowMaterial.uniforms.uOverflowStrength.value = this._wallStrength;
    this.overflowMesh.visible = true;
    this._overflowStartTime = time;
  }

  // strength 0..1; expanding ring ripple, recycles the oldest slot
  addRipple(x, z, strength) {
    const slot = this._rippleCursor;
    this._rippleCursor = (this._rippleCursor + 1) % RIPPLE_COUNT;

    this.material.uniforms.uRippleCenter.value[slot].set(x, z);
    this.material.uniforms.uRippleStart.value[slot] = this._time;
    this.material.uniforms.uRippleStrength.value[slot] = clamp(strength, 0, 1);
  }

  // CPU mirror of the vertex-shader height math, for one point (approximate
  // is fine — used for floating-toy bobbing).
  displacementAt(x, z) {
    const t = this._time;
    let h = 0;

    h += Math.sin(x * AMB1_FX + t * AMB1_FT) * AMB1_AMP;
    h += Math.sin(z * AMB2_FZ + t * AMB2_FT + AMB2_PHASE) * AMB2_AMP;
    h += Math.sin((x + z) * AMB3_F + t * AMB3_FT) * AMB3_AMP;

    const centers = this.material.uniforms.uRippleCenter.value;
    const starts = this.material.uniforms.uRippleStart.value;
    const strengths = this.material.uniforms.uRippleStrength.value;

    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const strength = strengths[i];
      if (strength <= 0) continue;
      const c = centers[i];
      const dx = x - c.x;
      const dz = z - c.y;
      const dist = Math.sqrt(dx * dx + dz * dz + 1e-5);
      const dt = clamp(t - starts[i], 0, 8);
      const front = dt * RIPPLE_SPEED;
      const behind = front - dist;
      const band = smoothstep(-0.12, 0.15, behind) * (1 - smoothstep(0, RIPPLE_BAND, behind));
      const envelope = strength * Math.exp(-dt * RIPPLE_DECAY) * band;
      const phase = behind * RIPPLE_K;
      h += Math.sin(phase) * envelope * RIPPLE_AMP_MAX;
    }

    // Ambient+ripple clamp is untouched (byte-identical to pre-mega code),
    // so normal play (mega terms always 0) returns exactly what it did
    // before this change. Mega terms (wall + slosh) are clamped separately
    // then added — matches the vertex shader's hBase/hMega split exactly.
    const hBase = clamp(h, -MAX_DISPLACEMENT, MAX_DISPLACEMENT);
    const hMega = clamp(this._wallHeightAt(x, z) + this.sloshOffsetAt(x, z), -MEGA_MAX_DISPLACEMENT, MEGA_MAX_DISPLACEMENT);
    return hBase + hMega;
  }

  // dt is unused here (no CPU-side integration needed) but kept for the
  // contract's update(dt, time) signature; `time` is the scaled game clock
  // shared with the GPU so slow-motion slows ripples on both paths equally.
  update(dt, time) {
    this._time = time;
    this.material.uniforms.uTime.value = time;

    // MEGA: once the wall wave's radius reaches the pool edge, fire the deck
    // overflow ring exactly once per megaImpact() call.
    if (this._wallStrength > 0 && !this._overflowTriggered) {
      const front = (time - this._wallStart) * WALL_SPEED;
      if (front >= POOL.WATER_RADIUS) {
        this._overflowTriggered = true;
        this._triggerOverflow(time);
      }
    }

    if (this.overflowMesh.visible) {
      this.overflowMaterial.uniforms.uTime.value = time;
      if (time - this._overflowStartTime > OVERFLOW_DURATION) {
        this.overflowMesh.visible = false;
      }
    }
  }
}
