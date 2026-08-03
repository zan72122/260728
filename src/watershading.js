// src/watershading.js — R1
// Shared photoreal water shading infrastructure: the WATER_LAYER convention,
// the grab-pass (opaque scene capture for refraction), the single shared
// uniforms object all water-ish materials bind to, and the WATER_GLSL chunk
// (fresnel, procedural sky, sun glint, refraction sampling, Beer-Lambert
// absorption, and the one-stop `waterShade` combine).
//
// See docs/CONTRACTS-SPLASH2.md ("src/watershading.js — R1") for the full
// contract. Consumers: src/splash.js (R2), src/droplets.js (R3),
// src/underwater.js (R4).
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// WATER_LAYER — three.js Layers index used for all refractive splash
// geometry (crown, sheet, droplets, jet). Objects on this layer are invisible
// during render pass 1 (opaque scene) and rendered in pass 2, after the grab
// pass has captured pass 1's framebuffer for refraction sampling.
// ---------------------------------------------------------------------------
export const WATER_LAYER = 1;

// ---------------------------------------------------------------------------
// GrabPass — captures the opaque (pass-1) framebuffer into a texture so
// water-layer materials can sample "what's behind the water" for refraction.
// ---------------------------------------------------------------------------
export class GrabPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.texture = null;
    this._w = 0;
    this._h = 0;
    this._sizeTarget = new THREE.Vector2();
    // WebGL1 (or a renderer that failed to init) can't grab-sample cheaply
    // via copyFramebufferToTexture the way we rely on here; the contract
    // treats grabPass as usable whenever the renderer reports WebGL2.
    this.supported = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
    if (this.supported) {
      const size = renderer.getDrawingBufferSize(this._sizeTarget);
      this.setSize(Math.max(1, Math.floor(size.x)), Math.max(1, Math.floor(size.y)));
    }
  }

  // (w, h) MUST be drawing-buffer pixels (i.e. already multiplied by
  // devicePixelRatio), not CSS pixels — call from main's resize handler with
  // renderer.getDrawingBufferSize().
  setSize(w, h) {
    if (!this.supported) return;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (this.texture && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    if (this.texture) this.texture.dispose();
    const tex = new THREE.FramebufferTexture(w, h);
    // Grab-pass content is the tone-mapped/encoded framebuffer; sampling it
    // directly in shaders is treated as already display-referred, which is
    // fine for a refraction "peek" (not physically exact, looks right).
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.texture = tex;
  }

  // Copy the currently-rendered framebuffer into `texture`. Call between
  // pass 1 (opaque) and pass 2 (WATER_LAYER) each frame a splash is active.
  capture(renderer) {
    if (!this.supported || !this.texture) return;
    try {
      renderer.copyFramebufferToTexture(this.texture);
    } catch (err) {
      // Never let a grab failure take down the render loop — consumers
      // degrade to the NO_GRAB look if uSceneTex stops updating.
      console.error(err);
    }
  }
}

// ---------------------------------------------------------------------------
// sharedWaterUniforms — ONE shared uniforms object, instance shared by every
// water-ish ShaderMaterial so main's per-frame updates (time, viewport, sun
// direction) propagate everywhere without per-material bookkeeping.
// ---------------------------------------------------------------------------
export function sharedWaterUniforms(grabPass) {
  return {
    uSceneTex: { value: grabPass && grabPass.supported ? grabPass.texture : null },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
    uWaterAbsorb: { value: new THREE.Vector3(0.35, 0.09, 0.06) },
    uTimeW: { value: 0 },
  };
}

