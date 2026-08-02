import * as THREE from 'three';
import { buildShell } from './scene/roomShell.js';
import { buildDynamicMesh, buildTippableMesh } from './scene/furniture.js';
import { buildKidsFurniture } from './scene/rooms/kids.js';
import { buildBedroomFurniture } from './scene/rooms/bedroom.js';
import { buildLivingFurniture } from './scene/rooms/living.js';
import { buildKitchenFurniture } from './scene/rooms/kitchen.js';
import { buildBear } from './scene/bear.js';
import { Effects } from './scene/effects.js';
import { makeBackgroundTexture } from './scene/materials.js';
import { ROOMS } from './core/roomRegistry.js';
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

const FURNITURE_BUILDERS = {
  kids: buildKidsFurniture,
  bedroom: buildBedroomFurniture,
  living: buildLivingFurniture,
  kitchen: buildKitchenFurniture,
};

/** 部屋のシーン一式を作ってキャッシュする */
const roomScenes = new Map();
function getRoomScene(room) {
  let rs = roomScenes.get(room.id);
  if (rs) return rs;
  const group = new THREE.Group();
  const shell = buildShell(room.shell);
  group.add(shell.group);
  const furn = FURNITURE_BUILDERS[room.id]();
  group.add(furn.group);

  const dynamicMeshes = new Map();
  for (const spec of room.dynamics) {
    const mesh = buildDynamicMesh(spec);
    dynamicMeshes.set(spec.id, mesh);
    group.add(mesh);
  }
  const tippables = new Map();
  for (const t of room.tippables ?? []) {
    const mesh = buildTippableMesh(t);
    dynamicMeshes.set(t.id, mesh);
    tippables.set(t.id, { group: mesh, belt: mesh.getObjectByName('belt'), spec: t });
    group.add(mesh);
  }
  rs = {
    group,
    curtains: shell.curtains,
    handles: {
      dynamicMeshes,
      tippables,
      futon: furn.handles.futon ?? null,
      futonHome: furn.handles.futonHome ?? null,
      mobile: furn.handles.mobile ?? null,
    },
  };
  roomScenes.set(room.id, rs);
  return rs;
}

// くま
const bear = buildBear();
worldGroup.add(bear.group);

const effects = new Effects(worldGroup);
const sounds = new SoundBox();

// ---- 部屋の切り替え ----
let roomIndex = 0;
let currentScene = null;
let switchAnim = null; // {t, dir, incoming, outgoing}

function mountRoom(index, dir = 0) {
  const room = ROOMS[index];
  const rs = getRoomScene(room);
  if (currentScene && currentScene !== rs) {
    const outgoing = currentScene;
    worldGroup.remove(outgoing.group);
    if (dir !== 0) {
      switchAnim = { t: 0, dir, incoming: rs.group };
      rs.group.position.x = dir * 6;
    }
  }
  if (dir === 0) rs.group.position.x = 0;
  worldGroup.add(rs.group);
  currentScene = rs;
  roomIndex = index;
  bear.group.position.set(room.bearStart.x, 0, room.bearStart.z);
  game.setRoom(room, rs.handles);
}

function switchRoom(delta) {
  if (game.phase !== 'placeA' || switchAnim) return;
  sounds.unlock();
  sounds.pickup();
  const next = (roomIndex + delta + ROOMS.length) % ROOMS.length;
  mountRoom(next, delta > 0 ? 1 : -1);
}

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
    const room = ROOMS[roomIndex];
    bear.group.position.set(room.bearStart.x, 0, room.bearStart.z);
    game.restart(false);
  },
  onStrength: (i) => game.setStrength(i),
  onRoomPrev: () => switchRoom(-1),
  onRoomNext: () => switchRoom(1),
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

game = new Game({ worldGroup, bear, effects, hud, sounds, drag });
hud.setStrength(game.strength);
mountRoom(0);

// ---- 金具（転倒家具をタップで固定/解除） ----
const anchorRay = new THREE.Raycaster();
canvas.addEventListener('pointerdown', (e) => {
  if (drag.dragging) return;
  if (game.phase !== 'placeA' && game.phase !== 'placeB') return;
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  anchorRay.setFromCamera(p, camera);
  // くま優先（くまに当たるなら金具は反応しない）
  if (anchorRay.intersectObject(bear.hitProxy, false).length > 0) return;
  for (const [id, h] of currentScene.handles.tippables) {
    if (anchorRay.intersectObject(h.group, true).length > 0) {
      game.toggleAnchor(id);
      break;
    }
  }
});

// ---- レイアウト（縦横対応） ----
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

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

  // 部屋スライドの演出
  if (switchAnim) {
    switchAnim.t = Math.min(1, switchAnim.t + dt * 2.4);
    const k = 1 - Math.pow(1 - switchAnim.t, 3);
    switchAnim.incoming.position.x = switchAnim.dir * 6 * (1 - k);
    if (switchAnim.t >= 1) {
      switchAnim.incoming.position.x = 0;
      switchAnim = null;
    }
  }

  // カーテンのゆらぎ（見た目のみ）
  const sway = (game.curEnvelope ?? 0) * 0.1;
  const curtains = currentScene?.curtains ?? [];
  if (curtains[0]) curtains[0].rotation.x = Math.sin(elapsed * 9) * sway;
  if (curtains[1]) curtains[1].rotation.x = Math.cos(elapsed * 8) * sway;
  // モビールのゆらゆら（寝室）
  const mobile = currentScene?.handles.mobile;
  if (mobile) {
    mobile.rotation.z = Math.sin(elapsed * 1.3) * 0.08 + (game.curEnvelope ?? 0) * Math.sin(elapsed * 10) * 0.25;
  }

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
  getRoom: () => game.room.id,
  getStrength: () => game.strength,
  setStrength: (i) => game.setStrength(i),
  switchRoom: (d) => switchRoom(d),
  toggleAnchor: (id) => game.toggleAnchor(id),
  getAnchors: () => [...game.anchors],
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
    for (const [id, m] of game.dynamicMeshes) out[id] = m.position.toArray();
    return out;
  },
  pressMain: () => game.onMainButton(),
  getRecording: () => {
    game.ensureRecording();
    const landings = {};
    for (const [id, l] of game.recording.landings) landings[id] = { x: l.x, z: l.z, step: l.step };
    return {
      seed: game.recording.seed,
      strength: game.recording.strength,
      roomId: game.recording.roomId,
      frameCount: game.recording.frameCount,
      landings,
      tipEvents: game.recording.tipEvents.map((t) => ({ id: t.id, startFrame: t.startFrame })),
    };
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
