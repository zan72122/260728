/* ═══════════════════════════════════════════════════════════
   ui.js — ワンワールドUI

   画面はひとつ。いつも全画面の万華鏡をのぞいていて、
   回すのもかたむけるのも常に効く。下端の「どうぐばこ」から
   半透明ドックが出て、部品を差し替えると背後の世界が即変わる。

   部品えらびは「結果で選ぶカタログ」：
   かがみ・せいかく・ひかり・のぞきあな・レンズは、
   その部品にした場合の“実際の模様”がライブで映る小さな窓。
   文字はどこにもない。絵と結果と音だけ。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.state = {
  screen: "title",       // title | peek
  tube: "round",
  mirrors: "3",
  skew01: 0,
  skin: "pika",
  light: "asa",
  hole: "maru",
  lens: "futsu",
  tubeAngle: 0,
  tubeOmega: 0,
  titleAngle: 0,
  photoZoom: 1,          // ピンチで写真を拡大・縮小
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

  /* ドックの状態 */
  const dock = { open: false, cat: "tube" };

  /* 結果カタログ */
  const catalog = {
    kal: null,             // 専用レンダラー
    items: [],             // { cat, val, canvas, ctx }
    tick: 0,
  };
  const CATALOG_CATS = ["mirror", "skin", "light", "hole", "lens"];
  const CAT_KEY = { tube: "tube", mirror: "mirrors", skin: "skin", light: "light", hole: "hole", lens: "lens" };

  /* ══════════ 初期化 ══════════ */

  function init(ch) {
    chamber = ch;
    catalog.kal = new KKM.Kaleido();
    els = {
      title: $("screen-title"),
      peek: $("screen-peek"),
      dock: $("dock"),
      btnDock: $("btn-dock"),
      gauge: $("fill-gauge"),
      gaugeBar: $("fill-gauge-bar"),
      pourLayer: $("pour-layer"),
      skewSlider: $("skew-slider"),
      water: $("btn-water"),
      coach: $("coach"),
      btnTilt: $("btn-tilt"),
      peekCanvas: $("peek-canvas"),
      photoModal: $("photo-modal"),
      photoImg: $("photo-img"),
      photoSave: $("photo-save"),
      flash: $("photo-flash"),
      dockWindow: document.querySelector(".dock-window"),
    };

    buildCatalog();
    bindTitle();
    bindWorld();
    bindDock();
    bindTiltSensors();
    refreshAllSelections();
    setCat("tube");

    KKM.Stampify.Store.setOnChange(() => {
      chamber.particles = chamber.particles.filter(
        p => p.type !== "stamp" || KKM.Stampify.Store.get(p.stampId));
      renderStampShelf();
    });

    try { S.coachDone = localStorage.getItem(KKM.COACH_KEY) === "1"; } catch (e) {}
  }

  /* ══════════ カタログを組み立てる ══════════ */

  function makeCatalogItem(cat, val) {
    const b = document.createElement("button");
    b.className = "cat-item";
    b.dataset.cat = cat;
    b.dataset.val = val;
    const c = document.createElement("canvas");
    c.width = 200; c.height = 200;
    b.appendChild(c);
    b.addEventListener("click", () => selectPart(cat, val));
    catalog.items.push({ cat, val, canvas: c, ctx: c.getContext("2d") });
    return b;
  }

  function makeTubeItem(val) {
    const b = document.createElement("button");
    b.className = "cat-item cat-item-icon";
    b.dataset.cat = "tube";
    b.dataset.val = val;
    b.innerHTML = `<i class="pci-tube-${val}"></i>`;
    b.addEventListener("click", () => selectPart("tube", val));
    return b;
  }

  function buildCatalog() {
    const rows = {
      tube: $("cat-tube"), mirror: $("cat-mirror"), skin: $("cat-skin"),
      light: $("cat-light"), hole: $("cat-hole"), lens: $("cat-lens"),
    };
    for (const val of Object.keys(KKM.TUBES)) rows.tube.appendChild(makeTubeItem(val));
    for (const val of KKM.MIRROR_ORDER) rows.mirror.appendChild(makeCatalogItem("mirror", val));
    for (const val of KKM.SKIN_ORDER) rows.skin.appendChild(makeCatalogItem("skin", val));
    for (const val of KKM.LIGHT_ORDER) rows.light.appendChild(makeCatalogItem("light", val));
    for (const val of Object.keys(KKM.HOLES)) rows.hole.appendChild(makeCatalogItem("hole", val));
    for (const val of Object.keys(KKM.LENSES)) rows.lens.appendChild(makeCatalogItem("lens", val));
  }

  /* 毎フレーム main から呼ばれる。開いているカテゴリの小窓だけ、
     間引きながら「その部品にした場合のいまの模様」を描く */
  function renderCatalog() {
    if (!dock.open) return;
    const cat = dock.cat;
    if (cat === "tube" || cat === "fill") return;
    catalog.tick++;
    if (catalog.tick % 3 !== 0) return;

    const kal = catalog.kal;
    const rot = Math.PI / 2 - chamber.focusAngle();
    const baseOpts = window.KKM_chamberOpts ? window.KKM_chamberOpts() : { light: S.light };

    const items = catalog.items.filter(i =>
      cat === "hole" ? (i.cat === "hole" || i.cat === "lens") : i.cat === cat);
    if (!items.length) return;

    // ひかり以外は、チャンバーを1回描いて全窓で使い回す
    if (cat !== "light") {
      kal.renderChamber(chamber, 96, S.tubeAngle, baseOpts);
    }
    for (const item of items) {
      if (cat === "light") {
        const opts = { light: item.val };
        if (item.val === "yoko") {
          const cos = Math.cos(rot), sin = Math.sin(rot);
          opts.lightDir = { x: -0.72 * cos + -0.7 * sin, y: 0.72 * sin + -0.7 * cos };
        }
        kal.renderChamber(chamber, 80, S.tubeAngle, opts);
      }
      const g = item.ctx;
      const w = item.canvas.width;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#100a1e";
      g.fillRect(0, 0, w, w);
      kal.draw(g, w / 2, w / 2, w / 2 * 0.92, {
        mirrors: item.cat === "mirror" ? item.val : S.mirrors,
        skew: S.skew01 * KKM.SKEW_MAX,
        tubeAngle: rot,
        skin: item.cat === "skin" ? item.val : S.skin,
        hole: item.cat === "hole" ? item.val : (item.cat === "lens" ? S.hole : "maru"),
        lens: item.cat === "lens" ? item.val : "futsu",
        quality: 1,
        time: chamber.time,
        apexFrac: chamber.photoLayer ? 0.15 : 0.42,
      });
    }
  }

  /* ══════════ 部品の選択 ══════════ */

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
    document.querySelectorAll(`.cat-item[data-cat="${cat}"]`)
      .forEach(c => c.classList.toggle("selected", c.dataset.val === S[key]));
  }

  function refreshAllSelections() {
    for (const cat of Object.keys(CAT_KEY)) refreshSelection(cat);
  }

  /* ══════════ ドック ══════════ */

  function setCat(cat) {
    dock.cat = cat;
    document.querySelectorAll(".dock-chips .chip")
      .forEach(t => t.classList.toggle("active", t.dataset.cat === cat));
    document.querySelectorAll(".dock-panel")
      .forEach(p => p.classList.toggle("active", p.id === `dp-${cat}`));
  }

  function setDockOpen(open) {
    dock.open = open;
    els.dock.classList.toggle("hidden", !open);
    els.btnDock.classList.toggle("open", open);
  }

  function bindDock() {
    els.btnDock.addEventListener("click", () => {
      setDockOpen(!dock.open);
      Sound.uiTap();
    });
    document.querySelectorAll(".dock-chips .chip").forEach(t => {
      t.addEventListener("click", () => { Sound.uiTap(); setCat(t.dataset.cat); });
    });

    // ずらしネジ
    els.skewSlider.addEventListener("input", () => {
      S.skew01 = els.skewSlider.value / 100;
      markDirty();
    });

    // じぶんの え
    $("jar-paint").addEventListener("pointerdown", e => {
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
      const hadPhoto = !!chamber.photoLayer;
      chamber.clearPhotoLayer();
      if (n > 0 || hadPhoto) { Sound.popSeq(Math.max(n, 3)); markDirty(); }
    });
  }

  function dockInfo() { return { open: dock.open, cat: dock.cat }; }

  /* ══════════ はじめてガイド ══════════ */

  function startGuideIfNeeded() {
    let done = false;
    try { done = localStorage.getItem(KKM.GUIDE_KEY) === "1"; } catch (e) {}
    if (done) { setCat("tube"); return; }
    guide.active = true;
    guide.idx = 0;
    setDockOpen(true);
    guideStep();
  }

  function guideStep() {
    const cat = KKM.GUIDE_ORDER[guide.idx];
    setCat(cat);
    document.querySelectorAll(".guide-glow").forEach(e => e.classList.remove("guide-glow"));
    const chip = document.querySelector(`.dock-chips .chip[data-cat="${cat}"]`);
    if (chip) chip.classList.add("guide-glow");
  }

  function guideAdvance(cat) {
    if (!guide.active) return;
    if (KKM.GUIDE_ORDER[guide.idx] !== cat) return;
    guide.idx++;
    if (guide.idx >= KKM.GUIDE_ORDER.length) {
      guide.active = false;
      document.querySelectorAll(".guide-glow").forEach(e => e.classList.remove("guide-glow"));
      try { localStorage.setItem(KKM.GUIDE_KEY, "1"); } catch (e) {}
    } else {
      guideStep();
    }
  }

  /* ══════════ 画面遷移 ══════════ */

  function showScreen(name) {
    els.title.classList.toggle("visible", name === "title");
    els.peek.classList.toggle("visible", name === "peek");
    S.screen = name;
    Sound.duckMusic(name === "peek");
    if (window.KKM_onScreenChange) window.KKM_onScreenChange(name);
  }

  function bindTitle() {
    $("btn-start").addEventListener("click", () => {
      Sound.ensure();
      Sound.startMusic();
      Sound.reveal();
      S.tubeOmega = 0.35;
      showScreen("peek");
      startGuideIfNeeded();
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === "function" && !S.tilt.active) {
        els.btnTilt.classList.remove("hidden");
      }
      if (!S.coachDone && !guide.active) {
        els.coach.classList.remove("hidden");
        els.coach.classList.remove("fade-out");
      }
    });
    els.title.addEventListener("pointerdown", e => {
      if (e.target.closest("#btn-start")) return;
      Sound.ensure();
    });
  }

  /* ══════════ なかみ ══════════ */

  function toggleWater() {
    const on = !chamber.liquid;
    chamber.setLiquid(on);
    els.water.classList.toggle("on", on);
    Sound.pour("water");
    markDirty();
  }

  function pour(material, jarEl) {
    if (chamber.isFull()) {
      flashFull();
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
      const added = chamber.addScoop(material, S.tubeAngle);
      if (added > 0) { markDirty(); guideAdvance("fill"); }
    }, jarEl ? 240 : 0);
  }

  /* いっぱいのときは、ことばではなくゲージが赤くふるえる */
  function flashFull() {
    els.gauge.classList.remove("gauge-full");
    void els.gauge.offsetWidth;
    els.gauge.classList.add("gauge-full");
    if (els.dockWindow) {
      els.dockWindow.classList.remove("wobble-win");
      void els.dockWindow.offsetWidth;
      els.dockWindow.classList.add("wobble-win");
    }
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
    const winRect = els.dockWindow.getBoundingClientRect();
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

  /* ══════════ つくったもの棚 ══════════ */

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
        if (chamber.isFull()) { flashFull(); return; }
        const spec = STAMP_POUR[entry.kind] || STAMP_POUR.draw;
        chamber.addStamps(entry.id, spec.r(), spec.copies);
        Sound.pour("beads");
        markDirty();
        guideAdvance("fill");
      });
      row.appendChild(b);
    }
  }

  function notifyStampAdded() {
    markDirty();
    guideAdvance("fill");
    renderStampShelf();
  }

  /* ══════════ せかいの入力（回す・かたむける） ══════════ */

  function dismissCoach() {
    if (els.coach.classList.contains("hidden")) return;
    els.coach.classList.add("fade-out");
    setTimeout(() => els.coach.classList.add("hidden"), 520);
    S.coachDone = true;
    try { localStorage.setItem(KKM.COACH_KEY, "1"); } catch (e) {}
  }

  function bindWorld() {
    $("btn-home").addEventListener("click", () => {
      Sound.uiTap();
      setDockOpen(false);
      showScreen("title");
    });
    $("btn-sound2").addEventListener("click", () => Sound.setMuted(!Sound.isMuted()));

    const cv = els.peekCanvas;
    let lastA = 0, lastT = 0, activeId = null;
    const pointers = new Map();     // ゆび2本のピンチも見る
    let pinch = null;               // { d0, z0 }
    const center = () => ({ x: cv.clientWidth / 2, y: cv.clientHeight / 2 });

    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const startRotation = (x, y, id) => {
      const c = center();
      activeId = id;
      lastA = Math.atan2(y - c.y, x - c.x);
      lastT = performance.now();
      S.dragging = true;
      S.tubeOmega = 0;
    };

    cv.addEventListener("pointerdown", e => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // ピンチ開始：回転をやめて、写真の拡大・縮小へ
        S.dragging = false;
        activeId = null;
        pinch = { d0: Math.max(20, pinchDist()), z0: S.photoZoom };
      } else if (pointers.size === 1) {
        startRotation(e.clientX, e.clientY, e.pointerId);
      }
      dismissCoach();
      Sound.ensure();
    });
    cv.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        if (chamber.photoLayer) {
          S.photoZoom = Math.max(0.45, Math.min(3, pinch.z0 * pinchDist() / pinch.d0));
          markDirty();
        }
        return;
      }
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
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // のこった1本で回転をつづける
        const [[id, p]] = [...pointers.entries()];
        startRotation(p.x, p.y, id);
      } else if (pointers.size === 0) {
        S.dragging = false;
        activeId = null;
      }
    };
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);

    els.btnTilt.addEventListener("click", requestMotionPermission);
    $("btn-photo").addEventListener("click", takePhoto);
    $("photo-close").addEventListener("click", () => {
      els.photoModal.classList.add("hidden");
      Sound.uiTap();
    });
  }

  /* ══════════ かたむき・シェイク ══════════ */

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

  /* ══════════ しゃしん ══════════ */

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
      const cOpts = window.KKM_chamberOpts();
      const photoSrc = photoKal.preparePhoto(chamber, S.light, cOpts.lightDir, chamber.time);
      photoKal.renderChamber(chamber, 520, S.tubeAngle, { ...cOpts, photoDirect: !!photoSrc });
      photoKal.draw(g, size / 2, size / 2 - 20, size * 0.4, {
        photo: photoSrc ? { canvas: photoSrc, zoom: S.photoZoom } : null,
        mirrors: S.mirrors,
        skew: S.skew01 * KKM.SKEW_MAX,
        tubeAngle: Math.PI / 2 - chamber.focusAngle(),
        skin: S.skin,
        hole: S.hole,
        lens: S.lens,
        quality: 1,
        time: chamber.time,
        apexFrac: chamber.photoLayer ? 0.15 : 0.42,
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

  /* ══════════ 保存 ══════════ */

  function markDirty() { S.dirty = true; }

  function saveRecipe() {
    if (!S.dirty) return;
    S.dirty = false;
    try {
      localStorage.setItem(KKM.SAVE_KEY, JSON.stringify({
        tube: S.tube, mirrors: S.mirrors, skew01: S.skew01,
        skin: S.skin, light: S.light, hole: S.hole, lens: S.lens,
        photoZoom: S.photoZoom,
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
      }
      if (KKM.SKINS[data.skin]) S.skin = data.skin;
      if (KKM.LIGHTS[data.light]) S.light = data.light;
      if (KKM.HOLES[data.hole]) S.hole = data.hole;
      if (KKM.LENSES[data.lens]) S.lens = data.lens;
      if (typeof data.photoZoom === "number") {
        S.photoZoom = Math.max(0.45, Math.min(3, data.photoZoom));
      }
      KKM.Stampify.Store.restore(data.stamps);
      const ok = chamber.restore(data.chamber);
      els.water.classList.toggle("on", chamber.liquid);
      refreshAllSelections();
      return ok;
    } catch (e) { return false; }
  }

  return { init, showScreen, saveRecipe, loadRecipe, selectPart,
           notifyStampAdded, renderCatalog, dockInfo };
})();
