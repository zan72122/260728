/* ============================================================
   にじいろつみきタワー — main.js
   こわし装置：
   💣 ばくだん …… ドカーン！と まわりを ふきとばす
   💨 せんぷうき … ビュオーッと よこから おしたおす
   🔨 ハンマー …… ゴツン！と ねらった こを たたきとばす
   ============================================================ */

import * as THREE from '../lib/three.module.min.js';
import * as CANNON from '../lib/cannon-es.js';
import { buildTowerSpec, PHYS, U, BOMB } from './towers.js';
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

// 💣 ばくはつの ひかり（つかいまわし）
const boomLight = new THREE.PointLight(0xffb066, 0, 16, 1.6);
scene.add(boomLight);

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

// ---- 🔨 の まと（赤白の同心円ターゲット） ----
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
const pSparks = new ParticlePool(texSpark, 180, THREE.AdditiveBlending, 0.26);
const pFire = new ParticlePool(texSpark, 90, THREE.AdditiveBlending, 0.62);
const pSmoke = new ParticlePool(texSmoke, 70, THREE.NormalBlending, 1.15);
const pDebris = new ParticlePool(texChip, 90, THREE.NormalBlending, 0.2);

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

// 💣 ばくはつの みため（火球・火花・けむり・破片・衝撃波・閃光）
function explosionFX(p, blockColor) {
  // 火球（オレンジ〜黄色）
  for (let i = 0; i < 24; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    const sp = 1.5 + Math.random() * 4.2;
    const heat = Math.random();
    pFire.spawn(p.x, p.y, p.z,
      Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.9 + 0.8, Math.sin(ph) * Math.sin(th) * sp,
      0.3 + Math.random() * 0.35,
      1, 0.45 + heat * 0.45, 0.12 + heat * 0.25, -1.2);
  }
  // 火花
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 4;
    pSparks.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 1.5 + Math.random() * 3.5, Math.sin(a) * sp,
      0.35 + Math.random() * 0.3, 1, 0.95, 0.7, 5);
  }
  // けむり（ゆっくり のぼって うすくなる）
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.1;
    const g = 0.55 + Math.random() * 0.2;
    pSmoke.spawn(p.x, p.y + 0.2, p.z,
      Math.cos(a) * sp, 0.7 + Math.random() * 0.9, Math.sin(a) * sp,
      1.2 + Math.random() * 0.8, g, g, g, -0.5);
  }
  // つみきの 破片
  const c = blockColor || new THREE.Color(0xff9ec6);
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
    pDebris.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 2 + Math.random() * 3.5, Math.sin(a) * sp,
      0.7 + Math.random() * 0.5, c.r, c.g, c.b, 8);
  }
  // 衝撃波リング
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
      ring.scale.setScalar(0.4 + k * 4.4);
      ring.material.opacity = 0.9 * (1 - k);
      return true;
    },
  });
  // 閃光
  boomLight.position.set(p.x, p.y + 0.3, p.z);
  boomLight.intensity = 70;
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

/* ===================== そうちの 3D モデル ===================== */
// 💣 ばくだん：黒い玉 + どうかせん + 火花
function buildBombModel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3b3b47, emissive: 0x000000 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat);
  body.castShadow = true;
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
  return { group: g, mat, spark };
}

// 💨 せんぷうき：わっか + 3まいばね + もちて（+Z へ 風を おくる）
function buildFanModel() {
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
  return { group: g, blades };
}

// 🔨 ハンマー：えのついた 大きな かなづち（-Z の さきに ぶつかる）
function buildHammerModel() {
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
  return { group: g, arm };
}

/* ===================== ゲームの じょうたい ===================== */
const ST = { TITLE: 0, BUILD: 1, PLACE: 2, COLLAPSE: 3, RESULT: 4 };
let state = ST.TITLE;

let stage = parseInt(localStorage.getItem('nijiiro.stage') || '1', 10) || 1;
let seed = (Math.random() * 1e9) | 0;
let spec = null;

