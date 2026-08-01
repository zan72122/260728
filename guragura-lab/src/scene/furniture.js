import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DESK, SHELF, CUSHION } from '../core/layout.js';
import { PALETTE, makeStandard } from './materials.js';

/** 丈夫そうな低い机 */
export function buildDesk() {
  const g = new THREE.Group();
  const topMat = makeStandard(PALETTE.deskWood, { roughness: 0.75 });
  const legMat = makeStandard(PALETTE.deskLeg, { roughness: 0.8 });

  const top = new THREE.Mesh(
    new RoundedBoxGeometry(DESK.width, DESK.topThickness, DESK.depth, 3, 0.035),
    topMat,
  );
  top.position.y = DESK.topY - DESK.topThickness / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  const legH = DESK.topY - DESK.topThickness;
  const legOffX = DESK.width / 2 - DESK.legSize / 2 - 0.03;
  const legOffZ = DESK.depth / 2 - DESK.legSize / 2 - 0.03;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(
        new RoundedBoxGeometry(DESK.legSize, legH, DESK.legSize, 2, 0.03),
        legMat,
      );
      leg.position.set(sx * legOffX, legH / 2, sz * legOffZ);
      leg.castShadow = true;
      g.add(leg);
    }
  }
  g.position.set(DESK.pos.x, 0, DESK.pos.z);
  return g;
}

/** 本棚（飾りの本つき） */
export function buildShelf() {
  const g = new THREE.Group();
  const bodyMat = makeStandard(PALETTE.shelfBody, { roughness: 0.85 });
  const trimMat = makeStandard(PALETTE.shelfTrim, { roughness: 0.85 });
  const bt = SHELF.boardThickness;

  const side = new RoundedBoxGeometry(bt, SHELF.height, SHELF.depth, 2, 0.02);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(side, bodyMat);
    s.position.set(sx * (SHELF.width / 2 - bt / 2), SHELF.height / 2, 0);
    s.castShadow = true;
    s.receiveShadow = true;
    g.add(s);
  }
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(SHELF.width, SHELF.height, bt),
    bodyMat,
  );
  back.position.set(0, SHELF.height / 2, -SHELF.depth / 2 + bt / 2);
  back.receiveShadow = true;
  g.add(back);

  const boardGeo = new RoundedBoxGeometry(SHELF.width - bt * 2, bt, SHELF.depth, 2, 0.015);
  for (const y of [bt / 2, ...SHELF.shelfYs.map((v) => v - bt / 2)]) {
    const b = new THREE.Mesh(boardGeo, bodyMat);
    b.position.set(0, y, 0);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }
  // 天板（ピンクのトリム・角丸）
  const topBoard = new THREE.Mesh(
    new RoundedBoxGeometry(SHELF.width + 0.05, bt + 0.015, SHELF.depth + 0.04, 2, 0.025),
    trimMat,
  );
  topBoard.position.set(0, SHELF.height - bt / 2, 0);
  topBoard.castShadow = true;
  topBoard.receiveShadow = true;
  g.add(topBoard);

  // 下段の飾り本（動かない・ぎっしり詰まっていて安定）
  const colors = [0xffb3c7, 0x9bd6f5, 0xffe08a, 0xa8e6cf, 0xcdb4f6, 0xff9db6, 0x8fd6bd];
  let x = -SHELF.width / 2 + bt + 0.05;
  let i = 0;
  while (x < SHELF.width / 2 - bt - 0.08) {
    const bw = 0.05 + ((i * 37) % 23) / 1000;
    const bh = 0.24 + ((i * 53) % 60) / 1000;
    const book = new THREE.Mesh(
      new RoundedBoxGeometry(bw, bh, 0.2, 1, 0.008),
      makeStandard(colors[i % colors.length], { roughness: 0.9 }),
    );
    book.position.set(x + bw / 2, SHELF.shelfYs[0] + bh / 2, 0.015);
    book.castShadow = true;
    g.add(book);
    x += bw + 0.012;
    i++;
  }
  // 中段のぬいぐるみ风ボール（飾り）
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 18, 14),
    makeStandard(0xcdb4f6, { roughness: 0.95 }),
  );
  ball.position.set(-SHELF.width / 2 + 0.22, SHELF.shelfYs[1] + 0.09, 0);
  ball.castShadow = true;
  g.add(ball);

  g.position.set(SHELF.pos.x, 0, SHELF.pos.z);
  return g;
}

