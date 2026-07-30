/* machines.js — 「解体重機」（てっきゅう／ショベル）を自己完結で追加する拡張。
 * 既存ファイルには一切手を入れず、GameHooks 経由でシーン構築・毎フレーム更新に
 * 差し込み、GameCore.tap をモンキーパッチしてツール選択中の誤爆弾設置を防ぐ。
 * 対象は「建築モード（GameCore.level.sandbox）の解体フェーズ（boom/settle）」のみ。
 */
(function () {
  'use strict';

  const GL = window.GameLevels;
  const B = GL.B;
  const GROUND_Y = GL.GROUND_Y;
  const ty = (my) => GROUND_Y - my; /* matter y → three y（render3d.jsと同じ変換） */

  const BALL_Z = B * 1.5;   /* てっきゅうの描画z（いちばん手前） */
  const SHOVEL_Z = B * 1.4;

  const N_LINKS = 5;
  const LINK_LEN = 30;
  const BALL_LINK_LEN = 40;
  const BALL_R = 36;
  const SHOVEL_W = 26;
  const SHOVEL_H = B * 1.6;

  /* ---------- 状態 ---------- */
  const M = {
    tool: 'bomb', /* 'bomb' | 'ball' | 'shovel' */
  };

  let barEl = null;
  const btns = {};

  let levelGroupRef = null;
  let machineMeshes = null; /* Three.js のメッシュ一式（sceneBuiltごとに作り直す） */

  /* てっきゅう物理 */
  let ballWorld = null; /* { links, ball, constraints, anchorConstraint } */
  let ballImpactCb = null;
  let anchor = null; /* { x, y } 現在のアンカー位置（毎フレーム目標へ追従） */
  let dragTX = 0, dragTY = 0;

  /* ショベル物理 */
  let shovelBody = null;
  let shovelImpactCb = null;
  let shovelTargetX = 0;

  /* ドラッグ入力 */
  let dragging = false;
  let dragPointerId = null;

  /* ---------- どうぐ切替UI ---------- */
  function ensureBar() {
    if (barEl) return;
    const hud = document.getElementById('hud');
    if (!hud) return;
    barEl = document.createElement('div');
    barEl.id = 'machine-bar';
    barEl.className = 'hidden';
    const defs = [
      ['bomb', '💣', 'ばくだん'],
      ['ball', '🏗️', 'てっきゅう'],
      ['shovel', '🚜', 'ショベル'],
    ];
    defs.forEach(([key, emoji, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn machine-btn';
      b.dataset.tool = key;
      b.setAttribute('aria-label', label);
      const span = document.createElement('span');
      span.className = 'machine-emoji';
      span.textContent = emoji;
      b.appendChild(span);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.GameAudio) window.GameAudio.unlock();
        M.setTool(key);
      });
      barEl.appendChild(b);
      btns[key] = b;
    });
    hud.appendChild(barEl);
    syncBtnSel();
  }

  function syncBtnSel() {
    for (const k in btns) btns[k].classList.toggle('sel', k === M.tool);
  }

  function syncBarVisibility() {
    if (!barEl) return;
    const gc = window.GameCore;
    const show = !!(gc && gc.running && gc.level && gc.level.sandbox &&
      (gc.phase === 'boom' || gc.phase === 'settle'));
    barEl.classList.toggle('hidden', !show);
  }

  /* ---------- ブロックを起こす ----------
   * 以前はここで全ブロックを一斉に setStatic(false) していたが、大量ブロック時の
   * 物理負荷対策として廃止。physics.js の touch-to-wake（collisionStart 内）が、
   * てっきゅう／ショベルが静的なブロックにぶつかった時点で個別に起こし、支えを
   * 失った上方のブロックも連鎖して起こすため、何もしなくてよい。 */
  function wakeBlocks() {}

  /* ---------- 衝突検知（シェイク・ほこり・ドスン音） ---------- */
  function attachImpactListener(engine, label) {
    const cb = (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        if (a.label !== label && b.label !== label) continue;
        const other = a.label === label ? b : a;
        if (other.label !== 'block') continue;
        const speed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (speed < 3) continue;
        const pos = pair.collision.supports[0] || other.position;
        window.GameFx.dustAt(pos.x, pos.y, Math.min(6, speed * 0.5));
        if (speed > 6) {
          window.GameFx.shake(Math.min(16, speed));
          window.GameAudio.play('thud');
        }
      }
    };
    Matter.Events.on(engine, 'collisionStart', cb);
    return cb;
  }

  /* ---------- てっきゅう ---------- */
  function createBall() {
    const gc = window.GameCore;
    const pstate = gc && gc.pstate;
    if (!pstate) return;
    const world = pstate.engine.world;
    const b = pstate.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const anchorY = b.topY + 40;

    anchor = { x: cx, y: anchorY };
    dragTX = cx;
    dragTY = anchorY;

    const links = [];
    let py = anchorY;
    for (let i = 0; i < N_LINKS; i++) {
      py += LINK_LEN;
      links.push(Matter.Bodies.circle(cx, py, 6, {
        density: 0.0006,
        friction: 0.05,
        frictionAir: 0.01,
        label: 'chainlink',
        collisionFilter: { category: 0, mask: 0 },
      }));
    }
    py += BALL_LINK_LEN + BALL_R;
    const ball = Matter.Bodies.circle(cx, py, BALL_R, {
      density: 0.02,
      friction: 0.5,
      restitution: 0.05,
      frictionAir: 0.001,
      label: 'wreckball',
      collisionFilter: { category: 0x0001, mask: 0xFFFF },
    });

    const constraints = [];
    const anchorConstraint = Matter.Constraint.create({
      pointA: { x: anchor.x, y: anchor.y },
      bodyB: links[0],
      length: LINK_LEN,
      stiffness: 0.9,
      damping: 0.15,
    });
    constraints.push(anchorConstraint);
    for (let i = 0; i < links.length - 1; i++) {
      constraints.push(Matter.Constraint.create({
        bodyA: links[i], bodyB: links[i + 1],
        length: LINK_LEN, stiffness: 0.9, damping: 0.15,
      }));
    }
    constraints.push(Matter.Constraint.create({
      bodyA: links[links.length - 1], bodyB: ball,
      length: BALL_LINK_LEN, stiffness: 0.9, damping: 0.15,
    }));

    Matter.Composite.add(world, links);
    Matter.Composite.add(world, ball);
    Matter.Composite.add(world, constraints);

    ballWorld = { links, ball, constraints, anchorConstraint };
    ballImpactCb = attachImpactListener(pstate.engine, 'wreckball');
  }

  function updateBallDrag() {
    if (!ballWorld || !anchor) return;
    const k = 0.16;
    anchor.x += (dragTX - anchor.x) * k;
    anchor.y += (dragTY - anchor.y) * k;
    ballWorld.anchorConstraint.pointA.x = anchor.x;
    ballWorld.anchorConstraint.pointA.y = anchor.y;
  }

  const UP_AXIS = new THREE.Vector3(0, 1, 0);
  function alignSegment(mesh, ax, ay, bx, by, z, baseLen) {
    const pA = new THREE.Vector3(ax, ty(ay), z);
    const pB = new THREE.Vector3(bx, ty(by), z);
    const dir = new THREE.Vector3().subVectors(pB, pA);
    const len = Math.max(0.001, dir.length());
    mesh.position.copy(pA).addScaledVector(dir, 0.5);
    mesh.scale.set(1, len / baseLen, 1);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir.clone().normalize());
  }

  function syncBallMesh() {
    if (!machineMeshes || !ballWorld || !anchor) return;
    const g = machineMeshes.ball;
    const pts = [{ x: anchor.x, y: anchor.y }];
    for (const link of ballWorld.links) pts.push(link.position);
    pts.push(ballWorld.ball.position);

    for (let i = 0; i < g.chainMeshes.length; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      if (!p0 || !p1) continue;
      alignSegment(g.chainMeshes[i], p0.x, p0.y, p1.x, p1.y, BALL_Z, 28);
    }
    const bp = ballWorld.ball.position;
    g.ballMesh.position.set(bp.x, ty(bp.y), BALL_Z);
    g.trolley.position.set(anchor.x, ty(anchor.y), BALL_Z);
  }

  /* ---------- ショベル ---------- */
  function createShovel() {
    const gc = window.GameCore;
    const pstate = gc && gc.pstate;
    if (!pstate) return;
    const world = pstate.engine.world;
    const b = pstate.bounds;
    const startX = b.minX + 90;
    const y = GROUND_Y - SHOVEL_H / 2 - 2;
    const body = Matter.Bodies.rectangle(startX, y, SHOVEL_W, SHOVEL_H, {
      density: 0.03,
      friction: 0.9,
      frictionAir: 0.05,
      restitution: 0,
      label: 'shovel',
      collisionFilter: { category: 0x0001, mask: 0xFFFF },
    });
    Matter.Body.setInertia(body, Infinity);
    Matter.Composite.add(world, body);
    shovelBody = body;
    shovelTargetX = startX;
    shovelImpactCb = attachImpactListener(pstate.engine, 'shovel');
  }

  function updateShovelDrag() {
    if (!shovelBody) return;
    const gc = window.GameCore;
    const bnd = gc.pstate && gc.pstate.bounds;
    let tx = shovelTargetX;
    if (bnd) tx = Math.max(bnd.minX + 20, Math.min(bnd.maxX - 20, tx));
    const dx = tx - shovelBody.position.x;
    const maxSpeed = 8.5;
    const vx = Math.max(-maxSpeed, Math.min(maxSpeed, dx * 0.22));
    Matter.Body.setVelocity(shovelBody, { x: vx, y: shovelBody.velocity.y });
    Matter.Body.setAngle(shovelBody, 0);
    Matter.Body.setAngularVelocity(shovelBody, 0);
  }

  function syncShovelMesh() {
    if (!machineMeshes || !shovelBody) return;
    const grp = machineMeshes.shovel.grp;
    grp.position.set(shovelBody.position.x, ty(shovelBody.position.y), SHOVEL_Z);
  }

  /* ---------- 物理の追加/削除 ---------- */
  function removeMachineBodies() {
    const gc = window.GameCore;
    const pstate = gc && gc.pstate;
    if (ballWorld) {
      if (pstate) {
        try {
          Matter.Composite.remove(pstate.engine.world, ballWorld.links);
          Matter.Composite.remove(pstate.engine.world, ballWorld.ball);
          Matter.Composite.remove(pstate.engine.world, ballWorld.constraints);
          if (ballImpactCb) Matter.Events.off(pstate.engine, 'collisionStart', ballImpactCb);
        } catch (e) { /* シーンが既に破棄されている場合は無視 */ }
      }
      ballWorld = null;
      ballImpactCb = null;
      anchor = null;
    }
    if (shovelBody) {
      if (pstate) {
        try {
          Matter.Composite.remove(pstate.engine.world, shovelBody);
          if (shovelImpactCb) Matter.Events.off(pstate.engine, 'collisionStart', shovelImpactCb);
        } catch (e) { /* 同上 */ }
      }
      shovelBody = null;
      shovelImpactCb = null;
    }
  }

  function updateMeshVisibility() {
    if (!machineMeshes) return;
    machineMeshes.ball.grp.visible = M.tool === 'ball';
    machineMeshes.shovel.grp.visible = M.tool === 'shovel';
  }

  /* ---------- ツール切替（公開API） ---------- */
  M.setTool = function (tool) {
    if (tool !== 'bomb' && tool !== 'ball' && tool !== 'shovel') return;
    if (tool === M.tool) { syncBtnSel(); return; }
    removeMachineBodies();
    M.tool = tool;
    syncBtnSel();
    if (tool === 'ball') {
      wakeBlocks();
      createBall();
    } else if (tool === 'shovel') {
      wakeBlocks();
      createShovel();
    }
    updateMeshVisibility();
    if (window.GameAudio) window.GameAudio.play('tap');
  };

  /* ---------- GameCore.tap のモンキーパッチ ----------
   * てっきゅう/ショベル選択中は、爆弾の設置・起爆タップを無視する。 */
  if (window.GameCore && typeof window.GameCore.tap === 'function') {
    const origTap = window.GameCore.tap;
    window.GameCore.tap = function (sx, sy) {
      if (M.tool !== 'bomb') return;
      return origTap(sx, sy);
    };
  }

  /* ---------- 3Dメッシュの構築（sceneBuiltごとに作り直す） ---------- */
  function buildMachineMeshes() {
    if (!levelGroupRef || typeof THREE === 'undefined') return;
    const grp = new THREE.Group();
    grp.name = 'machines';

    /* てっきゅう */
    const ballGrp = new THREE.Group();
    ballGrp.visible = false;
    const ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 18, 14),
      new THREE.MeshLambertMaterial({ color: 0x555a60 })
    );
    ballMesh.castShadow = true;
    ballGrp.add(ballMesh);
    const chainMeshes = [];
    for (let i = 0; i < N_LINKS + 1; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(4, 4, 28, 6),
        new THREE.MeshLambertMaterial({ color: 0x8a929a })
      );
      seg.castShadow = true;
      ballGrp.add(seg);
      chainMeshes.push(seg);
    }
    const trolley = new THREE.Mesh(
      new THREE.BoxGeometry(64, 24, 40),
      new THREE.MeshLambertMaterial({ color: 0xffcc33 })
    );
    trolley.castShadow = true;
    ballGrp.add(trolley);
    grp.add(ballGrp);

    /* ショベル（ブルドーザー） */
    const shovelGrp = new THREE.Group();
    shovelGrp.visible = false;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(SHOVEL_W, SHOVEL_H, B * 1.3),
      new THREE.MeshLambertMaterial({ color: 0xffb020 })
    );
    blade.castShadow = true;
    shovelGrp.add(blade);
    const carBody = new THREE.Mesh(
      new THREE.BoxGeometry(96, 46, 66),
      new THREE.MeshLambertMaterial({ color: 0xffd54a })
    );
    carBody.position.set(-70, SHOVEL_H / 2 - 20, 0);
    carBody.castShadow = true;
    shovelGrp.add(carBody);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(46, 40, 46),
      new THREE.MeshLambertMaterial({ color: 0xfff2c8 })
    );
    cab.position.set(-62, SHOVEL_H / 2 + 22, 0);
    cab.castShadow = true;
    shovelGrp.add(cab);
    const trackGeo = new THREE.BoxGeometry(120, 22, 16);
    const trackMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const trackL = new THREE.Mesh(trackGeo, trackMat);
    trackL.position.set(-70, -SHOVEL_H / 2 + 8, 36);
    trackL.castShadow = true;
    shovelGrp.add(trackL);
    const trackR = trackL.clone();
    trackR.position.z = -36;
    shovelGrp.add(trackR);
    grp.add(shovelGrp);

    levelGroupRef.add(grp);
    machineMeshes = {
      grp,
      ball: { grp: ballGrp, ballMesh, chainMeshes, trolley },
      shovel: { grp: shovelGrp, blade, carBody, cab },
    };
  }

  /* ---------- 入力（ドラッグ） ---------- */
  function shouldHandleDrag() {
    const gc = window.GameCore;
    if (!gc || !gc.running) return false;
    if (!gc.level || !gc.level.sandbox) return false;
    if (gc.phase !== 'boom' && gc.phase !== 'settle') return false;
    if (M.tool !== 'ball' && M.tool !== 'shovel') return false;
    if (window.GameCamera && window.GameCamera.gesturing) return false;
    return true;
  }

  function applyDragTarget(sx, sy) {
    if (!window.GameRender || !window.GameRender.worldFromScreen) return;
    const w = window.GameRender.worldFromScreen(sx, sy, 0);
    if (M.tool === 'ball') {
      dragTX = w.x;
      const restY = anchor ? anchor.y : w.y;
      dragTY = Math.max(restY - 60, Math.min(restY + 60, w.y));
    } else if (M.tool === 'shovel') {
      shovelTargetX = w.x;
    }
  }

  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!shouldHandleDrag()) return;
      dragging = true;
      dragPointerId = e.pointerId;
      applyDragTarget(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== dragPointerId) return;
      if (!shouldHandleDrag()) return;
      applyDragTarget(e.clientX, e.clientY);
    });
  }
  function endDrag(e) {
    if (e && dragPointerId !== null && e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /* ---------- GameHooks 配線 ---------- */
  if (window.GameHooks) {
    window.GameHooks.on('sceneBuilt', (ctx) => {
      levelGroupRef = ctx.levelGroup;
      /* 直前のシーンの物理ボディは古いエンジンごと破棄されるため参照だけ落とす */
      ballWorld = null;
      ballImpactCb = null;
      anchor = null;
      shovelBody = null;
      shovelImpactCb = null;
      dragging = false;
      dragPointerId = null;
      M.tool = 'bomb';
      buildMachineMeshes();
      ensureBar();
      syncBtnSel();
      updateMeshVisibility();
    });

    window.GameHooks.on('levelEnd', () => {
      removeMachineBodies();
      M.tool = 'bomb';
      syncBtnSel();
      updateMeshVisibility();
    });

    window.GameHooks.on('frame', (state) => {
      ensureBar();
      syncBarVisibility();
      const gc = window.GameCore;
      if (!gc || state !== gc.pstate || !gc.level || !gc.level.sandbox) return;
      if (M.tool === 'ball' && ballWorld) {
        updateBallDrag();
        syncBallMesh();
      } else if (M.tool === 'shovel' && shovelBody) {
        updateShovelDrag();
        syncShovelMesh();
      }
    });
  }

  ensureBar();

  window.GameMachines = M;
})();
