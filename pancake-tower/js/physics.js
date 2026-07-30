/* ============================================================
 * physics.js — パンケーキ塔専用の物理
 *   ・スタックソルバー: 層ごとの すべり / かたむき / はがれ
 *   ・フリーボディ: 落下・バウンド・ちらばり（簡易剛体）
 *   ・ハイトグリッド: 落ちたパンケーキが積み重なる
 * ============================================================ */
(function () {
  const P = {
    scene: null,
    stack: [],      // 塔（下から上へ）
    bodies: [],     // 落下中の剛体
    berries: [],    // ころがるフルーツ
    grid: new Map(),
    instability: 0,
    on: {},         // イベント: plop, slip, detach, serve, land, towerEmpty
    _emptyFired: true,
    time: 0,
  };
  PT.Physics = P;

  const CELL = 1.1;
  const V2 = THREE.Vector2, V3 = THREE.Vector3;
  const _v = new V3(), _v2 = new V3(), _q = new THREE.Quaternion();

  P.init = function (scene) { P.scene = scene; };

  // ================= 地面の高さ =================
  function baseHeight(x, z) {
    if (x * x + z * z < PT.PLATE_R * PT.PLATE_R) return PT.PLATE_H;
    for (let i = 0; i < PT.World.servePlates.length; i++) {
      const s = PT.World.servePlates[i].pos;
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < PT.SERVE_R * PT.SERVE_R) return PT.SERVE_H;
    }
    return 0;
  }
  P.groundHeight = function (x, z) {
    const k = Math.round(x / CELL) + ',' + Math.round(z / CELL);
    const g = P.grid.get(k) || 0;
    return Math.max(baseHeight(x, z), g);
  };
  function addToGrid(x, z, r, topY) {
    const n = Math.max(1, Math.round(r * 0.7 / CELL));
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const k = (Math.round(x / CELL) + ix) + ',' + (Math.round(z / CELL) + iz);
        const cur = P.grid.get(k) || 0;
        if (topY > cur) P.grid.set(k, topY);
      }
    }
  }

  // ================= 塔のセット =================
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
    P.bodies.forEach((b) => b.items.forEach((it) => { P.scene.remove(it.pan.mesh); PT.disposeObject(it.pan.mesh); }));
    P.berries.forEach((b) => { P.scene.remove(b.mesh); PT.disposeObject(b.mesh); });
    P.landedMeshes = P.landedMeshes || [];
    P.landedMeshes.forEach((m) => { P.scene.remove(m); PT.disposeObject(m); });
    P.stack = []; P.bodies = []; P.berries = [];
    P.landedMeshes = [];
    P.landedPancakes = [];
    P.grid.clear();
    P._emptyFired = true;
  };
  P.landedMeshes = [];
  P.landedPancakes = [];

  // ================= メインステップ =================
  P.step = function (dt) {
    P.time += dt;
    stepStack(dt);
    stepBodies(dt);
    stepBerries(dt);
    checkEmpty();
  };

  // ---------- スタック ----------
  function stepStack(dt) {
    const st = P.stack;
    P.instability *= Math.pow(0.3, dt);
    if (!st.length) return;

    // y目標（下から積み上げ）
    let y = PT.PLATE_H + PT.PANCAKE_H * 0.36;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      p.yTarget = y;
      y += PT.PANCAKE_H * 0.68;
    }

    // 出現待ち・落下（登場アニメ兼 上の段のずどん）
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
            if (i > 0) st[i - 1].doSquash(PT.clamp(v * 0.25, 0.6, 3));
            if (P.on.plop) P.on.plop(p, v);
          }
        }
      } else {
        p.yCur = p.yTarget;
      }
    }

    // 上からの累積質量と重心
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

    // 各界面のすべり判定
    let detachI = -1;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!p._spawned || p.yCur > p.yTarget + 0.05) { p._pend = null; continue; }
      let sx, sz, sr, below = null;
      if (i === 0) { sx = 0; sz = 0; sr = PT.PLATE_R * 0.48; }
      else { below = st[i - 1]; sx = below.xz.x; sz = below.xz.y; sr = below.r; }

      const dx = p._aX - sx, dz = p._aZ - sz;
      const dist = Math.hypot(dx, dz);
      const ux = dist > 1e-4 ? dx / dist : 0;
      const uz = dist > 1e-4 ? dz / dist : 0;
      const lean = dist / sr;

      // 駆動力: 重心のずれ + 下の傾きの坂
      const driveMag = PT.G * (0.14 * lean + 0.85 * PT.smooth(0.28, 1.05, lean));
      let fx = ux * driveMag;
      let fz = uz * driveMag;
      if (below && below.tiltA > 0.03) {
        fx += below.tiltDir.x * Math.sin(below.tiltA) * PT.G * 0.75;
        fz += below.tiltDir.y * Math.sin(below.tiltA) * PT.G * 0.75;
      }
      const bonded = i > 0 && p.chocoBond > 0.5;
      const fmag = Math.hypot(fx, fz);
      const res = bonded ? 1e9 : p.mu() * PT.G * 0.5;

      if (bonded) p.slideV.set(0, 0); // 接着層は自分からは滑らない（下と一緒に動く）
      const wasSlow = p.slideV.lengthSq() < 0.2;
      if (fmag > res) {
        const s = (fmag - res) / fmag;
        p.slideV.x += fx * s * dt;
        p.slideV.y += fz * s * dt;
        if (wasSlow && p.slideV.lengthSq() > 0.55 && P.on.slip) P.on.slip(p);
      } else {
        p.slideV.multiplyScalar(Math.pow(0.002, dt));
      }

      // ぐらぐら表現
      const inst = PT.clamp((lean - 0.45) * 1.6, 0, 1.2) + PT.clamp(p.slideV.length() * 0.25, 0, 0.5);
      p.wobble += (inst * 0.8 - p.wobble) * Math.min(1, dt * 4);
      if (inst > P.instability) P.instability = inst;

      // 自分のずれによる傾き
      if (below) {
        const ox = p.xz.x - below.xz.x, oz = p.xz.y - below.xz.y;
        const od = Math.hypot(ox, oz);
        if (od > 0.01) p.tiltDir.set(ox / od, oz / od);
        p.tiltTarget = PT.clamp((od - below.r * 0.32) / below.r, 0, 1) * 0.5;
      } else {
        const od = Math.hypot(p.xz.x, p.xz.y);
        if (od > 0.01) p.tiltDir.set(p.xz.x / od, p.xz.y / od);
        p.tiltTarget = PT.clamp((od - PT.PLATE_R * 0.4) / PT.PLATE_R, 0, 1) * 0.5;
      }

      p._pend = p.slideV;

      // はがれ判定（いちばん下の該当層のみ）
      if (detachI < 0) {
        let offD;
        if (below) offD = Math.hypot(p.xz.x - below.xz.x, p.xz.y - below.xz.y) / (below.r * 0.95);
        else offD = Math.hypot(p.xz.x, p.xz.y) / (PT.PLATE_R * 0.56);
        if (lean > 1.06 || offD > 1.0) detachI = i;
      }
    }

    // すべりを上へ伝播して適用
    let ax = 0, az = 0;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!p._spawned) continue;
      if (p._pend) { ax += p._pend.x * dt; az += p._pend.y * dt; }
      p.xz.x += ax;
      p.xz.y += az;
    }

    if (detachI >= 0) detach(detachI);

    // 見た目
    for (let i = 0; i < st.length; i++) st[i].syncStack(dt);
  }

  // ---------- はがれ ----------
  function detach(i) {
    const st = P.stack;
    const p = st[i];
    // チョコで接着された連続グループ
    let j = i;
    while (j + 1 < st.length && st[j + 1].chocoBond > 0.5) j++;

    const slideSpeed = p.slideV.length();
    if (slideSpeed > 1.7 && j < st.length - 1) {
      // ずるっと抜ける（上は残って ずどん）
      const group = st.splice(i, j - i + 1);
      makeBody(group, new V3(p.slideV.x * 2.3, 1.7, p.slideV.y * 2.3), 2.2);
      // 残った上の段は少し暴れる
      for (let k = i; k < st.length; k++) {
        st[k].slideV.x += PT.rand(-0.5, 0.5);
        st[k].slideV.y += PT.rand(-0.5, 0.5);
        st[k].wobble = Math.max(st[k].wobble, 0.7);
      }
      if (P.on.detach) P.on.detach('slide', group.length);
    } else {
      // どさっと倒れる（そこから上ぜんぶ）
      const above = st.splice(i);
      const lean = p.tiltDir.lengthSq() > 0.01 ? p.tiltDir.clone() : new V2(PT.rand(-1, 1), PT.rand(-1, 1)).normalize();
      if (Math.hypot(p._aX, p._aZ) > 0.05) lean.set(p._aX, p._aZ).normalize();
      let k = 0;
      while (k < above.length) {
        // 接着グループごとにひとかたまり
        let e = k;
        while (e + 1 < above.length && above[e + 1].chocoBond > 0.5) e++;
        const group = above.slice(k, e + 1);
        const hFac = 1 + (k / Math.max(1, above.length)) * 1.9;
        makeBody(
          group,
          new V3(
            lean.x * (1.7 * hFac) + p.slideV.x * 0.6 + PT.rand(-0.4, 0.4),
            0.5 + k * 0.12,
            lean.y * (1.7 * hFac) + p.slideV.y * 0.6 + PT.rand(-0.4, 0.4)
          ),
          1.4 + k * 0.35
        );
        k = e + 1;
      }
      if (P.on.detach) P.on.detach('topple', above.length);
    }
  }

  // スタックのパンケーキ群 → 剛体ボディ
  function makeBody(group, vel, spin) {
    // いちごはころがり落ちる
    group.forEach((p) => shedBerries(p));
    // 原点 = グループ重心
    let cx = 0, cy = 0, cz = 0, m = 0;
    group.forEach((p) => {
      const pm = p.totalMass();
      cx += p.xz.x * pm; cy += p.yCur * pm; cz += p.xz.y * pm; m += pm;
    });
    cx /= m; cy /= m; cz /= m;
    const items = group.map((p) => {
      p.state = 'free';
      p.setFace('wee');
      p.slideV.set(0, 0);
      return { pan: p, off: new V3(p.xz.x - cx, p.yCur - cy, p.xz.y - cz) };
    });
    let I = 0, rMax = 0;
    items.forEach((it) => {
      const pm = it.pan.totalMass();
      I += 0.32 * pm * it.pan.r * it.pan.r + pm * it.off.lengthSq();
      rMax = Math.max(rMax, it.pan.r);
    });
    const axis = new V3(PT.rand(-1, 1), PT.rand(-0.2, 0.2), PT.rand(-1, 1)).normalize();
    // 倒れる方向に回転がかかるように
    if (vel.lengthSq() > 0.1) {
      _v.set(vel.x, 0, vel.z).normalize();
      axis.set(_v.z, 0, -_v.x).multiplyScalar(-1);
    }
    const body = {
      items,
      pos: new V3(cx, cy, cz),
      quat: new THREE.Quaternion(),
      vel: vel.clone(),
      angVel: axis.multiplyScalar(spin * PT.rand(0.7, 1.3)),
      mass: m, invMass: 1 / m, invI: 1 / Math.max(I, 0.15),
      rMax, sleepT: 0, life: 0,
    };
    P.bodies.push(body);
    return body;
  }

  // いちごを転がす
  function shedBerries(p) {
    for (let i = p.toppings.length - 1; i >= 0; i--) {
      const t = p.toppings[i];
      if (t.kind !== 'berry' || !t.mesh) continue;
      t.mesh.getWorldPosition(_v);
      p.removeTopping(t);
      P.scene.add(t.mesh);
      t.mesh.position.copy(_v);
      t.mesh.scale.setScalar(1);
      t.mesh.rotation.set(0, PT.rand(0, 6), 0);
      P.berries.push({
        mesh: t.mesh,
        vel: new V3(PT.rand(-2, 2), PT.rand(1, 3), PT.rand(-2, 2)),
        spin: new V3(PT.rand(-6, 6), 0, PT.rand(-6, 6)),
        r: 0.34, settle: 0,
      });
    }
  }

  // ---------- フリーボディ ----------
  const SAMPLE_ANG = [0, 1.05, 2.09, 3.14, 4.19, 5.24];
  function stepBodies(dt) {
    for (let bi = P.bodies.length - 1; bi >= 0; bi--) {
      const b = P.bodies[bi];
      b.life += dt;
      b.vel.y -= PT.G * dt;
      // 落下中はいちばん近いサーブ皿へ ほんの少し吸い寄せられる
      if (b.pos.y < 5.5 && b.vel.y < -0.6) {
        let best = null, bd = 4.4;
        for (let i = 0; i < PT.World.servePlates.length; i++) {
          const s = PT.World.servePlates[i].pos;
          const d = Math.hypot(s.x - b.pos.x, s.z - b.pos.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best && bd > 0.3) {
          const k = 5.5 * (1 - bd / 4.4) * dt;
          b.vel.x += (best.x - b.pos.x) / bd * k;
          b.vel.z += (best.z - b.pos.z) / bd * k;
        }
      }
      b.pos.addScaledVector(b.vel, dt);
      const wl = b.angVel.length();
      if (wl > 1e-4) {
        _q.setFromAxisAngle(_v.copy(b.angVel).normalize(), wl * dt);
        b.quat.premultiply(_q).normalize();
      }

      // 接触
      let contact = false, deepest = 0, deepPt = null, deepGh = 0;
      for (let ii = 0; ii < b.items.length; ii++) {
        const it = b.items[ii];
        const pr = it.pan.r * 0.92, ph = it.pan.h * 0.36;
        for (let s = -1; s <= 1; s += 2) {
          for (let a = 0; a < SAMPLE_ANG.length; a++) {
            _v.set(Math.cos(SAMPLE_ANG[a]) * pr, ph * s, Math.sin(SAMPLE_ANG[a]) * pr)
              .add(it.off).applyQuaternion(b.quat).add(b.pos);
            const gh = P.groundHeight(_v.x, _v.z);
            const pen = gh - _v.y;
            if (pen > 0 && pen > deepest) { deepest = pen; deepPt = _v.clone(); deepGh = gh; }
            if (pen > 0) contact = true;
          }
        }
      }

      if (deepPt) {
        // 位置補正
        b.pos.y += deepest * 0.38;
        deepPt.y += deepest * 0.38;
        // 接触点の速度
        _v.copy(deepPt).sub(b.pos);           // r
        _v2.copy(b.angVel).cross(_v).add(b.vel); // 点速度
        const vn = _v2.y;
        if (vn < 0) {
          const rn = _v.clone().cross(new V3(0, 1, 0));
          const denom = b.invMass + b.invI * rn.lengthSq();
          const e = vn < -2.5 ? 0.24 : 0;   // 小さな接触では跳ねない
          const jn = -(1 + e) * vn / denom;
          b.vel.y += jn * b.invMass;
          const dw = _v.clone().cross(new V3(0, jn, 0)).multiplyScalar(b.invI);
          b.angVel.add(dw);
          // 摩擦（水平方向をぐっと減速）
          const f = PT.clamp(jn * 0.5 * b.invMass, 0, 0.6);
          b.vel.x *= 1 - f; b.vel.z *= 1 - f;
          b.angVel.multiplyScalar(1 - f * 0.6);
        }
        // ぺたんと寝る補助
        _v.set(0, 1, 0).applyQuaternion(b.quat);
        if (Math.abs(_v.y) > 0.45) {
          _v2.copy(_v).multiplyScalar(Math.sign(_v.y));
          const corr = new V3(0, 1, 0).cross(_v2).multiplyScalar(-5.5);
          b.angVel.addScaledVector(corr, dt * 4);
          b.angVel.multiplyScalar(Math.max(0, 1 - 4.5 * dt));
          if (Math.abs(_v.y) > 0.92) {
            b.angVel.multiplyScalar(Math.max(0, 1 - 8 * dt));
            b.vel.x *= Math.max(0, 1 - 3 * dt);
            b.vel.z *= Math.max(0, 1 - 3 * dt);
          }
        }
      }

      // メッシュへ反映
      for (let ii = 0; ii < b.items.length; ii++) {
        const it = b.items[ii];
        it.pan.mesh.position.copy(it.off).applyQuaternion(b.quat).add(b.pos);
        it.pan.mesh.quaternion.copy(b.quat);
      }

      // おねむ判定 → 着地確定（実際の移動量で判断: 接触ジッターに強い）
      _v.set(0, 1, 0).applyQuaternion(b.quat);
      if (!b.prevPos) b.prevPos = b.pos.clone();
      const disp = b.pos.distanceTo(b.prevPos) / Math.max(dt, 1e-4);
      b.prevPos.copy(b.pos);
      if (contact && disp < 0.5 && Math.abs(_v.y) > 0.78) {
        b.sleepT += dt;
      } else b.sleepT = 0;
      if (b.sleepT > 0.25 || b.life > 4.5 || b.pos.y < -5) {
        settleBody(b);
        P.bodies.splice(bi, 1);
      }
    }
  }

  function settleBody(b) {
    const sorted = b.items.slice().sort((a, c) => {
      _v.copy(a.off).applyQuaternion(b.quat);
      _v2.copy(c.off).applyQuaternion(b.quat);
      return _v.y - _v2.y;
    });
    sorted.forEach((it) => {
      const p = it.pan;
      _v.copy(it.off).applyQuaternion(b.quat).add(b.pos);
      const gh = P.groundHeight(_v.x, _v.z);
      const y = gh + p.h * 0.36;
      p.mesh.position.set(_v.x, y, _v.z);
      p.mesh.quaternion.setFromAxisAngle(_v2.set(0, 1, 0), PT.rand(0, 6.28));
      p.mesh.scale.setScalar(1);
      addToGrid(_v.x, _v.z, p.r, y + p.h * 0.3);
      p.state = 'landed';
      P.landedMeshes.push(p.mesh);
      P.landedPancakes.push(p);

      // サーブ皿チェック
      let served = null;
      for (let i = 0; i < PT.World.servePlates.length; i++) {
        const s = PT.World.servePlates[i];
        const dx = _v.x - s.pos.x, dz = _v.z - s.pos.z;
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

  // ---------- いちご ----------
  function stepBerries(dt) {
    for (let i = P.berries.length - 1; i >= 0; i--) {
      const be = P.berries[i];
      be.vel.y -= PT.G * dt;
      be.mesh.position.addScaledVector(be.vel, dt);
      be.mesh.rotation.x += be.spin.x * dt;
      be.mesh.rotation.z += be.spin.z * dt;
      const gh = P.groundHeight(be.mesh.position.x, be.mesh.position.z) + be.r;
      if (be.mesh.position.y < gh) {
        be.mesh.position.y = gh;
        if (be.vel.y < -1.5 && P.on.berryBounce) P.on.berryBounce(be);
        be.vel.y = Math.abs(be.vel.y) * 0.45;
        be.vel.x *= 0.85; be.vel.z *= 0.85;
        be.spin.multiplyScalar(0.8);
      }
      if (be.vel.lengthSq() < 0.05 && be.mesh.position.y <= gh + 0.02) {
        be.settle += dt;
        if (be.settle > 0.5) {
          P.landedMeshes.push(be.mesh);
          P.berries.splice(i, 1);
        }
      } else be.settle = 0;
    }
  }

  // ---------- 全部くずれた？ ----------
  function checkEmpty() {
    if (P._emptyFired) return;
    if (P.stack.length === 0 && P.bodies.length === 0) {
      P._emptyFired = true;
      if (P.on.towerEmpty) P.on.towerEmpty();
    }
  }

  // ---------- つんつん ----------
  P.poke = function (p, dir, strength) {
    if (p.state === 'stack') {
      p.doSquash(3);
      p.wobble = Math.max(p.wobble, 0.8);
      // 接着グループなら土台の層に力が伝わる（塊ごと動く）
      let base = p, k = P.stack.indexOf(p);
      while (k > 0 && base.chocoBond > 0.5) { k--; base = P.stack[k]; }
      base.slideV.x += dir.x * strength;
      base.slideV.y += dir.y * strength;
    } else if (p.state === 'landed' || p.state === 'served') {
      p.doSquash(3.5);
    }
  };

  // 現在の塔のてっぺんの高さ
  P.towerTopY = function () {
    let top = PT.PLATE_H + 2;
    if (P.stack.length) {
      const p = P.stack[P.stack.length - 1];
      top = Math.max(top, p.yTarget + 1);
    }
    return top;
  };
})();
