// ============================================================
// みずみちラボ - ボタンアイコン (ミニチュアを直接描く)
// ============================================================
"use strict";

const Icons = (function () {

  function ground(ctx, s, color) {
    ctx.fillStyle = color || "#b0de86";
    rr(ctx, s * 0.06, s * 0.62, s * 0.88, s * 0.3, s * 0.1);
    ctx.fill();
  }

  const painters = {
    mountain(ctx, s) {
      ground(ctx, s);
      ctx.fillStyle = "#8cc874";
      ctx.beginPath();
      ctx.moveTo(s * 0.12, s * 0.72);
      ctx.quadraticCurveTo(s * 0.5, s * -0.12, s * 0.88, s * 0.72);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e4d8c4";
      ctx.beginPath();
      ctx.moveTo(s * 0.36, s * 0.30);
      ctx.quadraticCurveTo(s * 0.5, s * 0.06, s * 0.64, s * 0.30);
      ctx.quadraticCurveTo(s * 0.5, s * 0.40, s * 0.36, s * 0.30);
      ctx.closePath(); ctx.fill();
    },
    ditch(ctx, s) {
      // じめんのブロックに U字のみぞ + ちょっとの水
      ctx.fillStyle = "#b0de86";
      rr(ctx, s * 0.06, s * 0.3, s * 0.88, s * 0.55, s * 0.12); ctx.fill();
      ctx.fillStyle = "#8a6d4a";
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.3);
      ctx.lineTo(s * 0.32, s * 0.62);
      ctx.quadraticCurveTo(s * 0.5, s * 0.75, s * 0.68, s * 0.62);
      ctx.lineTo(s * 0.68, s * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fd4ee";
      ctx.beginPath();
      ctx.moveTo(s * 0.36, s * 0.52);
      ctx.lineTo(s * 0.64, s * 0.52);
      ctx.quadraticCurveTo(s * 0.5, s * 0.7, s * 0.36, s * 0.52);
      ctx.closePath(); ctx.fill();
    },
    river(ctx, s) {
      ground(ctx, s, "#b0de86");
      ctx.fillStyle = "#b0de86";
      rr(ctx, s * 0.06, s * 0.1, s * 0.88, s * 0.8, s * 0.14); ctx.fill();
      ctx.strokeStyle = "#5fc3e6";
      ctx.lineWidth = s * 0.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.08);
      ctx.bezierCurveTo(s * 0.75, s * 0.3, s * 0.25, s * 0.6, s * 0.68, s * 0.9);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(s * 0.33, s * 0.14);
      ctx.bezierCurveTo(s * 0.72, s * 0.32, s * 0.28, s * 0.6, s * 0.65, s * 0.85);
      ctx.stroke();
    },
    levee(ctx, s) {
      // 波をとめる白いかべ
      ctx.fillStyle = "#7fd4ee";
      ctx.beginPath();
      ctx.moveTo(s * 0.04, s * 0.9);
      ctx.lineTo(s * 0.04, s * 0.5);
      ctx.quadraticCurveTo(s * 0.18, s * 0.32, s * 0.3, s * 0.5);
      ctx.lineTo(s * 0.3, s * 0.9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#eeeeec";
      rr(ctx, s * 0.38, s * 0.18, s * 0.26, s * 0.72, s * 0.08); ctx.fill();
      ctx.strokeStyle = "#c8c8cc"; ctx.lineWidth = s * 0.035;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(s * 0.38, s * (0.18 + i * 0.18));
        ctx.lineTo(s * 0.64, s * (0.18 + i * 0.18));
        ctx.stroke();
      }
      ctx.fillStyle = "#b0de86";
      rr(ctx, s * 0.7, s * 0.62, s * 0.26, s * 0.28, s * 0.08); ctx.fill();
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
      ground(ctx, s);
      // たいらな おか + かいだん
      ctx.fillStyle = "#d6b88a";
      rr(ctx, s * 0.16, s * 0.3, s * 0.68, s * 0.5, s * 0.06); ctx.fill();
      ctx.fillStyle = "#9ed67e";
      rr(ctx, s * 0.12, s * 0.18, s * 0.76, s * 0.2, s * 0.09); ctx.fill();
      ctx.fillStyle = "#e8d9b8";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(s * (0.42 + i * 0.02), s * (0.38 + i * 0.16), s * (0.16 - i * 0.0), s * 0.12);
      }
      ctx.fillStyle = "#ff9db8";
      ctx.beginPath(); ctx.arc(s * 0.26, s * 0.24, s * 0.045, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.72, s * 0.26, s * 0.045, 0, 7); ctx.fill();
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
