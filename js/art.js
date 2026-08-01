// 絵の部品ぜんぶ。canvas 2D で手描き。
import {
  TAU, PI, clamp, lerp, smoothstep, hash1, roundRect, capsule, ik2, alpha, shade,
} from './util.js';
import { star4, heartPath } from './particles.js';

export const C = {
  skyTop: '#7FC6EC',
  skyMid: '#AEE0F2',
  skyLow: '#E4F5F3',
  sun: '#FFF0AE',
  cloud: '#FFFFFF',
  hillFar: '#9ED3B0',
  hillMid: '#7FC49A',
  hillNear: '#63B183',
  grass: '#6FBE7F',
  grassDark: '#4F9E66',
  grassLight: '#8FD48C',
  path: '#EBD3A3',
  pathEdge: '#D8B981',
  frame: '#F2657A',
  frameDark: '#C2405A',
  frameLight: '#FF9AA8',
  grip: '#FFD36E',
  seat: '#8A5E44',
  basket: '#DBA45E',
  rubber: '#4A4550',
  rubberLight: '#6A6472',
  rim: '#F2EDE4',
  rimEdge: '#CFC6BA',
  hub: '#FFC65C',
  fur: '#FFF8F0',
  furShade: '#EFE1D6',
  furLine: '#C7A992',
  pink: '#FFB0C0',
  dark: '#3E3138',
  pumpBody: '#3FA9A0',
  pumpDark: '#2A7C77',
  metal: '#C8D2DC',
  metalDark: '#8C9AA8',
  wood: '#D9A45B',
  woodDark: '#B37F3D',
};

export const PATCHES = [
  { type: 'heart', color: '#FF8FA3' },
  { type: 'star', color: '#8ED2F5' },
  { type: 'flower', color: '#FFD36E' },
];

/* ------------------------------------------------------------------ 背景 */

export function drawSky(ctx, L) {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, C.skyTop);
  g.addColorStop(0.55, C.skyMid);
  g.addColorStop(1, C.skyLow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);
}

export function drawSun(ctx, L, t) {
  const x = L.w * 0.83;
  const y = L.h * 0.13;
  const r = Math.min(L.w, L.h) * 0.075;
  const pulse = 1 + Math.sin(t * 0.9) * 0.035;
  const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 4.2);
  g.addColorStop(0, 'rgba(255,246,196,0.85)');
  g.addColorStop(0.35, 'rgba(255,240,174,0.28)');
  g.addColorStop(1, 'rgba(255,240,174,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 4.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = C.sun;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.28, r * 0.45, 0, TAU);
  ctx.fill();
}

function cloudShape(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, s * 0.52, 0, TAU);
  ctx.arc(x + s * 0.55, y - s * 0.2, s * 0.42, 0, TAU);
  ctx.arc(x + s * 1.05, y + s * 0.06, s * 0.36, 0, TAU);
  ctx.arc(x + s * 0.5, y + s * 0.3, s * 0.4, 0, TAU);
  ctx.arc(x - s * 0.42, y + s * 0.2, s * 0.33, 0, TAU);
  ctx.fill();
}

export function drawClouds(ctx, L, t, camX, zoom) {
  const base = Math.min(L.w, L.h);
  for (let i = 0; i < 5; i++) {
    const seed = hash1(i * 3.7);
    const s = base * (0.09 + seed * 0.07) * lerp(1, zoom, 0.35);
    const speed = 6 + seed * 8;
    const span = L.w + s * 4;
    let x = ((hash1(i * 9.1) * span + t * speed - camX * zoom * 0.06) % span + span) % span - s * 2;
    const y = L.h * (0.06 + hash1(i * 5.3) * 0.24) + Math.sin(t * 0.5 + i) * 4;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    cloudShape(ctx, x + s * 0.08, y + s * 0.1, s);
    ctx.fillStyle = C.cloud;
    cloudShape(ctx, x, y, s);
  }
}

/** 空の小鳥（遠景の生き物。ただの飾り） */
export function drawBirds(ctx, L, t, camX, zoom) {
  const s = Math.min(L.w, L.h) * 0.016 * lerp(1, zoom, 0.4);
  for (let i = 0; i < 3; i++) {
    const seed = hash1(i * 12.3);
    const span = L.w + 260;
    const x = ((seed * span + t * (16 + seed * 10) - camX * zoom * 0.04) % span + span) % span - 130;
    const y = L.h * (0.1 + seed * 0.16) + Math.sin(t * 0.8 + i * 2) * 10;
    const flap = Math.sin(t * 4.4 + i * 1.7) * 0.5 + 0.5;
    ctx.save();
    ctx.translate(x + i * 26, y + i * 14);
    ctx.strokeStyle = 'rgba(90,120,140,0.45)';
    ctx.lineWidth = Math.max(1.6, s * 0.3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, -flap * s * 0.5);
    ctx.quadraticCurveTo(-s * 0.4, flap * s * 0.35, 0, 0);
    ctx.quadraticCurveTo(s * 0.4, flap * s * 0.35, s, -flap * s * 0.5);
    ctx.stroke();
    ctx.restore();
  }
}

function hillLayer(ctx, L, groundY, zoom, offX, color, amp, wave, base) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10, L.h + 10);
  for (let x = -10; x <= L.w + 10; x += 10) {
    const u = (x + offX) / wave;
    const y = groundY - base * zoom - amp * zoom * (Math.sin(u) * 0.6 + Math.sin(u * 0.43 + 1.7) * 0.4 + 0.6);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(L.w + 10, L.h + 10);
  ctx.closePath();
  ctx.fill();
}

export function drawHills(ctx, L, groundY, camX, zoom) {
  hillLayer(ctx, L, groundY, zoom, -camX * zoom * 0.12, C.hillFar, 46, 260 * zoom, 20);
  // 遠景の丸い木
  const step = 150 * zoom;
  const off = -camX * zoom * 0.2;
  for (let i = -2; i * step + (off % step) < L.w + step; i++) {
    const x = i * step + (off % step) + (hash1(i) * 60 - 30) * zoom;
    if (x < -80 || x > L.w + 80) continue;
    const s = (16 + hash1(i * 2.3) * 12) * zoom;
    const y = groundY - (14 + hash1(i * 4.1) * 16) * zoom;
    ctx.fillStyle = '#79BD92';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.8, s, 0, TAU);
    ctx.arc(x - s * 0.7, y - s * 0.2, s * 0.7, 0, TAU);
    ctx.arc(x + s * 0.7, y - s * 0.25, s * 0.68, 0, TAU);
    ctx.fill();
  }
  hillLayer(ctx, L, groundY, zoom, -camX * zoom * 0.3, C.hillMid, 34, 190 * zoom, 4);
}