let blocks = [];            // { mesh, body, spec, y0, alive, device, ... }
let devices = [];           // 置いた順 { type, block, ... }
let effects = [];           // 一時エフェクト { update(dt) => bool }
let selectedType = 'bomb';
let popCombo = 0, popComboTime = 0;

let switchTime = -1;        // ぽんスイッチを押した時刻
let wakeAllAt = -1;         // 全員おこす時刻
let lastActivationTime = -1;
let calmSince = -1;         // しずかに なりはじめた時刻
let camShake = 0;
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
    if (b.body.world) world.removeBody(b.body);
    scene.remove(b.mesh);
    b.mesh.material.dispose();
  }
  for (const dev of devices) removeDeviceVisual(dev);
  blocks = [];
  devices = [];
  effects = [];
  boomLight.intensity = 0;
  score = 0; meterLevel = 0;
  switchTime = -1; wakeAllAt = -1; lastActivationTime = -1; calmSince = -1;
  meterFill.style.height = '0%';
  meterStar.classList.remove('full');
  meterEl.classList.add('hidden');
  resultCard.classList.add('hidden');
  confettiEl.innerHTML = '';
  setFaces('normal');
}

function makeBlock(bs, index) {
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
    device: null, visScale: 0, index,
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
    const b = makeBlock(spec.blocks[i], i);
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
      updateDeviceUI();
      scheduleHand();
    }
  }, 400 + blocks.length * stepMs);

  updateDeviceUI();
  paletteEl.classList.remove('hidden');
  ponBtn.classList.remove('hidden');
}

/* ===================== そうち ロジック ===================== */
function devicesLeft() { return spec.stickers - devices.length; }

function updateDeviceUI() {
  // のこり ドット
  stickerDotsEl.innerHTML = '';
  if (spec) {
    for (let i = 0; i < spec.stickers; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i < devices.length ? ' used' : '');
      d.textContent = i < devices.length ? DEVICE_EMOJI[devices[i].type] : '';
      stickerDotsEl.appendChild(d);
    }
  }
  // ぽんスイッチ
  const ready = devices.length > 0 && state === ST.PLACE;
  ponBtn.classList.toggle('disabled', !ready);
  ponBtn.classList.toggle('ready', ready);
  // パレット選択
  document.querySelectorAll('.stickerBtn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.type === selectedType);
  });
}

function removeDeviceVisual(dev) {
  if (dev.obj && dev.obj.parent) dev.obj.parent.remove(dev.obj);
}

