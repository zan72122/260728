// main.js — AQUA VELOCITY integration root.
//
// Wires every module together per SPEC.md section 4. Responsibilities:
//   - boot the renderer/scene, build the track meshes, hook up player/FX/
//     audio/UI modules
//   - drive the game flow LOADING -> TITLE (cinematic flythrough) -> RIDE ->
//     FINISH (slow-mo) -> result screen
//   - step the fixed-timestep physics loop and the variable-rate render loop
//   - surface any startup failure on screen (this module intentionally has
//     no other file's internals to fall back on, so it wraps its own boot
//     sequence in try/catch per the project brief)

import * as THREE from 'three';

import { createEngine } from './core/Engine.js';
import { createLoop } from './core/Loop.js';
import { Input } from './core/Input.js';
import { PHASE, GameState } from './core/GameState.js';

import { SplineTrack } from './track/SplineTrack.js';
import { TRACK_DESIGN, SECTION_BOUNDS } from './track/TrackDesign.js';

import { RiderPhysics } from './player/RiderPhysics.js';
import { RiderModel } from './player/RiderModel.js';
import { ChaseCamera } from './player/ChaseCamera.js';

import {
  createFlowingWaterMaterial,
  updateWater,
  poolSplash,
} from './render/WaterMaterial.js';
import { createSky } from './render/Sky.js';
import { createLighting } from './render/Lighting.js';
import { createEnvironment } from './render/Environment.js';
import { createProps } from './render/Props.js';
import { createChuteMaterial, createShellMaterial } from './track/TrackMaterial.js';

import { SprayParticles } from './fx/SprayParticles.js';
import { createPostFX } from './render/PostFX.js';

import { AudioEngine } from './audio/AudioEngine.js';
import { Hud } from './ui/Hud.js';
import { Screens } from './ui/Screens.js';

// ---------------------------------------------------------------------
// tuning constants
// ---------------------------------------------------------------------

const FIXED_DT = 1 / 120; // physics timestep (SPEC 4.12)
const MAX_SUBSTEPS = 8;

const SLOWMO_DURATION = 0.6; // real seconds
const SLOWMO_SCALE = 0.25; // physics/animation timeScale during slow-mo

const TITLE_FLYTHROUGH_SPEED = 14; // virtual dolly speed, m/s along track s
const TITLE_CAM_HEIGHT = 3.4; // meters above the track surface (along normal)
const TITLE_CAM_SIDE = 5.5; // meters offset sideways (along binormal)
const TITLE_LOOKAHEAD = 7; // meters ahead the camera looks at
const TITLE_FOV = 62;
const RIDE_BASE_FOV = 75;

const SPRAY_AMOUNT_SCALE = 34; // particles per emit() call at splashRate=1

const ZERO_INPUT = Object.freeze({ steer: 0, tuck: 0, brake: 0 });

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Calls audioEngine.start() on the first user gesture (WebAudio autoplay policy). */
function armAudioUnlock(audioEngine) {
  let started = false;
  const unlock = () => {
    if (started) return;
    started = true;
    audioEngine.start().catch((err) => {
      console.warn('[AQUA VELOCITY] audioEngine.start() failed:', err);
    });
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
}

// Integration fix: Hud.js's own section-name-from-progress fallback
// (sectionForFraction) uses hand-guessed fraction thresholds because it has
// no access to the real per-section s-ranges A2's course generator computes
// (TrackDesign.js's SECTION_BOUNDS) — Hud.js's own contract (SPEC 4.11)
// explicitly defers to `extra.sectionName` when supplied, so this module
// (which does have TRACK_DESIGN) supplies the real one instead of leaving
// the guess in charge (it was visibly wrong for a ~90m stretch each at the
// B/C and C/D seams — e.g. showing "ボウル / ウェーブ" while still well
// inside the dark tunnel).
const SECTION_LABELS = {
  A: 'ローンチ',
  B: '高速ヘリックス',
  C: 'ダークトンネル',
  D: 'ボウル / ウェーブ',
  E: 'エアタイム区間',
  F: 'ラストドロップ',
};
function sectionNameForS(s) {
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const [s0, s1] = SECTION_BOUNDS[key];
    if (s < s1 || key === 'F') return SECTION_LABELS[key];
    void s0;
  }
  return SECTION_LABELS.F;
}

