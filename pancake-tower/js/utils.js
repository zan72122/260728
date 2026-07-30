/* ============================================================
 * utils.js — 共通ヘルパー / 定数 / 顔テクスチャ
 * ============================================================ */
window.PT = window.PT || {};

(function () {
  // ---- 定数（ワールドスケール） ----
  PT.G = 22;                 // 重力（ゲーム用に調整した値）
  PT.PANCAKE_R = 1.5;        // 基本パンケーキ半径
  PT.PANCAKE_H = 0.5;        // 厚み
  PT.PLATE_R = 3.3;          // 中央の大皿
  PT.PLATE_H = 0.34;
  PT.SERVE_R = 2.3;          // サーブ皿
  PT.SERVE_H = 0.2;
  PT.SERVE_DIST = 5.9;       // サーブ皿の距離
  PT.SERVE_ANGLES = [Math.PI * 0.1, Math.PI * 0.78, Math.PI * 1.45];

  // ---- 乱数・数学 ----
  PT.rand = (a, b) => a + Math.random() * (b - a);
  PT.randi = (a, b) => Math.floor(PT.rand(a, b + 1));
  PT.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  PT.lerp = (a, b, t) => a + (b - a) * t;
  PT.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  PT.smooth = (a, b, v) => {
    const t = PT.clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // ---- キャンバステクスチャ工房 ----
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  PT.makeCanvas = makeCanvas;

  // カラーテクスチャは必ずsRGBとして扱う（白飛び防止）
  PT.srgb = function (t) {
    t.encoding = THREE.sRGBEncoding;
    return t;
  };

  // ラウンドをまたぐGPUリソースの後始末（userData.shared は共有物なので残す）
  PT.disposeObject = function (root) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return;
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) {
        o.geometry.dispose();
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose();
        m.dispose();
      });
    });
  };

  // 空のグラデーション
  PT.skyTexture = function () {
    const c = makeCanvas(64, 512);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0.0, '#ffc9e8');
    gr.addColorStop(0.45, '#ffe3f0');
    gr.addColorStop(0.75, '#fff3e2');
    gr.addColorStop(1.0, '#ffeacc');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 512);
    const t = PT.srgb(new THREE.CanvasTexture(c));
    return t;
  };

  // テーブルクロス（パステルのギンガムチェック）
  PT.tableTexture = function () {
    const s = 256, c = makeCanvas(s, s), g = c.getContext('2d');
    g.fillStyle = '#fff3f8';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,158,200,0.75)';
    g.fillRect(0, 0, s / 2, s / 2);
    g.fillRect(s / 2, s / 2, s / 2, s / 2);
    g.fillStyle = 'rgba(255,203,226,0.6)';
    g.fillRect(s / 2, 0, s / 2, s / 2);
    g.fillRect(0, s / 2, s / 2, s / 2);
    const t = PT.srgb(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 14);
    return t;
  };

  // パンケーキ表面（焼き色のむら）
  PT.pancakeTexture = function (tone) {
    const s = 128, c = makeCanvas(s, s), g = c.getContext('2d');
    g.fillStyle = tone;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const r = PT.rand(4, 16);
      g.fillStyle = `rgba(190,120,50,${PT.rand(0.03, 0.1)})`;
      g.beginPath();
      g.arc(PT.rand(0, s), PT.rand(0, s), r, 0, 7);
      g.fill();
    }
    return PT.srgb(new THREE.CanvasTexture(c));
  };

  // ---- 顔テクスチャ（共有） ----
  function drawFace(g, kind) {
    g.clearRect(0, 0, 256, 128);
    g.strokeStyle = '#6b4423';
    g.fillStyle = '#6b4423';
    g.lineWidth = 9;
    g.lineCap = 'round';
    const eyeY = 46, exL = 62, exR = 194;
    if (kind === 'normal' || kind === 'happy') {
      // 目
      if (kind === 'normal') {
        g.beginPath(); g.arc(exL, eyeY, 13, 0, 7); g.fill();
        g.beginPath(); g.arc(exR, eyeY, 13, 0, 7); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(exL + 5, eyeY - 5, 4.5, 0, 7); g.fill();
        g.beginPath(); g.arc(exR + 5, eyeY - 5, 4.5, 0, 7); g.fill();
        g.fillStyle = '#6b4423';
      } else {
        g.beginPath(); g.arc(exL, eyeY + 6, 15, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
        g.beginPath(); g.arc(exR, eyeY + 6, 15, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      }
      // 口
      g.beginPath(); g.arc(128, 66, 24, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      // ほっぺ
      g.fillStyle = 'rgba(255,120,150,0.55)';
      g.beginPath(); g.arc(26, 78, 14, 0, 7); g.fill();
      g.beginPath(); g.arc(230, 78, 14, 0, 7); g.fill();
    } else if (kind === 'blink') {
      g.beginPath(); g.moveTo(exL - 14, eyeY); g.lineTo(exL + 14, eyeY); g.stroke();
      g.beginPath(); g.moveTo(exR - 14, eyeY); g.lineTo(exR + 14, eyeY); g.stroke();
      g.beginPath(); g.arc(128, 66, 24, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.fillStyle = 'rgba(255,120,150,0.55)';
      g.beginPath(); g.arc(26, 78, 14, 0, 7); g.fill();
      g.beginPath(); g.arc(230, 78, 14, 0, 7); g.fill();
    } else if (kind === 'wee') {
      // すべってる時「わぁ！」
      g.beginPath(); g.arc(exL, eyeY, 14, 0, 7); g.stroke();
      g.beginPath(); g.arc(exR, eyeY, 14, 0, 7); g.stroke();
      g.beginPath(); g.arc(128, 76, 20, 0, 7); g.stroke();
    } else if (kind === 'sleep') {
      // おやすみ（着地後）
      g.beginPath(); g.arc(exL, eyeY, 15, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.beginPath(); g.arc(exR, eyeY, 15, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.beginPath(); g.arc(128, 62, 22, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.fillStyle = 'rgba(255,120,150,0.55)';
      g.beginPath(); g.arc(26, 78, 14, 0, 7); g.fill();
      g.beginPath(); g.arc(230, 78, 14, 0, 7); g.fill();
    }
  }

  PT.faceTextures = null;
  PT.initFaceTextures = function () {
    if (PT.faceTextures) return PT.faceTextures;
    const kinds = ['normal', 'blink', 'happy', 'wee', 'sleep'];
    PT.faceTextures = {};
    kinds.forEach((k) => {
      const c = makeCanvas(256, 128);
      drawFace(c.getContext('2d'), k);
      const t = PT.srgb(new THREE.CanvasTexture(c));
      t.userData.shared = true;
      PT.faceTextures[k] = t;
    });
    return PT.faceTextures;
  };

  // 丸いスプライト（パーティクル用）
  PT.dotTexture = function (color, glow) {
    const s = 64, c = makeCanvas(s, s), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, color);
    gr.addColorStop(0.55, glow || color);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    return PT.srgb(new THREE.CanvasTexture(c));
  };

  // 星形スプライト
  PT.starTexture = function (color) {
    const s = 64, c = makeCanvas(s, s), g = c.getContext('2d');
    g.fillStyle = color;
    g.translate(32, 34);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 26 : 11;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    return PT.srgb(new THREE.CanvasTexture(c));
  };
})();
