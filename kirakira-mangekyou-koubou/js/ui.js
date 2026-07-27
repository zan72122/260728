/* ═══════════════════════════════════════════════════════════
   ui.js — 画面遷移・こうぼうの操作・のぞき画面の入力
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.state = {
  screen: "title",       // title | workshop | peek
  step: 0,               // 0: かがみ / 1: なかみ
  mirrors: 3,
  skew01: 0,             // -1 .. 1
  tubeAngle: 0,
  tubeOmega: 0,
  titleAngle: 0,
  dragging: false,
  tilt: { x: 0, y: 1, active: false },
  needMotionPermission: false,
  coachDone: false,
  dirty: false,          // レシピ保存待ち
};

KKM.UI = (() => {
  const S = KKM.state;
  const $ = id => document.getElementById(id);
  const Sound = KKM.Sound;

  let chamber, els = {};
  let holdTimer = null;
  let lastShake = 0;

  function init(ch) {
    chamber = ch;
    els = {
      title: $("screen-title"),
      workshop: $("screen-workshop"),
      peek: $("screen-peek"),
      stepMirror: $("step-mirror"),
      stepFill: $("step-fill"),
      stepTitle: $("ws-step-title"),
      dots: document.querySelectorAll(".ws-dots .dot"),
      btnNext: $("btn-next"),
      btnPrev: $("btn-prev"),
      btnPeek: $("btn-peek"),
      gauge: $("fill-gauge-bar"),
      fullBubble: $("full-bubble"),
      pourLayer: $("pour-layer"),
      skewSlider: $("skew-slider"),
      skewValue: $("skew-value"),
      water: $("btn-water"),
      trayWater: $("tray-water"),
      tray: $("peek-tray"),
      btnTray: $("btn-tray"),
      trayMirrorN: $("tray-mirror-n"),
      coach: $("coach"),
      btnTilt: $("btn-tilt"),
      peekCanvas: $("peek-canvas"),
      photoModal: $("photo-modal"),
      photoImg: $("photo-img"),
      photoSave: $("photo-save"),
      flash: $("photo-flash"),
    };

    bindTitle();
    bindWorkshop();
    bindPeek();
    bindTiltSensors();

    try { S.coachDone = localStorage.getItem(KKM.COACH_KEY) === "1"; } catch (e) {}
  }

  /* ── 画面遷移 ─────────────────────────────── */

  function showScreen(name) {
    for (const key of ["title", "workshop", "peek"]) {
      const el = els[key];
      if (key === name) {
        el.classList.add("visible");
      } else {
        el.classList.remove("visible");
      }
    }
    S.screen = name;
    Sound.duckMusic(name === "peek");
    if (window.KKM_onScreenChange) window.KKM_onScreenChange(name);
  }

  /* ── タイトル ─────────────────────────────── */

  function bindTitle() {
    $("btn-start").addEventListener("click", () => {
      Sound.ensure();
      Sound.startMusic();
      Sound.uiSelect();
      showScreen("workshop");
      setStep(0);
    });
    // 画面のどこを押しても始まる（4さい向け）
    els.title.addEventListener("pointerdown", e => {
      if (e.target.closest("#btn-start")) return;
      Sound.ensure();
    });
  }

  /* ── こうぼう ─────────────────────────────── */

  function setStep(n, backwards = false) {
    S.step = n;
    els.stepMirror.classList.toggle("hidden", n !== 0);
    els.stepFill.classList.toggle("hidden", n !== 1);
    const active = n === 0 ? els.stepMirror : els.stepFill;
    active.classList.toggle("slide-back", backwards);
    els.stepTitle.textContent = n === 0 ? "かがみを えらぼう" : "なかみを いれよう";
    els.dots.forEach((d, i) => d.classList.toggle("active", i === n));
    els.btnPrev.classList.toggle("hidden", n === 0);
    els.btnNext.classList.toggle("hidden", n === 1);
    els.btnPeek.classList.toggle("hidden", n === 0);
  }

  function bindWorkshop() {
    $("btn-home").addEventListener("click", () => { Sound.uiTap(); showScreen("title"); });
    $("btn-sound").addEventListener("click", () => Sound.setMuted(!Sound.isMuted()));
    $("btn-sound2").addEventListener("click", () => Sound.setMuted(!Sound.isMuted()));

    els.btnNext.addEventListener("click", () => { Sound.uiSelect(); setStep(1); });
    els.btnPrev.addEventListener("click", () => { Sound.uiTap(); setStep(0, true); });
    els.btnPeek.addEventListener("click", enterPeek);

    // かがみカード
    document.querySelectorAll("#mirror-cards .mirror-card").forEach(card => {
      card.addEventListener("click", () => {
        const m = +card.dataset.mirrors;
        if (m === S.mirrors) return;
        S.mirrors = m;
        document.querySelectorAll("#mirror-cards .mirror-card")
          .forEach(c => c.classList.toggle("selected", +c.dataset.mirrors === m));
        els.trayMirrorN.textContent = m;
        Sound.uiSelect();
        markDirty();
      });
    });

    // ずらしスライダー
    els.skewSlider.addEventListener("input", () => {
      S.skew01 = els.skewSlider.value / 100;
      updateSkewLabel();
      markDirty();
    });
    updateSkewLabel();

    // びん（タップ＆ながおし）
    document.querySelectorAll("#shelf .jar").forEach(jar => {
      const material = jar.dataset.material;
      jar.addEventListener("pointerdown", e => {
        e.preventDefault();
        pour(material, jar);
        clearInterval(holdTimer);
        holdTimer = setInterval(() => pour(material, jar), 520);
      });
      const stop = () => clearInterval(holdTimer);
      jar.addEventListener("pointerup", stop);
      jar.addEventListener("pointercancel", stop);
      jar.addEventListener("pointerleave", stop);
    });

    // おみず
    els.water.addEventListener("click", () => toggleWater());

    // からっぽ
    $("btn-empty").addEventListener("click", () => {
      const n = chamber.empty();
      if (n > 0) { Sound.popSeq(n); markDirty(); }
    });
  }

  function updateSkewLabel() {
    const v = Math.abs(S.skew01);
    els.skewValue.textContent =
      v < 0.06 ? "まっすぐ" :
      v < 0.38 ? "ほんのすこし" :
      v < 0.72 ? "ちょっと ずれた" : "ぐにゃぐにゃ！";
  }

  function toggleWater() {
    const on = !chamber.liquid;
    chamber.setLiquid(on);
    els.water.classList.toggle("on", on);
    els.trayWater.classList.toggle("on", on);
    Sound.pour("water");
    markDirty();
  }

  /* びんから注ぐ（落下アニメーション → 実際に粒が降ってくる） */
  function pour(material, jarEl) {
    if (chamber.isFull()) {
      showFullBubble();
      return;
    }
    Sound.pour(material);
    if (jarEl) {
      jarEl.classList.remove("pouring");
      void jarEl.offsetWidth;   // アニメーション再始動
      jarEl.classList.add("pouring");
      spawnPourDrops(material, jarEl);
    }
    setTimeout(() => {
      const added = chamber.addScoop(material, 0);
      if (added > 0) markDirty();
    }, jarEl ? 240 : 0);
  }

  function showFullBubble() {
    els.fullBubble.classList.remove("hidden");
    clearTimeout(showFullBubble._t);
    showFullBubble._t = setTimeout(() => els.fullBubble.classList.add("hidden"), 1400);
    Sound.uiTap();
  }

  const DROP_STYLE = {
    beads: i => {
      const cols = KKM.MATERIALS.beads.colors;
      const c = cols[i % cols.length];
      return { size: 11 + Math.random() * 6, css: { background: `radial-gradient(circle at 32% 30%, ${c[0]}, ${c[1]} 60%, ${c[2]})`, borderRadius: "50%" } };
    },
    glitter: i => {
      const cols = KKM.MATERIALS.glitter.colors;
      const c = cols[i % cols.length];
      return { size: 5 + Math.random() * 3, css: { background: c[1], borderRadius: "2px", boxShadow: `0 0 6px ${c[0]}` } };
    },
    petals: i => {
      const cols = KKM.MATERIALS.petals.colors;
      const c = cols[i % cols.length];
      return { size: 13 + Math.random() * 6, css: { background: c[1], borderRadius: "60% 40% 60% 40% / 50% 60% 40% 60%" } };
    },
    stars: i => {
      const cols = KKM.MATERIALS.stars.colors;
      const c = cols[i % cols.length];
      return { size: 12 + Math.random() * 5, css: { background: c[1], clipPath: "polygon(50% 0%, 63% 34%, 98% 36%, 70% 58%, 80% 92%, 50% 72%, 20% 92%, 30% 58%, 2% 36%, 37% 34%)" } };
    },
  };

  function spawnPourDrops(material, jarEl) {
    const layer = els.pourLayer;
    const layerRect = layer.getBoundingClientRect();
    const jarRect = jarEl.getBoundingClientRect();
    const ringRect = layer.parentElement.getBoundingClientRect();
    const sx = jarRect.left + jarRect.width / 2 - layerRect.left;
    const sy = jarRect.top + jarRect.height * 0.2 - layerRect.top;
    const exBase = ringRect.left + ringRect.width / 2 - layerRect.left;
    const ey = ringRect.top + ringRect.height * 0.16 - layerRect.top;
    const n = material === "glitter" ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const spec = DROP_STYLE[material](i + ((Math.random() * 6) | 0));
      const d = document.createElement("i");
      d.className = "pour-drop";
      Object.assign(d.style, spec.css, {
        width: spec.size + "px", height: spec.size + "px",
        left: "0px", top: "0px",
      });
      layer.appendChild(d);
      const ex = exBase + (Math.random() - 0.5) * ringRect.width * 0.3;
      const mx = (sx + ex) / 2, my = Math.min(sy, ey) - 36 - Math.random() * 30;
      const anim = d.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${ex}px, ${ey}px) scale(.85)`, opacity: 1 },
      ], { duration: 330 + Math.random() * 160, delay: i * 34, easing: "ease-in", fill: "backwards" });
      anim.onfinish = () => d.remove();
    }
  }

  /* ── のぞき ─────────────────────────────── */

  function enterPeek() {
    if (chamber.particles.length === 0) {
      // 何も入っていなければ、まずひとすくい入れてあげる
      chamber.addScoop("beads", 0);
      chamber.addScoop("glitter", 0);
    }
    Sound.reveal();
    S.tubeAngle = 0;
    S.tubeOmega = 0.35;      // ほんの少し回っていて、絵が生きて見える
    showScreen("peek");
    // かたむきボタン（iOS は許可が必要）
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function" && !S.tilt.active) {
      els.btnTilt.classList.remove("hidden");
    }
    if (!S.coachDone) {
      els.coach.classList.remove("hidden");
      els.coach.classList.remove("fade-out");
    }
  }

  function dismissCoach() {
    if (els.coach.classList.contains("hidden")) return;
    els.coach.classList.add("fade-out");
    setTimeout(() => els.coach.classList.add("hidden"), 520);
    S.coachDone = true;
    try { localStorage.setItem(KKM.COACH_KEY, "1"); } catch (e) {}
  }

  function bindPeek() {
    $("btn-back-workshop").addEventListener("click", () => {
      Sound.uiTap();
      S.tubeAngle = 0; S.tubeOmega = 0;
      showScreen("workshop");
      setStep(1, true);
    });

    // ドラッグで回す
    const cv = els.peekCanvas;
    let lastA = 0, lastT = 0, activeId = null;
    const center = () => ({ x: cv.clientWidth / 2, y: cv.clientHeight / 2 });

    cv.addEventListener("pointerdown", e => {
      const c = center();
      activeId = e.pointerId;
      cv.setPointerCapture(e.pointerId);
      lastA = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      lastT = performance.now();
      S.dragging = true;
      S.tubeOmega = 0;
      dismissCoach();
      Sound.ensure();
    });
    cv.addEventListener("pointermove", e => {
      if (!S.dragging || e.pointerId !== activeId) return;
      const c = center();
      const dx = e.clientX - c.x, dy = e.clientY - c.y;
      if (Math.hypot(dx, dy) < 24) return;
      const a = Math.atan2(dy, dx);
      let da = a - lastA;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const now = performance.now();
      const dt = Math.max(8, now - lastT) / 1000;
      S.tubeAngle += da;
      const om = S.tubeOmega * 0.65 + (da / dt) * 0.35;
      S.tubeOmega = Math.max(-11, Math.min(11, om));
      lastA = a; lastT = now;
    });
    const release = e => {
      if (e.pointerId !== activeId) return;
      S.dragging = false;
      activeId = null;
    };
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);

    // どうぐトレイ
    els.btnTray.addEventListener("click", () => {
      const open = els.tray.classList.toggle("hidden");
      els.btnTray.classList.toggle("open", !open);
      Sound.uiTap();
    });
    document.querySelectorAll(".peek-tray .tray-jar[data-material]").forEach(b => {
      b.addEventListener("click", () => {
        const mat = b.dataset.material;
        if (chamber.isFull()) { Sound.uiTap(); return; }
        Sound.pour(mat);
        chamber.addScoop(mat, S.tubeAngle);
        markDirty();
      });
    });
    els.trayWater.addEventListener("click", () => toggleWater());
    $("tray-mirror").addEventListener("click", () => {
      S.mirrors = S.mirrors >= 4 ? 2 : S.mirrors + 1;
      els.trayMirrorN.textContent = S.mirrors;
      document.querySelectorAll("#mirror-cards .mirror-card")
        .forEach(c => c.classList.toggle("selected", +c.dataset.mirrors === S.mirrors));
      Sound.uiSelect();
      markDirty();
    });

    // かたむき許可
    els.btnTilt.addEventListener("click", requestMotionPermission);

    // しゃしん
    $("btn-photo").addEventListener("click", takePhoto);
    $("photo-close").addEventListener("click", () => {
      els.photoModal.classList.add("hidden");
      Sound.uiTap();
    });
  }

  /* ── かたむき・シェイク ─────────────────────── */

  function bindTiltSensors() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission !== "function") {
      // Android などは許可なしで聞ける
      window.addEventListener("deviceorientation", onOrient);
    }
    const M = window.DeviceMotionEvent;
    if (M && typeof M.requestPermission !== "function") {
      window.addEventListener("devicemotion", onMotion);
    }
  }

  function requestMotionPermission() {
    Sound.uiTap();
    const D = window.DeviceOrientationEvent;
    const M = window.DeviceMotionEvent;
    const asks = [];
    if (D && typeof D.requestPermission === "function") asks.push(D.requestPermission());
    if (M && typeof M.requestPermission === "function") asks.push(M.requestPermission());
    Promise.allSettled(asks).then(results => {
      if (results.some(r => r.status === "fulfilled" && r.value === "granted")) {
        window.addEventListener("deviceorientation", onOrient);
        window.addEventListener("devicemotion", onMotion);
        els.btnTilt.classList.add("hidden");
        Sound.uiSelect();
      }
    });
  }

  function onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    const beta = e.beta * Math.PI / 180;    // 前後
    const gamma = e.gamma * Math.PI / 180;  // 左右
    // 端末座標 → 画面座標（画面の回転を打ち消す）
    let gx = Math.sin(gamma);
    let gy = Math.sin(beta);
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const ra = -angle * Math.PI / 180;
    const cos = Math.cos(ra), sin = Math.sin(ra);
    const px = gx * cos - gy * sin;
    const py = gx * sin + gy * cos;
    const gain = KKM.PHYSICS.TILT_GAIN;
    S.tilt.x = Math.max(-1, Math.min(1, px * gain));
    S.tilt.y = Math.max(-1, Math.min(1, py * gain));
    S.tilt.active = true;
  }

  function onMotion(e) {
    const a = e.acceleration;
    if (!a || a.x === null) return;
    const mag = Math.hypot(a.x, a.y, a.z || 0);
    const now = performance.now();
    if (mag > 16 && now - lastShake > 700) {
      lastShake = now;
      chamber.shake(Math.min(1.6, mag / 18));
      Sound.pour(chamber.liquid ? "water" : "beads");
    }
  }

  /* ── しゃしん ─────────────────────────────── */

  function takePhoto() {
    Sound.shutter();
    els.flash.classList.remove("flashing");
    void els.flash.offsetWidth;
    els.flash.classList.add("flashing");

    const size = 1080;
    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    const g = out.getContext("2d");
    // 背景
    const bgGrad = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.75);
    bgGrad.addColorStop(0, "#241536");
    bgGrad.addColorStop(1, "#0b0612");
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, size, size);
    // 万華鏡を大きく
    const photoKal = window.KKM_kaleido;
    if (photoKal) {
      photoKal.renderChamber(chamber, 520, S.tubeAngle);
      photoKal.draw(g, size / 2, size / 2 - 20, size * 0.42, {
        sectorAngle: KKM.MIRROR_SECTOR[S.mirrors],
        skew: S.skew01 * KKM.SKEW_MAX,
        tubeAngle: Math.PI / 2 - chamber.focusAngle(),
        quality: 1,
      });
    }
    // キャプション
    g.fillStyle = "#ffd166";
    g.font = "700 44px 'Hiragino Maru Gothic ProN', sans-serif";
    g.textAlign = "center";
    g.fillText("✦ きらきら まんげきょう ✦", size / 2, size - 64);

    const url = out.toDataURL("image/png");
    els.photoImg.src = url;
    els.photoSave.href = url;
    setTimeout(() => {
      els.photoModal.classList.remove("hidden");
      Sound.tada();
    }, 420);
  }

  /* ── 保存 ─────────────────────────────── */

  function markDirty() { S.dirty = true; }

  function saveRecipe() {
    if (!S.dirty) return;
    S.dirty = false;
    try {
      localStorage.setItem(KKM.SAVE_KEY, JSON.stringify({
        mirrors: S.mirrors,
        skew01: S.skew01,
        chamber: chamber.serialize(),
      }));
    } catch (e) {}
  }

  function loadRecipe() {
    try {
      const raw = localStorage.getItem(KKM.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.mirrors) {
        S.mirrors = data.mirrors;
        document.querySelectorAll("#mirror-cards .mirror-card")
          .forEach(c => c.classList.toggle("selected", +c.dataset.mirrors === S.mirrors));
        els.trayMirrorN.textContent = S.mirrors;
      }
      if (typeof data.skew01 === "number") {
        S.skew01 = data.skew01;
        els.skewSlider.value = Math.round(S.skew01 * 100);
        updateSkewLabel();
      }
      const ok = chamber.restore(data.chamber);
      els.water.classList.toggle("on", chamber.liquid);
      els.trayWater.classList.toggle("on", chamber.liquid);
      return ok;
    } catch (e) { return false; }
  }

  return { init, showScreen, setStep, saveRecipe, loadRecipe, showFullBubble };
})();
