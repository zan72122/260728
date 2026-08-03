# にじいろ ぽちゃん！しぶきラボ — Module Contracts (v1)

A 3D water-splash toy lab for 4-year-olds. Toys are grabbed from a diving
platform and dropped/thrown into a pool. **The water splash is the star of
the game.** Every module must serve that goal.

This document is the single source of truth for module interfaces. Each
module is implemented by a different engineer in its own file. **Never edit
a file owned by another module.** If you need something from another module,
use exactly the API written here.

## Tech ground rules

- Three.js r170, imported as `import * as THREE from 'three'`
  (an importmap in `index.html` maps `"three"` → `/vendor/three.module.js`).
- Plain ES modules, **no build step, no TypeScript, no external deps**.
- Units: meters, seconds. Water surface is the plane **y = 0**.
- Gravity: use `G` from `src/constants.js` (12.5 — slightly heavy for a
  snappy toy feel).
- Target: 60 fps on iPhone. Budget: < 70 draw calls total, all particle
  systems must use `THREE.InstancedMesh` or custom BufferGeometry points —
  **never one Mesh per droplet**. No per-frame allocations in update loops
  (pre-allocate and reuse `Vector3` etc.). `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
- Visual style: bright, cheerful, saturated toy-box colors, soft sky
  gradient, rainbow accents. No text menus, no small buttons. Everything a
  4-year-old can hit with a thumb.
- All code comments in English. No console.log spam (console.error ok).

## Files & ownership

| File | Owner | Exports |
|---|---|---|
| `index.html`, `src/main.js`, `src/rng.js` | A (bootstrap) | see below |
| `src/scene.js` | B (environment) | `SceneEnv` |
| `src/water.js` | C (water surface) | `WaterSurface` |
| `src/splash.js` | D (above-water splash) | `SplashFX` |
| `src/underwater.js` | E (cavity/bubbles/jet) | `UnderwaterFX` |
| `src/toys.js` | F (toys) | `TOYS`, `createToyMesh`, `deformToy` |
| `src/physics.js` | G (physics) | `Physics` |
| `src/input.js` | H (input & UI) | `InputController` |
| `src/cameraFX.js`, `src/audio.js` | I (camera & sound) | `CameraFX`, `AudioFX` |
| `src/constants.js` | architect (already written) | `POOL`, `G`, `PLATFORMS` |

## `src/constants.js` (already exists — read it)

```js
export const G = 12.5;
export const POOL = { RADIUS: 5.5, WATER_RADIUS: 5.2, DEPTH: 3.2 };
// Diving platforms: a tower on the -X side; `tip` is where the held toy hovers.
export const PLATFORMS = [
  { id: 'low',  height: 2.2, tip: /*Vector3*/ { x: -3.4, y: 2.2, z: 0 } },
  { id: 'mid',  height: 4.4, tip: { x: -3.4, y: 4.4, z: 0 } },
  { id: 'high', height: 7.2, tip: { x: -3.4, y: 7.2, z: 0 } },
];
```

## `src/rng.js` (owner A)

```js
export function mulberry32(seed) // → () => float [0,1), deterministic
export function hashInts(...ints) // → uint32 seed from integers
```

## ToyDef (defined in `src/toys.js`, used everywhere)

```js
{
  id: 'pingpong' | 'heavyball' | 'beachball' | 'disc' | 'cup' | 'sponge' | 'ring' | 'jelly',
  name: string,            // Japanese, e.g. 'ピンポンだま'
  emoji: string,           // for UI button, e.g. '🏓'
  shape: 'sphere' | 'disc' | 'cup' | 'torus' | 'box',
  radius: number,          // bounding radius (m)
  density: number,         // relative to water: <1 floats, >1 sinks
  softness: number,        // 0 rigid … 1 jelly (visual deform amount)
  bounciness: number,      // 0..1
  color: number,           // hex
}
```

The 8 toys (F owns exact tuning, keep ids exactly):
pingpong (sphere r=.12 d=.08), heavyball (sphere r=.35 d=2.6),
beachball (sphere r=.5 d=.05), disc (disc r=.42 d=1.3),
cup (cup r=.24 d=.45), sponge (box r=.3 d=.15 soft .7),
ring (torus r=.45 d=.09), jelly (sphere r=.3 d=1.05 soft 1).

## ImpactSpec — the heart of the game

Computed by **Physics** at the moment a toy crosses y=0 downward, passed to
splash/underwater/camera/audio. All consumers read, never mutate.

```js
{
  point: THREE.Vector3,    // entry point (y ≈ 0)
  velocity: THREE.Vector3, // velocity at impact (m/s, y < 0)
  speed: number,           // velocity.length()
  energy: number,          // 0..1 normalized splash energy:
                           //   clamp01( (mass * speed^2) / 260 ) ** 0.6
                           //   where mass = density * radius^3 * 33
  size: number,            // toy radius
  def: ToyDef,
  flatness: number,        // 0..1 — how flat the striking face is, given
                           // current orientation. sphere≈0.1, disc face-on≈1,
                           // disc edge-on≈0.05, box≈0.6, cup rim-down≈0.4
  oblique: number,         // 0..1 = horizontalSpeed / speed
  dir: THREE.Vector2,      // normalized horizontal travel dir (x,z); (0,0) if vertical
  cupTrap: number,         // 0..1 trapped air: cup entering opening-down ≈ 1,
                           // opening-up ≈ 0.1, others 0. ring ≈ 0.3
  spin: number,            // |angular velocity| rad/s at impact
  seed: number,            // hashInts(toyIndex, round(speed*3), round(oblique*6), round(flatness*6))
  isSecondary: boolean     // true for re-entry after a bounce/resurface flop
}
```

**Determinism rule:** the LARGE shapes (crown height/width, sheet extent,
jet height, cavity size) must be derived from `mulberry32(spec.seed)` so the
same conditions reproduce the same splash. Small droplets/bubbles may use
`Math.random()` for sparkle variation.

**Causality rules every consumer must respect:**
- higher `energy` → bigger everything
- higher `flatness` → wide low sheet & wide crown, shallow cavity, weak jet
- lower `flatness` (clean pointed entry) → narrow tall crown, deep cavity, strong delayed jet
- higher `oblique` → splash biased toward `dir` (one-sided fan), crown skewed
- `cupTrap` high → big burpy bubble burst, muffled audio, extra bubbles
- `softness` high → wobbly, wetter, blobbier splash, slightly less sharp droplets

## `src/scene.js` — B

```js
export class SceneEnv {
  constructor(scene /* THREE.Scene */)
  platforms   // array mirroring PLATFORMS, each { id, height, tip:Vector3, focus:Object3D }
  update(dt, time)
}
```
Builds: sky gradient background (big shader dome or scene.background +
fog), sun light (one DirectionalLight, shadows OPTIONAL and cheap or fake
blob), ambient/hemisphere light, the pool basin (cylindrical wall + tiled
inner wall visible above water, ring deck), a cute diving-platform tower on
the -X side with three boards at PLATFORMS heights (rounded, candy-colored,
big and readable), a few background props (clouds, palm/balloon — cheap).
Do NOT create the water surface (C owns it). Keep it under ~25 draw calls.

## `src/water.js` — C

```js
export class WaterSurface {
  constructor(scene)
  mesh                       // the surface mesh
  addRipple(x, z, strength)  // strength 0..1; expanding ring ripple
  displacementAt(x, z)       // current surface height offset (number, for bobbing)
  update(dt, time)
}
```
A circular disc mesh (radius `POOL.WATER_RADIUS`, y=0, ~96×96 segments or
radial equivalent) with a custom ShaderMaterial: pretty toy-water look
(fresnel-ish sparkle, gradient depth color #4dd0e6 → #1a7ac4, gentle
ambient waves), plus up to **12 concurrent ring ripples** as uniforms
`{center, startTime, strength}` displacing vertices (damped expanding
sin rings) — visible, chunky, satisfying rings. Old ripples recycle.
`displacementAt` mirrors the vertex math on CPU for one point (approximate
is fine, used for floating-toy bobbing). Also add a subtle caustics-like
shimmer on the pool floor? — optional, only if cheap.

## `src/splash.js` — D  ★ the star of the game

```js
export class SplashFX {
  constructor(scene)
  trigger(spec /* ImpactSpec */)
  update(dt, time)   // dt is SCALED time (slow-mo already applied)
}
```
Layered, mesh+particle hybrid, all pooled (support ≥3 overlapping splashes):

1. **Crown splash** — a thick-walled crown mesh (lathe/cylinder with
   noise-displaced rim, ~24 rim points from `mulberry32(seed)`), rises,
   flares outward, rim breaks into droplets, fades. Height/width from
   energy & flatness. Skew it along `dir` when oblique.
2. **Horizontal sheet** — a fast expanding thin disc/annulus mesh at y≈0,
   alpha-fading, stretched into an ellipse/fan toward `dir` when oblique.
   Flat impacts → much bigger sheet.
3. **Droplets** — InstancedMesh (~300 capacity) of small stretched spheres,
   two size classes, ballistic under G, splash-down = tiny ripple via
   callback `onDropletLand(x,z,r)` (main wires it to water ripples +
   nothing else). Sparkly, catch light, slightly bluish-white.
4. **Mist/foam puff** — 1-2 soft alpha sprites for wet burst feel.
White-ish water color with slight blue tint; additive-ish blending where
tasteful. Everything reads clearly in slow motion — that's when players
stare at it. Aim for "delicious", chunky, anime-water vibes, NOT a thin
gray particle poof.
Also expose `onDropletLand` as a settable callback property.

## `src/underwater.js` — E

```js
export class UnderwaterFX {
  constructor(scene)
  trigger(spec)
  triggerResurface(pos, def)   // small bubble burst when a floater pops up
  update(dt, time)
}
```
1. **Air cavity** — a transparent/white-ish cone-ish mesh growing DOWN from
   the entry point (deep & narrow for clean entries, shallow & wide for flat
   ones), walls slightly wobbling, then collapsing (pinch in the middle,
   quick) — the collapse moment triggers nothing itself (jet timing is E's
   own, see below).
2. **Bubbles** — InstancedMesh (~140) rising wobbly spheres, size mix,
   spawned by cavity collapse; `cupTrap` multiplies count & size and adds a
   big single "glug" bubble.
3. **Central jet (Worthington)** — the delayed hero column: ~0.35s/energy
   after impact, a vertical column mesh shoots up from the entry point
   (tall & thick for clean deep entries, weak for flat), tip breaks into a
   few big droplets (reuse own small instanced pool), then falls back.
   THIS is the "payoff" — make it readable and satisfying.
All pooled, ≥3 concurrent. Underwater elements must look right through the
water surface (render them normally; slight blue fog tint via material).

## `src/toys.js` — F

```js
export const TOYS = [/* 8 ToyDefs, ids as listed above */]
export function createToyMesh(def) // → THREE.Object3D, cute & readable,
  // procedural geometry only (sphere w/ stripes for beachball via shader or
  // multi-material, torus for ring w/ stripes, open cup with visible cavity,
  // rounded-box sponge with holes texture via canvas, etc.)
  // obj.userData.def = def. Origin at geometric center. Cup opening faces +Y.
