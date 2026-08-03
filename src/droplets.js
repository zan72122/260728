// src/droplets.js — R3 (chunky refractive droplets + fine spray mist)
// See docs/CONTRACTS-SPLASH2.md, section "src/droplets.js — R3", and the
// shared watershading contract in that same file.
//
// Two pooled InstancedMeshes, both SoA (struct-of-arrays) typed buffers with
// an O(active) per-frame update. No per-frame allocations, no per-instance
// Matrix4/Quaternion composition — position/radius/velocity/etc. are written
// straight into InstancedBufferAttributes; the vertex shader builds a
// camera-facing billboard directly in view space (the classic
// `modelViewMatrix * center` then offset .xy in view space trick), which is
// automatically camera-correct every frame with zero JS-side matrix math.
//
//   - this.dropletMesh: chunky droplets. Fragment shader reconstructs a
//     sphere impostor from the quad's local UV, discards outside the circle,
//     then shades with the shared WATER_GLSL waterShade() for refraction +
//     fresnel + sun glint. Lives on WATER_LAYER (drawn in the grab/refractive
//     pass). Prolate-stretched along each droplet's velocity (projected to
//     view space) so fast droplets read as motion-stretched, not round beads.
//   - this.sprayMesh: fine atomized mist. Soft round alpha-blended
//     billboards (canvas radial-gradient texture) with a light-wrap
//     brightness term vs uSunDir. NOT on WATER_LAYER — normal alpha
//     blending, no refraction. This is what supplies the believable white of
//     atomized water that the chunky droplets alone can't sell.
//
// Determinism: emit() takes opts.rng (a caller-supplied deterministic PRNG,
// e.g. mulberry32(spec.seed)) and NEVER calls Math.random — required so the
// same ImpactSpec seed reproduces the same droplet layout. emitSpray() is
// explicitly allowed to use Math.random for micro variation per the v1
// contract (fine spray sparkle doesn't need to be reproducible).

import * as THREE from 'three';
import { G } from './constants.js';

// ---------------------------------------------------------------------
// Pick up the real water shading module. It may not exist yet while R1 is
// still writing it in parallel — degrade to a small built-in fallback
// (fresnel + fake sky reflection + specular glint, alpha-blended, refracts
// only if a grab texture is actually supplied) so this file — and its
// standalone dev/droplets-test page — work correctly either way. Once
// src/watershading.js exists this resolves to the real thing automatically;
// nothing here needs to change.
// ---------------------------------------------------------------------
let WS = null;
try {
  WS = await import('./watershading.js');
} catch (err) {
  WS = null;
}

const WATER_LAYER_IDX = (WS && typeof WS.WATER_LAYER === 'number') ? WS.WATER_LAYER : 1;

// Resolve the shared fragment-shader GLSL chunk regardless of exactly which
// shape R1's module ends up exporting (a `common` string constant, or a
// `waterGlslCommon(hasGrab)` factory function — the addendum contract
// mentions both phrasings) — fall back to our own minimal implementation of
// the same function signatures if the module isn't there yet.
function getShadingCommon(hasGrab) {
  if (WS) {
    if (typeof WS.waterGlslCommon === 'function') return WS.waterGlslCommon(hasGrab);
    if (WS.WATER_GLSL) {
      if (typeof WS.WATER_GLSL === 'function') return WS.WATER_GLSL(hasGrab);
      if (typeof WS.WATER_GLSL.common === 'function') return WS.WATER_GLSL.common(hasGrab);
      if (typeof WS.WATER_GLSL.common === 'string') return WS.WATER_GLSL.common;
    }
  }
  return fallbackGlslCommon(hasGrab);
}

