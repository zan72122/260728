/**
 * 物理挙動の確認スクリプト（ブラウザ不要）。
 *   node scripts/sim-check.mjs [room] [seed] [strength] [anchor...]
 *   node scripts/sim-check.mjs sweep          # 全部屋×全強さの要約
 *
 * - 各オブジェクトの移動量・床への着地点・転倒イベントを表示
 * - 同じ条件で2回実行し、結果が完全一致するか（決定論）を検証
 */
import { createQuakeScript } from '../src/core/quake.js';
import { simulateQuake, findDangerEvents } from '../src/core/simulate.js';
import { BEAR } from '../src/core/layout.js';
import { ROOMS, getRoom } from '../src/core/roomRegistry.js';

const PROBES = {
  kids: [
    { name: 'start(rug)   ', x: 0.62, z: 0.32 },
    { name: 'book dropzone', x: -0.58, z: -1.55 },
    { name: 'beside desk  ', x: -0.28, z: -1.2 },
    { name: 'under desk   ', x: -1.12, z: -1.36 },
    { name: 'far corner   ', x: 1.6, z: 1.5 },
  ],
  bedroom: [
    { name: 'start        ', x: 0.55, z: 0.75 },
    { name: 'front dresser', x: 0.62, z: -1.35 },
    { name: 'beside dresser', x: 1.35, z: -1.5 },
    { name: 'on bed(futon)', x: -1.5, z: 0.35 },
    { name: 'far corner   ', x: 1.6, z: 1.5 },
  ],
  living: [
    { name: 'start(rug)   ', x: 0.35, z: 0.45 },
    { name: 'front tv     ', x: -0.68, z: -1.35 },
    { name: 'front cabinet', x: -1.25, z: -0.42 },
    { name: 'on sofa      ', x: 1.25, z: 0.62 },
    { name: 'rug center   ', x: 0.15, z: 0.1 },
  ],
  kitchen: [
    { name: 'start        ', x: 0.25, z: 0.85 },
    { name: 'front hutch  ', x: -1.05, z: -1.35 },
    { name: 'front counter', x: -0.5, z: -1.45 },
    { name: 'under table  ', x: 0.72, z: -0.18 },
    { name: 'far corner   ', x: -1.6, z: 1.5 },
  ],
};

function run(room, seed, strength, anchors) {
  const script = createQuakeScript(seed, strength);
  const recA = simulateQuake(room, script, anchors);
  const recB = simulateQuake(room, script, anchors);
  let maxDiff = 0;
  for (const [id, a] of recA.frames) {
    const b = recB.frames.get(id);
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }
  return { rec: recA, maxDiff };
}

function summarize(room, rec, verbose) {
  const moved = [];
  const fell = [];
  for (const spec of rec.specs) {
    const arr = rec.frames.get(spec.id);
    const o = (rec.frameCount - 1) * 7;
    const d = Math.hypot(arr[o] - spec.pos.x, arr[o + 2] - spec.pos.z);
    const dropped = spec.pos.y - arr[o + 1] > 0.25;
    if (dropped) fell.push(spec.id);
    else if (d > 0.12) moved.push(spec.id);
    if (verbose) {
      console.log(
        `  ${spec.id.padEnd(11)} (${spec.pos.x.toFixed(2)},${spec.pos.y.toFixed(2)},${spec.pos.z.toFixed(2)})` +
          ` -> (${arr[o].toFixed(2)},${arr[o + 1].toFixed(2)},${arr[o + 2].toFixed(2)})`,
      );
    }
  }
  const tips = rec.tipEvents.map((t) => `${t.id}@f${t.startFrame}->(${t.restX.toFixed(2)},${t.restZ.toFixed(2)})`);
  return { moved, fell, tips };
}

function probeReport(room, rec) {
  for (const p of PROBES[room.id] ?? []) {
    const ev = findDangerEvents(room, rec, p, BEAR.radius, BEAR.height);
    console.log(
      `  ${p.name} -> ${ev.length ? ev.map((e) => `${e.id}@f${e.frame}`).join(',') : 'SAFE'}`,
    );
  }
}

if (process.argv[2] === 'sweep') {
  const seed = Number(process.argv[3] ?? 13);
  for (const room of ROOMS) {
    for (let strength = 0; strength < 3; strength++) {
      for (const anchors of room.tippables?.length
        ? [new Set(), new Set(room.tippables.map((t) => t.id))]
        : [new Set()]) {
        const { rec, maxDiff } = run(room, seed, strength, anchors);
        const { moved, fell, tips } = summarize(room, rec, false);
        console.log(
          `${room.id.padEnd(8)} str=${strength} anchor=${anchors.size ? 'ON ' : 'off'} ` +
            `det=${maxDiff === 0 ? 'OK' : 'NG!'} fell=[${fell.join(',')}] tips=[${tips.join(',')}]`,
        );
      }
    }
  }
} else {
  const room = getRoom(process.argv[2] ?? 'kids');
  const seed = Number(process.argv[3] ?? 13);
  const strength = Number(process.argv[4] ?? 1);
  const anchors = new Set(process.argv.slice(5));
  const { rec, maxDiff } = run(room, seed, strength, anchors);
  console.log(
    `room=${room.id} seed=${seed} strength=${strength} anchors=[${[...anchors]}] det=${maxDiff === 0 ? 'OK(bit-exact)' : 'NG! ' + maxDiff}`,
  );
  const { moved, fell, tips } = summarize(room, rec, true);
  console.log(`fell=[${fell.join(',')}] movedOnly=[${moved.join(',')}] tips=[${tips.join(',')}]`);
  console.log('--- landings ---');
  for (const [id, l] of rec.landings) {
    console.log(`  ${id.padEnd(11)} step=${l.step} at (${l.x.toFixed(2)}, ${l.z.toFixed(2)})`);
  }
  console.log('--- bear probes ---');
  probeReport(room, rec);
}
