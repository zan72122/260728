/**
 * 寝室：「ベッドの上で布団をかぶると守られる」体感。
 * - ベッド（乗れる・布団シールド）
 * - タンス（つよい揺れで転倒・金具で固定可能）
 * - タンスの上の目覚まし時計・絵本・ぬいぐるみが落ちる
 */

export const BED = {
  pos: { x: -1.52, z: 0.32 },
  width: 1.06, // x
  depth: 1.92, // z
  frameH: 0.3,
  topY: 0.4, // マットレス上面
};

export const DRESSER = {
  pos: { x: 0.62, z: -1.92 },
  size: { x: 0.95, y: 1.48, z: 0.42 },
};

export const WALL_SHELF = {
  pos: { x: -2.08, z: 0.15 },
  y: 1.3, // 棚板の高さ
  width: 0.55, // z方向
  depth: 0.24, // x方向（壁から張り出す）
};

function bedParts() {
  return [
    // フレーム＋マットレス
    { shape: 'box', hx: BED.width / 2, hy: BED.frameH / 2, hz: BED.depth / 2, x: 0, y: BED.frameH / 2, z: 0 },
    { shape: 'box', hx: BED.width / 2 - 0.03, hy: (BED.topY - BED.frameH) / 2 + 0.02, hz: BED.depth / 2 - 0.03, x: 0, y: (BED.frameH + BED.topY) / 2, z: 0 },
    // ヘッドボード（奥側）
    { shape: 'box', hx: BED.width / 2, hy: 0.34, hz: 0.045, x: 0, y: 0.62, z: -BED.depth / 2 + 0.045 },
  ];
}

function dynamics() {
  const topY = DRESSER.size.y + 0.001;
  const frontZ = DRESSER.pos.z + DRESSER.size.z / 2;
  return [
    {
      id: 'clock',
      kind: 'clock',
      shape: 'cylinder',
      size: { radius: 0.075, height: 0.1 },
      mass: 0.3,
      pos: { x: DRESSER.pos.x - 0.28, y: topY + 0.05, z: frontZ - 0.1 },
      rotY: 0,
      leanX: 0.14,
      color: 0x53b7f6,
      dangerous: true,
    },
    {
      id: 'bedBook0',
      kind: 'book',
      shape: 'box',
      size: { x: 0.18, y: 0.24, z: 0.04 },
      mass: 0.35,
      pos: { x: DRESSER.pos.x + 0.02, y: topY + 0.12 + 0.01, z: frontZ - 0.035 },
      rotY: 0,
      leanX: 0.15,
      color: 0x7ed957,
      dangerous: true,
    },
    {
      id: 'bedBook1',
      kind: 'book',
      shape: 'box',
      size: { x: 0.17, y: 0.22, z: 0.038 },
      mass: 0.32,
      pos: { x: DRESSER.pos.x + 0.24, y: topY + 0.11 + 0.01, z: frontZ - 0.033 },
      rotY: 0,
      leanX: 0.15,
      color: 0xffb020,
      dangerous: true,
    },
    {
      // ぬいぐるみは落ちても痛くない（危険判定なし）
      id: 'plush',
      kind: 'plush',
      shape: 'box',
      size: { x: 0.16, y: 0.18, z: 0.14 },
      mass: 0.12,
      pos: { x: DRESSER.pos.x - 0.05, y: topY + 0.09, z: frontZ - 0.26 },
      rotY: -0.3,
      leanX: 0.05,
      color: 0xcdb4f6,
      dangerous: false,
    },
    {
      // 壁棚の上の絵本 → ベッドへ落ちてくる（布団が受け止める見せ場）
      id: 'shelfBook',
      kind: 'book',
      shape: 'box',
      size: { x: 0.04, y: 0.22, z: 0.16 },
      mass: 0.3,
      pos: { x: WALL_SHELF.pos.x + 0.02, y: WALL_SHELF.y + 0.115, z: WALL_SHELF.pos.z - 0.12 },
      rotY: 0,
      leanX: 0,
      leanZ: -0.14,
      color: 0xff8fab,
      dangerous: true,
    },
    {
      // 壁棚のぬいぐるみ（ふわふわ・危なくない）
      id: 'shelfPlush',
      kind: 'plush',
      shape: 'box',
      size: { x: 0.13, y: 0.15, z: 0.12 },
      mass: 0.1,
      pos: { x: WALL_SHELF.pos.x + 0.01, y: WALL_SHELF.y + 0.085, z: WALL_SHELF.pos.z + 0.14 },
      rotY: 0.5,
      leanX: 0,
      color: 0xffc98f,
      dangerous: false,
    },
    {
      // ベッドサイドの小さな絵本タワー（ゆらゆら崩れる）
      id: 'floorBook0',
      kind: 'book',
      shape: 'box',
      size: { x: 0.2, y: 0.045, z: 0.26 },
      mass: 0.4,
      pos: { x: -0.55, y: 0.023, z: 1.45 },
      rotY: 0.2,
      leanX: 0,
      color: 0xf6538e,
      dangerous: false,
    },
    {
      id: 'floorBook1',
      kind: 'book',
      shape: 'box',
      size: { x: 0.19, y: 0.045, z: 0.25 },
      mass: 0.38,
      pos: { x: -0.55, y: 0.069, z: 1.45 },
      rotY: -0.15,
      leanX: 0,
      color: 0x53b7f6,
      dangerous: false,
    },
  ];
}

