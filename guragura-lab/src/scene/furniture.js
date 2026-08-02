import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DESK, SHELF, CUSHION } from '../core/rooms/kids.js';
import { PALETTE, makeStandard } from './materials.js';

/** 丈夫そうな低い机（こども部屋） */
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

/** 本棚（こども部屋・飾りの本つき） */
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
  const back = new THREE.Mesh(new THREE.BoxGeometry(SHELF.width, SHELF.height, bt), bodyMat);
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
  const topBoard = new THREE.Mesh(
    new RoundedBoxGeometry(SHELF.width + 0.05, bt + 0.015, SHELF.depth + 0.04, 2, 0.025),
    trimMat,
  );
  topBoard.position.set(0, SHELF.height - bt / 2, 0);
  topBoard.castShadow = true;
  topBoard.receiveShadow = true;
  g.add(topBoard);

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

/** クッション（こども部屋） */
export function buildCushion() {
  const g = new THREE.Group();
  const mat = makeStandard(PALETTE.cushion, { roughness: 0.98 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(CUSHION.radius, 28, 18), mat);
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
  const kind = spec.kind;
  if (kind === 'book') {
    const cover = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 2, 0.012),
      makeStandard(spec.color, { roughness: 0.85 }),
    );
    cover.castShadow = true;
    cover.receiveShadow = true;
    g.add(cover);
    const dims = [spec.size.x, spec.size.y, spec.size.z];
    const minAxis = dims.indexOf(Math.min(...dims));
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(
        spec.size.x * (minAxis === 0 ? 0.55 : 0.92),
        spec.size.y * (minAxis === 1 ? 0.55 : 0.94),
        spec.size.z * (minAxis === 2 ? 0.55 : 0.94),
      ),
      makeStandard(0xfffdf2, { roughness: 0.95 }),
    );
    g.add(pages);
    if (minAxis === 2) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(Math.min(spec.size.x, spec.size.y) * 0.28, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
      );
      dot.position.z = spec.size.z / 2 + 0.002;
      g.add(dot);
    }
  } else if (kind === 'lamp') {
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
  } else if (kind === 'clock') {
    const r = spec.size.radius;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, spec.size.height, 20),
      makeStandard(spec.color, { roughness: 0.6 }),
    );
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    g.add(body);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.78, 20),
      new THREE.MeshBasicMaterial({ color: 0xfffdf2 }),
    );
    face.position.z = spec.size.height / 2 + 0.001;
    g.add(face);
    const hand1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, r * 0.55, 0.004),
      new THREE.MeshBasicMaterial({ color: 0x4a3428 }),
    );
    hand1.position.set(0, r * 0.2, spec.size.height / 2 + 0.003);
    g.add(hand1);
    const hand2 = hand1.clone();
    hand2.rotation.z = -Math.PI / 3;
    hand2.position.set(r * 0.15, 0, spec.size.height / 2 + 0.003);
    g.add(hand2);
    for (const side of [-1, 1]) {
      const bell = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.34, 10, 8),
        makeStandard(0xffd66b, { roughness: 0.5 }),
      );
      bell.position.set(side * r * 0.55, r * 0.85, 0);
      g.add(bell);
    }
  } else if (kind === 'plush') {
    // ちいさなぬいぐるみ（うさぎ風）
    const mat = makeStandard(spec.color, { roughness: 0.98 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(spec.size.x * 0.52, 14, 10), mat);
    body.scale.y = (spec.size.y * 0.55) / (spec.size.x * 0.52);
    body.position.y = -spec.size.y * 0.12;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(spec.size.x * 0.38, 14, 10), mat);
    head.position.y = spec.size.y * 0.28;
    g.add(head);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(spec.size.x * 0.14, 8, 6), mat);
      ear.scale.y = 2.2;
      ear.position.set(side * spec.size.x * 0.2, spec.size.y * 0.52, 0);
      g.add(ear);
    }
  } else if (kind === 'tv') {
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 2, 0.02),
      makeStandard(spec.color, { roughness: 0.55 }),
    );
    frame.castShadow = true;
    g.add(frame);
    // やわらかい映像（にじ）が映った画面
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#bfe6ff';
    ctx.fillRect(0, 0, 128, 80);
    const cols = ['#ff9db6', '#ffc98f', '#fff3a0', '#b8e8a8', '#a8d8f0'];
    ctx.lineCap = 'round';
    for (let i = 0; i < cols.length; i++) {
      ctx.strokeStyle = cols[i];
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(64, 86, 46 - i * 8, Math.PI, 0);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.size.x * 0.88, spec.size.y * 0.82),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    screen.position.z = spec.size.z / 2 + 0.002;
    g.add(screen);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.035, spec.size.z + 0.09),
        makeStandard(spec.color, { roughness: 0.55 }),
      );
      foot.position.set(side * spec.size.x * 0.32, -spec.size.y / 2 + 0.017, 0);
      g.add(foot);
    }
  } else if (kind === 'dish') {
    const r = spec.size.radius;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.75, spec.size.height, 22),
      makeStandard(spec.color, { roughness: 0.8 }),
    );
    plate.castShadow = true;
    g.add(plate);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.62, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff6e6 }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = spec.size.height / 2 + 0.001;
    g.add(inner);
  } else if (kind === 'pot') {
    const r = spec.size.radius;
    const h = spec.size.height;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.96, r * 0.9, h * 0.8, 20),
      makeStandard(spec.color, { roughness: 0.5 }),
    );
    body.position.y = -h * 0.1;
    body.castShadow = true;
    g.add(body);
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.98, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
      makeStandard(0xfff1f6, { roughness: 0.6 }),
    );
    lid.scale.y = 0.55;
    lid.position.y = h * 0.3;
    g.add(lid);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.22, 10, 8),
      makeStandard(0xff8fab, { roughness: 0.6 }),
    );
    knob.position.y = h * 0.48;
    g.add(knob);
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.28, r * 0.08, 8, 12, Math.PI),
        makeStandard(0xfff1f6, { roughness: 0.6 }),
      );
      handle.position.set(side * r * 0.98, h * 0.05, 0);
      handle.rotation.z = side * -Math.PI / 2;
      g.add(handle);
    }
  } else if (kind === 'fruit') {
    const r = spec.size.radius;
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), makeStandard(spec.color, { roughness: 0.7 }));
    body.castShadow = true;
    g.add(body);
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.32, 8, 6),
      makeStandard(0x7ed957, { roughness: 0.8 }),
    );
    leaf.scale.set(1.4, 0.4, 0.7);
    leaf.position.y = r * 0.95;
    g.add(leaf);
  } else if (kind === 'cup') {
    const r = spec.size.radius;
    const h = spec.size.height;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.85, h, 18),
      makeStandard(spec.color, { roughness: 0.6 }),
    );
    body.castShadow = true;
    g.add(body);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.8, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff6e6 }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = h / 2 + 0.001;
    g.add(inner);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.5, r * 0.16, 8, 12, Math.PI),
      makeStandard(spec.color, { roughness: 0.6 }),
    );
    handle.position.x = r * 0.95;
    handle.rotation.z = -Math.PI / 2;
    g.add(handle);
  } else if (kind === 'frame') {
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 1, 0.012),
      makeStandard(spec.color, { roughness: 0.7 }),
    );
    frame.castShadow = true;
    g.add(frame);
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.size.z * 0.7, spec.size.y * 0.7),
      new THREE.MeshBasicMaterial({ color: 0xa8d8f0 }),
    );
    photo.rotation.y = Math.PI / 2;
    photo.position.x = spec.size.x / 2 + 0.002;
    g.add(photo);
    const heart = new THREE.Mesh(
      new THREE.CircleGeometry(spec.size.y * 0.16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8fab }),
    );
    heart.rotation.y = Math.PI / 2;
    heart.position.x = spec.size.x / 2 + 0.004;
    g.add(heart);
  } else {
    // 積み木など
    const cube = new THREE.Mesh(
      new RoundedBoxGeometry(spec.size.x, spec.size.y, spec.size.z, 2, 0.018),
      makeStandard(spec.color, { roughness: 0.85 }),
    );
    cube.castShadow = true;
    cube.receiveShadow = true;
    g.add(cube);
  }
  g.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
  g.rotation.set(spec.leanX || 0, spec.rotY || 0, spec.leanZ || 0);
  return g;
}

