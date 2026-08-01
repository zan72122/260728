/**
 * 物理挙動の確認スクリプト（ブラウザ不要）。
 *   node scripts/sim-check.mjs [seed]
 *
 * - 各オブジェクトの最終位置と床への着地点を表示
 * - 同じシードで2回実行し、結果が完全一致するか（決定論）を検証
 */
import { createQuakeScript } from '../src/core/quake.js';
import { simulateQuake, findDangerEvents } from '../src/core/simulate.js';
import { BEAR, DESK, isUnderDesk } from '../src/core/layout.js';

const seed = Number(process.argv[2] ?? 1);
const script = createQuakeScript(seed);

console.log(`seed=${seed} duration=${script.duration.toFixed(2)}s steps=${script.steps}`);

const recA = simulateQuake(script);
const recB = simulateQuake(script);

let maxDiff = 0;
for (const [id, a] of recA.frames) {
  const b = recB.frames.get(id);
  for (let i = 0; i < a.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }
}
console.log(`determinism max diff: ${maxDiff} ${maxDiff === 0 ? 'OK(bit-exact)' : maxDiff < 1e-9 ? 'OK' : 'NG!'}`);

console.log('\n--- final positions (x, y, z) ---');
for (const spec of recA.specs) {
  const arr = recA.frames.get(spec.id);
  const o = (recA.frameCount - 1) * 7;
  const start = spec.pos;
  const moved = Math.hypot(arr[o] - start.x, arr[o + 2] - start.z);
  console.log(
    `${spec.id.padEnd(9)} start(${start.x.toFixed(2)},${start.y.toFixed(2)},${start.z.toFixed(2)})` +
      ` -> end(${arr[o].toFixed(2)},${arr[o + 1].toFixed(2)},${arr[o + 2].toFixed(2)}) movedXZ=${moved.toFixed(2)}`,
  );
}

console.log('\n--- floor landings ---');
for (const [id, l] of recA.landings) {
  console.log(`${id.padEnd(9)} step=${l.step} at (${l.x.toFixed(2)}, ${l.z.toFixed(2)})`);
}

console.log('\n--- impacts on desk ---');
for (const imp of recA.impacts.filter((i) => i.surface === 'desk')) {
  console.log(
    `${imp.id.padEnd(9)} step=${imp.step} speed=${imp.speed.toFixed(1)} at (${imp.x.toFixed(2)}, ${imp.y.toFixed(2)}, ${imp.z.toFixed(2)})`,
  );
}

console.log('\n--- bear safety probes ---');
const probes = [
  { name: 'start(rug)  ', x: BEAR.startPos.x, z: BEAR.startPos.z },
  { name: 'front of desk', x: DESK.pos.x, z: DESK.pos.z + DESK.depth / 2 + 0.22 },
  { name: 'book dropzone', x: -0.58, z: -1.55 },
  { name: 'beside desk ', x: -0.28, z: -1.2 },
  { name: 'under desk  ', x: DESK.pos.x, z: DESK.pos.z },
  { name: 'far corner  ', x: 1.6, z: 1.5 },
];
for (const p of probes) {
  const events = findDangerEvents(recA, p, BEAR.radius, BEAR.height);
  console.log(
    `${p.name} (${p.x.toFixed(2)},${p.z.toFixed(2)}) underDesk=${isUnderDesk(p.x, p.z)} ` +
      `danger=${events.length ? events.map((e) => `${e.id}@f${e.frame}`).join(',') : 'SAFE'}`,
  );
}
