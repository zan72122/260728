/* ============================================================
   にじいろつみきタワー — main.js（巨大ボクセル版）

   規模の土台：
   - 描画: InstancedMesh（数千ブロックを1ドローコール）
   - 物理: 「触るまで凍結」方式。動く必要が生じた部分だけ
     cannon の動的ボディに変換し、眠ったら再凍結（がれき化）。
     地面と繋がらなくなった塊は接地チェックで検出して落とす。

   こわし装置：
   💣 ばくだん …… ドカーン！と まわりを ふきとばす
   💨 せんぷうき … ビュオーッと よこから おしたおす
   🔨 ハンマー …… ゴツン！と ねらった ところを たたきとばす
   ============================================================ */

import * as THREE from '../lib/three.module.min.js';
import * as CANNON from '../lib/cannon-es.js';
import { buildStageSpec } from './voxels.js';
import { PHYS, bombParams, bombEffect, gridKey, findUngrounded } from './demolition.js';
import * as SFX from './audio.js';

/* ============================ DOM ============================ */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const stageIconEl = $('stageIcon'), stageNumEl = $('stageNum'), stageNameEl = $('stageName');
const muteBtn = $('muteBtn');
const meterEl = $('meter'), meterFill = $('meterFill'), meterStar = $('meterStar');
const paletteEl = $('palette'), stickerDotsEl = $('stickerDots');
const ponBtn = $('ponBtn');
const handEl = $('hand');
const resultCard = $('resultCard'), resultChara = $('resultChara'),
      resultStars = $('resultStars');
const retryBtn = $('retryBtn'), nextBtn = $('nextBtn');
const confettiEl = $('confetti');
const titleEl = $('title'), startBtn = $('startBtn');

const DEVICE_EMOJI = { bomb: '💣', fan: '💨', hammer: '🔨' };

