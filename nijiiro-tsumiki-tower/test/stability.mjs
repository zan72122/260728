/* ============================================================
   stability.mjs — タワー安定性の物理検証（Node 用）
   実行: node test/stability.mjs

   検証すること:
   1. 全ステージのタワーは「全ブロックを起こしても」自立し続ける
      （プレイヤーが何もしなければ絶対に崩れない）
   2. 土台付近のブロックを⭐で消すと、ちゃんと崩れが起きる
      （シールに意味がある）
   ============================================================ */

import * as CANNON from '../lib/cannon-es.js';
import { buildTowerSpec, PHYS, U, BOMB } from '../js/towers.js';

function createWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  const matBlock = new CANNON.Material('block');
  const matGround = new CANNON.Material('ground');
  world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matBlock,
    { friction: PHYS.frictionBlock, restitution: PHYS.restitution }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matGround,
    { friction: PHYS.frictionGround, restitution: PHYS.restitution }));
  const ground = new CANNON.Body({ mass: 0, material: matGround, shape: new CANNON.Plane() });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(ground);
  return { world, matBlock };
}

function makeBodies(spec, world, matBlock) {
  const bodies = [];
  for (const bs of spec.blocks) {
    let shape, mass;
    if (bs.kind === 'box') {
      shape = new CANNON.Box(new CANNON.Vec3(bs.s[0] / 2, bs.s[1] / 2, bs.s[2] / 2));
      mass = bs.s[0] * bs.s[1] * bs.s[2] * PHYS.density;
    } else {
      shape = new CANNON.Cylinder(bs.s[0] * 0.12, bs.s[0] * 0.85, bs.s[1] * 0.95, 10);
      mass = (Math.PI * bs.s[0] ** 2 * bs.s[1] / 3) * PHYS.density;
    }
    const body = new CANNON.Body({ mass, material: matBlock, shape });
    body.position.set(bs.p[0], bs.p[1], bs.p[2]);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), bs.ry || 0);
    body.allowSleep = true;
    body.sleepSpeedLimit = PHYS.sleepSpeedLimit;
    body.sleepTimeLimit = PHYS.sleepTimeLimit;
    world.addBody(body);
    body.sleep();
    bodies.push({ body, y0: bs.p[1] });
  }
  return bodies;
}

function simulate(world, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) world.step(1 / 60);
}

function dropScore(bodies) {
  let sum = 0, total = 0;
  for (const b of bodies) {
    if (b.y0 < U * 0.6) continue;
    total += b.y0;
    if (b.removed) sum += b.y0;
    else sum += Math.max(0, Math.min(b.y0, b.y0 - b.body.position.y));
  }
  return total > 0 ? sum / total : 0;
}

function maxDrift(bodies) {
  let d = 0;
  for (const b of bodies) {
    if (b.removed) continue;
    const dx = b.body.position.x - b.body.initPosition.x;
    const dy = b.body.position.y - b.body.initPosition.y;
    const dz = b.body.position.z - b.body.initPosition.z;
    d = Math.max(d, Math.hypot(dx, dy, dz));
  }
  return d;
}

let failures = 0;
console.log('=== にじいろつみきタワー 物理検証 ===\n');

for (let stg = 1; stg <= 10; stg++) {
  const spec = buildTowerSpec(stg, 12345 + stg * 777);

  // --- 検証1: 全員起こして 10 秒 → 崩れないこと ---
  {
    const { world, matBlock } = createWorld();
    const bodies = makeBodies(spec, world, matBlock);
    for (const b of bodies) b.body.initPosition = b.body.position.clone();
    for (const b of bodies) b.body.wakeUp();
    simulate(world, 10);
    const drift = maxDrift(bodies);
    const score = dropScore(bodies);
    const ok = drift < 0.3 && score < 0.03;
    if (!ok) failures++;
    console.log(
      `stage ${String(stg).padStart(2)} ${spec.icon} ${spec.name.padEnd(10, '　')} ` +
      `blocks=${String(spec.blocks.length).padStart(3)} ` +
      `[安定性] drift=${drift.toFixed(3)} score=${(score * 100).toFixed(1)}% ` +
      (ok ? 'OK' : '★★ NG: 勝手に崩れる ★★')
    );
  }

  // --- 検証2: 💣 1 個で「しっかり崩せる置き場所」が存在すること ---
  //     （main.js の explode() と同じ BOMB 定数・同じインパルス式。
  //       低層の候補地点を数か所ためして 最良スコアで判定する。
  //       置き場所によって結果が変わるのは ゲームとして正しい分散）
  {
    function bombAt(targetIndex) {
      const { world, matBlock } = createWorld();
      const bodies = makeBodies(spec, world, matBlock);
      const target = bodies[targetIndex];
      const center = target.body.position.clone();
      for (const b of bodies) b.body.wakeUp();
      for (const b of bodies) {
        if (b === target) continue;
        const d = b.body.position.distanceTo(center);
        if (d > BOMB.radius) continue;
        if (d < BOMB.breakRadius) {          // 爆心のそばは 粉砕
          world.removeBody(b.body);
          b.removed = true;
          continue;
        }
        const falloff = 1 - d / BOMB.radius;
        const dir = b.body.position.vsub(center);
        if (dir.length() < 0.01) dir.set(0.5, 0.5, 0.5);
        dir.normalize();
        dir.y += BOMB.upward;
        b.body.applyImpulse(dir.scale(b.body.mass * BOMB.power * falloff));
      }
      world.removeBody(target.body);
      target.removed = true;
      simulate(world, 8);
      return dropScore(bodies);
    }

    // 候補：下から 2 層ぶんの ブロック（間引いて最大 6 か所）
    const lowIdx = spec.blocks
      .map((bs, i) => ({ bs, i }))
      .filter(({ bs }) => bs.p[1] > U * 0.2 && bs.p[1] < U * 2.2)
      .map(({ i }) => i);
    const step = Math.max(1, Math.floor(lowIdx.length / 6));
    const candidates = lowIdx.filter((_, k) => k % step === 0).slice(0, 6);

    let best = 0;
    for (const idx of candidates) best = Math.max(best, bombAt(idx));
    const ok = best > 0.15;
    if (!ok) failures++;
    console.log(
      `                                   ` +
      `[💣×1  ] best=${(best * 100).toFixed(1)}% (${candidates.length}か所ためし) ` +
      (ok ? 'OK: 崩れが発生' : '△ NG: 崩れがよわい')
    );
  }
}

console.log(failures === 0 ? '\nすべて合格 ✔' : `\n不合格 ${failures} 件 ✘`);
process.exit(failures === 0 ? 0 : 1);
