// Loop.js — requestAnimationFrame driver.
//
// - Clamps the per-frame delta to 1/20s so a slow frame, a GC pause, or a
//   tab coming back from the background never hands the caller a huge dt.
// - Pauses stepping entirely while `document.hidden` is true (rAF itself
//   keeps ticking — heavily throttled by the browser in background tabs —
//   purely so we notice when visibility returns; no game/render work runs
//   while hidden).

const MAX_DT = 1 / 20; // seconds

export function createLoop(step) {
  let rafId = null;
  let running = false;
  let lastTime = 0;
  let elapsed = 0;

  function frame(now) {
    rafId = requestAnimationFrame(frame);

    if (document.hidden) {
      // Keep the clock fresh so resuming doesn't produce one giant dt.
      lastTime = now;
      return;
    }

    let dt = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;

    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_DT);

    elapsed += dt;
    step(dt, elapsed);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return { start, stop };
}