/**
 * 転倒家具のメッシュ（原点＝重心）。
 * `belt` という名前のピンクの固定ベルトを持ち、金具ON時だけ表示する。
 */
export function buildTippableMesh(t) {
  const g = new THREE.Group();
  const h = t.size.y;
  const bodyMat = makeStandard(t.color, { roughness: 0.85 });
  const trimMat = makeStandard(0xf9b8d0, { roughness: 0.85 });

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(t.size.x, t.size.y, t.size.z, 2, 0.03),
    bodyMat,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  if (t.kind === 'dresser') {
    // 引き出し3段＋とって
    const drawerMat = makeStandard(0xfdf6ec, { roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(
        new RoundedBoxGeometry(t.size.x * 0.82, h * 0.24, 0.03, 1, 0.012),
        drawerMat,
      );
      drawer.position.set(0, h * (0.28 - i * 0.28), t.size.z / 2 + 0.005);
      g.add(drawer);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 8),
        makeStandard(0xff8fab, { roughness: 0.6 }),
      );
      knob.position.set(0, h * (0.28 - i * 0.28), t.size.z / 2 + 0.032);
      g.add(knob);
    }
    const topTrim = new THREE.Mesh(
      new RoundedBoxGeometry(t.size.x + 0.04, 0.045, t.size.z + 0.04, 1, 0.02),
      trimMat,
    );
    topTrim.position.y = h / 2 - 0.01;
    g.add(topTrim);
  } else {
    // 飾り棚（とびら2枚＋ピンクの天板）
    const doorMat = makeStandard(0xfff6fa, { roughness: 0.9 });
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(
        new RoundedBoxGeometry(0.03, h * 0.62, t.size.z * 0.42, 1, 0.012),
        doorMat,
      );
      door.position.set(t.size.x / 2 + 0.005, -h * 0.12, side * t.size.z * 0.235);
      g.add(door);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 10, 8),
        makeStandard(0xffd66b, { roughness: 0.6 }),
      );
      knob.position.set(t.size.x / 2 + 0.033, -h * 0.12, side * t.size.z * 0.09);
      g.add(knob);
    }
    const topTrim = new THREE.Mesh(
      new RoundedBoxGeometry(t.size.x + 0.04, 0.045, t.size.z + 0.04, 1, 0.02),
      trimMat,
    );
    topTrim.position.y = h / 2 - 0.01;
    g.add(topTrim);
  }

  // 金具（固定ベルト）: 上部を壁へつなぐ2本のピンクのベルト
  const belt = new THREE.Group();
  belt.name = 'belt';
  const beltMat = makeStandard(0xf6538e, { roughness: 0.6 });
  const isDresser = t.kind === 'dresser';
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.3), beltMat);
    if (isDresser) {
      // 背面（-z）の壁へ
      strap.position.set(side * t.size.x * 0.3, h / 2 + 0.01, -t.size.z / 2 - 0.06);
      strap.rotation.x = -0.5;
    } else {
      // 左（-x）の壁へ
      strap.position.set(-t.size.x / 2 - 0.06, h / 2 + 0.01, side * t.size.z * 0.3);
      strap.rotation.set(0, Math.PI / 2, 0.5);
    }
    belt.add(strap);
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(0.11, 0.05, 0.11, 1, 0.02),
      makeStandard(0xffd66b, { roughness: 0.6 }),
    );
    if (isDresser) pad.position.set(side * t.size.x * 0.3, h / 2 + 0.09, -t.size.z / 2 - 0.16);
    else pad.position.set(-t.size.x / 2 - 0.16, h / 2 + 0.09, side * t.size.z * 0.3);
    belt.add(pad);
  }
  belt.visible = false;
  g.add(belt);

  g.position.set(t.pos.x, t.size.y / 2 + 0.002, t.pos.z);
  if (t.rotY) g.rotation.y = t.rotY;
  return g;
}
