/* ═══════════════════════════════════════════════════════════
   sprites.js — 粒スプライトの事前描画キャッシュ
   ガラスびーず / ラメ片 / はなびら / おほしさま / あわ / フレア
   毎フレームのグラデーション生成を避け、光の層を焼き込む
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Sprites = (() => {
  const cache = new Map();
  const SIZE = 96;               // スプライト解像度（描画時に縮小）
  const HALF = SIZE / 2;

  function make(draw) {
    const c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext("2d");
    g.translate(HALF, HALF);
    draw(g);
    return c;
  }

  /* ── ガラスびーず ──
     深い底色 → 中間色 → 透けるハイライト、環境の映り込み、
     下側の透過光（カラーブリード）まで焼き込む */
  function bead([hi, mid, lo]) {
    return make(g => {
      const R = HALF * 0.94;
      // 本体：斜め上からの光
      let grad = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
      grad.addColorStop(0, hi);
      grad.addColorStop(0.45, mid);
      grad.addColorStop(0.85, lo);
      grad.addColorStop(1, shade(lo, 0.72));
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      // 下側の透過光（ガラスが光を通す感じ）
      grad = g.createRadialGradient(R * 0.18, R * 0.52, 0, R * 0.18, R * 0.52, R * 0.62);
      grad.addColorStop(0, withAlpha(hi, 0.75));
      grad.addColorStop(1, withAlpha(hi, 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      // 内側の輪郭（ガラスの厚み）
      g.strokeStyle = withAlpha("#ffffff", 0.22);
      g.lineWidth = SIZE * 0.035;
      g.beginPath(); g.arc(0, 0, R * 0.82, Math.PI * 0.62, Math.PI * 1.5); g.stroke();
      // 強いスペキュラ
      grad = g.createRadialGradient(-R * 0.36, -R * 0.42, 0, -R * 0.36, -R * 0.42, R * 0.34);
      grad.addColorStop(0, "rgba(255,255,255,.96)");
      grad.addColorStop(0.35, "rgba(255,255,255,.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath(); g.arc(-R * 0.36, -R * 0.42, R * 0.34, 0, Math.PI * 2); g.fill();
      // 小さな二次ハイライト
      g.fillStyle = "rgba(255,255,255,.65)";
      g.beginPath(); g.ellipse(R * 0.3, R * 0.12, R * 0.1, R * 0.055, -0.6, 0, Math.PI * 2); g.fill();
    });
  }

  /* ── ラメ片（六角のホログラム） ── */
  function glitterFlake([hi, mid, lo]) {
    return make(g => {
      const R = HALF * 0.9;
      g.rotate(0.35);
      const grad = g.createLinearGradient(-R, -R, R, R);
      grad.addColorStop(0, hi);
      grad.addColorStop(0.45, mid);
      grad.addColorStop(0.55, "#ffffff");
      grad.addColorStop(0.65, mid);
      grad.addColorStop(1, lo);
      g.fillStyle = grad;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * R, y = Math.sin(a) * R;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      g.strokeStyle = withAlpha("#ffffff", 0.65);
      g.lineWidth = SIZE * 0.05;
      g.stroke();
    });
  }

  /* ── はなびら（さくら型・すこし透ける） ── */
  function petal([hi, mid, lo]) {
    return make(g => {
      const R = HALF * 0.92;
      g.globalAlpha = 0.92;
      const grad = g.createLinearGradient(0, -R, 0, R);
      grad.addColorStop(0, hi);
      grad.addColorStop(0.6, mid);
      grad.addColorStop(1, lo);
      g.fillStyle = grad;
      // 花びら形：先端に切れ込みのあるさくらの一枚
      g.beginPath();
      g.moveTo(0, R * 0.95);                                   // つけ根
      g.bezierCurveTo(-R * 0.95, R * 0.55, -R * 0.8, -R * 0.5, -R * 0.28, -R * 0.82);
      g.lineTo(0, -R * 0.55);                                  // 切れ込み
      g.lineTo(R * 0.28, -R * 0.82);
      g.bezierCurveTo(R * 0.8, -R * 0.5, R * 0.95, R * 0.55, 0, R * 0.95);
      g.closePath();
      g.fill();
      // 中心の筋
      g.strokeStyle = withAlpha(lo, 0.5);
      g.lineWidth = SIZE * 0.022;
      g.beginPath();
      g.moveTo(0, R * 0.85);
      g.quadraticCurveTo(-R * 0.06, R * 0.1, 0, -R * 0.45);
      g.stroke();
      g.beginPath();
      g.moveTo(0, R * 0.6);
      g.quadraticCurveTo(-R * 0.3, R * 0.15, -R * 0.42, -R * 0.3);
      g.moveTo(0, R * 0.6);
      g.quadraticCurveTo(R * 0.3, R * 0.15, R * 0.42, -R * 0.3);
      g.globalAlpha = 0.45;
      g.stroke();
      g.globalAlpha = 0.92;
      // ふちの光
      const rim = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R);
      rim.addColorStop(0, "rgba(255,255,255,0)");
      rim.addColorStop(1, "rgba(255,255,255,.5)");
      g.fillStyle = rim;
      g.beginPath();
      g.moveTo(0, R * 0.95);
      g.bezierCurveTo(-R * 0.95, R * 0.55, -R * 0.8, -R * 0.5, -R * 0.28, -R * 0.82);
      g.lineTo(0, -R * 0.55);
      g.lineTo(R * 0.28, -R * 0.82);
      g.bezierCurveTo(R * 0.8, -R * 0.5, R * 0.95, R * 0.55, 0, R * 0.95);
      g.closePath();
      g.fill();
    });
  }

  /* ── おほしさま（ぷっくりした金平糖風） ── */
  function star([hi, mid, lo]) {
    return make(g => {
      const R = HALF * 0.94;
      const pts = 5, inner = 0.5;
      g.rotate(-Math.PI / 2);
      const path = () => {
        g.beginPath();
        for (let i = 0; i < pts * 2; i++) {
          const a = (i / (pts * 2)) * Math.PI * 2;
          const r = (i % 2 === 0 ? 1 : inner) * R;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.closePath();
      };
      let grad = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.05, 0, 0, R);
      grad.addColorStop(0, hi);
      grad.addColorStop(0.55, mid);
      grad.addColorStop(1, lo);
      g.fillStyle = grad;
      path(); g.fill();
      g.lineJoin = "round";
      g.strokeStyle = withAlpha(lo, 0.7);
      g.lineWidth = SIZE * 0.03;
      path(); g.stroke();
      // ぷっくりハイライト
      grad = g.createRadialGradient(-R * 0.22, -R * 0.25, 0, -R * 0.22, -R * 0.25, R * 0.5);
      grad.addColorStop(0, "rgba(255,255,255,.85)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      path(); g.fill();
      // 中心のきらり
      g.fillStyle = "rgba(255,255,255,.8)";
      g.beginPath(); g.arc(R * 0.08, -R * 0.02, R * 0.08, 0, Math.PI * 2); g.fill();
    });
  }

  /* ── あわ（液体モードで浮かぶ） ── */
  function bubble() {
    return make(g => {
      const R = HALF * 0.9;
      let grad = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.82, "rgba(220,245,255,.10)");
      grad.addColorStop(1, "rgba(255,255,255,.75)");
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,.9)";
      g.beginPath(); g.ellipse(-R * 0.35, -R * 0.4, R * 0.18, R * 0.1, -0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,.5)";
      g.beginPath(); g.arc(R * 0.3, R * 0.35, R * 0.07, 0, Math.PI * 2); g.fill();
    });
  }

  /* ── 十字フレア（ラメの強いきらめき用） ── */
  function flare() {
    return make(g => {
      const R = HALF * 0.98;
      const arm = (rot, len, w) => {
        g.save(); g.rotate(rot);
        const grad = g.createLinearGradient(0, -len, 0, len);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,.95)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, -len);
        g.quadraticCurveTo(w, 0, 0, len);
        g.quadraticCurveTo(-w, 0, 0, -len);
        g.fill();
        g.restore();
      };
      arm(0, R, R * 0.09);
      arm(Math.PI / 2, R, R * 0.09);
      arm(Math.PI / 4, R * 0.5, R * 0.06);
      arm(-Math.PI / 4, R * 0.5, R * 0.06);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.22);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R * 0.22, 0, Math.PI * 2); g.fill();
    });
  }

  /* ── やわらかい光球（コースティック光斑用） ── */
  function glow(color) {
    return make(g => {
      const R = HALF;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
      grad.addColorStop(0, withAlpha(color, 0.9));
      grad.addColorStop(0.5, withAlpha(color, 0.32));
      grad.addColorStop(1, withAlpha(color, 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    });
  }

  /* ── 色ユーティリティ ── */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function withAlpha(hex, a) {
    if (hex.startsWith("rgb")) return hex;
    const [r, gg, b] = hexToRgb(hex);
    return `rgba(${r},${gg},${b},${a})`;
  }
  function shade(hex, f) {
    const [r, gg, b] = hexToRgb(hex);
    return `rgb(${(r * f) | 0},${(gg * f) | 0},${(b * f) | 0})`;
  }

  const BUILDERS = { beads: bead, glitter: glitterFlake, petals: petal, stars: star };

  function get(type, colorIdx) {
    const key = type + ":" + colorIdx;
    let s = cache.get(key);
    if (!s) {
      if (type === "bubble") s = bubble();
      else if (type === "flare") s = flare();
      else if (type.startsWith("glow")) s = glow(type.slice(5));
      else s = BUILDERS[type](KKM.MATERIALS[type].colors[colorIdx]);
      cache.set(key, s);
    }
    return s;
  }

  return { get, SIZE, withAlpha };
})();