/* ========================== レンダラー ========================== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffdcef, 30, 80);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);

// ひかり
scene.add(new THREE.HemisphereLight(0xd6ecff, 0xffd1ea, 1.05));
const sun = new THREE.DirectionalLight(0xfff3dc, 1.9);
sun.position.set(10, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

// 💣 ばくはつの ひかり（つかいまわし）
const boomLight = new THREE.PointLight(0xffb066, 0, 20, 1.6);
scene.add(boomLight);

/* ========================= じめん ========================= */
let stageDisc, rimMesh;
{
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshLambertMaterial({ color: 0xb9e6a6 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  stageDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.6, 48),
    new THREE.MeshLambertMaterial({ color: 0xffd9ec })
  );
  stageDisc.rotation.x = -Math.PI / 2;
  stageDisc.position.y = 0.012;
  stageDisc.receiveShadow = true;
  scene.add(stageDisc);

  rimMesh = new THREE.Mesh(
    new THREE.RingGeometry(5.6, 6.1, 48),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  rimMesh.rotation.x = -Math.PI / 2;
  rimMesh.position.y = 0.013;
  scene.add(rimMesh);
}

/* ================== キャンバス テクスチャ ================== */
function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- おかお（4しゅるい） ----
function drawFace(ctx, s, mode) {
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = '#5a4a52';
  ctx.fillStyle = '#5a4a52';
  ctx.lineWidth = s * 0.045;
  ctx.lineCap = 'round';
  const eyeY = s * 0.42, eyeDX = s * 0.18;
  ctx.fillStyle = 'rgba(255,150,180,0.55)';
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s / 2 + dx * s * 0.3, s * 0.58, s * 0.075, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5a4a52';
  for (const dx of [-1, 1]) {
    const ex = s / 2 + dx * eyeDX;
    ctx.beginPath();
    if (mode === 'blink' || mode === 'happy') {
      ctx.arc(ex, eyeY + s * 0.02, s * 0.075, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (mode === 'excited') {
      ctx.arc(ex, eyeY, s * 0.075, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(ex, eyeY, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  if (mode === 'excited') {
    ctx.arc(s / 2, s * 0.6, s * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mode === 'happy') {
    ctx.arc(s / 2, s * 0.52, s * 0.13, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else {
    ctx.arc(s / 2, s * 0.53, s * 0.085, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}
const faceTex = {
  normal:  makeCanvas(128, (c, s) => drawFace(c, s, 'normal')),
  blink:   makeCanvas(128, (c, s) => drawFace(c, s, 'blink')),
  excited: makeCanvas(128, (c, s) => drawFace(c, s, 'excited')),
  happy:   makeCanvas(128, (c, s) => drawFace(c, s, 'happy')),
};
const faceMat = new THREE.MeshBasicMaterial({
  map: faceTex.normal, transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1,
});
function setFaces(mode) { faceMat.map = faceTex[mode]; }

// ---- 🔨 の まと ----
const targetTex = makeCanvas(256, (c, s) => {
  c.clearRect(0, 0, s, s);
  const rings = [
    [0.46, '#ffffff'], [0.38, '#ff5a54'], [0.28, '#ffffff'],
    [0.19, '#ff5a54'], [0.09, '#ffffff'],
  ];
  for (const [r, col] of rings) {
    c.beginPath();
    c.arc(s / 2, s / 2, s * r, 0, Math.PI * 2);
    c.fillStyle = col;
    c.fill();
  }
  c.beginPath();
  c.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
  c.lineWidth = s * 0.03;
  c.strokeStyle = '#d94040';
  c.stroke();
});
const targetGeo = new THREE.PlaneGeometry(1, 1);

// ---- パーティクル テクスチャ ----
function drawStarShape(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.46;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
const texStarP = makeCanvas(64, (c, s) => drawStarShape(c, s / 2, s / 2, s * 0.44, '#fff2a8'));
const texSpark = makeCanvas(64, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
});
const texSmoke = makeCanvas(64, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
});
const texChip = makeCanvas(64, (c, s) => {
  c.fillStyle = '#ffffff';
  c.fillRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
});

// ---- おはな（かざり） ----
const texFlower = makeCanvas(64, (c, s) => {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    c.beginPath();
    c.arc(s / 2 + Math.cos(a) * s * 0.22, s / 2 + Math.sin(a) * s * 0.22, s * 0.16, 0, Math.PI * 2);
    c.fillStyle = '#ff9ec6';
    c.fill();
  }
  c.beginPath();
  c.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2);
  c.fillStyle = '#ffe37e';
  c.fill();
});
{
  const flowerMat = new THREE.SpriteMaterial({ map: texFlower, depthWrite: false });
  for (let i = 0; i < 30; i++) {
    const sp = new THREE.Sprite(flowerMat);
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 22;
    sp.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r);
    const sc = 0.4 + Math.random() * 0.35;
    sp.scale.set(sc, sc, 1);
    scene.add(sp);
  }
}

/* ==================== パーティクル プール ==================== */
class ParticlePool {
  constructor(tex, count, blending, size) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.baseCol = new Float32Array(count * 3);
    this.grav = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, size, transparent: true, depthWrite: false,
      blending, vertexColors: true, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, r, g, b, grav = 3.2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.baseCol.set([r, g, b], i * 3);
    this.col.set([r, g, b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999;
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.min(1, this.life[i] / (this.maxLife[i] * 0.6));
      this.col[k] = this.baseCol[k] * f;
      this.col[k + 1] = this.baseCol[k + 1] * f;
      this.col[k + 2] = this.baseCol[k + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
const pStars = new ParticlePool(texStarP, 140, THREE.AdditiveBlending, 0.34);
const pSparks = new ParticlePool(texSpark, 220, THREE.AdditiveBlending, 0.26);
const pFire = new ParticlePool(texSpark, 110, THREE.AdditiveBlending, 0.62);
const pSmoke = new ParticlePool(texSmoke, 90, THREE.NormalBlending, 1.15);
const pDebris = new ParticlePool(texChip, 130, THREE.NormalBlending, 0.18);

function burstStar(p, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.4;
    pStars.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 1 + Math.random() * 2.6, Math.sin(a) * sp,
      0.6 + Math.random() * 0.5, 1, 0.92, 0.55);
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2;
    pSparks.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 0.6 + Math.random() * 2.2, Math.sin(a) * sp,
      0.4 + Math.random() * 0.4, 1, 1, 1);
  }
}

let effects = [];

// 💣 ばくはつの みため
function explosionFX(p, blockColor) {
  for (let i = 0; i < 26; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    const sp = 1.5 + Math.random() * 4.5;
    const heat = Math.random();
    pFire.spawn(p.x, p.y, p.z,
      Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.9 + 0.8, Math.sin(ph) * Math.sin(th) * sp,
      0.3 + Math.random() * 0.35,
      1, 0.45 + heat * 0.45, 0.12 + heat * 0.25, -1.2);
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 4.5;
    pSparks.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 1.5 + Math.random() * 3.5, Math.sin(a) * sp,
      0.35 + Math.random() * 0.3, 1, 0.95, 0.7, 5);
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.2;
    const g = 0.55 + Math.random() * 0.2;
    pSmoke.spawn(p.x, p.y + 0.2, p.z,
      Math.cos(a) * sp, 0.7 + Math.random() * 0.9, Math.sin(a) * sp,
      1.2 + Math.random() * 0.8, g, g, g, -0.5);
  }
  const c = blockColor || new THREE.Color(0xff9ec6);
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4.5;
    pDebris.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 2 + Math.random() * 3.5, Math.sin(a) * sp,
      0.7 + Math.random() * 0.5, c.r, c.g, c.b, 8);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.0, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(p);
  scene.add(ring);
  effects.push({
    t: 0,
    update(dt) {
      this.t += dt;
      const k = this.t / 0.45;
      if (k >= 1) {
        scene.remove(ring); ring.geometry.dispose(); ring.material.dispose();
        return false;
      }
      ring.scale.setScalar(0.4 + k * 5.2);
      ring.material.opacity = 0.9 * (1 - k);
      return true;
    },
  });
  boomLight.position.set(p.x, p.y + 0.3, p.z);
  boomLight.intensity = 80;
  effects.push({
    update(dt) {
      boomLight.intensity *= Math.exp(-11 * dt);
      if (boomLight.intensity < 0.3) { boomLight.intensity = 0; return false; }
      return true;
    },
  });
}

/* ===================== ぶつり ワールド ===================== */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);

const matBlock = new CANNON.Material('block');
const matGround = new CANNON.Material('ground');
world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matBlock,
  { friction: PHYS.frictionBlock, restitution: PHYS.restitution }));
world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matGround,
  { friction: PHYS.frictionGround, restitution: PHYS.restitution }));
world.defaultContactMaterial.friction = 0.5;

const groundBody = new CANNON.Body({ mass: 0, material: matGround, shape: new CANNON.Plane() });
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

/* =================== まるいキューブ ジオメトリ =================== */
function roundedBoxGeo(w, h, d) {
  const r = Math.min(w, h, d) * 0.14;
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      Math.max(-hw, Math.min(hw, v.x)),
      Math.max(-hh, Math.min(hh, v.y)),
      Math.max(-hd, Math.min(hd, v.z))
    );
    v.sub(c);
    const len = v.length() || 1;
    v.divideScalar(len);
    nor.setXYZ(i, v.x, v.y, v.z);
    pos.setXYZ(i, c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ===================== そうちの 3D モデル ===================== */
function buildBombModel(scale) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3b3b47, emissive: 0x000000 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat);
  g.add(body);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.07, 10),
    new THREE.MeshLambertMaterial({ color: 0x8d8d9a })
  );
  cap.position.y = 0.18;
  g.add(cap);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.2, 0),
    new THREE.Vector3(0.05, 0.29, 0.02),
    new THREE.Vector3(0.13, 0.33, 0.05),
  ]);
  const fuse = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 6, 0.017, 6),
    new THREE.MeshLambertMaterial({ color: 0xc9a06a })
  );
  g.add(fuse);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texSpark, color: 0xffcc66, depthWrite: false,
  }));
  spark.position.set(0.13, 0.35, 0.05);
  spark.scale.setScalar(0.14);
  g.add(spark);
  g.scale.setScalar(scale);
  return { group: g, mat, spark };
}

function buildFanModel(scale) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const pink = new THREE.MeshLambertMaterial({ color: 0xff8fbe });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 24), pink);
  g.add(ring);
  const blades = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 0.02), white);
    blade.position.y = 0.15;
    holder.add(blade);
    holder.rotation.z = (i / 3) * Math.PI * 2;
    blades.add(holder);
  }
  g.add(blades);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), pink);
  hub.position.z = 0.03;
  g.add(hub);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 8), white);
  stem.position.y = -0.42;
  g.add(stem);
  g.scale.setScalar(scale);
  return { group: g, blades };
}

function buildHammerModel(scale) {
  const g = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, 1.05);
  g.add(pivot);
  const arm = new THREE.Group();
  pivot.add(arm);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.0, 10),
    new THREE.MeshLambertMaterial({ color: 0xc98b5e })
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.5;
  arm.add(handle);
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.42, 14),
    new THREE.MeshLambertMaterial({ color: 0x92a4c0 })
  );
  head.rotation.z = Math.PI / 2;
  head.position.z = -1.0;
  arm.add(head);
  g.scale.setScalar(scale);
  return { group: g, arm };
}

