import * as CANNON from 'cannon-es';
import { ROOM, DESK, SHELF, CUSHION, createDynamicObjects, isUnderDesk } from './layout.js';

/**
 * 事前シミュレーション。
 *
 * 「ぐらぐら」ボタンが押された瞬間に、地震の全過程を cannon-es で
 * 一気に計算し、全動的オブジェクトの軌道を Recording として返す。
 * 画面の再生はこの記録をなぞるだけなので、
 * A（1回目）と B（2回目）の物の動きは完全に一致する。
 *
 * くまは物理世界に存在しない（物にぶつからない）。
 * くまの安全・危険は、記録された軌道とくまの位置の重なりから後で判定する。
 * これにより「くまの位置だけを変えて、まったく同じ地震」が厳密に成立する。
 */

export const RECORD_EVERY = 2; // 2物理ステップごとに1フレーム記録（60fps相当）

function buildStaticBodies(world, materials) {
  const { floorMat, woodMat } = materials;

  // 床
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, material: floorMat });
  floor.addShape(new CANNON.Box(new CANNON.Vec3(ROOM.width / 2, 0.5, ROOM.depth / 2)));
  floor.position.set(0, -0.5, 0);
  floor.userData = { id: 'floor' };
  world.addBody(floor);

  // 壁（背面・左）
  const backWall = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  backWall.addShape(
    new CANNON.Box(new CANNON.Vec3(ROOM.width / 2, ROOM.wallHeight / 2, ROOM.wallThickness / 2)),
  );
  backWall.position.set(0, ROOM.wallHeight / 2, -ROOM.depth / 2 - ROOM.wallThickness / 2);
  backWall.userData = { id: 'backWall' };
  world.addBody(backWall);

  const leftWall = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  leftWall.addShape(
    new CANNON.Box(new CANNON.Vec3(ROOM.wallThickness / 2, ROOM.wallHeight / 2, ROOM.depth / 2)),
  );
  leftWall.position.set(-ROOM.width / 2 - ROOM.wallThickness / 2, ROOM.wallHeight / 2, 0);
  leftWall.userData = { id: 'leftWall' };
  world.addBody(leftWall);

  // 机：厚い天板と4本の脚
  const desk = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  desk.addShape(
    new CANNON.Box(new CANNON.Vec3(DESK.width / 2, DESK.topThickness / 2, DESK.depth / 2)),
    new CANNON.Vec3(0, DESK.topY - DESK.topThickness / 2, 0),
  );
  const legOffX = DESK.width / 2 - DESK.legSize / 2 - 0.03;
  const legOffZ = DESK.depth / 2 - DESK.legSize / 2 - 0.03;
  const legH = DESK.topY - DESK.topThickness;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      desk.addShape(
        new CANNON.Box(new CANNON.Vec3(DESK.legSize / 2, legH / 2, DESK.legSize / 2)),
        new CANNON.Vec3(sx * legOffX, legH / 2, sz * legOffZ),
      );
    }
  }
  desk.position.set(DESK.pos.x, 0, DESK.pos.z);
  desk.userData = { id: 'desk' };
  world.addBody(desk);

  // 本棚：側板・背板・棚板
  const shelf = new CANNON.Body({ type: CANNON.Body.STATIC, material: woodMat });
  const bt = SHELF.boardThickness;
  shelf.addShape(
    new CANNON.Box(new CANNON.Vec3(bt / 2, SHELF.height / 2, SHELF.depth / 2)),
    new CANNON.Vec3(-SHELF.width / 2 + bt / 2, SHELF.height / 2, 0),
  );
  shelf.addShape(
    new CANNON.Box(new CANNON.Vec3(bt / 2, SHELF.height / 2, SHELF.depth / 2)),
    new CANNON.Vec3(SHELF.width / 2 - bt / 2, SHELF.height / 2, 0),
  );
  shelf.addShape(
    new CANNON.Box(new CANNON.Vec3(SHELF.width / 2, SHELF.height / 2, bt / 2)),
    new CANNON.Vec3(0, SHELF.height / 2, -SHELF.depth / 2 + bt / 2),
  );
  for (const y of [bt / 2, ...SHELF.shelfYs.map((v) => v - bt / 2), SHELF.height - bt / 2]) {
    shelf.addShape(
      new CANNON.Box(new CANNON.Vec3(SHELF.width / 2 - bt, bt / 2, SHELF.depth / 2)),
      new CANNON.Vec3(0, y, 0),
    );
  }
  shelf.position.set(SHELF.pos.x, 0, SHELF.pos.z);
  shelf.userData = { id: 'shelf' };
  world.addBody(shelf);

  // クッション（柔らかい着地場所）
  const cushion = new CANNON.Body({ type: CANNON.Body.STATIC, material: floorMat });
  cushion.addShape(
    new CANNON.Cylinder(CUSHION.radius, CUSHION.radius, CUSHION.height, 12),
    new CANNON.Vec3(0, CUSHION.height / 2, 0),
  );
  cushion.position.set(CUSHION.pos.x, 0, CUSHION.pos.z);
  cushion.userData = { id: 'cushion' };
  world.addBody(cushion);

  return { floor, desk, shelf };
}

