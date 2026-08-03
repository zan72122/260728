// src/splash.js — R2 rewrite, see docs/CONTRACTS-SPLASH2.md ("src/splash.js
// rewrite — R2"). THE STAR OF THE GAME: photoreal, transparent, refracting,
// fresnel-lit water. Public API is unchanged: SplashFX(scene, waterCtx),
// trigger(spec), update(dt, time), microSplash(x, z, size), isActive(),
// and a tolerated legacy `onDropletLand` no-op setter.
//
// update(dt, time): dt is SCALED (slow-mo already applied). Every splash
// animates from its own accumulated `age` so slow-motion just naturally
// stretches the curves below — no wall-clock dependence anywhere.
//
// ---------------------------------------------------------------------
// Animation model (read this before touching the shape math)
// ---------------------------------------------------------------------
// The crown is a single-surface lathe (surface of revolution) of
// CROWN_COLS angular columns x CROWN_ROWS radial rings, built once per
// pooled slot with static topology. Its final vertex position is a purely
// analytic function of (angle, v) — v=0 at the base (pool surface), v=1
// at the rim tip — plus a handful of *global* scalars (recomputed on the
// CPU once per frame: uHeightK, uRadiusK, uBeadK, ...) and a few *local*
// per-column attributes baked once at trigger() time from
// mulberry32(spec.seed) (aBaseR/aPeakR/aPeakH silhouette, aFingerAmp/
// aFingerPhase for the rim-finger displacement pattern). The exact same
// function (`crownPos`) exists twice: once in GLSL (vertex shader, runs
// per-vertex on the GPU every frame) and once mirrored in plain JS
// (`evalCrownTip`, CPU, only evaluated at discrete finger pinch-off
// events to find a droplet's launch origin/velocity). THE TWO MUST BE
// KEPT IN SYNC — see the comments next to each.
//
// Timeline phases (fractions of a per-splash `life`, itself scaled by
// energy — see computePhases): rise -> decelerate/flare -> rim
// thickens into a bead (torus-like) while fingers grow out of it
// -> individual fingers pinch off (droplet emitted, mirrors real
// high-speed footage) -> crown falls/retracts and melts back into the
// pool. Fingers are NOT discrete meshes — they are a continuous
// vertex-displacement weight (aFingerAmp, 0..1 per column, gaussian
// kernel around each finger's center column) multiplied by a growth/
// retract time curve, exactly the "vertex displacement pattern" the
// contract calls for.
//
// The lamella/sheet is a much simpler flat annulus rebuilt on the CPU
// each frame (grow fast, retract ~28% after peak — surface tension
// pull-back), sharing the same waterShade fragment shader for visual
// consistency with the crown.
//
// ---------------------------------------------------------------------
// watershading.js integration
// ---------------------------------------------------------------------
// R1's src/watershading.js may not exist yet (parallel development) or
// may fail to evaluate. We dynamically import it (top-level await) and
// fall back to a small self-contained implementation of the exact same
// waterShade()/fresnelSchlick()/skyEnvColor()/sunGlint()/refractSample()/
// absorb() contract (see FALLBACK_WATER_GLSL) if it's missing or throws.
// This keeps splash.js independently testable and resilient to load
// order, while still preferring R1's real shared implementation (and its
// live grab-pass texture / sun direction / absorption uniforms) once it
// lands. We never edit or create watershading.js ourselves.
// ---------------------------------------------------------------------

import * as THREE from 'three';
import { G, POOL } from './constants.js';
import { mulberry32 } from './rng.js';

let WATER_LAYER = 1; // contract default; overwritten if R1's module is available
let realWaterGlsl = null; // function(hasGrab) => GLSL chunk string, if available

try {
  const mod = await import('./watershading.js');
  if (mod && typeof mod.WATER_LAYER === 'number') WATER_LAYER = mod.WATER_LAYER;
  if (mod && typeof mod.waterGlslCommon === 'function') {
    realWaterGlsl = mod.waterGlslCommon;
  } else if (mod && mod.WATER_GLSL && typeof mod.WATER_GLSL.common === 'string') {
    // WATER_GLSL.common is a static string in this variant — wrap it in a
    // factory so callers can use one interface regardless of grab-pass
    // availability. If the shared chunk doesn't itself branch on HAS_GRAB
    // this still degrades safely (grab sampling just isn't reachable).
    const common = mod.WATER_GLSL.common;
    realWaterGlsl = (hasGrab) => (hasGrab ? '#define HAS_GRAB 1\n' : '') + common;
  }
} catch (err) {
  // R1's watershading.js isn't present/ready yet, or threw while
  // evaluating — fall back to FALLBACK_WATER_GLSL below. Not an error.
}

// ---- tunables ---------------------------------------------------------
const MAX_SPLASHES = 4;      // pooled crown+sheet splashes, >=3 required
const MICRO_MAX = 6;         // pooled micro crown-lets for big droplet landings
const CROWN_COLS = 96;       // angular segments (contract: ~96)
const CROWN_ROWS = 24;       // radial segments (contract: 20-28)
const MICRO_COLS = 24;       // contract: "simplified 24-seg ring"
const MICRO_ROWS = 6;
const SHEET_THETA = 72;      // sheet/lamella angular segments

const FINGER_WAVELENGTH = 0.30; // meters; scaled up from real capillary wavelength for readability
const FINGER_MIN = 14;
const FINGER_MAX = 26;

// ---- small math helpers -----------------------------------------------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

// ---- reusable scratch (no per-frame allocations in hot paths) ---------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

// =========================================================================
// Analytic timeline — mirrored exactly between JS (below) and GLSL
// (CROWN_VERTEX_SRC's fingerShapeFn). heightK/radiusK/beadK are GLOBAL
// (same for the whole crown) so they're computed once per frame in JS and
// pushed as plain scalar uniforms; fingerShape depends on a per-column
// attribute (aFingerPhase) so it must be evaluated per-vertex in the
// shader — its JS twin below is only used to find droplet pinch-off
// timing/position, never per frame.
// =========================================================================
function computePhases(life) {
  const riseEnd = life * 0.18;
  const flareEnd = life * 0.44;
  const fallStart = flareEnd + life * 0.16; // ~0.60*life
  const fingerGrowDur = life * 0.20;
  const fingerPhaseSpread = life * 0.14;
  const fingerRetractDur = life * 0.16;
  return { life, riseEnd, flareEnd, fallStart, fingerGrowDur, fingerPhaseSpread, fingerRetractDur };
}

