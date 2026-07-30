/* decor.js — かざりパーツ（やね・まど・ドア・はた・アンテナ）
 * 自己完結モジュール。build.js / render3d.js / hooks.js の公開APIとフックだけを使い、
 * 既存ファイルはモンキーパッチで拡張する（直接編集はしない）。
 *
 * 座標系メモ（他ファイルと同じ規約）:
 *   matter系 x, y（yは下むきプラス） → three系 x=matter.x, y = GROUND_Y - matter.y
 *   レイヤー(0=おく,1=なか,2=まえ) → three z = (layer-1) * B * 1.12
 */
(function () {
  'use strict';

  if (!window.GameBuild || !window.GameHooks || !window.GameLevels) {
    console.error('[decor] 必要な依存モジュールが見つかりません');
    return;
  }

  const build = window.GameBuild;
  const hooks = window.GameHooks;
  const B = window.GameLevels.B;
  const GROUND_Y = window.GameLevels.GROUND_Y;
  const COLS = build.COLS;
  const LEFT = -(COLS * B) / 2;
  const MAX_DECOR = 40;
  const FADE_DUR = 0.4;

  const DECOR_TYPES = ['yane', 'mado', 'doa', 'hata', 'antenna'];
  const DECOR_EMOJI = { yane: '🔺', mado: '🪟', doa: '🚪', hata: '🚩', antenna: '📡' };
  const DECOR_LABEL = { yane: 'やね', mado: 'まど', doa: 'ドア', hata: 'はた', antenna: 'アンテナ' };

  /* ---------- 公開データ（テスト/他エージェント用） ---------- */
  const decor = {
    decorMap: new Map(), /* "c,r,layer" → type */
    active: null,        /* 選択中のかざり種類 | null */
  };

  const keyOf = (c, r, l) => c + ',' + r + ',' + l;
  const ty = (my) => GROUND_Y - my;
  const layerZ = (l) => (l - 1) * B * 1.12;
  const cellX = (c) => LEFT + c * B + B / 2;
  const cellY = (r) => GROUND_Y - B / 2 - r * B;

  /* ---------- ジオメトリ/マテリアルの簡易キャッシュ ---------- */
  const geoCache = new Map();
  const matCache = new Map();
  function cachedGeo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }
  function cachedMat(key, make) {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  }
  function markShadow(obj) {
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    return obj;
  }

  /* ---------- メッシュ生成（ローポリ・かわいい系） ---------- */
  function makeYane() {
    const grp = new THREE.Group();
    const roof = new THREE.Mesh(
      cachedGeo('decor:yane', () => new THREE.ConeGeometry(B * 0.6, B * 0.5, 4, 1)),
      cachedMat('decor:yaneMat', () => new THREE.MeshLambertMaterial({ color: 0xe6493a }))
    );
    roof.rotation.y = Math.PI / 4;
    grp.add(roof);
    const cap = new THREE.Mesh(
      cachedGeo('decor:yaneCap', () => new THREE.SphereGeometry(3.4, 8, 6)),
      cachedMat('decor:yaneCapMat', () => new THREE.MeshLambertMaterial({ color: 0xb92f27 }))
    );
    cap.position.y = B * 0.25 - 1;
    grp.add(cap);
    return markShadow(grp);
  }

  function makeMado() {
    const grp = new THREE.Group();
    const frame = new THREE.Mesh(
      cachedGeo('decor:madoFrame', () => new THREE.BoxGeometry(B * 0.54, B * 0.54, 3)),
      cachedMat('decor:madoFrameMat', () => new THREE.MeshLambertMaterial({ color: 0xffffff }))
    );
    grp.add(frame);
    const pane = new THREE.Mesh(
      cachedGeo('decor:madoPane', () => new THREE.PlaneGeometry(B * 0.4, B * 0.4)),
      cachedMat('decor:madoPaneMat', () => new THREE.MeshLambertMaterial({ color: 0x8fd8f0, side: THREE.DoubleSide }))
    );
    pane.position.z = 2;
    grp.add(pane);
    const barH = new THREE.Mesh(
      cachedGeo('decor:madoBarH', () => new THREE.BoxGeometry(B * 0.4, 2.4, 4)),
      cachedMat('decor:madoBarMat', () => new THREE.MeshLambertMaterial({ color: 0xffffff }))
    );
    barH.position.z = 3;
    grp.add(barH);
    const barV = new THREE.Mesh(
      cachedGeo('decor:madoBarV', () => new THREE.BoxGeometry(2.4, B * 0.4, 4)),
      cachedMat('decor:madoBarMat', () => new THREE.MeshLambertMaterial({ color: 0xffffff }))
    );
    barV.position.z = 3;
    grp.add(barV);
    return markShadow(grp);
  }

  function makeDoa() {
    const grp = new THREE.Group();
    const door = new THREE.Mesh(
      cachedGeo('decor:doa', () => new THREE.BoxGeometry(B * 0.46, B * 0.82, 3)),
      cachedMat('decor:doaMat', () => new THREE.MeshLambertMaterial({ color: 0x8a5a34 }))
    );
    grp.add(door);
    const panel = new THREE.Mesh(
      cachedGeo('decor:doaPanel', () => new THREE.PlaneGeometry(B * 0.22, B * 0.2)),
      cachedMat('decor:doaPanelMat', () => new THREE.MeshLambertMaterial({ color: 0xdff3ff, side: THREE.DoubleSide }))
    );
    panel.position.set(0, B * 0.18, 1.6);
    grp.add(panel);
    const knob = new THREE.Mesh(
      cachedGeo('decor:knob', () => new THREE.SphereGeometry(2.6, 8, 8)),
      cachedMat('decor:knobMat', () => new THREE.MeshLambertMaterial({ color: 0xffd23e }))
    );
    knob.position.set(B * 0.46 / 2 - 6, -2, 3.6);
    grp.add(knob);
    return markShadow(grp);
  }

  function makeHata() {
    const poleH = B * 0.85;
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(
      cachedGeo('decor:hataPole', () => new THREE.CylinderGeometry(1.6, 1.9, poleH, 8)),
      cachedMat('decor:hataPoleMat', () => new THREE.MeshLambertMaterial({ color: 0x8a6a48 }))
    );
    grp.add(pole);
    const flagPivot = new THREE.Group();
    flagPivot.position.set(0, poleH / 2 - 7, 0);
    grp.add(flagPivot);
    const flagGeo = cachedGeo('decor:flag', () => {
      const g = new THREE.BufferGeometry();
      const w = B * 0.42, h = B * 0.26;
      const verts = new Float32Array([0, 0, 0, w, -h / 2, 0, w, h / 2, 0]);
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.computeVertexNormals();
      return g;
    });
    const flag = new THREE.Mesh(
      flagGeo,
      cachedMat('decor:flagMat', () => new THREE.MeshLambertMaterial({ color: 0xe63946, side: THREE.DoubleSide }))
    );
    flagPivot.add(flag);
    grp.userData.flagPivot = flagPivot;
    return markShadow(grp);
  }

  function makeAntenna() {
    const poleH = B * 0.7;
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(
      cachedGeo('decor:antPole', () => new THREE.CylinderGeometry(1, 1.3, poleH, 8)),
      cachedMat('decor:antPoleMat', () => new THREE.MeshLambertMaterial({ color: 0x999999 }))
    );
    grp.add(pole);
    for (const oy of [poleH * 0.18, -poleH * 0.12]) {
      const arm = new THREE.Mesh(
        cachedGeo('decor:antArm', () => new THREE.CylinderGeometry(0.8, 0.8, B * 0.22, 6)),
        cachedMat('decor:antPoleMat', () => new THREE.MeshLambertMaterial({ color: 0x999999 }))
      );
      arm.rotation.z = Math.PI / 2;
      arm.position.y = oy;
      grp.add(arm);
    }
    const ball = new THREE.Mesh(
      cachedGeo('decor:antBall', () => new THREE.SphereGeometry(4.2, 10, 8)),
      cachedMat('decor:antBallMat', () => new THREE.MeshLambertMaterial({ color: 0xff5a5a }))
    );
    ball.position.y = poleH / 2 + 3;
    grp.add(ball);
    return markShadow(grp);
  }

  const DEFS = {
    yane: { top: true, height: B * 0.5, make: makeYane },
    hata: { top: true, height: B * 0.85, make: makeHata },
    antenna: { top: true, height: B * 0.7, make: makeAntenna },
    mado: { top: false, zOff: B / 2 + 2, make: makeMado },
    doa: { top: false, zOff: B / 2 + 2, make: makeDoa },
  };

  /* ---------- 配置計算 ---------- */
  function applyTop(mesh, mx, my, angle, layer, height) {
    const dy = -(B / 2 + height / 2);
    const c = Math.cos(angle), s = Math.sin(angle);
    const wx = mx - dy * s;
    const wy = my + dy * c;
    mesh.position.set(wx, ty(wy), layerZ(layer));
    mesh.rotation.z = -angle;
  }
  function applyFront(mesh, mx, my, angle, layer, zOff) {
    mesh.position.set(mx, ty(my), layerZ(layer) + zOff);
    mesh.rotation.z = -angle;
  }
  function place(ent, mx, my, angle, layer) {
    const def = DEFS[ent.type];
    if (def.top) applyTop(ent.mesh, mx, my, angle, layer, def.height);
    else applyFront(ent.mesh, mx, my, angle, layer, def.zOff);
  }
  function placeStatic(ent) {
    place(ent, cellX(ent.c), cellY(ent.r), 0, ent.layer);
  }
  function placeHost(ent) {
    const host = ent.host;
    if (!host) return;
    const meta = host.plugin.meta;
    const layer = meta.layer != null ? meta.layer : ent.layer;
    place(ent, host.position.x, host.position.y, host.angle, layer);
  }

  /* ---------- シーン状態 ---------- */
  let curGroup = null;
  let curState = null;
  let curMode = null; /* 'edit' | 'demo' | null */
  const ents = new Map(); /* key → { mesh, type, c, r, layer, host, fading, fadeT } */

  function clearEnts() {
    for (const ent of ents.values()) {
      if (curGroup) curGroup.remove(ent.mesh);
    }
    ents.clear();
  }

  function createEnt(key, type, host) {
    const parts = key.split(',').map(Number);
    const mesh = DEFS[type].make();
    if (curGroup) curGroup.add(mesh);
    const ent = { mesh, type, c: parts[0], r: parts[1], layer: parts[2], host: host || null, fading: false, fadeT: 0 };
    ents.set(key, ent);
    return ent;
  }

  function removeEnt(key) {
    const ent = ents.get(key);
    if (!ent) return;
    if (curGroup) curGroup.remove(ent.mesh);
    ents.delete(key);
  }

  function bindHosts(state) {
    if (!window.GamePhysics || !window.GamePhysics.activeBlocks) return;
    const blocks = window.GamePhysics.activeBlocks(state);
    const byKey = new Map();
    for (const blk of blocks) {
      const m = blk.plugin.meta;
      byKey.set(keyOf(m.col, m.row, m.layer), blk);
    }
    for (const [k, type] of decor.decorMap) {
      if (ents.has(k)) continue;
      const host = byKey.get(k);
      if (!host) continue;
      const ent = createEnt(k, type, host);
      placeHost(ent);
    }
  }

  hooks.on('sceneBuilt', function (evt) {
    const state = evt.state;
    clearEnts();
    curGroup = new THREE.Group();
    evt.levelGroup.add(curGroup);
    curState = state;
    curMode = null;

    const lvId = state.level && state.level.id;
    if (lvId === 'build-edit') {
      curMode = 'edit';
      /* レイアウトに存在しないセルのかざりは孤児化しているので掃除する
       * （btn-next の「さいしょから」等、build.layout が直接クリアされる経路への保険） */
      for (const k of [...decor.decorMap.keys()]) {
        const parts = k.split(',').map(Number);
        if (!build.getCell(parts[0], parts[1], parts[2])) decor.decorMap.delete(k);
      }
      for (const [k, type] of decor.decorMap) {
        const ent = createEnt(k, type, null);
        placeStatic(ent);
      }
    } else if (lvId === 'build') {
      curMode = 'demo';
      bindHosts(state);
    }
  });

  hooks.on('levelStart', function (pstate) {
    if (curMode === 'demo' && curState === pstate) bindHosts(pstate);
  });

  let lastTime = null;
  hooks.on('frame', function (state, time) {
    const dt = lastTime == null ? 0 : Math.min(0.1, Math.max(0, time - lastTime));
    lastTime = time;
    if (!curGroup || state !== curState) return;

    for (const [key, ent] of [...ents]) {
      if (ent.fading) {
        ent.fadeT += dt;
        const t = Math.min(1, ent.fadeT / FADE_DUR);
        const s = Math.max(0.001, 1 - t);
        ent.mesh.scale.setScalar(s);
        if (t >= 1) removeEnt(key);
        continue;
      }
      if (curMode === 'demo' && ent.host) {
        if (ent.host.plugin.meta.removed) {
          ent.fading = true;
          ent.fadeT = 0;
          continue;
        }
        placeHost(ent);
      }
      if (ent.type === 'hata') {
        const fp = ent.mesh.userData.flagPivot;
        if (fp) fp.rotation.y = Math.sin(time * 6 + ent.c * 0.7 + ent.r * 0.3) * 0.35;
      }
    }
  });

  /* ---------- かざりモード：ストロークのモンキーパッチ ---------- */
  function cellFromScreen(sx, sy) {
    const layer = build.activeLayer;
    if (!window.GameRender || !window.GameRender.worldFromScreen) return null;
    const w = window.GameRender.worldFromScreen(sx, sy, layerZ(layer));
    const c = Math.floor((w.x - LEFT) / B);
    const r = Math.floor((GROUND_Y - w.y) / B);
    if (c < -1 || c > COLS || r < -1 || r > build.ROWS) return null;
    return {
      c: Math.max(0, Math.min(COLS - 1, c)),
      r: Math.max(0, Math.min(build.ROWS - 1, r)),
      layer,
    };
  }

  let decorFullMsgT = 0;
  function warnDecorFull() {
    const now = performance.now();
    if (now - decorFullMsgT > 1000) {
      if (window.GameUI) window.GameUI.message('かざりが いっぱい！', 1500);
      decorFullMsgT = now;
    }
  }

  function handleDecorTap(sx, sy) {
    const cell = cellFromScreen(sx, sy);
    if (!cell) return;
    const key = keyOf(cell.c, cell.r, cell.layer);
    if (!build.getCell(cell.c, cell.r, cell.layer)) {
      if (window.GameUI) window.GameUI.message('ブロックの うえに かざってね！', 1500);
      return;
    }
    if (decor.decorMap.has(key)) {
      decor.decorMap.delete(key);
      removeEnt(key);
      if (window.GameAudio) window.GameAudio.play('tap');
    } else {
      if (decor.decorMap.size >= MAX_DECOR) { warnDecorFull(); return; }
      decor.decorMap.set(key, decor.active);
      if (curMode === 'edit') {
        const ent = createEnt(key, decor.active, null);
        placeStatic(ent);
      }
      if (window.GameAudio) window.GameAudio.play('pop');
    }
  }

  const origStrokeStart = build.strokeStart;
  const origStrokeMove = build.strokeMove;
  const origStrokeEnd = build.strokeEnd;

  build.strokeStart = function (sx, sy) {
    if (decor.active) { handleDecorTap(sx, sy); return; }
    return origStrokeStart.call(build, sx, sy);
  };
  build.strokeMove = function (sx, sy) {
    if (decor.active) return; /* かざりモード中はドラッグでの連続設置はしない */
    return origStrokeMove.call(build, sx, sy);
  };
  build.strokeEnd = function () {
    if (decor.active) return;
    return origStrokeEnd.call(build);
  };

  /* 他のツールを選んだらかざりモードを解除する */
  function exitDecorMode() {
    if (!decor.active) return;
    decor.active = null;
    updateDecorSel();
  }
  ['pickColor', 'pickEraser', 'pickShape', 'pickBrush'].forEach((name) => {
    const orig = build[name];
    if (typeof orig !== 'function') return;
    build[name] = function () {
      exitDecorMode();
      return orig.apply(build, arguments);
    };
  });

  /* ぜんぶけす → かざりも全消去 */
  const origClearAll = build.clearAll;
  build.clearAll = function () {
    const r = origClearAll.apply(build, arguments);
    if (decor.decorMap.size) {
      decor.decorMap.clear();
      if (curMode === 'edit') clearEnts();
    }
    return r;
  };

  /* ---------- UI：#decor-row（#build-bar 内に1回だけ生成） ---------- */
  function updateDecorSel() {
    const row = document.getElementById('decor-row');
    if (!row) return;
    row.querySelectorAll('.decor-btn').forEach((b) => {
      b.classList.toggle('sel', decor.active === b.dataset.decor);
    });
  }

  function onPickDecorBtn(type) {
    if (window.GameAudio) window.GameAudio.play('tap');
    decor.active = decor.active === type ? null : type;
    updateDecorSel();
  }

  function buildDecorRow() {
    const bar = document.getElementById('build-bar');
    if (!bar || document.getElementById('decor-row')) return;
    const row = document.createElement('div');
    row.id = 'decor-row';
    DECOR_TYPES.forEach((type) => {
      const btn = document.createElement('button');
      btn.className = 'brush-btn decor-btn';
      btn.dataset.decor = type;
      btn.textContent = DECOR_EMOJI[type];
      btn.setAttribute('aria-label', 'かざり ' + (DECOR_LABEL[type] || type));
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPickDecorBtn(type);
      });
      row.appendChild(btn);
    });
    bar.appendChild(row);
  }
  buildDecorRow();

  window.GameDecor = decor;
})();
