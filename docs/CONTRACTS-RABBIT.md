# Rabbit Experience Overhaul — Contract Addendum (v3)

Approved changes: (1) white rabbit character performs the physical workflow
(climb ladder to a tapped board, take toy from a toy box, hold it, wind up
and THROW with child-given aim), (2) follow-cam during the fall, (3) camera
locked on the splash through its FULL sequence (~3s real) then smooth return,
(4) bottom toy buttons auto-hide during flight/splash; LEFT platform-button
column REMOVED (tap the board itself instead).

UNCHANGED and protected: physics pipeline, ImpactSpec, causality,
determinism, photoreal splash rendering (v2 addendum), audio/haptics,
`window.__lab` test API (`drop()` keeps working WITHOUT the rabbit — it
spawns+releases directly; the state machine must tolerate impacts that had
no throw). docs/CONTRACTS.md and CONTRACTS-SPLASH2.md still apply unless
overridden here.

## Game states (owned by GameFlow)

`ready` (rabbit on a board holding the current toy; aiming allowed) →
`busy` (climbing or fetching; aim disabled, board/toy requests queued—last
wins) → `windup` (throw animation running) → `flight` (toy airborne;
UI hidden; follow-cam) → `splashView` (impact happened; camera locked on
splash; UI hidden; duration: from impact until BOTH splash.isActive() and
underwater.isActive() are false, clamped to [2.0s, 3.5s] REAL time) →
`return` (~1.0s camera pan back; UI fades in; rabbit fetches next toy) →
`ready`. A secondary impact during splashView just extends the clamp window
(re-clamped, max 5s total). `__lab.drop` impacts while `ready`/`busy` force
`splashView` directly (no flight).

## Files & ownership

| File | Owner |
|---|---|
| `src/rabbit.js` (new) | S1 |
| `src/cameraFX.js` (rework view logic; keep slow-mo/hit-stop/dip) | S2 |
| `src/gameflow.js` (new) + `src/main.js` (wiring edits) | S3 |
| `src/input.js` (rework) | S4 |

## `src/rabbit.js` — S1

```js
export class Rabbit {
  constructor(scene, sceneEnv)  // builds rabbit + one toy box per platform
  pawAnchor          // THREE.Object3D; world pos = where a held toy sits (above paws)
  currentPlatformId  // 'low'|'mid'|'high', starts 'mid'
  state              // 'idle'|'climb'|'fetch'|'aim'|'windup'|'cheer'
  climbTo(platformId, onDone)   // walk to ladder, climb, walk to tip; ~0.8-1.6s scaled
  fetchToy(onTakeOut, onDone)   // reach into this platform's box; onTakeOut() fires at the
                                // moment the toy should appear in paws (gameflow spawns it
                                // there); then hold-up pose; onDone() when settled
  stowToy(onStowed)             // put current toy back in box (for toy swap); onStowed()
                                // when the held toy should disappear
  aimLean(dirX, dirZ, strength01) // lean/rotate toward aim; call every frame while aiming; (0,0,0)=neutral
  windupAndThrow(onRelease, onDone) // squash+windup ~0.35s scaled, onRelease() at the exact
                                    // release pose moment (gameflow calls physics.release then),
                                    // follow-through, onDone() at animation end
  cheer()                       // hop + wave (during splashView), auto-returns to idle
  watchPoint(v3 | null)         // head/eyes track a world point (falling toy / splash); null = forward
  update(dt, time)              // SCALED dt
}
```
Design: round white body+head (~0.55m tall), long ears with springy
secondary motion (pink inner), stubby arms/legs, round tail, simple dot
eyes + Y nose. Procedural only (lathe/spheres/capsules, ≤10 draw calls
incl. boxes). Toy boxes: small candy-colored open crates sitting on each
board near the ladder end; lid/interior visible. Rabbit stands near the
board tip; the pawAnchor while holding is ABOVE the head (both paws up) at
roughly the old PLATFORMS tip position so throws originate from a similar
point as before (exact: tip.y + ~0.15). All animation code-driven
(sin/ease curves, no clips). Walks/climbs must never clip through boards.

## `src/cameraFX.js` — S2

Keep: hit-stop/slow-mo timeline in onImpact, underwater dip, shake, tint,
handleResize portrait/landscape, timeScale property. REWORK view-target
logic into modes commanded by GameFlow:

```js
setIdleView(tipPos /*Vector3*/)   // frame current platform tip + pool; default mode
followFlight(getPos /*()=>Vector3*/) // track the falling toy: camera descends/dollies
                                  // with it, keeping toy AND water surface framed,
                                  // arriving at a good splash-viewing pose by entry
splashView(point /*Vector3*/)     // LOCK focus on impact point; composes with the
                                  // existing slow-mo/dip; MUST ignore setFocus/other
                                  // targets until released; frame ~2-4m from point
returnToTower(tipPos, onDone)     // ~1.0s REAL smooth pan back to idle view; onDone() at arrival
```
`setFocus(point)` becomes a no-op while in followFlight/splashView modes
(GameFlow drives). onImpact(spec) still auto-triggers its time effects, but
must NOT change the view mode by itself (GameFlow calls splashView).
Portrait/landscape both must keep the splash large and UNOBSTRUCTED
(nothing else needed on screen during splashView).

