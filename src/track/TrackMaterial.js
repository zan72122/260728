// AQUA VELOCITY — A2 TRACK
// src/track/TrackMaterial.js
//
// Procedural PBR materials for the chute (FRP/fibreglass, clearcoat, region
// colour blend) and the structural shell/supports (matte white/grey).
// No external images: every map is a hand-built THREE.DataTexture driven by
// a small dependency-free value-noise function, so this module also works
// headlessly (no `document`/canvas needed) for testing.

import * as THREE from 'three';
import { SECTION_BOUNDS_01 } from './TrackDesign.js';

/* ------------------------------------------------------------------ *
 *  Tiny dependency-free 2D value noise (deterministic, seeded)
 * ------------------------------------------------------------------ */

function hash2(x, y, seed) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise2D(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2D(x, y, octaves, seed) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 17.13) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makeDataTexture(size, genPixel) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = genPixel(x, y);
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Neutral FRP (fibreglass) detail maps: subtle orange-peel micro bumps,
 * faint vertical panel stripes, mid-low roughness. Kept colour-neutral
 * (near white) so the chute material can multiply in a region tint and the
 * shell material can use it as-is for a matte grey/white look.
 */
function buildFRPDetailMaps(seed, size = 512) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      heights[y * size + x] = fbm2D(nx * 18, ny * 18, 4, seed);
    }
  }

  const map = makeDataTexture(size, (x, y) => {
    const idx = y * size + x;
    const nx = x / size;
    const stripe = Math.sin(nx * Math.PI * 2 * 30) * 0.03;
    const peel = (heights[idx] - 0.5) * 0.10;
    const shade = THREE.MathUtils.clamp(0.90 + stripe + peel, 0, 1);
    const v = clamp255(shade * 255);
    return [v, v, v, 255];
  });
  map.colorSpace = THREE.SRGBColorSpace;

  const roughnessMap = makeDataTexture(size, (x, y) => {
    const nx = x / size, ny = y / size;
    const rough = 0.15 + fbm2D(nx * 10 + 40, ny * 10 + 40, 3, seed + 11) * 0.15; // 0.15..0.30
    const v = clamp255(rough * 255);
    return [v, v, v, 255];
  });

  const strength = 1.6;
  const normalMap = makeDataTexture(size, (x, y) => {
    const x0 = (x - 1 + size) % size, x1 = (x + 1) % size;
    const y0 = (y - 1 + size) % size, y1 = (y + 1) % size;
    const hl = heights[y * size + x0], hr = heights[y * size + x1];
    const hd = heights[y0 * size + x], hu = heights[y1 * size + x];
    let nxv = (hl - hr) * strength;
    let nyv = (hd - hu) * strength;
    let nzv = 1.0;
    const len = Math.hypot(nxv, nyv, nzv);
    nxv /= len; nyv /= len; nzv /= len;
    return [
      clamp255((nxv * 0.5 + 0.5) * 255),
      clamp255((nyv * 0.5 + 0.5) * 255),
      clamp255((nzv * 0.5 + 0.5) * 255),
      255,
    ];
  });

  return { map, normalMap, roughnessMap };
}

/* ------------------------------------------------------------------ *
 *  Region colour gradient (A launch -> B helix -> C tunnel -> D bowl
 *  -> E/F last stretch), derived from TrackDesign's own section ranges so
 *  it always lines up with the real course regardless of edits there.
 * ------------------------------------------------------------------ */

const SECTION_COLOR = {
  A: 0x1c6fe0, // launch — vivid blue
  B: 0x18b6ae, // helix — turquoise
  C: 0x0a1a42, // tunnel — deep navy
  D: 0x22c3d6, // bowl / wave — bright aqua
  E: 0xd8edf1, // airtime — pale, transitioning to white
  F: 0xf6fafc, // last drop — white
};

function deriveColorStops() {
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  const blend = 0.018; // fraction of course length used to soften each seam
  const stops = [{ t: 0, color: new THREE.Color(SECTION_COLOR.A) }];
  for (const key of order) {
    const [s0, s1] = SECTION_BOUNDS_01[key];
    const color = new THREE.Color(SECTION_COLOR[key]);
    stops.push({ t: THREE.MathUtils.clamp(s0 + blend, 0, 1), color });
    stops.push({ t: THREE.MathUtils.clamp(s1 - blend, 0, 1), color });
  }
  stops.push({ t: 1, color: new THREE.Color(SECTION_COLOR.F) });
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].t < stops[i - 1].t) stops[i].t = stops[i - 1].t;
  }
  return stops;
}

/**
 * The chute's PBR material: FRP fibreglass look (fine orange-peel normal
 * detail, faint panel stripes, roughness 0.15-0.30, clearcoat 0.8) with the
 * region colour blended in via onBeforeCompile, keyed off the chute
 * geometry's own v = s/2 UV (no extra attributes required).
 *
 * @param {{length:number}} track - a constructed SplineTrack (only `length` is read)
 */
export function createChuteMaterial(track) {
  const { map, normalMap, roughnessMap } = buildFRPDetailMaps(3);

  // V4 washout fix: clearcoat 0.8 + envMapIntensity 1.1 mirrored the very
  // bright summer sky across the entire interior, drowning the per-section
  // colour blend below in a white sheen (confirmed in live screenshots —
  // the turquoise helix read as plain white). Softer coat + reduced IBL
  // keeps the wet-FRP look while letting the region tint actually show.
  const material = new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    roughnessMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });

  const stops = deriveColorStops();
  const stopColors = stops.map((s) => s.color);
  const stopT = stops.map((s) => s.t);
  const n = stops.length;
  const trackLength = Math.max(1, track?.length || 1);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrackLength = { value: trackLength };
    shader.uniforms.uStopColors = { value: stopColors };
    shader.uniforms.uStopT = { value: stopT };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uTrackLength;
      uniform vec3 uStopColors[${n}];
      uniform float uStopT[${n}];`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float s01 = clamp((vMapUv.y * 2.0) / uTrackLength, 0.0, 1.0);
        vec3 regionTint = uStopColors[0];
        for (int i = 1; i < ${n}; i++) {
          regionTint = mix(regionTint, uStopColors[i], smoothstep(uStopT[i - 1], uStopT[i], s01));
        }
        diffuseColor.rgb *= regionTint;
      }`
    );

    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `aquaChute_${n}`;

  return material;
}

/**
 * Structural material for the shell (chute underside) and the support
 * towers: a slightly matte off-white/grey FRP-and-steel look, no region
 * tinting.
 */
export function createShellMaterial() {
  const { map, normalMap, roughnessMap } = buildFRPDetailMaps(7);

  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: 0xd6dade,
    roughness: 1.0,
    metalness: 0.08,
    envMapIntensity: 0.85,
    side: THREE.DoubleSide,
  });
}
