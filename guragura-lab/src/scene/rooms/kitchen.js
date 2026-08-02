import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HUTCH, TABLE, FRIDGE } from '../../core/rooms/kitchen.js';
import { PALETTE, makeStandard } from '../materials.js';

/** キッチンの家具（食器棚・テーブル・冷蔵庫）。火・刃物・ガラスは無い。 */
export function buildKitchenFurniture() {
  const group = new THREE.Group();

  // ---- 食器棚（下段キャビネット＋カウンター＋上段オープン棚） ----
  const hutch = new THREE.Group();
  const bodyMat = makeStandard(0xfdeef4, { roughness: 0.85 });
  const counterMat = makeStandard(PALETTE.deskWood, { roughness: 0.7 });

  const lower = new THREE.Mesh(
    new RoundedBoxGeometry(HUTCH.lowerW, HUTCH.lowerH, HUTCH.lowerD, 2, 0.03),
    bodyMat,
  );
  lower.position.y = HUTCH.lowerH / 2;
  lower.castShadow = true;
  lower.receiveShadow = true;
  hutch.add(lower);

  // とびら2枚＋とって
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(
      new RoundedBoxGeometry(HUTCH.lowerW * 0.42, HUTCH.lowerH * 0.72, 0.025, 1, 0.012),
      makeStandard(0xfff6fa, { roughness: 0.9 }),
    );
    door.position.set(side * HUTCH.lowerW * 0.23, HUTCH.lowerH * 0.42, HUTCH.lowerD / 2 + 0.005);
    hutch.add(door);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 10, 8),
      makeStandard(0xffb020, { roughness: 0.6 }),
    );
    knob.position.set(side * HUTCH.lowerW * 0.08, HUTCH.lowerH * 0.42, HUTCH.lowerD / 2 + 0.03);
    hutch.add(knob);
  }

  const counter = new THREE.Mesh(
    new RoundedBoxGeometry(HUTCH.lowerW + 0.06, 0.05, HUTCH.lowerD + 0.08, 2, 0.02),
    counterMat,
  );
  counter.position.set(0, HUTCH.lowerH + 0.025, 0.02);
  counter.castShadow = true;
  counter.receiveShadow = true;
  hutch.add(counter);

  // 上段オープン棚
  const zOff = -HUTCH.lowerD / 2 + HUTCH.shelfD / 2;
  const shelfBottom = HUTCH.lowerH + 0.05;
  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(HUTCH.shelfW, HUTCH.topH - shelfBottom, 0.04),
    bodyMat,
  );
  backPanel.position.set(0, (shelfBottom + HUTCH.topH) / 2, zOff - HUTCH.shelfD / 2 + 0.02);
  hutch.add(backPanel);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(
      new RoundedBoxGeometry(0.04, HUTCH.topH - shelfBottom, HUTCH.shelfD, 1, 0.015),
      bodyMat,
    );
    side.position.set(sx * (HUTCH.shelfW / 2 - 0.02), (shelfBottom + HUTCH.topH) / 2, zOff);
    side.castShadow = true;
    hutch.add(side);
  }
  // 棚板（物理と同じく、わずかに前傾している）
  for (const y of HUTCH.shelfYs) {
    const board = new THREE.Mesh(
      new RoundedBoxGeometry(HUTCH.shelfW - 0.08, 0.036, HUTCH.shelfD, 1, 0.012),
      bodyMat,
    );
    board.position.set(0, y - 0.018, zOff);
    board.rotation.x = 0.07;
    board.receiveShadow = true;
    hutch.add(board);
  }
  const topBoard = new THREE.Mesh(
    new RoundedBoxGeometry(HUTCH.shelfW + 0.06, 0.05, HUTCH.shelfD + 0.05, 2, 0.02),
    makeStandard(0xf9b8d0, { roughness: 0.85 }),
  );
  topBoard.position.set(0, HUTCH.topH, zOff);
  topBoard.castShadow = true;
  hutch.add(topBoard);

  hutch.position.set(HUTCH.pos.x, 0, HUTCH.pos.z);
  group.add(hutch);

  // ---- テーブル ----
  const table = new THREE.Group();
  const top = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE.size, TABLE.topThickness, TABLE.size, 3, 0.035),
    counterMat,
  );
  top.position.y = TABLE.topY - TABLE.topThickness / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const legH = TABLE.topY - TABLE.topThickness;
  const off = TABLE.size / 2 - TABLE.legSize / 2 - 0.04;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(
        new RoundedBoxGeometry(TABLE.legSize, legH, TABLE.legSize, 2, 0.03),
        makeStandard(PALETTE.deskLeg, { roughness: 0.8 }),
      );
      leg.position.set(sx * off, legH / 2, sz * off);
      leg.castShadow = true;
      table.add(leg);
    }
  }
  // テーブルクロス（丸・視覚のみ）
  const cloth = new THREE.Mesh(
    new THREE.CircleGeometry(TABLE.size * 0.36, 28),
    makeStandard(0xfff3d6, { roughness: 0.95 }),
  );
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = TABLE.topY + 0.002;
  table.add(cloth);
  table.position.set(TABLE.pos.x, 0, TABLE.pos.z);
  group.add(table);

  // ---- 冷蔵庫（飾り・マグネットつき） ----
  const fridge = new THREE.Group();
  const fridgeMat = makeStandard(0xbfe0f5, { roughness: 0.55 });
  const fbody = new THREE.Mesh(
    new RoundedBoxGeometry(FRIDGE.size.x, FRIDGE.size.y, FRIDGE.size.z, 2, 0.05),
    fridgeMat,
  );
  fbody.position.y = FRIDGE.size.y / 2;
  fbody.castShadow = true;
  fbody.receiveShadow = true;
  fridge.add(fbody);
  const split = new THREE.Mesh(
    new THREE.BoxGeometry(FRIDGE.size.x + 0.01, 0.02, 0.02),
    makeStandard(0x9cc8e8, { roughness: 0.6 }),
  );
  split.position.set(0, FRIDGE.size.y * 0.66, FRIDGE.size.z / 2);
  fridge.add(split);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8),
    makeStandard(0xfffdf5, { roughness: 0.5 }),
  );
  handle.position.set(-FRIDGE.size.x / 2 + 0.09, FRIDGE.size.y * 0.42, FRIDGE.size.z / 2 + 0.03);
  fridge.add(handle);
  // マグネット（丸いカラフルな点）
  const magColors = [0xff6b6b, 0xffb020, 0x7ed957, 0xcdb4f6];
  for (let i = 0; i < 4; i++) {
    const mag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.014, 12),
      makeStandard(magColors[i], { roughness: 0.5 }),
    );
    mag.rotation.x = Math.PI / 2;
    mag.position.set(
      -FRIDGE.size.x / 4 + (i % 2) * 0.2,
      FRIDGE.size.y * (0.75 + Math.floor(i / 2) * 0.1),
      FRIDGE.size.z / 2 + 0.008,
    );
    fridge.add(mag);
  }
  fridge.position.set(FRIDGE.pos.x, 0, FRIDGE.pos.z);
  group.add(fridge);

  return { group, handles: {} };
}
