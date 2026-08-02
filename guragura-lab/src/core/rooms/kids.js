/** こども部屋：「机の下では天板が本を受け止めてくれる」体感（v1から移植） */

export const DESK = {
  pos: { x: -1.12, z: -1.36 },
  width: 1.06,
  depth: 0.82,
  topY: 0.56,
  topThickness: 0.09,
  legSize: 0.11,
};

export const SHELF = {
  pos: { x: -0.92, z: -1.98 },
  width: 1.18,
  depth: 0.34,
  height: 1.72,
  boardThickness: 0.05,
  shelfYs: [0.42, 0.88, 1.32],
};

export const CUSHION = {
  pos: { x: 1.38, z: 1.12 },
  radius: 0.34,
  height: 0.16,
};

function buildDeskParts() {
  const parts = [
    {
      shape: 'box',
      hx: DESK.width / 2,
      hy: DESK.topThickness / 2,
      hz: DESK.depth / 2,
      x: 0,
      y: DESK.topY - DESK.topThickness / 2,
      z: 0,
    },
  ];
  const legH = DESK.topY - DESK.topThickness;
  const ox = DESK.width / 2 - DESK.legSize / 2 - 0.03;
  const oz = DESK.depth / 2 - DESK.legSize / 2 - 0.03;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        shape: 'box',
        hx: DESK.legSize / 2,
        hy: legH / 2,
        hz: DESK.legSize / 2,
        x: sx * ox,
        y: legH / 2,
        z: sz * oz,
      });
    }
  }
  return parts;
}

function buildShelfParts() {
  const bt = SHELF.boardThickness;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push({
      shape: 'box',
      hx: bt / 2,
      hy: SHELF.height / 2,
      hz: SHELF.depth / 2,
      x: sx * (SHELF.width / 2 - bt / 2),
      y: SHELF.height / 2,
      z: 0,
    });
  }
  parts.push({
    shape: 'box',
    hx: SHELF.width / 2,
    hy: SHELF.height / 2,
    hz: bt / 2,
    x: 0,
    y: SHELF.height / 2,
    z: -SHELF.depth / 2 + bt / 2,
  });
  for (const y of [bt / 2, ...SHELF.shelfYs.map((v) => v - bt / 2), SHELF.height - bt / 2]) {
    parts.push({
      shape: 'box',
      hx: SHELF.width / 2 - bt,
      hy: bt / 2,
      hz: SHELF.depth / 2,
      x: 0,
      y,
      z: 0,
    });
  }
  return parts;
}

function buildDynamics() {
  const shelfTopY = SHELF.shelfYs[2] + 0.001;
  const shelfMidY = SHELF.shelfYs[1] + 0.001;
  const shelfFrontZ = SHELF.pos.z + SHELF.depth / 2;
  const out = [];
  const bookColors = [0xf6538e, 0x53b7f6, 0x7ed957, 0xffb020];
  const bookSpecs = [
    { x: -1.31, w: 0.2, h: 0.25, t: 0.042, lean: 0.09 },
    { x: -1.08, w: 0.21, h: 0.27, t: 0.048, lean: 0.13 },
    { x: -0.85, w: 0.19, h: 0.24, t: 0.042, lean: 0.1 },
    { x: -0.63, w: 0.2, h: 0.26, t: 0.046, lean: 0.12 },
  ];
  bookSpecs.forEach((s, i) => {
    out.push({
      id: `book${i}`,
      kind: 'book',
      shape: 'box',
      size: { x: s.w, y: s.h, z: s.t },
      mass: 0.4,
      pos: { x: s.x, y: shelfTopY + s.h / 2 + 0.01, z: shelfFrontZ - s.t / 2 - 0.015 },
      rotY: 0,
      leanX: s.lean,
      color: bookColors[i],
      dangerous: true,
    });
  });
  out.push({
    id: 'bookFlat',
    kind: 'book',
    shape: 'box',
    size: { x: 0.2, y: 0.045, z: 0.26 },
    mass: 0.5,
    pos: { x: -0.5, y: shelfMidY + 0.045 / 2, z: shelfFrontZ - 0.26 / 2 + 0.13 },
    rotY: 0.12,
    leanX: 0,
    color: 0xff8fab,
    dangerous: true,
  });
  out.push({
    id: 'lamp',
    kind: 'lamp',
    shape: 'cylinder',
    size: { radius: 0.09, height: 0.34 },
    mass: 0.7,
    pos: { x: DESK.pos.x + DESK.width / 2 - 0.16, y: DESK.topY + 0.17, z: DESK.pos.z + 0.22 },
    rotY: 0,
    leanX: 0,
    color: 0xffd66b,
    dangerous: true,
  });
  const blockColors = [0xf6538e, 0xffb020, 0x53b7f6, 0x7ed957, 0x9b6ef3];
  const bs = 0.1;
  for (let i = 0; i < 5; i++) {
    out.push({
      id: `block${i}`,
      kind: 'block',
      shape: 'box',
      size: { x: bs, y: bs, z: bs },
      mass: 0.15,
      pos: { x: 0.38 + (i % 2) * 0.004, y: bs / 2 + i * (bs + 0.001), z: -0.72 },
      rotY: i * 0.13,
      leanX: 0,
      color: blockColors[i],
      dangerous: false,
    });
  }
  return out;
}

export const kidsRoom = {
  id: 'kids',
  shell: {
    width: 4.4,
    depth: 4.4,
    wallHeight: 2.5,
    wallThickness: 0.12,
    window: { x: 0.95, y: 1.45, width: 1.05, height: 1.0 },
    rug: { x: 0.55, z: 0.15, radius: 1.05, style: 'rainbow' },
    wainscot: 0xffd7e6,
    picture: 'rainbow',
    pictureAt: { y: 1.55, z: 0.7 },
  },
  bearStart: { x: 0.62, z: 0.32 },
  statics: [
    { id: 'desk', mat: 'wood', pos: DESK.pos, boing: true, parts: buildDeskParts() },
    { id: 'shelf', mat: 'wood', pos: SHELF.pos, parts: buildShelfParts() },
    {
      id: 'cushion',
      mat: 'floor',
      pos: CUSHION.pos,
      parts: [{ shape: 'cyl', r: CUSHION.radius, h: CUSHION.height, x: 0, y: CUSHION.height / 2, z: 0 }],
    },
  ],
  tippables: [],
  dynamics: buildDynamics(),
  shields: [
    {
      zone: {
        x0: DESK.pos.x - DESK.width / 2 + 0.05,
        x1: DESK.pos.x + DESK.width / 2 - 0.05,
        z0: DESK.pos.z - DESK.depth / 2 - 0.04,
        z1: DESK.pos.z + DESK.depth / 2 + 0.04,
      },
      shieldY: DESK.topY - 0.07,
      badge: 'shield',
    },
  ],
  platforms: [
    { zone: { cx: CUSHION.pos.x, cz: CUSHION.pos.z, r: CUSHION.radius }, y: CUSHION.height * 0.9 },
  ],
  blocked: [
    {
      x0: SHELF.pos.x - SHELF.width / 2,
      x1: SHELF.pos.x + SHELF.width / 2,
      z0: -2.2,
      z1: SHELF.pos.z + SHELF.depth / 2,
    },
  ],
};
