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

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vFoam;

uniform float uTime;
uniform vec2 uRippleCenter[${RIPPLE_COUNT}];
uniform float uRippleStart[${RIPPLE_COUNT}];
uniform float uRippleStrength[${RIPPLE_COUNT}];

const float RIPPLE_WAVELENGTH = ${RIPPLE_WAVELENGTH.toFixed(6)};
const float RIPPLE_SPEED = ${RIPPLE_SPEED.toFixed(6)};
const float RIPPLE_AMP_MAX = ${RIPPLE_AMP_MAX.toFixed(6)};
const float RIPPLE_DECAY = ${RIPPLE_DECAY.toFixed(6)};
const float RIPPLE_BAND = ${RIPPLE_BAND.toFixed(6)};
const float RIPPLE_K = ${RIPPLE_K.toFixed(6)};
const float MAX_DISPLACEMENT = ${MAX_DISPLACEMENT.toFixed(6)};

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

  h = clamp(h, -MAX_DISPLACEMENT, MAX_DISPLACEMENT);
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

  float alpha = clamp(uOpacity + fresnel * 0.1 + vFoam * 0.12, 0.0, 1.0);

  gl_FragColor = vec4(baseColor, alpha);
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

    return clamp(h, -MAX_DISPLACEMENT, MAX_DISPLACEMENT);
  }

  // dt is unused here (no CPU-side integration needed) but kept for the
  // contract's update(dt, time) signature; `time` is the scaled game clock
  // shared with the GPU so slow-motion slows ripples on both paths equally.
  update(dt, time) {
    this._time = time;
    this.material.uniforms.uTime.value = time;
  }
}
