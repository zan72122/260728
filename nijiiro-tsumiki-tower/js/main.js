/* ============================================================
   にじいろつみきタワー — main.js
   ⭐ぽんっ（きえる＝したにくずれる）
   💗ふわ〜（ふうせんになって うえにうかぶ）
   🌈つるん（つるつるになって よこにすべる）
   ============================================================ */

import * as THREE from '../lib/three.module.min.js';
import * as CANNON from '../lib/cannon-es.js';
import { buildTowerSpec, PHYS, U } from './towers.js';
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

/* ========================== レンダラー ========================== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffdcef, 26, 60);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

// ひかり
scene.add(new THREE.HemisphereLight(0xd6ecff, 0xffd1ea, 1.05));
const sun = new THREE.DirectionalLight(0xfff3dc, 1.9);
sun.position.set(7, 14, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 14;  sun.shadow.camera.bottom = -4;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ========================= じめん ========================= */
{
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshLambertMaterial({ color: 0xb9e6a6 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const stageDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.6, 48),
    new THREE.MeshLambertMaterial({ color: 0xffd9ec })
  );
  stageDisc.rotation.x = -Math.PI / 2;
  stageDisc.position.y = 0.012;
  stageDisc.receiveShadow = true;
  scene.add(stageDisc);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(5.6, 6.1, 48),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.013;
  scene.add(rim);
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

// ---- おかお（4しゅるい：ふつう / まばたき / わくわく / にこにこ） ----
function drawFace(ctx, s, mode) {
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = '#5a4a52';
  ctx.fillStyle = '#5a4a52';
  ctx.lineWidth = s * 0.045;
  ctx.lineCap = 'round';
  const eyeY = s * 0.42, eyeDX = s * 0.18;
  // ほっぺ
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
    if (mode === 'blink' || mode === 'happy') {         // とじため（にこにこ）
      ctx.arc(ex, eyeY + s * 0.02, s * 0.075, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (mode === 'excited') {                     // まんまる目
      ctx.arc(ex, eyeY, s * 0.075, 0, Math.PI * 2);
      ctx.stroke();
    } else {                                             // ふつうの点目
      ctx.arc(ex, eyeY, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  if (mode === 'excited') {                              // 「わお」の口
    ctx.arc(s / 2, s * 0.6, s * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mode === 'happy') {                         // おおきな にっこり
    ctx.arc(s / 2, s * 0.52, s * 0.13, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else {                                               // ちいさな にっこり
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

// ---- シール（しろい ふちどりの まる + アイコン） ----
function stickerBase(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = '#ffc3de';
  ctx.stroke();
}
function drawStar(ctx, cx, cy, r, color) {
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
function drawHeart(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.85);
  ctx.bezierCurveTo(cx - r * 1.5, cy - r * 0.25, cx - r * 0.7, cy - r * 1.1, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.1, cx + r * 1.5, cy - r * 0.25, cx, cy + r * 0.85);
  ctx.fillStyle = color;
  ctx.fill();
}
const stickerTex = {
  star: makeCanvas(256, (c, s) => {
    stickerBase(c, s);
    drawStar(c, s / 2, s / 2 + s * 0.02, s * 0.3, '#ffcf3f');
  }),
  heart: makeCanvas(256, (c, s) => {
    stickerBase(c, s);
    drawHeart(c, s / 2, s / 2, s * 0.27, '#ff6fa5');
  }),
  rainbow: makeCanvas(256, (c, s) => {
    stickerBase(c, s);
    const cols = ['#ff6f9c', '#ffab5c', '#ffe14d', '#7ed37e', '#5bbcf0', '#9a8cf5'];
    c.lineCap = 'round';
    cols.forEach((col, i) => {
      c.beginPath();
      c.arc(s / 2, s * 0.66, s * 0.34 - i * s * 0.045, Math.PI, Math.PI * 2);
      c.strokeStyle = col;
      c.lineWidth = s * 0.038;
      c.stroke();
    });
  }),
};
const stickerGeo = new THREE.PlaneGeometry(1, 1);

// ---- パーティクル テクスチャ ----
const texStarP = makeCanvas(64, (c, s) => drawStar(c, s / 2, s / 2, s * 0.44, '#fff2a8'));
const texHeartP = makeCanvas(64, (c, s) => drawHeart(c, s / 2, s / 2, s * 0.36, '#ffb3cf'));
const texSpark = makeCanvas(64, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
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
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(flowerMat);
    const a = Math.random() * Math.PI * 2;
    const r = 6.8 + Math.random() * 12;
    sp.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r);
    const sc = 0.35 + Math.random() * 0.3;
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
const pStars = new ParticlePool(texStarP, 120, THREE.AdditiveBlending, 0.34);
const pHearts = new ParticlePool(texHeartP, 90, THREE.NormalBlending, 0.3);
const pSparks = new ParticlePool(texSpark, 160, THREE.AdditiveBlending, 0.26);

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
function burstHeart(p, n = 10, up = 1.6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.1;
    pHearts.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, up + Math.random() * 1.4, Math.sin(a) * sp,
      0.8 + Math.random() * 0.5, 1, 0.62, 0.78, -0.6);
  }
}
function rainbowSpark(p, hue) {
  const c = new THREE.Color().setHSL(hue % 1, 0.85, 0.68);
  pSparks.spawn(
    p.x + (Math.random() - 0.5) * 0.5, p.y + (Math.random() - 0.5) * 0.5,
    p.z + (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.6, 0.4 + Math.random(), (Math.random() - 0.5) * 0.6,
    0.5 + Math.random() * 0.3, c.r, c.g, c.b, 1.2);
}

/* ===================== ぶつり ワールド ===================== */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);

const matBlock = new CANNON.Material('block');
const matGround = new CANNON.Material('ground');
const matSlip = new CANNON.Material('slip');
world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matBlock,
  { friction: PHYS.frictionBlock, restitution: PHYS.restitution }));
world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matGround,
  { friction: PHYS.frictionGround, restitution: PHYS.restitution }));
for (const other of [matBlock, matGround, matSlip]) {
  world.addContactMaterial(new CANNON.ContactMaterial(matSlip, other,
    { friction: PHYS.frictionSlip, restitution: PHYS.restitution }));
}
world.defaultContactMaterial.friction = 0.5;

const groundBody = new CANNON.Body({ mass: 0, material: matGround, shape: new CANNON.Plane() });
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

/* =================== まるい つみき ジオメトリ =================== */
const geoCache = new Map();
function roundedBoxGeo(w, h, d) {
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const r = Math.min(w, h, d) * 0.16;
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
  geoCache.set(key, geo);
  return geo;
}
function coneGeo(r, h) {
  const key = `cone_${r.toFixed(3)}_${h.toFixed(3)}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.ConeGeometry(r, h, 20));
  return geoCache.get(key);
}
function cylGeo(r, h) {
  const key = `cyl_${r.toFixed(3)}_${h.toFixed(3)}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(r, r, h, 20));
  return geoCache.get(key);
}

/* ===================== ゲームの じょうたい ===================== */
const ST = { TITLE: 0, BUILD: 1, PLACE: 2, COLLAPSE: 3, RESULT: 4 };
let state = ST.TITLE;

let stage = parseInt(localStorage.getItem('nijiiro.stage') || '1', 10) || 1;
let seed = (Math.random() * 1e9) | 0;
let spec = null;

let blocks = [];            // { mesh, body, spec, y0, alive, sticker, visScale, balloon }
let stickers = [];          // 置いた順 { type, block, plane }
let selectedType = 'star';
let balloons = [];          // 浮遊中 { block, t0, phase }
let rainbowTrails = [];     // { block, until, hue }
let popCombo = 0, popComboTime = 0;

let switchTime = -1;        // ぽんスイッチを押した時刻
let lastActivationTime = -1;
let calmSince = -1;         // しずかに なりはじめた時刻
let score = 0;              // 0..1 くずれた たかさの わりあい
let meterLevel = 0;
let elapsed = 0;

/* ===================== カメラ そうさ ===================== */
let camTheta = -0.65, camPhi = 1.08, camZoom = 1, baseDist = 10, targetY = 2;
const pointers = new Map();
let dragMoved = false, pinchDist = 0;

function fitCamera() {
  if (!spec) return;
  const fov = (camera.fov * Math.PI) / 180;
  const aspect = camera.aspect;
  const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  targetY = spec.height * 0.42;
  const dV = (spec.height * 0.62 + 0.9) / Math.tan(fov / 2);
  const dH = (spec.radius + 0.9) / Math.tan(hfov / 2);
  baseDist = Math.max(dV, dH) * 1.1 + 1.4;
}
function updateCamera(dt) {
  if (state === ST.COLLAPSE || state === ST.RESULT) camTheta += dt * 0.14;
  const r = baseDist * camZoom;
  const sp = Math.sin(camPhi), cp = Math.cos(camPhi);
  camera.position.set(
    Math.sin(camTheta) * sp * r,
    Math.max(0.8, targetY + cp * r),
    Math.cos(camTheta) * sp * r
  );
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
    if (b.body.world) world.removeBody(b.body);
    scene.remove(b.mesh);
    b.mesh.material.dispose();
  }
  blocks = [];
  stickers = [];
  balloons = [];
  rainbowTrails = [];
  score = 0; meterLevel = 0;
  switchTime = -1; lastActivationTime = -1; calmSince = -1;
  meterFill.style.height = '0%';
  meterStar.classList.remove('full');
  meterEl.classList.add('hidden');
  resultCard.classList.add('hidden');
  confettiEl.innerHTML = '';
  setFaces('normal');
}

function makeBlock(bs, index, total) {
  // いろ：たかさで にじ グラデーション（+ 個体ゆらぎ）
  const tRatio = Math.min(1, bs.p[1] / Math.max(0.1, spec.height));
  let color;
  if (bs.kind === 'cone') {
    color = new THREE.Color().setHSL(((330 + bs.hueJitter) % 360) / 360, 0.75, 0.72);
  } else {
    const hue = ((tRatio * 300 + bs.hueJitter + 360) % 360) / 360;
    color = new THREE.Color().setHSL(hue, 0.72, 0.64);
  }
  const mat = new THREE.MeshLambertMaterial({ color });

  let geo, shape, mass;
  if (bs.kind === 'box') {
    geo = roundedBoxGeo(bs.s[0], bs.s[1], bs.s[2]);
    shape = new CANNON.Box(new CANNON.Vec3(bs.s[0] / 2, bs.s[1] / 2, bs.s[2] / 2));
    mass = bs.s[0] * bs.s[1] * bs.s[2] * PHYS.density;
  } else if (bs.kind === 'cone') {
    geo = coneGeo(bs.s[0], bs.s[1]);
    shape = new CANNON.Cylinder(bs.s[0] * 0.12, bs.s[0] * 0.85, bs.s[1] * 0.95, 10);
    mass = (Math.PI * bs.s[0] ** 2 * bs.s[1] / 3) * PHYS.density;
  } else {
    geo = cylGeo(bs.s[0], bs.s[1]);
    shape = new CANNON.Cylinder(bs.s[0], bs.s[0], bs.s[1], 12);
    mass = Math.PI * bs.s[0] ** 2 * bs.s[1] * PHYS.density;
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({ mass, material: matBlock, shape });
  body.position.set(bs.p[0], bs.p[1], bs.p[2]);
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), bs.ry || 0);
  body.allowSleep = true;
  body.sleepSpeedLimit = PHYS.sleepSpeedLimit;
  body.sleepTimeLimit = PHYS.sleepTimeLimit;
  world.addBody(body);
  body.sleep();   // ならべた しゅんかんは ぐっすり → ぜったい くずれない

  // しょうとつ音
  body.addEventListener('collide', (e) => {
    if (state !== ST.COLLAPSE && state !== ST.RESULT) return;
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 1.4) SFX.sfxPlink(v);
  });

  const block = {
    mesh, body, spec: bs, y0: bs.p[1], alive: true,
    sticker: null, visScale: 0, index,
  };

  // おかお（よこながの めん に）
  if (bs.kind === 'box' && bs.faceRoll < 0.3) {
    const sides = [
      [0, 0, bs.s[2] / 2, 0],
      [bs.s[0] / 2, 0, 0, Math.PI / 2],
      [0, 0, -bs.s[2] / 2, Math.PI],
      [-bs.s[0] / 2, 0, 0, -Math.PI / 2],
    ];
    const [fx, fy, fz, rot] = sides[bs.faceSide];
    const fs = Math.min(bs.s[0], bs.s[1], bs.s[2]) * 0.82;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(fs, fs), faceMat);
    plane.position.set(fx, fy, fz);
    plane.rotation.y = rot;
    plane.translateZ(0.012);
    mesh.add(plane);
  }
  return block;
}