function placeDevice(block, hitPoint, hitNormal) {
  // すでに ついていれば はずす（やりなおし）
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
    wiggleMesh(block);
    return;
  }

  // ワールド → ブロックローカルへ
  const localP = block.mesh.worldToLocal(hitPoint.clone());
  const invQ = block.mesh.quaternion.clone().invert();
  const localN = hitNormal.clone().applyQuaternion(invQ).normalize();

  const dev = { type: selectedType, block, born: elapsed, fired: false, state: 'idle' };

  if (selectedType === 'bomb') {
    // つみきの めん に くっつける（うえむきに たつ）
    const m = buildBombModel();
    m.group.position.copy(localP).addScaledVector(localN, 0.06);
    m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localN);
    block.mesh.add(m.group);
    dev.obj = m.group; dev.bombMat = m.mat; dev.spark = m.spark;
  } else if (selectedType === 'fan') {
    // つみきの すこし そとに うかせて、タワーへ むける
    const m = buildFanModel();
    const worldPos = hitPoint.clone().addScaledVector(hitNormal, 0.85);
    const dir = hitNormal.clone().negate().normalize();  // 風は タワーの ほうへ
    m.group.position.copy(worldPos);
    m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    scene.add(m.group);
    dev.obj = m.group; dev.blades = m.blades;
    dev.origin = worldPos; dev.dir = dir; dev.baseY = worldPos.y;
    dev.phase = Math.random() * Math.PI * 2;
  } else {
    // 🔨 まとマークを はる
    const size = Math.min(...(block.spec.kind === 'box' ? block.spec.s : [block.spec.s[0] * 2]));
    const plane = new THREE.Mesh(targetGeo, new THREE.MeshBasicMaterial({
      map: targetTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    const ss = size * 0.85;
    plane.scale.set(ss, ss, 1);
    plane.position.copy(localP).addScaledVector(localN, 0.018);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localN);
    block.mesh.add(plane);
    dev.obj = plane; dev.baseScale = ss;
    dev.worldPoint = hitPoint.clone(); dev.worldNormal = hitNormal.clone();
  }

  block.device = dev;
  devices.push(dev);
  SFX.sfxPlace();
  updateDeviceUI();
  scheduleHand();
}

function wiggleMesh(block) {
  block.wiggleUntil = elapsed + 0.45;
}

/* ===================== はつどう ===================== */
const DEV_DURATION = { bomb: 1.1, fan: 3.1, hammer: 0.55 };

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

  // どきどき… の あと ぜんいん おきる → 順番に はつどう
  wakeAllAt = elapsed + 0.62;
  let lastEnd = 0;
  devices.forEach((dev, i) => {
    dev.fireAt = elapsed + 0.78 + i * 1.15;
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
  } else {
    dev.state = 'swinging';
    SFX.sfxWhoosh();
    swingHammer(dev);
  }
}

// 💣 ばくはつ！
function explode(dev) {
  const block = dev.block;
  const p = block.body.position;
  const center = new THREE.Vector3(p.x, p.y, p.z);
  const color = block.alive ? block.mesh.material.color.clone() : null;

  SFX.sfxBomb();
  explosionFX(center, color);
  camShake = 0.34;

  // まわりを ふきとばす（きょり で よわまる）。
  // 爆心の すぐそば は 粉々になって きえる（穴が あく）
  const cv = new CANNON.Vec3(center.x, center.y, center.z);
  for (const b of blocks) {
    if (!b.alive || b === block) continue;
    const d = b.body.position.distanceTo(cv);
    if (d > BOMB.radius) continue;
    if (d < BOMB.breakRadius) {
      shatterBlock(b);
      continue;
    }
    b.body.wakeUp();
    const falloff = 1 - d / BOMB.radius;
    const dir = b.body.position.vsub(cv);
    if (dir.length() < 0.01) dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
    dir.normalize();
    dir.y += BOMB.upward;
    b.body.applyImpulse(dir.scale(b.body.mass * BOMB.power * falloff));
  }
  // じぶんは こなごな
  if (block.alive) removeBlock(block);
  dev.state = 'done';
}

// 🔨 ふりおろす
function swingHammer(dev) {
  removeDeviceVisual(dev);   // まとマークを はずす
  const m = buildHammerModel();
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
        m.arm.rotation.x = 1.95 * (1 - k * k);   // 加速しながら ふりぬく
        if (k >= 1) {
          this.hit = true; this.t = 0;
          hammerImpact(dev);
        }
      } else {
        // よいん：すこし はねかえって きえる
        m.arm.rotation.x = Math.sin(this.t * 18) * 0.12 * Math.exp(-this.t * 6);
        const s = Math.max(0.001, 1 - this.t * 2.2);
        if (this.t > 0.45) {
          m.group.scale.setScalar(Math.max(0.001, 1 - (this.t - 0.45) * 5));
        }
        if (this.t > 0.65) { scene.remove(m.group); return false; }
      }
      return true;
    },
  });
}

