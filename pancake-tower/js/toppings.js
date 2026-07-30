/* ============================================================
 * toppings.js — 素材（シロップ/チョコ/バター/クリーム/いちご/ゆび）
 *   それぞれが塔の 重さ / すべり / バランス を変える
 * ============================================================ */
(function () {
  const T = {
    current: 'syrup',
    pouring: false,
    pressing: null,   // クリーム長押し {pancake, local, mesh, mass}
    anims: [],        // 溶ける・固まる・ゆれるアニメ
    _pourT: 0,
  };
  PT.Toppings = T;

  const V2 = THREE.Vector2;
  const _v = new THREE.Vector3();

  // ---- 素材メッシュ ----
  function makeButterMesh() {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.3, 0.55),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.35, emissive: 0xaa7700, emissiveIntensity: 0.08 })
    );
    m.castShadow = true;
    return m;
  }

  function makeCreamMesh() {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xfff6fa, roughness: 0.55 });
    const sizes = [0.42, 0.34, 0.25, 0.15];
    let y = 0.1;
    sizes.forEach((s) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 9), mat);
      b.position.y = y;
      b.scale.y = 0.7;
      b.castShadow = true;
      grp.add(b);
      y += s * 0.85;
    });
    return grp;
  }

  function makeBerryMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xff4f79, roughness: 0.4 })
    );
    body.scale.y = 1.15;
    body.castShadow = true;
    grp.add(body);
    // へた
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.22, 5),
        new THREE.MeshStandardMaterial({ color: 0x67c26b, roughness: 0.6 })
      );
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.13, 0.34, Math.sin(a) * 0.13);
      leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      grp.add(leaf);
    }
    return grp;
  }

  // 液体コート（シロップ/チョコが層にまとわりつく見た目）
  function ensureCoat(p, kind) {
    const key = '_coat_' + kind;
    if (p[key]) return p[key];
    const col = kind === 'syrup' ? 0xe89020 : 0x6b4226;
    const mat = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.12, metalness: 0.05,
      transparent: true, opacity: 0,
    });
    const coat = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 1.03, p.r * 0.9, p.h * 0.55, 20, 1, true),
      mat
    );
    coat.position.y = -p.h * 0.05;
    p.mesh.add(coat);
    // 上面のたれ
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.85, p.r * 0.95, 0.09, 20),
      mat
    );
    cap.position.y = p.h * 0.36;
    p.mesh.add(cap);
    p[key] = { coat, cap, mat };
    return p[key];
  }

  // ---- ワールド座標 → パンケーキ上のローカルXZ ----
  function toLocal(p, worldPoint) {
    _v.copy(worldPoint);
    p.mesh.worldToLocal(_v);
    const l = new V2(_v.x, _v.z);
    const maxR = p.r * 0.7;
    if (l.length() > maxR) l.setLength(maxR);
    return l;
  }

  // ============ 各素材の適用 ============

  // シロップ / チョコ（そそぐ）
  function pourTick(hit, kind, dt) {
    T._pourT -= dt;
    const p = hit.pancake;
    if (p.state !== 'stack') return;
    const stack = PT.Physics.stack;
    const idx = stack.indexOf(p);
    if (idx < 0) return;

    const local = toLocal(p, hit.point);
    const rate = dt * 0.55;

    if (kind === 'syrup') {
      // 触った層から下2枚へ流れて、界面がつるつるに
      for (let k = idx; k >= Math.max(0, idx - 2); k--) {
        const q = stack[k];
        const amt = rate * (k === idx ? 1 : 0.55);
        q.syrup = Math.min(1.15, q.syrup + amt);
        const c = ensureCoat(q, 'syrup');
        c.mat.opacity = Math.min(0.92, q.syrup * 1.1);
        q.bodyMesh.material.roughness = Math.max(0.25, 0.85 - q.syrup * 0.5);
        // シロップの重みで注いだ側へかたむく
        if (!q._syrupTop) q._syrupTop = q.addTopping('syrupW', 0.001, local, null);
        q._syrupTop.mass = Math.min(1.2, q._syrupTop.mass + amt * 0.9);
        q._syrupTop.local.lerp(local, 0.25);
        q.recomputeCom();
      }
    } else {
      // チョコ: とろり → 固まって層どうしがくっつく
      p.chocoLiquid = (p.chocoLiquid || 0) + rate;
      const c = ensureCoat(p, 'choco');
      c.mat.opacity = Math.min(0.96, p.chocoLiquid * 1.2);
      if (!p._chocoTop) p._chocoTop = p.addTopping('chocoW', 0.001, local, null);
      p._chocoTop.mass = Math.min(0.7, p._chocoTop.mass + rate * 0.5);
      p.recomputeCom();
      if (p.chocoLiquid >= 0.85 && !p._chocoHardening && p.chocoBond < 0.5) {
        p._chocoHardening = true;
        T.anims.push({ kind: 'harden', p, t: 1.3 });
      }
    }

    // しずくとキラキラ
    if (T._pourT <= 0) {
      T._pourT = 0.06;
      _v.copy(hit.point);
      _v.y += 0.6;
      PT.FX.drip(_v, kind, null);
      if (Math.random() < 0.3) PT.FX.sparkle(hit.point, 2, kind !== 'syrup');
    }
  }

  // バター（置くと溶けてつるつる）
  function placeButter(hit) {
    const p = hit.pancake;
    if (p.state !== 'stack') return;
    if ((p._butterCount || 0) >= 2) return;
    p._butterCount = (p._butterCount || 0) + 1;
    const local = toLocal(p, hit.point);
    const mesh = makeButterMesh();
    mesh.position.set(local.x, 0.16, local.y);
    mesh.rotation.y = PT.rand(0, 6);
    p.topGroup.add(mesh);
    p.addTopping('butter', 0.22, local, mesh);
    T.anims.push({ kind: 'melt', p, mesh, t: 2.3, t0: 2.3 });
    PT.Audio.plop(1.6, 0.2);
    PT.FX.sparkle(hit.point, 4);
  }

  // クリーム（長押しで大きく）
  function startCream(hit) {
    const p = hit.pancake;
    if (p.state !== 'stack') return;
    const local = toLocal(p, hit.point);
    const mesh = makeCreamMesh();
    mesh.position.set(local.x, 0.02, local.y);
    mesh.scale.setScalar(0.35);
    p.topGroup.add(mesh);
    const top = p.addTopping('cream', 0.25, local, mesh);
    T.pressing = { pancake: p, mesh, top, grow: 0.35 };
    T.anims.push({ kind: 'wobbleCream', p, mesh, ph: PT.rand(0, 6) });
    PT.Audio.pourStart(false);
  }
  function growCream(dt) {
    const pr = T.pressing;
    if (!pr) return;
    pr.grow = Math.min(1.6, pr.grow + dt * 0.85);
    pr.mesh.scale.setScalar(pr.grow);
    pr.top.mass = 0.25 + pr.grow * 1.4;
    pr.pancake.sticky = Math.min(1, pr.pancake.sticky + dt * 0.5);
    pr.pancake.recomputeCom();
    if (Math.random() < 0.2) {
      pr.mesh.getWorldPosition(_v);
      PT.FX.sparkle(_v, 1, true);
    }
  }
  function endCream() {
    if (!T.pressing) return;
    PT.Audio.pourStop();
    PT.Audio.plop(2, 0.15);
    T.pressing = null;
  }

  // いちご（片側が重くなる）
  function placeBerry(hit) {
    const p = hit.pancake;
    if (p.state !== 'stack') return;
    if ((p._berryCount || 0) >= 4) return;
    p._berryCount = (p._berryCount || 0) + 1;
    const local = toLocal(p, hit.point);
    // ふちに置くほど楽しいので、少し外側へスナップ
    if (local.length() > 0.2) local.setLength(Math.min(p.r * 0.72, local.length() * 1.25));
    const mesh = makeBerryMesh();
    mesh.position.set(local.x, 0.3, local.y);
    p.topGroup.add(mesh);
    mesh.scale.setScalar(0.01);
    T.anims.push({ kind: 'popIn', mesh, t: 0.25, t0: 0.25 });
    p.addTopping('berry', 0.75, local, mesh);
    PT.Audio.note(PT.rand(600, 800), { type: 'triangle', gain: 0.18, dur: 0.3 });
    PT.FX.sparkle(hit.point, 5, true);
  }

  // ゆびでつんつん
  function poke(hit) {
    const p = hit.pancake;
    const dir = new V2(p.mesh.position.x - hit.point.x, p.mesh.position.z - hit.point.z);
    if (dir.lengthSq() < 0.001) dir.set(PT.rand(-1, 1), PT.rand(-1, 1));
    dir.normalize();
    PT.Physics.poke(p, dir, 3.0);
    PT.Audio.squish(PT.rand(0.8, 1.3));
    PT.FX.hearts(hit.point, 2);
  }

  // ============ 入力から呼ばれる ============
  T.pointerDown = function (hit) {
    const c = T.current;
    if (c === 'syrup' || c === 'choco') {
      T.pouring = true;
      PT.Audio.pourStart(c === 'syrup');
      pourTick(hit, c, 0.03);
    } else if (c === 'butter') placeButter(hit);
    else if (c === 'cream') startCream(hit);
    else if (c === 'berry') placeBerry(hit);
    else if (c === 'poke') poke(hit);
  };

  T.pointerMove = function (hit, dt) {
    if (T.pouring && hit) pourTick(hit, T.current, dt);
  };

  T.pointerUp = function () {
    if (T.pouring) { T.pouring = false; PT.Audio.pourStop(); }
    endCream();
  };

  // ============ アニメーション更新 ============
  T.update = function (dt) {
    if (T.pressing) growCream(dt);

    for (let i = T.anims.length - 1; i >= 0; i--) {
      const a = T.anims[i];
      if (a.kind === 'melt') {
        a.t -= dt;
        const k = Math.max(0, a.t / a.t0);
        a.mesh.scale.set(1 + (1 - k) * 1.6, Math.max(0.12, k), 1 + (1 - k) * 1.6);
        a.mesh.material.roughness = 0.35 - (1 - k) * 0.25;
        if (a.t <= 0) {
          a.p.butter = Math.min(1, a.p.butter + 0.85);
          a.p.bodyMesh.material.roughness = Math.max(0.2, a.p.bodyMesh.material.roughness - 0.3);
          a.mesh.getWorldPosition(_v);
          PT.FX.sparkle(_v, 6);
          PT.Audio.slip();
          T.anims.splice(i, 1);
        }
      } else if (a.kind === 'harden') {
        a.t -= dt;
        if (a.t <= 0) {
          a.p.chocoBond = 1;
          a.p._chocoHardening = false;
          const c = a.p['_coat_choco'];
          if (c) { c.mat.roughness = 0.55; c.mat.color.set(0x4e2f1a); }
          a.p.mesh.getWorldPosition(_v);
          PT.FX.sparkle(_v, 8);
          PT.Audio.note(320, { type: 'square', gain: 0.08, dur: 0.15 });
          PT.Audio.note(480, { type: 'square', gain: 0.08, dur: 0.2, delay: 0.08 });
          T.anims.splice(i, 1);
        }
      } else if (a.kind === 'popIn') {
        a.t -= dt;
        const k = 1 - Math.max(0, a.t / a.t0);
        const s = k < 0.7 ? k / 0.7 * 1.25 : 1.25 - (k - 0.7) / 0.3 * 0.25;
        a.mesh.scale.setScalar(Math.max(0.01, s));
        if (a.t <= 0) { a.mesh.scale.setScalar(1); T.anims.splice(i, 1); }
      } else if (a.kind === 'wobbleCream') {
        if (!a.mesh.parent) { T.anims.splice(i, 1); continue; }
        a.ph += dt * 5;
        const w = 1 + Math.sin(a.ph) * 0.05 * a.p.wobble * 2;
        a.mesh.scale.y = a.mesh.scale.x * w;
      }
    }
  };
})();