function startStage(newStage, newSeed) {
  stage = newStage; seed = newSeed;
  localStorage.setItem('nijiiro.stage', String(stage));
  clearStage();
  spec = buildTowerSpec(stage, seed);

  stageIconEl.textContent = spec.icon;
  stageNumEl.textContent = String(stage);
  stageNameEl.textContent = spec.name;

  for (let i = 0; i < spec.blocks.length; i++) {
    const b = makeBlock(spec.blocks[i], i, spec.blocks.length);
    b.mesh.scale.setScalar(0.001);
    b.mesh.position.copy(b.body.position);
    b.mesh.quaternion.copy(b.body.quaternion);
    blocks.push(b);
  }

  camTheta = -0.65 + (Math.random() - 0.5) * 0.4;
  camPhi = 1.08; camZoom = 1;
  fitCamera();

  // ぽこぽこ たてる えんしゅつ
  state = ST.BUILD;
  const stepMs = Math.min(20, 1300 / blocks.length);
  blocks.forEach((b, i) => {
    b.popInAt = elapsed + 0.15 + i * stepMs / 1000;
  });
  setTimeout(() => {
    if (state === ST.BUILD) {
      state = ST.PLACE;
      updateStickerUI();
      scheduleHand();
    }
  }, 400 + blocks.length * stepMs);

  updateStickerUI();
  paletteEl.classList.remove('hidden');
  ponBtn.classList.remove('hidden');
}

