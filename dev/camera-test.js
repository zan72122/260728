// dev/camera-test.js — standalone visual test harness for the S2 cameraFX.js
// view-mode rework (docs/CONTRACTS-RABBIT.md "src/cameraFX.js — S2"). NOT
// part of the game; verification only.
//
// Scene: a real SceneEnv (tower + pool basin + sky), a blue water disc
// standing in for the water surface (C's WaterSurface isn't needed for a
// camera test), and a dummy sphere ("the toy") dropped from the HIGH
// platform tip under simple gravity. Scripted sequence:
//   idle -> followFlight(ball) -> [impact] onImpact()+splashView(point),
//   held for 3s while ALSO calling setFocus() every frame with a DIFFERENT
//   (decoy) point to prove splashView ignores it -> returnToTower -> idle.
//
// window.__test exposes camera state + assertion helpers for Playwright.

import * as THREE from 'three';
import { CameraFX } from '../src/cameraFX.js';
import { SceneEnv } from '../src/scene.js';
import { PLATFORMS } from '../src/constants.js';

// Slowed-down gravity for THIS TEST HARNESS ONLY (not the real game's
// physics) so a screenshot series can catch multiple distinct moments of
// the followFlight descent instead of it completing in ~1s.
const TEST_G = 3.0;

window.__test = {
  ready: false,
  errors: [],
  phase: 'boot',
  splashElapsed: 0,
};

function recordError(err) {
  const msg = err && err.stack ? err.stack : err && err.message ? err.message : String(err);
  window.__test.errors.push(msg);
  console.error(err);
}
window.onerror = (message, source, lineno, colno) => {
  window.__test.errors.push(`${message} @ ${source || '?'}:${lineno || 0}:${colno || 0}`);
  return false;
};
window.addEventListener('unhandledrejection', (e) => recordError(e && e.reason));

const hud = document.getElementById('hud');
const canvas = document.getElementById('canvas');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
} catch (err) {
  recordError(err);
}

const scene = new THREE.Scene();

let sceneEnv = null;
try {
  sceneEnv = new SceneEnv(scene);
} catch (err) {
  recordError(err);
}

// -- blue water disc (stands in for water.js's WaterSurface) --------------
const waterDisc = new THREE.Mesh(
  new THREE.CircleGeometry(5.2, 64),
  new THREE.MeshStandardMaterial({ color: 0x1a7ac4, roughness: 0.25, metalness: 0.1 })
);
waterDisc.rotation.x = -Math.PI / 2;
waterDisc.position.y = 0.001; // slightly above the pool floor built by SceneEnv
scene.add(waterDisc);

// -- dummy "toy" sphere -----------------------------------------------------
const HIGH = PLATFORMS.find((p) => p.id === 'high');
const ball = {
  pos: new THREE.Vector3(HIGH.tip.x, HIGH.tip.y, HIGH.tip.z),
  vel: new THREE.Vector3(0, 0, 0),
};
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 20, 16),
  new THREE.MeshStandardMaterial({ color: 0xff6b3d, roughness: 0.4 })
);
ballMesh.position.copy(ball.pos);
scene.add(ballMesh);

// -- impact marker (visible ring at the splash point) ----------------------
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.35, 0.5, 32),
  new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide, transparent: true, opacity: 0 })
);
marker.rotation.x = -Math.PI / 2;
scene.add(marker);

// -- splash-column stand-in (crown base at y=0 up to ~2.5m "jet" tip) ------
// Not the real splash.js/underwater.js visuals (out of scope for a camera
// test) — just a translucent column so the screenshot series can visually
// confirm splashView's framing actually keeps a ~2.5m-tall column fully in
// frame, unobstructed, in both orientations.
const splashColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.55, 2.5, 16, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
);
splashColumn.visible = false;
scene.add(splashColumn);
const splashColumnTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
splashColumnTip.visible = false;
scene.add(splashColumnTip);

// -- decoy marker (the "wrong" focus point setFocus tries to steal to) -----
const decoyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff00ff })
);
decoyMesh.visible = false;
scene.add(decoyMesh);

// -- camera under test -------------------------------------------------------
let cameraFX = null;
try {
  cameraFX = new CameraFX(renderer);
} catch (err) {
  recordError(err);
}

