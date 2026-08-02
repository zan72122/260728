/**
 * キッチン：「食器棚の前は上からたくさん落ちてくる」
 * 「テーブルの下は安全」（机の下体感の復習）。
 * 火・ガラス・刃物は一切なし。お皿は木製で、割れずに転がるだけ。
 */

export const HUTCH = {
  pos: { x: -1.05, z: -1.94 },
  lowerW: 1.24,
  lowerH: 0.86,
  lowerD: 0.52,
  shelfW: 1.16,
  shelfD: 0.34,
  shelfYs: [1.16, 1.5],
  topH: 1.78,
};

export const TABLE = {
  pos: { x: 0.72, z: -0.18 },
  size: 1.04, // 正方形の一辺
  topY: 0.6,
  topThickness: 0.07,
  legSize: 0.09,
};

export const FRIDGE = {
  pos: { x: 1.62, z: -1.9 },
  size: { x: 0.68, y: 1.75, z: 0.6 },
};

function hutchParts() {
  const parts = [
    // 下段キャビネット
    { shape: 'box', hx: HUTCH.lowerW / 2, hy: HUTCH.lowerH / 2, hz: HUTCH.lowerD / 2, x: 0, y: HUTCH.lowerH / 2, z: 0 },
    // カウンター天板
    { shape: 'box', hx: HUTCH.lowerW / 2 + 0.03, hy: 0.025, hz: HUTCH.lowerD / 2 + 0.04, x: 0, y: HUTCH.lowerH + 0.025, z: 0.02 },
  ];
  // 上段のオープン棚（背板・側板・棚板）
  const zOff = -HUTCH.lowerD / 2 + HUTCH.shelfD / 2;
  const shelfBottom = HUTCH.lowerH + 0.05;
  const sideH = (HUTCH.topH - shelfBottom) / 2;
  parts.push({ shape: 'box', hx: HUTCH.shelfW / 2, hy: sideH, hz: 0.02, x: 0, y: shelfBottom + sideH, z: zOff - HUTCH.shelfD / 2 + 0.02 });
  for (const sx of [-1, 1]) {
    parts.push({ shape: 'box', hx: 0.02, hy: sideH, hz: HUTCH.shelfD / 2, x: sx * (HUTCH.shelfW / 2 - 0.02), y: shelfBottom + sideH, z: zOff });
  }
  for (const y of HUTCH.shelfYs) {
    // 棚板はわずかに前傾している（詰め込みすぎの棚）。
    // 揺れで滑り出した食器が前へ寄っていき、棚から落ちる。
    parts.push({ shape: 'box', hx: HUTCH.shelfW / 2 - 0.04, hy: 0.018, hz: HUTCH.shelfD / 2, x: 0, y: y - 0.018, z: zOff, rotX: 0.07 });
  }
  parts.push({ shape: 'box', hx: HUTCH.shelfW / 2 + 0.02, hy: 0.02, hz: HUTCH.shelfD / 2 + 0.02, x: 0, y: HUTCH.topH, z: zOff });
  return parts;
}

function tableParts() {
  const parts = [
    { shape: 'box', hx: TABLE.size / 2, hy: TABLE.topThickness / 2, hz: TABLE.size / 2, x: 0, y: TABLE.topY - TABLE.topThickness / 2, z: 0 },
  ];
  const legH = TABLE.topY - TABLE.topThickness;
  const off = TABLE.size / 2 - TABLE.legSize / 2 - 0.04;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ shape: 'box', hx: TABLE.legSize / 2, hy: legH / 2, hz: TABLE.legSize / 2, x: sx * off, y: legH / 2, z: sz * off });
    }
  }
  return parts;
}

