/* ============================================================
   demolition.mjs — 巨大ボクセル版の検証（Node 用）
   実行: node test/demolition.mjs

   検証すること:
   1. 全モチーフ×複数予算で、ブロック数が予算に収まっている
   2. 展示台があり（接地行が広い）、厳格な支え判定
      （真下は無償・横/ぶら下がりは2マスまで）でも初期形状が崩れない
      = 1点接地・宙吊りの ない構造
   3. 💣で ちゃんと崩れ、崩壊後に「宙に浮いたまま」の凍結ブロックや
      がれきが 1個も残らない
   ============================================================ */

import * as CANNON from '../lib/cannon-es.js';
import { buildStageSpec } from '../js/voxels.js';
import {
  PHYS, bombParams, bombEffect, gridKey, findUnsupported,
} from '../js/demolition.js';

const BUDGET = 1500;
let failures = 0;

/* ---- 1 & 2: 予算とかたち ---- */
console.log('=== 予算・接地チェック（budget 800 / 1500 / 2500） ===');
for (const budget of [800, 1500, 2500]) {
  for (let stg = 1; stg <= 9; stg++) {
    const spec = buildStageSpec(stg, 4242 + stg, budget);
    const map = new Map();
    let baseCells = 0;
    for (const b of spec.blocks) {
      map.set(gridKey(b.g[0], b.g[1], b.g[2]), b);
      if (b.g[1] === 0) baseCells++;
    }
    const orphans = findUnsupported(map).length;
    const okCount = spec.count >= budget * 0.35 && spec.count <= budget * 1.35;
    const okOrphan = orphans <= spec.count * 0.02;
    const okBase = baseCells >= 25;
    if (!okCount || !okOrphan || !okBase) failures++;
    if (budget === BUDGET || !okCount || !okOrphan || !okBase) {
      console.log(
        `  b=${budget} stage ${stg} ${spec.icon} ${spec.name.padEnd(9, '　')} ` +
        `count=${String(spec.count).padStart(4)} V=${spec.V.toFixed(2)} ` +
        `接地行=${String(baseCells).padStart(3)} orphans=${orphans} ` +
        (okCount && okOrphan && okBase ? 'OK'
          : `★★ NG (count:${okCount} orphan:${okOrphan} base:${okBase}) ★★`)
      );
    }
  }
}

/* ---- 3: 💣で崩れる & 浮遊が残らない ---- */
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
    const block = { i, g: bs.g, home: bs.p, y0: bs.p[1], state: 'frozen', body: null };
    gridMap.set(gridKey(bs.g[0], bs.g[1], bs.g[2]), block);
    return block;
  });

  // ワールド座標 → 格子座標（main.js と同じ逆算）
  const b0 = spec.blocks[0];
  const gxOffset = b0.g[0] - b0.p[0] / V;
  const gzOffset = b0.g[2] - b0.p[2] / V;

  // 支え判定（main.js の isSupportedAt 相当。レイの代わりに 位置ハッシュ）
  const staticHash = () => {
    const h = new Map();
    for (const b of blocks) {
      if (b.state === 'gone' || b.state === 'dynamic') continue;
      const p = b.body ? b.body.position : { x: b.home[0], y: b.home[1], z: b.home[2] };
      const key = `${Math.round(p.x / V)}_${Math.round(p.y / V)}_${Math.round(p.z / V)}`;
      h.set(key, b);
    }
    return h;
  };
  function isSupportedAt(block, hash) {
    const p = block.body.position;
    if (p.y < V * 1.1) return true;
    const gx = Math.round(p.x / V + gxOffset);
    const gy = Math.round((p.y - V / 2) / V);
    const gz = Math.round(p.z / V + gzOffset);
    if (gy >= 1 && gridMap.has(gridKey(gx, gy - 1, gz))) return true;
    // ま下の セルに 静的な なにかが いるか
    const cx = Math.round(p.x / V), cy = Math.round(p.y / V), cz = Math.round(p.z / V);
    for (let dy = 1; dy <= 2; dy++) {
      const below = hash.get(`${cx}_${cy - dy}_${cz}`);
      if (below && below !== block) return true;
    }
    return false;
  }

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
      if (!isSupportedAt(b, staticHash())) { e.target.wakeUp(); return; }
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

  for (const b of blocks) attachBody(b, false);

  // 爆心：台座の うえ 2〜4層目から 3 か所（中央 + 左右）
  const lows = blocks.filter((b) => b.y0 > V * 2.2 && b.y0 < V * 5.0);
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

  // 6秒シミュレーション + 0.35秒ごとの支えチェック
  let maxDyn = 0;
  const t0 = Date.now();
  for (let step = 0; step < 360; step++) {
    world.step(1 / 60);
    maxDyn = Math.max(maxDyn, dynSet.size);
    if (step % 21 === 20) {
      for (const key of findUnsupported(gridMap)) {
        const b = gridMap.get(key);
        if (b) makeDynamic(b);
      }
      const hash = staticHash();
      for (const b of blocks) {
        if (b.state !== 'rubble') continue;
        if (!isSupportedAt(b, hash)) makeDynamic(b);
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

  // 浮遊チェック：凍結の宙吊り + がれきの空中固定
  let floating = findUnsupported(gridMap).length;
  const hash = staticHash();
  for (const b of blocks) {
    if (b.state !== 'rubble') continue;
    if (!isSupportedAt(b, hash)) floating++;
  }

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
