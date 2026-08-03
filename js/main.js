// ============================================================
// みずみちラボ - 起動・メインループ
// ============================================================
"use strict";

(function () {
  let lastT = 0;
  let running = false;

  function drawTitleArt() {
    const cv = document.getElementById("titleArt");
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    // にじ
    const colors = ["#ffb3c1", "#ffd6a5", "#fdffb6", "#caffbf", "#a0e7f5", "#bdb2ff"];
    colors.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.62, W * 0.34 - i * 15, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    });

    // おおきなしずくキャラ
    const cx = W / 2, cy = H * 0.47, r = W * 0.13;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.5, r * 0.1, cx, cy, r * 1.6);
    g.addColorStop(0, "#aee6f8"); g.addColorStop(1, "#4db4de");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.6);
    ctx.bezierCurveTo(cx + r * 1.25, cy - r * 0.2, cx + r * 1.05, cy + r * 0.7, cx, cy + r * 0.9);
    ctx.bezierCurveTo(cx - r * 1.05, cy + r * 0.7, cx - r * 1.25, cy - r * 0.2, cx, cy - r * 1.6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy - r * 0.5, r * 0.15, r * 0.26, -0.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#2b5a78";
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy, r * 0.1, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.3, cy, r * 0.1, 0, 7); ctx.fill();
    ctx.strokeStyle = "#2b5a78"; ctx.lineWidth = r * 0.08; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.18, r * 0.24, 0.3, Math.PI - 0.3); ctx.stroke();
    ctx.fillStyle = "rgba(255,150,180,.5)";
    ctx.beginPath(); ctx.ellipse(cx - r * 0.55, cy + r * 0.2, r * 0.13, r * 0.09, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + r * 0.55, cy + r * 0.2, r * 0.13, r * 0.09, 0, 0, 7); ctx.fill();

    // なみなみ
    ctx.strokeStyle = "#5fc3e6";
    ctx.lineWidth = 10; ctx.lineCap = "round";
    for (let row = 0; row < 2; row++) {
      ctx.beginPath();
      for (let x = W * 0.2; x <= W * 0.8; x += 4) {
        const y = H * (0.78 + row * 0.06) + Math.sin(x * 0.05 + row * 2) * 8;
        if (x === W * 0.2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = 1 - row * 0.45;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // タイトルもじ
    ctx.fillStyle = "#3b7ea1";
    ctx.font = "bold 64px 'Hiragino Maru Gothic ProN', 'M PLUS Rounded 1c', sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 14; ctx.lineJoin = "round";
    ctx.strokeText("みずみち ラボ", W / 2, H * 0.11);
    ctx.fillText("みずみち ラボ", W / 2, H * 0.11);
  }

  function paintButtons() {
    Icons.paint(document.querySelector("#modeFree canvas"), "modeFree");
    Icons.paint(document.querySelector("#modeQuest canvas"), "modeQuest");
    Icons.paint(document.querySelector("#modeCompare canvas"), "modeCompare");
    Icons.paint(document.querySelector("#btnUndo canvas"), "undo");
    Icons.paint(document.querySelector("#btnReset canvas"), "reset");
    Icons.paint(document.querySelector("#btnGo canvas"), "go");
    Icons.paint(document.querySelector("#btnPlay canvas"), "play");
    Icons.paint(document.querySelector("#btnSnap canvas"), "snap");
    Icons.paint(document.querySelector("#btnSnapClear canvas"), "snapClear");
    document.querySelectorAll("#toolbar .tool").forEach(b => {
      Icons.paint(b.querySelector("canvas"), b.dataset.tool);
    });
    document.querySelectorAll("#subPalette .subBtn").forEach(b => {
      Icons.paint(b.querySelector("canvas"), b.dataset.kind);
    });
  }

  // ゲーム開始から少し後に、#toolbar が横スクロール可能なとき(はみ出るボタンが
  // あるとき)だけ、そっと右へ~60pxなめらかにスクロールして戻す「ちら見せ」演出。
  // ユーザーがすでに toolbar を操作していたら即中断する。iPad 等スクロール不要な
  // 画面では scrollWidth <= clientWidth なので何も起きない。
  function peekToolbar() {
    const el = document.getElementById("toolbar");
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 1) return; // スクロール不要 = 何もしない

    const dist = Math.min(60, el.scrollWidth - el.clientWidth);
    if (dist <= 0) return;

    const ac = new AbortController();
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const opts = { once: true, passive: true, signal: ac.signal };
    el.addEventListener("pointerdown", cancel, opts);
    el.addEventListener("wheel", cancel, opts);
    el.addEventListener("touchstart", cancel, opts);

    const startLeft = el.scrollLeft;
    const dur = 1000; // ms (往復で約1秒)
    const start = performance.now();

    // easeInOutSine: なめらかな加減速
    const ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

    function frame(now) {
      if (cancelled) { ac.abort(); return; }
      const t = Math.min(1, (now - start) / dur);
      // 0->0.5 で右へ、0.5->1 で元へ戻る三角波(イージング付き)
      const phase = t < 0.5 ? ease(t / 0.5) : ease(1 - (t - 0.5) / 0.5);
      el.scrollLeft = startLeft + dist * phase;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        ac.abort();
      }
    }
    requestAnimationFrame(frame);
  }

  function wireUI() {
    document.querySelectorAll("#toolbar .tool").forEach(b => {
      b.addEventListener("pointerdown", () => Input.setTool(b.dataset.tool));
    });
    document.querySelectorAll("#subPalette .subBtn").forEach(b => {
      b.addEventListener("pointerdown", () => {
        Input.buildingKind = b.dataset.kind;
        document.querySelectorAll("#subPalette .subBtn").forEach(x => x.classList.toggle("active", x === b));
        Sound.tap();
      });
    });
    document.querySelector('#subPalette .subBtn[data-kind="house"]').classList.add("active");

    document.getElementById("modeFree").addEventListener("pointerdown", () => Modes.switchTo("free"));
    document.getElementById("modeQuest").addEventListener("pointerdown", () => Modes.switchTo("quest"));
    document.getElementById("modeCompare").addEventListener("pointerdown", () => Modes.switchTo("compare"));

    document.getElementById("btnUndo").addEventListener("pointerdown", () => {
      if (popUndo()) { Sound.undo(); Mascot.react("wow"); }
      else Sound.tap();
    });
    document.getElementById("btnReset").addEventListener("pointerdown", () => {
      pushUndo();
      genMap(World.variant);
      waterInit();
      Modes.compareMask = null;
      Modes.updateHud();
      Sound.poof();
      Sound.speak("さいしょから やりなおすね");
    });
    document.getElementById("btnGo").addEventListener("pointerdown", () => Modes.pressGo());
    document.getElementById("btnSnap").addEventListener("pointerdown", () => Modes.snapCompare());
    document.getElementById("btnSnapClear").addEventListener("pointerdown", () => Modes.clearCompare());

    document.getElementById("btnPlay").addEventListener("pointerdown", () => {
      Sound.unlock();
      Sound.chimeSuccess();
      Sound.speak("みずみちラボへ ようこそ! すきなところに みずを ながしてみてね");
      document.getElementById("title").classList.add("fadeout");
      Mascot.react("happy");
      setTimeout(peekToolbar, 1000);
    });

    window.addEventListener("resize", () => Render.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => Render.resize(), 250));
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;

    Input.step(dt);
    waterStep(dt, now);
    Modes.stepQuest(dt);
    Particles.step();
    Mascot.step(dt);

    Render.draw(now);
    Mascot.draw(now);

    requestAnimationFrame(loop);
  }

  function boot() {
    // Render.init が Iso.fitView で Render.view を確定し、genMap はそれを読むため
    // Render.init → genMap → waterInit の順で呼ぶ(FULLSCREEN_SPEC §5)。
    Render.init(document.getElementById("game"));
    genMap("free");
    waterInit();
    Mascot.init(document.getElementById("mascot"));
    Input.init(document.getElementById("game"));
    drawTitleArt();
    paintButtons();
    wireUI();
    Modes.updateHud();
    if (!running) {
      running = true;
      requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