function heightKFn(age, ph) {
  if (age <= ph.riseEnd) return smooth01(age / ph.riseEnd) * 0.72;
  if (age <= ph.flareEnd) return 0.72 + 0.28 * smooth01((age - ph.riseEnd) / (ph.flareEnd - ph.riseEnd));
  if (age <= ph.fallStart) return 1.0;
  const fk = clamp01((age - ph.fallStart) / (ph.life - ph.fallStart));
  return 1.0 - smooth01(fk) * 0.9;
}
function radiusKFn(age, ph) {
  if (age <= ph.flareEnd) return smooth01(age / ph.flareEnd);
  if (age <= ph.fallStart) {
    const t = smooth01((age - ph.flareEnd) / Math.max(1e-4, ph.fallStart - ph.flareEnd));
    return 1.0 + 0.06 * t;
  }
  const fk = clamp01((age - ph.fallStart) / (ph.life - ph.fallStart));
  return 1.06 * (1 - smooth01(fk) * 0.32);
}
function beadKFn(age, ph) {
  const start = ph.flareEnd * 0.75;
  if (age <= start) return 0;
  if (age <= ph.fallStart) return smooth01((age - start) / Math.max(1e-4, ph.fallStart - start));
  const fk = clamp01((age - ph.fallStart) / (ph.life - ph.fallStart));
  return 1 - smooth01(fk);
}
function alphaKFn(age, ph) {
  const fadeIn = ph.life * 0.06;
  if (age < fadeIn) return smooth01(age / fadeIn);
  const fadeOutStart = ph.life * 0.72;
  if (age > fadeOutStart) return 1 - smooth01((age - fadeOutStart) / (ph.life - fadeOutStart));
  return 1;
}
function glintKFn(age) {
  const g = clamp01(1 - age / 0.1);
  return g * g;
}
function fingerShapeFn(age, phase, ph) {
  const start = ph.flareEnd + phase * ph.fingerPhaseSpread;
  if (age < start) return 0;
  const grow = clamp01((age - start) / ph.fingerGrowDur);
  const growE = smooth01(grow);
  const tEnd = start + ph.fingerGrowDur;
  if (age <= tEnd) return growE;
  const retract = clamp01((age - tEnd) / ph.fingerRetractDur);
  return 1 - smooth01(retract);
}
function fingerPinchAge(phase, ph) {
  return ph.flareEnd + phase * ph.fingerPhaseSpread + ph.fingerGrowDur;
}

// CPU twin of the GLSL crownPos() function evaluated AT THE RIM (v=1),
// used only to locate a finger tip at its pinch-off moment (position +
// finite-difference velocity). Must track crownPos()'s v=1 saturation
// exactly (all the smoothstep/pow terms below saturate to 1 at v=1).
function evalCrownTip(age, ph, col, glob) {
  const heightK = heightKFn(age, ph);
  const radiusK = radiusKFn(age, ph);
  const beadK = beadKFn(age, ph);
  const rBase = col.baseR + (col.peakR - col.baseR) * radiusK;
  const hBase = col.peakH * heightK;
  const bulge = beadK * glob.beadBulge;
  const fShape = fingerShapeFn(age, col.fingerPhase, ph);
  const fAmt = col.fingerAmp * fShape;
  const r = Math.max(0, rBase + bulge + fAmt * glob.fingerLen);
  const h = Math.max(0, hBase + bulge * 0.4 + fAmt * glob.fingerLen * 1.35);
  return { r, h };
}

function sheetRadiusFrac(t) {
  if (t < 0.4) return smooth01(t / 0.4);
  const rt = clamp01((t - 0.4) / 0.6);
  return 1 - smooth01(rt) * 0.28;
}
function sheetAlphaFrac(t) {
  if (t < 0.08) return smooth01(t / 0.08);
  if (t > 0.55) return 1 - smooth01((t - 0.55) / 0.45);
  return 1;
}

// =========================================================================
// Fallback WATER_GLSL — implements the exact contract signature so this
// module renders correctly standalone (dev/crown-test.html) and degrades
// gracefully if R1's watershading.js is absent. Declares the SAME uniform
// names the contract specifies (uSceneTex, uViewport, uSunDir,
// uWaterAbsorb, uTimeW) so it's a drop-in swap for the real one.
// =========================================================================
function fallbackWaterGLSL(hasGrab) {
  return `
${hasGrab ? '#define HAS_GRAB 1' : ''}
uniform sampler2D uSceneTex;
uniform vec2 uViewport;
uniform vec3 uSunDir;
uniform vec3 uWaterAbsorb;
uniform float uTimeW;

float fresnelSchlick(float cosTheta, float F0) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return F0 + (1.0 - F0) * m2 * m2 * m;
}

vec3 skyEnvColor(vec3 dirW) {
  float t = clamp(dirW.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.80, 0.91, 0.98);
  vec3 zenith = vec3(0.22, 0.52, 0.92);
  vec3 col = mix(horizon, zenith, t);
  vec3 sd = normalize(uSunDir);
  float sun = pow(max(dot(normalize(dirW), sd), 0.0), 200.0);
  col += vec3(1.0, 0.96, 0.82) * sun * 2.5;
  return col;
}

float sunGlint(vec3 n, vec3 v) {
  vec3 l = normalize(uSunDir);
  vec3 h = normalize(l + v);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  return pow(nh, 240.0) * 3.0;
}

vec3 refractSample(vec2 screenUV, vec3 n, float thickness) {
#ifdef HAS_GRAB
  vec2 offset = n.xz * clamp(thickness * 3.0, 0.0, 0.06);
  vec2 uv = clamp(screenUV + offset, vec2(0.002), vec2(0.998));
  return texture2D(uSceneTex, uv).rgb;
#else
  // NO_GRAB fallback: no real scene to sample, use a plausible pool-water
  // tint so the shape/motion still reads without the actual background.
  return vec3(0.40, 0.64, 0.76);
#endif
}

vec3 absorb(vec3 refracted, float thickness) {
  vec3 k = uWaterAbsorb * (thickness * 10.0 + 0.25);
  return refracted * exp(-k);
}

vec4 waterShade(vec3 normalW, vec3 viewDirW, vec2 screenUV, float thickness, float foam) {
  vec3 n = normalize(normalW);
  vec3 v = normalize(viewDirW);
  float cosT = clamp(dot(n, v), 0.0, 1.0);
  float fres = fresnelSchlick(cosT, 0.02);
  vec3 refr = refractSample(screenUV, n, thickness);
  vec3 tinted = absorb(refr, thickness);
  vec3 sky = skyEnvColor(reflect(-v, n));
  vec3 col = mix(tinted, sky, clamp(fres + foam * 0.5, 0.0, 1.0));
  col += sunGlint(n, v) * (0.4 + 0.6 * fres);
  col = mix(col, vec3(1.0), foam * 0.6);
  float alpha = clamp(thickness * 22.0 + fres * 0.45 + foam * 0.5, 0.06, 1.0);
  return vec4(col, alpha);
}
`;
}

