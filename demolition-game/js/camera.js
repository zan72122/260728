/* camera.js — カメラのジェスチャー操作（ピンチズーム・2本指パン・視点プリセット）
 * 1本指は建築/タップ用に既存ロジックへ渡すため、ここでは奪わない。
 * 2本目の指が触れた瞬間から、そのタッチセッションが終わる（全指が離れる）まで
 * window.GameCamera.gesturing を true にして main.js 側の1本指ハンドラをブロックする。
 */
(function () {
  'use strict';

  const R = window.GameRender;
  const canvas = document.getElementById('game-canvas');
  const bar = document.getElementById('view-bar');

  const ZOOM_MIN = 0.45, ZOOM_MAX = 2.6;

  const C = { gesturing: false };

  /* ---------- 指トラッキング ---------- */
  const pointers = new Map(); /* pointerId -> {x,y}（挿入順を維持） */
  let mode = null;            /* null | 'pinch' */
  let baseZoom = 1;
  let baseDist = 1;
  let lastMid = null;
  let animGen = 0; /* プリセットのイージングを打ち切るための世代カウンタ */

  function firstTwo() {
    const pts = [];
    for (const p of pointers.values()) {
      pts.push(p);
      if (pts.length === 2) break;
    }
    return pts;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function midOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function beginGesture() {
    const pts = firstTwo();
    if (pts.length < 2) return;
    animGen++; /* プリセットの遷移中でも指が触れたら即座にジェスチャー優先 */
    mode = 'pinch';
    C.gesturing = true;
    if (window.GameBuild && window.GameBuild.strokeEnd) window.GameBuild.strokeEnd();
    baseZoom = R.getView().zoom;
    baseDist = Math.max(1, dist(pts[0], pts[1]));
    lastMid = midOf(pts[0], pts[1]);
  }

  function updateGesture() {
    if (mode !== 'pinch') return;
    const pts = firstTwo();
    if (pts.length < 2) return;
    const curDist = dist(pts[0], pts[1]);
    const curMid = midOf(pts[0], pts[1]);

    /* パン量：指の下のワールド座標が指に追従するよう、ズーム前の現在カメラで
     * 前フレームの中点と今回の中点それぞれのワールド座標を求めて差分をパンに反映する。 */
    const cur = R.getView();
    const w0 = R.worldFromScreen(lastMid.x, lastMid.y);
    const w1 = R.worldFromScreen(curMid.x, curMid.y);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, baseZoom * (curDist / baseDist)));

    R.setView({
      zoom: newZoom,
      panX: cur.panX + (w0.x - w1.x),
      panY: cur.panY + (w1.y - w0.y),
    });
    lastMid = curMid;
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) beginGesture();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch') updateGesture();
  }

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) mode = null;
    if (pointers.size === 0) C.gesturing = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);

  /* ---------- マウスホイール（PC用ズーム） ---------- */
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    animGen++;
    const cur = R.getView();
    const factor = Math.exp(-e.deltaY * 0.0015);
    R.setView({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cur.zoom * factor)) });
  }, { passive: false });

  /* ---------- 視点プリセットボタン ---------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateTo(partial, duration) {
    const myGen = ++animGen;
    const start = R.getView();
    const target = Object.assign({}, start, partial);
    const t0 = performance.now();
    function step(now) {
      if (myGen !== animGen) return; /* 途中でジェスチャーや別プリセットに割り込まれた */
      const t = Math.min(1, (now - t0) / (duration * 1000));
      const e = easeOutCubic(t);
      R.setView({
        zoom: lerp(start.zoom, target.zoom, e),
        panX: lerp(start.panX, target.panX, e),
        panY: lerp(start.panY, target.panY, e),
        az: lerp(start.az, target.az, e),
        el: lerp(start.el, target.el, e),
      });
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function bindPreset(id, partial) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      animateTo(partial, 0.4);
    });
  }

  bindPreset('view-btn-reset', { zoom: 1, panX: 0, panY: 0, az: 0, el: 0 });
  bindPreset('view-btn-left', { az: -0.55 });
  bindPreset('view-btn-right', { az: 0.55 });
  bindPreset('view-btn-up', { el: 0.4 });

  /* ---------- 表示制御 ---------- */
  C.showBar = function (visible) {
    if (!bar) return;
    bar.classList.toggle('hidden', !visible);
  };

  window.GameCamera = C;
})();
