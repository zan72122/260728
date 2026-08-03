# Mega Splash Tier「そらのだい」— Contract Addendum (v4)

Approved: a 4th selectable launch spot — a BALLOON GONDOLA ("そらのだい", sky
platform) very high above the pool — from which GIANT versions of toys are
dropped, producing a 7-phase "depth-charge" mega splash (A1) with deck
overflow (B1), one-shot companion camera (E2+E3 rabbit reaction cut), and
silence-then-boom audio. Giant toys wave 1: giantheavy (2.2m), giantjelly
(2.5m, splits on impact), giantbeach (3.0m, dramatic resurface).

PROTECTED (regression = failure): every existing verified behavior — normal
platforms/toys causality numbers and seeds must not change AT ALL; photoreal
splash for normal impacts unchanged; rabbit workflow on low/mid/high
unchanged; __lab API backward compatible. All prior contracts still apply
unless overridden here.

## Shared definitions

- constants.js (architect-owned; M1 may append EXACTLY this):
```js
export const SKY = { id: 'sky', height: 26.0, drop: { x: -1.2, y: 26.0, z: 0 } };
```
- ImpactSpec extension (computed by physics, M4): for defs with `def.mega`,
  spec gains `mega: true` and `megaScale` = def.radius / 0.35 (so giantheavy
  ≈ 6.3). Non-mega specs are BIT-IDENTICAL to today (add nothing).
- Terminal velocity: mega bodies cap fall speed at 18 m/s (air drag), so
  energy formula saturates gracefully; spec.speed reflects the capped value.
- Mega impact routing (main, M5): if spec.mega → megasplash.trigger(spec) +
  water.megaImpact(...) + underwater.triggerMegaJet(spec) + cameraFX/audio
  mega paths + gameflow mega splashView preset. Normal splash/underwater
  trigger calls are SKIPPED for mega impacts (megasplash owns the moment,
  but may internally reuse droplets/spray via waterCtx).

## File ownership

| Owner | Files |
|---|---|
| M1 | src/scene.js (balloon+clouds+sky), src/rabbit.js (gondola ride, giant crate, heave-throw), append SKY to src/constants.js |
| M2 | src/megasplash.js (NEW), src/underwater.js (add triggerMegaJet only) |
| M3 | src/water.js (mega wave, sloshing, surface-foam field, overflow) |
| M4 | src/toys.js (3 giant defs + meshes), src/physics.js (mega handling, split, resurface surge, terminal velocity) |
| M5 | src/gameflow.js, src/cameraFX.js, src/audio.js, src/input.js, src/main.js (wiring + routing) |
| M6 | integration/verification; README |

## M1 — balloon, sky access, rabbit

- Balloon: cute striped hot-air balloon + gondola basket, moored beside the
  tower top (visible from game start, gently bobbing). A GIANT CRATE (≈4x
  normal crate, "おおきい" star mark) sits in/beside the gondola.
- `SceneEnv` gains `balloon` object with API:
  `balloon.rideTo(altitude01, dtCallbackless)` — M1 implements as:
  `balloon.setProgress(p /*0..1*/)` positions balloon+gondola between moored
  pose (p=0) and sky drop pose (p=1: gondola floor near SKY.drop, hovering
  over the pool), plus `balloon.group`. Ascent/descent ANIMATION TIMING is
  driven by gameflow (M5) calling setProgress each frame — keep balloon
  itself stateless. Two cloud LAYERS (flat ring/blob meshes at y≈10 and 18,
  a few per layer) that the camera/balloon pass through; cheap, no shader
  tricks required beyond opacity.
- Rabbit additions (same class): `boardGondola(onDone)` / `exitGondola(onDone)`
  (walk/hop into basket at current balloon position), `fetchGiantToy(onTakeOut,
  onDone)` (two-arm heave from the giant crate, staggering under the weight —
  comically heavy), `heaveThrow(onRelease, onDone)` (slower, whole-body push
  ~0.8s, big anticipation squash). Rabbit rides: while gondola-riding, rabbit
  root follows balloon.gondolaAnchor (Object3D M1 exposes). pawAnchor while
  holding a giant toy: above head but offset so the giant mesh doesn't clip
  the balloon (M1 tunes; toy radius up to 1.5).
- Keep draw-call growth ≤ 12. node --check + dev/balloon-test.html visual
  check (balloon at p=0/0.5/1, rabbit boarding, giant heave) via playwright.

## M2 — megasplash.js + mega jet