function dynamics() {
  const out = [];
  const zOff = HUTCH.pos.z - HUTCH.lowerD / 2 + HUTCH.shelfD / 2;
  const shelfFront = zOff + HUTCH.shelfD / 2; // 上段オープン棚の前縁
  const counterFront = HUTCH.pos.z + 0.02 + HUTCH.lowerD / 2 + 0.04; // カウンター前縁
  // 木のお皿（棚の前寄りに積んである・割れずに転がる）
  const dishColors = [0xe9b077, 0xf3c993, 0xe9b077];
  let n = 0;
  for (const [sy, count, x] of [
    [HUTCH.shelfYs[1], 3, HUTCH.pos.x - 0.33],
    [HUTCH.shelfYs[1], 2, HUTCH.pos.x + 0.3],
    [HUTCH.shelfYs[0], 2, HUTCH.pos.x - 0.05],
  ]) {
    for (let i = 0; i < count; i++) {
      out.push({
        id: `dish${n++}`,
        kind: 'dish',
        shape: 'cylinder',
        size: { radius: 0.1, height: 0.03 },
        mass: 0.3,
        pos: { x, y: sy + 0.02 + i * 0.033, z: shelfFront - 0.075 },
        rotY: 0,
        leanX: 0.07,
        color: dishColors[i % dishColors.length],
        dangerous: true,
        slick: true,
      });
    }
  }
  // お鍋（カウンターの上・ふたつき見た目）
  out.push({
    id: 'pot',
    kind: 'pot',
    shape: 'cylinder',
    size: { radius: 0.1, height: 0.24 },
    mass: 0.8,
    pos: { x: HUTCH.pos.x + 0.42, y: HUTCH.lowerH + 0.05 + 0.12, z: counterFront - 0.11 },
    rotY: 0,
    leanX: 0,
    color: 0x53b7f6,
    dangerous: true,
  });
  // 果物（ころころ転がる・小さくて危なくない）
  const fruitColors = [0xff6b6b, 0xffb020, 0x7ed957];
  for (let i = 0; i < 3; i++) {
    out.push({
      id: `fruit${i}`,
      kind: 'fruit',
      shape: 'sphere',
      size: { radius: 0.055 },
      mass: 0.12,
      pos: {
        x: HUTCH.pos.x - 0.42 + i * 0.13,
        y: HUTCH.lowerH + 0.05 + 0.055,
        z: counterFront - 0.12 + (i % 2) * 0.06,
      },
      rotY: 0,
      leanX: 0,
      color: fruitColors[i],
      dangerous: false,
    });
  }
  // テーブルの上のマグカップ（滑って落ちる）
  out.push({
    id: 'mug',
    kind: 'cup',
    shape: 'cylinder',
    size: { radius: 0.055, height: 0.1 },
    mass: 0.25,
    pos: { x: TABLE.pos.x - 0.25, y: TABLE.topY + 0.05, z: TABLE.pos.z + 0.2 },
    rotY: 0,
    leanX: 0,
    color: 0xff8fab,
    dangerous: false,
    slick: true,
  });
  return out;
}

export const kitchenRoom = {
  id: 'kitchen',
  shell: {
    width: 4.4,
    depth: 4.4,
    wallHeight: 2.5,
    wallThickness: 0.12,
    window: { x: 0.5, y: 1.5, width: 0.95, height: 0.9 },
    rug: { x: 0.72, z: 1.15, radius: 0.7, style: 'dots' },
    wainscot: 0xffd9c0,
    picture: 'fruit',
    pictureAt: { y: 1.6, z: 0.35 },
  },
  bearStart: { x: 0.25, z: 0.85 },
  statics: [
    { id: 'hutch', mat: 'wood', pos: HUTCH.pos, parts: hutchParts() },
    { id: 'table', mat: 'wood', pos: TABLE.pos, boing: true, parts: tableParts() },
    { id: 'fridge', mat: 'wood', pos: FRIDGE.pos, parts: [
      { shape: 'box', hx: FRIDGE.size.x / 2, hy: FRIDGE.size.y / 2, hz: FRIDGE.size.z / 2, x: 0, y: FRIDGE.size.y / 2, z: 0 },
    ] },
  ],
  tippables: [],
  dynamics: dynamics(),
  shields: [
    {
      zone: {
        x0: TABLE.pos.x - TABLE.size / 2 + 0.04,
        x1: TABLE.pos.x + TABLE.size / 2 - 0.04,
        z0: TABLE.pos.z - TABLE.size / 2 - 0.04,
        z1: TABLE.pos.z + TABLE.size / 2 + 0.04,
      },
      shieldY: TABLE.topY - 0.07,
      badge: 'shield',
    },
  ],
  platforms: [],
  blocked: [
    {
      x0: HUTCH.pos.x - HUTCH.lowerW / 2,
      x1: HUTCH.pos.x + HUTCH.lowerW / 2,
      z0: -2.2,
      z1: HUTCH.pos.z + HUTCH.lowerD / 2,
    },
    {
      x0: FRIDGE.pos.x - FRIDGE.size.x / 2,
      x1: 2.2,
      z0: -2.2,
      z1: FRIDGE.pos.z + FRIDGE.size.z / 2,
    },
  ],
};