export const bedroomRoom = {
  id: 'bedroom',
  shell: {
    width: 4.4,
    depth: 4.4,
    wallHeight: 2.5,
    wallThickness: 0.12,
    window: { x: -0.85, y: 1.5, width: 1.0, height: 0.95 },
    rug: { x: 0.75, z: 0.75, radius: 0.85, style: 'dots' },
    wainscot: 0xd9c8f2,
    picture: 'moon',
    pictureAt: { y: 1.6, z: -0.9 },
  },
  bearStart: { x: 0.55, z: 0.75 },
  statics: [
    { id: 'bed', mat: 'floor', pos: BED.pos, soft: true, parts: bedParts() },
    {
      // ベッドの上の壁棚（少し傾いていて、本がベッドへ落ちてくる → 布団の見せ場）
      id: 'wallShelf',
      mat: 'wood',
      pos: WALL_SHELF.pos,
      parts: [
        {
          shape: 'box',
          hx: WALL_SHELF.depth / 2,
          hy: 0.018,
          hz: WALL_SHELF.width / 2,
          x: 0,
          y: WALL_SHELF.y,
          z: 0,
          rotZ: -0.07,
        },
      ],
    },
  ],
  tippables: [
    {
      id: 'dresser',
      kind: 'dresser',
      size: DRESSER.size,
      mass: 13,
      pos: DRESSER.pos,
      rotY: 0,
      color: 0xf3e3d0,
      anchorable: true,
      dangerous: true,
    },
  ],
  dynamics: dynamics(),
  shields: [
    {
      // ベッドの上＝布団が上から来る物を受け止める
      zone: {
        x0: BED.pos.x - BED.width / 2,
        x1: BED.pos.x + BED.width / 2,
        z0: BED.pos.z - BED.depth / 2,
        z1: BED.pos.z + BED.depth / 2,
      },
      shieldY: BED.topY - 0.02,
      badge: 'futon',
    },
  ],
  platforms: [
    {
      zone: {
        x0: BED.pos.x - BED.width / 2 + 0.06,
        x1: BED.pos.x + BED.width / 2 - 0.06,
        z0: BED.pos.z - BED.depth / 2 + 0.06,
        z1: BED.pos.z + BED.depth / 2 - 0.06,
      },
      y: BED.topY,
      futon: true,
    },
  ],
  blocked: [
    {
      x0: DRESSER.pos.x - DRESSER.size.x / 2,
      x1: DRESSER.pos.x + DRESSER.size.x / 2,
      z0: -2.2,
      z1: DRESSER.pos.z + DRESSER.size.z / 2,
    },
  ],
};
