import * as THREE from 'three';
import { PALETTE, toon, toonUnique } from './palette.js';
import { makeRugTexture } from './textures.js';
import { makeStarGeometry } from '../util/shapes.js';

/**
 * お世話の場所。赤ちゃんは中央のラグにいて、お世話のときだけ運ばれる。
 * spot = 赤ちゃんが乗る位置 / face = そのときの向き
 */
export const STATIONS = {
  // ねかせる場所は、体の向きが 家具の長い辺 と そろうように face を決めている
  rug:   { spot: new THREE.Vector3(0, 0, 0.4),          face: 0,        pose: 'sit' },
  crib:  { spot: new THREE.Vector3(-2.95, 0.75, -2.75), face: Math.PI,  pose: 'lie' },
  bath:  { spot: new THREE.Vector3(2.95, 0.16, -2.6),   face: -0.85,    pose: 'sit' },
  table: { spot: new THREE.Vector3(-2.9, 1.0, 2.15),    face: Math.PI,  pose: 'lie' },
  chair: { spot: new THREE.Vector3(2.85, 0.62, 2.15),   face: -2.2,     pose: 'sit' },
};

function shade(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** まんなかの まるいラグ */
export function makeRug() {
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 40),
    new THREE.MeshToonMaterial({ map: makeRugTexture(), color: 0xffffff })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.012, 0.4);
  rug.receiveShadow = true;
  return rug;
}

/** ベビーベッド（ねんね） */
export function makeCrib() {
  const g = new THREE.Group();
  const st = STATIONS.crib;
  g.position.set(st.spot.x, 0, st.spot.z);
  g.rotation.y = Math.PI / 2;

  const woodMat = toon(PALETTE.wood);
  const base = shade(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.25), woodMat));
  base.position.y = 0.5;
  g.add(base);

  // あし
  for (const [x, z] of [[-0.82, -0.5], [0.82, -0.5], [-0.82, 0.5], [0.82, 0.5]]) {
    const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 10), toon(PALETTE.woodDark)));
    leg.position.set(x, 0.25, z);
    g.add(leg);
  }

  // マットレスとまくら
  const mattress = shade(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 1.15), toon(PALETTE.cream)));
  mattress.position.y = 0.66;
  g.add(mattress);

  const pillow = shade(new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), toon(PALETTE.sky)));
  pillow.scale.set(1.2, 0.5, 1);
  pillow.position.set(-0.6, 0.78, 0);
  g.add(pillow);

  // てすり（たてさん）
  const barMat = toon(PALETTE.woodLight);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), barMat);
      bar.position.set(-0.78 + i * 0.26, 0.9, side * 0.6);
      bar.castShadow = true;
      g.add(bar);
    }
    const rail = shade(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), woodMat));
    rail.position.set(0, 1.22, side * 0.6);
    g.add(rail);
  }
  for (const x of [-0.9, 0.9]) {
    const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75, 10), woodMat));
    post.position.set(x, 0.95, 0);
    g.add(post);
    const knob = shade(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), toon(PALETTE.pink)));
    knob.position.set(x, 1.36, 0);
    g.add(knob);
  }

  // おふとん（ねんねのときだけ かける）
  const blanket = shade(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.1), toon(PALETTE.pink)));
  blanket.position.set(0.15, 0.76, 0);
  blanket.visible = false;
  g.add(blanket);
  g.userData.blanket = blanket;

  // メリー（くるくる回る）
  const mobile = new THREE.Group();
  mobile.position.set(0.2, 1.85, 0);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), toon(PALETTE.woodDark));
  arm.rotation.z = Math.PI / 2;
  mobile.add(arm);
  const hangColors = [PALETTE.butter, PALETTE.mint, PALETTE.lilac];
  hangColors.forEach((c, i) => {
    const a = (i / 3) * Math.PI * 2;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), toon(PALETTE.cream));
    string.position.set(Math.cos(a) * 0.38, -0.15, Math.sin(a) * 0.38);
    mobile.add(string);
    const charm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), toon(c));
    charm.position.set(Math.cos(a) * 0.38, -0.35, Math.sin(a) * 0.38);
    mobile.add(charm);
  });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8), toon(PALETTE.woodDark));
  stand.position.set(-0.75, 1.3, 0);
  g.add(stand);
  g.add(mobile);
  g.userData.mobile = mobile;

  return g;
}