function waterGlslChunk(hasGrab) {
  if (realWaterGlsl) {
    try {
      const chunk = realWaterGlsl(hasGrab);
      if (typeof chunk === 'string' && chunk.length > 0) return chunk;
    } catch (err) {
      // fall through to local implementation
    }
  }
  return fallbackWaterGLSL(hasGrab);
}

// =========================================================================
// Shaders
// =========================================================================
// Crown/micro vertex shader. NOTE: the `position` attribute is repurposed
// to carry (angle, v, unused) instead of literal xyz — three.js needs a
// `position` attribute present to drive vertex/draw-range bookkeeping, and
// reusing it avoids a redundant pair of custom attributes. The actual
// world position is computed analytically from it below.
const CROWN_VERTEX_SRC = `
attribute float aBaseR;
attribute float aPeakR;
attribute float aPeakH;
attribute float aFingerAmp;
attribute float aFingerPhase;

uniform float uAge;
uniform float uFlareEnd;
uniform float uFingerGrowDur;
uniform float uFingerPhaseSpread;
uniform float uFingerRetractDur;
uniform float uFingerLen;
uniform float uBeadBulge;
uniform float uHeightK;
uniform float uRadiusK;
uniform float uBeadK;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vThickness;
varying float vFoam;

float smooth01_(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

// Mirrors fingerShapeFn() in splash.js exactly — keep in sync.
float fingerShape(float age, float phase) {
  float start = uFlareEnd + phase * uFingerPhaseSpread;
  if (age < start) return 0.0;
  float grow = clamp((age - start) / uFingerGrowDur, 0.0, 1.0);
  float growE = smooth01_(grow);
  float tEnd = start + uFingerGrowDur;
  if (age <= tEnd) return growE;
  float retract = clamp((age - tEnd) / uFingerRetractDur, 0.0, 1.0);
  return 1.0 - smooth01_(retract);
}

// Mirrors evalCrownTip() in splash.js at v=1 — keep in sync (this is the
// general v-parameterized version; JS only needs the v=1 saturation).
vec3 crownPos(float angle, float v, float age, float fPhase, float fAmp, float baseR, float peakR, float peakH) {
  float rBase = mix(baseR, baseR + (peakR - baseR) * uRadiusK, pow(max(v, 0.0), 0.7));
  float hBase = peakH * uHeightK * pow(max(v, 0.0), 0.9);
  float rimW = smooth01_(clamp((v - 0.75) / 0.25, 0.0, 1.0));
  float bulge = uBeadK * uBeadBulge * rimW;
  float fShape = fingerShape(age, fPhase);
  float fWeight = smooth01_(clamp((v - 0.55) / 0.45, 0.0, 1.0));
  float fAmt = fAmp * fShape * fWeight;
  float finalR = max(0.0, rBase + bulge + fAmt * uFingerLen);
  float finalH = max(0.0, hBase + bulge * 0.4 + fAmt * uFingerLen * 1.35);
  return vec3(cos(angle) * finalR, finalH, sin(angle) * finalR);
}

void main() {
  float angle = position.x;
  float v = position.y;

  vec3 p0 = crownPos(angle, v, uAge, aFingerPhase, aFingerAmp, aBaseR, aPeakR, aPeakH);

  // Finite-difference normal: nudge along v and angle, cross the tangents.
  // Approximation is fine per contract; gl_FrontFacing in the fragment
  // shader corrects final shading regardless of winding.
  float dv = 0.015;
  float da = 0.02;
  vec3 pv = crownPos(angle, clamp(v + dv, 0.0, 1.0), uAge, aFingerPhase, aFingerAmp, aBaseR, aPeakR, aPeakH);
  vec3 pa = crownPos(angle + da, v, uAge, aFingerPhase, aFingerAmp, aBaseR, aPeakR, aPeakH);
  vec3 tV = pv - p0;
  vec3 tA = pa - p0;
  vec3 n = cross(tA, tV);
  float nLen = length(n);
  n = nLen > 1e-6 ? n / nLen : vec3(0.0, 1.0, 0.0);

  vec4 worldPos = modelMatrix * vec4(p0, 1.0);
  vWorldPos = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);

  float thickness = mix(0.03, 0.004, pow(v, 0.8));
  thickness = mix(thickness, thickness * 2.2, uBeadK * smooth01_(clamp((v - 0.72) / 0.28, 0.0, 1.0)));
  float fShapeT = fingerShape(uAge, aFingerPhase);
  thickness *= mix(1.0, 0.35, aFingerAmp * fShapeT * smooth01_(clamp((v - 0.5) / 0.5, 0.0, 1.0)));
  vThickness = max(0.002, thickness);

  float foam = smooth01_(clamp((v - 0.62) / 0.38, 0.0, 1.0)) * (0.15 + 0.6 * uBeadK);
  foam += aFingerAmp * fShapeT * 0.4;
  vFoam = clamp(foam, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
}
`;

