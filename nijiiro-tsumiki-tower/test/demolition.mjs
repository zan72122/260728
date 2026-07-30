/* ============================================================
   demolition.mjs — 巨大ボクセル版の検証（Node 用）
   実行: node test/demolition.mjs

   検証すること:
   1. 全モチーフ×複数予算で、ブロック数が予算に収まっている
   2. 構造が接地している（宙に浮いた はぐれブロックが ほぼ無い）
   3. 💣1個で ちゃんと崩れ、崩れたあとに「宙に浮いたまま凍結」の
      ブロックが残らない（接地チェックの連鎖が正しく働く）
   ============================================================ */

import * as CANNON from '../lib/cannon-es.js';
import { buildStageSpec } from '../js/voxels.js';
import {
  PHYS, bombParams, bombEffect, gridKey, findUngrounded,
} from '../js/demolition.js';

const BUDGET = 1500;
let failures = 0;

/* ---- 1 & 2: 予算とかたち ---- */
console.log('=== 予算チェック（budget 800 / 1500 / 2500） ===');
for (const budget of [800, 1500, 2500]) {
  for (let stg = 1; stg <= 9; stg++) {
    const spec = buildStageSpec(stg, 4242 + stg, budget);
    const map = new Map();
    for (const b of spec.blocks) map.set(gridKey(b.g[0], b.g[1], b.g[2]), b);
    const orphans = findUngrounded(map).length;
    const okCount = spec.count >= budget * 0.35 && spec.count <= budget * 1.3;
    const okOrphan = orphans <= spec.count * 0.02;
    if (!okCount || !okOrphan) failures++;
    if (budget === BUDGET || !okCount || !okOrphan) {
      console.log(
        `  b=${budget} stage ${stg} ${spec.icon} ${spec.name.padEnd(9, '　')} ` +
        `count=${String(spec.count).padStart(4)} V=${spec.V.toFixed(2)} ` +
        `devices=${spec.devices} orphans=${orphans} ` +
        (okCount && okOrphan ? 'OK' : `★★ NG (count:${okCount} orphan:${okOrphan}) ★★`)
      );
    }
  }
}

/* ---- 3: 💣で崩れる & 浮遊ブロックが残らない ---- */
console.log('\n=== 💣 解体シミュレーション（main.js と同じ凍結方式） ===');