/** バスタブ（おふろ） */
export function makeBathtub() {
  const g = new THREE.Group();
  const st = STATIONS.bath;
  g.position.set(st.spot.x, 0, st.spot.z);

  const outer = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.82, 0.85, 24, 1, true), toonUnique(PALETTE.sky, { side: THREE.DoubleSide })));
  outer.position.y = 0.45;
  g.add(outer);

  const bottom = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.08, 24), toon(PALETTE.sky)));
  bottom.position.y = 0.06;
  g.add(bottom);

  const rim = shade(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 28), toon(PALETTE.cream)));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.87;
  g.add(rim);

  // おゆ（はじめは見えない）
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.8, 0.5, 24), toonUnique(PALETTE.water, { opacity: 0.72 }));
  water.position.y = 0.32;
  water.visible = false;
  g.add(water);
  g.userData.water = water;

  // あわ
  const foam = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.45;
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.08, 10, 8), toon(PALETTE.foam));
    bubble.position.set(Math.cos(a) * r, 0.58 + Math.random() * 0.08, Math.sin(a) * r);
    foam.add(bubble);
  }
  foam.visible = false;
  g.add(foam);
  g.userData.foam = foam;

  // あひるさん
  const duck = new THREE.Group();
  const duckBody = shade(new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), toon(PALETTE.butter)));
  duckBody.scale.set(1.2, 1, 1);
  duck.add(duckBody);
  const duckHead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), toon(PALETTE.butter));
  duckHead.position.set(0.14, 0.15, 0);
  duck.add(duckHead);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 8), toon(0xf5a25d));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.25, 0.14, 0);
  duck.add(beak);
  duck.position.set(0.45, 0.62, 0.35);
  g.add(duck);
  g.userData.duck = duck;

  return g;
}

/** おむつ交換だい */
export function makeChangingTable() {
  const g = new THREE.Group();
  const st = STATIONS.table;
  g.position.set(st.spot.x, 0, st.spot.z);
  g.rotation.y = Math.PI / 2;

  const top = shade(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 1.0), toon(PALETTE.wood)));
  top.position.y = 0.78;
  g.add(top);

  const cushion = shade(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.92), toon(PALETTE.mint)));
  cushion.position.y = 0.9;
  g.add(cushion);

  for (const side of [-1, 1]) {
    const guard = shade(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.1), toon(PALETTE.woodLight)));
    guard.position.set(0, 1.02, side * 0.46);
    g.add(guard);
  }

  // だなと おむつのストック
  const shelf = shade(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.9), toon(PALETTE.woodLight)));
  shelf.position.y = 0.34;
  g.add(shelf);
  for (const [x, c] of [[-0.45, PALETTE.pink], [0.1, PALETTE.sky], [0.55, PALETTE.lilac]]) {
    const stack = shade(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.5), toon(c)));
    stack.position.set(x, 0.51, 0);
    g.add(stack);
  }
  for (const [x, z] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]]) {
    const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 10), toon(PALETTE.woodDark)));
    leg.position.set(x, 0.39, z);
    g.add(leg);
  }
  return g;
}

/** ミルクをあげる いす */
export function makeFeedingChair() {
  const g = new THREE.Group();
  const st = STATIONS.chair;
  g.position.set(st.spot.x, 0, st.spot.z);
  g.rotation.y = st.face;

  const seat = shade(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 1.05), toon(PALETTE.lilac)));
  seat.position.y = 0.5;
  g.add(seat);

  const back = shade(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.22), toon(PALETTE.lilac)));
  back.position.set(0, 0.95, -0.44);
  g.add(back);

  for (const side of [-1, 1]) {
    const arm = shade(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.0), toon(PALETTE.pink)));
    arm.position.set(side * 0.48, 0.72, 0.02);
    g.add(arm);
  }
  for (const [x, z] of [[-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]]) {
    const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), toon(PALETTE.woodDark)));
    leg.position.set(x, 0.25, z);
    g.add(leg);
  }
  const cushion = shade(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), toon(PALETTE.cream)));
  cushion.scale.set(1.3, 0.4, 1.2);
  cushion.position.set(0, 0.66, 0.05);
  g.add(cushion);
  return g;
}