// Sheet/lamella vertex shader — positions are rebuilt on the CPU each
// frame (cheap: SHEET_THETA*2 verts) since the expand/retract profile is
// a simple scalar radius, not worth an analytic GPU function. `aRad`
// (0=inner edge, 1=outer edge) drives thickness/foam.
const SHEET_VERTEX_SRC = `
attribute float aRad;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vThickness;
varying float vFoam;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vThickness = mix(0.014, 0.003, aRad);
  vFoam = smoothstep(0.78, 1.0, aRad) * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shared fragment shader for crown, micro-crown and sheet meshes — all
// expose the same varyings + the impact-glint / opacity envelope.
const _fragCache = {};
function fragmentSrc(hasGrab) {
  const key = hasGrab ? 1 : 0;
  if (_fragCache[key]) return _fragCache[key];
  const src = `
uniform float uOpacity;
uniform float uGlintK;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vThickness;
varying float vFoam;

${waterGlslChunk(hasGrab)}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (!gl_FrontFacing) N = -N;
  if (dot(N, V) < 0.0) N = -N;

  // Cheap analytic flow-noise normal perturbation so refraction/fresnel
  // shimmer subtly instead of reading as a perfectly smooth membrane.
  float n1 = sin(vWorldPos.x * 6.0 + uTimeW * 2.2) * cos(vWorldPos.z * 5.0 - uTimeW * 1.7);
  float n2 = sin(vWorldPos.y * 8.0 - uTimeW * 3.1 + vWorldPos.x * 3.0);
  N = normalize(N + vec3(n1, 0.0, n2) * 0.05);

  vec2 screenUV = gl_FragCoord.xy / uViewport;
  vec4 shaded = waterShade(N, V, screenUV, vThickness, vFoam);

  shaded.rgb += vec3(1.0, 0.98, 0.9) * uGlintK * 1.3;

  gl_FragColor = vec4(shaded.rgb, clamp(shaded.a * uOpacity, 0.0, 1.0));
}
`;
  _fragCache[key] = src;
  return src;
}

// =========================================================================
// Geometry builders
// =========================================================================
function buildCrownGeometry(cols, rows) {
  const rings = rows + 1;
  const vertCount = cols * rings;
  const position = new Float32Array(vertCount * 3); // (angle, v, 0) per vertex — see CROWN_VERTEX_SRC note
  const aBaseR = new Float32Array(vertCount);
  const aPeakR = new Float32Array(vertCount);
  const aPeakH = new Float32Array(vertCount);
  const aFingerAmp = new Float32Array(vertCount);
  const aFingerPhase = new Float32Array(vertCount);
  const indices = [];

  for (let i = 0; i < cols; i++) {
    const ang = (i / cols) * Math.PI * 2;
    for (let r = 0; r < rings; r++) {
      const v = r / rows;
      const idx = i * rings + r;
      position[idx * 3 + 0] = ang;
      position[idx * 3 + 1] = v;
      position[idx * 3 + 2] = 0;
    }
  }
  for (let i = 0; i < cols; i++) {
    const j = (i + 1) % cols;
    for (let r = 0; r < rows; r++) {
      const a0 = i * rings + r, a1 = i * rings + r + 1;
      const b0 = j * rings + r, b1 = j * rings + r + 1;
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aBaseR', new THREE.BufferAttribute(aBaseR, 1));
  geo.setAttribute('aPeakR', new THREE.BufferAttribute(aPeakR, 1));
  geo.setAttribute('aPeakH', new THREE.BufferAttribute(aPeakH, 1));
  geo.setAttribute('aFingerAmp', new THREE.BufferAttribute(aFingerAmp, 1));
  geo.setAttribute('aFingerPhase', new THREE.BufferAttribute(aFingerPhase, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8); // generous static bound; frustumCulled is off anyway
  return geo;
}

function buildSheetGeometry(thetaSeg) {
  const vertsPerRing = thetaSeg + 1;
  const vertCount = vertsPerRing * 2;
  const position = new Float32Array(vertCount * 3);
  const aRad = new Float32Array(vertCount);
  for (let ring = 0; ring < 2; ring++) {
    for (let t = 0; t <= thetaSeg; t++) {
      const idx = ring * vertsPerRing + t;
      aRad[idx] = ring; // 0 inner, 1 outer — position filled per-frame
    }
  }
  const indices = [];
  for (let t = 0; t < thetaSeg; t++) {
    const i0 = t, i1 = t + 1;
    const o0 = vertsPerRing + t, o1 = vertsPerRing + t + 1;
    indices.push(i0, o0, o1, i0, o1, i1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aRad', new THREE.BufferAttribute(aRad, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);
  return geo;
}

// Rebuild the sheet ring's live positions for the given inner/outer radii,
// with elliptical (oblique-fan) scale + rotation baked directly into x/z.
function writeSheetPositions(geo, thetaSeg, inner, outer, scaleX, scaleZ, cosR, sinR, y) {
  const arr = geo.attributes.position.array;
  const vertsPerRing = thetaSeg + 1;
  for (let ring = 0; ring < 2; ring++) {
    const r = ring === 0 ? inner : outer;
    for (let t = 0; t <= thetaSeg; t++) {
      const idx = ring * vertsPerRing + t;
      const theta = (t / thetaSeg) * Math.PI * 2;
      let x = Math.cos(theta) * r * scaleX;
      let z = Math.sin(theta) * r * scaleZ;
      // rotate the ellipse so its long axis points along spec.dir
      const rx = x * cosR - z * sinR;
      const rz = x * sinR + z * cosR;
      const base = idx * 3;
      arr[base + 0] = rx;
      arr[base + 1] = y;
      arr[base + 2] = rz;
    }
  }
  geo.attributes.position.needsUpdate = true;
}

// =========================================================================
// Finger layout — deterministic from mulberry32(spec.seed)
// =========================================================================
function buildFingers(rng, cols, rimRadiusEstimate, soft) {
  let count = Math.round((2 * Math.PI * Math.max(0.15, rimRadiusEstimate)) / FINGER_WAVELENGTH);
  count = Math.max(FINGER_MIN, Math.min(FINGER_MAX, count));
  const fingers = [];
  for (let k = 0; k < count; k++) {
    const jitter = (rng() - 0.5) * ((Math.PI * 2) / count) * 0.55;
    const angle = (k / count) * Math.PI * 2 + jitter;
    // softness widens the finger kernel (blobbier, less blade-like) and
    // slightly lowers peak amplitude (fewer sharp pinch-offs).
    const amp = (0.55 + rng() * 0.45) * (1 - soft * 0.25);
    const phase = rng();
    const sigma = (1.0 + rng() * 0.7) * (1 + soft * 1.4);
    fingers.push({ angle, amp, phase, sigma, centerCol: 0, fired: false, pinchAge: 0, baseR: 0, peakR: 0, peakH: 0, fingerAmp: 0, fingerPhase: 0 });
  }
  return fingers;
}

function applyFingerToColumns(ampArr, phaseArr, cols, finger) {
  const norm = ((finger.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const centerColF = (norm / (Math.PI * 2)) * cols;
  const centerCol = Math.round(centerColF) % cols;
  finger.centerCol = centerCol;
  const window = Math.min(cols >> 1, Math.ceil(finger.sigma * 3) + 1);
  for (let d = -window; d <= window; d++) {
    const col = ((centerCol + d) % cols + cols) % cols;
    const dist = centerColF - (centerCol + d);
    const g = finger.amp * Math.exp(-(dist * dist) / (2 * finger.sigma * finger.sigma));
    if (g > ampArr[col]) {
      ampArr[col] = g;
      phaseArr[col] = finger.phase;
    }
  }
}

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

// =========================================================================
// SplashFX
// =========================================================================
export class SplashFX {
  constructor(scene, waterCtx) {
    this.scene = scene;
    this.waterCtx = waterCtx || null;
    this._hasGrab = !!(this.waterCtx && this.waterCtx.grabPass);
    this._externalUniforms = (this.waterCtx && this.waterCtx.uniforms) || null;
    this._ownUniforms = null; // built lazily if no external uniforms were supplied
    this._time = 0;

    // scratch column arrays (reused every trigger(), no per-frame alloc)
    this._colBaseR = new Float32Array(CROWN_COLS);
    this._colPeakR = new Float32Array(CROWN_COLS);
    this._colPeakH = new Float32Array(CROWN_COLS);
    this._colFingerAmp = new Float32Array(CROWN_COLS);
    this._colFingerPhase = new Float32Array(CROWN_COLS);

    this.slots = [];
    for (let s = 0; s < MAX_SPLASHES; s++) this.slots.push(this._makeSplashSlot());
    this._nextSlot = 0;

    this.microSlots = [];
    for (let s = 0; s < MICRO_MAX; s++) this.microSlots.push(this._makeMicroSlot());
    this._nextMicro = 0;
  }

  // legacy no-op: droplet emission moved to DropletSystem (R3). Old wiring
  // code may still do `splash.onDropletLand = fn` — tolerate it silently.
  set onDropletLand(_fn) { /* no-op, kept for backward compatibility */ }
  get onDropletLand() { return undefined; }

  // ---------------------------------------------------------- materials
  _sharedWaterUniforms() {
    if (this._externalUniforms) return this._externalUniforms;
    if (!this._ownUniforms) {
      const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      dummyTex.needsUpdate = true;
      this._ownUniforms = {
        uSceneTex: { value: dummyTex },
        uViewport: { value: new THREE.Vector2(1600, 900) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.82, 0.35).normalize() },
        uWaterAbsorb: { value: new THREE.Vector3(0.35, 0.09, 0.04) },
        uTimeW: { value: 0 },
      };
    }
    return this._ownUniforms;
  }

  _makeCrownMaterial() {
    const shared = this._sharedWaterUniforms();
    const uniforms = {
      uSceneTex: shared.uSceneTex,
      uViewport: shared.uViewport,
      uSunDir: shared.uSunDir,
      uWaterAbsorb: shared.uWaterAbsorb,
      uTimeW: shared.uTimeW,
      uAge: { value: 0 },
      uFlareEnd: { value: 1 },
      uFingerGrowDur: { value: 1 },
      uFingerPhaseSpread: { value: 0 },
      uFingerRetractDur: { value: 1 },
      uFingerLen: { value: 0 },
      uBeadBulge: { value: 0 },
      uHeightK: { value: 0 },
      uRadiusK: { value: 0 },
      uBeadK: { value: 0 },
      uOpacity: { value: 0 },
      uGlintK: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: CROWN_VERTEX_SRC,
      fragmentShader: fragmentSrc(this._hasGrab),
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return mat;
  }

  _makeSheetMaterial() {
    const shared = this._sharedWaterUniforms();
    const uniforms = {
      uSceneTex: shared.uSceneTex,
      uViewport: shared.uViewport,
      uSunDir: shared.uSunDir,
      uWaterAbsorb: shared.uWaterAbsorb,
      uTimeW: shared.uTimeW,
      uOpacity: { value: 0 },
      uGlintK: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHEET_VERTEX_SRC,
      fragmentShader: fragmentSrc(this._hasGrab),
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return mat;
  }

  // ------------------------------------------------------------- pool
  _makeSplashSlot() {
    const crownGeo = buildCrownGeometry(CROWN_COLS, CROWN_ROWS);
    const crownMat = this._makeCrownMaterial();
    const crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.visible = false;
    crownMesh.frustumCulled = false;
    crownMesh.layers.set(WATER_LAYER);
    this.scene.add(crownMesh);

    const sheetGeo = buildSheetGeometry(SHEET_THETA);
    const sheetMat = this._makeSheetMaterial();
    const sheetMesh = new THREE.Mesh(sheetGeo, sheetMat);
    sheetMesh.visible = false;
    sheetMesh.frustumCulled = false;
    sheetMesh.layers.set(WATER_LAYER);
    this.scene.add(sheetMesh);

    return {
      active: false, age: 0, spec: null, life: 1, phases: null,
      crownMesh, crownGeo, crownMat, crownU: crownMat.uniforms,
      sheetMesh, sheetGeo, sheetMat, sheetU: sheetMat.uniforms,
      sheetLife: 1, sheetBaseRadius: 1, sheetScaleX: 1, sheetScaleZ: 1, sheetCosR: 1, sheetSinR: 0, sheetY: 0.03,
      fingers: [], fingersFiredCount: 0, sprayBurst2Fired: false,
      beadBulge: 0, fingerLen: 0,
    };
  }

  _makeMicroSlot() {
    const crownGeo = buildCrownGeometry(MICRO_COLS, MICRO_ROWS);
    const crownMat = this._makeCrownMaterial();
    const crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.visible = false;
    crownMesh.frustumCulled = false;
    crownMesh.layers.set(WATER_LAYER);
    this.scene.add(crownMesh);
    return { active: false, age: 0, life: 0.4, phases: null, crownMesh, crownGeo, crownMat, crownU: crownMat.uniforms };
  }

  // -------------------------------------------------------------- trigger
  trigger(spec) {
    const slot = this.slots[this._nextSlot];
    this._nextSlot = (this._nextSlot + 1) % this.slots.length;
    this._activate(slot, spec);
  }

  _activate(slot, spec) {
    const rng = mulberry32(spec.seed >>> 0);
    const energy = spec.energy;
    const flat = spec.flatness;
    const soft = (spec.def && spec.def.softness) || 0;
    const oblique = spec.oblique || 0;
    const obliqueAmt = oblique > 0.3 ? (oblique - 0.3) / 0.7 : 0;
    const dirX = spec.dir ? spec.dir.x : 0;
    const dirZ = spec.dir ? spec.dir.y : 0;

    // Containment: never let the splash visually spill onto the dry deck.
    const distFromCenter = Math.hypot(spec.point.x, spec.point.z);
    const room = POOL.WATER_RADIUS - distFromCenter;
    const cap = Math.max(1.1, room * 0.95);

    // ---- causality: energy -> scale, flatness -> wide/low vs tall/narrow ----
    const baseHeight = 0.35 + energy * 1.55 * (1 - flat * 0.6);
    const baseWidth = spec.size * 0.9 + energy * (0.55 + flat * 1.15) + soft * 0.15;
    const baseR0 = Math.max(0.04, spec.size * 0.28 + soft * 0.02);
    let fingerLen = (0.14 + energy * 0.34) * (1 - soft * 0.3);
    let beadBulge = 0.05 + energy * 0.07 + soft * 0.03;

    const cols = CROWN_COLS;
    const colBaseR = this._colBaseR, colPeakR = this._colPeakR, colPeakH = this._colPeakH;
    const colFingerAmp = this._colFingerAmp, colFingerPhase = this._colFingerPhase;
    colFingerAmp.fill(0);
    colFingerPhase.fill(0);

    for (let i = 0; i < cols; i++) {
      const ang = (i / cols) * Math.PI * 2;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      let dirWeight = 1;
      if (obliqueAmt > 0) {
        const dot = cx * dirX + cz * dirZ; // one-sided fan skew toward spec.dir
        dirWeight = Math.max(0.15, 1 + obliqueAmt * (dot * 1.4));
      }
      const rJit = 0.85 + rng() * 0.3;
      const hJit = 0.85 + rng() * 0.3;
      colBaseR[i] = baseR0 * (0.9 + rng() * 0.2);
      colPeakR[i] = baseWidth * rJit * (0.7 + 0.3 * dirWeight);
      colPeakH[i] = baseHeight * hJit * dirWeight;
    }
    // Smooth the OVERALL silhouette into soft organic lobes (not the
    // fingers, which stay sharp/localized — added on top below).
    smoothCircular(colPeakR, 2);
    smoothCircular(colPeakH, 2);

    // ---- fingers: count from seed, spacing ~capillary-scaled ----
    const fingers = buildFingers(rng, cols, baseWidth, soft);
    for (let k = 0; k < fingers.length; k++) applyFingerToColumns(colFingerAmp, colFingerPhase, cols, fingers[k]);

    // ---- containment cap: scale the "growth beyond baseR" uniformly ----
    let maxProjected = 0;
    for (let i = 0; i < cols; i++) {
      const proj = colBaseR[i] + (colPeakR[i] - colBaseR[i]) * 1.06 + beadBulge + colFingerAmp[i] * fingerLen;
      if (proj > maxProjected) maxProjected = proj;
    }
    if (maxProjected > cap && maxProjected > 1e-4) {
      const scale = cap / maxProjected;
      for (let i = 0; i < cols; i++) colPeakR[i] = colBaseR[i] + (colPeakR[i] - colBaseR[i]) * scale;
      beadBulge *= scale;
      fingerLen *= scale;
    }

    // write per-column values into the geometry (broadcast across rings)
    const geo = slot.crownGeo;
    const rings = CROWN_ROWS + 1;
    const aBaseR = geo.attributes.aBaseR.array;
    const aPeakR = geo.attributes.aPeakR.array;
    const aPeakH = geo.attributes.aPeakH.array;
    const aFingerAmp = geo.attributes.aFingerAmp.array;
    const aFingerPhase = geo.attributes.aFingerPhase.array;
    for (let i = 0; i < cols; i++) {
      const base = i * rings;
      for (let r = 0; r < rings; r++) {
        const idx = base + r;
        aBaseR[idx] = colBaseR[i];
        aPeakR[idx] = colPeakR[i];
        aPeakH[idx] = colPeakH[i];
        aFingerAmp[idx] = colFingerAmp[i];
        aFingerPhase[idx] = colFingerPhase[i];
      }
      // store the column's values on each finger so evalCrownTip() can be
      // computed on the CPU purely from the finger object at pinch time.
    }
    geo.attributes.aBaseR.needsUpdate = true;
    geo.attributes.aPeakR.needsUpdate = true;
    geo.attributes.aPeakH.needsUpdate = true;
    geo.attributes.aFingerAmp.needsUpdate = true;
    geo.attributes.aFingerPhase.needsUpdate = true;

    for (let k = 0; k < fingers.length; k++) {
      const f = fingers[k];
      f.baseR = colBaseR[f.centerCol];
      f.peakR = colPeakR[f.centerCol];
      f.peakH = colPeakH[f.centerCol];
      f.fingerAmp = colFingerAmp[f.centerCol];
      f.fingerPhase = colFingerPhase[f.centerCol];
      f.fired = false;
    }

    const life = 0.9 + energy * 0.4 + soft * 0.05; // 0.9-1.35s scaled, per contract
    const phases = computePhases(life);
    for (let k = 0; k < fingers.length; k++) fingers[k].pinchAge = fingerPinchAge(fingers[k].phase, phases);

    slot.active = true;
    slot.age = 0;
    slot.spec = spec;
    slot.life = life;
    slot.phases = phases;
    slot.fingers = fingers;
    slot.fingersFiredCount = 0;
    slot.sprayBurst2Fired = false;
    slot.beadBulge = beadBulge;
    slot.fingerLen = fingerLen;

    slot.crownMesh.position.set(spec.point.x, 0, spec.point.z);
    slot.crownMesh.visible = true;
    const cu = slot.crownU;
    cu.uAge.value = 0;
    cu.uFlareEnd.value = phases.flareEnd;
    cu.uFingerGrowDur.value = phases.fingerGrowDur;
    cu.uFingerPhaseSpread.value = phases.fingerPhaseSpread;
    cu.uFingerRetractDur.value = phases.fingerRetractDur;
    cu.uFingerLen.value = fingerLen;
    cu.uBeadBulge.value = beadBulge;
    cu.uHeightK.value = 0;
    cu.uRadiusK.value = 0;
    cu.uBeadK.value = 0;
    cu.uOpacity.value = 0;
    cu.uGlintK.value = 1;

    // ---- sheet/lamella: flatness -> bigger, containment cap preserved ----
    slot.sheetBaseRadius = Math.min(2.6, cap, 0.15 + spec.size + energy * (0.5 + flat * 1.6));
    slot.sheetScaleX = 1 + obliqueAmt * 0.9;
    slot.sheetScaleZ = 1 - obliqueAmt * 0.35;
    const dirAngle = (spec.dir && (spec.dir.x !== 0 || spec.dir.y !== 0)) ? Math.atan2(spec.dir.y, spec.dir.x) : 0;
    slot.sheetCosR = Math.cos(dirAngle);
    slot.sheetSinR = Math.sin(dirAngle);
    slot.sheetLife = life * 0.55;
    slot.sheetMesh.position.set(spec.point.x, 0.02, spec.point.z);
    slot.sheetMesh.visible = true;
    const su = slot.sheetU;
    su.uOpacity.value = 0;
    su.uGlintK.value = 1;
    writeSheetPositions(slot.sheetGeo, SHEET_THETA, 0.02, 0.08, slot.sheetScaleX, slot.sheetScaleZ, slot.sheetCosR, slot.sheetSinR, 0);

    // ---- spray at impact: flat impacts -> more, lower cone ----
    if (this.waterCtx && this.waterCtx.droplets) {
      const sprayRng = mulberry32((spec.seed ^ 0x51ed270b) >>> 0);
      this.waterCtx.droplets.emitSpray({
        origin: spec.point.clone(),
        dir: new THREE.Vector3(0, 1 - flat * 0.45, 0).normalize(),
        count: Math.round((30 + energy * 75) * (1 + flat * 0.55)),
        speed: [1.4 + energy * 2.6, 3.2 + energy * 6.5],
        spread: 0.35 + flat * 0.5,
        life: [0.22, 0.6],
        rng: sprayRng,
      });
    }
  }

  // ---------------------------------------------------------- microSplash
  microSplash(x, z, size) {
    const slot = this.microSlots[this._nextMicro];
    this._nextMicro = (this._nextMicro + 1) % this.microSlots.length;

    const sz = Math.min(0.12, Math.max(0.05, size || 0.07));
    const life = 0.3 + sz * 1.0;
    const phases = computePhases(life);
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.phases = phases;

    const cols = MICRO_COLS, rows = MICRO_ROWS, rings = rows + 1;
    const geo = slot.crownGeo;
    const aBaseR = geo.attributes.aBaseR.array;
    const aPeakR = geo.attributes.aPeakR.array;
    const aPeakH = geo.attributes.aPeakH.array;
    const aFingerAmp = geo.attributes.aFingerAmp.array;
    const aFingerPhase = geo.attributes.aFingerPhase.array;
    const baseR0 = sz * 0.35;
    const peakR0 = sz * 1.5;
    const peakH0 = sz * 2.0;
    for (let i = 0; i < cols; i++) {
      const base = i * rings;
      for (let r = 0; r < rings; r++) {
        const idx = base + r;
        aBaseR[idx] = baseR0;
        aPeakR[idx] = peakR0;
        aPeakH[idx] = peakH0;
        aFingerAmp[idx] = 0;
        aFingerPhase[idx] = 0;
      }
    }
    geo.attributes.aBaseR.needsUpdate = true;
    geo.attributes.aPeakR.needsUpdate = true;
    geo.attributes.aPeakH.needsUpdate = true;
    geo.attributes.aFingerAmp.needsUpdate = true;
    geo.attributes.aFingerPhase.needsUpdate = true;

    slot.crownMesh.position.set(x, 0, z);
    slot.crownMesh.visible = true;
    const cu = slot.crownU;
    cu.uAge.value = 0;
    cu.uFlareEnd.value = phases.flareEnd;
    cu.uFingerGrowDur.value = phases.fingerGrowDur;
    cu.uFingerPhaseSpread.value = phases.fingerPhaseSpread;
    cu.uFingerRetractDur.value = phases.fingerRetractDur;
    cu.uFingerLen.value = 0;
    cu.uBeadBulge.value = sz * 0.2;
    cu.uHeightK.value = 0;
    cu.uRadiusK.value = 0;
    cu.uBeadK.value = 0;
    cu.uOpacity.value = 0;
    cu.uGlintK.value = 0.6;
  }

  // -------------------------------------------------------------- update
  update(dt, time) {
    this._time = time;
    if (this._ownUniforms) this._ownUniforms.uTimeW.value = time;

    for (let s = 0; s < this.slots.length; s++) this._updateSplashSlot(this.slots[s], dt);
    for (let s = 0; s < this.microSlots.length; s++) this._updateMicroSlot(this.microSlots[s], dt);
  }

  _updateSplashSlot(slot, dt) {
    if (!slot.active) return;
    slot.age += dt;
    const ph = slot.phases;
    const spec = slot.spec;

    // ---- crown ----
    let crownDone = slot.age >= slot.life;
    if (!crownDone) {
      const heightK = heightKFn(slot.age, ph);
      const radiusK = radiusKFn(slot.age, ph);
      const beadK = beadKFn(slot.age, ph);
      const alphaK = alphaKFn(slot.age, ph);
      const glintK = glintKFn(slot.age);
      const cu = slot.crownU;
      cu.uAge.value = slot.age;
      cu.uHeightK.value = heightK;
      cu.uRadiusK.value = radiusK;
      cu.uBeadK.value = beadK;
      cu.uOpacity.value = alphaK * 0.92;
      cu.uGlintK.value = glintK;
    } else if (slot.crownMesh.visible) {
      slot.crownMesh.visible = false;
    }

    // ---- sheet/lamella (retracting rim after peak) ----
    let sheetDone = slot.age >= slot.sheetLife;
    if (!sheetDone) {
      const t = slot.age / slot.sheetLife;
      const rFrac = sheetRadiusFrac(t);
      const outer = slot.sheetBaseRadius * rFrac;
      const inner = Math.max(0.015, outer * 0.42);
      writeSheetPositions(slot.sheetGeo, SHEET_THETA, inner, outer, slot.sheetScaleX, slot.sheetScaleZ, slot.sheetCosR, slot.sheetSinR, 0);
      const alpha = sheetAlphaFrac(t);
      const su = slot.sheetU;
      su.uOpacity.value = alpha * 0.5;
      su.uGlintK.value = glintKFn(slot.age);
    } else if (slot.sheetMesh.visible) {
      slot.sheetMesh.visible = false;
    }

    // ---- fingers: pinch-off -> droplet emit, continuing the tip's motion ----
    const fingers = slot.fingers;
    for (let k = 0; k < fingers.length; k++) {
      const f = fingers[k];
      if (f.fired || slot.age < f.pinchAge) continue;
      f.fired = true;
      slot.fingersFiredCount++;
      this._emitFingerDroplet(slot, spec, f, ph);
    }

    // ---- second, smaller spray burst at finger-breakup onset ----
    if (!slot.sprayBurst2Fired && slot.age >= ph.flareEnd && this.waterCtx && this.waterCtx.droplets) {
      slot.sprayBurst2Fired = true;
      const flat = spec.flatness, energy = spec.energy;
      const sprayRng = mulberry32((spec.seed ^ 0x2545f491) >>> 0);
      this.waterCtx.droplets.emitSpray({
        origin: new THREE.Vector3(spec.point.x, 0.05, spec.point.z),
        dir: new THREE.Vector3(0, 1 - flat * 0.3, 0).normalize(),
        count: Math.round(14 + energy * 26),
        speed: [1.2 + energy * 2, 2.6 + energy * 4.5],
        spread: 0.45 + flat * 0.4,
        life: [0.18, 0.42],
        rng: sprayRng,
      });
    }

    if (crownDone && sheetDone && slot.fingersFiredCount >= fingers.length) {
      slot.active = false;
      slot.spec = null;
    }
  }

  _emitFingerDroplet(slot, spec, finger, ph) {
    if (!this.waterCtx || !this.waterCtx.droplets) return;
    const glob = { beadBulge: slot.beadBulge, fingerLen: slot.fingerLen };
    const col = finger;
    const EPS = 0.025;
    const p1 = evalCrownTip(finger.pinchAge, ph, col, glob);
    const p0 = evalCrownTip(Math.max(0, finger.pinchAge - EPS), ph, col, glob);
    const radialSpeed = (p1.r - p0.r) / EPS;
    const vertSpeed = (p1.h - p0.h) / EPS;
    const cx = Math.cos(finger.angle), cz = Math.sin(finger.angle);

    const origin = new THREE.Vector3(spec.point.x + cx * p1.r, p1.h, spec.point.z + cz * p1.r);
    const dir = new THREE.Vector3(cx * radialSpeed, Math.max(0.4, vertSpeed), cz * radialSpeed);
    const speedLen = Math.max(0.3, dir.length());
    dir.normalize();

    const soft = (spec.def && spec.def.softness) || 0;
    const rng = mulberry32((spec.seed + slot.fingersFiredCount) >>> 0);
    this.waterCtx.droplets.emit({
      origin,
      dir,
      count: rng() < 0.35 ? 2 : 1,
      speed: [speedLen * 0.65, speedLen * 1.2 + 0.5],
      size: [0.028 + soft * 0.015, 0.06 + spec.energy * 0.03 + soft * 0.02],
      spread: 0.12 + soft * 0.15,
      rng,
      gravityScale: 1,
      stretch: 1.1 + Math.min(1.0, speedLen * 0.08),
    });
  }

  _updateMicroSlot(slot, dt) {
    if (!slot.active) return;
    slot.age += dt;
    if (slot.age >= slot.life) {
      slot.active = false;
      slot.crownMesh.visible = false;
      return;
    }
    const ph = slot.phases;
    const cu = slot.crownU;
    cu.uAge.value = slot.age;
    cu.uHeightK.value = heightKFn(slot.age, ph);
    cu.uRadiusK.value = radiusKFn(slot.age, ph);
    cu.uBeadK.value = beadKFn(slot.age, ph);
    cu.uOpacity.value = alphaKFn(slot.age, ph) * 0.85;
    cu.uGlintK.value = glintKFn(slot.age) * 0.6;
  }

  // -------------------------------------------------------------- state
  isActive() {
    for (let s = 0; s < this.slots.length; s++) if (this.slots[s].active) return true;
    for (let s = 0; s < this.microSlots.length; s++) if (this.microSlots[s].active) return true;
    return false;
  }
}