/** カメラ変換の内側で描く地面（ワールド座標） */
export function drawGroundWorld(ctx, x0, x1, yBottom) {
  const g = ctx.createLinearGradient(0, 0, 0, Math.max(120, yBottom));
  g.addColorStop(0, C.grassLight);
  g.addColorStop(0.16, C.grass);
  g.addColorStop(1, C.grassDark);
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, yBottom + 40);

  // 走る道（土のライン）
  ctx.fillStyle = C.path;
  ctx.fillRect(x0, -3, x1 - x0, 22);
  ctx.fillStyle = C.pathEdge;
  ctx.fillRect(x0, -5, x1 - x0, 3);
  ctx.fillRect(x0, 17, x1 - x0, 3);

  // 小石
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const st = 46;
  for (let x = Math.floor(x0 / st) * st; x < x1; x += st) {
    const h = hash1(x * 0.13);
    ctx.beginPath();
    ctx.ellipse(x + h * 30, 2 + h * 13, 3 + h * 3, 2 + h * 1.6, 0, 0, TAU);
    ctx.fill();
  }

  // 草・花
  const gs = 34;
  for (let x = Math.floor(x0 / gs) * gs; x < x1; x += gs) {
    const h = hash1(x * 0.21);
    const h2 = hash1(x * 0.077);
    const gx = x + h * 24;
    const gy = 26 + h2 * 46;
    ctx.strokeStyle = h2 > 0.5 ? '#5FAF72' : '#83CC8C';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(gx + k * 4, gy);
      ctx.quadraticCurveTo(gx + k * 8, gy - 9, gx + k * 12, gy - 15 - Math.abs(k) * -3);
      ctx.stroke();
    }
    if (h > 0.72) {
      const col = ['#FF9EB5', '#FFE28A', '#C9A8F0', '#FFFFFF'][Math.floor(h * 40) % 4];
      drawFlower(ctx, gx + 14, gy - 20, 6 + h * 3, col);
    }
  }
}