// Minimal stand-in for WATER_GLSL.common, implementing the same declared
// function surface (fresnelSchlick, skyEnvColor, sunGlint, refractSample,
// absorb, waterShade) so droplets.js works standalone before watershading.js
// exists, and degrades sanely on WebGL1 (hasGrab=false, no texture reads).
function fallbackGlslCommon(hasGrab) {
  return `
  uniform sampler2D uSceneTex;
  uniform vec2 uViewport;
  uniform vec3 uSunDir;
  uniform vec3 uWaterAbsorb;
  uniform float uTimeW;

  float fresnelSchlick(float cosTheta, float F0) {
    float m = clamp(1.0 - cosTheta, 0.0, 1.0);
    float m2 = m * m;
    return F0 + (1.0 - F0) * (m2 * m2 * m);
  }

  vec3 skyEnvColor(vec3 dirW) {
    vec3 d = normalize(dirW);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 horizon = vec3(0.78, 0.90, 0.97);
    vec3 zenith = vec3(0.22, 0.55, 0.95);
    vec3 sky = mix(horizon, zenith, pow(h, 0.55));
    float sunAmt = pow(max(0.0, dot(d, normalize(uSunDir))), 90.0);
    return sky + vec3(1.0, 0.96, 0.82) * sunAmt * 2.2;
  }

  float sunGlint(vec3 normalW, vec3 viewDirW) {
    vec3 h = normalize(normalize(uSunDir) + viewDirW);
    float ndoth = max(0.0, dot(normalW, h));
    return pow(ndoth, 260.0) * 5.0;
  }

  vec3 refractSample(vec2 screenUV, vec3 normalHint, float thickness) {
    ${hasGrab ? `
    vec2 offs = normalHint.xy * (0.004 + thickness * 0.02);
    vec2 uv = clamp(screenUV + offs, vec2(0.001), vec2(0.999));
    return texture2D(uSceneTex, uv).rgb;
    ` : `
    return skyEnvColor(vec3(normalHint.xy, 0.6));
    `}
  }

  vec3 absorb(vec3 refracted, float thickness) {
    return refracted * exp(-uWaterAbsorb * thickness);
  }

  vec4 waterShade(vec3 normalW, vec3 viewDirW, vec2 screenUV, float thickness, float foam) {
    float cosTheta = clamp(dot(normalW, viewDirW), 0.0, 1.0);
    float fres = fresnelSchlick(cosTheta, 0.02);
    vec3 refr = refractSample(screenUV, normalW, thickness);
    vec3 body = absorb(refr, thickness);
    vec3 sky = skyEnvColor(reflect(-viewDirW, normalW));
    vec3 col = mix(body, sky, clamp(fres, 0.0, 0.9));
    col += sunGlint(normalW, viewDirW) * (1.0 - foam * 0.5);
    col = mix(col, vec3(1.0), foam);
    float alpha = mix(0.26, 0.92, clamp(thickness * 4.0 + fres * 0.5, 0.0, 1.0));
    return vec4(col, alpha);
  }
  `;
}

// ---------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------
const DROPLET_CAP = 4096;
const SPRAY_CAP = 2048;
const DRAG_K_DROPLET = 0.045;   // mild quadratic drag on chunky droplets
const DRAG_K_SPRAY = 1.35;      // strong quadratic drag on fine mist
const MAX_DROPLET_LIFE = 8.0;   // safety net (droplets normally die on landing)
const STRETCH_K = 0.11;         // global speed -> screen-space elongation scale
const SPRAY_RENDER_SCALE = 2.6; // spray visually scaled up for readability

