// ちいさなトゥイーンヘルパー
const active = [];

export function tween({ duration = 1, ease = easeInOut, onUpdate, onComplete }) {
  const t = { duration, ease, onUpdate, onComplete, age: 0, done: false };
  active.push(t);
  return t;
}

export function updateTweens(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const t = active[i];
    t.age += dt;
    const p = Math.min(t.age / t.duration, 1);
    t.onUpdate?.(t.ease(p), p);
    if (p >= 1) {
      active.splice(i, 1);
      t.done = true;
      t.onComplete?.();
    }
  }
}

export function delay(seconds, fn) {
  return tween({ duration: seconds, onUpdate: () => {}, onComplete: fn });
}

export function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2; }
export function easeOut(p) { return 1 - (1 - p) ** 3; }
export function easeOutBack(p) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}
