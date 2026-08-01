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
import { TRACK_DESIGN } from './track/TrackDesign.js';

import { RiderPhysics } from './player/RiderPhysics.js';
import { RiderModel } from './player/RiderModel.js';
import { ChaseCamera } from './player/ChaseCamera.js';

import {
  createFlowingWaterMaterial,
  createPoolWaterMaterial,
  updateWater,
} from './render/WaterMaterial.js';
import { createSky } from './render/Sky.js';
import { createLighting } from './render/Lighting.js';
import { createEnvironment } from './render/Environment.js';
import { createProps } from './render/Props.js';
import { fiberglassTextures } from './render/TextureLab.js';

import { SprayParticles } from './fx/SprayParticles.js';
import { LensDroplets } from './fx/LensDroplets.js';
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

function applyTiling(...textures) {
  for (const tex of textures) {
    if (!tex) continue;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
  }
}

// Chute/shell (the solid slide tube) need a Mesh + PBR material; SplineTrack
// only hands back raw BufferGeometry for them (SPEC 4.1), so this module —
// the integrator — builds the material. TrackMaterial.js's export shape
// isn't part of the documented contract (SPEC section 4 has no entry for
// it), so rather than guess at an unspecified API we build a proper PBR
// material here from the fully-documented TextureLab helper (SPEC 4.8),
// which is exactly what a fiberglass slide tube is made of.
function buildChuteMaterial(envMap) {
  const { map, normalMap, roughnessMap } = fiberglassTextures('#22b8e0');
  applyTiling(map, normalMap, roughnessMap);
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    roughnessMap,
    envMap: envMap || null,
    envMapIntensity: 1.1,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function buildShellMaterial(envMap) {
  const { map, normalMap, roughnessMap } = fiberglassTextures('#e4dcc8');
  applyTiling(map, normalMap, roughnessMap);
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    roughnessMap,
    envMap: envMap || null,
    envMapIntensity: 0.6,
    clearcoat: 0.15,
    clearcoatRoughness: 0.6,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
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
  const chuteMesh = new THREE.Mesh(track.buildChuteGeometry(), buildChuteMaterial(skyResult.envMap));
  chuteMesh.name = 'chute';
  chuteMesh.castShadow = true;
  chuteMesh.receiveShadow = true;
  scene.add(chuteMesh);

  const shellMesh = new THREE.Mesh(track.buildShellGeometry(), buildShellMaterial(skyResult.envMap));
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

  if (Array.isArray(TRACK_DESIGN.poolCenter)) {
    const poolRadius = TRACK_DESIGN.poolRadius || 14;
    const poolGeo = new THREE.CircleGeometry(poolRadius, 64);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = createPoolWaterMaterial({ envMap: skyResult.envMap });
    const poolMesh = new THREE.Mesh(poolGeo, poolMat);
    poolMesh.name = 'landingPool';
    poolMesh.position.set(
      TRACK_DESIGN.poolCenter[0],
      TRACK_DESIGN.poolCenter[1],
      TRACK_DESIGN.poolCenter[2]
    );
    poolMesh.receiveShadow = true;
    scene.add(poolMesh);
  }
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
  const physics = new RiderPhysics(track);
  physics.reset();
  const riderModel = new RiderModel();
  scene.add(riderModel.object3D);
  riderModel.setVisible(false);
  const chaseCamera = new ChaseCamera(camera, track, physics);
  chaseCamera.setMode('chase');
  screens.showLoading(84);
  await nextFrame();

  bootStage = 'fx';
  const spray = new SprayParticles(scene);
  if (spray.object3D) scene.add(spray.object3D);
  const lensDroplets = new LensDroplets();
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

      if (ctx.isRiding) emitSpray();
      spray.update(simDt, camera);
      lensDroplets.update(simDt, { speed: ctx.speed, splashRate: ctx.splashRate });

      environment.update(simDt, ctx.focusPos);
      skyResult.update(simDt);
      lighting.update(simDt, ctx.focusPos);

      audioEngine.update(simDt, {
        speed: ctx.speed,
        splashRate: ctx.splashRate,
        airborne: ctx.airborne,
        tunnel: ctx.tunnel,
        gForce: ctx.gForce,
      });

      hud.update(physics.state, { timeMs: gameState.timeMs, bestMs: gameState.bestMs });

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