/* ===================== ゲームの じょうたい ===================== */
const ST = { TITLE: 0, BUILD: 1, PLACE: 2, COLLAPSE: 3, RESULT: 4 };
let state = ST.TITLE;

let stage = parseInt(localStorage.getItem('nijiiro.stage') || '1', 10) || 1;
let seed = (Math.random() * 1e9) | 0;
let budget = Math.max(800, Math.min(2500,
  parseInt(localStorage.getItem('nijiiro.budget') || '1500', 10) || 1500));
// かいはつ・テスト用：?budget=500 のように 規模を固定できる
const urlBudget = parseInt(new URLSearchParams(location.search).get('budget') || '', 10);
if (urlBudget) budget = Math.max(200, Math.min(3000, urlBudget));
let spec = null;
let V = 0.5;
let BP = bombParams(V);

let blocks = [];          // { i, g, home, y0, color, state, body, device, appearAt }
let gridMap = new Map();  // gridKey -> block（凍結して格子に居る子だけ）
let dynSet = new Set();   // いま動的な子
let connDirty = false;    // 接地チェックが必要
let connCheckAt = 0;
let devices = [];
let selectedType = 'bomb';
let popCombo = 0, popComboTime = 0;

let inst = null;          // InstancedMesh
let faceItems = [];       // [{ block, mesh }]
let switchTime = -1;
let lastActivationTime = -1;
let calmSince = -1;
let camShake = 0;
let score = 0;
let meterLevel = 0;
let elapsed = 0;
let buildDoneAt = 0;

// 適応品質の計測
let perfAccum = 0, perfFrames = 0;

const blockMass = () => V * V * V * PHYS.density;

/* ---- InstancedMesh の行列ヘルパー ---- */
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v3 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const Q_ID = new THREE.Quaternion();

function setInstance(i, px, py, pz, quat, sc) {
  _v3.set(px, py, pz);
  _s3.set(sc, sc, sc);
  _m4.compose(_v3, quat || Q_ID, _s3);
  inst.setMatrixAt(i, _m4);
}

/* ===================== カメラ そうさ ===================== */
let camTheta = 0, camPhi = 1.12, camZoom = 1, baseDist = 14, targetY = 4;
const pointers = new Map();
let dragMoved = false, pinchDist = 0;

