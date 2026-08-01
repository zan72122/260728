/**
 * 部屋のレイアウト定義（物理と描画の共通ソース・単位はメートル）。
 *
 * ここに書かれた寸法・位置から、cannon-es の剛体と Three.js のメッシュの
 * 両方が生成される。数値を一箇所で管理することで、見た目と物理のズレを防ぐ。
 */

export const ROOM = {
  width: 4.4, // x方向
  depth: 4.4, // z方向
  wallHeight: 2.5,
  wallThickness: 0.12,
};

// 丈夫そうな低い机。天板が厚く、脚が太い。
export const DESK = {
  pos: { x: -1.12, z: -1.36 },
  width: 1.06,
  depth: 0.82,
  topY: 0.56, // 天板上面の高さ
  topThickness: 0.09,
  legSize: 0.11,
};

// 本棚（背の高い家具・背面の壁ぎわ）
export const SHELF = {
  pos: { x: -0.92, z: -1.98 },
  width: 1.18,
  depth: 0.34,
  height: 1.72,
  boardThickness: 0.05,
  shelfYs: [0.42, 0.88, 1.32], // 棚板上面の高さ
};

// クッション（部屋の手前側・家具から離れた安全な場所）
export const CUSHION = {
  pos: { x: 1.38, z: 1.12 },
  radius: 0.34,
  height: 0.16,
};

// 窓（背面の壁・視覚のみ）
export const WINDOW = {
  x: 0.95,
  y: 1.45,
  width: 1.05,
  height: 1.0,
};

// ラグ（視覚のみ）
export const RUG = {
  pos: { x: 0.55, z: 0.15 },
  radius: 1.05,
};

// くまのぬいぐるみ
export const BEAR = {
  height: 0.46,
  radius: 0.17, // 危険判定に使う半径
  startPos: { x: 0.62, z: 0.32 },
};

// 落下・移動する動的オブジェクト。
// dangerous: くまとの重なり判定（危険演出）の対象になるか。
export function createDynamicObjects() {
  const shelfTopY = SHELF.shelfYs[2] + 0.001;
  const shelfMidY = SHELF.shelfYs[1] + 0.001;
  const shelfFrontZ = SHELF.pos.z + SHELF.depth / 2;

  const books = [];
  const bookColors = [0xf6538e, 0x53b7f6, 0x7ed957, 0xffb020, 0x9b6ef3];
  // 最上段に「表紙を手前に向けて」立てた絵本（面出し収納）。
  // 薄い方向が手前なので、揺れで前へ倒れて棚から落ちる。
  const bookSpecs = [
    { x: -1.36, w: 0.2, h: 0.25, t: 0.042, lean: 0.09 },
    { x: -1.13, w: 0.21, h: 0.27, t: 0.048, lean: 0.13 },
    { x: -0.72, w: 0.19, h: 0.24, t: 0.042, lean: 0.1 },
    { x: -0.46, w: 0.2, h: 0.26, t: 0.046, lean: 0.12 },
  ];
  bookSpecs.forEach((s, i) => {
    books.push({
      id: `book${i}`,
      kind: 'book',
      shape: 'box',
      // 本：幅(x) × 高さ(y) × 厚み(z)
      size: { x: s.w, y: s.h, z: s.t },
      mass: 0.4,
      pos: {
        x: s.x,
        y: shelfTopY + s.h / 2 + 0.01,
        z: shelfFrontZ - s.t / 2 - 0.015,
      },
      rotY: 0,
      leanX: s.lean, // 少し前傾させて倒れやすくする（決定論・毎回同じ）
      color: bookColors[i % bookColors.length],
      dangerous: true,
    });
  });
  // 中段に寝かせた本（滑り出してくる）
  books.push({
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

  // 卓上ライト（机の右端・揺れで机から滑り落ちる）
  const lamp = {
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
  };

  // 積み木タワー（床の上・倒れて散らばる）
  const blocks = [];
  const blockColors = [0xf6538e, 0xffb020, 0x53b7f6, 0x7ed957, 0x9b6ef3];
  const bx = 0.38;
  const bz = -0.72;
  const bs = 0.1;
  for (let i = 0; i < 5; i++) {
    blocks.push({
      id: `block${i}`,
      kind: 'block',
      shape: 'box',
      size: { x: bs, y: bs, z: bs },
      mass: 0.15,
      pos: { x: bx + (i % 2) * 0.004, y: bs / 2 + i * (bs + 0.001), z: bz },
      rotY: i * 0.13,
      leanX: 0,
      color: blockColors[i],
      dangerous: false,
    });
  }

  return [...books, lamp, ...blocks];
}

/** くまを置ける範囲（家具の中には置けない） */
export function clampBearPosition(x, z) {
  const m = 0.24; // 壁からのマージン
  let cx = Math.max(-ROOM.width / 2 + m, Math.min(ROOM.width / 2 - m, x));
  let cz = Math.max(-ROOM.depth / 2 + m, Math.min(ROOM.depth / 2 - m, z));

  // 本棚の中には入れない（手前に押し出す）
  const sx0 = SHELF.pos.x - SHELF.width / 2 - BEAR.radius;
  const sx1 = SHELF.pos.x + SHELF.width / 2 + BEAR.radius;
  const sz1 = SHELF.pos.z + SHELF.depth / 2 + BEAR.radius;
  if (cx > sx0 && cx < sx1 && cz < sz1) {
    cz = sz1;
  }
  return { x: cx, z: cz };
}

/** くまが机の下にいるか */
export function isUnderDesk(x, z) {
  return (
    Math.abs(x - DESK.pos.x) < DESK.width / 2 - 0.05 &&
    Math.abs(z - DESK.pos.z) < DESK.depth / 2 + 0.04
  );
}

/** くまがクッションの上にいるか */
export function isOnCushion(x, z) {
  const dx = x - CUSHION.pos.x;
  const dz = z - CUSHION.pos.z;
  return dx * dx + dz * dz < CUSHION.radius * CUSHION.radius;
}
