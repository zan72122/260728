/* ═══════════════════════════════════════════════════════════
   main.js — 起動・リサイズ・メインループ
   ═══════════════════════════════════════════════════════════ */
"use strict";

(() => {
  const S = KKM.state;
  const DPR_CAP = 2;

  const chamber = new KKM.Chamber();
  const kaleido = new KKM.Kaleido();
  window.KKM_kaleido = kaleido;   // しゃしん用に共有

  const canvases = {};
  let lastT = 0;
  let sparkleGlow = 0;

  function dpr() { return Math.min(DPR_CAP, window.devicePixelRatio || 1); }

  function setupCanvas(id) {
    const cv = document.getElementById(id);
    canvases[id] = { cv, ctx: cv.getContext("2d"), w: 0, h: 0 };
    return canvases[id];
  }

  function resizeCanvas(entry) {
    const { cv } = entry;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width * dpr()));
    const h = Math.max(2, Math.round(rect.height * dpr()));
    if (w !== entry.w || h !== entry.h) {
      cv.width = w; cv.height = h;
      entry.w = w; entry.h = h;
    }
    return entry;
  }

  /* ── 各画面の描画 ─────────────────────────── */

  function sectorOpts(quality) {
    // くさびの視線は「なかみの重心」を追う。
    // 落ち着いているときは筒の回転と 1:1 で一致し、
    // 速く回すと中身が遅れてついてくる、あの感じになる。
    return {
      sectorAngle: KKM.MIRROR_SECTOR[S.mirrors],
      skew: S.skew01 * KKM.SKEW_MAX,
      tubeAngle: Math.PI / 2 - chamber.focusAngle(),
      quality,
    };
  }

  function drawTitle() {
    const e = resizeCanvas(canvases["title-canvas"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = w / 2, cy = h * 0.46;
    const viewR = Math.hypot(w, h) * 0.5 + 8;   // 画面全体を覆う
    ctx.fillStyle = "#17102a";
    ctx.fillRect(0, 0, w, h);
    kaleido.renderChamber(chamber, Math.min(420, viewR | 0), S.titleAngle);
    kaleido.draw(ctx, cx, cy, viewR, sectorOpts(0.5));
    // 文字が読めるように、しっとりした紫のベール
    let veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    veil.addColorStop(0, "rgba(23, 16, 42, .58)");
    veil.addColorStop(0.6, "rgba(23, 16, 42, .42)");
    veil.addColorStop(1, "rgba(12, 8, 24, .78)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }

  function drawMirrorPreview() {
    const e = resizeCanvas(canvases["mirror-preview"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#17102a";
    ctx.fillRect(0, 0, w, h);
    const viewR = Math.min(w, h) / 2;
    kaleido.renderChamber(chamber, Math.min(360, viewR | 0), S.titleAngle);
    kaleido.draw(ctx, w / 2, h / 2, viewR, sectorOpts(1));
  }

  function drawChamberView() {
    const e = resizeCanvas(canvases["chamber-view"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const viewR = Math.min(w, h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, viewR, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    chamber.draw(ctx, viewR, 0);
    // ガラスのてかり
    const shine = ctx.createLinearGradient(-viewR, -viewR, viewR * 0.4, viewR * 0.6);
    shine.addColorStop(0, "rgba(255,255,255,.28)");
    shine.addColorStop(0.24, "rgba(255,255,255,.05)");
    shine.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(-viewR, -viewR, viewR * 2, viewR * 2);
    ctx.restore();
  }

  function drawPeek(dt) {
    const e = resizeCanvas(canvases["peek-canvas"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = w / 2, cy = h / 2;
    const viewR = Math.min(w, h) / 2 * 0.92;
    kaleido.drawSurround(ctx, w, h, cx, cy, viewR, S.tubeAngle);
    const chPix = Math.min(560, Math.max(220, viewR | 0));
    kaleido.renderChamber(chamber, chPix, S.tubeAngle);
    kaleido.draw(ctx, cx, cy, viewR, sectorOpts(1));
  }

  /* ── メインループ ─────────────────────────── */

  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) { lastT = t; return; }
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.1) dt = 0.1;    // タブ復帰などの巨大ステップを防ぐ

    // ── 回転の更新 ──
    S.titleAngle += dt * 0.11;
    if (S.screen === "peek") {
      if (!S.dragging) {
        S.tubeAngle += S.tubeOmega * dt;
        S.tubeOmega *= Math.exp(-dt * 1.5);    // ゆっくり惰性が抜ける
        if (Math.abs(S.tubeOmega) < 0.004) S.tubeOmega = 0;
      }
    }

    // ── 重力（かたむき対応） ──
    const G = KKM.PHYSICS.GRAVITY;
    let gx = 0, gy = G;
    if (S.screen === "peek" && S.tilt.active) {
      const mag = Math.max(0.25, Math.hypot(S.tilt.x, S.tilt.y));
      gx = S.tilt.x * G;
      gy = S.tilt.y * G;
      // まっ平らに持つと重力がほぼ消えて、ふわふわ漂う（それも楽しい）
      if (mag < 0.18) { gx *= 0.4; gy *= 0.4; }
    }

    // ── 物理 ──
    const angleForPhysics =
      S.screen === "peek" ? S.tubeAngle :
      S.screen === "title" ? S.titleAngle : 0;
    const omegaForPhysics =
      S.screen === "peek" ? (S.dragging ? S.tubeOmega : S.tubeOmega) :
      S.screen === "title" ? 0.11 : 0;
    chamber.step(dt, { x: gx, y: gy }, angleForPhysics, omegaForPhysics);

    // ── 描画（見えている画面だけ） ──
    if (S.screen === "title") {
      drawTitle();
    } else if (S.screen === "workshop") {
      if (S.step === 0) drawMirrorPreview();
      else {
        drawChamberView();
        updateGauge();
      }
    } else if (S.screen === "peek") {
      drawPeek(dt);
      // 強いきらめき → ごくたまに音
      if (chamber._sparkles.length > 0) {
        sparkleGlow += dt;
        if (sparkleGlow > 0.4) { KKM.Sound.shimmer(); sparkleGlow = 0; }
      }
    }
  }

  function updateGauge() {
    const bar = document.getElementById("fill-gauge-bar");
    const ratio = chamber.fillRatio();
    bar.style.width = (ratio * 100).toFixed(0) + "%";
  }

  /* ── 起動 ─────────────────────────────── */

  function boot() {
    setupCanvas("title-canvas");
    setupCanvas("mirror-preview");
    setupCanvas("chamber-view");
    setupCanvas("peek-canvas");

    // びーずのカチカチ音
    chamber.onClack = (size, strength) => {
      if (S.screen === "peek" || (S.screen === "workshop" && S.step === 1)) {
        KKM.Sound.clack(size, 0.25 + strength * 0.6);
      }
    };

    KKM.UI.init(chamber);

    // 前回のレシピ or はじめてのおためしセット
    if (!KKM.UI.loadRecipe()) {
      for (const [mat, scoops] of KKM.STARTER) {
        for (let i = 0; i < scoops; i++) chamber.addScoop(mat, 0);
      }
      // 最初は落ち着いた状態から
      for (let i = 0; i < 90; i++) {
        chamber.step(1 / 60, { x: 0, y: KKM.PHYSICS.GRAVITY }, 0, 0);
      }
    }

    // ときどきレシピを保存
    setInterval(KKM.UI.saveRecipe, 2500);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { S.dirty = true; KKM.UI.saveRecipe(); }
    });

    window.addEventListener("resize", () => { /* 各 draw が rect を見て追従 */ });

    // ダブルタップズームなどをふせぐ
    document.addEventListener("gesturestart", e => e.preventDefault());
    document.addEventListener("dblclick", e => e.preventDefault());

    requestAnimationFrame(frame);
  }

  window.KKM_onScreenChange = () => { lastT = 0; };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