function simulateBomb(spec) {
  const V = spec.V;
  const BP = bombParams(V);
  const mass = V * V * V * PHYS.density;

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

  const shape = new CANNON.Box(new CANNON.Vec3(V / 2, V / 2, V / 2));
  const gridMap = new Map();
  const dynSet = new Set();
  const blocks = spec.blocks.map((bs, i) => {
    const block = {
      i, g: bs.g, home: bs.p, y0: bs.p[1], state: 'frozen', body: null,
    };
    gridMap.set(gridKey(bs.g[0], bs.g[1], bs.g[2]), block);
    return block;
  });

  function attachBody(block, dynamic) {
    if (block.body) return block.body;
    const body = new CANNON.Body({
      mass: dynamic ? mass : 0,
      type: dynamic ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
      material: matBlock, shape,
    });
    body.position.set(block.home[0], block.home[1], block.home[2]);
    body.allowSleep = true;
    body.sleepSpeedLimit = PHYS.sleepSpeedLimit;
    body.sleepTimeLimit = PHYS.sleepTimeLimit;
    body.__block = block;
    body.addEventListener('collide', (e) => {
      const me = e.target.__block;
      if (!me) return;
      if ((me.state === 'frozen' || me.state === 'rubble') &&
          Math.abs(e.contact.getImpactVelocityAlongNormal()) > 2.4) {
        const other = e.body.__block;
        if (other && other.state === 'dynamic') makeDynamic(me);
      }
    });
    body.addEventListener('sleep', (e) => {
      const b = e.target.__block;
      if (!b || b.state !== 'dynamic') return;
      e.target.type = CANNON.Body.STATIC;
      e.target.mass = 0;
      e.target.updateMassProperties();
      e.target.velocity.setZero();
      e.target.angularVelocity.setZero();
      b.state = 'rubble';
      dynSet.delete(b);
    });
    world.addBody(body);
    block.body = body;
    return body;
  }
  function makeDynamic(block) {
    if (block.state === 'gone' || block.state === 'dynamic') return;
    if (block.state === 'frozen') gridMap.delete(gridKey(block.g[0], block.g[1], block.g[2]));
    const body = attachBody(block, true);
    if (body.type !== CANNON.Body.DYNAMIC) {
      body.type = CANNON.Body.DYNAMIC;
      body.mass = mass;
      body.updateMassProperties();
    }
    body.wakeUp();
    block.state = 'dynamic';
    dynSet.add(block);
  }
  function removeBlock(block) {
    if (block.state === 'frozen') gridMap.delete(gridKey(block.g[0], block.g[1], block.g[2]));
    if (block.body) { world.removeBody(block.body); block.body = null; }
    dynSet.delete(block);
    block.state = 'gone';
  }

  // 凍結ブロック全員に静的ボディ（テストでは負荷を気にしない）
  for (const b of blocks) attachBody(b, false);

  // 爆心：下のほうの層から 3 か所（中央 + 左右）
  // 実プレイは装置 10 個以上なので、これでも控えめな検証
  const lows = blocks.filter((b) => b.y0 > V * 0.8 && b.y0 < V * 3.5);
  lows.sort((a, b2) => a.home[0] - b2.home[0]);
  const targets = [
    lows[Math.floor(lows.length * 0.2)],
    lows[Math.floor(lows.length * 0.5)],
    lows[Math.floor(lows.length * 0.8)],
  ].filter(Boolean);

  for (const target of targets) {
    if (target.state === 'gone') continue;
    const center = [...target.home];
    for (const b of blocks) {
      if (b === target || b.state === 'gone') continue;
      const pos = b.body ? [b.body.position.x, b.body.position.y, b.body.position.z] : b.home;
      const eff = bombEffect(BP, center, pos, mass, 0.5);
      if (!eff) continue;
      if (eff === 'break') { removeBlock(b); continue; }
      makeDynamic(b);
      b.body.applyImpulse(new CANNON.Vec3(eff[0], eff[1], eff[2]));
    }
    removeBlock(target);
  }

  // 6秒シミュレーション + 0.35秒ごとの接地チェック
  let maxDyn = 0;
  const t0 = Date.now();
  for (let step = 0; step < 360; step++) {
    world.step(1 / 60);
    maxDyn = Math.max(maxDyn, dynSet.size);
    if (step % 21 === 20) {
      for (const key of findUngrounded(gridMap)) {
        const b = gridMap.get(key);
        if (b) makeDynamic(b);
      }
    }
  }
  const simMs = Date.now() - t0;

  // スコア（くずれた高さの割合）
  let sum = 0, total = 0;
  for (const b of blocks) {
    if (b.y0 < V * 0.6) continue;
    total += b.y0;
    if (b.state === 'gone') sum += b.y0;
    else if (b.state === 'frozen') continue;
    else sum += Math.max(0, Math.min(b.y0, b.y0 - b.body.position.y));
  }
  const score = total > 0 ? sum / total : 0;
  const floating = findUngrounded(gridMap).length;

  return { score, floating, maxDyn, simMs, count: blocks.length };
}

for (let stg = 1; stg <= 9; stg++) {
  const spec = buildStageSpec(stg, 4242 + stg, BUDGET);
  const r = simulateBomb(spec);
  const okScore = r.score > 0.08;
  const okFloat = r.floating === 0;
  if (!okScore || !okFloat) failures++;
  console.log(
    `  stage ${stg} ${spec.icon} ${spec.name.padEnd(9, '　')} ` +
    `count=${String(r.count).padStart(4)} score=${(r.score * 100).toFixed(1)}% ` +
    `浮遊=${r.floating} 最大動的=${String(r.maxDyn).padStart(4)} ` +
    `sim=${r.simMs}ms ` +
    (okScore && okFloat ? 'OK' : `★★ NG (score:${okScore} float:${okFloat}) ★★`)
  );
}

console.log(failures === 0 ? '\nすべて合格 ✔' : `\n不合格 ${failures} 件 ✘`);
process.exit(failures === 0 ? 0 : 1);
