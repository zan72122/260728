/* ============================================================
 * physics.js — パンケーキ塔の物理（ハイブリッド構成）
 *
 *   [stack]   自作ソルバー: 層ごとの粘性結合せん断・マイクロスリップ・
 *             実接触ベースの傾き（ふち乗り）— 因果が読みやすい
 *   [tipping] ふちを支点にした振り子で「じわ…っと倒れ込む」中間状態
 *   [free]    cannon-es 剛体: 落下・相互衝突・自然な山積み
 *   [landed]  眠った姿勢のまま静的化（スナップしない）
 *
 *   状態遷移はすべて姿勢・速度を連続に引き継ぐ。
 * ============================================================ */
(function () {
  const P = {
    scene: null,
    world: null,             // CANNON.World
    stack: [],               // 塔（下から上へ）
    tipGroups: [],           // 倒れ込み中のグループ
    bodies: [],              // 動いている剛体ラッパー {body, items:[{pan, off, lq}], life}
    staticCakes: [],         // 眠って静的化した剛体
    berries: [],             // ころがるいちご {body, mesh}
    kinPool: new Map(),      // pancake -> kinematic body（塔・tipping中の当たり）
    instability: 0,
    shakeT: 0,               // 崩壊連鎖の「揺すられ」タイマー
    on: {},
    _emptyFired: true,
    landedMeshes: [],
    landedPancakes: [],
  };
  PT.Physics = P;

  const V2 = THREE.Vector2, V3 = THREE.Vector3;
  const _v = new V3(), _v2 = new V3(), _v3 = new V3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const ZERO2 = new V2(0, 0);

  let matCake = null, matGround = null;
  let lastCollideSnd = 0;

  // ================= 初期化 =================
  P.init = function (scene) {
    P.scene = scene;
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -PT.G, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    P.world = world;

    matCake = new CANNON.Material('cake');
    matGround = new CANNON.Material('ground');
    world.addContactMaterial(new CANNON.ContactMaterial(matCake, matGround, {
      friction: 0.45, restitution: 0.18,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(matCake, matCake, {
      friction: 0.55, restitution: 0.08,
    }));
    world.defaultContactMaterial.friction = 0.4;
    world.defaultContactMaterial.restitution = 0.1;

    // テーブル（無限平面）
    const ground = new CANNON.Body({ mass: 0, material: matGround });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(ground);

    // 中央の大皿 + サーブ皿（静的シリンダー）
    addPlateBody(0, 0, PT.PLATE_R, PT.PLATE_H);
    PT.World.servePlates.forEach((s) => addPlateBody(s.pos.x, s.pos.z, PT.SERVE_R, PT.SERVE_H));
  };

  function addPlateBody(x, z, r, h) {
    const b = new CANNON.Body({ mass: 0, material: matGround });
    b.addShape(new CANNON.Cylinder(r, r * 0.8, h, 14));
    b.position.set(x, h / 2, z);
    P.world.addBody(b);
  }

  // FX用の概算地面高さ（皿の上だけ考慮）
  P.groundHeight = function (x, z) {
    if (x * x + z * z < PT.PLATE_R * PT.PLATE_R) return PT.PLATE_H;
    for (let i = 0; i < PT.World.servePlates.length; i++) {
      const s = PT.World.servePlates[i].pos;
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < PT.SERVE_R * PT.SERVE_R) return PT.SERVE_H;
    }
    return 0;
  };

  // ================= 塔のセット / 掃除 =================
  P.setTower = function (pancakes) {
    P.stack = pancakes.slice();
    P._emptyFired = false;
    pancakes.forEach((p) => {
      P.scene.add(p.mesh);
      p._spawnT = p.appearDelay;
      p._spawned = false;
    });
  };

  P.clearAll = function () {
    P.stack.forEach((p) => { P.scene.remove(p.mesh); PT.disposeObject(p.mesh); });
    P.tipGroups.forEach((g) => g.pancakes.forEach((p) => { P.scene.remove(p.mesh); PT.disposeObject(p.mesh); }));
    P.bodies.forEach((w) => {
      P.world.removeBody(w.body);
      w.items.forEach((it) => { P.scene.remove(it.pan.mesh); PT.disposeObject(it.pan.mesh); });
    });
    P.staticCakes.forEach((b) => P.world.removeBody(b));
    P.berries.forEach((be) => {
      if (be.body) P.world.removeBody(be.body);
      P.scene.remove(be.mesh); PT.disposeObject(be.mesh);
    });
    P.kinPool.forEach((b) => P.world.removeBody(b));
    P.kinPool.clear();
    P.landedMeshes.forEach((m) => { P.scene.remove(m); PT.disposeObject(m); });
    P.stack = []; P.tipGroups = []; P.bodies = []; P.staticCakes = []; P.berries = [];
    P.landedMeshes = []; P.landedPancakes = [];
    P._emptyFired = true;
  };

  // ================= メインステップ =================
  P.step = function (dt) {
    P.shakeT = Math.max(0, P.shakeT - dt);
    stepStack(dt);
    stepTipping(dt);
    preEngine(dt);
    P.world.step(1 / 60, dt, 4);
    syncBodies(dt);
    syncBerries();
    checkEmpty();
  };

  // ============================================================
  //  塔ソルバー: 粘性結合せん断 + マイクロスリップ + ふち乗り傾き
  // ============================================================
  function stepStack(dt) {
    const st = P.stack;
    P.instability *= Math.pow(0.3, dt);
    if (!st.length) return;

    // ---- y目標（傾いた層のぶん少し沈む） ----
    let y = PT.PLATE_H + PT.PANCAKE_H * 0.36;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      p.yTarget = y;
      y += PT.PANCAKE_H * 0.68 * (1 - 0.3 * Math.sin(Math.min(p.tiltA, 0.6)));
    }

    // ---- 出現・落下（登場と「ずどん」） ----
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!p._spawned) {
        p._spawnT -= dt;
        if (p._spawnT <= 0) {
          p._spawned = true;
          p.visibleNow = true;
          p.mesh.visible = true;
          p.yCur = p.yTarget + 10;
          p.yVel = -2;
          ensureKinBody(p);
        } else continue;
      }
      if (p.yCur > p.yTarget + 0.005) {
        p.yVel -= PT.G * dt;
        p.yCur += p.yVel * dt;
        if (p.yCur <= p.yTarget) {
          const v = Math.abs(p.yVel);
          p.yCur = p.yTarget;
          p.yVel = 0;
          if (v > 2.5) {
            p.doSquash(PT.clamp(v * 0.55, 1.5, 6));
            p.jiggle(PT.clamp(v * 0.1, 0.2, 0.9));
            if (i > 0) { st[i - 1].doSquash(PT.clamp(v * 0.25, 0.6, 3)); st[i - 1].jiggle(0.3); }
            if (P.on.plop) P.on.plop(p, v);
          }
        }
      } else {
        p.yCur = p.yTarget;
      }
    }

    // ---- 上からの累積質量と重心 ----
    let cm = 0, cx = 0, cz = 0;
    for (let i = st.length - 1; i >= 0; i--) {
      const p = st[i];
      if (!p._spawned) continue;
      const m = p.totalMass();
      cm += m;
      cx += (p.xz.x + p.comOff.x) * m;
      cz += (p.xz.y + p.comOff.y) * m;
      p._aM = cm; p._aX = cx / cm; p._aZ = cz / cm;
    }

    // ---- 層ごとの速度更新（粘性結合せん断） ----
    const shake = P.shakeT > 0 ? 0.8 : 1;
    let detachI = -1, detachMode = null;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!p._spawned || p.yCur > p.yTarget + 0.05) { p.relSpeed = 0; continue; }
      let sx, sz, sr, below = null;
      const belowVel = i > 0 ? st[i - 1].slideV : ZERO2;
      if (i === 0) { sx = 0; sz = 0; sr = PT.PLATE_R * 0.48; }
      else { below = st[i - 1]; sx = below.xz.x; sz = below.xz.y; sr = below.r; }

      const dx = p._aX - sx, dz = p._aZ - sz;
      const dist = Math.hypot(dx, dz);
      const ux = dist > 1e-4 ? dx / dist : 0;
      const uz = dist > 1e-4 ? dz / dist : 0;
      const lean = dist / sr;

      // 駆動力: 重心のずれ + 下の実効傾きの坂
      const driveMag = PT.G * (0.10 * lean + 0.65 * PT.smooth(0.30, 1.05, lean));
      let fx = ux * driveMag;
      let fz = uz * driveMag;
      if (below) {
        const tl = Math.hypot(below.tvX, below.tvY);
        if (tl > 0.03) {
          fx += (below.tvX / tl) * Math.sin(Math.min(tl, 0.8)) * PT.G * 0.6;
          fz += (below.tvY / tl) * Math.sin(Math.min(tl, 0.8)) * PT.G * 0.6;
        }
      }
      const bonded = i > 0 && p.chocoBond > 0.5;
      const fmag = Math.hypot(fx, fz);
      const res = p.mu() * PT.G * 0.5 * shake;

      if (bonded) {
        // 接着: 下と完全に同じ速度（相対運動なし）
        p.slideV.copy(belowVel);
        p.relSpeed = 0;
      } else {
        const relX = p.slideV.x - belowVel.x;
        const relY = p.slideV.y - belowVel.y;
        p.relSpeed = Math.hypot(relX, relY);
        const wasSlow = p.relSpeed < 0.35;

        if (fmag > res) {
          // 動摩擦: すべりが加速。粘性でゆるく下に引きずられる
          const s = (fmag - res) / fmag;
          p.slideV.x += fx * s * dt;
          p.slideV.y += fz * s * dt;
          const k = Math.min(1, 3.0 * dt);
          p.slideV.x += (belowVel.x - p.slideV.x) * k;
          p.slideV.y += (belowVel.y - p.slideV.y) * k;
          if (wasSlow && p.relSpeed > 0.3 && P.on.slip) P.on.slip(p);
        } else if (p.relSpeed > 0.25) {
          // 動摩擦: 動いている層は一定減速度で滑り続ける
          // （つんつんやシロップ層の勢いが摩擦距離のぶんだけ生きる）
          const f = Math.max(0, 1 - (res * dt) / p.relSpeed);
          p.slideV.x = belowVel.x + relX * f;
          p.slideV.y = belowVel.y + relY * f;
        } else {
          // 静止キャッチ: 1次遅れで下に追従 → 塔がしなる（せん断）
          const k = Math.min(1, 10 * dt);
          p.slideV.x += (belowVel.x - p.slideV.x) * k;
          p.slideV.y += (belowVel.y - p.slideV.y) * k;
          // マイクロスリップ: 限界近くで「ぎし…っ」と数ミリ滑る
          if (fmag > res * 0.55 && Math.random() < dt * 2.4 * (fmag / res)) {
            const j = PT.rand(0.05, 0.16);
            p.slideV.x += ux * j;
            p.slideV.y += uz * j;
            p.jiggle(0.12);
            p.wobble = Math.max(p.wobble, 0.5);
            if (P.on.microSlip) P.on.microSlip(p);
          }
        }
      }

      // ぐらぐら表現
      const inst = PT.clamp((lean - 0.45) * 1.6, 0, 1.2) + PT.clamp(p.relSpeed * 0.3, 0, 0.5);
      p.wobble += (inst * 0.8 - p.wobble) * Math.min(1, dt * 4);
      if (inst > P.instability) P.instability = inst;

      // ---- ふち乗り傾き（実接触ベース） ----
      let od, ox = 0, oz = 0, contactR;
      if (below) {
        ox = p.xz.x - below.xz.x; oz = p.xz.y - below.xz.y;
        od = Math.hypot(ox, oz);
        contactR = below.r;
      } else {
        ox = p.xz.x; oz = p.xz.y;
        od = Math.hypot(ox, oz);
        contactR = PT.PLATE_R * 0.56;
      }
      // ふちに乗り出した傾き / 片側荷重でたわむ傾き（大きい方を採用）
      const edgeTilt = PT.clamp((od - contactR * 0.30) / (p.r * 1.1), 0, 1) * 0.62;
      const loadTilt = PT.clamp((lean - 0.28) * 0.5, 0, 0.4);
      if (loadTilt > edgeTilt) {
        p.tiltTarget = loadTilt;
        p.tiltDir.set(ux, uz);
      } else {
        p.tiltTarget = edgeTilt;
        if (od > 0.01) p.tiltDir.set(ox / od, oz / od);
      }
      p.tiltA += (p.tiltTarget - p.tiltA) * Math.min(1, dt * 6);
      // 実効傾き = 自分の傾き + 下の実効傾きの持ち越し（塔全体がしなって傾く）
      const bx = below ? below.tvX * 0.8 : 0;
      const by = below ? below.tvY * 0.8 : 0;
      p.tvX = p.tiltDir.x * p.tiltA + bx;
      p.tvY = p.tiltDir.y * p.tiltA + by;

      // ふわもち: 張り出した側がたれる
      p.drapeTarget = PT.clamp((od - contactR * 0.55) / p.r, 0, 1) * 0.55;
      p.drapeDirX = p.tiltDir.x; p.drapeDirY = p.tiltDir.y;

      // ---- はがれ判定（いちばん下の該当層のみ） ----
      if (detachI < 0) {
        const offRatio = od / (contactR * (below ? 0.95 : 1));
        if (lean > 1.02 || offRatio > 1.0) {
          detachI = i;
          detachMode = p.relSpeed > 2.0 ? 'slide' : 'tip';
        }
      }
    }

    // ---- 位置更新（各層は自分の速度で動く。板の平行移動はしない） ----
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!p._spawned) continue;
      p.xz.x += p.slideV.x * dt;
      p.xz.y += p.slideV.y * dt;
    }

    if (detachI >= 0) detach(detachI, detachMode);

    // ---- 見た目・キネマティック当たり ----
    for (let i = 0; i < st.length; i++) {
      st[i].syncStack(dt);
      syncKinBody(st[i]);
    }
  }

  // ============================================================
  //  はがれ: slide（勢いで抜ける）/ tip（ふちで粘って倒れ込む）
  // ============================================================
  function detach(i, mode) {
    const st = P.stack;
    const p = st[i];
    P.shakeT = 2.2;

    // チョコ接着の連続グループ
    let j = i;
    while (j + 1 < st.length && st[j + 1].chocoBond > 0.5) j++;

    if (mode === 'slide' && j < st.length - 1) {
      // ずるっと抜ける: 今の姿勢・速度のままエンジンへ
      const group = st.splice(i, j - i + 1);
      const belowVel = i > 0 ? st[i - 1].slideV : ZERO2;
      toEngine(group, {
        vel: new V3(p.slideV.x * 1.25, 0.2, p.slideV.y * 1.25),
        angVel: tumbleAxisFor(p.slideV).multiplyScalar(1.2),
      });
      // 残った上の段は少し暴れる
      for (let k = i; k < st.length; k++) {
        st[k].slideV.x += belowVel.x * 0.3 + PT.rand(-0.5, 0.5);
        st[k].slideV.y += belowVel.y * 0.3 + PT.rand(-0.5, 0.5);
        st[k].wobble = Math.max(st[k].wobble, 0.8);
        st[k].jiggle(0.35);
      }
      if (P.on.detach) P.on.detach('slide', group.length);
    } else {
      // ふちを支点に、じわ…っと倒れ込む
      const above = st.splice(i);
      startTipping(above, i, p);
      if (P.on.detach) P.on.detach('tip', above.length);
    }
  }

  function tumbleAxisFor(v2) {
    if (v2.lengthSq() > 0.01) {
      _v.set(v2.x, 0, v2.y).normalize();
      return new V3(_v.z, PT.rand(-0.15, 0.15), -_v.x);
    }
    return new V3(PT.rand(-1, 1), 0, PT.rand(-1, 1)).normalize();
  }

  // ============================================================
  //  tipping: 支点まわりの振り子
  // ============================================================
  function startTipping(pancakes, idx, base) {
    const below = P.stack[idx - 1] || null;
    // 倒れる方向
    const d = new V2(base._aX - (below ? below.xz.x : 0), base._aZ - (below ? below.xz.y : 0));
    if (d.lengthSq() < 0.01) d.copy(base.tiltDir);
    if (d.lengthSq() < 0.01) d.set(PT.rand(-1, 1), PT.rand(-1, 1));
    d.normalize();

    // 支点 = 下の層（or 皿）のふち
    const pr = below ? below.r * 0.95 : PT.PLATE_R * 0.6;
    const px = (below ? below.xz.x : 0) + d.x * pr;
    const pz = (below ? below.xz.y : 0) + d.y * pr;
    const py = below ? below.yCur + PT.PANCAKE_H * 0.3 : PT.PLATE_H;

    // グループ重心（トッピングの片寄りも含める）
    let m = 0, cx = 0, cy = 0, cz = 0;
    pancakes.forEach((p) => {
      const pm = p.totalMass();
      m += pm;
      cx += (p.xz.x + p.comOff.x) * pm;
      cy += p.yCur * pm;
      cz += (p.xz.y + p.comOff.y) * pm;
    });
    cx /= m; cy /= m; cz /= m;
    const comH = Math.max(0.8, Math.hypot(cx - px, cy - py, cz - pz));
    const horiz = Math.hypot(cx - px, cz - pz);
    // 既に倒れると決まった状態なので、最低でも少し前傾から始める
    let phi0 = Math.atan2(Math.max(0.05, horiz), Math.max(0.1, cy - py)) * ((cx - px) * d.x + (cz - pz) * d.y >= 0 ? 1 : -1);
    if (phi0 < 0.08) phi0 = 0.08;

    const group = {
      pancakes,
      pivot: new V3(px, py, pz),
      axis: new V3(d.y, 0, -d.x).normalize(),   // このaxis回りの+回転で d方向へ倒れる
      dir: d,
      theta: 0,
      omega: 0.25 + Math.min(base.relSpeed * 0.25, 0.6),
      phi0: Math.abs(phi0) < 0.06 ? 0.06 : phi0,
      comH,
      t: 0,
      poses0: pancakes.map((p) => ({
        pos: p.mesh.position.clone(),
        quat: p.mesh.quaternion.clone(),
      })),
    };
    pancakes.forEach((p) => {
      p.state = 'tipping';
      p.setFace('wee');
      p.slideV.set(0, 0);
    });
    P.tipGroups.push(group);
  }

  function stepTipping(dt) {
    for (let gi = P.tipGroups.length - 1; gi >= 0; gi--) {
      const g = P.tipGroups[gi];
      g.t += dt;
      // 倒立振り子: 傾くほど加速（じわ…っ → ぐらり）
      const alpha = (PT.G / g.comH) * Math.sin(Math.min(g.phi0 + g.theta, 1.5)) * 1.15;
      g.omega += alpha * dt;
      g.theta += g.omega * dt;
      // 後ろに戻りすぎない（ふちに引っかかっている想定）
      if (g.theta < -0.04) { g.theta = -0.04; g.omega = Math.max(g.omega, 0); }

      _q.setFromAxisAngle(g.axis, g.theta);
      for (let i = 0; i < g.pancakes.length; i++) {
        const p = g.pancakes[i];
        const p0 = g.poses0[i];
        _v.copy(p0.pos).sub(g.pivot).applyQuaternion(_q).add(g.pivot);
        p.mesh.position.copy(_v);
        p.mesh.quaternion.copy(_q).multiply(p0.quat);
        // たれ下がり（支点の反対側がたれる）
        p.drapeTarget = Math.min(0.8, g.theta * 1.4 + 0.15);
        p.drapeDirX = g.dir.x; p.drapeDirY = g.dir.y;
        p.updateDeform(dt);
        syncKinBody(p);
      }
      P.instability = Math.max(P.instability, 0.9);

      // 手放すタイミング: 十分倒れた / 時間切れ
      if (g.phi0 + g.theta > 1.02 || g.theta > 0.85 || g.t > 1.6 || g.theta < -0.03 && g.t > 0.8) {
        releaseTipGroup(g);
        P.tipGroups.splice(gi, 1);
      }
    }
  }

  function releaseTipGroup(g) {
    // 接着サブグループごとにエンジンへ（姿勢・角速度は完全連続）
    const wAxis = _v3.copy(g.axis).multiplyScalar(g.omega);
    let k = 0;
    while (k < g.pancakes.length) {
      let e = k;
      while (e + 1 < g.pancakes.length && g.pancakes[e + 1].chocoBond > 0.5) e++;
      const sub = g.pancakes.slice(k, e + 1);
      // グループ重心の速度 v = ω × r
      let m = 0; const com = new V3();
      sub.forEach((p) => { const pm = p.totalMass(); m += pm; com.addScaledVector(p.mesh.position, pm); });
      com.multiplyScalar(1 / m);
      const vel = new V3().copy(wAxis).cross(_v.copy(com).sub(g.pivot));
      toEngine(sub, { vel, angVel: wAxis.clone() });
      k = e + 1;
    }
  }

  // ============================================================
  //  cannon-es: 落下・衝突・山積み
  // ============================================================
  function toEngine(group, opt) {
    group.forEach((p) => shedBerries(p));
    // 重心（現在のメッシュ姿勢から）
    let m = 0; const com = new V3();
    group.forEach((p) => { const pm = p.totalMass(); m += pm; com.addScaledVector(p.mesh.position, pm); });
    com.multiplyScalar(1 / m);

    const body = new CANNON.Body({
      mass: m,
      material: matCake,
      position: new CANNON.Vec3(com.x, com.y, com.z),
      linearDamping: 0.04,
      angularDamping: 0.25,
      allowSleep: true,
      sleepSpeedLimit: 0.55,
      sleepTimeLimit: 0.35,
    });
    const items = group.map((p) => {
      removeKinBody(p);
      p.state = 'free';
      p.setFace('wee');
      const off = p.mesh.position.clone().sub(com);
      const lq = p.mesh.quaternion.clone();
      const shape = new CANNON.Cylinder(p.r * 0.95, p.r * 0.95, p.h * 0.74, 10);
      body.addShape(shape,
        new CANNON.Vec3(off.x, off.y, off.z),
        new CANNON.Quaternion(lq.x, lq.y, lq.z, lq.w));
      return { pan: p, off, lq };
    });
    if (opt && opt.vel) body.velocity.set(opt.vel.x, opt.vel.y, opt.vel.z);
    if (opt && opt.angVel) body.angularVelocity.set(opt.angVel.x, opt.angVel.y, opt.angVel.z);

    body.addEventListener('collide', onCakeCollide);
    P.world.addBody(body);
    const wrap = { body, items, life: 0 };
    body._wrap = wrap;
    P.bodies.push(wrap);

    // 同時アクティブ数の上限（地面近くの古いものから寝かせる。空中では凍らせない）
    if (P.bodies.length > 18) {
      for (let i = 0; i < P.bodies.length; i++) {
        if (P.bodies[i].body.position.y < 2.2) { P.bodies[i].body.sleep(); break; }
      }
    }
    return wrap;
  }

  function onCakeCollide(e) {
    const now = performance.now();
    const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (impact < 1.2) return;
    const wrap = e.target._wrap;
    if (wrap) {
      wrap.items.forEach((it) => {
        it.pan.jiggle(PT.clamp(impact * 0.08, 0.15, 0.8));
        it.pan.doSquash(PT.clamp(impact * 0.35, 0.8, 4));
      });
    }
    if (now - lastCollideSnd > 90) {
      lastCollideSnd = now;
      if (P.on.collide) P.on.collide(impact, e.target.position);
    }
    // 塔（キネマティック）に当たったら塔が揺れる
    if (e.body._stackPancake) {
      const sp = e.body._stackPancake;
      if (sp.state === 'stack') {
        _v.copy(e.target.velocity);
        sp.slideV.x += _v.x * 0.12;
        sp.slideV.y += _v.z * 0.12;
        sp.wobble = Math.max(sp.wobble, 0.9);
        sp.jiggle(0.4);
      }
    }
  }

  function preEngine(dt) {
    // 落下中だけ、いちばん近いサーブ皿へほんの少し吸い寄せ
    for (let i = 0; i < P.bodies.length; i++) {
      const b = P.bodies[i].body;
      if (b.velocity.y < -0.6 && b.position.y < 5.5) {
        let best = null, bd = 5.2;
        for (let k = 0; k < PT.World.servePlates.length; k++) {
          const s = PT.World.servePlates[k].pos;
          const d = Math.hypot(s.x - b.position.x, s.z - b.position.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best && bd > 0.3) {
          const f = 7.5 * b.mass * (1 - bd / 5.2);
          b.applyForce(new CANNON.Vec3(
            (best.x - b.position.x) / bd * f, 0, (best.z - b.position.z) / bd * f));
        }
      }
    }
  }

  function syncBodies(dt) {
    for (let bi = P.bodies.length - 1; bi >= 0; bi--) {
      const w = P.bodies[bi];
      const b = w.body;
      w.life += dt;
      // メッシュへ（姿勢はエンジンそのまま）
      _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      for (let ii = 0; ii < w.items.length; ii++) {
        const it = w.items[ii];
        it.pan.mesh.position.copy(it.off).applyQuaternion(_q)
          .add(_v.set(b.position.x, b.position.y, b.position.z));
        it.pan.mesh.quaternion.copy(_q).multiply(it.lq);
        it.pan.drapeTarget = 0.12;
        it.pan.updateDeform(dt);
      }
      if (w.life > 6 && b.sleepState !== CANNON.Body.SLEEPING) b.sleep();
      if (b.sleepState === CANNON.Body.SLEEPING || b.position.y < -6) {
        settle(w);
        P.bodies.splice(bi, 1);
      }
    }
  }

  // 眠った姿勢のまま静的化（スナップしない）
  function settle(w) {
    const b = w.body;
    b.removeEventListener('collide', onCakeCollide);
    b.type = CANNON.Body.STATIC;
    b.mass = 0;
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.updateMassProperties();
    P.staticCakes.push(b);

    w.items.forEach((it) => {
      const p = it.pan;
      p.state = 'landed';
      p.drapeTarget = 0;
      P.landedMeshes.push(p.mesh);
      P.landedPancakes.push(p);
      // サーブ判定
      let served = null;
      const mp = p.mesh.position;
      for (let i = 0; i < PT.World.servePlates.length; i++) {
        const s = PT.World.servePlates[i];
        const dx = mp.x - s.pos.x, dz = mp.z - s.pos.z;
        if (dx * dx + dz * dz < PT.SERVE_R * PT.SERVE_R * 1.25) { served = s; break; }
      }
      if (served) {
        p.state = 'served';
        p.setFace('happy');
        if (P.on.serve) P.on.serve(p, served);
      } else {
        p.setFace('sleep');
        if (P.on.land) P.on.land(p);
      }
    });
  }

  // ============================================================
  //  塔のキネマティック当たり（落下物が塔にぶつかる）
  // ============================================================
  function ensureKinBody(p) {
    if (P.kinPool.has(p)) return;
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matCake });
    b.addShape(new CANNON.Cylinder(p.r * 0.95, p.r * 0.95, p.h * 0.74, 10));
    b._stackPancake = p;
    P.world.addBody(b);
    P.kinPool.set(p, b);
  }
  function syncKinBody(p) {
    const b = P.kinPool.get(p);
    if (!b) return;
    b.position.set(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
    const q = p.mesh.quaternion;
    b.quaternion.set(q.x, q.y, q.z, q.w);
  }
  function removeKinBody(p) {
    const b = P.kinPool.get(p);
    if (b) { P.world.removeBody(b); P.kinPool.delete(p); }
  }

  // ============================================================
  //  いちご（エンジンの小さな球）
  // ============================================================
  P.spawnBerry = function (mesh, worldPos) {
    const body = new CANNON.Body({
      mass: 0.15, material: matCake,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z),
      angularDamping: 0.3, linearDamping: 0.05,
      allowSleep: true, sleepSpeedLimit: 0.4, sleepTimeLimit: 0.4,
    });
    body.addShape(new CANNON.Sphere(0.3));
    body.velocity.set(PT.rand(-1.5, 1.5), PT.rand(0.5, 2), PT.rand(-1.5, 1.5));
    body.angularVelocity.set(PT.rand(-5, 5), 0, PT.rand(-5, 5));
    P.world.addBody(body);
    P.scene.add(mesh);
    mesh.position.copy(worldPos);
    P.berries.push({ body, mesh, life: 0 });
  };

  function shedBerries(p) {
    for (let i = p.toppings.length - 1; i >= 0; i--) {
      const t = p.toppings[i];
      if (t.kind !== 'berry' || !t.mesh) continue;
      t.mesh.getWorldPosition(_v);
      p.removeTopping(t);
      t.mesh.scale.setScalar(1);
      P.spawnBerry(t.mesh, _v.clone());
      if (P.on.berryBounce) P.on.berryBounce();
    }
  }

  function syncBerries() {
    for (let i = P.berries.length - 1; i >= 0; i--) {
      const be = P.berries[i];
      be.mesh.position.set(be.body.position.x, be.body.position.y, be.body.position.z);
      be.mesh.quaternion.set(be.body.quaternion.x, be.body.quaternion.y, be.body.quaternion.z, be.body.quaternion.w);
      if (be.body.sleepState === CANNON.Body.SLEEPING || be.body.position.y < -6) {
        P.world.removeBody(be.body);
        be.body = null;
        P.landedMeshes.push(be.mesh);
        P.berries.splice(i, 1);
      }
    }
  }

  // ============================================================
  //  そのほか
  // ============================================================
  function checkEmpty() {
    if (P._emptyFired) return;
    if (P.stack.length === 0 && P.tipGroups.length === 0 && P.bodies.length === 0) {
      P._emptyFired = true;
      if (P.on.towerEmpty) P.on.towerEmpty();
    }
  }

  P.poke = function (p, dir, strength) {
    if (p.state === 'stack') {
      p.doSquash(3);
      p.jiggle(0.5);
      p.wobble = Math.max(p.wobble, 0.8);
      // 接着グループなら土台の層に力が伝わる（塊ごと動く）
      let base = p, k = P.stack.indexOf(p);
      while (k > 0 && base.chocoBond > 0.5) { k--; base = P.stack[k]; }
      base.slideV.x += dir.x * strength;
      base.slideV.y += dir.y * strength;
    } else if (p.state === 'tipping') {
      // 倒れかけをつつくと勢いがつく
      for (const g of P.tipGroups) {
        if (g.pancakes.includes(p)) { g.omega += 0.9; break; }
      }
      p.jiggle(0.5);
    } else if (p.state === 'landed' || p.state === 'served') {
      p.doSquash(3.5);
      p.jiggle(0.6);
    }
  };

  P.towerTopY = function () {
    let top = PT.PLATE_H + 2;
    if (P.stack.length) {
      const p = P.stack[P.stack.length - 1];
      top = Math.max(top, p.yTarget + 1);
    }
    return top;
  };
})();