// Chute/shell (the solid slide tube) need a Mesh + PBR material; SplineTrack
// only hands back raw BufferGeometry for them (SPEC 4.1). Integration fix:
// this used to build its own generic single-colour material from
// fiberglassTextures() directly, which silently dropped TrackMaterial.js's
// per-section colour blend (SPEC "ローンチ=青 → ヘリックス=ターコイズ →
// トンネル=濃紺 → ラスト=白"). createChuteMaterial(track)/createShellMaterial()
// give a strictly better result (region colour + otherwise the same FRP
// look) and envMap is applied the same way main.js always applied it, so
// this is now a straight call into A2's dedicated module instead.
function applyEnvMap(material, envMap, intensity) {
  if (envMap) material.envMap = envMap;
  if (intensity != null) material.envMapIntensity = intensity;
  return material;
}

// ---------------------------------------------------------------------
// fatal error UI (works even if boot() fails before Screens/Hud exist)
// ---------------------------------------------------------------------

let bootStage = 'starting up';

function showFatalError(err) {
  // eslint-disable-next-line no-console
  console.error(`[AQUA VELOCITY] fatal error during "${bootStage}":`, err);

  const loadingEl = document.getElementById('initial-loading');
  if (loadingEl) loadingEl.classList.add('hidden');

  const fallbackEl = document.getElementById('boot-fallback');
  if (!fallbackEl) return;

  const webglEl = err && err.webglMessageElement instanceof HTMLElement ? err.webglMessageElement : null;
  const detailEl = document.getElementById('boot-fallback-detail');
  const messageEl = document.getElementById('boot-fallback-message');

  if (webglEl) {
    webglEl.id = 'boot-fallback-detail';
    webglEl.style.background = 'rgba(255,255,255,0.06)';
    webglEl.style.color = '#eaf6ff';
    webglEl.style.border = '1px solid rgba(255,255,255,0.18)';
    webglEl.style.borderRadius = '12px';
    webglEl.style.width = 'auto';
    webglEl.style.maxWidth = '28rem';
    webglEl.style.margin = '1em auto 0';
    if (detailEl) detailEl.replaceWith(webglEl);
  } else if (detailEl) {
    const detail = (err && (err.stack || err.message)) || String(err);
    detailEl.textContent = `[${bootStage}] ${detail}`;
    if (messageEl) {
      messageEl.textContent = '予期しないエラーが発生しました。ページを再読み込みしてください。';
    }
  }

  fallbackEl.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------

async function boot() {
  const appEl = document.getElementById('app');
  const uiRootEl = document.getElementById('ui-root');
  if (!appEl || !uiRootEl) {
    throw new Error('index.html に #app / #ui-root が見つかりません。');
  }

  bootStage = 'engine';
  const engine = createEngine(appEl);
  const { renderer, scene, camera } = engine;

  bootStage = 'ui shell';
  const hud = new Hud(uiRootEl);
  const screens = new Screens(uiRootEl, {
    onStart: () => startRide(),
    onRestart: () => startRide(),
  });
  hud.setVisible(false);
  screens.showLoading(0);
  const initialLoadingEl = document.getElementById('initial-loading');
  if (initialLoadingEl) initialLoadingEl.classList.add('hidden');
  await nextFrame();

  bootStage = 'track';
  const track = new SplineTrack(TRACK_DESIGN);
  screens.showLoading(15);
  await nextFrame();

  bootStage = 'sky & lighting';
  const skyResult = createSky(scene, renderer);
  const lighting = createLighting(scene, skyResult.sunDirection);
  scene.environment = skyResult.envMap || null;
  if (skyResult.sky) scene.add(skyResult.sky);
  screens.showLoading(30);
  await nextFrame();

  bootStage = 'track meshes';
  const chuteMesh = new THREE.Mesh(
    track.buildChuteGeometry(),
    // V4: envMapIntensity now stays at the value TrackMaterial itself sets
    // (0.5) — the old 1.1 override was a major contributor to the all-white
    // washout (bright-sky IBL mirrored across the whole chute interior).
    applyEnvMap(createChuteMaterial(track), skyResult.envMap)
  );
  chuteMesh.name = 'chute';
  chuteMesh.castShadow = true;
  chuteMesh.receiveShadow = true;
  scene.add(chuteMesh);

  const shellMesh = new THREE.Mesh(
    track.buildShellGeometry(),
    applyEnvMap(createShellMaterial(), skyResult.envMap, 0.55)
  );
  shellMesh.name = 'shell';
  shellMesh.receiveShadow = true;
  scene.add(shellMesh);

  const waterMesh = new THREE.Mesh(
    track.buildWaterGeometry(),
    createFlowingWaterMaterial({ envMap: skyResult.envMap, track })
  );
  waterMesh.name = 'chuteWater';
  scene.add(waterMesh);

  const supports = track.buildSupports();
  if (supports) scene.add(supports);

  // Integration fix: this block used to build its own flat "landingPool"
  // disc from TRACK_DESIGN.poolCenter/poolRadius directly. Environment.js's
  // buildPool() (called below, in the "environment & props" stage) already
  // builds the real pool at the same coordinates — walls, floor, steps,
  // handrail, and its own createPoolWaterMaterial() water surface — so this
  // was a second, plain water disc floating ~0.5m above the real one
  // (Y=0.6 hardcoded here vs. Environment's Y ~= baseHeight+0.05) with a
  // mismatched ripple centre (this mesh never passed center/radius to
  // createPoolWaterMaterial, so poolSplash() ripples rendered at the
  // origin instead of the real pool). Removed; Environment.js owns the pool.
  screens.showLoading(55);
  await nextFrame();

  bootStage = 'environment & props';
  const environment = createEnvironment(scene, track, skyResult.envMap);
  if (environment && environment.group) scene.add(environment.group);
  const props = createProps(track, skyResult.envMap);
  if (props) scene.add(props);
  screens.showLoading(72);
  await nextFrame();

  bootStage = 'player';
  // Approximate world-space pool-water landing point (integration fix, see
  // the finish-easing block in RiderPhysics.js#_syncPose): TRACK_DESIGN only
  // gives us the pool's x/z + a nominal y that Environment.js's real terrain
  // sampler doesn't actually use, so this is a close approximation of the
  // real water surface, not an exact read of it — good enough for a smooth
  // cosmetic ease, not meant to be pixel-perfect.
  const poolLandingPos = new THREE.Vector3(
    TRACK_DESIGN.poolCenter[0],
    0.1,
    TRACK_DESIGN.poolCenter[2]
  );
  const physics = new RiderPhysics(track, { poolLandingPos });
  physics.reset();
  const riderModel = new RiderModel();
  scene.add(riderModel.object3D);
  riderModel.setVisible(false);
  const chaseCamera = new ChaseCamera(camera, track, physics);
  chaseCamera.setMode('chase');
  screens.showLoading(84);
  await nextFrame();

  bootStage = 'fx';
  // V4 fix: pass the renderer so SprayParticles reads the real drawing-buffer
  // height for its point-size math (it used to fall back to
  // window.innerHeight * dpr, which drifts from the composer's size).
  const spray = new SprayParticles(scene, { renderer });
  if (spray.object3D) scene.add(spray.object3D);
  // Integration fix: this used to also construct its own standalone
  // LensDroplets() here, but its `.pass` was never added to any
  // EffectComposer (createPostFX() below builds its own separate
  // LensDroplets instance internally and wires *that* one's pass into the
  // real composer chain per SPEC 4.9) — this stray instance rendered
  // nothing and its update() call below was pure dead work every frame.
  const postfx = createPostFX(renderer, scene, camera);
  screens.showLoading(93);
  await nextFrame();

  bootStage = 'audio';
  const audioEngine = new AudioEngine();
  armAudioUnlock(audioEngine);
  screens.showLoading(98);
  await nextFrame();

  bootStage = 'input & state';
  const input = new Input(renderer.domElement);
  const gameState = new GameState();

  function handleResize() {
    const w = appEl.clientWidth || window.innerWidth;
    const h = appEl.clientHeight || window.innerHeight;
    postfx.setSize(w, h);
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  // -------------------------------------------------------------------
  // run-time state
  // -------------------------------------------------------------------

  // --- tunnel ambience (V4) ------------------------------------------
  // The tunnel used to rely on PostFX exposure alone to feel dark; the
  // scene's own lighting (IBL envMap baked from the open sky + hemisphere
  // fill) kept illuminating the closed tube at full outdoor strength, so
  // the "dark tunnel" read as a white pipe. Cross-fade the scene-level
  // ambient terms down while inside; the sun stays, so the light-slit
  // shafts and their moving pools of light become the tunnel's look.
  const hemiBaseIntensity = lighting.hemi ? lighting.hemi.intensity : 0;
  let tunnelBlend = 0;
  function updateTunnelAmbience(dt, inTunnel) {
    tunnelBlend = THREE.MathUtils.damp(tunnelBlend, inTunnel ? 1 : 0, inTunnel ? 2.4 : 1.6, dt);
    scene.environmentIntensity = THREE.MathUtils.lerp(1.0, 0.22, tunnelBlend);
    if (lighting.hemi) {
      lighting.hemi.intensity = hemiBaseIntensity * THREE.MathUtils.lerp(1.0, 0.3, tunnelBlend);
    }
  }

  let accumulator = 0;
  let titleS = 0;
  let wasFinished = false;
  let slowMoActive = false;
  let slowMoTimer = 0;
  let pendingResult = null;
  let loop = null;

  function titleCameraTarget(s) {
    const frame = track.frameAt(s);
    return frame.position
      .clone()
      .addScaledVector(frame.normal, TITLE_CAM_HEIGHT)
      .addScaledVector(frame.binormal, TITLE_CAM_SIDE);
  }

  function enterTitlePhase() {
    gameState.phase = PHASE.TITLE;
    titleS = 0;
    camera.fov = TITLE_FOV;
    camera.updateProjectionMatrix();
    camera.position.copy(titleCameraTarget(titleS));
    camera.lookAt(track.frameAt(titleS + TITLE_LOOKAHEAD).position);
    riderModel.setVisible(false);
    hud.setVisible(false);
    screens.showTitle();
  }

  function updateTitleFlythrough(dt) {
    titleS += dt * TITLE_FLYTHROUGH_SPEED;
    if (titleS > track.length) titleS -= track.length;

    const target = titleCameraTarget(titleS);
    const smoothing = 1 - Math.pow(0.0025, dt);
    camera.position.lerp(target, smoothing);
    camera.lookAt(track.frameAt(titleS + TITLE_LOOKAHEAD).position);
  }

  function startRide() {
    physics.reset();
    gameState.startRide();
    wasFinished = false;
    accumulator = 0;
    slowMoActive = false;
    slowMoTimer = 0;
    pendingResult = null;

    screens.hideAll();
    hud.setVisible(true);
    riderModel.setVisible(true);
    chaseCamera.setMode(gameState.cameraMode);
    camera.fov = RIDE_BASE_FOV;
    camera.updateProjectionMatrix();
    audioEngine.playWhoosh();
  }

  function beginFinishSequence() {
    pendingResult = gameState.finish();
    slowMoActive = true;
    slowMoTimer = 0;
    // Integration fix: poolSplash() (WaterMaterial.js) and playSplash()
    // (AudioEngine.js) were both fully implemented but never called from
    // anywhere, so the landing pool never actually rippled and no splash
    // sound played on finish — only the (unrelated) finish chime did.
    const impactSpeed = Math.max(1, physics.state.speed || 0);
    poolSplash(poolLandingPos, THREE.MathUtils.clamp(impactSpeed / 14, 0.6, 2.5));
    audioEngine.playSplash(THREE.MathUtils.clamp(impactSpeed / 16, 0.5, 2));
    audioEngine.playFinish();
  }

  function currentFrameContext() {
    const isRiding = gameState.phase === PHASE.RIDE || gameState.phase === PHASE.FINISH;
    const s = isRiding ? physics.state.s : titleS;
    const frame = track.frameAt(s);
    return {
      isRiding,
      s,
      lateral: isRiding ? physics.state.lateral : 0,
      speed: isRiding ? physics.state.speed : TITLE_FLYTHROUGH_SPEED,
      gForce: isRiding ? physics.state.gForce : 1,
      airborne: isRiding ? physics.state.airborne : false,
      tunnel: !!frame.tunnel,
      splashRate: isRiding ? physics.state.splashRate : 0,
      focusPos: isRiding ? physics.state.position : frame.position,
    };
  }

  function emitSpray() {
    const st = physics.state;
    if (!st.contactPoint || !st.forward || !st.up || st.splashRate <= 0.001) return;

    const right = new THREE.Vector3().crossVectors(st.forward, st.up).normalize();
    const jitter = (Math.random() - 0.5) * 1.6 + st.lateralVel * 0.04;
    const dir = st.forward.clone().multiplyScalar(-1).addScaledVector(right, jitter).normalize();
    const amount = Math.max(1, Math.round(st.splashRate * SPRAY_AMOUNT_SCALE));
    spray.emit(st.contactPoint, dir, amount, st.speed);
  }

  function step(dt) {
    try {
      // --- global toggles -------------------------------------------
      if (input.justPressed('KeyM')) {
        audioEngine.setMuted(gameState.toggleMuted());
      }
      if (input.justPressed('KeyC')) {
        chaseCamera.setMode(gameState.toggleCameraMode());
      }
      if (input.justPressed('KeyR') && (gameState.phase === PHASE.RIDE || gameState.phase === PHASE.FINISH)) {
        startRide();
      }
      if (gameState.phase === PHASE.TITLE && input.justPressed('Space')) {
        startRide();
      }

      // --- finish slow-mo timescale -----------------------------------
      let timeScale = 1;
      if (slowMoActive) {
        timeScale = SLOWMO_SCALE;
        slowMoTimer += dt;
        if (slowMoTimer >= SLOWMO_DURATION) {
          slowMoActive = false;
          hud.setVisible(false);
          screens.showResult(pendingResult);
        }
      }
      // `simDt` is "simulated world" time: real dt scaled by the slow-mo
      // timeScale. Everything that represents the world (physics, camera,
      // rider, water, spray, environment, sky/lighting, audio, postfx) is
      // driven by simDt so the whole scene slows down together during the
      // finish slow-mo — only input polling, the slow-mo timer itself, and
      // the wall-clock race timer (gameState) stay on real dt.
      const simDt = dt * timeScale;

      // --- phase-specific camera + fixed-step physics -----------------
      if (gameState.phase === PHASE.TITLE) {
        updateTitleFlythrough(simDt);
      } else if (gameState.phase === PHASE.RIDE || gameState.phase === PHASE.FINISH) {
        accumulator += simDt;
        let steps = 0;
        while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
          physics.update(FIXED_DT, gameState.phase === PHASE.RIDE ? input.value : ZERO_INPUT);
          accumulator -= FIXED_DT;
          steps += 1;
        }
        if (steps >= MAX_SUBSTEPS) accumulator = 0; // avoid spiral of death

        gameState.update(dt, physics.state);

        if (gameState.phase === PHASE.RIDE && physics.state.finished && !wasFinished) {
          wasFinished = true;
          beginFinishSequence();
        }

        chaseCamera.update(simDt);
        riderModel.update(simDt, physics.state);
      }

      // --- shared per-frame updates (all phases) -----------------------
      const ctx = currentFrameContext();

      updateWater(simDt, { riderS: ctx.s, riderLateral: ctx.lateral, speed: ctx.speed });

      // V4 fix: forward the real sun direction — without it the spray
      // shader's backlit glow / sun glints used a hardcoded default that
      // pointed nowhere near the actual sun (Sky.js: elevation 38°,
      // azimuth 145°).
      if (ctx.isRiding) emitSpray();
      spray.update(simDt, camera, { sunDirection: skyResult.sunDirection });

      environment.update(simDt, ctx.focusPos);
      if (props && props.userData && props.userData.update) props.userData.update(simDt);
      skyResult.update(simDt);
      lighting.update(simDt, ctx.focusPos);
      updateTunnelAmbience(simDt, ctx.tunnel);

      audioEngine.update(simDt, {
        speed: ctx.speed,
        splashRate: ctx.splashRate,
        airborne: ctx.airborne,
        tunnel: ctx.tunnel,
        gForce: ctx.gForce,
      });

      hud.update(physics.state, {
        timeMs: gameState.timeMs,
        bestMs: gameState.bestMs,
        trackLength: track.length,
        sectionName: physics.state.finished ? 'フィニッシュ' : sectionNameForS(ctx.s),
      });

      postfx.update(simDt, {
        speed: ctx.speed,
        gForce: ctx.gForce,
        airborne: ctx.airborne,
        tunnel: ctx.tunnel,
        splashRate: ctx.splashRate,
      });
      postfx.render(simDt);
    } catch (err) {
      if (loop) loop.stop();
      showFatalError(err);
    }
  }

  screens.showLoading(100);
  await nextFrame();

  bootStage = 'title';
  enterTitlePhase();

  loop = createLoop(step);
  loop.start();
}

try {
  await boot();
} catch (err) {
  showFatalError(err);
}
