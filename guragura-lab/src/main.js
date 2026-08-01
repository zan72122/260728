import * as THREE from 'three';
import { buildRoom } from './scene/room.js';
import { buildDesk, buildShelf, buildCushion, buildDynamicMesh } from './scene/furniture.js';
import { buildBear } from './scene/bear.js';
import { Effects } from './scene/effects.js';
import { makeBackgroundTexture } from './scene/materials.js';
import { createDynamicObjects, BEAR } from './core/layout.js';
import { Hud } from './ui/hud.js';
import { SoundBox } from './audio/sounds.js';
import { BearDrag } from './play/drag.js';
import { Game } from './play/phases.js';

const canvas = document.getElementById('scene');
const uiLayer = document.getElementById('ui-layer');

// ---- レンダラー ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
scene.background = makeBackgroundTexture();

// カメラは worldGroup の外 → 地震でも UI・カメラは揺れない
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

// ---- ライティング ----
const hemi = new THREE.HemisphereLight(0xfff3f8, 0xffd9b0, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
sun.position.set(3.5, 6.5, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -3;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 6;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xdfe9ff, 0.35);
fill.position.set(-3, 3, 4);
scene.add(fill);

// ---- ワールド（揺れの変位はこのグループにだけかかる） ----
const worldGroup = new THREE.Group();
scene.add(worldGroup);

const { group: roomGroup, curtains } = buildRoom();
worldGroup.add(roomGroup);
worldGroup.add(buildDesk());
worldGroup.add(buildShelf());
worldGroup.add(buildCushion());

// 動的オブジェクト
const dynamicMeshes = new Map();
for (const spec of createDynamicObjects()) {
  const mesh = buildDynamicMesh(spec);
  dynamicMeshes.set(spec.id, mesh);
  worldGroup.add(mesh);
}

// くま
const bear = buildBear();
bear.group.position.set(BEAR.startPos.x, 0, BEAR.startPos.z);
worldGroup.add(bear.group);

const effects = new Effects(worldGroup);
const sounds = new SoundBox();

// ---- UI ----
let game;
const hud = new Hud(uiLayer, {
  onMain: () => game.onMainButton(),
  onMute: (m) => sounds.setMuted(m),
  onDice: () => {
    sounds.unlock();
    sounds.click();
    game.restart(true);
  },
  onHome: () => {
    sounds.unlock();
    sounds.click();
    bear.group.position.set(BEAR.startPos.x, 0, BEAR.startPos.z);
    game.restart(false);
  },
});

const drag = new BearDrag(canvas, camera, bear, {
  onPickup: () => {
    sounds.unlock();
    sounds.pickup();
    hud.hideHint();
  },
  onDrop: () => {
    sounds.drop();
    bear.squash();
    effects.burst(bear.group.position.clone().add(new THREE.Vector3(0, 0.1, 0)), {
      count: 4,
      kind: 'pink',
      speed: 0.7,
      up: 0.9,
      size: 0.09,
    });
  },
  onFirstDrag: () => hud.hideHint(),
});

game = new Game({ worldGroup, dynamicMeshes, bear, effects, hud, sounds, drag });
game.resetDynamicMeshes();

// ---- レイアウト（縦横対応） ----
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  // 横長：部屋を斜め上から / 縦長：少し引いて高めから
  const portrait = camera.aspect < 1;
  const t = THREE.MathUtils.clamp((1 - camera.aspect) * 1.4, 0, 1);
  const eyeLand = new THREE.Vector3(3.7, 3.1, 5.0);
  const eyePort = new THREE.Vector3(2.7, 3.9, 7.3);
  camera.position.lerpVectors(eyeLand, eyePort, portrait ? t : 0);
  camera.lookAt(-0.15, portrait ? 0.7 : 0.55, -0.35);
  camera.updateProjectionMatrix();
}
layout();
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);

// 最初のヒント：くまの位置に手を出す
function showBearHint() {
  const p = bear.group.position.clone();
  p.y = 0.25;
  p.project(camera);
  const x = ((p.x + 1) / 2) * window.innerWidth;
  const y = ((1 - p.y) / 2) * window.innerHeight;
  hud.showHint(x, y + 10);
}
setTimeout(showBearHint, 600);

// ---- メインループ ----
const clock = new THREE.Clock();
let elapsed = 0;
function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  game.update(dt, elapsed);

  // カーテンのゆらぎ（見た目のみ）
  const sway = (game.curEnvelope ?? 0) * 0.1;
  curtains[0].rotation.x = Math.sin(elapsed * 9) * sway;
  curtains[1].rotation.x = Math.cos(elapsed * 8) * sway;

  drag.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ---- テスト用フック ----
window.__lab = {
  game,
  bear,
  getPhase: () => game.phase,
  getSeed: () => game.seed,
  setBear: (x, z) => {
    bear.group.position.x = x;
    bear.group.position.z = z;
  },
  getBear: () => ({ x: bear.group.position.x, z: bear.group.position.z }),
  bearScreenPos: () => {
    const p = bear.group.position.clone();
    p.y = 0.25;
    p.project(camera);
    return {
      x: ((p.x + 1) / 2) * window.innerWidth,
      y: ((1 - p.y) / 2) * window.innerHeight,
    };
  },
  worldToScreen: (x, y, z) => {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: ((p.x + 1) / 2) * window.innerWidth,
      y: ((1 - p.y) / 2) * window.innerHeight,
    };
  },
  getObjectPositions: () => {
    const out = {};
    for (const [id, m] of dynamicMeshes) out[id] = m.position.toArray();
    return out;
  },
  pressMain: () => game.onMainButton(),
  getRecording: () => {
    game.ensureRecording();
    const landings = {};
    for (const [id, l] of game.recording.landings) landings[id] = { x: l.x, z: l.z, step: l.step };
    return { seed: game.recording.seed, frameCount: game.recording.frameCount, landings };
  },
  getResults: () => ({ a: game.resultA, b: game.resultB }),
  getDangerCount: () => game.dangerEvents.length,
  skipToEnd: () => {
    if (game.phase === 'playA' || game.phase === 'playB') {
      game.playFrame = game.recording.frameCount - 2;
    } else if (game.phase === 'rewind') {
      game.playFrame = 0.5;
    }
  },
};