## `src/gameflow.js` + main wiring — S3

```js
export class GameFlow {
  constructor({ rabbit, cameraFX, physics, audio, water })
  state; onStateChange = null       // (state, prev) => void
  requestPlatform(id)               // from input (board tap)
  requestToy(def)                   // from input (button)
  currentToyDef
  beginAim(); updateAim(velocity /*Vector3 preview*/); cancelAim()
  commitThrow(velocity /*Vector3*/) // → windup → physics.release at onRelease
  notifyImpact(spec)                // main forwards from physics.onImpact
  update(dt, dtReal)                // state timers use dtReal for splashView/return clamps
  heldBody                          // physics body currently in rabbit's paws (or null)
}
```
GameFlow owns the held toy lifecycle: on fetch onTakeOut → physics.spawnToy
at pawAnchor world pos + physics.grab; every frame while held →
physics.dragTo(body, pawAnchor world pos) so the toy rides the paws
(including during climb? NO — during climb/stow the toy is away: stow
before climbing (toy back in box), fetch after arriving. Keep it simple and
readable). commitThrow: rabbit.windupAndThrow, at onRelease →
physics.release(heldBody, velocity) (aim assist unchanged), state flight,
rabbit.watchPoint follows body, cheer() on impact. notifyImpact → state
splashView + cameraFX.splashView(spec.point). splashView end → 'return' +
cameraFX.returnToTower + rabbit.fetchToy of currentToyDef → 'ready'.
main.js edits (S3): instantiate Rabbit + GameFlow, forward
physics.onImpact ALSO to gameflow.notifyImpact (keep all existing splash/
underwater/camera/audio forwarding), replace the old "input spawns held
toy" bootstrapping (input no longer spawns), pass gameflow to
InputController options as `gameflow`, keep `__lab` fully working and add
`__lab.flowState()` → {state, rabbitState, platform}. cameraFX.setFocus
calls from main: only when gameflow.state === 'ready'/'busy'.
IMPORTANT dt rule: rabbit + gameflow.update get SCALED dt as first arg;
gameflow gets dtReal as 2nd for the splashView/return clamps.

## `src/input.js` — S4

Constructor becomes ({ dom, getCamera, physics, sceneEnv, audio, gameflow }).
- REMOVE the left platform-button column entirely.
- KEEP the bottom toy row (same look/size); selecting → gameflow.requestToy(def).
- AUTO-HIDE: subscribe gameflow.onStateChange — states flight/splashView →
  fade out (opacity 0 + pointer-events none, ~0.25s); return/ready → fade in.
- BOARD TAP: pointer taps (not drags) raycast against sceneEnv.platforms[].focus
  subtree with generous tolerance (plus screen-space fallback: within ~90px of
  a board tip's projection) → gameflow.requestPlatform(id). Boards need no
  visual button chrome; optional subtle pulse highlight on the tappable boards
  when state is ready.
- AIM & THROW (child aims, rabbit throws): while state 'ready', a drag
  ANYWHERE on the 3D view (not starting on a toy button) begins aiming:
  gameflow.beginAim(); drag vector (screen px, from start point) maps to a
  throw velocity — REUSE the existing gesture→velocity mapping/clamps
  (drag right/down-forward = oblique/strong, straight down = plunge; tiny
  drag or plain tap = near-zero straight drop). Every frame: draw a dotted
  trajectory preview (THREE.Line or ~14 small instanced dots, ballistic arc
  from pawAnchor with G, stopping at y=0 with a little splash-target ring)
  and call gameflow.updateAim(vel). Release → remove preview,
  gameflow.commitThrow(vel). Cancel (pointer leaves, or state changed) →
  cancelAim. Multi-touch: first pointer wins.
- Remove the old grab/drag-the-toy-itself code path and the old auto-respawn
  timer (GameFlow owns respawn now).
- Keep audio.unlock on first pointerdown; audio.onRelease at commitThrow.

## Verification (S5, after S1-S4)

- High-platform throw end-to-end: state sequence ready→windup→flight→
  splashView→return→ready with measured splashView ≥2s real; camera focus
  during splashView stays within ~1m of impact point (assert via a test
  hook or screenshot series); NO toy/UI buttons visible in flight/splashView
  screenshots (assert DOM opacity 0 AND visually).
- Board tap moves rabbit (state busy, currentPlatformId changes, toy ends up
  at new tip); toy button swaps toy via box animation.
- Aim drag → oblique impact (spec.oblique > 0), aim assist still lands
  in-pool for violent drags; plain tap → straight drop.
- Full regression: causality numbers (heavyball low/mid/high energies,
  disc flatness), determinism seed, 8-toy smoke via __lab.drop (works
  without rabbit), photoreal splash intact, portrait+landscape, perf
  (draw calls < 90 with rabbit), zero errors. Update scratchpad
  input-verify.mjs expectations to the new scheme. Update README (operation
  section: rabbit workflow, board tap, aim; verified/unverified).
