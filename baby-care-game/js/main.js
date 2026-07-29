import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world.js';
import { Baby } from './baby.js';
import { Particles } from './particles.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { updateTweens, tween } from './tween.js';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);

// アップ中心のホームカメラ（赤ちゃんのそば）
const HOME_CAM = {
  pos: new THREE.Vector3(1.9, 1.9, 3.6),
  target: new THREE.Vector3(0, 0.75, 0.35),
};
// おむつ交換のときの見下ろしカメラ
const CHANGE_CAM = {
  pos: new THREE.Vector3(2.7, 2.3, 3.4),
  target: new THREE.Vector3(1.5, 0.35, 1.0),
};
camera.position.copy(HOME_CAM.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_CAM.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 10;
controls.maxPolarAngle = 1.45; // ゆかの下にはもぐれない
controls.rotateSpeed = 0.55;
controls.update();

const world = buildWorld(scene);
const baby = new Baby();
scene.add(baby.group);
const particles = new Particles(scene);
const audio = new GameAudio();
const ui = new UI();
ui.setMuteIcon(audio.muted);

// ---------- カメラ移動と座標変換のヘルパー ----------
function cameraTo(pos, target, duration, onComplete) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  tween({
    duration,
    onUpdate: (e) => {
      camera.position.lerpVectors(fromPos, pos, e);
      controls.target.lerpVectors(fromTarget, target, e);
    },
    onComplete,
  });
}

const projV = new THREE.Vector3();
function worldToScreen(v) {
  projV.copy(v).project(camera);
  return {
    x: (projV.x * 0.5 + 0.5) * window.innerWidth,
    y: (-projV.y * 0.5 + 0.5) * window.innerHeight,
  };
}

const game = new Game({
  scene, baby, world, particles, audio, ui,
  cameraTo, worldToScreen,
  setControlsEnabled: (v) => { controls.enabled = v; },
  homeCamera: HOME_CAM,
  changeCamera: CHANGE_CAM,
});

// ---------- タップとスワイプ ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let downInfo = null;

canvas.addEventListener('pointerdown', (e) => {
  downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastY: e.clientY };
});

canvas.addEventListener('pointermove', (e) => {
  if (!downInfo) return;
  const d = Math.hypot(e.clientX - downInfo.lastX, e.clientY - downInfo.lastY);
  downInfo.lastX = e.clientX;
  downInfo.lastY = e.clientY;
  game.onWipeMove(d);
});

canvas.addEventListener('pointerup', (e) => {
  if (!downInfo) return;
  const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
  const dt = performance.now() - downInfo.t;
  downInfo = null;
  if (moved < 14 && dt < 450) {
    pointerNDC.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    game.onTap(hits, e.clientX, e.clientY);
  }
});

canvas.addEventListener('pointercancel', () => { downInfo = null; });

// iOS のピンチによるページ拡大を止める（ゲーム内ズームは OrbitControls が担当）
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- はじめるボタン・ミュート ----------
document.getElementById('start-button').addEventListener('click', () => {
  audio.unlock();
  document.getElementById('start-overlay').classList.add('hidden');
  ui.showHUD();
  ui.say('あかちゃんと あそぼう！', 3);
});

ui.muteButton.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  ui.setMuteIcon(audio.muted);
});

// ---------- リサイズ（縦横どちらでも遊べる） ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

window.__game = game; // デバッグ・自動テスト用

// ---------- メインループ ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05); // ゆらゆら系アニメの暴れ防止
  const t = clock.elapsedTime;
  updateTweens(rawDt); // 進行トゥイーンは実時間で進めて、遅い端末でも流れが詰まらないようにする
  baby.update(t, dt);
  game.update(t, dt);
  world.update(t);
  particles.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
loop();
