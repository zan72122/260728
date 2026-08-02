import * as CANNON from 'cannon-es';
import { shieldAt, platformAt, inZone } from './layout.js';

/**
 * 事前シミュレーション（部屋データ駆動）。
 *
 * 「ぐらぐら」ボタンが押された瞬間に、地震の全過程を cannon-es で
 * 一気に計算し、全動的オブジェクトの軌道を Recording として返す。
 * 画面の再生はこの記録をなぞるだけなので、
 * A（1回目）と B（2回目）の物の動きは完全に一致する。
 *
 * くまは物理世界に存在しない（物にぶつからない）。
 * くまの安全・危険は、記録された軌道とくまの位置の重なりから後で判定する。
 * これにより「くまの位置だけを変えて、まったく同じ地震」が厳密に成立する。
 *
 * 転倒家具（tippables）は重い動的ボディとして参加する。
 * 金具（anchors）で固定された家具は静的ボディになり、同じ揺れでも倒れない。
 */

export const RECORD_EVERY = 2; // 2物理ステップごとに1フレーム記録（60fps相当）

function addParts(body, parts) {
  for (const p of parts) {
    let orientation;
    if (p.rotX || p.rotZ) {
      orientation = new CANNON.Quaternion();
      orientation.setFromEuler(p.rotX ?? 0, 0, p.rotZ ?? 0);
    }
    if (p.shape === 'cyl') {
      body.addShape(
        new CANNON.Cylinder(p.r, p.r, p.h, 12),
        new CANNON.Vec3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
        orientation,
      );
    } else {
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(p.hx, p.hy, p.hz)),
        new CANNON.Vec3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
        orientation,
      );
    }
  }
}

function buildRoomStatics(world, room, materials) {
  const { floorMat, woodMat } = materials;
  const W = room.shell.width;
  const D = room.shell.depth;
  const H = room.shell.wallHeight;
  const T = room.shell.wallThickness;

  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, material: floorMat });
  floor.addShape(new CANNON.Box(new CANNON.Vec3(W / 2 + 0.5, 0.5, D / 2 + 0.5)));
  floor.position.set(0, -0.5, 0);
  floor.userData = { id: 'floor' };
  world.addBody(floor);

  const backWall = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  backWall.addShape(new CANNON.Box(new CANNON.Vec3(W / 2, H / 2, T / 2)));
  backWall.position.set(0, H / 2, -D / 2 - T / 2);
  backWall.userData = { id: 'backWall' };
  world.addBody(backWall);

  const leftWall = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  leftWall.addShape(new CANNON.Box(new CANNON.Vec3(T / 2, H / 2, D / 2)));
  leftWall.position.set(-W / 2 - T / 2, H / 2, 0);
  leftWall.userData = { id: 'leftWall' };
  world.addBody(leftWall);

  for (const s of room.statics) {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: s.mat === 'floor' ? floorMat : woodMat,
    });
    addParts(body, s.parts);
    body.position.set(s.pos.x, 0, s.pos.z);
    if (s.rotY) body.quaternion.setFromEuler(0, s.rotY, 0);
    body.userData = { id: s.id };
    world.addBody(body);
  }
}

function buildDynamicBody(spec, objMat) {
  const body = new CANNON.Body({ mass: spec.mass, material: objMat });
  if (spec.shape === 'box') {
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2)),
    );
  } else if (spec.shape === 'sphere') {
    body.addShape(new CANNON.Sphere(spec.size.radius));
  } else {
    body.addShape(
      new CANNON.Cylinder(spec.size.radius, spec.size.radius * 1.15, spec.size.height, 10),
    );
  }
  body.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
  const q = new CANNON.Quaternion();
  q.setFromEuler(spec.leanX || 0, spec.rotY || 0, spec.leanZ || 0);
  body.quaternion.copy(q);
  body.linearDamping = 0.06;
  body.angularDamping = spec.shape === 'sphere' ? 0.4 : 0.1;
  body.allowSleep = false;
  body.userData = { id: spec.id };
  return body;
}