`export class MegaSplashFX { constructor(scene, waterCtx); trigger(spec);
isActive(); update(dt, time) }` — owns phases ①②⑤⑦-support and schedules
calls it needs (main routes water/underwater/audio; megasplash may call
waterCtx.droplets directly for rain):
- ① Impact disc (0-0.15s): huge fast thin sheet (reuse crown-sheet shader
  approach at megaScale) + 1-frame white flash sprite.
- ② White dome (0.1-0.8s): hemisphere mesh (lathe ~48x20) expanding to
  radius ≈ 1.4*def.radius+1.0, waterShade with foam≈1 (solid white boiling
  look, slight refraction at lower rim), surface roil via vertex noise;
  collapse into ④'s base.
- ⑤ Mushroom rain (3-5s): when the mega jet tip collapses (time-based, no
  cross-module event needed: schedule at t≈3.0s), emit repeated
  droplets.emit + emitSpray bursts falling pool-wide (origin ring around
  column top); recycle within existing droplet capacity (shorter lives).
- ⑦ support: nothing to render (water owns whitening) but keep isActive()
  true until ~5s so pass-2 stays on while visible elements live.
- Deterministic macro from mulberry32(spec.seed). Pool 1 concurrent mega
  (a second mega trigger while active: replace). ≤6 draw calls.
- underwater.js: add `triggerMegaJet(spec)` — reuse the jet system with mega
  params: column diameter ≈ 0.5*def.radius, height 6-8m, start delay ≈1.2s,
  pinch at ≈3.0s ejecting 4-6 big satellite drops, base mound wider; plus
  bigger/longer bubble output. Normal trigger() path untouched.

## M3 — water.js mega extensions

Add (all no-ops for normal play; existing API/visuals unchanged):
- `megaImpact(x, z, strength01)`: launches (a) ONE annular WALL WAVE:
  large-amplitude (up to ~0.9m) solitary ring in the vertex shader (separate
  uniform slot from the 12 normal ripples), speed ~2.2 m/s, steep front,
  breaks into edge foam when its radius reaches WATER_RADIUS (trigger (b)
  and (c) then); (b) DECK OVERFLOW: a thin expanding foam-white ring mesh
  just above the deck around the rim, sliding outward ~0.8m then retreating
  (~1.5s, translucent white, cheap — this is the B1 visual); (c) SLOSHING:
  first-mode standing wave of the whole pool surface (tilt term
  A*sin(ωt)e^{-λt} along the impact direction, A≈0.15m, ~3 periods over
  ~4-6s) — also exposed as `sloshOffsetAt(x,z)` so physics can rock
  floating bodies; (d) SURFACE FOAM FIELD: radial whitening of the surface
  (foam tint in the fragment shader, radius-based mask from impact point,
  fading over ~10-12s with a bubbly noise texture feel).
- `displacementAt` must include wall wave + sloshing (physics bobbing).
- Budget: still ONE surface draw call (+1 for the overflow ring mesh).

## M4 — giant toys + physics

- toys.js: 3 new ToyDefs with `mega: true`, NOT in the normal 8-button
  lineup array order — append at end with `sky: true` flag so input can
  show them only in sky mode: giantheavy {sphere r=1.1 d=2.6}, giantjelly
  {sphere r=1.25 d=1.05 softness 1}, giantbeach {sphere r=1.5 d=0.05}.
  Meshes: scaled-up variants of the existing looks (reuse texture/material
  builders; giantjelly gets inner wobble bones via vertex-less scale wobble).
  (Existing TOYS array + ids untouched → button row unchanged in normal mode.)
- physics.js: mega bodies — terminal velocity 18 m/s; spec.mega/megaScale;
  giantjelly ON IMPACT: after emitting the (mega) spec, remove the body and
  spawn 6 fragment bodies (normal jelly def clones at r≈0.35-0.5, seeded
  directions outward+up) whose re-entries produce NORMAL secondary impacts
  (isSecondary true) — the "rain of jelly"; giantbeach: submerges deep
  (extra allowed depth), then resurfaces fast — on upward y=0 crossing emit
  onResurface AND a special big hop (vel.y up to ~5) causing one more
  normal-path secondary impact; floating giants bob using water
  displacementAt + sloshOffsetAt (guarded typeof). Mega bodies bypass the
  6-body cap counting (count as 1 but expire: giants fade+remove ~8s after
  settling). Aim assist for sky drops: clamp landing inside 0.55*WATER_RADIUS
  (big objects need center room).

## M5 — flow / camera / audio / input / main