// ---------------------------------------------------------------------------
// waterGlslCommon(hasGrab) — factory producing the shared fragment GLSL
// chunk. `hasGrab` selects between the WebGL2 refractive path and the
// NO_GRAB fallback (translucent deep-water color, no scene sampling) so
// materials degrade gracefully on WebGL1 / failed grab-pass setups.
// ---------------------------------------------------------------------------
export function waterGlslCommon(hasGrab) {
  const grabDefine = hasGrab ? '#define HAS_GRAB 1' : '';
  return `
${grabDefine}

uniform sampler2D uSceneTex;
uniform vec2 uViewport;
uniform vec3 uSunDir;
uniform vec3 uWaterAbsorb;
uniform float uTimeW;

// -- fresnel -----------------------------------------------------------
float fresnelSchlick(float cosTheta, float F0) {
  float c = clamp(1.0 - cosTheta, 0.0, 1.0);
  float c5 = c * c * c * c * c;
  return F0 + (1.0 - F0) * c5;
}

// -- procedural sky: horizon-to-zenith gradient + sun disc glow --------
// Matches scene.js's sky dome hues (bottom ~#e7f8ff, top ~#3fa9f5) so
// reflections read as "the same sky" rather than a generic env probe.
vec3 skyEnvColor(vec3 dirW) {
  vec3 d = normalize(dirW);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 bottomColor = vec3(0.906, 0.973, 1.0);
  vec3 topColor = vec3(0.247, 0.663, 0.961);
  vec3 sky = mix(bottomColor, topColor, pow(h, 0.55));
  float sunAmt = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  // Broad warm glow around the sun disc, plus a tight hot core.
  float glow = pow(sunAmt, 8.0) * 0.5 + pow(sunAmt, 220.0) * 3.0;
  vec3 sunColor = vec3(1.0, 0.96, 0.82);
  return sky + sunColor * glow;
}

// -- tight sun specular highlight (GGX-ish, cheap) ----------------------
float sunGlint(vec3 normalW, vec3 viewDirW) {
  vec3 n = normalize(normalW);
  vec3 v = normalize(viewDirW);
  vec3 l = normalize(uSunDir);
  vec3 h = normalize(l + v);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  float roughness = 0.08;
  float a2 = roughness * roughness;
  float denom = (nh * nh) * (a2 - 1.0) + 1.0;
  float ggx = a2 / max(3.14159265 * denom * denom, 1e-4);
  float nl = clamp(dot(n, l), 0.0, 1.0);
  return ggx * nl;
}

#ifdef HAS_GRAB
// -- refraction sample: grab-pass lookup with normal-based UV offset ---
// screenUV is gl_FragCoord.xy / uViewport (0..1, origin bottom-left — same
// convention as gl_FragCoord itself). copyFramebufferToTexture() copies the
// drawing buffer straight across with gl.copyTexSubImage2D, which preserves
// WebGL's native bottom-left-origin row order in the destination texture —
// unlike an authored image (top-down) upload, there is NO implicit flip
// applied for a raw framebuffer copy. So texture row 0 already IS the
// bottom row, exactly matching screenUV's origin: a direct
// texture2D(uSceneTex, screenUV) lines up correctly with no extra flip.
// grabFlip() is kept as an explicit, documented no-op hook (rather than
// inlining texture2D everywhere) so this reasoning lives in one place and
// is trivial to invert if ever sampling a texture with different origin
// conventions (e.g. an authored/uploaded image) through the same helper.
vec2 grabFlip(vec2 uv) {
  return uv;
}

vec3 refractSample(vec2 screenUV, vec3 normalVSOrW, float thickness) {
  vec3 n = normalize(normalVSOrW);
  // Offset scaled by thickness so thin films barely distort, thick water
  // bends more (approximate refraction, cheap & good-looking).
  vec2 offset = n.xy * clamp(thickness, 0.0, 0.2) * 0.9;
  vec2 uv = clamp(screenUV + offset, vec2(0.002), vec2(0.998));
  return texture2D(uSceneTex, grabFlip(uv)).rgb;
}
#else
vec3 refractSample(vec2 screenUV, vec3 normalVSOrW, float thickness) {
  // NO_GRAB fallback: no scene texture available (WebGL1 or failed grab
  // setup) — return a translucent deep-water color so materials still
  // read as "water" rather than sampling garbage.
  return vec3(0.06, 0.28, 0.34);
}
#endif

// -- Beer-Lambert absorption by water thickness (meters) ---------------
vec3 absorb(vec3 refracted, float thickness) {
  vec3 t = exp(-uWaterAbsorb * max(thickness, 0.0) * 8.0);
  vec3 deep = vec3(0.02, 0.12, 0.16);
  return mix(deep, refracted, t);
}

// -- the one-stop shading combine ---------------------------------------
vec4 waterShade(vec3 normalW, vec3 viewDirW, vec2 screenUV, float thickness, float foam) {
  vec3 n = normalize(normalW);
  vec3 v = normalize(viewDirW);
  float cosTheta = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = fresnelSchlick(cosTheta, 0.02);

  vec3 refracted = refractSample(screenUV, n, thickness);
  vec3 bodyColor = absorb(refracted, thickness);

  vec3 reflectDir = reflect(-v, n);
  vec3 sky = skyEnvColor(reflectDir);

  float glint = sunGlint(n, v);

  vec3 color = mix(bodyColor, sky, fresnel * 0.85);
  color += vec3(1.0, 0.97, 0.88) * glint * 1.4;

  // Foam: mixes toward bright scattered white (thin-film / whitewater look).
  vec3 foamColor = vec3(0.98, 0.995, 1.0);
  float foamAmt = clamp(foam, 0.0, 1.0);
  color = mix(color, foamColor, foamAmt * 0.9);

  // Alpha: thin films are more transparent; fresnel edges stay visible.
  float alpha = clamp(thickness * 10.0 + fresnel * 0.6 + foamAmt * 0.5, 0.08, 1.0);

  return vec4(color, alpha);
}
`;
}

// Pre-built variants for convenience: WATER_GLSL.common is the WebGL2
// (grab-enabled) chunk, matching the contract's documented shape
// (`WATER_GLSL.common`). Use `waterGlslCommon(false)` directly for the
// NO_GRAB variant when the renderer lacks WebGL2 support.
export const WATER_GLSL = {
  common: waterGlslCommon(true),
};
