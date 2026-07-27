/* ═══════════════════════════════════════════════════════════
   main.js — 起動・リサイズ・メインループ（ワンワールド）
   ═══════════════════════════════════════════════════════════ */
"use strict";

(() => {
  const S = KKM.state;
  const DPR_CAP = 2;

  const chamber = new KKM.Chamber();
  const kaleido = new KKM.Kaleido();
  window.KKM_kaleido = kaleido;

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

  function contentRot() {
    return Math.PI / 2 - chamber.focusAngle();
  }

  function chamberOpts() {
    const opts = { light: S.light };
    if (S.light === "yoko") {
      const rot = contentRot();
      const sx = -0.72, sy = -0.7;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      opts.lightDir = {
        x: sx * cos + sy * sin,
        y: -sx * sin + sy * cos,
      };
    }
    return opts;
  }
  window.KKM_chamberOpts = chamberOpts;

  function sectorOpts(quality) {
    return {
      mirrors: S.mirrors,
      skew: S.skew01 * KKM.SKEW_MAX,
      tubeAngle: contentRot(),
      skin: S.skin,
      hole: S.hole,
      lens: S.lens,
      quality,
      time: chamber.time,
      // しゃしんのステンドグラス中は、くさびの頂点を写真の中心近くへ。
      // 中心の被写体（顔など）がセクターに映り、回すと周辺がパンする
      apexFrac: chamber.photoLayer ? 0.15 : 0.42,
    };
  }

  /* ── タイトル ── */
  function drawTitle() {
    const e = resizeCanvas(canvases["title-canvas"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = w / 2, cy = h * 0.46;
    const viewR = Math.hypot(w, h) * 0.5 + 8;
    ctx.fillStyle = "#17102a";
    ctx.fillRect(0, 0, w, h);
    kaleido.renderChamber(chamber, Math.min(420, viewR | 0), S.titleAngle, chamberOpts());
    kaleido.draw(ctx, cx, cy, viewR, { ...sectorOpts(0.5), hole: "maru", lens: "futsu" });
    let veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    veil.addColorStop(0, "rgba(23, 16, 42, .58)");
    veil.addColorStop(0.6, "rgba(23, 16, 42, .42)");
    veil.addColorStop(1, "rgba(12, 8, 24, .78)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }

  /* ── せかい（全画面万華鏡） ── */
  function drawWorld() {
    const e = resizeCanvas(canvases["peek-canvas"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dockOpen = KKM.UI.dockInfo().open;
    const landscape = w > h;
    // ドックが開いているときは、円をドックの反対側へ少し寄せる
    const cx = dockOpen && landscape ? w * 0.40 : w / 2;
    const cy = dockOpen && !landscape ? h * 0.40 : h / 2;
    const viewR = Math.min(w, h) / 2 * (dockOpen ? 0.85 : 0.94);
    kaleido.drawSurround(ctx, w, h, cx, cy, viewR, contentRot(), S.hole);
    const chPix = Math.min(560, Math.max(220, viewR | 0));
    const cOpts = chamberOpts();
    // 写真ダイレクト層：原寸写真にひかりを焼き込み、セクターが直接サンプリング
    const photoSrc = kaleido.preparePhoto(chamber, S.light, cOpts.lightDir, chamber.time);
    kaleido.renderChamber(chamber, chPix, S.tubeAngle, { ...cOpts, photoDirect: !!photoSrc });
    kaleido.draw(ctx, cx, cy, viewR, {
      ...sectorOpts(1),
      photo: photoSrc ? { canvas: photoSrc, zoom: S.photoZoom } : null,
    });
  }

  /* ── ドックの「なかみのまど」（生のなかみ） ── */
  function drawChamberWindow() {
    const info = KKM.UI.dockInfo();
    if (!info.open || info.cat !== "fill") return;
    const e = resizeCanvas(canvases["chamber-view"]);
    const { ctx, w, h } = e;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const viewR = Math.min(w, h) / 2;
    const pixR = viewR / 1.18;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, viewR, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    chamber.draw(ctx, pixR, S.tubeAngle, { margin: 1.18, ...chamberOpts() });
    const shine = ctx.createLinearGradient(-viewR, -viewR, viewR * 0.4, viewR * 0.6);
    shine.addColorStop(0, "rgba(255,255,255,.3)");
    shine.addColorStop(0.3, "rgba(255,255,255,.04)");
    shine.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(-viewR, -viewR, viewR * 2, viewR * 2);
    ctx.restore();
  }

  /* ── メインループ ── */
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) { lastT = t; return; }
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.1) dt = 0.1;

    S.titleAngle += dt * 0.11;
    if (S.screen === "peek" && !S.dragging) {
      S.tubeAngle += S.tubeOmega * dt;
      S.tubeOmega *= Math.exp(-dt * 1.5);
      if (Math.abs(S.tubeOmega) < 0.004) S.tubeOmega = 0;
    }

    const G = KKM.PHYSICS.GRAVITY;
    let gx = 0, gy = G;
    if (S.screen === "peek" && S.tilt.active) {
      const mag = Math.max(0.25, Math.hypot(S.tilt.x, S.tilt.y));
      gx = S.tilt.x * G;
      gy = S.tilt.y * G;
      if (mag < 0.18) { gx *= 0.4; gy *= 0.4; }
    }

    const angleForPhysics = S.screen === "peek" ? S.tubeAngle : S.titleAngle;
    const omegaForPhysics = S.screen === "peek" ? S.tubeOmega : 0.11;
    chamber.step(dt, { x: gx, y: gy }, angleForPhysics, omegaForPhysics);

    if (S.screen === "title") {
      drawTitle();
    } else {
      drawWorld();
      drawChamberWindow();
      KKM.UI.renderCatalog();
      updateGauge();
      if (chamber._sparkles.length > 0) {
        sparkleGlow += dt;
        if (sparkleGlow > 0.4) { KKM.Sound.shimmer(); sparkleGlow = 0; }
      }
    }
  }

  function updateGauge() {
    const bar = document.getElementById("fill-gauge-bar");
    if (!bar) return;
    bar.style.width = (chamber.fillRatio() * 100).toFixed(0) + "%";
  }

  /* ── 起動 ── */
  function boot() {
    setupCanvas("title-canvas");
    setupCanvas("chamber-view");
    setupCanvas("peek-canvas");

    chamber.onClack = (size, strength) => {
      if (S.screen === "peek") {
        KKM.Sound.clack(size, 0.25 + strength * 0.6);
      }
    };

    KKM.UI.init(chamber);
    KKM.Paint.init(chamber);
    KKM.Photo.init(chamber);

    if (!KKM.UI.loadRecipe()) {
      for (const [mat, scoops] of KKM.STARTER) {
        for (let i = 0; i < scoops; i++) chamber.addScoop(mat, 0);
      }
      for (let i = 0; i < 90; i++) {
        chamber.step(1 / 60, { x: 0, y: KKM.PHYSICS.GRAVITY }, 0, 0);
      }
    }

    setInterval(KKM.UI.saveRecipe, 2500);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { S.dirty = true; KKM.UI.saveRecipe(); }
    });

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