- gameflow.js: new flow branch. `requestPlatform('sky')` → state 'busy':
  rabbit walks/climbs to tower top, boardGondola, gameflow drives
  balloon.setProgress 0→1 over ~4.5s (ease, REAL time), fetchGiantToy of
  currentGiantDef (default giantheavy) → 'ready' (sky mode flag
  `skyMode=true`). Aiming allowed as usual; commitThrow → heaveThrow.
  Flight: longer. notifyImpact with spec.mega → 'splashView' MEGA PRESET:
  clamp [6.0, 9.0]s REAL. Return: camera returns to a wide view; balloon
  auto-descends (progress→0 over ~4s) with rabbit riding; at dock →
  exitGondola → rabbit fetches at previous normal platform... SIMPLER
  (approved UX): after mega splashView, balloon stays UP and rabbit fetches
  the next giant toy in the gondola → repeat sky throws until the child
  taps a normal board (then balloon descends first, ~amusing, then normal
  flow). Implement THAT. requestToy while skyMode: giant defs only.
  Expose `skyMode`, currentGiantDef. __lab additions: flowState() gains
  skyMode; `__lab.megaDrop(giantToyId)` = spawn at SKY.drop + release (0,0,0)
  bypassing rabbit for tests.
- cameraFX.js: `ascendView(getGondolaPos)` (frame balloon rising, world
  shrinking below); followFlight already exists — extend internally for mega
  (start very high, longer; pass through cloud layers close); mega
  splashView preset: wider framing (column 8m must fit: distance ~8-11m,
  or dynamic by megaScale), the E3 rabbit-reaction: during phase ③ (~1.8s
  in) a ~0.7s cut to the gondola looking down at the rabbit, then back
  (implement as a scripted sub-timeline inside mega splashView); slow-mo
  only phases ①-④ (first ~3s), then timeScale back to 1 for ⑤-⑦.
  `returnFromMega(onDone)` → wide idle-sky view of gondola.
- audio.js: `onMegaImpact(spec)` — 0.3s pre-impact SILENCE dip (duck master
  gain via the flight timeline: expose `preImpactHush()` called by gameflow
  when body is ~0.3s from water), then sub-bass boom (40-70Hz, long decay) +
  layered crash, wall-wave "zabaaa" sweep at ~0.8s, rain loop (filtered
  noise, ~3s) from ~3s, slosh groans; long haptic pattern
  (vibrate([80,60,40,200])-style, guarded). Rabbit cheer call (high pitched
  "waai" synth blip) optional.
- input.js: sky access = tapping the BALLOON (raycast balloon.group +
  screen-space fallback) → requestPlatform('sky'); while skyMode the toy
  bar shows the 3 giant toys (bigger buttons, same behavior); tapping a
  normal board exits sky mode via gameflow. Aim preview: start from
  gameflow.heldBody pos (already does); for sky heights extend arc dot
  count (~22) and clamp preview landing to 0.55*WATER_RADIUS to match M4.
- main.js: mega routing exactly per "Shared definitions"; instantiate
  MegaSplashFX with waterCtx; include megasplash.isActive() in the pass-2
  and gameflow isSplashActive predicates; add megasplash.update; wire
  gameflow preImpactHush timing (gameflow computes from body y/vy each
  frame during mega flight).

## M6 — integration & acceptance

All of M1-M5 standalone-checked; M6 runs the full game:
- __lab.megaDrop('giantheavy'|'giantjelly'|'giantbeach'): 7 phases visible
  in a ~14-frame screenshot series each (READ them): disc+flash, white dome,
  wall wave + deck overflow ring, thick 6-8m column, mushroom rain,
  sloshing (visible waterline tilt across frames), long whitening decay.
  Giantjelly: fragment rain of secondary splashes. Giantbeach: deep sink +
  surge resurface + second wave.
- Full rabbit path: tap balloon → ascent (~4.5s) → aim drag → heave throw →
  long companion fall through cloud layers → mega sequence with rabbit cut →
  stays up for next giant toy; tap mid board → balloon descends → normal
  flow works again.
- REGRESSION GATE (hard): normal-mode causality/determinism numbers
  IDENTICAL to current (heavyball low/mid/high energies 0.872/1.000/1.000,
  seed 2998442878 for heavyball/mid, disc flatness 1.0/0.05, cupTrap
  0.1/1.0); normal splash visuals unchanged (compare screenshots); input
  regression suite passes; zero errors everywhere; perf: draw calls < 110
  during mega peak, particle caps respected; portrait+landscape mega
  screenshots. README updated (そらのだい section + verified/unverified).