function fitCamera() {
  if (!spec) return;
  const fov = (camera.fov * Math.PI) / 180;
  const aspect = camera.aspect;
  const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  targetY = spec.height * 0.44;
  const dV = (spec.height * 0.62 + 1.2) / Math.tan(fov / 2);
  const dH = (spec.radius + 1.2) / Math.tan(hfov / 2);
  baseDist = Math.max(dV, dH) * 1.08 + 1.6;
  scene.fog.near = baseDist * 1.5;
  scene.fog.far = baseDist * 3.6;
}
function updateCamera(dt) {
  if (state === ST.COLLAPSE || state === ST.RESULT) camTheta += dt * 0.13;
  const r = baseDist * camZoom;
  const sp = Math.sin(camPhi), cp = Math.cos(camPhi);
  camera.position.set(
    Math.sin(camTheta) * sp * r,
    Math.max(0.8, targetY + cp * r),
    Math.cos(camTheta) * sp * r
  );
  if (camShake > 0.003) {
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
    camera.position.z += (Math.random() - 0.5) * camShake;
    camShake *= Math.exp(-6 * dt);
  }
  camera.lookAt(0, targetY, 0);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fitCamera();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

/* ===================== ステージ せいせい ===================== */
function clearStage() {
  for (const b of blocks) {
    if (b.body) { world.removeBody(b.body); b.body = null; }
  }
  for (const dev of devices) removeDeviceVisual(dev);
  for (const f of faceItems) scene.remove(f.mesh);
  if (inst) {
    scene.remove(inst);
    inst.geometry.dispose();
    inst.material.dispose();
    inst = null;
  }
  blocks = [];
  gridMap = new Map();
  dynSet = new Set();
  devices = [];
  effects = [];
  faceItems = [];
  connDirty = false;
  boomLight.intensity = 0;
  score = 0; meterLevel = 0;
  switchTime = -1; lastActivationTime = -1; calmSince = -1;
  perfAccum = 0; perfFrames = 0;
  meterFill.style.height = '0%';
  meterStar.classList.remove('full');
  meterEl.classList.add('hidden');
  resultCard.classList.add('hidden');
  confettiEl.innerHTML = '';
  setFaces('normal');
}

// ひらがな・すうじ を ドット絵に する（ブラウザだけの機能）
function rasterizeChar(ch, rows) {
  const px = rows * 6;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  x.font = `bold ${Math.round(px * 0.86)}px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#000';
  x.fillText(ch, px / 2, px * 0.56);
  const data = x.getImageData(0, 0, px, px).data;
  const cell = px / rows;
  // まず 正方グリッドで しきい値判定
  const raw = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = [];
    for (let col = 0; col < rows; col++) {
      let hit = 0, total = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const pxx = Math.min(px - 1, Math.floor((col + (sx + 0.5) / 3) * cell));
          const pyy = Math.min(px - 1, Math.floor((r + (sy + 0.5) / 3) * cell));
          total++;
          if (data[(pyy * px + pxx) * 4 + 3] > 100) hit++;
        }
      }
      rowArr.push(hit / total > 0.4);
    }
    raw.push(rowArr);
  }
  // 空白の 行・列 を トリム
  let r0 = 0, r1 = rows - 1, c0 = 0, c1 = rows - 1;
  const rowHas = (r) => raw[r].some(Boolean);
  const colHas = (c) => raw.some((row) => row[c]);
  while (r0 < r1 && !rowHas(r0)) r0++;
  while (r1 > r0 && !rowHas(r1)) r1--;
  while (c0 < c1 && !colHas(c0)) c0++;
  while (c1 > c0 && !colHas(c1)) c1--;
  const out = [];
  for (let r = r0; r <= r1; r++) out.push(raw[r].slice(c0, c1 + 1));
  return out.length > 2 ? out : null;
}

function startStage(newStage, newSeed) {
  stage = newStage; seed = newSeed;
  localStorage.setItem('nijiiro.stage', String(stage));
  clearStage();
  spec = buildStageSpec(stage, seed, budget, rasterizeChar);
  V = spec.V;
  BP = bombParams(V);

  stageIconEl.textContent = spec.icon;
  stageNumEl.textContent = String(stage);
  stageNameEl.textContent = spec.name;

  // まず 格子に 登録して、宙に浮いた はぐれブロックを 除外する
  const tmpMap = new Map();
  for (const bs of spec.blocks) {
    tmpMap.set(gridKey(bs.g[0], bs.g[1], bs.g[2]), bs);
  }
  const orphans = new Set(findUngrounded(tmpMap));
  const specBlocks = spec.blocks.filter(
    (bs) => !orphans.has(gridKey(bs.g[0], bs.g[1], bs.g[2])));

  // InstancedMesh
  const geo = roundedBoxGeo(V, V, V);
  const mat = new THREE.MeshLambertMaterial();
  inst = new THREE.InstancedMesh(geo, mat, specBlocks.length);
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(inst);

  const maxGy = Math.max(1, ...specBlocks.map((bs) => bs.g[1]));
  const col = new THREE.Color();
  blocks = specBlocks.map((bs, i) => {
    col.setRGB(bs.c[0], bs.c[1], bs.c[2]);
    inst.setColorAt(i, col);
    setInstance(i, bs.p[0], bs.p[1], bs.p[2], null, 0.001);
    const block = {
      i,
      g: bs.g,
      home: bs.p,
      y0: bs.p[1],
      color: new THREE.Color(bs.c[0], bs.c[1], bs.c[2]),
      state: 'frozen',
      body: null,
      device: null,
      front: bs.front,
      faceRoll: bs.faceRoll,
      appearAt: 0.12 + (bs.g[1] / maxGy) * 1.25 + Math.random() * 0.08,
      appeared: false,
    };
    gridMap.set(gridKey(bs.g[0], bs.g[1], bs.g[2]), block);
    return block;
  });
  inst.instanceColor.needsUpdate = true;
  inst.instanceMatrix.needsUpdate = true;

  // ワールド座標 → 格子座標の 変換オフセット（ensureShell 用）。
  // 生成時の中心合わせ規約に依存しないよう、実ブロックから逆算する
  if (blocks.length) {
    const b0 = blocks[0];
    gxOffset = b0.g[0] - b0.home[0] / V;
    gzOffset = b0.g[2] - b0.home[2] / V;
  }

  // おかお（おもてに でている 子の いちぶ）
  const faceCandidates = blocks.filter((b) =>
    (b.front || !gridMap.has(gridKey(b.g[0], b.g[1], b.g[2] + 1))) && b.g[1] > 0);
  const faceCount = Math.min(24, Math.floor(faceCandidates.length / 8));
  for (let i = 0; i < faceCount; i++) {
    const b = faceCandidates[Math.floor(Math.random() * faceCandidates.length)];
    if (faceItems.some((f) => f.block === b)) continue;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(V * 0.82, V * 0.82), faceMat);
    plane.position.set(b.home[0], b.home[1], b.home[2] + V / 2 + 0.012);
    scene.add(plane);
    faceItems.push({ block: b, mesh: plane });
  }

  // カメラ・かげ・じめん を おおきさに あわせる
  camTheta = (Math.random() - 0.5) * 0.5;
  camPhi = 1.12; camZoom = 1;
  fitCamera();
  const sceneR = Math.max(spec.radius, spec.height);
  sun.position.set(sceneR * 0.7 + 4, sceneR * 1.1 + 8, sceneR * 0.55 + 3);
  sun.shadow.camera.left = -(spec.radius + 2);
  sun.shadow.camera.right = spec.radius + 2;
  sun.shadow.camera.top = spec.height + 4;
  sun.shadow.camera.bottom = -2;
  sun.shadow.camera.far = sceneR * 5 + 30;
  sun.shadow.camera.updateProjectionMatrix();
  const discScale = Math.max(1, (spec.radius * 1.35) / 5.6);
  stageDisc.scale.setScalar(discScale);
  rimMesh.scale.setScalar(discScale);

  // ぽこぽこ たてる（したの だんから なみのように）
  state = ST.BUILD;
  buildDoneAt = elapsed + 1.6;
  const t0 = elapsed;
  for (const b of blocks) b.appearAt += t0;

  updateDeviceUI();
  paletteEl.classList.remove('hidden');
  ponBtn.classList.remove('hidden');
}

/* ===================== 物理ボディの つくりかた ===================== */
let sharedBoxShape = null;
function getBoxShape() {
  if (!sharedBoxShape || sharedBoxShape.__v !== V) {
    sharedBoxShape = new CANNON.Box(new CANNON.Vec3(V / 2, V / 2, V / 2));
    sharedBoxShape.__v = V;
  }
  return sharedBoxShape;
}

function attachBody(block, dynamic) {
  if (block.body) return block.body;
  const body = new CANNON.Body({
    mass: dynamic ? blockMass() : 0,
    type: dynamic ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
    material: matBlock,
    shape: getBoxShape(),
  });
  body.position.set(block.home[0], block.home[1], block.home[2]);
  body.allowSleep = true;
  body.sleepSpeedLimit = PHYS.sleepSpeedLimit;
  body.sleepTimeLimit = PHYS.sleepTimeLimit;
  body.__block = block;
  body.addEventListener('collide', onCollide);
  body.addEventListener('sleep', onBodySleep);
  world.addBody(body);
  block.body = body;
  return body;
}

function onCollide(e) {
  const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if ((state === ST.COLLAPSE || state === ST.RESULT) && impact > 1.6) SFX.sfxPlink(impact);
  // 動いている子が 凍結・がれきの子に 強くぶつかったら 巻き込む
  const me = e.target.__block;
  if (!me) return;
  if ((me.state === 'frozen' || me.state === 'rubble') && impact > 2.4) {
    const other = e.body.__block;
    if (other && other.state === 'dynamic') makeDynamic(me);
  }
}

function onBodySleep(e) {
  const block = e.target.__block;
  if (!block || block.state !== 'dynamic') return;
  // おやすみ → がれきとして 再凍結（物理コストから除外）
  const body = block.body;
  body.type = CANNON.Body.STATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.velocity.setZero();
  body.angularVelocity.setZero();
  block.state = 'rubble';
  dynSet.delete(block);
}

function makeDynamic(block) {
  if (block.state === 'gone' || block.state === 'dynamic') return;
  if (block.state === 'frozen') {
    gridMap.delete(gridKey(block.g[0], block.g[1], block.g[2]));
    connDirty = true;
  }
  const body = attachBody(block, true);
  if (body.type !== CANNON.Body.DYNAMIC) {
    body.type = CANNON.Body.DYNAMIC;
    body.mass = blockMass();
    body.updateMassProperties();
  }
  body.wakeUp();
  block.state = 'dynamic';
  dynSet.add(block);
}

function removeBlock(block) {
  if (block.state === 'gone') return;
  if (block.state === 'frozen') {
    gridMap.delete(gridKey(block.g[0], block.g[1], block.g[2]));
    connDirty = true;
  }
  if (block.body) {
    world.removeBody(block.body);
    block.body = null;
  }
  dynSet.delete(block);
  block.state = 'gone';
  setInstance(block.i, 0, -999, 0, null, 0.0001);
  inst.instanceMatrix.needsUpdate = true;
}

function blockPos(block) {
  return block.body ? block.body.position : { x: block.home[0], y: block.home[1], z: block.home[2] };
}

// 動いている子の まわりの凍結ブロックに、衝突用の静的ボディを 用意する
function ensureShell() {
  let creations = 0;
  for (const b of dynSet) {
    if (creations > 140) break;
    const p = b.body.position;
    const gx = Math.round(p.x / V + (spec ? 0 : 0) + gxOffset);
    const gy = Math.round((p.y - V / 2) / V);
    const gz = Math.round(p.z / V + gzOffset);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const ny = gy + dy;
          if (ny < 0) continue;
          const nb = gridMap.get(gridKey(gx + dx, ny, gz + dz));
          if (nb && !nb.body) {
            attachBody(nb, false);
            creations++;
          }
        }
      }
    }
  }
}
let gxOffset = 0, gzOffset = 0;   // ワールド座標 → 格子座標の 変換オフセット

/* ===================== そうち ロジック ===================== */
function devicesLeft() { return spec.devices - devices.length; }

function updateDeviceUI() {
  stickerDotsEl.innerHTML = '';
  if (spec) {
    for (let i = 0; i < spec.devices; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i < devices.length ? ' used' : '');
      d.textContent = i < devices.length ? DEVICE_EMOJI[devices[i].type] : '';
      stickerDotsEl.appendChild(d);
    }
  }
  const ready = devices.length > 0 && state === ST.PLACE;
  ponBtn.classList.toggle('disabled', !ready);
  ponBtn.classList.toggle('ready', ready);
  document.querySelectorAll('.stickerBtn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.type === selectedType);
  });
}

function removeDeviceVisual(dev) {
  if (dev.obj && dev.obj.parent) dev.obj.parent.remove(dev.obj);
}

// そうちの おおきさ：ブロックが小さくても つまみやすい 見た目サイズ
const devScale = () => Math.max(0.85, V * 1.7);

function placeDevice(block, hitPoint, hitNormal) {
  if (block.device) {
    const dev = block.device;
    removeDeviceVisual(dev);
    devices.splice(devices.indexOf(dev), 1);
    block.device = null;
    SFX.sfxUnplace();
    updateDeviceUI();
    return;
  }
  if (devicesLeft() <= 0) {
    SFX.sfxNope();
    return;
  }

  const dev = { type: selectedType, block, born: elapsed, fired: false, state: 'idle' };
  const s = devScale();

  if (selectedType === 'bomb') {
    const m = buildBombModel(s);
    m.group.position.copy(hitPoint).addScaledVector(hitNormal, 0.05 * s);
    m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hitNormal);
    scene.add(m.group);
    dev.obj = m.group; dev.bombMat = m.mat; dev.spark = m.spark;
    dev.worldPoint = hitPoint.clone();
  } else if (selectedType === 'fan') {
    const m = buildFanModel(s * 1.15);
    const worldPos = hitPoint.clone().addScaledVector(hitNormal, 0.95 * s);
    const dir = hitNormal.clone().negate().normalize();
    m.group.position.copy(worldPos);
    m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    scene.add(m.group);
    dev.obj = m.group; dev.blades = m.blades;
    dev.origin = worldPos; dev.dir = dir; dev.baseY = worldPos.y;
    dev.phase = Math.random() * Math.PI * 2;
  } else {
    const plane = new THREE.Mesh(targetGeo, new THREE.MeshBasicMaterial({
      map: targetTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    const ss = Math.max(V * 1.6, 0.7);
    plane.scale.set(ss, ss, 1);
    plane.position.copy(hitPoint).addScaledVector(hitNormal, 0.02);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);
    scene.add(plane);
    dev.obj = plane; dev.baseScale = ss;
    dev.worldPoint = hitPoint.clone(); dev.worldNormal = hitNormal.clone();
  }

  block.device = dev;
  devices.push(dev);
  SFX.sfxPlace();
  updateDeviceUI();
  scheduleHand();
}

/* ===================== はつどう ===================== */
const DEV_DURATION = { bomb: 1.1, fan: 3.1, hammer: 0.55 };
const FIRE_INTERVAL = 0.75;

function pressSwitch() {
  if (state !== ST.PLACE || devices.length === 0) return;
  state = ST.COLLAPSE;
  switchTime = elapsed;
  SFX.sfxSwitch();
  setFaces('excited');
  hideHand();
  paletteEl.classList.add('hidden');
  ponBtn.classList.add('hidden');
  meterEl.classList.remove('hidden');

  let lastEnd = 0;
  devices.forEach((dev, i) => {
    dev.fireAt = elapsed + 0.78 + i * FIRE_INTERVAL;
    lastEnd = Math.max(lastEnd, dev.fireAt + DEV_DURATION[dev.type]);
  });
  lastActivationTime = lastEnd;
}

function fireDevice(dev) {
  if (dev.type === 'bomb') {
    dev.state = 'fusing';
    dev.boomAt = elapsed + 0.95;
    SFX.sfxFuse(0.95);
  } else if (dev.type === 'fan') {
    dev.state = 'blowing';
    dev.until = elapsed + 2.9;
    SFX.sfxWind(3.0);
    windConvert(dev);
  } else {
    dev.state = 'swinging';
    SFX.sfxWhoosh();
    swingHammer(dev);
  }
}

// 💣 ばくはつ！
function explode(dev) {
  const block = dev.block;
  const p = blockPos(block);
  const center = [p.x, p.y, p.z];
  const centerV = new THREE.Vector3(p.x, p.y, p.z);

  SFX.sfxBomb();
  explosionFX(centerV, block.color);
  camShake = 0.36;

  const m = blockMass();
  for (const b of blocks) {
    if (b.state === 'gone' || b === block) continue;
    const q = blockPos(b);
    const eff = bombEffect(BP, center, [q.x, q.y, q.z], m, Math.random());
    if (!eff) continue;
    if (eff === 'break') {
      shatterBlock(b);
      continue;
    }
    makeDynamic(b);
    b.body.applyImpulse(new CANNON.Vec3(eff[0], eff[1], eff[2]));
  }
  if (block.state !== 'gone') removeBlock(block);
  dev.state = 'done';
  removeDeviceVisual(dev);
}

// つみきが 破片になって きえる
function shatterBlock(block) {
  const p = blockPos(block);
  const c = block.color;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
    pDebris.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 1.5 + Math.random() * 3, Math.sin(a) * sp,
      0.6 + Math.random() * 0.5, c.r, c.g, c.b, 8);
  }
  removeBlock(block);
}

// 💨 かぜが とどく範囲の 凍結ブロックを 動的にする
function windConvert(dev) {
  const range = V * 13;
  const tmp = new THREE.Vector3();
  for (const b of blocks) {
    if (b.state !== 'frozen' && b.state !== 'rubble') continue;
    const q = blockPos(b);
    tmp.set(q.x, q.y, q.z).sub(dev.origin);
    const t = tmp.dot(dev.dir);
    if (t < -0.2 || t > range) continue;
    const lateral = Math.sqrt(Math.max(0, tmp.lengthSq() - t * t));
    if (lateral > V * 1.8 + t * 0.42) continue;
    makeDynamic(b);
  }
}

// 💨 かぜの ちから（まいフレーム、動的な子だけ押す）
const tmpV = new THREE.Vector3();
function applyWind(dev, dt) {
  const range = V * 13;
  for (const b of dynSet) {
    const p = b.body.position;
    tmpV.set(p.x, p.y, p.z).sub(dev.origin);
    const t = tmpV.dot(dev.dir);
    if (t < -0.2 || t > range) continue;
    const lateral = Math.sqrt(Math.max(0, tmpV.lengthSq() - t * t));
    const radius = V * 1.8 + t * 0.5;
    if (lateral > radius) continue;
    const vAlong = b.body.velocity.x * dev.dir.x + b.body.velocity.y * dev.dir.y +
                   b.body.velocity.z * dev.dir.z;
    if (vAlong > 4.5) continue;
    const falloff = (1 - t / range) * (1 - (lateral / radius) * 0.5);
    const k = b.body.mass * 16 * falloff * dt;
    b.body.wakeUp();
    b.body.applyImpulse(new CANNON.Vec3(
      dev.dir.x * k, dev.dir.y * k + k * 0.12, dev.dir.z * k));
  }
  for (let i = 0; i < 2; i++) {
    const off = 0.35;
    pSparks.spawn(
      dev.origin.x + (Math.random() - 0.5) * off,
      dev.origin.y + (Math.random() - 0.5) * off,
      dev.origin.z + (Math.random() - 0.5) * off,
      dev.dir.x * (3.5 + Math.random() * 2) + (Math.random() - 0.5),
      dev.dir.y * 3.5 + (Math.random() - 0.3) * 0.6,
      dev.dir.z * (3.5 + Math.random() * 2) + (Math.random() - 0.5),
      0.5 + Math.random() * 0.3, 0.75, 0.92, 1, 0.4);
  }
}

// 🔨 ふりおろす
function swingHammer(dev) {
  removeDeviceVisual(dev);
  const m = buildHammerModel(devScale() * 1.25);
  m.group.position.copy(dev.worldPoint);
  m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dev.worldNormal);
  m.arm.rotation.x = 1.95;
  scene.add(m.group);

  const dur = 0.34;
  effects.push({
    t: 0, hit: false,
    update(dt) {
      this.t += dt;
      if (!this.hit) {
        const k = Math.min(1, this.t / dur);
        m.arm.rotation.x = 1.95 * (1 - k * k);
        if (k >= 1) {
          this.hit = true; this.t = 0;
          hammerImpact(dev);
        }
      } else {
        m.arm.rotation.x = Math.sin(this.t * 18) * 0.12 * Math.exp(-this.t * 6);
        if (this.t > 0.45) {
          m.group.scale.setScalar(Math.max(0.001, 1 - (this.t - 0.45) * 5) * devScale() * 1.25);
        }
        if (this.t > 0.65) { scene.remove(m.group); return false; }
      }
      return true;
    },
  });
}

function hammerImpact(dev) {
  SFX.sfxHit();
  camShake = 0.18;
  burstStar(dev.worldPoint, 12);
  const n = dev.worldNormal;
  const c = dev.worldPoint;
  const r = V * 2.4;
  for (const b of blocks) {
    if (b.state === 'gone') continue;
    const q = blockPos(b);
    const d = Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z);
    if (d > r) continue;
    makeDynamic(b);
    const falloff = 1 - d / r;
    b.body.velocity.x += -n.x * 8.5 * falloff + (Math.random() - 0.5);
    b.body.velocity.y += 1.6 * falloff;
    b.body.velocity.z += -n.z * 8.5 * falloff + (Math.random() - 0.5);
    b.body.angularVelocity.set(
      (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }
  dev.state = 'done';
}

// そうちの まいフレーム こうしん
function updateDevices(dt) {
  for (const dev of devices) {
    // 発動前に とりつけ先が 動きだしたら ついていく
    if (dev.type !== 'fan' && dev.obj && dev.block.state === 'dynamic' && dev.block.body) {
      const bp = dev.block.body.position;
      dev.obj.position.set(bp.x, bp.y + V * 0.5, bp.z);
      if (dev.worldPoint) dev.worldPoint.set(bp.x, bp.y, bp.z);
    }
    if (dev.type === 'bomb') {
      if (dev.state === 'idle' && dev.spark) {
        dev.spark.scale.setScalar(0.12 + Math.sin(elapsed * 6 + dev.born) * 0.035);
      } else if (dev.state === 'fusing') {
        const k = 1 - Math.max(0, dev.boomAt - elapsed) / 0.95;
        dev.bombMat.emissive.setRGB(
          0.7 * (0.4 + 0.6 * Math.abs(Math.sin(elapsed * 22))) * k, 0.05, 0.02);
        dev.spark.scale.setScalar(0.16 + Math.random() * 0.12);
        if (dev.obj.parent && Math.random() < 0.7) {
          dev.spark.getWorldPosition(tmpV);
          pSparks.spawn(tmpV.x, tmpV.y, tmpV.z,
            (Math.random() - 0.5) * 1.2, 0.5 + Math.random(), (Math.random() - 0.5) * 1.2,
            0.25 + Math.random() * 0.2, 1, 0.85, 0.45, 2.5);
        }
        if (elapsed >= dev.boomAt) explode(dev);
      }
    } else if (dev.type === 'fan') {
      const active = dev.state === 'blowing' && elapsed < dev.until;
      dev.blades.rotation.z += dt * (active ? 46 : 2.4);
      dev.obj.position.y = dev.baseY + Math.sin(elapsed * 2 + dev.phase) * 0.05;
      if (dev.state === 'blowing') {
        if (active) {
          applyWind(dev, dt);
        } else {
          dev.state = 'done';
          const obj = dev.obj;
          const s0 = obj.scale.x;
          effects.push({
            t: 0,
            update(dt2) {
              this.t += dt2;
              obj.scale.setScalar(Math.max(0.001, s0 * (1 - this.t * 2.5)));
              if (this.t > 0.42) { if (obj.parent) obj.parent.remove(obj); return false; }
              return true;
            },
          });
        }
      }
    } else if (dev.type === 'hammer') {
      if (dev.state === 'idle' && dev.obj) {
        const s = dev.baseScale * (1 + Math.sin((elapsed - dev.born) * 4.5) * 0.07);
        dev.obj.scale.set(s, s, 1);
      }
    }
  }
}

/* ===================== スコア と けっか ===================== */
function computeScore() {
  let sum = 0, total = 0;
  const yMin = V * 0.6;
  for (const b of blocks) {
    if (b.y0 < yMin) continue;
    total += b.y0;
    if (b.state === 'gone') sum += b.y0;
    else if (b.state === 'frozen') continue;
    else sum += Math.max(0, Math.min(b.y0, b.y0 - b.body.position.y));
  }
  return total > 0 ? sum / total : 0;
}

function updateMeter() {
  const s = computeScore();
  if (s > score) score = s;
  meterFill.style.height = `${Math.round(score * 100)}%`;
  const level = score >= 0.75 ? 3 : score >= 0.45 ? 2 : score >= 0.15 ? 1 : 0;
  if (level > meterLevel) {
    meterLevel = level;
    SFX.sfxMeterTick(level + 2);
    if (level >= 3) meterStar.classList.add('full');
  }
}

function starsForScore(s) {
  return s >= 0.75 ? 3 : s >= 0.45 ? 2 : s >= 0.15 ? 1 : 0;
}

function showResult() {
  state = ST.RESULT;
  setFaces('happy');
  adaptQuality();
  const stars = starsForScore(score);
  const charas = ['🐰🌸', '🐰🎀', '🦄💖', '🦄🌈✨'];
  resultChara.textContent = charas[stars];
  resultStars.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('span');
    el.className = 'rstar' + (i < stars ? '' : ' dim');
    el.textContent = '⭐';
    if (i < stars) el.style.animationDelay = `${0.3 + i * 0.35}s`;
    resultStars.appendChild(el);
  }
  resultCard.classList.remove('hidden');
  setTimeout(() => SFX.sfxFanfare(stars), 250);
  if (stars >= 2) spawnConfetti(stars === 3 ? 46 : 22);
  popCombo = 0;
}

// くずれの あいだの 実測FPSで つぎの ステージの 規模を きめる
function adaptQuality() {
  if (urlBudget || perfFrames < 30) return;
  const fps = perfFrames / perfAccum;
  if (fps >= 48) budget = Math.min(2500, budget + 250);
  else if (fps < 18) budget = Math.max(800, Math.round(budget * 0.6));
  else if (fps < 27) budget = Math.max(800, budget - 300);
  localStorage.setItem('nijiiro.budget', String(budget));
}

function spawnConfetti(n) {
  const emo = ['🌸', '💖', '⭐', '🎀', '✨', '💛', '💜'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'confettiBit';
    s.textContent = emo[(Math.random() * emo.length) | 0];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDuration = `${2.4 + Math.random() * 2}s`;
    s.style.animationDelay = `${Math.random() * 0.8}s`;
    confettiEl.appendChild(s);
  }
  setTimeout(() => { confettiEl.innerHTML = ''; }, 5500);
}

// けっかのあとの おそうじぽん（タップした あたりの 塊ごと）
function freePop(hitPoint) {
  const r = V * 2.2;
  let popped = 0;
  for (const b of blocks) {
    if (b.state === 'gone') continue;
    const q = blockPos(b);
    if (Math.hypot(q.x - hitPoint.x, q.y - hitPoint.y, q.z - hitPoint.z) > r) continue;
    removeBlock(b);
    popped++;
  }
  if (!popped) return;
  burstStar(hitPoint, Math.min(16, 6 + popped));
  if (elapsed - popComboTime > 1.6) popCombo = 0;
  popComboTime = elapsed;
  SFX.sfxPop(popCombo++);
  updateMeter();
}

/* ===================== おしえて ゆび ===================== */
let handTimer = null;
function hideHand() {
  handEl.classList.add('hidden');
  if (handTimer) { clearTimeout(handTimer); handTimer = null; }
}
function scheduleHand() {
  hideHand();
  if (state !== ST.PLACE && state !== ST.BUILD) return;
  handTimer = setTimeout(() => {
    if (state !== ST.PLACE) return;
    if (devices.length === 0) {
      handEl.style.left = '50%';
      handEl.style.top = '42%';
      handEl.classList.remove('hidden');
    } else {
      const r = ponBtn.getBoundingClientRect();
      handEl.style.left = `${r.left + r.width / 2}px`;
      handEl.style.top = `${r.top + r.height * 0.15}px`;
      handEl.classList.remove('hidden');
    }
  }, devices.length === 0 ? 2600 : 3600);
}

/* ===================== にゅうりょく ===================== */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickBlock(clientX, clientY) {
  if (!inst) return null;
  ndc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(inst, false);
  for (const hit of hits) {
    const block = blocks[hit.instanceId];
    if (!block || block.state === 'gone') continue;
    return { block, point: hit.point, normal: hit.face.normal.clone() };
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  SFX.unlock();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  dragMoved = false;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
  hideHand();
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 9) dragMoved = true;

  if (pointers.size === 1 && dragMoved) {
    camTheta -= dx * 0.0052;
    camPhi = Math.max(0.42, Math.min(1.38, camPhi - dy * 0.004));
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) camZoom = Math.max(0.5, Math.min(2.0, camZoom * pinchDist / d));
    pinchDist = d;
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || dragMoved || pointers.size > 0) return;
  const hit = pickBlock(e.clientX, e.clientY);
  if (!hit) return;
  if (state === ST.PLACE) {
    if (hit.block.state === 'frozen') placeDevice(hit.block, hit.point, hit.normal);
  } else if (state === ST.RESULT) {
    freePop(hit.point);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ===================== UI ボタン ===================== */
document.querySelectorAll('.stickerBtn').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    SFX.unlock();
    selectedType = btn.dataset.type;
    SFX.sfxSelect();
    updateDeviceUI();
  });
});

ponBtn.addEventListener('click', () => { SFX.unlock(); pressSwitch(); });

retryBtn.addEventListener('click', () => {
  SFX.unlock(); SFX.sfxSelect();
  startStage(stage, seed);
});
nextBtn.addEventListener('click', () => {
  SFX.unlock(); SFX.sfxSelect();
  startStage(stage + 1, (Math.random() * 1e9) | 0);
});

muteBtn.addEventListener('click', () => {
  SFX.unlock();
  const m = !SFX.isMuted();
  SFX.setMuted(m);
  muteBtn.textContent = m ? '🔇' : '🔊';
  localStorage.setItem('nijiiro.mute', m ? '1' : '0');
});
if (localStorage.getItem('nijiiro.mute') === '1') {
  SFX.setMuted(true);
  muteBtn.textContent = '🔇';
}

startBtn.addEventListener('click', () => {
  SFX.unlock();
  SFX.startMusic();
  SFX.sfxFanfare(2);
  titleEl.classList.add('fadeout');
  setTimeout(() => titleEl.classList.add('hidden'), 650);
  startStage(stage, seed);
});

/* ===================== メイン ループ ===================== */
let lastT = performance.now();
let blinkAt = 3;
let lastBuildTick = -1;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  elapsed += dt;

  if (state !== ST.TITLE && spec) {
    ensureShell();

    // 過負荷ガード：大きな塊が いっせいに 落ちる ときは
    // ソルバーを 軽くし、おそい子から 積極的に 再凍結する
    const heavy = dynSet.size > 420;
    world.solver.iterations = heavy ? 4 : 10;
    if (heavy) {
      for (const b of dynSet) {
        if (b.body.position.y < V * 1.6 &&
            b.body.velocity.lengthSquared() < 0.5) {
          const body = b.body;
          body.type = CANNON.Body.STATIC;
          body.mass = 0;
          body.updateMassProperties();
          body.velocity.setZero();
          body.angularVelocity.setZero();
          b.state = 'rubble';
          dynSet.delete(b);
        }
      }
    }

    world.step(1 / 60, dt, 2);

    if (state === ST.COLLAPSE) {
      for (const dev of devices) {
        if (!dev.fired && dev.fireAt !== undefined && elapsed >= dev.fireAt) {
          dev.fired = true;
          fireDevice(dev);
        }
      }
      perfAccum += dt;
      perfFrames++;
    }

    updateDevices(dt);

    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) effects.splice(i, 1);
    }

    // 接地チェック：支えを失った 塊を 落とす
    if (connDirty && elapsed > connCheckAt &&
        (state === ST.COLLAPSE || state === ST.RESULT)) {
      connCheckAt = elapsed + 0.35;
      connDirty = false;
      const lost = findUngrounded(gridMap);
      let n = 0;
      for (const key of lost) {
        const b = gridMap.get(key);
        if (b) { makeDynamic(b); n++; }
        if (n > 700) break;
      }
      if (lost.length > 700) connDirty = true;
    }

    // 出現アニメーション（したの だんから なみのように）
    if (state === ST.BUILD) {
      let tickPlayed = false;
      for (const b of blocks) {
        if (b.appeared) continue;
        if (elapsed >= b.appearAt) {
          b.appeared = true;
          setInstance(b.i, b.home[0], b.home[1], b.home[2], null, 1);
          if (!tickPlayed && b.g[1] !== lastBuildTick) {
            lastBuildTick = b.g[1];
            SFX.sfxBuildTick(b.g[1]);
            tickPlayed = true;
          }
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      if (elapsed >= buildDoneAt) {
        for (const b of blocks) {
          if (!b.appeared) {
            b.appeared = true;
            setInstance(b.i, b.home[0], b.home[1], b.home[2], null, 1);
          }
        }
        inst.instanceMatrix.needsUpdate = true;
        state = ST.PLACE;
        updateDeviceUI();
        scheduleHand();
      }
    }

    // 動いた子の 行列を どうき
    if (dynSet.size > 0 || state === ST.COLLAPSE) {
      for (const b of dynSet) {
        const p = b.body.position;
        _q.set(b.body.quaternion.x, b.body.quaternion.y,
               b.body.quaternion.z, b.body.quaternion.w);
        setInstance(b.i, p.x, p.y, p.z, _q, 1);
      }
      inst.instanceMatrix.needsUpdate = true;
    }

    // どきどき ぶるぶる（くずれる まえの ため）
    if (state === ST.COLLAPSE && switchTime >= 0) {
      const w = elapsed - switchTime;
      if (w < 0.68) {
        inst.position.x = Math.sin(w * 44) * 0.02;
        inst.position.z = Math.cos(w * 55) * 0.02;
      } else if (inst.position.x !== 0) {
        inst.position.set(0, 0, 0);
      }
    }

    // おかお の どうき
    for (const f of faceItems) {
      const b = f.block;
      if (b.state === 'gone') { f.mesh.visible = false; continue; }
      if (b.state !== 'frozen' && b.body) {
        f.mesh.position.set(b.body.position.x, b.body.position.y, b.body.position.z);
        f.mesh.quaternion.set(b.body.quaternion.x, b.body.quaternion.y,
                              b.body.quaternion.z, b.body.quaternion.w);
        f.mesh.translateZ(V / 2 + 0.012);
      }
    }

    if (state === ST.COLLAPSE) {
      updateMeter();
      if (lastActivationTime > 0 && elapsed > lastActivationTime + 1.6) {
        let calm = !connDirty;
        if (calm) {
          for (const b of dynSet) {
            if (b.body.velocity.lengthSquared() > 0.08) { calm = false; break; }
          }
        }
        if (calm) {
          if (calmSince < 0) calmSince = elapsed;
        } else {
          calmSince = -1;
        }
        const settled = calmSince >= 0 && elapsed - calmSince > 0.8;
        if (settled || elapsed > lastActivationTime + 12) showResult();
      }
    } else if (state === ST.RESULT) {
      updateMeter();
    }

    // まばたき
    if (elapsed > blinkAt && (state === ST.PLACE || state === ST.BUILD)) {
      setFaces('blink');
      setTimeout(() => { if (state === ST.PLACE || state === ST.BUILD) setFaces('normal'); }, 160);
      blinkAt = elapsed + 2.6 + Math.random() * 2.4;
    }
  }

  pStars.update(dt);
  pSparks.update(dt);
  pFire.update(dt);
  pSmoke.update(dt);
  pDebris.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

/* ===================== きどう ===================== */
resize();
requestAnimationFrame(tick);

// かいはつ・テスト用の のぞきまど（ゲームには影響しない）
window.NIJI = {
  get state() { return state; },
  get elapsed() { return elapsed; },
  get lastActivationTime() { return lastActivationTime; },
  get calmSince() { return calmSince; },
  get score() { return score; },
  get count() { return blocks.length; },
  get dynCount() { return dynSet.size; },
  get budget() { return budget; },
  get fps() { return perfFrames > 0 ? perfFrames / perfAccum : 0; },
};
