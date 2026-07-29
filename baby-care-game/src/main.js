import * as THREE from 'three';
import { Room } from './scene/room.js';
import { Lighting } from './scene/lighting.js';
import { Particles } from './scene/particles.js';
import { makeRug, makeCrib, makeBathtub, makeChangingTable, makeFeedingChair, makeToys, StickerBoard } from './scene/props.js';
import { Baby } from './baby/baby.js';
import { CameraRig } from './camera/cameraRig.js';
import { CareController } from './care/controller.js';
import { GameState, CARE_KINDS } from './state/gameState.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import { updateTweens } from './util/tween.js';

const canvas = document.getElementById('stage');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);

const lighting = new Lighting(scene);
const room = new Room();
scene.add(room.group);

// おへや の どうぐ
const props = {
  rug: makeRug(),
  crib: makeCrib(),
  tub: makeBathtub(),
  table: makeChangingTable(),
  chair: makeFeedingChair(),
  toys: makeToys(),
};
Object.values(props).forEach((p) => scene.add(p));

// ごほうびボード（おくのかべ）
const stickerBoard = new StickerBoard();
stickerBoard.group.position.set(0, 1.45, 0.14);
room.attachToWall('back', stickerBoard.group, stickerBoard.materials);

const particles = new Particles(scene);
const baby = new Baby();
scene.add(baby.group);

const rig = new CameraRig(camera);
const state = new GameState();
const sfx = new Sfx(state.muted);
stickerBoard.setCount(state.stars);

const screen = { width: window.innerWidth, height: window.innerHeight };

const hud = new Hud({
  // iOS は最初のタッチまで音を出せないので、どの入口でも unlock しておく
  onCare: (kind) => { sfx.unlock(); care.start(kind); },
  onBack: () => { sfx.unlock(); care.cancel(); },
  onMute: () => {
    sfx.unlock();
    state.muted = !state.muted;
    state.save();
    sfx.setMuted(state.muted);
    hud.setMuted(state.muted);
    if (!state.muted) sfx.tap();
  },
});
hud.setMuted(state.muted);

const care = new CareController({
  scene, camera, baby, rig, hud, sfx, particles, state, props, lighting, stickerBoard, screen,
});

new Input({
  dom: canvas,
  camera,
  rig,
  care,
  baby,
  onFirstTouch: () => sfx.unlock(),
  onTapBaby: (point) => {
    baby.giggle();
    sfx.giggle();
    particles.burst('heart', point, 4, { speed: 1.1, spread: 0.25, scale: 0.7 });
  },
});

// ------------------------------------------------------------- 画面サイズ

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  screen.width = w;
  screen.height = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rig.setAspect(camera.aspect);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();
rig.setPreset('overview', { instant: true });

// ------------------------------------------------- ふだんの ごきげん表示

const wanted = {};
const headPos = new THREE.Vector3();
let fussTimer = 6;

function updateMood(dt) {
  const urgent = state.mostUrgent();

  for (const kind of CARE_KINDS) {
    const want = state.wants(kind);
    if (wanted[kind] !== want) {
      wanted[kind] = want;
      hud.setWanted(kind, want);
    }
  }

  if (care.active) {
    hud.hideBubble();
    return;
  }

  // 表情：こまっていれば ぐずり顔、なければ にこにこ
  if (baby.expression !== 'laugh') {
    baby.setExpression(urgent ? 'fussy' : 'happy');
  }

  if (urgent) {
    baby.getHeadWorldPosition(headPos);
    headPos.y += 0.42;
    headPos.project(camera);
    const x = (headPos.x * 0.5 + 0.5) * screen.width;
    const y = (-headPos.y * 0.5 + 0.5) * screen.height;
    hud.showBubble(urgent, x, y);

    fussTimer -= dt;
    if (fussTimer <= 0) {
      fussTimer = 9 + Math.random() * 6;
      sfx.fuss();
    }
  } else {
    hud.hideBubble();
    fussTimer = 6;
  }
}

// ------------------------------------------------------------- メインループ

const clock = new THREE.Clock();
let started = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updateTweens(dt);
  state.update(dt);
  care.update(dt, time);
  baby.update(dt, time, camera);
  rig.update(dt);
  room.update(camera, dt, time);
  stickerBoard.update(dt, time);
  particles.update(dt);
  lighting.update(dt);
  updateMood(dt);

  renderer.render(scene, camera);

  if (!started) {
    started = true;
    hud.hideSplash();
  }
}
frame();

// 動作確認用（ブラウザのコンソールから中身をのぞける）
window.__game = { scene, camera, baby, rig, care, state, hud, props, room };

document.addEventListener('visibilitychange', () => {
  if (document.hidden) state.save();
});
window.addEventListener('pagehide', () => state.save());
