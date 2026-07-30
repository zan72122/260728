/* perf.js — デバイス性能に応じた動的ブロック上限
 * 起動直後（タイトル画面表示中）に軽量なマイクロベンチを非同期実行し、
 * 物理エンジンの負荷とレンダリングFPSからデバイスの性能tierを推定する。
 * UIをブロックしないよう requestIdleCallback / setTimeout で処理を分割する。
 * 結果は localStorage にキャッシュし、次回起動時はベンチを省略する。
 */
(function () {
  'use strict';

  const CACHE_KEY = 'demol_perf_v1';

  const CAPS = {
    low: { maxBlocks: 600, activeMax: 180 },
    mid: { maxBlocks: 1500, activeMax: 280 },
    high: { maxBlocks: 3000, activeMax: 400 },
  };

  /* ベンチ完了前のデフォルトは安全側: {maxBlocks:600, activeMax:280} */
  const perf = {
    tier: 'mid',
    maxBlocks: 600,
    activeMax: 280,
    ready: false,      /* boolean プロパティ（ベンチ完了/キャッシュ適用でtrueになる） */
    measured: null,    /* {physMs, fps} プロパティ（計測前はnull） */
  };

  perf.override = function (partial) {
    if (!partial) return;
    if (partial.maxBlocks != null) perf.maxBlocks = partial.maxBlocks;
    if (partial.activeMax != null) perf.activeMax = partial.activeMax;
    if (partial.tier != null) perf.tier = partial.tier;
    perf.ready = true;
  };

  function applyTier(tier, measured) {
    const caps = CAPS[tier] || CAPS.mid;
    perf.tier = tier;
    perf.maxBlocks = caps.maxBlocks;
    perf.activeMax = caps.activeMax;
    perf.measured = measured || perf.measured;
    perf.ready = true;
    const physMs = measured && measured.physMs != null ? measured.physMs.toFixed(2) : '?';
    const fps = measured && measured.fps != null ? Math.round(measured.fps) : '?';
    console.log('[perf] tier=' + tier + ' phys=' + physMs + 'ms fps=' + fps);
  }

  function decideTier(physMsPerStep, fps) {
    if (physMsPerStep < 2 && fps > 50) return 'high';
    if (physMsPerStep > 6 || fps < 25) return 'low';
    return 'mid';
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !CAPS[data.tier]) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(tier, measured) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ tier, measured, v: 1 }));
    } catch (e) {
      /* ignore (private mode等) */
    }
  }

  function idle(fn, timeout) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: timeout || 200 });
    } else {
      setTimeout(fn, 0);
    }
  }

  /* ---------- 物理ベンチ ---------- */
  /* 画面外でMatter.Engineを作り、120個の44px箱を積んでEngine.updateを60ステップ実行。
   * メインスレッドを長時間占有しないよう、生成とステップ実行をアイドルコールバックに分割する。 */
  function runPhysicsBench(callback) {
    if (typeof window.Matter === 'undefined') {
      callback(null);
      return;
    }
    const Matter = window.Matter;
    idle(function () {
      let engine, world, bodies;
      try {
        engine = Matter.Engine.create();
        world = engine.world;
        engine.gravity.y = 1;
        bodies = [];
        const cols = 12;
        for (let i = 0; i < 120; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const box = Matter.Bodies.rectangle(
            -9999 + col * 44, -9999 + row * 44, 44, 44
          );
          bodies.push(box);
        }
        Matter.World.add(world, bodies);
        const ground = Matter.Bodies.rectangle(-9999 + 6 * 44, -9999 + 400, 44 * 14, 40, { isStatic: true });
        Matter.World.add(world, ground);
      } catch (e) {
        callback(null);
        return;
      }

      let step = 0;
      const totalSteps = 60;
      let elapsed = 0;

      function runChunk() {
        const chunkStart = performance.now();
        const chunkEnd = chunkStart + 8; /* 1チャンクあたり最大8ms程度に抑える */
        while (step < totalSteps && performance.now() < chunkEnd) {
          const t0 = performance.now();
          Matter.Engine.update(engine, 1000 / 60);
          const t1 = performance.now();
          elapsed += (t1 - t0);
          step++;
        }
        if (step < totalSteps) {
          idle(runChunk, 100);
        } else {
          try {
            Matter.World.clear(world, false);
            Matter.Engine.clear(engine);
          } catch (e) { /* ignore */ }
          const msPerStep = elapsed / totalSteps;
          callback(msPerStep);
        }
      }
      idle(runChunk, 200);
    }, 200);
  }

  /* ---------- 描画ベンチ ---------- */
  /* 既存のレンダーループには一切割り込まず、自前のrAFカウンタで並走測定する。 */
  function runFpsBench(durationMs, callback) {
    let frames = 0;
    let start = null;
    let done = false;

    function tick(ts) {
      if (start === null) start = ts;
      frames++;
      const elapsed = ts - start;
      if (elapsed >= durationMs) {
        if (!done) {
          done = true;
          const fps = frames / (elapsed / 1000);
          callback(fps);
        }
        return;
      }
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  /* ---------- ベンチ実行 ---------- */
  function runFullBench() {
    runPhysicsBench(function (physMs) {
      const safePhysMs = physMs == null ? 8 : physMs; /* 物理ベンチ不可なら安全側扱い */
      runFpsBench(2500, function (fps) {
        const tier = decideTier(safePhysMs, fps);
        const measured = { physMs: safePhysMs, fps: fps };
        applyTier(tier, measured);
        writeCache(tier, measured);
      });
    });
  }

  /* キャッシュがあればベンチを省略、なければ非同期でベンチを開始 */
  const cached = readCache();
  if (cached) {
    idle(function () {
      applyTier(cached.tier, cached.measured);
    }, 50);
  } else {
    /* タイトル画面表示を優先し、少し遅らせてから開始 */
    setTimeout(runFullBench, 50);
  }

  window.GamePerf = perf;
})();
