/**
 * リビング：「なにもない部屋の真ん中がいちばん安全」
 * 「背の高い家具は金具で固定すれば倒れない」体感。
 * - テレビが台から滑り落ちる
 * - 飾り棚（つよい揺れで転倒・金具で固定可能）と棚の上の小物
 * - ソファ（乗れる・安全な場所）
 */

export const TV_STAND = {
  pos: { x: -0.68, z: -1.94 },
  size: { x: 1.3, y: 0.44, z: 0.42 },
};

export const CABINET = {
  pos: { x: -1.94, z: -0.42 },
  size: { x: 0.4, y: 1.62, z: 0.95 },
};

export const SOFA = {
  pos: { x: 1.3, z: 0.62 },
  seatY: 0.4,
  width: 0.88, // x
  depth: 1.55, // z
};

function sofaParts() {
  return [
    { shape: 'box', hx: SOFA.width / 2, hy: SOFA.seatY / 2, hz: SOFA.depth / 2, x: 0, y: SOFA.seatY / 2, z: 0 },
    // 背もたれ（右の壁側）
    { shape: 'box', hx: 0.13, hy: 0.34, hz: SOFA.depth / 2, x: SOFA.width / 2 - 0.11, y: SOFA.seatY + 0.2, z: 0 },
    // ひじかけ
    { shape: 'box', hx: SOFA.width / 2, hy: 0.11, hz: 0.11, x: 0, y: SOFA.seatY + 0.09, z: -SOFA.depth / 2 + 0.09 },
    { shape: 'box', hx: SOFA.width / 2, hy: 0.11, hz: 0.11, x: 0, y: SOFA.seatY + 0.09, z: SOFA.depth / 2 - 0.09 },
  ];
}

function dynamics() {
  const standTop = TV_STAND.size.y + 0.001;
  const cabTop = CABINET.size.y + 0.001;
  return [
    {
      id: 'tv',
      kind: 'tv',
      shape: 'box',
      size: { x: 0.82, y: 0.5, z: 0.07 },
      mass: 3.2,
      pos: { x: TV_STAND.pos.x, y: standTop + 0.25, z: TV_STAND.pos.z + 0.13 },
      rotY: 0,
      leanX: 0.1,
      color: 0x4a4a58,
      dangerous: true,
    },
    {
      id: 'vase',
      kind: 'cup',
      shape: 'cylinder',
      size: { radius: 0.052, height: 0.2 },
      mass: 0.35,
      pos: { x: CABINET.pos.x + 0.06, y: cabTop + 0.08, z: CABINET.pos.z - 0.28 },
      rotY: 0,
      leanX: 0,
      color: 0xff8fab,
      dangerous: true,
    },
    {
      id: 'frame',
      kind: 'frame',
      shape: 'box',
      size: { x: 0.05, y: 0.22, z: 0.18 },
      mass: 0.25,
      pos: { x: CABINET.pos.x + 0.08, y: cabTop + 0.11 + 0.01, z: CABINET.pos.z + 0.05 },
      rotY: 0,
      leanX: 0,
      leanZ: -0.12,
      color: 0xffd66b,
      dangerous: true,
    },
    {
      id: 'ballToy',
      kind: 'plush',
      shape: 'box',
      size: { x: 0.14, y: 0.14, z: 0.14 },
      mass: 0.1,
      pos: { x: CABINET.pos.x + 0.04, y: cabTop + 0.07, z: CABINET.pos.z + 0.32 },
      rotY: 0.4,
      leanX: 0,
      color: 0x7ed957,
      dangerous: false,
    },
    {
      // ソファの上のクッション（ふわふわ・危なくない）
      id: 'sofaCushion',
      kind: 'plush',
      shape: 'box',
      size: { x: 0.3, y: 0.12, z: 0.3 },
      mass: 0.15,
      pos: { x: SOFA.pos.x - 0.05, y: SOFA.seatY + 0.06, z: SOFA.pos.z - 0.45 },
      rotY: 0.2,
      leanX: 0,
      color: 0xffc98f,
      dangerous: false,
    },
  ];
}

export const livingRoom = {
  id: 'living',
  shell: {
    width: 4.4,
    depth: 4.4,
    wallHeight: 2.5,
    wallThickness: 0.12,
    window: { x: 0.95, y: 1.45, width: 1.05, height: 1.0 },
    rug: { x: 0.15, z: 0.1, radius: 1.15, style: 'sun' },
    wainscot: 0xbfe8d8,
    picture: 'house',
    pictureAt: { y: 1.55, z: 1.15 },
  },
  bearStart: { x: 0.35, z: 0.45 },
  statics: [
    { id: 'tvStand', mat: 'wood', pos: TV_STAND.pos, parts: [
      { shape: 'box', hx: TV_STAND.size.x / 2, hy: TV_STAND.size.y / 2, hz: TV_STAND.size.z / 2, x: 0, y: TV_STAND.size.y / 2, z: 0 },
    ] },
    { id: 'sofa', mat: 'floor', pos: SOFA.pos, soft: true, parts: sofaParts() },
  ],
  tippables: [
    {
      id: 'cabinet',
      kind: 'cabinet',
      size: CABINET.size,
      mass: 11,
      pos: CABINET.pos,
      rotY: 0,
      color: 0xfdeef4,
      anchorable: true,
      dangerous: true,
    },
  ],
  dynamics: dynamics(),
  shields: [],
  platforms: [
    {
      zone: {
        x0: SOFA.pos.x - SOFA.width / 2,
        x1: SOFA.pos.x + SOFA.width / 2 - 0.2,
        z0: SOFA.pos.z - SOFA.depth / 2 + 0.1,
        z1: SOFA.pos.z + SOFA.depth / 2 - 0.1,
      },
      y: SOFA.seatY,
    },
  ],
  blocked: [
    {
      x0: TV_STAND.pos.x - TV_STAND.size.x / 2,
      x1: TV_STAND.pos.x + TV_STAND.size.x / 2,
      z0: -2.2,
      z1: TV_STAND.pos.z + TV_STAND.size.z / 2,
    },
    {
      x0: -2.2,
      x1: CABINET.pos.x + CABINET.size.x / 2,
      z0: CABINET.pos.z - CABINET.size.z / 2,
      z1: CABINET.pos.z + CABINET.size.z / 2,
    },
  ],
};
