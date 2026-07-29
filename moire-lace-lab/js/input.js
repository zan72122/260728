/*
 * input.js
 * 指での直接操作。すべて「上のシート」に即時反映する。
 *  - 1 本指ドラッグ  : シートをずらす
 *  - 2 本指ひねり    : シートを回す / つまんで拡大縮小 (指の間を軸に回る)
 *  - マウスホイール  : 拡大縮小
 * 勢いよく明るい場所を通ると、花火の粒が弾ける (particles.burstAt)。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const BURST_MIN_SPEED = 900;   // px/s: これより速い動きで
  const BURST_MIN_ENV = 0.66;    // これより明るい場所なら花火
  const BURST_COOLDOWN_MS = 240;

  function setupInput(target, state, particles) {
    const pointers = new Map(); // pointerId -> {x, y}
    let lastBurstAt = 0;
    let lastMoveTime = 0;

    function minDim() {
      return Math.min(window.innerWidth, window.innerHeight);
    }

    function toWorld(px, py) {
      return [
        (px - window.innerWidth / 2) / minDim(),
        (py - window.innerHeight / 2) / minDim(),
      ];
    }

    function updatePointerState(e) {
      state.pointer.x = e.clientX;
      state.pointer.y = e.clientY;
      state.pointer.active = pointers.size > 0;
      if (state.light.on) {
        const w = toWorld(e.clientX, e.clientY);
        state.light.x = w[0];
        state.light.y = w[1];
      }
    }

    function onDown(e) {
      e.preventDefault();
      target.setPointerCapture && target.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastMoveTime = performance.now();
      updatePointerState(e);
      ML.audio.resume();
    }

    function onMove(e) {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const now = performance.now();
      const prev = pointers.get(e.pointerId);
      const d = minDim();

      if (pointers.size === 1) {
        // ---- 1 本指: ずらす ----
        state.top.x += (e.clientX - prev.x) / d;
        state.top.y += (e.clientY - prev.y) / d;
        maybeBurst(e, prev, now);
      } else if (pointers.size >= 2) {
        // ---- 2 本指: 回す・つまむ・ずらす ----
        const ids = [...pointers.keys()];
        const otherId = ids[0] === e.pointerId ? ids[1] : ids[0];
        const other = pointers.get(otherId);

        const oldDx = prev.x - other.x, oldDy = prev.y - other.y;
        const newDx = e.clientX - other.x, newDy = e.clientY - other.y;
        const oldDist = Math.hypot(oldDx, oldDy);
        const newDist = Math.hypot(newDx, newDy);
        const dTheta = Math.atan2(newDy, newDx) - Math.atan2(oldDy, oldDx);
        const k = oldDist > 8 ? newDist / oldDist : 1;

        const cx = (e.clientX + other.x) / 2;
        const cy = (e.clientY + other.y) / 2;
        const pivot = toWorld(cx, cy);
        ML.pivotTransform(state.top, pivot[0], pivot[1], dTheta, k);

        // 2 本指の中心の移動でシートもついてくる
        const oldCx = (prev.x + other.x) / 2;
        const oldCy = (prev.y + other.y) / 2;
        state.top.x += (cx - oldCx) / d;
        state.top.y += (cy - oldCy) / d;
      }

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastMoveTime = now;
      updatePointerState(e);
    }

    function maybeBurst(e, prev, now) {
      const dtMs = Math.max(1, now - lastMoveTime);
      const speed = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) / dtMs * 1000;
      if (speed < BURST_MIN_SPEED || now - lastBurstAt < BURST_COOLDOWN_MS) return;
      const w = toWorld(e.clientX, e.clientY);
      if (ML.envelopeAt(state, w[0], w[1]) > BURST_MIN_ENV) {
        particles.burstAt(e.clientX, e.clientY);
        lastBurstAt = now;
      }
    }

    function onUp(e) {
      pointers.delete(e.pointerId);
      state.pointer.active = pointers.size > 0;
    }

    function onWheel(e) {
      e.preventDefault();
      const k = Math.pow(1.0015, -e.deltaY);
      const pivot = toWorld(e.clientX, e.clientY);
      ML.pivotTransform(state.top, pivot[0], pivot[1], 0, k);
    }

    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
    target.addEventListener('wheel', onWheel, { passive: false });
  }

  ML.setupInput = setupInput;
})();