export function drawFlower(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62, s * 0.5, s * 0.42, a, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#FFD75E';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.34, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 近景の木（ワールド座標、試運転の景色） */
export function drawTree(ctx, x, scale, t, seed) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(scale, scale);
  const sway = Math.sin(t * 0.9 + seed * 3) * 0.03;
  ctx.fillStyle = 'rgba(60,90,60,0.16)';
  ctx.beginPath();
  ctx.ellipse(4, 2, 46, 11, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#9A6B4A';
  roundRect(ctx, -9, -96, 18, 98, 7);
  ctx.fill();
  ctx.save();
  ctx.translate(0, -96);
  ctx.rotate(sway);
  const g = ctx.createRadialGradient(-18, -40, 8, 0, -28, 78);
  g.addColorStop(0, '#8FD48C');
  g.addColorStop(1, '#4E9E63');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -34, 50, 0, TAU);
  ctx.arc(-38, -8, 34, 0, TAU);
  ctx.arc(38, -12, 32, 0, TAU);
  ctx.arc(0, 6, 30, 0, TAU);
  ctx.fill();
  if (seed % 2 === 0) {
    ctx.fillStyle = '#FF8FA3';
    for (let i = 0; i < 5; i++) {
      const a = hash1(seed * 7 + i) * TAU;
      const r = 20 + hash1(seed * 3 + i) * 30;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, -24 + Math.sin(a) * r * 0.7, 5, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();
}

/* ------------------------------------------------------- タイヤ（主役） */

/**
 * ワールド角 a におけるタイヤ半径。
 * ・空気が少ない → 接地側がつぶれ（ワールド固定）、内部がいびつ（回転に追従）
 * ・へこみ / パッチはタイヤ表面の性質なので回転に追従する
 */
export function wheelRadiusAt(w, a) {
  const local = a - w.rot;
  let k = 1;
  const soft = 1 - w.inflation;

  // ゴムのいびつさ（回る）＝ ガタゴトの正体
  k += soft * 0.075 * Math.sin(local * 3 + 0.7);
  k += soft * 0.05 * Math.sin(local * 2 - 1.3);

  // 指で押したへこみ（空気を入れると消える）
  for (const d of w.dents) {
    let dd = local - d.a;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    k -= d.depth * soft * Math.exp(-(dd * dd) / (2 * 0.22 * 0.22));
  }

  // 接地面のつぶれ（地面に対して常に下側）と、その分の横のふくらみ
  const c = Math.max(0, Math.cos(a - PI / 2));
  k -= soft * 0.26 * c * c * c;
  k += soft * 0.05 * Math.abs(Math.cos(a));

  // パッチのわずかな厚み
  if (w.patch) {
    let pd = local - w.patch.a;
    pd = Math.atan2(Math.sin(pd), Math.cos(pd));
    k += 0.008 * w.patch.grip * Math.exp(-(pd * pd) / (2 * 0.22 * 0.22));
  }
  // ゴムはリムより内側には入らない
  return w.r * Math.max(0.72, k);
}

function tirePath(ctx, w, scaleR, N = 84) {
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const r = wheelRadiusAt(w, a) * scaleR;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 車輪一式。(x,y) は車軸のワールド座標 */
export function drawWheel(ctx, w, x, y) {
  ctx.save();
  ctx.translate(x, y);

  // タイヤ本体（外形は変形、内側リムは剛体）
  const inner = w.r * 0.63;
  ctx.save();
  tirePath(ctx, w, 1);
  ctx.beginPath();
  tirePath(ctx, w, 1);
  ctx.moveTo(inner, 0);
  ctx.arc(0, 0, inner, 0, TAU, true);
  const g = ctx.createLinearGradient(-w.r, -w.r, w.r * 0.6, w.r);
  g.addColorStop(0, C.rubberLight);
  g.addColorStop(0.45, C.rubber);
  g.addColorStop(1, '#332F3A');
  ctx.fillStyle = g;
  ctx.fill('evenodd');
  ctx.restore();

  // トレッド（回転が見えるように）
  ctx.save();
  ctx.rotate(w.rot);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(2, w.r * 0.05);
  ctx.lineCap = 'round';
  const tn = 20;
  for (let i = 0; i < tn; i++) {
    const a = (i / tn) * TAU;
    const rr = wheelRadiusAt(w, a + w.rot);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * rr * 0.86, Math.sin(a) * rr * 0.86);
    ctx.lineTo(Math.cos(a) * rr * 0.97, Math.sin(a) * rr * 0.97);
    ctx.stroke();
  }
  ctx.restore();

  // リム
  const rg = ctx.createRadialGradient(-inner * 0.3, -inner * 0.4, inner * 0.1, 0, 0, inner);
  rg.addColorStop(0, '#FFFFFF');
  rg.addColorStop(1, C.rimEdge);
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, TAU);
  ctx.fill();

  // スポーク
  ctx.save();
  ctx.rotate(w.rot);
  ctx.strokeStyle = '#B9AFA2';
  ctx.lineWidth = Math.max(2.5, w.r * 0.045);
  ctx.lineCap = 'round';
  const sn = 8;
  for (let i = 0; i < sn; i++) {
    const a = (i / sn) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner * 0.2, Math.sin(a) * inner * 0.2);
    ctx.lineTo(Math.cos(a) * inner * 0.92, Math.sin(a) * inner * 0.92);
    ctx.stroke();
  }
  // 空気を入れるバルブ
  ctx.save();
  ctx.rotate(w.valveA);
  ctx.fillStyle = C.metalDark;
  roundRect(ctx, w.r * 0.6, -w.r * 0.05, w.r * 0.2, w.r * 0.1, w.r * 0.04);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // ハブ
  ctx.fillStyle = C.hub;
  ctx.beginPath();
  ctx.arc(0, 0, w.r * 0.17, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(-w.r * 0.05, -w.r * 0.05, w.r * 0.07, 0, TAU);
  ctx.fill();

  // 穴 / パッチ（タイヤ表面に貼り付く）
  const holeA = w.hole.a + w.rot;
  const hr = wheelRadiusAt(w, holeA) * 0.9;
  const hx = Math.cos(holeA) * hr;
  const hy = Math.sin(holeA) * hr;
  if (w.hole.reveal > 0 && !w.patch) {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(holeA + PI / 2);
    const s = w.r * 0.16 * w.hole.reveal;
    ctx.fillStyle = '#1D1A22';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  if (w.patch) {
    const pa = w.patch.a + w.rot;
    const pr = wheelRadiusAt(w, pa) * 0.92;
    ctx.save();
    ctx.translate(Math.cos(pa) * pr, Math.sin(pa) * pr);
    ctx.rotate(pa + PI / 2);
    drawPatchShape(ctx, w.patch.type, w.r * 0.42 * w.patch.scale, w.patch.color, true);
    ctx.restore();
  }
  ctx.restore();
  return { holeX: x + hx, holeY: y + hy };
}

/** 穴の位置を（描画せずに）求める */
export function holeWorldPos(w, x, y) {
  const a = w.hole.a + w.rot;
  const r = wheelRadiusAt(w, a) * 0.9;
  return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
}
export function valveWorldPos(w, x, y) {
  const a = w.valveA + w.rot;
  const r = w.r * 0.72;
  return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
}

/* ------------------------------------------------------------- パッチ */

export function drawPatchShape(ctx, type, s, color, onTire = false) {
  ctx.save();
  if (!onTire) {
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = s * 0.4;
    ctx.shadowOffsetY = s * 0.14;
  }
  ctx.fillStyle = color;
  if (type === 'heart') { heartPath(ctx, s); ctx.fill(); }
  else if (type === 'star') { star5(ctx, s); ctx.fill(); }
  else {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.44, s * 0.36, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = shade(color, -0.16);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.44, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFF6DE';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ハイライトとステッチで「ぺたっとしたシール」感
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(-s * 0.22, -s * 0.3, s * 0.3, s * 0.18, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = alpha(shade(color, -0.22), 0.9);
  ctx.lineWidth = Math.max(1.4, s * 0.07);
  ctx.setLineDash([s * 0.16, s * 0.16]);
  if (type === 'heart') heartPath(ctx, s * 0.76);
  else if (type === 'star') star5(ctx, s * 0.72);
  else { ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function star5(ctx, s) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - PI / 2;
    const r = i % 2 === 0 ? s : s * 0.46;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* --------------------------------------------------------------- 三輪車 */

// サドルの高さと前輪の大きさは、乗り手の脚の長さから逆算している。
// 「腰→ペダル最遠点 ≒ 脚の長さ」になるので、こいでいる間ずっと膝が自然に曲がる。
export const TRIKE = {
  frontHub: [92, -48],
  frontR: 48,
  rearHub: [-64, -26],
  rearR: 26,
  seat: [44, -100],
  head: [96, -108],
  bar: [100, -146],
  wheelbase: 156,
  crank: 15,
};

/** 奥側：後輪（奥）・車軸・フレーム・サドル */
export function drawTrikeBack(ctx, wheelRot) {
  const [hx, hy] = TRIKE.head;
  const [sx, sy] = TRIKE.seat;
  const [rx, ry] = TRIKE.rearHub;
  const [bx, by] = TRIKE.bar;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawSmallWheel(ctx, rx - 12, ry + 3, TRIKE.rearR * 0.9, wheelRot, true);
  capsule(ctx, rx - 12, ry + 3, rx + 6, ry, 8, C.frameDark);

  // フレーム（濃い縁取り＋本体色で厚みを出す）
  capsule(ctx, sx, sy, rx, ry, 12, C.frameDark);
  capsule(ctx, sx, sy, rx, ry, 8, C.frame);
  capsule(ctx, hx, hy, sx + 3, sy + 5, 12, C.frameDark);
  capsule(ctx, hx, hy, sx + 3, sy + 5, 8, C.frame);
  capsule(ctx, hx, hy, TRIKE.frontHub[0], TRIKE.frontHub[1], 12, C.frameDark);
  capsule(ctx, hx, hy, TRIKE.frontHub[0], TRIKE.frontHub[1], 8, C.frameLight);
  capsule(ctx, hx, hy, bx, by, 11, C.frameDark);
  capsule(ctx, hx, hy, bx, by, 7, C.frame);

  // サドル
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.08);
  ctx.fillStyle = '#5E3D2C';
  roundRect(ctx, -25, -11, 52, 17, 8);
  ctx.fill();
  ctx.fillStyle = C.seat;
  roundRect(ctx, -25, -14, 52, 15, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, -18, -11, 32, 5, 2.5);
  ctx.fill();
  ctx.restore();
}

/** 手前の後輪（うさぎより奥、フレームより手前） */
export function drawTrikeMid(ctx, wheelRot) {
  const [rx, ry] = TRIKE.rearHub;
  drawSmallWheel(ctx, rx + 7, ry, TRIKE.rearR, wheelRot);
}

/** 手前側：ハンドル・ベル・吹き流し・かご */
export function drawTrikeFront(ctx, t) {
  const [bx, by] = TRIKE.bar;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(bx, by);
  capsule(ctx, -28, 3, 25, -3, 10, C.metalDark);
  capsule(ctx, -28, 3, 25, -3, 6, C.metal);
  ctx.fillStyle = C.grip;
  roundRect(ctx, -38, -3, 17, 11, 5);
  ctx.fill();
  roundRect(ctx, 22, -8, 17, 11, 5);
  ctx.fill();
  // ベル
  ctx.fillStyle = '#FF6B6B';
  ctx.beginPath();
  ctx.arc(4, -5, 8.5, PI, TAU);
  ctx.fill();
  ctx.fillStyle = '#D14B4B';
  roundRect(ctx, -4.5, -5, 17, 4.5, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(1, -8, 2.6, 0, TAU);
  ctx.fill();
  // 吹き流し
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = ['#8ED2F5', '#FFD36E', '#FF8FA3'][i];
    ctx.beginPath();
    ctx.moveTo(35, -5 + i * 3);
    const w = Math.sin(t * 5 + i) * 4;
    ctx.quadraticCurveTo(47, -1 + i * 3 + w, 59, 4 + i * 4 + w * 1.6);
    ctx.stroke();
  }
  ctx.restore();

  // かご + にんじん（ハンドルから吊るす）
  capsule(ctx, bx + 26, by - 2, 140, -124, 5, C.metalDark);
  ctx.save();
  ctx.translate(144, -108);
  ctx.fillStyle = C.wood;
  ctx.beginPath();
  ctx.moveTo(-21, -14);
  ctx.lineTo(21, -14);
  ctx.lineTo(16, 16);
  ctx.lineTo(-16, 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.woodDark;
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 7.2, -14);
    ctx.lineTo(i * 6, 16);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-20 + i, -11 + i * 9.5);
    ctx.lineTo(20 - i, -11 + i * 9.5);
    ctx.stroke();
  }
  ctx.fillStyle = '#F79A3E';
  ctx.beginPath();
  ctx.moveTo(-2, -27);
  ctx.lineTo(9, -24);
  ctx.lineTo(1.5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5FAF62';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0.5 + i * 4, -30 - i, 3.2, 6.4, 0.3 * i - 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSmallWheel(ctx, x, y, r, t, dim = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t);
  ctx.fillStyle = dim ? '#3B3742' : C.rubber;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = dim ? '#DAD3C8' : C.rim;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#B9AFA2';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    ctx.stroke();
  }
  ctx.fillStyle = C.hub;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** クランク + ペダル。足を置く位置も返す */
export function pedalPos(rot) {
  const [hx, hy] = TRIKE.frontHub;
  const r = TRIKE.crank;
  return [
    [hx + Math.cos(rot) * r, hy + Math.sin(rot) * r],
    [hx + Math.cos(rot + PI) * r, hy + Math.sin(rot + PI) * r],
  ];
}

export function drawCranks(ctx, rot, axleY) {
  const [hx] = TRIKE.frontHub;
  const hy = axleY;
  const r = TRIKE.crank;
  for (const sgn of [1, -1]) {
    const a = rot + (sgn > 0 ? 0 : PI);
    const px = hx + Math.cos(a) * r;
    const py = hy + Math.sin(a) * r;
    capsule(ctx, hx, hy, px, py, 6, sgn > 0 ? '#9AA6B2' : '#7C8794');
    ctx.fillStyle = sgn > 0 ? '#FFD36E' : '#E0B655';
    roundRect(ctx, px - 9, py - 4.5, 18, 9, 3.5);
    ctx.fill();
  }
}

/* --------------------------------------------------------------- こぐま */
// くまは蹠行（せきこう）性――かかとを地面につけて歩く動物。
// だから「大きな太もも → 前へ曲がる膝 → 平たい足の裏」をそのまま描いてよい。
// ウサギ・ネコ・イヌのように踵が後ろへ折れないので、ペダルをこぐ姿に無理が出ない。
// 手足は棒2本ではなく、太さの変わる塊（付け根が太く先が細い）で描く。

export const BEAR = {
  fur: '#E0A765',
  furShade: '#C68A4A',
  furLight: '#F3C892',
  cream: '#F9E6C6',
  inner: '#EFA79C',
  line: 'rgba(120,74,38,0.5)',
  nose: '#4A3226',
};

/** 仲間のくま用の毛色ちがい */
export const BEAR_COATS = [
  BEAR,
  { ...BEAR, fur: '#F1D6AC', furShade: '#DAB98A', furLight: '#FDEED3', cream: '#FFF8EA' },
  { ...BEAR, fur: '#B98457', furShade: '#9C6B41', furLight: '#D6A379', cream: '#F2DCBC' },
];

const THIGH = 41;   // 太もも
const SHIN = 38;    // すね
const UPPER = 28;   // 上腕
const FORE = 26;    // 前腕
export const BEAR_HIP = [4, 20];
export const BEAR_STAND_Y = 102;  // 体の中心から地面までの距離（立ち姿）

/** 太さの変わる胴（2円の外接接線で作る） */
function taper(ctx, x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1e-4;
  const a = Math.atan2(dy, dx);
  const t = Math.acos(clamp((r1 - r2) / d, -1, 1));
  ctx.beginPath();
  ctx.arc(x1, y1, r1, a + t, a - t + TAU);
  ctx.arc(x2, y2, r2, a - t, a + t);
  ctx.closePath();
}

function limbPart(ctx, x1, y1, r1, x2, y2, r2, fill, line) {
  taper(ctx, x1, y1, r1, x2, y2, r2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
}

/** 足の裏（かかとを後ろに、つま先を前に）。原点は足首 */
function bearPaw(ctx, x, y, ang, P, fill, sole) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(-12, -7);
  ctx.quadraticCurveTo(-17, 3, -12, 12);
  ctx.quadraticCurveTo(-8, 16, 2, 16);
  ctx.lineTo(16, 16);
  ctx.quadraticCurveTo(26, 15, 25, 7);
  ctx.quadraticCurveTo(24, -1, 13, -4);
  ctx.quadraticCurveTo(2, -8, -12, -7);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  // 足の裏（肉球側）
  ctx.fillStyle = sole || P.cream;
  ctx.beginPath();
  ctx.ellipse(6, 11, 15, 4.6, 0, 0, TAU);
  ctx.fill();
  // つま先
  ctx.strokeStyle = 'rgba(120,74,38,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(12 + i * 5, 16 - i * 1.5);
    ctx.lineTo(13 + i * 5, 9 - i * 2.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** 前足（手）。原点は手首 */
function bearHand(ctx, x, y, P, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 9.5, 0, 0, TAU);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.beginPath();
  ctx.ellipse(2, 3, 6, 3.4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * 後ろあし。膝は「前・上」へ折れる（自転車をこぐ人の膝と同じ向き）。
 * ik2 の bendSign を -1 にしているのがその指定。
 */
function bearLeg(ctx, hx, hy, tx, ty, footAng, P, fill, sole) {
  const { jx, jy } = ik2(hx, hy, tx, ty, THIGH, SHIN, -1);
  bearPaw(ctx, tx, ty, footAng, P, fill, sole);
  limbPart(ctx, hx, hy, 17.5, jx, jy, 10.5, fill, P.line);   // 太もも（塊）
  limbPart(ctx, jx, jy, 10, tx, ty, 8, fill, P.line);        // すね
}

/** 前あし。ひじは下へ折れる */
function bearArm(ctx, sx, sy, tx, ty, P, fill) {
  const { jx, jy } = ik2(sx, sy, tx, ty, UPPER, FORE, 1);
  limbPart(ctx, sx, sy, 13.5, jx, jy, 9.5, fill, P.line);
  limbPart(ctx, jx, jy, 9, tx, ty, 8, fill, P.line);
  bearHand(ctx, tx, ty, P, fill);
}

function eyeHappy(ctx, x, y, s) {
  ctx.strokeStyle = C.dark;
  ctx.lineWidth = s * 0.36;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + s * 0.35, s * 0.85, PI * 1.15, PI * 1.85);
  ctx.stroke();
}

function eyeSad(ctx, x, y, s) {
  ctx.strokeStyle = C.dark;
  ctx.lineWidth = s * 0.34;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - s * 0.5, s * 0.9, PI * 0.2, PI * 0.8);
  ctx.stroke();
}

function eyeOpen(ctx, x, y, s, blink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.08, 1 - blink));
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.6, s * 0.74, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(s * 0.24, -s * 0.28, s * 0.24, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-s * 0.2, s * 0.24, s * 0.11, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * こぐま。origin は胴体の中心。右を向いている。
 * o = { mood, t, blink, hands:[x,y]|null, feet:[[x,y],[x,y]]|null,
 *       footAngle, lean, bounce, palette }
 */
export function drawBear(ctx, o) {
  const P = o.palette || BEAR;
  const mood = o.mood || 'idle';
  const t = o.t || 0;
  const breathe = Math.sin(t * 2.2) * 0.013;
  const fa = o.footAngle || 0;

  ctx.save();
  ctx.rotate(o.lean || 0);
  ctx.lineCap = 'round';

  // しっぽ（くまは小さな丸）
  ctx.fillStyle = P.furShade;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-37, 8, 11, 0, TAU);
  ctx.stroke();
  ctx.fill();

  // 奥のあし・うで
  const feet = o.feet;
  if (feet) bearLeg(ctx, BEAR_HIP[0] - 9, BEAR_HIP[1], feet[1][0], feet[1][1], fa, P, P.furShade, shade(P.cream, -0.14));
  else bearLeg(ctx, -9, BEAR_HIP[1], -15, 84, 0, P, P.furShade, shade(P.cream, -0.14));
  if (o.hands) bearArm(ctx, -12, -14, o.hands[0] - 30, o.hands[1] + 8, P, P.furShade);
  else if (mood === 'cheer') bearArm(ctx, -14, -14, -40, -56 + Math.cos(t * 8) * 6, P, P.furShade);
  else bearArm(ctx, -14, -14, -30, 20, P, P.furShade);

  // 胴
  ctx.save();
  ctx.scale(1 + breathe, 1 - breathe);
  const bg = ctx.createLinearGradient(-30, -44, 32, 44);
  bg.addColorStop(0, P.furLight);
  bg.addColorStop(0.55, P.fur);
  bg.addColorStop(1, P.furShade);
  ctx.fillStyle = bg;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 38, 42, -0.05, 0, TAU);
  ctx.stroke();
  ctx.fill();
  // おなかの模様
  ctx.fillStyle = P.cream;
  ctx.beginPath();
  ctx.ellipse(9, 9, 21, 26, -0.08, 0, TAU);
  ctx.fill();
  ctx.restore();

  // 手前のあし・うで
  if (feet) bearLeg(ctx, BEAR_HIP[0], BEAR_HIP[1], feet[0][0], feet[0][1], fa, P, P.fur);
  else bearLeg(ctx, BEAR_HIP[0], BEAR_HIP[1], 10, 86, 0, P, P.fur);
  if (o.hands) bearArm(ctx, 20, -14, o.hands[0], o.hands[1], P, P.fur);
  else if (mood === 'cheer') bearArm(ctx, 20, -14, 44, -60 + Math.sin(t * 8) * 6, P, P.fur);
  else bearArm(ctx, 20, -14, 32, 20, P, P.fur);

  /* ---- 頭 ---- */
  ctx.save();
  ctx.translate(8, -56 + Math.sin(t * 2.2 + 0.6) * 1.5 + (o.bounce || 0));

  // 耳（頭のうしろ側から）
  for (const [ex, ey, r] of [[-20, -22, 14], [15, -26, 15]]) {
    ctx.fillStyle = ex < 0 ? P.furShade : P.fur;
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, TAU);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = P.inner;
    ctx.beginPath();
    ctx.arc(ex + (ex < 0 ? -1 : 1), ey + 1, r * 0.52, 0, TAU);
    ctx.fill();
  }

  // 顔
  const hg = ctx.createRadialGradient(-8, -12, 5, 2, 2, 38);
  hg.addColorStop(0, P.furLight);
  hg.addColorStop(1, P.fur);
  ctx.fillStyle = hg;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 33, 30, 0, 0, TAU);
  ctx.stroke();
  ctx.fill();

  // マズル
  ctx.fillStyle = P.cream;
  ctx.beginPath();
  ctx.ellipse(15, 10, 19, 14, -0.06, 0, TAU);
  ctx.fill();

  // 目
  const es = 8.5;
  if (mood === 'happy' || mood === 'cheer') {
    eyeHappy(ctx, -8, -6, es);
    eyeHappy(ctx, 17, -8, es);
  } else if (mood === 'sad') {
    eyeSad(ctx, -8, -4, es);
    eyeSad(ctx, 17, -6, es);
    ctx.fillStyle = 'rgba(140,200,240,0.85)';
    ctx.beginPath();
    ctx.ellipse(21, 4 + (Math.sin(t * 2) * 0.5 + 0.5) * 6, 3.2, 4.8, 0, 0, TAU);
    ctx.fill();
  } else {
    eyeOpen(ctx, -8, -5, es, o.blink || 0);
    eyeOpen(ctx, 17, -7, es, o.blink || 0);
  }

  // ほっぺ
  ctx.fillStyle = 'rgba(240,140,120,0.32)';
  ctx.beginPath();
  ctx.ellipse(-18, 6, 8, 5.4, 0, 0, TAU);
  ctx.ellipse(28, 3, 7, 4.8, 0, 0, TAU);
  ctx.fill();

  // 鼻と口
  ctx.fillStyle = P.nose;
  ctx.beginPath();
  ctx.ellipse(19, 3, 7.5, 5.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(17, 1.4, 2.6, 1.7, -0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = P.nose;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(19, 8.6);
  ctx.lineTo(19, 12);
  if (mood === 'sad') {
    ctx.moveTo(12, 19);
    ctx.quadraticCurveTo(19, 13, 26, 19);
  } else if (mood === 'cheer') {
    ctx.moveTo(11, 13);
    ctx.quadraticCurveTo(19, 25, 27, 13);
    ctx.quadraticCurveTo(19, 16, 11, 13);
  } else {
    ctx.moveTo(12, 12);
    ctx.quadraticCurveTo(19, 19, 26, 12);
  }
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

/* ------------------------------------------------------------ 空気入れ */

/** ポンプの各部の位置（描画せずに知りたいとき） */
export function pumpGeom(x, y, h) {
  const bodyW = h * 0.26;
  return {
    bodyW,
    bodyH: h * 0.56,
    stroke: h * 0.42,
    nozzleX: x - bodyW * 0.55,
    nozzleY: y - h * 0.05,
    gaugeX: x + bodyW * 0.9,
    gaugeY: y - h * 0.56 * 0.42,
    gaugeR: bodyW * 0.55,
  };
}

/** 画面座標のポンプ。handleT: 0=上 1=下。ノズル位置を返す */
export function drawPump(ctx, x, y, h, handleT) {
  const bodyW = h * 0.26;
  const stroke = h * 0.42;
  ctx.save();
  ctx.translate(x, y); // y は接地（下端）

  // 影
  ctx.fillStyle = 'rgba(40,60,50,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyW * 1.5, bodyW * 0.3, 0, 0, TAU);
  ctx.fill();

  // 支柱（シリンダー）
  const bodyH = h * 0.56;
  const g = ctx.createLinearGradient(-bodyW / 2, 0, bodyW / 2, 0);
  g.addColorStop(0, C.pumpDark);
  g.addColorStop(0.4, C.pumpBody);
  g.addColorStop(0.75, '#63C9BF');
  g.addColorStop(1, C.pumpDark);
  ctx.fillStyle = g;
  roundRect(ctx, -bodyW / 2, -bodyH, bodyW, bodyH, bodyW * 0.3);
  ctx.fill();
  // 台座
  ctx.fillStyle = C.pumpDark;
  roundRect(ctx, -bodyW * 1.15, -h * 0.05, bodyW * 2.3, h * 0.055, h * 0.02);
  ctx.fill();

  // ピストン棒
  const py = -bodyH - stroke * (1 - handleT);
  ctx.strokeStyle = C.metal;
  ctx.lineWidth = bodyW * 0.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -bodyH + 4);
  ctx.lineTo(0, py + bodyW * 0.2);
  ctx.stroke();

  // ハンドル
  ctx.save();
  ctx.translate(0, py);
  ctx.fillStyle = '#E0556E';
  roundRect(ctx, -bodyW * 1.3, -bodyW * 0.42, bodyW * 2.6, bodyW * 0.8, bodyW * 0.4);
  ctx.fill();
  ctx.fillStyle = '#FF7C90';
  roundRect(ctx, -bodyW * 1.3, -bodyW * 0.42, bodyW * 2.6, bodyW * 0.5, bodyW * 0.28);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  roundRect(ctx, -bodyW * 1.0, -bodyW * 0.3, bodyW * 1.3, bodyW * 0.18, bodyW * 0.1);
  ctx.fill();
  ctx.restore();

  // 圧力計
  ctx.save();
  ctx.translate(bodyW * 0.9, -bodyH * 0.42);
  const gr = bodyW * 0.55;
  ctx.fillStyle = '#F5F1E8';
  ctx.beginPath();
  ctx.arc(0, 0, gr, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = C.pumpDark;
  ctx.lineWidth = gr * 0.16;
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  return { nozzleX: x - bodyW * 0.55, nozzleY: y - h * 0.05, gaugeX: x + bodyW * 0.9, gaugeY: y - h * 0.56 * 0.42, gaugeR: bodyW * 0.55 };
}

/** ポンプの圧力計の針（inflation 0..1） */
export function drawGauge(ctx, gx, gy, gr, v) {
  ctx.save();
  ctx.translate(gx, gy);
  for (let i = 0; i <= 4; i++) {
    const a = PI * 0.75 + (i / 4) * PI * 1.5;
    ctx.strokeStyle = i >= 3 ? '#E0556E' : '#9AA6B2';
    ctx.lineWidth = gr * 0.12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * gr * 0.55, Math.sin(a) * gr * 0.55);
    ctx.lineTo(Math.cos(a) * gr * 0.78, Math.sin(a) * gr * 0.78);
    ctx.stroke();
  }
  const a = PI * 0.75 + clamp(v, 0, 1) * PI * 1.5;
  ctx.strokeStyle = '#E0556E';
  ctx.lineWidth = gr * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(a) * gr * 0.62, Math.sin(a) * gr * 0.62);
  ctx.stroke();
  ctx.fillStyle = C.pumpDark;
  ctx.beginPath();
  ctx.arc(0, 0, gr * 0.15, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** ポンプ → バルブのホース。ポンプ本体の左からたるんで伸びる */
export function drawHose(ctx, x1, y1, x2, y2, pulse) {
  const span = Math.max(60, Math.abs(y1 - y2));
  const c1x = x1 - span * 0.42 - 30;
  const c1y = y1 + 14;
  const c2x = x2 - Math.abs(x2 - x1) * 0.25 - 40;
  const c2y = y2 + span * 0.45;
  ctx.strokeStyle = '#2F3B44';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
  ctx.stroke();
  ctx.strokeStyle = '#4A5A66';
  ctx.lineWidth = 7;
  ctx.stroke();
  if (pulse > 0) {
    const p = 1 - pulse;
    const q = 1 - p;
    const bx = q * q * q * x1 + 3 * q * q * p * c1x + 3 * q * p * p * c2x + p * p * p * x2;
    const by = q * q * q * y1 + 3 * q * q * p * c1y + 3 * q * p * p * c2y + p * p * p * y2;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, TAU);
    ctx.fill();
  }
}

/* --------------------------------------------------------------- UI 部品 */

/** 道具置き場（画面の下 or 右にせり出す木のカウンター） */
export function drawDock(ctx, d, portrait) {
  const pad = 60;
  const x = d.x - (portrait ? pad : 0);
  const y = d.y - (portrait ? 0 : pad);
  const w = d.w + (portrait ? pad * 2 : pad);
  const h = d.h + (portrait ? pad : pad * 2);
  const r = Math.min(portrait ? d.h : d.w, 46) * 0.7;
  ctx.save();
  ctx.shadowColor = 'rgba(30,40,30,0.28)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = portrait ? -4 : 0;
  ctx.shadowOffsetX = portrait ? 0 : -4;
  const g = portrait
    ? ctx.createLinearGradient(0, d.y, 0, d.y + d.h)
    : ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
  g.addColorStop(0, '#F6E3C4');
  g.addColorStop(0.12, '#EFD3A9');
  g.addColorStop(1, '#DDB681');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // 木目
  ctx.strokeStyle = 'rgba(180,135,80,0.28)';
  ctx.lineWidth = 2;
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const u = i / (n + 1);
    ctx.beginPath();
    if (portrait) {
      const ly = d.y + d.h * u;
      ctx.moveTo(d.x + 16, ly);
      ctx.lineTo(d.x + d.w - 16, ly);
    } else {
      const lx = d.x + d.w * u;
      ctx.moveTo(lx, d.y + 16);
      ctx.lineTo(lx, d.y + d.h - 16);
    }
    ctx.stroke();
  }
  // ふちの厚み（ここから下（右）が道具置き場、と一目で分かるように）
  ctx.lineCap = 'round';
  for (const [col, wid, o] of [['#C79055', 9, 0], ['rgba(255,255,255,0.75)', 4, 7]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = wid;
    ctx.beginPath();
    if (portrait) {
      ctx.moveTo(d.x + r * 0.5, d.y + o + 2);
      ctx.lineTo(d.x + d.w - r * 0.5, d.y + o + 2);
    } else {
      ctx.moveTo(d.x + o + 2, d.y + r * 0.5);
      ctx.lineTo(d.x + o + 2, d.y + d.h - r * 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSlot(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(150,110,60,0.22)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.setLineDash([r * 0.35, r * 0.28]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** お手本の手（ゴースト） */
export function drawHand(ctx, x, y, s, a = 1, rot = 0, press = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s * (1 - press * 0.1), s * (1 - press * 0.1));
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(70,80,95,0.75)';
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  // 手のひら
  ctx.moveTo(-16, 6);
  ctx.quadraticCurveTo(-22, 34, -6, 44);
  ctx.quadraticCurveTo(14, 54, 24, 36);
  ctx.quadraticCurveTo(30, 24, 28, 6);
  ctx.lineTo(28, -2);
  ctx.quadraticCurveTo(28, -10, 21, -10);
  ctx.quadraticCurveTo(14, -10, 14, -2);
  ctx.lineTo(14, -6);
  ctx.quadraticCurveTo(14, -14, 7, -14);
  ctx.quadraticCurveTo(0, -14, 0, -6);
  ctx.lineTo(0, -34);
  ctx.quadraticCurveTo(0, -44, -8, -44);
  ctx.quadraticCurveTo(-16, -44, -16, -34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** タップの波紋 */
export function drawRipple(ctx, x, y, t, color = 'rgba(255,255,255,0.9)') {
  const r = 12 + t * 62;
  ctx.save();
  ctx.globalAlpha = clamp(1 - t, 0, 1) * 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5 * (1 - t) + 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** 丸いアイコンボタン */
export function drawRoundButton(ctx, x, y, r, fill, iconFn, pressed = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 - pressed * 0.08, 1 - pressed * 0.08);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = r * 0.4;
  ctx.shadowOffsetY = r * 0.14;
  ctx.fillStyle = shade(fill, -0.12);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, shade(fill, 0.16));
  g.addColorStop(1, fill);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -r * 0.05, r * 0.93, 0, TAU);
  ctx.fill();
  iconFn(ctx, r);
  ctx.restore();
}

export function iconSpeaker(muted) {
  return (ctx, r) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.18);
    ctx.lineTo(-r * 0.18, -r * 0.18);
    ctx.lineTo(0.04 * r, -r * 0.46);
    ctx.lineTo(0.04 * r, r * 0.46);
    ctx.lineTo(-r * 0.18, r * 0.18);
    ctx.lineTo(-r * 0.42, r * 0.18);
    ctx.closePath();
    ctx.fill();
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(r * 0.22, -r * 0.26);
      ctx.lineTo(r * 0.56, r * 0.26);
      ctx.moveTo(r * 0.56, -r * 0.26);
      ctx.lineTo(r * 0.22, r * 0.26);
      ctx.stroke();
    } else {
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(r * 0.1, 0, r * (0.28 + i * 0.2), -0.9, 0.9);
        ctx.stroke();
      }
    }
  };
}

export function iconReplay(ctx, r) {
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.46, PI * 0.35, PI * 1.85);
  ctx.stroke();
  ctx.save();
  ctx.translate(Math.cos(PI * 0.35) * r * 0.46, Math.sin(PI * 0.35) * r * 0.46);
  ctx.rotate(PI * 0.35 + PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.24);
  ctx.lineTo(0, r * 0.24);
  ctx.lineTo(r * 0.3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function iconPlay(ctx, r) {
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(-r * 0.22, -r * 0.38);
  ctx.lineTo(r * 0.4, 0);
  ctx.lineTo(-r * 0.22, r * 0.38);
  ctx.closePath();
  ctx.fill();
}

/** ゴール地点のアーチと風船 */
export function drawGoalArch(ctx, x, t) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.strokeStyle = '#C98BD8';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-90, 0);
  ctx.quadraticCurveTo(0, -330, 90, 0);
  ctx.stroke();
  ctx.strokeStyle = '#E7B0F0';
  ctx.lineWidth = 9;
  ctx.stroke();
  const cols = ['#FF8FA3', '#FFD36E', '#8ED2F5', '#A8E6A1', '#C6A8F5'];
  for (let i = 0; i < 10; i++) {
    const u = 0.06 + (i / 9) * 0.88;
    const px = lerp(-90, 90, u);
    // アーチの二次ベジェ上にちょうど乗る位置
    const py = -660 * u * (1 - u);
    ctx.save();
    ctx.translate(px, py + Math.sin(t * 2 + i) * 4);
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 21, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -7, 5, 7, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** 小さな旗（進み具合の目印） */
export function drawFlag(ctx, x, t) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.strokeStyle = '#9A6B4A';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -70);
  ctx.stroke();
  ctx.fillStyle = '#FF8FA3';
  ctx.beginPath();
  ctx.moveTo(2, -70);
  ctx.quadraticCurveTo(30, -60 + Math.sin(t * 4) * 4, 46, -52);
  ctx.lineTo(2, -44);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** ごほうびのメダル */
export function drawMedal(ctx, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  // 後光
  ctx.save();
  ctx.rotate(t * 0.5);
  ctx.fillStyle = 'rgba(255,240,170,0.45)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.25);
    ctx.lineTo(r * 0.17, -r * 2.15);
    ctx.lineTo(-r * 0.17, -r * 2.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // 首にかける2本のリボン
  ctx.fillStyle = '#7FC4EA';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.12, -r * 0.7);
    ctx.lineTo(s * r * 0.62, -r * 1.85);
    ctx.lineTo(s * r * 1.02, -r * 1.7);
    ctx.lineTo(s * r * 0.46, -r * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#A8DCF5';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.2, -r * 0.72);
    ctx.lineTo(s * r * 0.66, -r * 1.78);
    ctx.lineTo(s * r * 0.82, -r * 1.72);
    ctx.lineTo(s * r * 0.38, -r * 0.62);
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#FFE9A0');
  g.addColorStop(0.5, '#FFC94D');
  g.addColorStop(1, '#E8A227');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#FFDF8A';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#F5A623';
  star4(ctx, r * 0.62);
  ctx.fill();
  ctx.restore();
}

/** 矢印（動かす向きのヒント） */
export function drawArrow(ctx, x, y, len, rot, a, color = '#FFFFFF') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(60,70,90,0.35)';
  ctx.lineWidth = 3;
  const w = len * 0.3;
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -w * 0.34);
  ctx.lineTo(len * 0.12, -w * 0.34);
  ctx.lineTo(len * 0.12, -w * 0.8);
  ctx.lineTo(len * 0.5, 0);
  ctx.lineTo(len * 0.12, w * 0.8);
  ctx.lineTo(len * 0.12, w * 0.34);
  ctx.lineTo(-len * 0.5, w * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 注目させるためのパルスリング */
export function drawPulseRing(ctx, x, y, r, t, color = '#FFD86B') {
  ctx.save();
  for (let i = 0; i < 2; i++) {
    const p = ((t * 0.7 + i * 0.5) % 1);
    const rr = r * (0.78 + p * 0.5);
    ctx.globalAlpha = (1 - p) * 0.55;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 13 * (1 - p) + 4;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = (1 - p) * 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6 * (1 - p) + 2.5;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** 進み具合のリボン（数字を使わない） */
export function drawProgressRibbon(ctx, x, y, w, p, t) {
  const h = w * 0.055;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(ctx, x, y - h / 2, w, h, h / 2);
  ctx.fill();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#8ED2F5');
  g.addColorStop(1, '#A8E6A1');
  ctx.fillStyle = g;
  roundRect(ctx, x, y - h / 2, Math.max(h, w * clamp(p, 0, 1)), h, h / 2);
  ctx.fill();

  // ゴールの旗
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(h / 70 * 1.5, h / 70 * 1.5);
  drawFlag(ctx, 0, t);
  ctx.restore();

  // 走っている位置の目印
  const mx = x + w * clamp(p, 0, 1);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(mx, y, h * 0.85, 0, TAU);
  ctx.fill();
  ctx.fillStyle = C.frame;
  ctx.beginPath();
  ctx.arc(mx, y, h * 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export { smoothstep };