// ---------------------------------------------------------------------
// Small math helpers (no allocations)
// ---------------------------------------------------------------------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(edge0, edge1, x) {
  const t = clamp01(edge1 > edge0 ? (x - edge0) / (edge1 - edge0) : 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------
// Canvas texture for the spray billboards (soft round alpha falloff),
// generated once and shared by every instance.
// ---------------------------------------------------------------------
function makeSprayTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// A single shared unit quad (-1..1) used (instanced) by both meshes.
function buildQuadGeometry() {
  const geo = new THREE.BufferGeometry();
  const corner = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ]);
  geo.setAttribute('corner', new THREE.BufferAttribute(corner, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  // Instances move around freely; per-instance bounds aren't tracked, so
  // frustum culling against the base (tiny, origin-centered) geometry would
  // incorrectly cull the whole mesh. Both consumers disable it instead.
  return geo;
}

export class DropletSystem {
  constructor(scene, waterCtx) {
    this.scene = scene;
    this.waterCtx = waterCtx || {};
    this.onDropletLand = null;

    this._sharedUniforms = this._resolveSharedUniforms();
    // GrabPass may be null outright (contract) or a real instance whose
    // `.supported` flag is false (actual R1 implementation always
    // constructs one and lets `.supported` reflect WebGL2 capability) —
    // honor either shape so the NO_GRAB GLSL path is picked correctly.
    const gp = this.waterCtx.grabPass;
    const hasGrab = !!(gp && gp.supported !== false);

    this._buildDropletPool();
    this._buildDropletMesh(hasGrab);
    this._buildSprayPool();
    this._buildSprayMesh();

    // reusable scratch (emit()/emitSpray() are called rarely — on splash
    // triggers — not per frame, but we still avoid needless per-call churn)
    this._sDir = new THREE.Vector3();
    this._sUp = new THREE.Vector3();
    this._sTangent = new THREE.Vector3();
    this._sBitangent = new THREE.Vector3();
    this._sVel = new THREE.Vector3();
  }

  // -------------------------------------------------------------- shared uniforms
  _resolveSharedUniforms() {
    const u = this.waterCtx.uniforms || {};
    return {
      uSceneTex: u.uSceneTex || { value: null },
      uViewport: u.uViewport || { value: new THREE.Vector2(1, 1) },
      uSunDir: u.uSunDir || { value: new THREE.Vector3(0.4, 0.82, 0.3).normalize() },
      uWaterAbsorb: u.uWaterAbsorb || { value: new THREE.Vector3(0.35, 0.12, 0.08) },
      uTimeW: u.uTimeW || { value: 0 },
    };
  }

  // ================================================================
  // Chunky droplets
  // ================================================================
  _buildDropletPool() {
    const cap = DROPLET_CAP;
    this.dCap = cap;
    this.dActive = new Uint8Array(cap);
    this.dPos = new Float32Array(cap * 3);
    this.dVel = new Float32Array(cap * 3);
    this.dSize = new Float32Array(cap);
    this.dAge = new Float32Array(cap);
    this.dGrav = new Float32Array(cap);
    this.dElong = new Float32Array(cap);
    this.dSeed = new Float32Array(cap);
    this.dGlint = new Float32Array(cap);
    this.dCursor = 0;
    this.dCount = 0;
  }

  _allocDroplet() {
    const idx = this.dCursor;
    this.dCursor = (this.dCursor + 1) % this.dCap;
    if (!this.dActive[idx]) this.dCount++;
    this.dActive[idx] = 1;
    return idx;
  }

  _buildDropletMesh(hasGrab) {
    const geo = buildQuadGeometry();
    const cap = DROPLET_CAP;
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iRadius', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iGlint', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('iElong', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));

    const common = getShadingCommon(hasGrab);
    const uniforms = Object.assign({}, this._sharedUniforms, {
      uStretchK: { value: STRETCH_K },
    });

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      vertexShader: `
        attribute vec3 corner;
        attribute vec3 iOffset;
        attribute float iRadius;
        attribute vec3 iVel;
        attribute float iGlint;
        attribute float iSeed;
        attribute float iElong;

        uniform float uStretchK;

        varying vec2 vLocal;
        varying vec3 vCenterW;
        varying float vRadius;
        varying float vGlint;
        varying float vSeed;

        void main() {
          vLocal = corner.xy;
          vCenterW = iOffset;
          vRadius = iRadius;
          vGlint = iGlint;
          vSeed = iSeed;

          vec4 mvCenter = modelViewMatrix * vec4(iOffset, 1.0);

          // Velocity direction in view space (rotation-only transform) —
          // view-space XY is screen-aligned, so this is a cheap, good-enough
          // approximation of "projected to screen" per the contract.
          vec3 velView = mat3(modelViewMatrix) * iVel;
          float speed = length(velView.xy);
          vec2 dir = speed > 1e-4 ? velView.xy / speed : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);

          float elong = 1.0 + clamp(speed * uStretchK * iElong, 0.0, 2.5);
          vec2 offset = (dir * corner.x * elong + perp * corner.y) * iRadius;

          mvCenter.xy += offset;
          gl_Position = projectionMatrix * mvCenter;
        }
      `,
      fragmentShader: `
        varying vec2 vLocal;
        varying vec3 vCenterW;
        varying float vRadius;
        varying float vGlint;
        varying float vSeed;

        ${common}

        void main() {
          float r2 = dot(vLocal, vLocal);
          if (r2 > 1.0) discard;
          float zL = sqrt(1.0 - r2);
          vec3 normalView = normalize(vec3(vLocal, zL));
          // view -> world rotation: viewMatrix's upper 3x3 is orthonormal,
          // so its transpose is its inverse — no extra uniform needed.
          mat3 camRot = transpose(mat3(viewMatrix));
          vec3 normalW = normalize(camRot * normalView);

          vec3 worldPos = vCenterW + normalW * vRadius;
          vec3 viewDirW = normalize(cameraPosition - worldPos);

          vec2 screenUV = gl_FragCoord.xy / uViewport;
          // Sphere chord length through the impostor at this pixel — a
          // physically-reasonable "thickness of water along the view ray".
          float shapeFactor = zL;
          float thickness = 2.0 * vRadius * shapeFactor;

          vec4 shaded = waterShade(normalW, viewDirW, screenUV, thickness, 0.0);

          // Cheap pseudo-bloom: a sharp extra specular kick on the largest
          // droplets (vGlint precomputed at spawn from the size range) —
          // reads as bright sun sparkle on the chunky drops.
          vec3 reflDir = reflect(-viewDirW, normalW);
          float align = max(0.0, dot(reflDir, normalize(uSunDir)));
          float sparkle = pow(align, 300.0) * vGlint * 3.5;
          shaded.rgb += sparkle;

          float edgeFade = smoothstep(1.0, 0.82, r2);
          gl_FragColor = vec4(shaded.rgb, clamp(shaded.a, 0.0, 1.0) * edgeFade);
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.layers.set(WATER_LAYER_IDX);
    this.scene.add(mesh);
    this.dropletMesh = mesh;
    this.dropletMat = material;
  }

  // -------------------------------------------------------------- emit()
  emit(opts) {
    const {
      origin, dir, count,
      speed: speedRange, size: sizeRange,
      spread = 0,
      rng,
      gravityScale = 1,
      stretch = 1,
    } = opts;

    if (typeof rng !== 'function') {
      console.error('DropletSystem.emit: opts.rng is required for deterministic droplets');
      return;
    }
    if (!origin || !dir || !count) return;

    const dirN = this._sDir.copy(dir);
    if (dirN.lengthSq() < 1e-8) dirN.set(0, 1, 0); else dirN.normalize();

    const up = Math.abs(dirN.y) > 0.95 ? this._sUp.set(1, 0, 0) : this._sUp.set(0, 1, 0);
    const tangent = this._sTangent.crossVectors(up, dirN);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0); else tangent.normalize();
    const bitangent = this._sBitangent.crossVectors(dirN, tangent).normalize();

    const maxAngle = clamp01(spread) * Math.PI * 0.5;
    const s0 = speedRange ? speedRange[0] : 1;
    const s1 = speedRange ? speedRange[1] : 2;
    const r0 = sizeRange ? sizeRange[0] : 0.02;
    const r1 = sizeRange ? sizeRange[1] : 0.08;
    const sizeSpan = Math.max(1e-6, r1 - r0);

    for (let i = 0; i < count; i++) {
      const u1 = rng();
      const theta = Math.sqrt(u1) * maxAngle;
      const phi = rng() * Math.PI * 2;
      const st = Math.sin(theta), ct = Math.cos(theta);
      const cphi = Math.cos(phi), sphi = Math.sin(phi);

      const vx = dirN.x * ct + (tangent.x * cphi + bitangent.x * sphi) * st;
      const vy = dirN.y * ct + (tangent.y * cphi + bitangent.y * sphi) * st;
      const vz = dirN.z * ct + (tangent.z * cphi + bitangent.z * sphi) * st;

      const spd = s0 + (s1 - s0) * rng();

      // Power-law size mix: many small droplets, a few large ones.
      const sizeU = rng();
      const size = r0 + sizeSpan * Math.pow(sizeU, 2.4);
      const sizeT = clamp01((size - r0) / sizeSpan);

      const idx = this._allocDroplet();
      const b = idx * 3;
      const jitter = size * 1.5;
      this.dPos[b + 0] = origin.x + (rng() - 0.5) * jitter;
      this.dPos[b + 1] = origin.y + (rng() - 0.5) * jitter * 0.5;
      this.dPos[b + 2] = origin.z + (rng() - 0.5) * jitter;
      this.dVel[b + 0] = vx * spd;
      this.dVel[b + 1] = vy * spd;
      this.dVel[b + 2] = vz * spd;
      this.dSize[idx] = size;
      this.dAge[idx] = 0;
      this.dGrav[idx] = gravityScale;
      this.dElong[idx] = stretch;
      this.dSeed[idx] = rng();
      // Glint weight ramps up for droplets in the top ~size quartile.
      this.dGlint[idx] = smoothstep(0.6, 0.95, sizeT);
    }
  }

  // -------------------------------------------------------------- update droplets
  _updateDroplets(dt) {
    const cap = this.dCap;
    const active = this.dActive;
    const pos = this.dPos, vel = this.dVel, size = this.dSize, age = this.dAge;
    const grav = this.dGrav, elong = this.dElong, seed = this.dSeed, glint = this.dGlint;

    const geo = this.dropletMesh.geometry;
    const aOffset = geo.attributes.iOffset.array;
    const aRadius = geo.attributes.iRadius.array;
    const aVel = geo.attributes.iVel.array;
    const aGlint = geo.attributes.iGlint.array;
    const aSeed = geo.attributes.iSeed.array;
    const aElong = geo.attributes.iElong.array;

    let writeIdx = 0;
    for (let i = 0; i < cap; i++) {
      if (!active[i]) continue;
      const b = i * 3;
      age[i] += dt;

      // quadratic drag opposing current velocity, then gravity
      const vx = vel[b + 0], vy = vel[b + 1], vz = vel[b + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dragK = DRAG_K_DROPLET * speed;
      vel[b + 0] = vx - vx * dragK * dt;
      vel[b + 1] = vy - vy * dragK * dt - G * grav[i] * dt;
      vel[b + 2] = vz - vz * dragK * dt;

      pos[b + 0] += vel[b + 0] * dt;
      pos[b + 1] += vel[b + 1] * dt;
      pos[b + 2] += vel[b + 2] * dt;

      if (pos[b + 1] <= 0 || age[i] >= MAX_DROPLET_LIFE) {
        if (pos[b + 1] <= 0 && this.onDropletLand) {
          this.onDropletLand(pos[b + 0], pos[b + 2], size[i]);
        }
        active[i] = 0;
        this.dCount--;
        continue;
      }

      const w = writeIdx * 3;
      aOffset[w + 0] = pos[b + 0];
      aOffset[w + 1] = pos[b + 1];
      aOffset[w + 2] = pos[b + 2];
      aVel[w + 0] = vel[b + 0];
      aVel[w + 1] = vel[b + 1];
      aVel[w + 2] = vel[b + 2];
      aRadius[writeIdx] = size[i];
      aGlint[writeIdx] = glint[i];
      aSeed[writeIdx] = seed[i];
      aElong[writeIdx] = elong[i];
      writeIdx++;
      if (writeIdx >= cap) break;
    }

    this.dropletMesh.count = writeIdx;
    if (writeIdx > 0) {
      geo.attributes.iOffset.needsUpdate = true;
      geo.attributes.iRadius.needsUpdate = true;
      geo.attributes.iVel.needsUpdate = true;
      geo.attributes.iGlint.needsUpdate = true;
      geo.attributes.iSeed.needsUpdate = true;
      geo.attributes.iElong.needsUpdate = true;
    }
  }

  // ================================================================
  // Fine spray / mist
  // ================================================================
  _buildSprayPool() {
    const cap = SPRAY_CAP;
    this.sCap = cap;
    this.sActive = new Uint8Array(cap);
    this.sPos = new Float32Array(cap * 3);
    this.sVel = new Float32Array(cap * 3);
    this.sLife = new Float32Array(cap);
    this.sAge = new Float32Array(cap);
    this.sSize = new Float32Array(cap);
    this.sColor = new Float32Array(cap * 3);
    this.sCursor = 0;
    this.sCount = 0;
  }

  _allocSpray() {
    const idx = this.sCursor;
    this.sCursor = (this.sCursor + 1) % this.sCap;
    if (!this.sActive[idx]) this.sCount++;
    this.sActive[idx] = 1;
    return idx;
  }

  _buildSprayMesh() {
    const geo = buildQuadGeometry();
    const cap = SPRAY_CAP;
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));

    this._sprayTex = makeSprayTexture();
    const uniforms = {
      uSprayTex: { value: this._sprayTex },
      uSunDir: this._sharedUniforms.uSunDir,
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      vertexShader: `
        attribute vec3 corner;
        attribute vec3 iOffset;
        attribute float iSize;
        attribute float iAlpha;
        attribute vec3 iColor;

        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vUv = corner.xy * 0.5 + 0.5;
          vAlpha = iAlpha;
          vColor = iColor;
          vec4 mvCenter = modelViewMatrix * vec4(iOffset, 1.0);
          mvCenter.xy += corner.xy * iSize;
          gl_Position = projectionMatrix * mvCenter;
        }
      `,
      fragmentShader: `
        uniform sampler2D uSprayTex;
        uniform vec3 uSunDir;

        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vec4 tex = texture2D(uSprayTex, vUv);
          vec2 local = vUv * 2.0 - 1.0;
          float r2 = dot(local, local);
          if (r2 > 1.0) discard;
          float zL = sqrt(max(0.0, 1.0 - r2));
          vec3 normalView = normalize(vec3(local, zL));
          mat3 camRot = transpose(mat3(viewMatrix));
          vec3 normalW = normalize(camRot * normalView);

          // Light-wrap: brighten the sun-facing side, keep the far side a
          // soft cool white rather than fully dark — this is what sells the
          // "sunlit atomized mist" look instead of flat grey smoke.
          float wrap = clamp(dot(normalW, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
          float lightWrap = mix(0.62, 1.35, wrap);

          vec3 col = vColor * lightWrap;
          gl_FragColor = vec4(col, tex.a * vAlpha);
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.frustumCulled = false;
    mesh.count = 0;
    // Deliberately NOT on WATER_LAYER — normal blended, no refraction.
    this.scene.add(mesh);
    this.sprayMesh = mesh;
    this.sprayMat = material;
  }

  // -------------------------------------------------------------- emitSpray()
  emitSpray(opts) {
    const { origin, dir, count, speed: speedRange, spread = 0, life: lifeRange } = opts;
    if (!origin || !count) return;

    const dirN = this._sDir.copy(dir || { x: 0, y: 1, z: 0 });
    if (dirN.lengthSq() < 1e-8) dirN.set(0, 1, 0); else dirN.normalize();
    const up = Math.abs(dirN.y) > 0.95 ? this._sUp.set(1, 0, 0) : this._sUp.set(0, 1, 0);
    const tangent = this._sTangent.crossVectors(up, dirN);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0); else tangent.normalize();
    const bitangent = this._sBitangent.crossVectors(dirN, tangent).normalize();

    const maxAngle = clamp01(spread) * Math.PI * 0.5 + 0.05;
    const s0 = speedRange ? speedRange[0] : 0.8;
    const s1 = speedRange ? speedRange[1] : 2.5;
    const l0 = lifeRange ? lifeRange[0] : 0.35;
    const l1 = lifeRange ? lifeRange[1] : 0.8;

    for (let i = 0; i < count; i++) {
      const theta = Math.sqrt(Math.random()) * maxAngle;
      const phi = Math.random() * Math.PI * 2;
      const st = Math.sin(theta), ct = Math.cos(theta);
      const cphi = Math.cos(phi), sphi = Math.sin(phi);
      const vx = dirN.x * ct + (tangent.x * cphi + bitangent.x * sphi) * st;
      const vy = dirN.y * ct + (tangent.y * cphi + bitangent.y * sphi) * st;
      const vz = dirN.z * ct + (tangent.z * cphi + bitangent.z * sphi) * st;
      const spd = s0 + (s1 - s0) * Math.random();

      const idx = this._allocSpray();
      const b = idx * 3;
      const jitter = 0.06;
      this.sPos[b + 0] = origin.x + (Math.random() - 0.5) * jitter;
      this.sPos[b + 1] = origin.y + Math.random() * jitter;
      this.sPos[b + 2] = origin.z + (Math.random() - 0.5) * jitter;
      this.sVel[b + 0] = vx * spd;
      this.sVel[b + 1] = vy * spd;
      this.sVel[b + 2] = vz * spd;
      this.sLife[idx] = l0 + (l1 - l0) * Math.random();
      this.sAge[idx] = 0;
      // physical 0.5-3cm radius, scaled up a bit for on-screen readability
      this.sSize[idx] = (0.005 + Math.random() * 0.025) * SPRAY_RENDER_SCALE;
      const tint = 0.88 + Math.random() * 0.12;
      this.sColor[b + 0] = 0.92 * tint;
      this.sColor[b + 1] = 0.97 * tint;
      this.sColor[b + 2] = 1.0 * tint;
    }
  }

  // -------------------------------------------------------------- update spray
  _updateSpray(dt) {
    const cap = this.sCap;
    const active = this.sActive;
    const pos = this.sPos, vel = this.sVel, life = this.sLife, age = this.sAge;
    const size = this.sSize, color = this.sColor;

    const geo = this.sprayMesh.geometry;
    const aOffset = geo.attributes.iOffset.array;
    const aSize = geo.attributes.iSize.array;
    const aAlpha = geo.attributes.iAlpha.array;
    const aColor = geo.attributes.iColor.array;

    let writeIdx = 0;
    for (let i = 0; i < cap; i++) {
      if (!active[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) {
        active[i] = 0;
        this.sCount--;
        continue;
      }
      const t = age[i] / life[i];
      const b = i * 3;

      // Slight buoyant hang before falling (air resistance on tiny drops),
      // then strong quadratic drag kills horizontal drift quickly — mist
      // puffs and lingers rather than flying like a chunky droplet.
      const gEff = G * (0.14 + 0.86 * smoothstep(0.15, 0.55, t));
      const vx = vel[b + 0], vy = vel[b + 1], vz = vel[b + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dragK = DRAG_K_SPRAY * speed;
      vel[b + 0] = vx - vx * dragK * dt;
      vel[b + 1] = vy - vy * dragK * dt - gEff * dt;
      vel[b + 2] = vz - vz * dragK * dt;

      pos[b + 0] += vel[b + 0] * dt;
      pos[b + 1] += vel[b + 1] * dt;
      pos[b + 2] += vel[b + 2] * dt;
      if (pos[b + 1] < 0) { pos[b + 1] = 0; vel[b + 1] = 0; }

      const fadeIn = smoothstep(0, 0.15, t);
      const fadeOut = 1 - smoothstep(0.65, 1, t);
      const alpha = fadeIn * fadeOut;

      const w = writeIdx * 3;
      aOffset[w + 0] = pos[b + 0];
      aOffset[w + 1] = pos[b + 1];
      aOffset[w + 2] = pos[b + 2];
      aSize[writeIdx] = size[i];
      aAlpha[writeIdx] = alpha;
      aColor[w + 0] = color[b + 0];
      aColor[w + 1] = color[b + 1];
      aColor[w + 2] = color[b + 2];
      writeIdx++;
      if (writeIdx >= cap) break;
    }

    this.sprayMesh.count = writeIdx;
    if (writeIdx > 0) {
      geo.attributes.iOffset.needsUpdate = true;
      geo.attributes.iSize.needsUpdate = true;
      geo.attributes.iAlpha.needsUpdate = true;
      geo.attributes.iColor.needsUpdate = true;
    }
  }

  // ================================================================
  // Public API
  // ================================================================
  isAlive() {
    return this.dCount > 0 || this.sCount > 0;
  }

  update(dt, time) {
    this._updateDroplets(dt);
    this._updateSpray(dt);
  }
}