/** ゆかに おいてある おもちゃ */
export function makeToys() {
  const g = new THREE.Group();
  const blocks = [
    [1.55, 0.2, 1.6, PALETTE.butter],
    [1.85, 0.2, 1.25, PALETTE.mint],
    [1.6, 0.6, 1.45, PALETTE.pink],
  ];
  for (const [x, y, z, c] of blocks) {
    const b = shade(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), toon(c)));
    b.position.set(x, y, z);
    b.rotation.y = Math.random() * 0.8;
    g.add(b);
  }
  const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 14), toon(PALETTE.sky)));
  ball.position.set(-1.7, 0.32, 1.5);
  g.add(ball);

  // くまのぬいぐるみ
  const teddy = new THREE.Group();
  const body = shade(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), toon(PALETTE.peach)));
  body.scale.set(1, 1.1, 0.9);
  teddy.add(body);
  const head = shade(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), toon(PALETTE.peach)));
  head.position.y = 0.36;
  teddy.add(head);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toon(PALETTE.peach));
    ear.position.set(side * 0.16, 0.52, 0);
    teddy.add(ear);
    const armT = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), toon(PALETTE.peach));
    armT.position.set(side * 0.3, 0.05, 0.05);
    teddy.add(armT);
  }
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toon(PALETTE.cream));
  snout.position.set(0, 0.3, 0.19);
  teddy.add(snout);
  teddy.position.set(-1.9, 0.3, -0.6);
  teddy.rotation.y = 0.6;
  g.add(teddy);

  return g;
}

/**
 * かべの ごほうびボード。お世話するたびに ほしシールが増える。
 * 星は 5 x 3 のマス目に並び、いっぱいになったら最初から貼り直す。
 */
export class StickerBoard {
  constructor() {
    this.group = new THREE.Group();
    this.cols = 5;
    this.rows = 3;
    this.capacity = this.cols * this.rows;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.1), toonUnique(PALETTE.woodDark, { transparent: true }));
    this.group.add(frame);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.3, 0.06), toonUnique(PALETTE.cream, { transparent: true }));
    board.position.z = 0.05;
    this.group.add(board);
    this.materials = [frame.material, board.material];

    this.starGeo = makeStarGeometry(0.19, 0.085, 0.05);
    this.stars = [];
  }

  _slot(index) {
    const i = index % this.capacity;
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    return new THREE.Vector3(-0.9 + col * 0.45, 0.42 - row * 0.42, 0.1);
  }

  /** 何もアニメせずに count 個ぶん並べる（セーブデータの復元用）。 */
  setCount(count) {
    const shown = Math.min(count, this.capacity) || 0;
    const wrapped = count > 0 && count % this.capacity === 0 ? this.capacity : count % this.capacity;
    const target = count >= this.capacity ? wrapped : shown;
    while (this.stars.length > target) {
      const s = this.stars.pop();
      this.group.remove(s);
    }
    while (this.stars.length < target) this._spawn(this.stars.length, false);
  }

  _spawn(index, animate) {
    const mat = toonUnique(PALETTE.star, { transparent: true });
    const star = new THREE.Mesh(this.starGeo, mat);
    star.position.copy(this._slot(index));
    star.userData.spin = animate ? 1 : 0;
    if (animate) star.scale.setScalar(0.01);
    this.group.add(star);
    this.materials.push(mat);
    this.stars.push(star);
    return star;
  }

  /** 1枚ふやす。ボードが満杯なら、いったん空にしてから貼る。 */
  addStar() {
    if (this.stars.length >= this.capacity) {
      this.stars.forEach((s) => this.group.remove(s));
      this.stars.length = 0;
    }
    return this._spawn(this.stars.length, true);
  }

  update(dt, time) {
    for (const star of this.stars) {
      if (star.userData.spin > 0) {
        star.userData.spin = Math.max(0, star.userData.spin - dt * 1.6);
        const t = 1 - star.userData.spin;
        star.scale.setScalar(Math.min(1, 1.25 * Math.sin(t * Math.PI * 0.8) + t * 0.35));
        star.rotation.z = star.userData.spin * Math.PI * 2;
      } else {
        star.scale.setScalar(1);
        star.rotation.z = Math.sin(time * 1.5 + star.position.x * 3) * 0.06;
      }
    }
  }
}