export function deformToy(obj, amount /* 0..1 squash */, dirY /* squash axis mostly Y */)
  // visual squash-stretch scale, safe to call every frame, amount 0 restores.
```
Make them adorable. Canvas-generated textures allowed (generate once).

## `src/physics.js` — G

```js
export class Physics {
  constructor({ getWaterHeight /* (x,z)=>number */ })
  onImpact = null      // (spec) => void        — set by main
  onResurface = null   // (pos:Vector3, def) => void
  onState = null       // (body, state) => void  (optional)
  spawnToy(def, position /* Vector3 */) // → body (creates mesh via toys.js)
  grab(body)                    // freeze physics, state 'held'
  dragTo(body, position)        // follow pointer while held (smooth)
  release(body, velocity)       // apply AIM-ASSIST (below), state 'flying'
  removeBody(body)
  bodies                        // array
  update(dt)
}
// body: { mesh, def, pos, vel, quat, angVel:Vector3, state:'held'|'flying'|'inwater'|'floating'|'sunk' }
```
- Ballistic flight with G, tumbling from `angVel` (given at release from
  drag gesture; light/flat toys tumble more, add slight wobble).
- **Aim assist:** after release, if the ballistic landing point would fall
  outside `0.82 * POOL.WATER_RADIUS` (or before the pool), bend the
  horizontal velocity/direction so it lands inside — smooth, invisible,
  never lets a throw miss the water.
- Crossing y=0 downward → build ImpactSpec (formulas above) → `onImpact(spec)`.
- Underwater: buoyancy = (1/density - 1) * G * damping, quadratic drag,
  cup/ring extra drag. Sinkers settle to floor (y = -POOL.DEPTH + r) with a
  soft thud. Floaters rise; when crossing y≈0 upward with speed →
  `onResurface(pos, def)` + become 'floating': bob using
  `getWaterHeight(x,z)`, slight drift, gentle rocking. Big floaters
  (beachball) may hop once producing a small **secondary** impact:
  re-crossing downward emits onImpact with `isSecondary: true` and reduced
  energy.
- Soft toys: call `deformToy` — squash on impact, jiggle-decay after
  (spring). `softness` scales it.
- Cup orientation matters: track orientation to compute `cupTrap`/`flatness`.
- Cap ~6 live bodies; oldest resting/floating body fades out & removed.

## `src/input.js` — H

```js
export class InputController {
  constructor({ dom, getCamera, physics, sceneEnv, audio, onPlatformChange })
  update(dt)
  currentToyDef; currentPlatformId
}
```
- **UI (DOM overlay, no framework):** a bottom row of BIG toy buttons
  (emoji, ≥72px, rounded, colorful, current one highlighted+bounce) and a
  side column of 3 BIG platform-height buttons (🪜 low/mid/high visual).
  Touch-friendly, safe-area aware, works portrait & landscape. Selecting a
  platform calls `onPlatformChange(id)` and respawns the held toy at that
  platform's tip; selecting a toy swaps it.
- A fresh toy always hovers at the current platform tip (spawn via
  `physics.spawnToy`, then `grab`). Pointer down near it (generous radius,
  raycast against its mesh with big sphere tolerance) → grab; drag moves it
  in a camera-facing plane (physics.dragTo); release → velocity from the
  last ~90ms of pointer movement (clamped, scaled for a nice arc) →
  `physics.release`. A tap-then-release with no movement = straight drop.
  Downward flicks = strong downward throw. After release, spawn the next
  toy at the tip after ~1.2s.
- Call `audio.unlock()` on first pointerdown; `audio.onGrab/onRelease`.

## `src/cameraFX.js` + `src/audio.js` — I

```js
export class CameraFX {
  constructor(renderer)
  camera            // PerspectiveCamera
  timeScale         // number, main multiplies dt by this
  onImpact(spec)    // hit-stop ~70ms (timeScale≈0.02), then slow-mo ≈0.22
                    // for ~1.1s, ease back to 1. Camera: quick push toward
                    // splash point; during slow-mo optionally dip just
                    // below surface looking at the cavity, then rise back.
  setFocus(point)   // aim point (held toy / flying toy), smooth follow
  update(dtReal, time)
  handleResize(w, h)
}
```
Default view: from +X side (opposite the tower), slightly high, framing
pool + platforms. Portrait: pull back / raise FOV so tower & pool both fit.
Never controllable by the child (no orbit). Smooth, springy, never sick.

```js
export class AudioFX {
  unlock()                 // create/resume AudioContext (call on first touch)
  onGrab(def); onRelease(def)
  onImpact(spec)           // procedural WebAudio: filtered-noise splash
                           // scaled by energy; flatness → slap; cupTrap →
                           // "glug"; heavy → deep boom; pingpong → light
                           // plip; jelly → wet squelch. Layer 2-3 synth
                           // parts. Haptics: navigator.vibrate scaled by
                           // energy (guard for iOS absence).
  onResurface(def)         // pop!
  onJet()                  // optional whoosh (main may not call it)
}
```
No audio files — synthesize everything (noise buffers, oscillators,
biquads). Keep master gain safe (~0.5), no clipping.

## `src/main.js` — A

Bootstrap: renderer (antialias, ACESFilmic, sRGB), scene, all modules wired
exactly per contracts; the real→scaled time loop
(`dtScaled = min(dtReal, 1/30) * cameraFX.timeScale`); resize/orientation
handling; forwards physics callbacks:
```js
physics.onImpact = (spec) => {
  water.addRipple(spec.point.x, spec.point.z, Math.min(1, spec.energy + 0.15));
  splash.trigger(spec); underwater.trigger(spec);
  cameraFX.onImpact(spec); audio.onImpact(spec);
};
physics.onResurface = (pos, def) => {
  water.addRipple(pos.x, pos.z, 0.3);
  underwater.triggerResurface(pos, def); audio.onResurface(def);
};
splash.onDropletLand = (x, z, r) => water.addRipple(x, z, 0.06);
```
`cameraFX.update` gets REAL dt; everything else gets scaled dt.
Also a tiny title overlay (DOM, fades after 2s, game already interactive).

**Debug API (mandatory, for automated tests):**
```js
window.__lab = {
  ready: true,                    // set when first frame rendered
  errors: [],                     // push window.onerror strings
  drop(toyId, platformId, vx=0, vy=0, vz=0), // programmatic: spawn toy at
                                  // platform tip, release with velocity
  state()                         // { bodies: n, lastImpact: spec-ish plain object, fps }
}
```

## Verification

Integration is tested headless (Playwright + local static server) via
`window.__lab`. Keep everything working under `python3 -m http.server`.
