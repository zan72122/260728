/**
 * くまの寸法と、部屋定義（RoomDef）を解釈する汎用ヘルパー。
 *
 * RoomDef の形：
 * {
 *   id, label絵文字なし,
 *   shell: { width, depth, wallHeight, wallThickness, window, rug, colors... },
 *   bearStart: {x,z},
 *   statics:   [{ id, mat:'wood'|'floor', pos:{x,z}, rotY?, boing?, soft?,
 *                 parts:[{shape:'box',hx,hy,hz,x,y,z} | {shape:'cyl',r,h,x,y,z}] }],
 *   tippables: [{ id, kind, size:{x,y,z}, mass, pos:{x,z}, rotY?, color, anchorable }],
 *   dynamics:  [spec...]（simulate.js 参照）,
 *   shields:   [{ zone, shieldY, badge:'shield'|'futon' }],
 *   platforms: [{ zone, y, futon? }],
 *   blocked:   [zone...]  くまを置けない範囲
 * }
 * zone は矩形 {x0,x1,z0,z1} または円 {cx,cz,r}。
 */

export const BEAR = {
  height: 0.46,
  radius: 0.17,
};

export function inZone(zone, x, z, pad = 0) {
  if (zone.r !== undefined) {
    const dx = x - zone.cx;
    const dz = z - zone.cz;
    const r = zone.r + pad;
    return dx * dx + dz * dz < r * r;
  }
  return x > zone.x0 - pad && x < zone.x1 + pad && z > zone.z0 - pad && z < zone.z1 + pad;
}

/** くまを置ける位置にクランプ（壁と立入禁止ゾーンから押し出す） */
export function clampBearPosition(room, x, z) {
  const m = 0.24;
  const W = room.shell.width;
  const D = room.shell.depth;
  let cx = Math.max(-W / 2 + m, Math.min(W / 2 - m, x));
  let cz = Math.max(-D / 2 + m, Math.min(D / 2 - m, z));

  for (const zone of room.blocked ?? []) {
    if (!inZone(zone, cx, cz, BEAR.radius)) continue;
    if (zone.r !== undefined) {
      const dx = cx - zone.cx;
      const dz = cz - zone.cz;
      const d = Math.hypot(dx, dz) || 0.001;
      const push = (zone.r + BEAR.radius) / d;
      cx = zone.cx + dx * push;
      cz = zone.cz + dz * push;
    } else {
      // 最も浅い側へ押し出す
      const candidates = [
        { d: cx - (zone.x0 - BEAR.radius), set: () => (cx = zone.x0 - BEAR.radius) },
        { d: zone.x1 + BEAR.radius - cx, set: () => (cx = zone.x1 + BEAR.radius) },
        { d: cz - (zone.z0 - BEAR.radius), set: () => (cz = zone.z0 - BEAR.radius) },
        { d: zone.z1 + BEAR.radius - cz, set: () => (cz = zone.z1 + BEAR.radius) },
      ].filter((c) => c.d > 0);
      candidates.sort((a, b) => a.d - b.d);
      candidates[0]?.set();
    }
  }
  return { x: cx, z: cz };
}

/** くまが乗っている台（ベッド・クッション・ソファ） */
export function platformAt(room, x, z) {
  for (const p of room.platforms ?? []) {
    if (inZone(p.zone, x, z)) return p;
  }
  return null;
}

/** くまがいる場所のシールド（机の天板・布団など） */
export function shieldAt(room, x, z) {
  for (const s of room.shields ?? []) {
    if (inZone(s.zone, x, z)) return s;
  }
  return null;
}
