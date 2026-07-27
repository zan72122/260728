/* ═══════════════════════════════════════════════════════════
   ui.js — 組み立て台・画面遷移・のぞき画面の入力
   部品カードは config の定義から自動生成する
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.state = {
  screen: "title",       // title | workshop | peek
  tube: "round",
  mirrors: "3",          // "2" | "3" | "4" | "p"
  skew01: 0,
  skin: "pika",
  light: "asa",
  hole: "maru",
  lens: "futsu",
  tubeAngle: 0,
  tubeOmega: 0,
  titleAngle: 0,
  dragging: false,
  tilt: { x: 0, y: 1, active: false },
  coachDone: false,
  dirty: false,
};

KKM.UI = (() => {
  const S = KKM.state;
  const $ = id => document.getElementById(id);
  const Sound = KKM.Sound;

  let chamber, els = {};
  let holdTimer = null;
  let lastShake = 0;
  const guide = { active: false, idx: 0 };

  /* ── かがみのまい数アイコン（インラインSVG） ── */
  function mirrorIconSVG(m) {
    const rect = (tf) =>
      `<rect x="31" y="8" width="10" height="30" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2"${tf ? ` transform="${tf}"` : ""}/>`;
    switch (m) {
      case "2":
        return `<svg viewBox="0 0 72 72">
          <rect x="20" y="12" width="10" height="48" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2" transform="rotate(14 25 36)"/>
          <rect x="42" y="12" width="10" height="48" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2" transform="rotate(-14 47 36)"/></svg>`;
      case "3":
        return `<svg viewBox="0 0 72 72"><g>
          ${rect("")}${rect("rotate(120 36 40)")}${rect("rotate(-120 36 40)")}</g></svg>`;
      case "4":
        return `<svg viewBox="0 0 72 72"><g>
          <rect x="31" y="6" width="10" height="26" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2"/>
          <rect x="31" y="6" width="10" height="26" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2" transform="rotate(90 36 36)"/>
          <rect x="31" y="6" width="10" height="26" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2" transform="rotate(180 36 36)"/>
          <rect x="31" y="6" width="10" height="26" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2" transform="rotate(270 36 36)"/></svg>`;
      default: // "p" 平行鏡
        return `<svg viewBox="0 0 72 72">
          <rect x="14" y="8" width="10" height="56" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2"/>
          <rect x="48" y="8" width="10" height="56" rx="3" fill="#bfe3f2" stroke="#6aaacc" stroke-width="2"/>
          <circle cx="36" cy="36" r="6" fill="#ffd166"/>
          <circle cx="36" cy="20" r="4" fill="#ffd166" opacity=".55"/>
          <circle cx="36" cy="52" r="4" fill="#ffd166" opacity=".55"/>
          <circle cx="36" cy="10" r="2.6" fill="#ffd166" opacity=".3"/>
          <circle cx="36" cy="62" r="2.6" fill="#ffd166" opacity=".3"/></svg>`;
    }
  }

  /* ── 部品カードの生成 ── */
  function makeCard(cat, val, def, iconHTML) {
    const b = document.createElement("button");
    b.className = "part-card";
    b.dataset.cat = cat;
    b.dataset.val = val;
    b.innerHTML =
      `<i class="pc-icon ${iconHTML ? "" : `pci-${cat}-${val}`}">${iconHTML || ""}</i>` +
      `<span class="pc-name">${def.label}</span>` +
      `<span class="pc-desc">${def.desc}</span>`;
    b.addEventListener("click", () => selectPart(cat, val));
    return b;
  }

  function buildCards() {
    const rows = {
      tube: $("cards-tube"), mirror: $("cards-mirror"), skin: $("cards-skin"),
      light: $("cards-light"), hole: $("cards-hole"), lens: $("cards-lens"),
    };
    for (const [val, def] of Object.entries(KKM.TUBES)) rows.tube.appendChild(makeCard("tube", val, def));
    for (const val of KKM.MIRROR_ORDER) rows.mirror.appendChild(makeCard("mirror", val, KKM.MIRRORS[val], mirrorIconSVG(val)));
    for (const val of KKM.SKIN_ORDER) rows.skin.appendChild(makeCard("skin", val, KKM.SKINS[val]));
    for (const val of KKM.LIGHT_ORDER) rows.light.appendChild(makeCard("light", val, KKM.LIGHTS[val]));
    for (const [val, def] of Object.entries(KKM.HOLES)) rows.hole.appendChild(makeCard("hole", val, def));
    for (const [val, def] of Object.entries(KKM.LENSES)) rows.lens.appendChild(makeCard("lens", val, def));
  }

  const CAT_KEY = { tube: "tube", mirror: "mirrors", skin: "skin", light: "light", hole: "hole", lens: "lens" };

  function selectPart(cat, val, silent) {
    const key = CAT_KEY[cat];
    if (S[key] === val) { if (!silent) Sound.uiTap(); return; }
    S[key] = val;
    if (cat === "tube") chamber.setTube(val);
    refreshSelection(cat);
    if (!silent) {
      Sound.snap();
      markDirty();
      guideAdvance(cat === "lens" ? "hole" : cat);
    }
  }

  function refreshSelection(cat) {
    const key = CAT_KEY[cat];
    document.querySelectorAll(`.part-card[data-cat="${cat}"]`)
      .forEach(c => c.classList.toggle("selected", c.dataset.val === S[key]));
    updateSlotIcons();
    updateTrayIcons();
  }

  function refreshAllSelections() {
    for (const cat of Object.keys(CAT_KEY)) refreshSelection(cat);
  }

  function updateSlotIcons() {
    $("slot-icon-tube").className = `slot-icon pci-tube-${S.tube}`;
    $("slot-icon-tube").innerHTML = "";
    $("slot-icon-mirror").className = "slot-icon";
    $("slot-icon-mirror").innerHTML = mirrorIconSVG(S.mirrors);
    $("slot-icon-skin").className = `slot-icon pci-skin-${S.skin}`;
    $("slot-icon-light").className = `slot-icon pci-light-${S.light}`;
    $("slot-icon-hole").className = `slot-icon pci-hole-${S.hole}`;
  }

  function updateTrayIcons() {
    const mLabel = $("tray-mirror-label");
    if (mLabel) mLabel.innerHTML = `かがみ<b>${S.mirrors === "p" ? "∥" : S.mirrors}</b>`;
    const si = $("tray-skin-icon");
    if (si) si.className = `tj-icon pci-skin-${S.skin}`;
    const sl = $("tray-skin-label");
    if (sl) sl.textContent = KKM.SKINS[S.skin].label.replace("鏡", "");
    const li = $("tray-light-icon");
    if (li) li.className = `tj-icon pci-light-${S.light}`;
    const ll = $("tray-light-label");
    if (ll) ll.textContent = KKM.LIGHTS[S.light].label.replace("のひかり", "").replace("からのひかり", "から");
  }

  /* ── タブ・スロット ── */

  function setCat(cat) {
    document.querySelectorAll(".dtab").forEach(t => t.classList.toggle("active", t.dataset.cat === cat));
    document.querySelectorAll(".drawer-panel").forEach(p => p.classList.toggle("active", p.id === `panel-${cat}`));
    document.querySelectorAll(".slot").forEach(s => s.classList.toggle("active", s.dataset.cat === cat));
  }

  /* ── はじめてガイド ── */

  function startGuideIfNeeded() {
    let done = false;
    try { done = localStorage.getItem(KKM.GUIDE_KEY) === "1"; } catch (e) {}
    if (done) { setCat("tube"); return; }
    guide.active = true;
    guide.idx = 0;
    guideStep();
  }

  function guideStep() {
    const cat = KKM.GUIDE_ORDER[guide.idx];
    setCat(cat);
    document.querySelectorAll(".guide-glow").forEach(e => e.classList.remove("guide-glow"));
    const tab = document.querySelector(`.dtab[data-cat="${cat}"]`);
    const slot = document.querySelector(`.slot[data-cat="${cat}"]`);
    if (tab) { tab.classList.add("guide-glow"); tab.scrollIntoView({ inline: "center", block: "nearest" }); }
    if (slot) slot.classList.add("guide-glow");
  }

  function guideAdvance(cat) {
    if (!guide.active) return;
    if (KKM.GUIDE_ORDER[guide.idx] !== cat) return;
    guide.idx++;
    if (guide.idx >= KKM.GUIDE_ORDER.length) {
      guide.active = false;
      document.querySelectorAll(".guide-glow").forEach(e => e.classList.remove("guide-glow"));
      const peek = $("btn-peek");
      peek.classList.add("guide-glow");
      setTimeout(() => peek.classList.remove("guide-glow"), 4000);
      try { localStorage.setItem(KKM.GUIDE_KEY, "1"); } catch (e) {}
    } else {
      guideStep();
    }
  }

  /* ── 初期化 ─────────────────────────────── */

  function init(ch) {
    chamber = ch;
    els = {
      title: $("screen-title"),
      workshop: $("screen-workshop"),
      peek: $("screen-peek"),
      gauge: $("fill-gauge-bar"),
      fullBubble: $("full-bubble"),
      pourLayer: $("pour-layer"),
      skewSlider: $("skew-slider"),
      skewValue: $("skew-value"),
      water: $("btn-water"),
      trayWater: $("tray-water"),
      tray: $("peek-tray"),
      btnTray: $("btn-tray"),
      coach: $("coach"),
      btnTilt: $("btn-tilt"),
      peekCanvas: $("peek-canvas"),
      photoModal: $("photo-modal"),
      photoImg: $("photo-img"),
      photoSave: $("photo-save"),
      flash: $("photo-flash"),
    };

    buildCards();
    bindTitle();
    bindWorkshop();
    bindPeek();
    bindTiltSensors();
    refreshAllSelections();

    // つくったもの棚：保管庫が変わるたびに描き直し＋迷子の粒を掃除
    KKM.Stampify.Store.setOnChange(() => {
      chamber.particles = chamber.particles.filter(
        p => p.type !== "stamp" || KKM.Stampify.Store.get(p.stampId));
      renderStampShelf();
    });

    try { S.coachDone = localStorage.getItem(KKM.COACH_KEY) === "1"; } catch (e) {}
  }

  /* ── つくったもの棚 ─────────────────────── */

  const STAMP_POUR = {
    draw:  { r: () => KKM.STAMP_BASE_R, copies: [0.95, 0.7, 0.52] },
    ptile: { r: () => KKM.PHOTO_TILE_R, copies: [1, 0.78] },
    pchip: { r: () => KKM.PHOTO_CHIP_R, copies: [1, 1] },
  };

  function renderStampShelf() {
    const shelf = $("stamp-shelf");
    const row = $("stamp-thumbs");
    if (!shelf || !row) return;
    const list = KKM.Stampify.Store.list();
    shelf.classList.toggle("hidden", list.length === 0);
    row.innerHTML = "";
    for (const entry of list) {
      const b = document.createElement("button");
      b.className = "stamp-thumb";
      if (entry.ready) {
        if (!entry.thumbURL) {
          try { entry.thumbURL = entry.canvas.toDataURL(); } catch (e) {}
        }
        if (entry.thumbURL) b.innerHTML = `<img src="${entry.thumbURL}" alt="">`;
      }
      const del = document.createElement("i");
      del.className = "stamp-del";
      del.textContent = "×";
      del.addEventListener("pointerdown", e => {
        e.stopPropagation();
        e.preventDefault();
        KKM.Stampify.Store.remove(entry.id);
        Sound.popSeq(2);
        markDirty();
      });
      b.appendChild(del);
      b.addEventListener("click", () => {
        if (chamber.isFull()) { showFullBubble(); return; }
        const spec = STAMP_POUR[entry.kind] || STAMP_POUR.draw;
        chamber.addStamps(entry.id, spec.r(), spec.copies);
        Sound.pour("beads");
        markDirty();
        guideAdvance("fill");
      });
      row.appendChild(b);
    }
  }

  /* おえかき・しゃしんが筒に入ったときの後始末 */
  function notifyStampAdded() {
    markDirty();
    guideAdvance("fill");
    renderStampShelf();
  }

  /* ── 画面遷移 ─────────────────────────────── */

  function showScreen(name) {
    for (const key of ["title", "workshop", "peek"]) {
      els[key].classList.toggle("visible", key === name);
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
      startGuideIfNeeded();
    });
    els.title.addEventListener("pointerdown", e => {
      if (e.target.closest("#btn-start")) return;
      Sound.ensure();
    });
  }

  /* ── こうぼう ─────────────────────────────── */

  function bindWorkshop() {
    $("btn-home").addEventListener("click", () => { Sound.uiTap(); showScreen("title"); });
    $("btn-sound").addEventListener("click", () => Sound.setMuted(!Sound.isMuted()));
    $("btn-sound2").addEventListener("click", () => Sound.setMuted(!Sound.isMuted()));
    $("btn-peek").addEventListener("click", enterPeek);

    // タブとスロット
    document.querySelectorAll(".dtab").forEach(t => {
      t.addEventListener("click", () => { Sound.uiTap(); setCat(t.dataset.cat); });
    });
    document.querySelectorAll(".slot").forEach(s => {
      s.addEventListener("click", () => { Sound.uiTap(); setCat(s.dataset.cat); });
    });

    // ずらしスライダー
    els.skewSlider.addEventListener("input", () => {
      S.skew01 = els.skewSlider.value / 100;
      updateSkewLabel();
      markDirty();
    });
    updateSkewLabel();

    // じぶんの え
    document.getElementById("jar-paint").addEventListener("pointerdown", e => {
      e.preventDefault();
      KKM.Paint.open();
    });

    // びん（タップ＆ながおし）
    document.querySelectorAll("#shelf .jar[data-material]").forEach(jar => {
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

    els.water.addEventListener("click", () => toggleWater());

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

  /* びんから注ぐ */
  function pour(material, jarEl) {
    if (chamber.isFull()) {
      showFullBubble();
      return;
    }
    Sound.pour(material);
    if (jarEl) {
      jarEl.classList.remove("pouring");
      void jarEl.offsetWidth;
      jarEl.classList.add("pouring");
      spawnPourDrops(material, jarEl);
    }
    setTimeout(() => {
      const added = chamber.addScoop(material, 0);
      if (added > 0) { markDirty(); guideAdvance("fill"); }
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
    const win = document.querySelector(".slot-window");
    const winRect = win.getBoundingClientRect();
    const sx = jarRect.left + jarRect.width / 2 - layerRect.left;
    const sy = jarRect.top + jarRect.height * 0.2 - layerRect.top;
    const exBase = winRect.left + winRect.width / 2 - layerRect.left;
    const ey = winRect.top + winRect.height * 0.35 - layerRect.top;
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
      const ex = exBase + (Math.random() - 0.5) * winRect.width * 0.5;
      const my = Math.min(sy, ey) - 40 - Math.random() * 34;
      const mx = (sx + ex) / 2;
      const anim = d.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${ex}px, ${ey}px) scale(.55)`, opacity: 1 },
      ], { duration: 360 + Math.random() * 160, delay: i * 34, easing: "ease-in", fill: "backwards" });
      anim.onfinish = () => d.remove();
    }
  }

  /* ── のぞき ─────────────────────────────── */

  function enterPeek() {
    if (chamber.particles.length === 0) {
      chamber.addScoop("beads", 0);
      chamber.addScoop("glitter", 0);
    }
    Sound.reveal();
    S.tubeAngle = 0;
    S.tubeOmega = 0.35;
    showScreen("peek");
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

    // ちょうりつトレイ
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
      const i = KKM.MIRROR_ORDER.indexOf(S.mirrors);
      selectPart("mirror", KKM.MIRROR_ORDER[(i + 1) % KKM.MIRROR_ORDER.length]);
      markDirty();
    });
    $("tray-skin").addEventListener("click", () => {
      const i = KKM.SKIN_ORDER.indexOf(S.skin);
      selectPart("skin", KKM.SKIN_ORDER[(i + 1) % KKM.SKIN_ORDER.length]);
      markDirty();
    });
    $("tray-light").addEventListener("click", () => {
      const i = KKM.LIGHT_ORDER.indexOf(S.light);
      selectPart("light", KKM.LIGHT_ORDER[(i + 1) % KKM.LIGHT_ORDER.length]);
      markDirty();
    });

    els.btnTilt.addEventListener("click", requestMotionPermission);

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
    const beta = e.beta * Math.PI / 180;
    const gamma = e.gamma * Math.PI / 180;
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
    const bgGrad = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.75);
    bgGrad.addColorStop(0, "#241536");
    bgGrad.addColorStop(1, "#0b0612");
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, size, size);
    const photoKal = window.KKM_kaleido;
    if (photoKal && window.KKM_chamberOpts) {
      photoKal.renderChamber(chamber, 520, S.tubeAngle, window.KKM_chamberOpts());
      photoKal.draw(g, size / 2, size / 2 - 20, size * 0.4, {
        mirrors: S.mirrors,
        skew: S.skew01 * KKM.SKEW_MAX,
        tubeAngle: Math.PI / 2 - chamber.focusAngle(),
        skin: S.skin,
        hole: S.hole,
        lens: S.lens,
        quality: 1,
        time: chamber.time,
      });
    }
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
        tube: S.tube, mirrors: S.mirrors, skew01: S.skew01,
        skin: S.skin, light: S.light, hole: S.hole, lens: S.lens,
        stamps: KKM.Stampify.Store.serialize(),
        chamber: chamber.serialize(),
      }));
    } catch (e) {}
  }

  function loadRecipe() {
    try {
      const raw = localStorage.getItem(KKM.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (KKM.TUBES[data.tube]) { S.tube = data.tube; chamber.setTube(data.tube); }
      if (KKM.MIRRORS[data.mirrors]) S.mirrors = String(data.mirrors);
      if (typeof data.skew01 === "number") {
        S.skew01 = data.skew01;
        els.skewSlider.value = Math.round(S.skew01 * 100);
        updateSkewLabel();
      }
      if (KKM.SKINS[data.skin]) S.skin = data.skin;
      if (KKM.LIGHTS[data.light]) S.light = data.light;
      if (KKM.HOLES[data.hole]) S.hole = data.hole;
      if (KKM.LENSES[data.lens]) S.lens = data.lens;
      KKM.Stampify.Store.restore(data.stamps);
      const ok = chamber.restore(data.chamber);
      els.water.classList.toggle("on", chamber.liquid);
      els.trayWater.classList.toggle("on", chamber.liquid);
      refreshAllSelections();
      return ok;
    } catch (e) { return false; }
  }

  return { init, showScreen, saveRecipe, loadRecipe, showFullBubble, selectPart,
           notifyStampAdded };
})();
