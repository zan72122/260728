// ============================================================
// みずみちラボ - ボタンアイコン (ミニチュアを直接描く)
// ============================================================
"use strict";

const Icons = (function () {

  // ひし形ブロック(上面+右面+左面)を描く。col は [r,g,b] 配列。
  // 上面 1.0 / 左面 0.86 / 右面 0.72 の明るさ (新アイソメ画面と同じ配分)。
  // 4隅の座標 {N,E,S,W} を返し、呼び出し側の装飾に使う。
  function isoBlock(ctx, cx, cy, tw, bh, col) {
    const hw = tw / 2, hh = tw / 4;
    const N = { x: cx, y: cy - hh }, E = { x: cx + hw, y: cy },
          S = { x: cx, y: cy + hh }, W = { x: cx - hw, y: cy };
    // 右面 (もっと暗い)
    ctx.fillStyle = rgb(col, 0.72);
    ctx.beginPath();
    ctx.moveTo(E.x, E.y); ctx.lineTo(S.x, S.y);
    ctx.lineTo(S.x, S.y + bh); ctx.lineTo(E.x, E.y + bh);
    ctx.closePath(); ctx.fill();
    // 左面 (すこし暗い)
    ctx.fillStyle = rgb(col, 0.86);
    ctx.beginPath();
    ctx.moveTo(W.x, W.y); ctx.lineTo(S.x, S.y);
    ctx.lineTo(S.x, S.y + bh); ctx.lineTo(W.x, W.y + bh);
    ctx.closePath(); ctx.fill();
    // 上面 (いちばん明るい)
    ctx.fillStyle = rgb(col, 1.0);
    ctx.beginPath();
    ctx.moveTo(N.x, N.y); ctx.lineTo(E.x, E.y); ctx.lineTo(S.x, S.y); ctx.lineTo(W.x, W.y);
    ctx.closePath(); ctx.fill();
    return { N, E, S, W, hw, hh };
  }

  // ブロックの真下に、地面へのアイソメ影 (2:1) を落とす
  function blockShadow(ctx, cx, cy, tw, bh) {
    ctx.fillStyle = "rgba(90,65,35,.16)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + tw / 4 + bh + tw * 0.03, tw * 0.44, tw * 0.22, 0, 0, 7);
    ctx.fill();
  }

  const painters = {
    mountain(ctx, s) {
      // くさのブロックに とんがった ゆきやま が のっているミニチュア
      const cx = s * 0.5, cy = s * 0.4, tw = s * 0.76, bh = s * 0.4;
      blockShadow(ctx, cx, cy, tw, bh);
      isoBlock(ctx, cx, cy, tw, bh, PAL.grassHigh);
      ctx.fillStyle = "#8cc874";
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.34, cy - s * 0.01);
      ctx.lineTo(cx, cy - s * 0.38);
      ctx.lineTo(cx + tw * 0.34, cy - s * 0.01);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e4d8c4";
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.13, cy - s * 0.15);
      ctx.lineTo(cx, cy - s * 0.38);
      ctx.lineTo(cx + tw * 0.13, cy - s * 0.15);
      ctx.quadraticCurveTo(cx, cy - s * 0.22, cx - tw * 0.13, cy - s * 0.15);
      ctx.closePath(); ctx.fill();
    },
    ditch(ctx, s) {
      // くさのブロックの 上面に U字のみぞ + ちょっとの水
      const cx = s * 0.5, cy = s * 0.4, tw = s * 0.78, bh = s * 0.36;
      blockShadow(ctx, cx, cy, tw, bh);
      isoBlock(ctx, cx, cy, tw, bh, PAL.grass);
      ctx.fillStyle = "#8a6d4a";
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.16, cy - s * 0.06);
      ctx.lineTo(cx - tw * 0.03, cy + s * 0.12);
      ctx.quadraticCurveTo(cx, cy + s * 0.19, cx + tw * 0.16, cy + s * 0.04);
      ctx.lineTo(cx + tw * 0.28, cy - s * 0.1);
      ctx.lineTo(cx + tw * 0.1, cy - s * 0.22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fd4ee";
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.06, cy + s * 0.01);
      ctx.quadraticCurveTo(cx + tw * 0.02, cy + s * 0.1, cx + tw * 0.14, cy + s * 0.01);
      ctx.quadraticCurveTo(cx + tw * 0.02, cy - s * 0.05, cx - tw * 0.06, cy + s * 0.01);
      ctx.closePath(); ctx.fill();
    },
    river(ctx, s) {
      // くさのブロックの 上面を くねくね かわ が よこぎる
      const cx = s * 0.5, cy = s * 0.4, tw = s * 0.8, bh = s * 0.36;
      blockShadow(ctx, cx, cy, tw, bh);
      isoBlock(ctx, cx, cy, tw, bh, PAL.grass);
      ctx.strokeStyle = "#5fc3e6";
      ctx.lineWidth = s * 0.14;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.02, cy - s * 0.19);
      ctx.bezierCurveTo(cx + tw * 0.32, cy - s * 0.07, cx - tw * 0.28, cy + s * 0.03, cx + tw * 0.05, cy + s * 0.19);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.17);
      ctx.bezierCurveTo(cx + tw * 0.3, cy - s * 0.06, cx - tw * 0.25, cy + s * 0.03, cx + tw * 0.04, cy + s * 0.17);
      ctx.stroke();
    },
    levee(ctx, s) {
      // 波をとめる 白いかべの ブロック (うみがわに なみ、りくがわに くさ)
      const cx = s * 0.52, cy = s * 0.4, tw = s * 0.6, bh = s * 0.46;
      ctx.fillStyle = "#7fd4ee";
      ctx.beginPath();
      ctx.ellipse(cx - tw * 0.66, cy + s * 0.12, tw * 0.34, tw * 0.17, 0, 0, 7);
      ctx.fill();
      blockShadow(ctx, cx, cy, tw, bh);
      const c = isoBlock(ctx, cx, cy, tw, bh, PAL.levee);
      // いしがき もよう (右面によこすじ)
      ctx.strokeStyle = "rgba(140,140,150,.4)"; ctx.lineWidth = s * 0.018;
      for (let k = 1; k < 3; k++) {
        const t = k / 3;
        ctx.beginPath();
        ctx.moveTo(lerp(c.E.x, c.S.x, t), lerp(c.E.y, c.S.y, t));
        ctx.lineTo(lerp(c.E.x, c.S.x, t), lerp(c.E.y, c.S.y, t) + bh);
        ctx.stroke();
      }
      ctx.fillStyle = "#b0de86";
      ctx.beginPath();
      ctx.ellipse(cx + tw * 0.78, cy + s * 0.14, tw * 0.24, tw * 0.12, 0, 0, 7);
      ctx.fill();
    },
    building(ctx, s) { painters.house(ctx, s); },
    house(ctx, s) {
      ctx.fillStyle = "#fff6e8";
      rr(ctx, s * 0.2, s * 0.42, s * 0.6, s * 0.46, s * 0.06); ctx.fill();
      ctx.fillStyle = "#f2988f";
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * 0.44);
      ctx.lineTo(s * 0.5, s * 0.08);
      ctx.lineTo(s * 0.9, s * 0.44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c98b5a";
      rr(ctx, s * 0.42, s * 0.62, s * 0.16, s * 0.26, s * 0.05); ctx.fill();
      ctx.fillStyle = "#bfe6f2";
      rr(ctx, s * 0.25, s * 0.5, s * 0.13, s * 0.12, s * 0.03); ctx.fill();
      rr(ctx, s * 0.62, s * 0.5, s * 0.13, s * 0.12, s * 0.03); ctx.fill();
    },
    shop(ctx, s) {
      ctx.fillStyle = "#fdf3d8";
      rr(ctx, s * 0.12, s * 0.34, s * 0.76, s * 0.54, s * 0.07); ctx.fill();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "#f7a8bc" : "#ffffff";
        ctx.fillRect(s * (0.08 + i * 0.14), s * 0.3, s * 0.14, s * 0.16);
      }
      ctx.fillStyle = "#ef6f6f";
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.18, s * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = "#bfe6f2";
      rr(ctx, s * 0.2, s * 0.54, s * 0.3, s * 0.24, s * 0.04); ctx.fill();
      ctx.fillStyle = "#c98b5a";
      rr(ctx, s * 0.58, s * 0.58, s * 0.18, s * 0.3, s * 0.04); ctx.fill();
    },
    school(ctx, s) {
      ctx.fillStyle = "#fdf6da";
      rr(ctx, s * 0.1, s * 0.42, s * 0.8, s * 0.46, s * 0.08); ctx.fill();
      ctx.fillStyle = "#f7b263";
      ctx.beginPath();
      ctx.moveTo(s * 0.04, s * 0.44);
      ctx.quadraticCurveTo(s * 0.5, s * 0.02, s * 0.96, s * 0.44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffd93b";
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.36, s * 0.09, 0, 7); ctx.fill();
      ctx.fillStyle = "#e78fa5";
      rr(ctx, s * 0.28, s * 0.62, s * 0.16, s * 0.26, s * 0.04); ctx.fill();
      ctx.fillStyle = "#8fc7e8";
      rr(ctx, s * 0.54, s * 0.62, s * 0.16, s * 0.26, s * 0.04); ctx.fill();
    },
    plateau(ctx, s) {
      // たいらな おかの ブロック + 右面に かいだん
      const cx = s * 0.5, cy = s * 0.38, tw = s * 0.78, bh = s * 0.42;
      blockShadow(ctx, cx, cy, tw, bh);
      const c = isoBlock(ctx, cx, cy, tw, bh, PAL.plat);
      // 右面に かいだん (しましま)
      const steps = 3;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        ctx.fillStyle = k % 2 ? "#d9c69c" : "#efe3c4";
        ctx.beginPath();
        ctx.moveTo(lerp(c.E.x, c.S.x, t0), lerp(c.E.y, c.S.y, t0));
        ctx.lineTo(lerp(c.E.x, c.S.x, t1), lerp(c.E.y, c.S.y, t1));
        ctx.lineTo(lerp(c.E.x, c.S.x, t1), lerp(c.E.y, c.S.y, t1) + bh);
        ctx.lineTo(lerp(c.E.x, c.S.x, t0), lerp(c.E.y, c.S.y, t0) + bh);
        ctx.closePath(); ctx.fill();
      }
      // 上面に お花
      ctx.fillStyle = "#ff9db8";
      ctx.beginPath(); ctx.arc(cx - tw * 0.2, cy - s * 0.02, s * 0.045, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + tw * 0.18, cy + s * 0.02, s * 0.045, 0, 7); ctx.fill();
    },
    water(ctx, s) {
      // ピンクのじょうろ
      ctx.fillStyle = "#ff9db8";
      rr(ctx, s * 0.3, s * 0.28, s * 0.42, s * 0.34, s * 0.1); ctx.fill();
      ctx.strokeStyle = "#ff9db8"; ctx.lineWidth = s * 0.08; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s * 0.34, s * 0.42);
      ctx.lineTo(s * 0.14, s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.26, s * 0.15, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = "#ffc7d6";
      ctx.beginPath(); ctx.arc(s * 0.12, s * 0.28, s * 0.08, 0, 7); ctx.fill();
      drawDropShape(ctx, s * 0.14, s * 0.52, s * 0.06, "#5fc3e6");
      drawDropShape(ctx, s * 0.2, s * 0.68, s * 0.07, "#5fc3e6");
      drawDropShape(ctx, s * 0.1, s * 0.78, s * 0.05, "#7fd4ee");
    },
    wave(ctx, s) {
      ctx.fillStyle = "#5fc3e6";
      ctx.beginPath();
      ctx.moveTo(s * 0.05, s * 0.9);
      ctx.lineTo(s * 0.05, s * 0.55);
      ctx.bezierCurveTo(s * 0.05, s * 0.15, s * 0.6, s * 0.05, s * 0.68, s * 0.35);
      ctx.bezierCurveTo(s * 0.72, s * 0.5, s * 0.55, s * 0.55, s * 0.5, s * 0.45);
      ctx.bezierCurveTo(s * 0.6, s * 0.62, s * 0.95, s * 0.55, s * 0.95, s * 0.9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(s * 0.2, s * 0.32, s * 0.07, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.34, s * 0.2, s * 0.05, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.78, s * 0.72, s * 0.06, 0, 7); ctx.fill();
    },
    eraser(ctx, s) {
      // ピンクのスポンジ + キラ
      ctx.save();
      ctx.translate(s * 0.5, s * 0.55);
      ctx.rotate(-0.35);
      ctx.fillStyle = "#ff9db8";
      rr(ctx, -s * 0.32, -s * 0.18, s * 0.64, s * 0.36, s * 0.1); ctx.fill();
      ctx.fillStyle = "#ffc7d6";
      rr(ctx, -s * 0.32, -s * 0.18, s * 0.64, s * 0.14, s * 0.07); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffd93b";
      star(ctx, s * 0.78, s * 0.22, s * 0.1);
      star(ctx, s * 0.2, s * 0.16, s * 0.06);
    },
    undo(ctx, s) {
      ctx.strokeStyle = "#8a6d4a";
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.28, -0.5, Math.PI * 1.25);
      ctx.stroke();
      ctx.fillStyle = "#8a6d4a";
      ctx.beginPath();
      const a = -0.5;
      const px = s * 0.5 + Math.cos(a) * s * 0.28, py = s * 0.5 + Math.sin(a) * s * 0.28;
      ctx.moveTo(px + s * 0.14, py - s * 0.1);
      ctx.lineTo(px - s * 0.1, py - s * 0.14);
      ctx.lineTo(px + s * 0.02, py + s * 0.14);
      ctx.closePath(); ctx.fill();
    },
    reset(ctx, s) {
      // あたらしい まっさらな板
      ctx.fillStyle = "#efe2c6";
      rr(ctx, s * 0.1, s * 0.2, s * 0.8, s * 0.6, s * 0.12); ctx.fill();
      ctx.fillStyle = "#fdf8ec";
      rr(ctx, s * 0.18, s * 0.28, s * 0.64, s * 0.44, s * 0.09); ctx.fill();
      star(ctx, s * 0.5, s * 0.5, s * 0.14, "#ffd93b");
    },
    modeFree(ctx, s) {
      // すなばセット (バケツとスコップ)
      ctx.fillStyle = "#5fc3e6";
      ctx.beginPath();
      ctx.moveTo(s * 0.14, s * 0.35);
      ctx.lineTo(s * 0.5, s * 0.35);
      ctx.lineTo(s * 0.44, s * 0.85);
      ctx.lineTo(s * 0.2, s * 0.85);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#3f9dbd"; ctx.lineWidth = s * 0.05;
      ctx.beginPath(); ctx.arc(s * 0.32, s * 0.33, s * 0.17, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = "#ffb03b";
      rr(ctx, s * 0.6, s * 0.16, s * 0.1, s * 0.4, s * 0.04); ctx.fill();
      ctx.beginPath();
      ctx.ellipse(s * 0.65, s * 0.72, s * 0.14, s * 0.2, 0, 0, 7);
      ctx.fill();
    },
    modeQuest(ctx, s) {
      star(ctx, s * 0.5, s * 0.52, s * 0.4, "#ffd93b");
      ctx.strokeStyle = "#e0a72e"; ctx.lineWidth = s * 0.04;
      star(ctx, s * 0.5, s * 0.52, s * 0.4, null, true);
    },
    modeCompare(ctx, s) {
      ctx.fillStyle = "#cdeffc";
      rr(ctx, s * 0.06, s * 0.2, s * 0.4, s * 0.6, s * 0.08); ctx.fill();
      ctx.fillStyle = "#ffd9e4";
      rr(ctx, s * 0.54, s * 0.2, s * 0.4, s * 0.6, s * 0.08); ctx.fill();
      ctx.fillStyle = "#5fc3e6";
      ctx.beginPath(); ctx.arc(s * 0.26, s * 0.6, s * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = "#ec7fa0";
      ctx.beginPath(); ctx.arc(s * 0.74, s * 0.5, s * 0.14, 0, 7); ctx.fill();
      ctx.fillStyle = "#8a6d4a";
      ctx.font = "bold " + s * 0.2 + "px sans-serif";
    },
    go(ctx, s) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.18);
      ctx.lineTo(s * 0.85, s * 0.5);
      ctx.lineTo(s * 0.3, s * 0.82);
      ctx.closePath(); ctx.fill();
      drawDropShape(ctx, s * 0.18, s * 0.3, s * 0.09, "#5fc3e6");
    },
    play(ctx, s) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.2);
      ctx.lineTo(s * 0.85, s * 0.5);
      ctx.lineTo(s * 0.32, s * 0.8);
      ctx.closePath(); ctx.fill();
    },
    snap(ctx, s) {
      // カメラ
      ctx.fillStyle = "#8a6d4a";
      rr(ctx, s * 0.1, s * 0.3, s * 0.8, s * 0.5, s * 0.1); ctx.fill();
      ctx.fillStyle = "#8a6d4a";
      rr(ctx, s * 0.34, s * 0.2, s * 0.3, s * 0.14, s * 0.05); ctx.fill();
      ctx.fillStyle = "#cdeffc";
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.55, s * 0.16, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(s * 0.45, s * 0.5, s * 0.05, 0, 7); ctx.fill();
      ctx.fillStyle = "#ff9db8";
      ctx.beginPath(); ctx.arc(s * 0.78, s * 0.4, s * 0.045, 0, 7); ctx.fill();
    },
    snapClear(ctx, s) {
      painters.snap(ctx, s);
      ctx.strokeStyle = "#ec7fa0";
      ctx.lineWidth = s * 0.1; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(s * 0.16, s * 0.16); ctx.lineTo(s * 0.84, s * 0.84); ctx.stroke();
    },
  };

  function star(ctx, cx, cy, r, fill, strokeOnly) {
    if (fill) ctx.fillStyle = fill;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr2 = k % 2 ? r * 0.45 : r;
      const an = k / 10 * Math.PI * 2 - Math.PI / 2;
      if (k === 0) ctx.moveTo(cx + Math.cos(an) * rr2, cy + Math.sin(an) * rr2);
      else ctx.lineTo(cx + Math.cos(an) * rr2, cy + Math.sin(an) * rr2);
    }
    ctx.closePath();
    if (strokeOnly) ctx.stroke(); else ctx.fill();
  }

  function paint(canvas, name) {
    const ctx = canvas.getContext("2d");
    const s = canvas.width;
    ctx.clearRect(0, 0, s, canvas.height);
    if (painters[name]) painters[name](ctx, s);
  }

  return { paint, painters, star };
})();
