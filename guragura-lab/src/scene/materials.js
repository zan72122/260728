import * as THREE from 'three';

/** 絵本・ドールハウス風のパレットと共通マテリアル・テクスチャ生成 */

export const PALETTE = {
  bgTop: '#ffeef7',
  bgBottom: '#dff4ff',
  floor: 0xf7d9b4,
  floorEdge: 0xeec798,
  wall: 0xfff6ec,
  wainscot: 0xffd7e6,
  base: 0xfff0f6,
  deskWood: 0xe9b077,
  deskLeg: 0xdf9f63,
  shelfBody: 0xfdeef4,
  shelfTrim: 0xf9b8d0,
  cushion: 0xa8e6cf,
  cushionButton: 0x7fd4b5,
  windowFrame: 0xffffff,
  curtain: 0xffa8c5,
  bearFur: 0xcf9057,
  bearMuzzle: 0xf3ddb9,
  bearEar: 0xf5b8ce,
  lampShade: 0xffd66b,
  lampBase: 0xff8fab,
};

export function makeStandard(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.92,
    metalness: 0.0,
    ...opts,
  });
}

/** 上下グラデーションの背景テクスチャ */
export function makeBackgroundTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.bgTop);
  grad.addColorStop(1, PALETTE.bgBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 虹色の丸いラグ */
export function makeRugTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const rings = ['#ff9db6', '#ffc98f', '#fff3a0', '#b8e8a8', '#a8d8f0', '#cdb4f6', '#ffffff'];
  for (let i = 0; i < rings.length; i++) {
    g.fillStyle = rings[i];
    g.beginPath();
    g.arc(s / 2, s / 2, (s / 2) * (1 - i / rings.length), 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 窓の外の空（太陽と雲） */
export function makeSkyTexture() {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#9fd9ff');
  grad.addColorStop(1, '#e3f6ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // 太陽
  g.fillStyle = '#ffe58a';
  g.beginPath();
  g.arc(w * 0.72, h * 0.26, 56, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 10;
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(w * 0.72 + Math.cos(a) * 74, h * 0.26 + Math.sin(a) * 74);
    g.lineTo(w * 0.72 + Math.cos(a) * 94, h * 0.26 + Math.sin(a) * 94);
    g.stroke();
  }
  // 雲
  g.fillStyle = 'rgba(255,255,255,0.95)';
  const cloud = (cx, cy, r) => {
    for (const [dx, dy, rr] of [[-r, 0, r * 0.8], [0, -r * 0.4, r], [r, 0, r * 0.8], [0, r * 0.25, r * 0.9]]) {
      g.beginPath();
      g.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2);
      g.fill();
    }
  };
  cloud(w * 0.3, h * 0.4, 42);
  cloud(w * 0.62, h * 0.62, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 壁の絵（にじとおうち） */
export function makePictureTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#fffdf5';
  g.fillRect(0, 0, s, s);
  const colors = ['#ff9db6', '#ffc98f', '#fff3a0', '#b8e8a8', '#a8d8f0', '#cdb4f6'];
  g.lineCap = 'round';
  for (let i = 0; i < colors.length; i++) {
    g.strokeStyle = colors[i];
    g.lineWidth = 12;
    g.beginPath();
    g.arc(s / 2, s * 0.85, s * 0.62 - i * 13, Math.PI, 0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** やわらかい丸影・マーカー用のラジアルグラデーション */
export function makeGlowTexture(inner = 'rgba(255,140,60,0.85)', outer = 'rgba(255,140,60,0)') {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 破線リング（ゴーストの着地マーカー） */
export function makeDashedRingTexture(color = 'rgba(90,150,240,0.9)') {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.setLineDash([26, 20]);
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 16, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 星型スプライト（キラキラ・ぽよん演出） */
export function makeStarTexture(color = '#fff3a0') {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.translate(s / 2, s / 2);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s * 0.44 : s * 0.18;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ハート型スプライト */
export function makeHeartTexture(color = '#ff8fab') {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.translate(s / 2, s / 2);
  g.beginPath();
  g.moveTo(0, s * 0.3);
  g.bezierCurveTo(-s * 0.5, -s * 0.05, -s * 0.25, -s * 0.4, 0, -s * 0.15);
  g.bezierCurveTo(s * 0.25, -s * 0.4, s * 0.5, -s * 0.05, 0, s * 0.3);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