/** クッション */
export function buildCushion() {
  const g = new THREE.Group();
  const mat = makeStandard(PALETTE.cushion, { roughness: 0.98 });
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(CUSHION.radius, 28, 18),
    mat,
  );
  body.scale.y = CUSHION.height / CUSHION.radius;
  body.position.y = CUSHION.height * 0.62;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const button = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 10),
    makeStandard(PALETTE.cushionButton),
  );
  button.scale.y = 0.5;
  button.position.y = CUSHION.height * 1.18;
  g.add(button);
  g.position.set(CUSHION.pos.x, 0, CUSHION.pos.z);
  return g;
}

/**
 * 動的オブジェクトのメッシュを spec から作る。
 * メッシュの原点＝物理ボディの重心。位置は毎フレーム記録から適用する。
 */
export function buildDynamicMesh(spec) {
  const g = new THREE.Group();
  if (spec.kind === 'book') {
    const cover = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 2, 0.012),
      makeStandard(spec.color, { roughness: 0.85 }),
    );
    cover.castShadow = true;
    cover.receiveShadow = true;
    g.add(cover);
    // ページ（白い中身）
    const isFlat = spec.size.y < spec.size.z;
    const pages = new THREE.Mesh(
      isFlat
        ? new THREE.BoxGeometry(spec.size.x * 0.92, spec.size.y * 0.55, spec.size.z * 0.94)
        : new THREE.BoxGeometry(spec.size.x * 0.92, spec.size.y * 0.94, spec.size.z * 0.55),
      makeStandard(0xfffdf2, { roughness: 0.95 }),
    );
    if (isFlat) pages.position.z = spec.size.z * 0.04;
    else pages.position.y = -spec.size.y * 0.02;
    g.add(pages);
    // 表紙の丸マーク
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(Math.min(spec.size.x, spec.size.y) * 0.28, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    dot.position.z = spec.size.z / 2 + 0.002;
    g.add(dot);
  } else if (spec.kind === 'lamp') {
    const h = spec.size.height;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.size.radius * 1.15, spec.size.radius * 1.3, h * 0.16, 20),
      makeStandard(PALETTE.lampBase, { roughness: 0.7 }),
    );
    base.position.y = -h / 2 + h * 0.08;
    base.castShadow = true;
    g.add(base);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.025, h * 0.45, 12),
      makeStandard(0xfff1f6, { roughness: 0.7 }),
    );
    stem.position.y = -h * 0.1;
    g.add(stem);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.size.radius * 0.55, spec.size.radius * 1.05, h * 0.42, 20, 1, true),
      makeStandard(PALETTE.lampShade, {
        roughness: 0.9,
        side: THREE.DoubleSide,
        emissive: 0xffe9a8,
        emissiveIntensity: 0.35,
      }),
    );
    shade.position.y = h * 0.28;
    shade.castShadow = true;
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff7cf }),
    );
    bulb.position.y = h * 0.16;
    g.add(bulb);
  } else {
    // 積み木
    const cube = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 2, 0.018),
      makeStandard(spec.color, { roughness: 0.85 }),
    );
    cube.castShadow = true;
    cube.receiveShadow = true;
    g.add(cube);
  }
  g.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
  if (spec.leanX) g.rotation.x = spec.leanX;
  if (spec.rotY) g.rotation.y = spec.rotY;
  return g;
}