function buildDynamicBody(spec, objMat) {
  const body = new CANNON.Body({ mass: spec.mass, material: objMat });
  if (spec.shape === 'box') {
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2)),
    );
  } else {
    body.addShape(new CANNON.Cylinder(spec.size.radius, spec.size.radius * 1.15, spec.size.height, 10));
  }
  body.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
  const q = new CANNON.Quaternion();
  q.setFromEuler(spec.leanX || 0, spec.rotY || 0, 0);
  body.quaternion.copy(q);
  body.linearDamping = 0.06;
  body.angularDamping = 0.1;
  body.allowSleep = false;
  body.userData = { id: spec.id };
  return body;
}

/**
 * 地震の全過程を計算して Recording を返す。
 * @param {object} quakeScript createQuakeScript() の結果
 * @returns Recording
 */
export function simulateQuake(quakeScript) {
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.allowSleep = false;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;

  const floorMat = new CANNON.Material('floor');
  const woodMat = new CANNON.Material('wood');
  const objMat = new CANNON.Material('obj');
  world.addContactMaterial(
    new CANNON.ContactMaterial(floorMat, objMat, { friction: 0.5, restitution: 0.12 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(woodMat, objMat, { friction: 0.25, restitution: 0.2 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(objMat, objMat, { friction: 0.4, restitution: 0.1 }),
  );

  const statics = buildStaticBodies(world, { floorMat, woodMat });

  const specs = createDynamicObjects();
  const bodies = [];
  const impacts = []; // {step, id, surface, speed, x, y, z}
  const landings = new Map(); // id -> {step, x, z} 床への最初の着地

  for (const spec of specs) {
    const body = buildDynamicBody(spec, objMat);
    world.addBody(body);
    bodies.push({ spec, body });
  }

  let currentStep = 0;
  for (const { spec, body } of bodies) {
    body.addEventListener('collide', (e) => {
      const otherId = e.body.userData?.id;
      if (!otherId) return; // 動的オブジェクト同士は記録しない
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
  const frames = new Map(); // id -> Float32Array(frameCount * 7)
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

  // 後片付け（GC対象にする）
  world.bodies.slice().forEach((b) => world.removeBody(b));

  return {
    seed: quakeScript.seed,
    dt: dt * RECORD_EVERY, // 記録フレームの間隔
    frameCount,
    duration: quakeScript.duration,
    specs,
    frames,
    impacts,
    landings,
    staticIds: Object.keys(statics),
  };
}

/**
 * 記録された軌道とくまの位置から、危険イベントを判定する。
 * 落下中の危険物がくまの体の範囲に重なった瞬間を返す。
 * @returns {Array<{frame, id, x, y, z}>}
 */
export function findDangerEvents(recording, bearPos, bearRadius, bearHeight) {
  const events = [];
  const seen = new Set();
  // くまが机の下にいるなら、天板より上の物は届かない（天板が守ってくれる）
  const shielded = isUnderDesk(bearPos.x, bearPos.z);
  const shieldY = DESK.topY - 0.07;
  for (const spec of recording.specs) {
    if (!spec.dangerous) continue;
    const arr = recording.frames.get(spec.id);
    const objR = spec.shape === 'box'
      ? Math.max(spec.size.x, spec.size.y, spec.size.z) * 0.45
      : Math.max(spec.size.radius, spec.size.height * 0.45);
    let prevY = arr[1];
    for (let f = 1; f < recording.frameCount; f++) {
      const o = f * 7;
      const x = arr[o];
      const y = arr[o + 1];
      const z = arr[o + 2];
      const vy = (y - prevY) / recording.dt;
      prevY = y;
      if (seen.has(spec.id)) continue;
      const oPrev = (f - 1) * 7;
      const vx = (x - arr[oPrev]) / recording.dt;
      const vz = (z - arr[oPrev + 2]) / recording.dt;
      const speed = Math.hypot(vx, vy, vz);
      if (speed < 0.9) continue;
      // 「宙にある・落ちてくる」物だけを危険とする。
      // 床の上をゆっくり滑ってくる物はぬいぐるみには危なくない。
      const airborne = y > 0.26 || vy < -0.8;
      if (!airborne) continue;
      if (shielded && y > shieldY) continue;
      const dx = x - bearPos.x;
      const dz = z - bearPos.z;
      const horiz = Math.hypot(dx, dz);
      const withinXZ = horiz < bearRadius + objR;
      const withinY = y - objR < bearHeight && y + objR > 0;
      if (withinXZ && withinY) {
        seen.add(spec.id);
        events.push({ frame: f, id: spec.id, x, y, z });
      }
    }
  }
  events.sort((a, b) => a.frame - b.frame);
  return events;
}