/** 転倒家具のスペックを動的ボディ用スペックに変換 */
export function tippableToSpec(t) {
  return {
    id: t.id,
    kind: t.kind,
    shape: 'box',
    size: t.size,
    mass: t.mass,
    pos: { x: t.pos.x, y: t.size.y / 2 + 0.002, z: t.pos.z },
    rotY: t.rotY || 0,
    leanX: 0,
    color: t.color,
    dangerous: t.dangerous ?? true,
    tippable: true,
  };
}

/**
 * 地震の全過程を計算して Recording を返す。
 * @param {object} room RoomDef
 * @param {object} quakeScript createQuakeScript() の結果
 * @param {Set<string>} anchors 金具で固定された転倒家具のid
 */
export function simulateQuake(room, quakeScript, anchors = new Set()) {
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.allowSleep = false;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;

  const floorMat = new CANNON.Material('floor');
  const woodMat = new CANNON.Material('wood');
  const objMat = new CANNON.Material('obj');
  // 平たい物（皿など）は接触点が多く実効摩擦が跳ね上がるため、
  // 「すべりやすい」専用マテリアルで棚から滑り出せるようにする
  const slickMat = new CANNON.Material('slick');
  world.addContactMaterial(
    new CANNON.ContactMaterial(floorMat, objMat, { friction: 0.5, restitution: 0.12 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(woodMat, objMat, { friction: 0.25, restitution: 0.2 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(objMat, objMat, { friction: 0.4, restitution: 0.1 }),
  );
  // 注意: cannon-es の摩擦 maxForce はステップあたりの力積を直接制限するため、
  // 「滑り出すしきい値」は名目μの百倍以上に相当する。滑らせたい物には
  // 極小のμを与える必要がある（実測でしきい値 ≈ μ×9.8×接触点数÷dt [m/s^2]）。
  world.addContactMaterial(
    new CANNON.ContactMaterial(woodMat, slickMat, { friction: 0.0008, restitution: 0.15 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(floorMat, slickMat, { friction: 0.02, restitution: 0.1 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(slickMat, slickMat, { friction: 0.0012, restitution: 0.1 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(objMat, slickMat, { friction: 0.01, restitution: 0.1 }),
  );

  buildRoomStatics(world, room, { floorMat, woodMat });

  // 金具で固定された家具は静的ボディとして立てる
  const specs = [];
  for (const t of room.tippables ?? []) {
    if (anchors.has(t.id)) {
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(t.size.x / 2, t.size.y / 2, t.size.z / 2)),
      );
      body.position.set(t.pos.x, t.size.y / 2 + 0.002, t.pos.z);
      if (t.rotY) body.quaternion.setFromEuler(0, t.rotY, 0);
      body.userData = { id: t.id };
      world.addBody(body);
    } else {
      specs.push(tippableToSpec(t));
    }
  }
  specs.push(...room.dynamics);

  const bodies = [];
  const impacts = [];
  const landings = new Map();

  for (const spec of specs) {
    const body = buildDynamicBody(spec, spec.slick ? slickMat : objMat);
    world.addBody(body);
    bodies.push({ spec, body });
  }

  let currentStep = 0;
  for (const { spec, body } of bodies) {
    body.addEventListener('collide', (e) => {
      const otherId = e.body.userData?.id;
      if (!otherId) return;
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed < 0.7) return;
      impacts.push({
        step: currentStep,
        id: spec.id,
        surface: otherId,
        speed,
        x: body.position.x,
        y: body.position.y,
        z: body.position.z,
      });
      if (otherId === 'floor' && !landings.has(spec.id)) {
        landings.set(spec.id, { step: currentStep, x: body.position.x, z: body.position.z });
      }
    });
  }

  const { dt, steps, accelX, accelZ } = quakeScript;
  const frameCount = Math.floor(steps / RECORD_EVERY);
  const frames = new Map();
  for (const { spec } of bodies) {
    frames.set(spec.id, new Float32Array(frameCount * 7));
  }

  const force = new CANNON.Vec3();
  for (let i = 0; i < steps; i++) {
    currentStep = i;
    const ax = accelX[i];
    const az = accelZ[i];
    if (ax !== 0 || az !== 0) {
      for (const { body } of bodies) {
        // 部屋固定座標系での慣性擬似力 F = -m * a_ground
        force.set(-body.mass * ax, 0, -body.mass * az);
        body.applyForce(force);
      }
    }
    world.step(dt);

    if (i % RECORD_EVERY === 0) {
      const f = i / RECORD_EVERY;
      for (const { spec, body } of bodies) {
        const arr = frames.get(spec.id);
        const o = f * 7;
        arr[o] = body.position.x;
        arr[o + 1] = body.position.y;
        arr[o + 2] = body.position.z;
        arr[o + 3] = body.quaternion.x;
        arr[o + 4] = body.quaternion.y;
        arr[o + 5] = body.quaternion.z;
        arr[o + 6] = body.quaternion.w;
      }
    }
  }

  world.bodies.slice().forEach((b) => world.removeBody(b));

  const recording = {
    roomId: room.id,
    seed: quakeScript.seed,
    strength: quakeScript.strength,
    anchors: [...anchors].sort(),
    dt: dt * RECORD_EVERY,
    frameCount,
    duration: quakeScript.duration,
    specs,
    frames,
    impacts,
    landings,
  };
  recording.tipEvents = findTipEvents(recording);
  return recording;
}

/** 上向きベクトルの傾き角（rad）をクォータニオンから求める */
function tiltOf(arr, f) {
  const o = f * 7;
  const qx = arr[o + 3];
  const qy = arr[o + 4];
  const qz = arr[o + 5];
  const qw = arr[o + 6];
  // up = q * (0,1,0) の y 成分
  const upY = 1 - 2 * (qx * qx + qz * qz);
  return Math.acos(Math.max(-1, Math.min(1, upY)));
}

/** 転倒家具の「倒れはじめ」「倒れきり」を記録から検出する */
function findTipEvents(recording) {
  const events = [];
  for (const spec of recording.specs) {
    if (!spec.tippable) continue;
    const arr = recording.frames.get(spec.id);
    let startFrame = -1;
    for (let f = 0; f < recording.frameCount; f++) {
      const tilt = tiltOf(arr, f);
      if (startFrame < 0 && tilt > 0.3) startFrame = f;
      if (tilt > 1.1) {
        const oEnd = (recording.frameCount - 1) * 7;
        events.push({
          id: spec.id,
          startFrame: Math.max(0, startFrame - 6),
          fallenFrame: f,
          restX: arr[oEnd],
          restZ: arr[oEnd + 2],
          size: spec.size,
        });
        break;
      }
      if (startFrame >= 0 && tilt < 0.15) startFrame = -1; // 揺り戻して立ち直った
    }
  }
  return events;
}

/**
 * 記録された軌道とくまの位置から、危険イベントを判定する。
 * 落下中・転倒中の危険物がくまの体の範囲に重なった瞬間を返す。
 * @returns {Array<{frame, id, x, y, z}>}
 */
export function findDangerEvents(room, recording, bearPos, bearRadius, bearHeight) {
  const events = [];
  const seen = new Set();

  // くまが机の下・布団の中などにいるなら、シールドより上の物は届かない
  const shield = shieldAt(room, bearPos.x, bearPos.z);
  // くまが台（ベッド等）に乗っていれば、体の範囲がその分上がる
  const platform = platformAt(room, bearPos.x, bearPos.z);
  const baseY = platform ? platform.y : 0;
  const topY = baseY + bearHeight;

  for (const spec of recording.specs) {
    if (!spec.dangerous) continue;
    const arr = recording.frames.get(spec.id);
    const big = spec.tippable === true;
    const objR = big
      ? 0
      : spec.shape === 'box'
        ? Math.max(spec.size.x, spec.size.y, spec.size.z) * 0.45
        : spec.shape === 'sphere'
          ? spec.size.radius
          : Math.max(spec.size.radius, spec.size.height * 0.45);
    let prevY = arr[1];
    let prevTilt = big ? tiltOf(arr, 0) : 0;
    for (let f = 1; f < recording.frameCount; f++) {
      const o = f * 7;
      const x = arr[o];
      const y = arr[o + 1];
      const z = arr[o + 2];
      const vy = (y - prevY) / recording.dt;
      prevY = y;
      if (seen.has(spec.id)) continue;

      if (big) {
        // 転倒家具：倒れながら（傾きが増えながら）くまの範囲に重なったか
        const tilt = tiltOf(arr, f);
        const tiltRate = (tilt - prevTilt) / recording.dt;
        prevTilt = tilt;
        if (tilt < 0.3 || tiltRate < 0.25) continue;
        if (obbHit(arr, o, spec.size, bearPos, baseY, topY, bearRadius)) {
          seen.add(spec.id);
          events.push({ frame: f, id: spec.id, x, y, z });
        }
        continue;
      }

      const oPrev = (f - 1) * 7;
      const vx = (x - arr[oPrev]) / recording.dt;
      const vz = (z - arr[oPrev + 2]) / recording.dt;
      const speed = Math.hypot(vx, vy, vz);
      if (speed < 0.9) continue;
      // 「宙にある・落ちてくる」物だけを危険とする。
      // 床の上をゆっくり滑ってくる物はぬいぐるみには危なくない。
      const airborne = y > baseY + 0.26 || vy < -0.8;
      if (!airborne) continue;
      if (shield && y > shield.shieldY) continue;
      const dx = x - bearPos.x;
      const dz = z - bearPos.z;
      const withinXZ = Math.hypot(dx, dz) < bearRadius + objR;
      const withinY = y - objR < topY && y + objR > baseY;
      if (withinXZ && withinY) {
        seen.add(spec.id);
        events.push({ frame: f, id: spec.id, x, y, z });
      }
    }
  }
  events.sort((a, b) => a.frame - b.frame);
  return events;
}

/** 向き付きボックス（転倒中の家具）とくまの重なり判定 */
function obbHit(arr, o, size, bearPos, baseY, topY, bearRadius) {
  const px = arr[o];
  const py = arr[o + 1];
  const pz = arr[o + 2];
  const qx = arr[o + 3];
  const qy = arr[o + 4];
  const qz = arr[o + 5];
  const qw = arr[o + 6];
  // くまの中心をボックスのローカル座標へ：v' = q^-1 * (p - pos)
  // 回転公式 v' = v + w*t + a×t（t = 2 a×v、a は共役の虚部）
  const vx = bearPos.x - px;
  const vy = (baseY + topY) / 2 - py;
  const vz = bearPos.z - pz;
  const ax = -qx;
  const ay = -qy;
  const az = -qz;
  const tx = 2 * (ay * vz - az * vy);
  const ty = 2 * (az * vx - ax * vz);
  const tz = 2 * (ax * vy - ay * vx);
  const lx = vx + qw * tx + (ay * tz - az * ty);
  const ly = vy + qw * ty + (az * tx - ax * tz);
  const lz = vz + qw * tz + (ax * ty - ay * tx);
  // 最近接点までの距離
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const dx = Math.max(Math.abs(lx) - hx, 0);
  const dy = Math.max(Math.abs(ly) - hy - (topY - baseY) / 2, 0);
  const dz = Math.max(Math.abs(lz) - hz, 0);
  return dx * dx + dy * dy + dz * dz < bearRadius * bearRadius;
}

export { inZone };
