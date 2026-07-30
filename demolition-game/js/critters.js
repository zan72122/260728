/* critters.js — 住人ギミック（とり・ねこ・ふうせん）
 * 他の機能に一切依存せず自己完結。window.GameHooks 経由でシーンに出入りする。
 * 座標系は render3d.js と同じ: three.x = matter.x / three.y = GROUND_Y - matter.y
 * レイヤーz = (layer-1) * B * 1.12
 */
(function () {
  'use strict';

  const { B, GROUND_Y } = window.GameLevels;
  const ty = (my) => GROUND_Y - my;               /* matter y → three y */
  const layerZ = (l) => (l - 1) * B * 1.12;

  /* ---------- 状態 ---------- */
  let myGroup = null;      /* levelGroup の子として吊るす自前グループ */
  let critters = [];       /* 生きている住人ぜんぶ */
  let haveLastTime = false;
  let lastTime = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 見た目のキャッシュ（ジオメトリ・共有マテリアルのみ。ふうせんは個体ごとに新規） ---------- */
  const geoCache = new Map();
  function cachedGeo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }
  const matCache = new Map();
  function cachedMat(key, make) {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  }

  const BIRD_PALETTES = [
    { body: 0xe8543a, belly: 0xfff2df, wing: 0xb8341f }, /* あかい ことり */
    { body: 0x3f8fe0, belly: 0xeaf6ff, wing: 0x2a63a8 }, /* あおい ことり */
    { body: 0xf4c542, belly: 0xfff8de, wing: 0xd69a1e }, /* きいろい ことり */
    { body: 0x8a6a4c, belly: 0xf0e2c8, wing: 0x5f4630 }, /* ちゃいろい すずめ */
  ];
  const CAT_COLORS = [0xff9d4d, 0x8a8a8a, 0x3a3a3a, 0xf5f0e6, 0xd9a066];
  const BALLOON_COLORS = [0xff5a5a, 0xffb02e, 0x5ab8ff, 0x7ed957, 0xc77dff, 0xff8fd4];

  /* ---------- とり ---------- */
  function buildBirdMesh() {
    const pal = pick(BIRD_PALETTES);
    const grp = new THREE.Group();

    const bodyMat = cachedMat('bird:body:' + pal.body, () => new THREE.MeshLambertMaterial({ color: pal.body }));
    const bellyMat = cachedMat('bird:belly:' + pal.belly, () => new THREE.MeshLambertMaterial({ color: pal.belly }));
    const wingMat = cachedMat('bird:wing:' + pal.wing, () => new THREE.MeshLambertMaterial({ color: pal.wing }));
    const beakMat = cachedMat('bird:beak', () => new THREE.MeshLambertMaterial({ color: 0xffa22c }));
    const eyeMat = cachedMat('bird:eye', () => new THREE.MeshLambertMaterial({ color: 0x222222 }));
    const legMat = cachedMat('bird:leg', () => new THREE.MeshLambertMaterial({ color: 0xe08a2c }));

    const body = new THREE.Mesh(cachedGeo('bird:bodyGeo', () => new THREE.SphereGeometry(1, 10, 8)), bodyMat);
    body.scale.set(9, 7.5, 10);
    body.position.set(0, 8.5, 0);
    body.castShadow = true;
    grp.add(body);

    const belly = new THREE.Mesh(cachedGeo('bird:bellyGeo', () => new THREE.SphereGeometry(1, 8, 6)), bellyMat);
    belly.scale.set(6, 5, 6.5);
    belly.position.set(0, 6.5, 3);
    grp.add(belly);

    const headGrp = new THREE.Group();
    headGrp.position.set(0, 14.5, 5.5);
    grp.add(headGrp);
    const head = new THREE.Mesh(cachedGeo('bird:headGeo', () => new THREE.SphereGeometry(1, 10, 8)), bodyMat);
    head.scale.set(5.6, 5.6, 5.6);
    headGrp.add(head);
    const beak = new THREE.Mesh(cachedGeo('bird:beakGeo', () => {
      const g = new THREE.ConeGeometry(2.2, 5, 6);
      g.rotateX(Math.PI / 2);
      return g;
    }), beakMat);
    beak.position.set(0, -0.5, 5.6);
    headGrp.add(beak);
    const eyeGeo = cachedGeo('bird:eyeGeo', () => new THREE.SphereGeometry(0.8, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-3, 1.2, 4); headGrp.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(3, 1.2, 4); headGrp.add(eyeR);

    const wingGeo = cachedGeo('bird:wingGeo', () => new THREE.BoxGeometry(1, 5, 8));
    const wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.position.set(-8, 8.5, -1); wingL.scale.set(2.2, 1, 1); grp.add(wingL);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingR.position.set(8, 8.5, -1); wingR.scale.set(2.2, 1, 1); grp.add(wingR);

    const tail = new THREE.Mesh(cachedGeo('bird:tailGeo', () => new THREE.BoxGeometry(6, 2, 7)), wingMat);
    tail.position.set(0, 7.5, -8.5);
    tail.rotation.x = 0.3;
    grp.add(tail);

    const legGeo = cachedGeo('bird:legGeo', () => new THREE.CylinderGeometry(0.6, 0.6, 4, 5));
    const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-2.5, 2, 0); grp.add(legL);
    const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(2.5, 2, 0); grp.add(legR);

    grp.userData.headGrp = headGrp;
    grp.userData.wingL = wingL;
    grp.userData.wingR = wingR;
    return grp;
  }

  function spawnBird(blk) {
    const grp = buildBirdMesh();
    myGroup.add(grp);
    const c = {
      type: 'bird', group: grp, state: 'idle', host: blk,
      localX: rnd(-B * 0.22, B * 0.22),
      bobPhase: rnd(0, Math.PI * 2), bobSpeed: rnd(1.6, 2.4), bobAmp: rnd(1.6, 3.2),
      tiltT: rnd(1, 3), tiltPhaseT: 0, tiltTarget: 0,
      facing: Math.random() < 0.5 ? 1 : -1,
      fleeT: 0, fleeDuration: 0,
    };
    grp.rotation.y = c.facing > 0 ? 0 : Math.PI;
    critters.push(c);
    positionOnHost(c);
  }

  function positionOnHost(c) {
    const h = c.host;
    const meta = h.plugin.meta;
    const topY = h.position.y - B / 2;
    c.group.position.set(h.position.x + c.localX, ty(topY), layerZ(meta.layer || 1));
  }

  /* ---------- ねこ ---------- */
  function buildCatMesh(color) {
    const bodyMat = cachedMat('cat:body:' + color, () => new THREE.MeshLambertMaterial({ color }));
    const earMat = cachedMat('cat:ear:' + color, () => new THREE.MeshLambertMaterial({ color: shadeHex(color, 0.82) }));
    const eyeMat = cachedMat('cat:eye', () => new THREE.MeshLambertMaterial({ color: 0x2c4a2c }));
    const noseMat = cachedMat('cat:nose', () => new THREE.MeshLambertMaterial({ color: 0xe07a9a }));

    const grp = new THREE.Group();
    const body = new THREE.Mesh(cachedGeo('cat:bodyGeo', () => new THREE.SphereGeometry(1, 10, 8)), bodyMat);
    body.scale.set(12, 10, 15);
    body.position.set(0, 10, 0);
    body.castShadow = true;
    grp.add(body);

    const headGrp = new THREE.Group();
    headGrp.position.set(0, 18, 10);
    grp.add(headGrp);
    const head = new THREE.Mesh(cachedGeo('cat:headGeo', () => new THREE.SphereGeometry(1, 10, 8)), bodyMat);
    head.scale.set(8, 7.5, 8);
    headGrp.add(head);
    const earGeo = cachedGeo('cat:earGeo', () => new THREE.ConeGeometry(3, 6, 4));
    const earL = new THREE.Mesh(earGeo, earMat); earL.position.set(-5, 6.5, 0); earL.rotation.z = -0.25; headGrp.add(earL);
    const earR = new THREE.Mesh(earGeo, earMat); earR.position.set(5, 6.5, 0); earR.rotation.z = 0.25; headGrp.add(earR);
    const eyeGeo = cachedGeo('cat:eyeGeo', () => new THREE.SphereGeometry(0.9, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-3, 0.5, 6.8); headGrp.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(3, 0.5, 6.8); headGrp.add(eyeR);
    const nose = new THREE.Mesh(cachedGeo('cat:noseGeo', () => new THREE.SphereGeometry(0.9, 6, 6)), noseMat);
    nose.position.set(0, -1.5, 7.4);
    headGrp.add(nose);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 10, -14);
    grp.add(tailPivot);
    const tail = new THREE.Mesh(cachedGeo('cat:tailGeo', () => new THREE.CylinderGeometry(1.6, 1, 20, 6)), bodyMat);
    tail.position.set(0, 4.5, -3.5);
    tail.rotation.x = Math.PI * 0.28;
    tailPivot.add(tail);

    grp.userData.headGrp = headGrp;
    grp.userData.tailPivot = tailPivot;
    return grp;
  }

  function shadeHex(hex, mult) {
    const n = hex;
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * mult)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * mult)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * mult)));
    return (r << 16) | (g << 8) | b;
  }

  function spawnCat(bounds) {
    const color = pick(CAT_COLORS);
    const grp = buildCatMesh(color);
    myGroup.add(grp);
    const side = Math.random() < 0.5 ? -1 : 1;
    const baseX = side < 0 ? bounds.minX + 70 : bounds.maxX - 70;
    const baseZ = 64;
    grp.position.set(baseX, 0, baseZ);
    grp.rotation.y = side < 0 ? Math.PI * 0.18 : -Math.PI * 0.18;
    const c = {
      type: 'cat', group: grp, state: 'idle', host: null,
      baseX, baseZ, baseY: 0,
      bobPhase: rnd(0, Math.PI * 2),
      tailSpeed: rnd(1.3, 2.0), tailPhase: rnd(0, Math.PI * 2),
      runDir: side,
      fleeT: 0, fleeDuration: rnd(1.6, 2.0),
    };
    critters.push(c);
  }

  /* ---------- ふうせん ---------- */
  function buildBalloonMesh(color) {
    /* ふうせんは個体ごとに専用マテリアル（逃げるときに個別にフェードさせるため共有しない） */
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
    const hiMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 });

    const grp = new THREE.Group();
    const balloon = new THREE.Mesh(cachedGeo('balloon:sphereGeo', () => new THREE.SphereGeometry(1, 14, 12)), mat);
    balloon.scale.set(11, 14, 11);
    grp.add(balloon);
    const knot = new THREE.Mesh(cachedGeo('balloon:knotGeo', () => {
      const g = new THREE.ConeGeometry(2.4, 5, 6);
      g.rotateX(Math.PI);
      return g;
    }), mat);
    knot.position.set(0, -16, 0);
    grp.add(knot);
    const hi = new THREE.Mesh(cachedGeo('balloon:hiGeo', () => new THREE.SphereGeometry(1, 8, 6)), hiMat);
    hi.scale.set(3, 4, 3);
    hi.position.set(-4, 5, 6.5);
    grp.add(hi);

    grp.userData.baseOpacity = { balloon: 1, hi: 0.32 };
    return grp;
  }

  function spawnBalloon(blk) {
    const color = pick(BALLOON_COLORS);
    const grp = buildBalloonMesh(color);
    myGroup.add(grp);
    const lineMat = cachedMat('balloon:string', () => new THREE.LineBasicMaterial({ color: 0xffffff }));
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineGeo, lineMat);
    myGroup.add(line);
    const c = {
      type: 'balloon', group: grp, line, state: 'idle', host: blk,
      localX: rnd(-B * 0.18, B * 0.18),
      stringLen: rnd(60, 100),
      swayPhase: rnd(0, Math.PI * 2), swaySpeed: rnd(0.7, 1.3), swayAmp: rnd(6, 11),
      fleeT: 0, fleeDuration: 0,
    };
    critters.push(c);
    positionBalloon(c, 0);
  }

  function positionBalloon(c, time) {
    const h = c.host;
    const meta = h.plugin.meta;
    const anchorX = h.position.x, anchorY = h.position.y - B / 2;
    const z = layerZ(meta.layer || 1) + B * 0.15;
    const swayX = anchorX + c.localX + Math.sin(time * c.swaySpeed + c.swayPhase) * c.swayAmp;
    const balloonMatterY = anchorY - c.stringLen;
    c.group.position.set(swayX, ty(balloonMatterY), z);
    c.group.rotation.z = Math.sin(time * c.swaySpeed * 0.7 + c.swayPhase) * 0.14;
    if (c.line) {
      const a = new THREE.Vector3(anchorX, ty(anchorY), z);
      const b = new THREE.Vector3(swayX, ty(balloonMatterY) - 19, z);
      c.line.geometry.setFromPoints([a, b]);
    }
  }

  function setBalloonOpacity(c, fade) {
    const base = c.group.userData.baseOpacity || {};
    c.group.children.forEach((obj, i) => {
      if (!obj.material) return;
      const key = i === 0 ? 'balloon' : (i === 2 ? 'hi' : 'balloon');
      const b = base[key] != null ? base[key] : 1;
      obj.material.opacity = Math.max(0, b * fade);
    });
  }

  /* ---------- スポーン全体 ---------- */
  function spawnCritters(pstate) {
    if (!myGroup) return;
    const blocks = window.GamePhysics.activeBlocks(pstate);

    /* 各「れつ」(建物index+col)ごとの最上段ブロックをあつめる */
    const topMap = new Map();
    for (const blk of blocks) {
      const meta = blk.plugin.meta;
      const key = (meta.bi != null ? meta.bi : 0) + ':' + meta.col;
      const cur = topMap.get(key);
      if (!cur || meta.row > cur.plugin.meta.row) topMap.set(key, blk);
    }
    const topBlocks = shuffle(Array.from(topMap.values()));

    const desiredBirds = 1 + ((Math.random() * 3) | 0);       /* 1-3 */
    const desiredBalloons = 1 + ((Math.random() * 2) | 0);    /* 1-2 */
    let desiredCat = Math.random() < 0.55 ? 1 : 0;            /* 0-1 */

    let nBirds = Math.min(desiredBirds, topBlocks.length);
    let nBalloons = Math.min(desiredBalloons, topBlocks.length - nBirds);
    let total = nBirds + nBalloons + desiredCat;
    while (total > 5) {
      if (nBalloons > 0) { nBalloons--; total--; }
      else if (nBirds > 1) { nBirds--; total--; }
      else { desiredCat = 0; total--; }
    }

    const birdBlocks = topBlocks.splice(0, nBirds);
    const balloonBlocks = topBlocks.splice(0, nBalloons);
    for (const blk of birdBlocks) spawnBird(blk);
    for (const blk of balloonBlocks) spawnBalloon(blk);
    if (desiredCat && pstate.bounds) spawnCat(pstate.bounds);
  }

  /* ---------- 逃げる演出 ---------- */
  function startFlee(c) {
    if (c.state === 'fleeing' || c.state === 'gone') return;
    c.state = 'fleeing';
    c.fleeT = 0;
    const pos = c.group.position;
    if (c.type === 'bird') {
      c.wx = pos.x; c.wy = GROUND_Y - pos.y; c.wz = pos.z;
      c.facing = Math.random() < 0.5 ? 1 : -1;
      c.fvx = c.facing * rnd(55, 90);
      c.fvyMatter = -rnd(60, 100); /* matterのyはマイナスで上方向 */
      c.fleeDuration = rnd(1.4, 2.0);
    } else if (c.type === 'balloon') {
      c.wx = pos.x; c.wy = GROUND_Y - pos.y; c.wz = pos.z;
      c.fvyMatter = -rnd(28, 46);
      c.fleeDuration = rnd(1.5, 2.0);
      if (c.line) c.line.visible = false;
    } else if (c.type === 'cat') {
      c.fleeDuration = rnd(1.6, 2.0);
    }
    if (window.GameAudio && window.GameAudio.play) {
      try { window.GameAudio.play('tap'); } catch (e) { /* 音がなくても平気 */ }
    }
  }

  function updateFlee(c, dt, time) {
    c.fleeT += dt;
    const t = c.fleeT;
    if (c.type === 'bird') {
      c.fvyMatter -= 40 * dt; /* だんだん急上昇 */
      c.wx += c.fvx * dt;
      c.wy += c.fvyMatter * dt;
      c.group.position.set(c.wx, ty(c.wy), c.wz);
      const flap = Math.sin(time * 32) * 1.0;
      if (c.group.userData.wingL) c.group.userData.wingL.rotation.z = flap;
      if (c.group.userData.wingR) c.group.userData.wingR.rotation.z = -flap;
      c.group.rotation.y = c.facing > 0 ? -0.35 : Math.PI + 0.35;
      c.group.rotation.x = -0.35;
    } else if (c.type === 'balloon') {
      c.fvyMatter -= 12 * dt;
      c.wy += c.fvyMatter * dt;
      c.wx += Math.sin(time * c.swaySpeed + c.swayPhase) * c.swayAmp * dt * 0.8;
      c.group.position.set(c.wx, ty(c.wy), c.wz);
      c.group.rotation.z = Math.sin(time * c.swaySpeed + c.swayPhase) * 0.2;
      setBalloonOpacity(c, Math.max(0, 1 - t / c.fleeDuration));
    } else if (c.type === 'cat') {
      const jumpDur = 0.35;
      if (t < jumpDur) {
        const k = t / jumpDur;
        c.group.position.set(c.baseX, c.baseY + Math.sin(k * Math.PI) * 14, c.baseZ);
      } else {
        const rt = t - jumpDur;
        const dist = 40 * rt + 30 * rt * rt;
        c.group.position.set(
          c.baseX + c.runDir * dist,
          c.baseY + Math.abs(Math.sin(rt * 16)) * 3.5,
          c.baseZ
        );
        c.group.rotation.y = c.runDir > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      const tp = c.group.userData.tailPivot;
      if (tp) tp.rotation.y = Math.sin(time * 10) * 0.6;
    }
    if (t > c.fleeDuration) c.state = 'gone';
  }

  /* ---------- アイドル更新 ---------- */
  function updateIdle(c, dt, time) {
    if (c.type === 'bird' || c.type === 'balloon') {
      const h = c.host;
      if (!h || (h.plugin.meta && h.plugin.meta.removed)) { startFlee(c); return; }
      const speed = Math.hypot(h.velocity.x, h.velocity.y);
      if (speed > 1) { startFlee(c); return; }
    }
    if (c.type === 'bird') {
      positionOnHost(c);
      c.group.position.y += Math.sin(time * c.bobSpeed + c.bobPhase) * c.bobAmp;
      c.tiltT -= dt;
      if (c.tiltT <= 0 && c.tiltTarget === 0) {
        c.tiltT = rnd(1.4, 3.6);
        c.tiltTarget = (Math.random() < 0.5 ? 1 : -1) * rnd(0.25, 0.45);
        c.tiltPhaseT = 0;
      }
      if (c.tiltTarget !== 0) {
        c.tiltPhaseT += dt;
        const k = Math.min(1, c.tiltPhaseT / 0.6);
        c.group.userData.headGrp.rotation.z = c.tiltTarget * Math.sin(Math.min(1, k) * Math.PI);
        if (k >= 1) c.tiltTarget = 0;
      }
    } else if (c.type === 'cat') {
      const tp = c.group.userData.tailPivot;
      if (tp) tp.rotation.y = Math.sin(time * c.tailSpeed + c.tailPhase) * 0.5;
      c.group.position.set(c.baseX, c.baseY + Math.sin(time * 1.3 + c.bobPhase) * 0.8, c.baseZ);
    } else if (c.type === 'balloon') {
      positionBalloon(c, time);
    }
  }

  /* ---------- 片付け ---------- */
  function removeCritter(c) {
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    if (c.line) {
      if (c.line.parent) c.line.parent.remove(c.line);
      if (c.line.geometry) c.line.geometry.dispose();
    }
    if (c.type === 'balloon' && c.group) {
      c.group.traverse((obj) => { if (obj.material) obj.material.dispose(); });
    }
  }

  function cleanupCritters() {
    for (const c of critters) removeCritter(c);
    critters.length = 0;
  }

  /* ---------- フックの配線 ---------- */
  if (window.GameHooks) {
    window.GameHooks.on('sceneBuilt', (payload) => {
      cleanupCritters();
      myGroup = new THREE.Group();
      myGroup.name = 'critters';
      if (payload && payload.levelGroup) payload.levelGroup.add(myGroup);
      haveLastTime = false;
    });

    window.GameHooks.on('levelStart', (pstate) => {
      cleanupCritters();
      spawnCritters(pstate);
    });

    window.GameHooks.on('boomStart', () => {
      for (const c of critters) startFlee(c);
    });

    window.GameHooks.on('levelEnd', () => {
      cleanupCritters();
    });

    window.GameHooks.on('frame', (state, time) => {
      const dt = haveLastTime ? Math.min(0.05, Math.max(0, time - lastTime)) : 0;
      lastTime = time;
      haveLastTime = true;
      if (!critters.length) return;
      for (let i = critters.length - 1; i >= 0; i--) {
        const c = critters[i];
        if (c.state === 'idle') {
          updateIdle(c, dt, time);
        } else if (c.state === 'fleeing') {
          updateFlee(c, dt, time);
          if (c.state === 'gone') {
            removeCritter(c);
            critters.splice(i, 1);
          }
        }
      }
    });
  }

  /* ---------- 公開API ---------- */
  window.GameCritters = {
    count() { return critters.length; },
  };
})();
