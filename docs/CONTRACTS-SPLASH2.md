# Splash Photoreal Overhaul — Contract Addendum (v2)

Approved direction: **photorealistic water splash** (transparency, refraction,
fresnel, sun glints, thin-film crown with finger breakup, droplet impostors,
spray). Quality-first, 30fps acceptable on iPhone 12-class. WebGL2 grab-pass
allowed. Scope: splash elements only — the pool water surface, underwater
cavity/bubbles, environment, physics, input, camera, audio all KEEP their
existing verified behavior and contracts (docs/CONTRACTS.md still applies
unless overridden here).

Causality rules, ImpactSpec, determinism (mulberry32(spec.seed) for macro
shapes) are UNCHANGED and non-negotiable.

## New file ownership

| File | Owner | Exports |
|---|---|---|
| `src/watershading.js` (new) + render-loop edits in `src/main.js` | R1 | see below |
| `src/splash.js` (full rewrite) | R2 | `SplashFX` (same class name) |
| `src/droplets.js` (new) | R3 | `DropletSystem` |
| `src/underwater.js` (jet rewrite only; cavity/bubbles/resurface keep working) | R4 | `UnderwaterFX` (same) |

Nobody edits another owner's file. R2/R3/R4 code against this contract even
though R1's file may not exist yet.

## `src/watershading.js` — R1

```js
export const WATER_LAYER = 1;   // three.js layer index for refractive splash objects

export class GrabPass {
  constructor(renderer)
  texture        // THREE.FramebufferTexture (or equivalent) of the opaque scene
  setSize(w, h)  // call on resize (drawing-buffer pixels)
  capture(renderer)  // copy current framebuffer; called by main between passes
}

export function sharedWaterUniforms(grabPass) // → SINGLE shared uniforms object:
// {
//   uSceneTex:  { value: grabPass.texture },
//   uViewport:  { value: new THREE.Vector2(w, h) },   // drawing-buffer px, kept fresh by R1
//   uSunDir:    { value: new THREE.Vector3(...) },    // WORLD-space dir TO the sun,
//                                                      // must match scene.js's DirectionalLight
//   uWaterAbsorb: { value: new THREE.Vector3(...) },  // Beer-Lambert absorption (blue-green tint)
//   uTimeW:     { value: 0 },                          // scaled game time, updated by R1 each frame
// }
// Call once in main; the SAME object instance is passed to all consumers so
// updates propagate. (waterCtx.uniforms below.)

export const WATER_GLSL = {
  // GLSL chunk for FRAGMENT shaders. Declares the uniforms above and defines:
  //   float fresnelSchlick(float cosTheta, float F0);
  //   vec3  skyEnvColor(vec3 dirW);                       // procedural sky reflection (gradient + sun disc glow)
  //   float sunGlint(vec3 normalW, vec3 viewDirW);        // sharp GGX-ish specular, sun from uSunDir
  //   vec3  refractSample(vec2 screenUV, vec3 normalVS_or_W, float thickness); // grab-pass sample with
  //                                                        // normal-based UV offset, edge-clamped
  //   vec3  absorb(vec3 refracted, float thickness);      // Beer-Lambert tint by water thickness (meters)
  //   vec4  waterShade(vec3 normalW, vec3 viewDirW, vec2 screenUV, float thickness, float foam);
  //     // The one-stop shading: refraction + absorption + fresnel*sky reflection
  //     // + sunGlint + foam (0..1 mixes toward scattering white). Returns final rgba
  //     // (alpha from thickness & fresnel — thin films more transparent).
  common: `...`,
};
// Consumers write their own ShaderMaterial: vertex shader outputs
// vWorldPos, vNormalW, vThickness (meters of water along the view ray, approx ok),
// and screenUV is computed in fragment as gl_FragCoord.xy / uViewport.
// Materials must set: transparent:true, depthWrite:false (except where noted), and
// mesh.layers.set(WATER_LAYER) — CRITICAL: water-layer objects are invisible to
// pass 1 and rendered in pass 2 after capture.
```

### main.js render-loop change (R1 owns this edit)

Replace the single `renderer.render` with:
1. `camera.layers.disable(WATER_LAYER)`; `renderer.render(scene, camera)`
2. if any splash active (`splashActive()` below): `grabPass.capture(renderer)`;
   `renderer.autoClear = false`; `camera.layers.set-only-WATER_LAYER`-style
   second render (`camera.layers.enable(WATER_LAYER)` + disable 0 — lights must
   be visible to both passes: `light.layers.enableAll()` where needed);
   restore autoClear/layers.
3. Skip pass 2 entirely when nothing splash-related is alive (idle perf).
R1 also: creates `grabPass`, `uniforms = sharedWaterUniforms(grabPass)`,
`droplets = new DropletSystem(scene, waterCtx)` and builds
`waterCtx = { grabPass, uniforms, droplets }`, passes it as the NEW SECOND
constructor arg to `SplashFX(scene, waterCtx)` and
`UnderwaterFX(scene, waterCtx)`; wires
`droplets.onDropletLand = (x,z,size) => { water.addRipple(x,z,min(0.12,size*0.5)); splash.microSplash(x,z,size); }`.
Keeps window.__lab intact; add `__lab.waterDebug()` → `{pass2Active, dropletsAlive, sprayAlive}`.
Set uSunDir to match the DirectionalLight direction found in src/scene.js.
`splashActive()`: poll `splash.isActive() || underwater.isActive() || droplets.isAlive()`
(all three classes must expose these tiny boolean methods — R2/R3/R4 note).
WebGL2 check: if `renderer.capabilities.isWebGL2` is false, waterCtx.grabPass
stays null and consumers must degrade gracefully (uSceneTex null → consumers
use their previous-style non-refractive look; simplest: alpha-blend fallback
inside waterShade via a `#define NO_GRAB` variant — R1 provides both variants
in WATER_GLSL.common via a `grab` boolean argument to a factory
`waterGlslCommon(hasGrab)` — keep it simple and documented).