/* ===================== シール ロジック ===================== */
function stickersLeft() { return spec.stickers - stickers.length; }

function updateStickerUI() {
  // のこり ドット
  stickerDotsEl.innerHTML = '';
  if (spec) {
    for (let i = 0; i < spec.stickers; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i < stickers.length ? ' used' : '');
      d.textContent = i < stickers.length ?
        { star: '⭐', heart: '💗', rainbow: '🌈' }[stickers[i].type] : '';
      stickerDotsEl.appendChild(d);
    }
  }
  // ぽんスイッチ
  const ready = stickers.length > 0 && state === ST.PLACE;
  ponBtn.classList.toggle('disabled', !ready);
  ponBtn.classList.toggle('ready', ready);
  // パレット選択
  document.querySelectorAll('.stickerBtn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.type === selectedType);
  });
}

function placeSticker(block, hitPoint, hitNormal) {
  // すでに はってあれば はがす（やりなおし）
  if (block.sticker) {
    const st = block.sticker;
    block.mesh.remove(st.plane);
    stickers.splice(stickers.indexOf(st), 1);
    block.sticker = null;
    SFX.sfxUnplace();
    updateStickerUI();
    return;
  }
  if (stickersLeft() <= 0) {
    SFX.sfxNope();
    wiggleMesh(block);
    return;
  }
  // ワールド → ブロックローカルへ
  const localP = block.mesh.worldToLocal(hitPoint.clone());
  const invQ = block.mesh.quaternion.clone().invert();
  const localN = hitNormal.clone().applyQuaternion(invQ).normalize();

  const size = Math.min(...(block.spec.kind === 'box' ? block.spec.s : [block.spec.s[0] * 2]));
  const plane = new THREE.Mesh(stickerGeo, new THREE.MeshBasicMaterial({
    map: stickerTex[selectedType], transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const ss = size * 0.8;
  plane.scale.set(ss, ss, 1);
  plane.position.copy(localP).addScaledVector(localN, 0.018);
  plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localN);
  block.mesh.add(plane);

  const st = { type: selectedType, block, plane, born: elapsed };
  block.sticker = st;
  stickers.push(st);
  SFX.sfxPlace();
  updateStickerUI();
  scheduleHand();
}

function wiggleMesh(block) {
  block.wiggleUntil = elapsed + 0.45;
}

/* ===================== はつどう ===================== */
function pressSwitch() {
  if (state !== ST.PLACE || stickers.length === 0) return;
  state = ST.COLLAPSE;
  switchTime = elapsed;
  SFX.sfxSwitch();
  setFaces('excited');
  hideHand();
  paletteEl.classList.add('hidden');
  ponBtn.classList.add('hidden');
  meterEl.classList.remove('hidden');

  // どきどき… の あと ぜんいん おきる → 順番に はつどう
  setTimeout(() => { for (const b of blocks) if (b.alive) b.body.wakeUp(); }, 620);
  stickers.forEach((st, i) => {
    setTimeout(() => activateSticker(st), 750 + i * 780);
  });
  lastActivationTime = elapsed + (750 + (stickers.length - 1) * 780) / 1000;
}

function activateSticker(st) {
  const block = st.block;
  if (!block.alive) return;
  const p = block.body.position;
  const pos = new THREE.Vector3(p.x, p.y, p.z);

  if (st.type === 'star') {
    // ⭐ ぽんっ：きえて ささえが なくなる（+ うえのこ に ちいさな ゆらぎ）
    SFX.sfxStar();
    burstStar(pos, 16);
    removeBlock(block);
    for (const b of blocks) {
      if (!b.alive) continue;
      const d = Math.hypot(b.body.position.x - p.x, b.body.position.z - p.z);
      if (d < U * 1.9 && b.body.position.y > p.y) {
        b.body.wakeUp();
        b.body.applyImpulse(new CANNON.Vec3(
          (Math.random() - 0.5) * 0.5 * b.body.mass,
          0,
          (Math.random() - 0.5) * 0.5 * b.body.mass
        ));
      }
    }
  } else if (st.type === 'heart') {
    // 💗 ふわ〜：ふうせんになって うかぶ
    SFX.sfxHeart();
    burstHeart(pos, 8, 1.2);
    block.mesh.material.color.set(0xff9ec6);
    block.body.wakeUp();
    block.body.angularVelocity.set(
      (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2);
    balloons.push({ block, t0: elapsed, phase: Math.random() * Math.PI * 2 });
  } else {
    // 🌈 つるん：つるつる + よこに すいー
    SFX.sfxRainbow();
    block.body.material = matSlip;
    block.body.wakeUp();
    const a = Math.random() * Math.PI * 2;
    block.body.velocity.x += Math.cos(a) * 2.4;
    block.body.velocity.z += Math.sin(a) * 2.4;
    block.body.velocity.y += 0.6;
    rainbowTrails.push({ block, until: elapsed + 1.5, hue: Math.random() });
    // まわりも すこし おこす
    for (const b of blocks) {
      if (!b.alive) continue;
      const q = b.body.position;
      if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < U * 2.2) b.body.wakeUp();
    }
  }
  if (st.plane.parent) st.plane.parent.remove(st.plane);
}

function removeBlock(block) {
  block.alive = false;
  world.removeBody(block.body);
  scene.remove(block.mesh);
}

/* ===================== スコア と けっか ===================== */
function computeScore() {
  let sum = 0, total = 0;
  for (const b of blocks) {
    if (b.y0 < U * 0.6) continue;             // もともと じめん の こ は のぞく
    total += b.y0;
    if (!b.alive) sum += b.y0;
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

// けっかのあとの おそうじぽん
function freePop(block) {
  const p = block.body.position;
  burstStar(new THREE.Vector3(p.x, p.y, p.z), 10);
  removeBlock(block);
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
  if (state !== ST.PLACE && !(state === ST.BUILD)) return;
  handTimer = setTimeout(() => {
    if (state !== ST.PLACE) return;
    if (stickers.length === 0) {
      // タワーを さして「ここを タップ」
      handEl.style.left = '50%';
      handEl.style.top = '42%';
      handEl.classList.remove('hidden');
    } else {
      // ぽんスイッチを さす
      const r = ponBtn.getBoundingClientRect();
      handEl.style.left = `${r.left + r.width / 2}px`;
      handEl.style.top = `${r.top + r.height * 0.15}px`;
      handEl.classList.remove('hidden');
    }
  }, stickers.length === 0 ? 2600 : 3600);
}

/* ===================== にゅうりょく ===================== */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickBlock(clientX, clientY) {
  ndc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const meshes = [];
  for (const b of blocks) if (b.alive) meshes.push(b.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const block = blocks.find((b) => b.mesh === hit.object);
  return { block, point: hit.point, normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld) };
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
    if (pinchDist > 0) camZoom = Math.max(0.55, Math.min(1.9, camZoom * pinchDist / d));
    pinchDist = d;
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || dragMoved || pointers.size > 0) return;
  // タップ！
  const hit = pickBlock(e.clientX, e.clientY);
  if (!hit) return;
  if (state === ST.PLACE) {
    placeSticker(hit.block, hit.point, hit.normal);
  } else if (state === ST.RESULT) {
    freePop(hit.block);
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
    updateStickerUI();
  });
});

ponBtn.addEventListener('click', () => { SFX.unlock(); pressSwitch(); });

retryBtn.addEventListener('click', () => {
  SFX.unlock(); SFX.sfxSelect();
  startStage(stage, seed);                     // おなじ タワーで もういっかい
});
nextBtn.addEventListener('click', () => {
  SFX.unlock(); SFX.sfxSelect();
  startStage(stage + 1, (Math.random() * 1e9) | 0);  // あたらしい タワー
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
let buildTickIdx = 0;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  elapsed += dt;

  if (state !== ST.TITLE) {
    world.step(1 / 60, dt, 3);

    // 💗 ふうせん の うきうき ちから
    for (let i = balloons.length - 1; i >= 0; i--) {
      const bl = balloons[i];
      const b = bl.block;
      if (!b.alive) { balloons.splice(i, 1); continue; }
      const age = elapsed - bl.t0;
      const m = b.body.mass;
      b.body.wakeUp();
      b.body.applyForce(new CANNON.Vec3(
        Math.sin(elapsed * 2.6 + bl.phase) * m * 2.2,
        -PHYS.gravity * m * 1.55,
        Math.cos(elapsed * 2.2 + bl.phase) * m * 2.2
      ));
      burstHeartTrail(b);
      if (age > 2.7 || b.body.position.y > spec.height + 3.5) {
        const p = b.body.position;
        SFX.sfxHeartPop();
        burstHeart(new THREE.Vector3(p.x, p.y, p.z), 12, 0.8);
        removeBlock(b);
        balloons.splice(i, 1);
      }
    }

    // 🌈 にじの あと
    for (let i = rainbowTrails.length - 1; i >= 0; i--) {
      const tr = rainbowTrails[i];
      if (!tr.block.alive || elapsed > tr.until) { rainbowTrails.splice(i, 1); continue; }
      tr.hue += dt * 1.6;
      tr.block.mesh.material.color.setHSL(tr.hue % 1, 0.8, 0.66);
      const p = tr.block.body.position;
      rainbowSpark(p, tr.hue);
    }

    // メッシュ どうき
    const wiggling = state === ST.COLLAPSE && switchTime >= 0 &&
                     elapsed - switchTime < 0.68;
    for (const b of blocks) {
      if (!b.alive) continue;
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
      // ぽこっと たつ
      if (b.visScale < 1) {
        if (elapsed >= (b.popInAt || 0)) {
          if (b.visScale === 0 && buildTickIdx++ % 2 === 0) SFX.sfxBuildTick(b.index);
          b.visScale = Math.min(1, b.visScale + dt * 6);
          const s = 1 + Math.sin(b.visScale * Math.PI) * 0.18;
          b.mesh.scale.setScalar(b.visScale * s);
        }
      }
      // どきどき ぶるぶる（くずれる まえの ため）
      if (wiggling) {
        const k = (elapsed - switchTime) * 42 + b.index;
        b.mesh.position.x += Math.sin(k) * 0.018;
        b.mesh.position.z += Math.cos(k * 1.3) * 0.018;
      }
      // シールなし タップの ぷるぷる
      if (b.wiggleUntil && elapsed < b.wiggleUntil) {
        const s = 1 + Math.sin((b.wiggleUntil - elapsed) * 30) * 0.06;
        b.mesh.scale.setScalar(s);
      } else if (b.visScale >= 1) {
        b.mesh.scale.setScalar(1);
      }
    }

    // シールの ぷくぷく
    for (const st of stickers) {
      if (!st.plane.parent) continue;
      const base = st.plane.scale.x / (st.pulse || 1);
      st.pulse = 1 + Math.sin((elapsed - st.born) * 4.5) * 0.08;
      st.plane.scale.set(base * st.pulse, base * st.pulse, 1);
    }

    // くずれ ちゅう：メーター + おちつき はんてい
    if (state === ST.COLLAPSE) {
      updateMeter();
      if (lastActivationTime > 0 && elapsed > lastActivationTime + 1.6) {
        let calm = true;
        for (const b of blocks) {
          if (!b.alive) continue;
          if (b.body.sleepState !== CANNON.Body.SLEEPING &&
              b.body.velocity.lengthSquared() > 0.06) { calm = false; break; }
        }
        if (calm) {
          if (calmSince < 0) calmSince = elapsed;
        } else {
          calmSince = -1;
        }
        const settled = calmSince >= 0 && elapsed - calmSince > 0.8;
        if (settled || elapsed > lastActivationTime + 9) showResult();
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
  pHearts.update(dt);
  pSparks.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// 💗 ふうせんの ハートの あわ
let heartTrailAcc = 0;
function burstHeartTrail(b) {
  heartTrailAcc++;
  if (heartTrailAcc % 5 !== 0) return;
  const p = b.body.position;
  pHearts.spawn(
    p.x + (Math.random() - 0.5) * 0.4, p.y - 0.2, p.z + (Math.random() - 0.5) * 0.4,
    (Math.random() - 0.5) * 0.4, -0.5 - Math.random() * 0.5, (Math.random() - 0.5) * 0.4,
    0.7, 1, 0.7, 0.82, -1.5);
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
  get aliveCount() { return blocks.filter((b) => b.alive).length; },
};