// -------------------------------------------------------------------
// Scripted sequence state machine.
// -------------------------------------------------------------------
const MID = PLATFORMS.find((p) => p.id === 'mid');
let phase = 'idle-initial';
let phaseTimer = 0;
let splashPoint = new THREE.Vector3();
let decoyPoint = new THREE.Vector3();
let returnDone = false;

function fakeImpactSpec(point) {
  return {
    point: point.clone(),
    velocity: new THREE.Vector3(0, -9, 0),
    speed: 9,
    energy: 0.95,
    size: 0.3,
    def: { id: 'heavyball' },
    flatness: 0.08,
    oblique: 0,
    dir: new THREE.Vector2(0, 0),
    cupTrap: 0,
    spin: 0,
    seed: 12345,
    isSecondary: false,
  };
}

function startFollow() {
  ball.pos.set(HIGH.tip.x, HIGH.tip.y, HIGH.tip.z);
  ball.vel.set(0, 0, 0);
  ballMesh.visible = true;
  if (cameraFX) cameraFX.followFlight(() => ball.pos);
  phase = 'followFlight';
  phaseTimer = 0;
}

function triggerImpact() {
  splashPoint.set(ball.pos.x, 0, ball.pos.z);
  marker.position.set(splashPoint.x, 0.02, splashPoint.z);
  marker.material.opacity = 0.9;
  splashColumn.position.set(splashPoint.x, 1.25, splashPoint.z);
  splashColumn.visible = true;
  splashColumnTip.position.set(splashPoint.x, 2.5, splashPoint.z);
  splashColumnTip.visible = true;
  if (cameraFX) {
    cameraFX.onImpact(fakeImpactSpec(splashPoint));
    cameraFX.splashView(splashPoint);
  }
  phase = 'splashView';
  phaseTimer = 0;
  window.__test.splashElapsed = 0;
}

function startReturn() {
  marker.material.opacity = 0;
  splashColumn.visible = false;
  splashColumnTip.visible = false;
  decoyMesh.visible = false;
  returnDone = false;
  if (cameraFX) {
    cameraFX.returnToTower(new THREE.Vector3(MID.tip.x, MID.tip.y, MID.tip.z), () => {
      returnDone = true;
    });
  }
  phase = 'returning';
  phaseTimer = 0;
}

// -------------------------------------------------------------------
// Test API for Playwright assertions.
// -------------------------------------------------------------------
window.__test.getPhase = () => phase;
window.__test.getMode = () => (cameraFX ? cameraFX._mode : null);
window.__test.cameraPos = () => (cameraFX ? cameraFX.camera.position.toArray() : null);
window.__test.impactPoint = () => splashPoint.toArray();
window.__test.decoyPoint = () => decoyPoint.toArray();
window.__test.ballY = () => ball.pos.y;
window.__test.returnDone = () => returnDone;
window.__test.timeScale = () => (cameraFX ? cameraFX.timeScale : 1);
window.__test.underwaterAmount = () => (cameraFX ? cameraFX.underwaterAmount : 0);

const _fwdScratch = new THREE.Vector3();
const _toImpactScratch = new THREE.Vector3();
const _toDecoyScratch = new THREE.Vector3();
// Angles (degrees) between the camera's forward look direction and the
// vector toward the impact point vs. the decoy point setFocus is fed every
// frame during splashView. A small angleToImpact + large angleToDecoy
// proves the camera is locked on the splash and setFocus was ignored.
window.__test.angles = () => {
  if (!cameraFX) return null;
  cameraFX.camera.getWorldDirection(_fwdScratch);
  _toImpactScratch.copy(splashPoint).sub(cameraFX.camera.position).normalize();
  _toDecoyScratch.copy(decoyPoint).sub(cameraFX.camera.position).normalize();
  const rad2deg = 180 / Math.PI;
  return {
    angleToImpactDeg: _fwdScratch.angleTo(_toImpactScratch) * rad2deg,
    angleToDecoyDeg: _fwdScratch.angleTo(_toDecoyScratch) * rad2deg,
  };
};
// Force-advance helpers so Playwright can drive the sequence deterministically
// instead of racing real wall-clock timers.
window.__test.forceImpactNow = () => {
  ball.pos.y = 0;
  triggerImpact();
};
window.__test.forceReturnNow = () => {
  startReturn();
};