## `src/droplets.js` — R3

```js
export class DropletSystem {
  constructor(scene, waterCtx)   // waterCtx = { grabPass, uniforms, droplets:null-at-this-point }
  onDropletLand = null           // (x, z, size) — set by main
  emit(opts)      // chunky refractive droplets. opts:
  // { origin:Vector3, dir:Vector3 (mean direction, normalized), count,
  //   speed:[min,max], size:[min,max] (radius m), spread (0..1 cone widening),
  //   rng: ()=>float (REQUIRED for determinism — caller passes mulberry32),
  //   gravityScale=1, stretch=1 (velocity elongation factor) }
  emitSpray(opts) // fine mist. { origin, dir, count, speed:[..], spread, life:[min,max] }
  isAlive()       // any droplet or spray particle alive
  update(dt, time)
}
```
- Chunky droplets: ONE InstancedMesh of camera-facing quads (~4096 capacity),
  fragment shader reconstructs a sphere impostor: sphere normal from quad UV,
  discard outside circle, then `waterShade(...)` from WATER_GLSL for
  refraction+fresnel+sun glint. Prolate stretch along velocity (scale the quad
  and adjust normal math, approximation fine). Power-law size mix.
  `mesh.layers.set(WATER_LAYER)`. Ballistic with G, slight quadratic drag;
  at y<=0: fire onDropletLand(x,z,size) and recycle.
- Spray: second InstancedMesh (~2048) of soft round billboards, NOT on
  WATER_LAYER (normal blending, no refraction), brightness from a light-wrap
  approximation vs uSunDir, short life, slight upward-then-drift motion,
  fades out. This layer supplies the realistic "white" of atomized water.
- Optional glint sub-pass: small additive quads on the brightest droplets when
  view/sun alignment is strong (cheap pseudo-bloom) — include if it reads well.
- No per-frame allocations; all pooled.

## `src/splash.js` rewrite — R2

`SplashFX(scene, waterCtx)` — same public API as before (`trigger(spec)`,
`update(dt,time)`, `onDropletLand` REMOVED — droplets moved to DropletSystem;
keep a no-op setter for backward safety), plus:
- `microSplash(x, z, size)` — tiny crown-let for big droplet landings (pooled,
  ~6 concurrent, very cheap: small ring mesh with waterShade).
- `isActive()`.
Layers (all deterministic macro from mulberry32(spec.seed), all on WATER_LAYER,
using WATER_GLSL waterShade):
1. **Crown**: smooth thin-walled sheet of revolution, high tessellation
   (~96×24), time-evolving profile curves (rise → decelerate → rim thickens →
   fall) parameterized like real high-speed footage; rim FINGERS grow over
   time (vertex displacement pattern, count ≈ rim circumference / capillary
   wavelength ~0.9cm scaled up for readability, from seed); finger tips emit
   chunky droplets via waterCtx.droplets.emit (pass rng); per-pixel flow-noise
   normal perturbation so refraction shimmers. vThickness: thicker at base
   (~0.03m) thin at rim (~0.004m) — drives transparency & absorption.
   Oblique skew along spec.dir preserved. Containment cap (room to pool edge)
   preserved from current code.
2. **Sheet/lamella**: thin refractive film expanding at y≈0.02 with retracting
   rim (surface-tension pullback after peak), subtle sparkle. Flatness →
   bigger. Containment cap preserved.
3. **Spray**: 1-2 emitSpray calls at impact (+ finger breakup moment), amount
   scales with energy; flat slaps → more lateral spray.
4. Impact moment: brief bright glint flash sprite (sun-aligned) — subtle.
Old mist/paper-sheet/opaque-crown code is replaced. Energy/flatness/oblique/
softness causality mappings preserved (same directions as v1).

## `src/underwater.js` jet rewrite — R4

`UnderwaterFX(scene, waterCtx)` — same public API + `isActive()`.
- KEEP cavity + bubbles + triggerResurface behavior (tuning welcome, no
  regression), they are NOT on WATER_LAYER (they render under the transparent
  pool surface in pass 1, as today).
- REWRITE the Worthington jet as a photoreal column: smooth lathe/tube with
  time-evolving profile (rise with overshoot, neck forms, PINCH-OFF: tip
  separates as 1-3 satellite droplets emitted via waterCtx.droplets.emit with
  the spec's rng), waterShade material on WATER_LAYER, vThickness from local
  column radius, flow-noise normal detail. Timing/height causality unchanged
  (delay ≈ 0.30+0.15*energy, tall for clean deep entries, weak for flat).
- Jet base merges with a small mound + ring wave at the surface.

## Verification (R5, after R1-R4)

Headless run must show, vs saved BEFORE screenshots: background visibly
REFRACTED through crown/sheet/jet (tile/tower distortion), fresnel rim
brightness, sun glints on droplets, spray layer, finger breakup over time in
slow-mo sequence (5-frame series), and the three approved comparison
conditions (heavyball vs disc, straight vs oblique, low vs high) still
causally distinct. Zero __lab.errors; pass-2 skip verified when idle;
draw calls < 80; determinism (same seed → same crown/finger layout).
WebGL1 fallback path must at least not crash (SwiftShader is WebGL2 so test
via forcing the NO_GRAB variant flag if feasible, else report as untested).
