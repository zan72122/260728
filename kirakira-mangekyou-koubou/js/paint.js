/* ═══════════════════════════════════════════════════════════
   paint.js — まんげきょうに ちょくせつ おえかき

   上半分はライブの万華鏡プレビュー。1画ごとに、その線が
   鏡のまい数ぶん増えて曼荼羅になる様子がリアルタイムで見える。
   「かがみペン」はパッド自体にも6回対称をかけ、
   ぐちゃぐちゃ描きが一瞬でちょうちょや雪の結晶になる。
   描き終えると Stampify がステッカー化して筒に注ぎ込む。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Paint = (() => {
  const SIZE = 460;              // 描画キャンバスの内部解像度
  const C = SIZE / 2;

  const CRAYONS = [
    { key: "ichigo", c: "#ff5f96" },
    { key: "mikan",  c: "#ff9440" },
    { key: "kiiro",  c: "#ffcf3e" },
    { key: "midori", c: "#46c883" },
    { key: "sora",   c: "#3fa0e8" },
    { key: "budou",  c: "#9b6fe8" },
    { key: "niji",   c: "rainbow" },
    { key: "kira",   c: "glitter" },
  ];

  let chamber = null;
  let paintKal = null;
  let els = {};
  let ctx = null;                // 描画キャンバス（透明背景）
  let open = false;
  let raf = 0;
  let tool = CRAYONS[0];
  let mirrorPen = true;
  let drawing = false;
  let lastPt = null;
  let hue = 0;
  let glitDist = 0;
  let previewAngle = 0;
  let strokeCount = 0;

  function init(ch) {
    chamber = ch;
    paintKal = new KKM.Kaleido();
    els.modal = document.getElementById("paint-modal");
    els.preview = document.getElementById("paint-preview");
    els.board = document.getElementById("paint-canvas");
    els.board.width = SIZE;
    els.board.height = SIZE;
    ctx = els.board.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // クレヨンを生成
    const row = document.getElementById("crayons");
    CRAYONS.forEach((cr, i) => {
      const b = document.createElement("button");
      b.className = "crayon" + (i === 0 ? " selected" : "");
      b.dataset.key = cr.key;
      if (cr.c === "rainbow") {
        b.classList.add("crayon-rainbow");
        b.innerHTML = `<i></i><span>にじ</span>`;
      } else if (cr.c === "glitter") {
        b.classList.add("crayon-glitter");
        b.innerHTML = `<i></i><span>きらきら</span>`;
      } else {
        b.innerHTML = `<i style="background:${cr.c}"></i>`;
      }
      b.addEventListener("click", () => {
        tool = cr;
        row.querySelectorAll(".crayon").forEach(x => x.classList.toggle("selected", x === b));
        KKM.Sound.uiTap();
      });
      row.appendChild(b);
    });

    document.getElementById("paint-mirror-pen").addEventListener("click", e => {
      mirrorPen = !mirrorPen;
      e.currentTarget.classList.toggle("on", mirrorPen);
      KKM.Sound.uiSelect();
    });
    document.getElementById("paint-clear").addEventListener("click", () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      strokeCount = 0;
      KKM.Sound.whoosh();
    });
    document.getElementById("paint-cancel").addEventListener("click", () => {
      KKM.Sound.uiTap();
      close();
    });
    document.getElementById("paint-done").addEventListener("click", done);

    bindPointer();
  }

  /* ── 開閉 ── */

  function openModal() {
    els.modal.classList.remove("hidden");
    open = true;
    previewAngle = 0;
    KKM.Sound.uiSelect();
    loop();
  }

  function close() {
    els.modal.classList.add("hidden");
    open = false;
    cancelAnimationFrame(raf);
  }

  /* ── 描く ── */

  function boardPoint(e) {
    const r = els.board.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * SIZE,
      y: (e.clientY - r.top) / r.height * SIZE,
    };
  }

  function bindPointer() {
    const b = els.board;
    b.addEventListener("pointerdown", e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      drawing = true;
      lastPt = boardPoint(e);
      dot(lastPt);
      KKM.Sound.ensure();
    });
    b.addEventListener("pointermove", e => {
      if (!drawing) return;
      const p = boardPoint(e);
      const d = Math.hypot(p.x - lastPt.x, p.y - lastPt.y);
      if (d < 2.5) return;
      segment(lastPt, p, d);
      lastPt = p;
      KKM.Sound.scribble();
    });
    const up = () => { drawing = false; lastPt = null; strokeCount++; };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  }

  /* 対称コピーをかけながら1つの処理を実行 */
  function eachSym(fn) {
    if (!mirrorPen) { fn(0, 1); return; }
    for (let i = 0; i < 6; i++) {
      const rot = (i / 6) * Math.PI * 2;
      fn(rot, 1);
      fn(rot, -1);
    }
  }

  function withTransform(rot, m, fn) {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot);
    ctx.scale(1, m);
    ctx.translate(-C, -C);
    fn();
    ctx.restore();
  }

  function currentColor(dist) {
    if (tool.c === "rainbow") {
      hue = (hue + dist * 0.9) % 360;
      return `hsl(${hue}, 88%, 62%)`;
    }
    return tool.c;
  }

  function dot(p) {
    if (tool.c === "glitter") { glitterAt(p); return; }
    const col = currentColor(4);
    eachSym((rot, m) => withTransform(rot, m, () => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }));
  }

  function segment(p0, p1, dist) {
    if (tool.c === "glitter") {
      glitDist += dist;
      while (glitDist > 13) {
        glitDist -= 13;
        const t = Math.random();
        glitterAt({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
      }
      return;
    }
    const col = currentColor(dist);
    eachSym((rot, m) => withTransform(rot, m, () => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }));
  }

  /* きらきらペン：金の粒＋十字の光を散らす */
  function glitterAt(p) {
    const flare = KKM.Sprites.get("flare");
    eachSym((rot, m) => withTransform(rot, m, () => {
      const jx = p.x + (Math.random() - 0.5) * 10;
      const jy = p.y + (Math.random() - 0.5) * 10;
      const r = 4 + Math.random() * 5;
      const cols = ["#ffd75e", "#ffe9a8", "#ff9ec9", "#8fd8ff"];
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
      ctx.beginPath();
      ctx.arc(jx, jy, r, 0, Math.PI * 2);
      ctx.fill();
      const fs = r * 6;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(flare, jx - fs / 2, jy - fs / 2, fs, fs);
      ctx.globalAlpha = 1;
    }));
  }

  /* ── ライブプレビュー ── */

  function loop() {
    if (!open) return;
    raf = requestAnimationFrame(loop);
    previewAngle += 0.005;
    const cv = els.preview;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#17102a";
    g.fillRect(0, 0, w, h);
    const viewR = Math.min(w, h) / 2 * 0.96;
    const S = KKM.state;
    paintKal.renderImage(els.board, Math.min(300, viewR | 0));
    paintKal.draw(g, w / 2, h / 2, viewR, {
      mirrors: S.mirrors === "p" ? "3" : S.mirrors,
      skew: S.skew01 * KKM.SKEW_MAX,
      tubeAngle: previewAngle,
      skin: S.skin,
      hole: "maru",
      lens: "futsu",
      quality: 1,
      time: performance.now() / 1000,
      apexFrac: 0.18,
    });
  }

  /* ── できた！ ── */

  function done() {
    const stamp = KKM.Stampify.fromDrawing(els.board);
    if (!stamp) {
      // なにも描いていない
      els.modal.querySelector(".paint-wrap").classList.remove("wobble");
      void els.modal.offsetWidth;
      els.modal.querySelector(".paint-wrap").classList.add("wobble");
      KKM.Sound.uiTap();
      return;
    }
    const id = KKM.Stampify.Store.add(stamp, "draw");
    chamber.addStamps(id, KKM.STAMP_BASE_R, KKM.STAMP_COPIES);
    KKM.Sound.tada();
    KKM.Sound.pour("beads");
    flyToChamber(stamp);
    ctx.clearRect(0, 0, SIZE, SIZE);
    strokeCount = 0;
    close();
    if (KKM.UI.notifyStampAdded) KKM.UI.notifyStampAdded();
  }

  /* ステッカーが筒のまどへ飛んでいく演出 */
  function flyToChamber(stampCanvas) {
    const win = document.querySelector(".dock-window");
    if (!win) return;
    const wr = win.getBoundingClientRect();
    const br = els.board.getBoundingClientRect();
    const img = document.createElement("img");
    img.src = stampCanvas.toDataURL();
    Object.assign(img.style, {
      position: "fixed",
      left: "0", top: "0",
      width: br.width * 0.5 + "px",
      height: br.width * 0.5 + "px",
      zIndex: 90,
      pointerEvents: "none",
    });
    document.body.appendChild(img);
    const sx = br.left + br.width * 0.25, sy = br.top + br.height * 0.25;
    const ex = wr.left + wr.width / 2 - br.width * 0.06;
    const ey = wr.top + wr.height / 2 - br.width * 0.06;
    const anim = img.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(1) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${ex}px, ${ey}px) scale(.12) rotate(340deg)`, opacity: 0.9 },
    ], { duration: 620, easing: "cubic-bezier(.4, 0, .7, 1)" });
    anim.onfinish = () => img.remove();
  }

  return { init, open: openModal, close };
})();