// -------------------------------------------------------------------
// Resize
// -------------------------------------------------------------------
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (renderer) renderer.setSize(w, h);
  if (cameraFX) cameraFX.handleResize(w, h);
}
window.addEventListener('resize', handleResize);
handleResize();

// -------------------------------------------------------------------
// Main loop.
// -------------------------------------------------------------------
let lastNow = performance.now();
let firstFrame = false;

function animate(now) {
  requestAnimationFrame(animate);
  let dtReal = (now - lastNow) / 1000;
  lastNow = now;
  if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
  dtReal = Math.min(dtReal, 0.1);
  const t = now / 1000;

  phaseTimer += dtReal;

  try {
    if (sceneEnv) sceneEnv.update(dtReal, t);

    // ---- scripted sequence ----
    if (phase === 'idle-initial') {
      if (cameraFX) cameraFX.setIdleView(new THREE.Vector3(HIGH.tip.x, HIGH.tip.y, HIGH.tip.z));
      // Give the idle reframe (IDLE_SMOOTH_TIME) plenty of real time to
      // fully converge on the HIGH platform tip before the throw — mirrors
      // the aim+windup dwell time GameFlow gives it in the real game.
      if (phaseTimer > 3.0) startFollow();
    } else if (phase === 'followFlight') {
      // simple free fall, real dt (no slow-mo active pre-impact)
      ball.vel.y -= TEST_G * dtReal;
      ball.pos.y += ball.vel.y * dtReal;
      ballMesh.position.copy(ball.pos);
      if (ball.pos.y <= 0) {
        ball.pos.y = 0;
        triggerImpact();
      }
    } else if (phase === 'splashView') {
      ballMesh.visible = false;
      window.__test.splashElapsed += dtReal;
      // Decoy point orbits far from the impact point — proves setFocus is
      // ignored: if it were honored the camera would drift here instead.
      const decoyAngle = window.__test.splashElapsed * 2.3;
      decoyPoint.set(
        MID.tip.x + Math.cos(decoyAngle) * 1.5,
        MID.tip.y + Math.sin(decoyAngle * 0.7) * 0.5,
        MID.tip.z + Math.sin(decoyAngle) * 1.5
      );
      decoyMesh.position.copy(decoyPoint);
      decoyMesh.visible = true;
      if (cameraFX) cameraFX.setFocus(decoyPoint);
      if (phaseTimer > 3.0) startReturn();
    } else if (phase === 'returning') {
      if (returnDone) {
        phase = 'idle-final';
        phaseTimer = 0;
      }
    } else if (phase === 'idle-final') {
      // settled; nothing further to script
    }
  } catch (err) {
    recordError(err);
  }

  try {
    if (cameraFX) cameraFX.update(dtReal, t);
  } catch (err) {
    recordError(err);
  }

  try {
    if (renderer && cameraFX) renderer.render(scene, cameraFX.camera);
  } catch (err) {
    recordError(err);
  }

  window.__test.phase = phase;

  if (!firstFrame) {
    firstFrame = true;
    window.__test.ready = true;
  }

  if (hud) {
    const ang = window.__test.angles();
    hud.textContent =
      `phase: ${phase} (t=${phaseTimer.toFixed(2)})\n` +
      `mode: ${cameraFX ? cameraFX._mode : '?'}\n` +
      `ball.y: ${ball.pos.y.toFixed(2)}\n` +
      `camPos: ${cameraFX ? cameraFX.camera.position.toArray().map((v) => v.toFixed(2)).join(',') : '?'}\n` +
      `timeScale: ${cameraFX ? cameraFX.timeScale.toFixed(3) : '?'}\n` +
      `underwaterAmount: ${cameraFX ? cameraFX.underwaterAmount.toFixed(3) : '?'}\n` +
      (ang ? `angleToImpact: ${ang.angleToImpactDeg.toFixed(1)}deg  angleToDecoy: ${ang.angleToDecoyDeg.toFixed(1)}deg\n` : '') +
      `errors: ${window.__test.errors.length}`;
  }
}

requestAnimationFrame(animate);
