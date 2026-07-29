// ちいさな補間ヘルパー群。毎フレーム updateTweens(dt) を呼ぶだけで動く。

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

/** フレームレートに依存しない追従。lambda が大きいほど速く寄る。 */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

const active = [];

/**
 * @param {object} opts
 * @param {number} opts.duration 秒
 * @param {(t:number)=>void} opts.onUpdate 0→1 のイージング済みの値
 * @param {()=>void} [opts.onComplete]
 */
export function tween({ duration, onUpdate, onComplete, ease = easeInOutQuad, delay = 0 }) {
  const entry = { duration, onUpdate, onComplete, ease, delay, elapsed: 0, killed: false };
  active.push(entry);
  return () => { entry.killed = true; };
}

export function updateTweens(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const e = active[i];
    if (e.killed) { active.splice(i, 1); continue; }
    if (e.delay > 0) { e.delay -= dt; continue; }
    e.elapsed += dt;
    const t = clamp(e.elapsed / e.duration, 0, 1);
    e.onUpdate(e.ease(t));
    if (t >= 1) {
      active.splice(i, 1);
      e.onComplete?.();
    }
  }
}

export function clearTweens() {
  active.length = 0;
}