function hammerImpact(dev) {
  const block = dev.block;
  SFX.sfxHit();
  camShake = 0.16;
  burstStar(dev.worldPoint, 12);
  if (!block.alive) return;
  const n = dev.worldNormal;
  block.body.wakeUp();
  // まと の おくへ たたきとばす
  block.body.velocity.set(
    -n.x * 7 + (Math.random() - 0.5), 1.6, -n.z * 7 + (Math.random() - 0.5));
  block.body.angularVelocity.set(
    (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  // まわりも おこす
  const p = block.body.position;
  for (const b of blocks) {
    if (!b.alive) continue;
    if (b.body.position.distanceTo(p) < U * 2.4) b.body.wakeUp();
  }
  dev.state = 'done';
}

// 💨 かぜの ちから（まいフレーム）
const tmpV = new THREE.Vector3();
function applyWind(dev, dt) {
  const range = U * 5.2;
  for (const b of blocks) {
    if (!b.alive) continue;
    tmpV.set(b.body.position.x, b.body.position.y, b.body.position.z).sub(dev.origin);
    const t = tmpV.dot(dev.dir);
    if (t < -0.2 || t > range) continue;
    const lateral = Math.sqrt(Math.max(0, tmpV.lengthSq() - t * t));
    const radius = 0.85 + t * 0.5;
    if (lateral > radius) continue;
    b.body.wakeUp();
    // すでに じゅうぶん はやければ おさない
    const vAlong = b.body.velocity.x * dev.dir.x + b.body.velocity.y * dev.dir.y +
                   b.body.velocity.z * dev.dir.z;
    if (vAlong > 4.2) continue;
    const falloff = (1 - t / range) * (1 - (lateral / radius) * 0.5);
    const k = b.body.mass * 15 * falloff * dt;
    b.body.applyImpulse(new CANNON.Vec3(
      dev.dir.x * k, dev.dir.y * k + k * 0.12, dev.dir.z * k));
  }
  // 風の ながれ の みため
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

// そうちの まいフレーム こうしん（アイドル演出 + 発動中の処理）
function updateDevices(dt) {
  for (const dev of devices) {
    if (dev.type === 'bomb') {
      if (dev.state === 'idle' && dev.spark) {
        dev.spark.scale.setScalar(0.12 + Math.sin(elapsed * 6 + dev.born) * 0.035);
      } else if (dev.state === 'fusing') {
        // ちりちり… あかく てんめつ
        const k = 1 - Math.max(0, dev.boomAt - elapsed) / 0.95;
        dev.bombMat.emissive.setRGB(0.7 * (0.4 + 0.6 * Math.abs(Math.sin(elapsed * 22))) * k, 0.05, 0.02);
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
          // おつかれさま：しゅっと ちいさくなって きえる
          dev.state = 'done';
          const obj = dev.obj;
          effects.push({
            t: 0,
            update(dt2) {
              this.t += dt2;
              const s = Math.max(0.001, 1 - this.t * 2.5);
              obj.scale.setScalar(s);
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

function removeBlock(block) {
  block.alive = false;
  world.removeBody(block.body);
  scene.remove(block.mesh);
}

// つみきが 破片になって きえる（ばくはつの まきぞえ）
function shatterBlock(block) {
  const p = block.body.position;
  const c = block.mesh.material.color;
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
    pDebris.spawn(p.x, p.y, p.z,
      Math.cos(a) * sp, 1.5 + Math.random() * 3, Math.sin(a) * sp,
      0.6 + Math.random() * 0.5, c.r, c.g, c.b, 8);
  }
  removeBlock(block);
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
    if (devices.length === 0) {
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
  }, devices.length === 0 ? 2600 : 3600);
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
    placeDevice(hit.block, hit.point, hit.normal);
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
    updateDeviceUI();
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

    // ぜんいん おこす → そうちの はつどう スケジュール
    if (state === ST.COLLAPSE) {
      if (wakeAllAt >= 0 && elapsed >= wakeAllAt) {
        for (const b of blocks) if (b.alive) b.body.wakeUp();
        wakeAllAt = -1;
      }
      for (const dev of devices) {
        if (!dev.fired && dev.fireAt !== undefined && elapsed >= dev.fireAt) {
          dev.fired = true;
          fireDevice(dev);
        }
      }
    }

    updateDevices(dt);

    // 一時エフェクト（ハンマー・衝撃波・閃光）
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) effects.splice(i, 1);
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
      // そうちなし タップの ぷるぷる
      if (b.wiggleUntil && elapsed < b.wiggleUntil) {
        const s = 1 + Math.sin((b.wiggleUntil - elapsed) * 30) * 0.06;
        b.mesh.scale.setScalar(s);
      } else if (b.visScale >= 1) {
        b.mesh.scale.setScalar(1);
      }
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
  get aliveCount() { return blocks.filter((b) => b.alive).length; },
};
