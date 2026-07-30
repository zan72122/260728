/* ============================================================
 * game.js — 進行 / 入力 / メインループ
 * ============================================================ */
(function () {
  const G = {
    state: 'boot',       // boot | bake | play | clear
    round: 1,
    stars: 0,
    idleT: 0,
    lastSlipSnd: 0,
    lastCreak: 0,
    zoom: 1,
  };
  PT.Game = G;

  const raycaster = new THREE.Raycaster();
  const _p2 = new THREE.Vector2();
  const _v = new THREE.Vector3();

  const UNLOCKS = [
    { stars: 15, key: 'rainbow', icon: '🌈' },
    { stars: 40, key: 'balloon', icon: '🎈' },
    { stars: 80, key: 'castle', icon: '🏰' },
  ];

  // ================= 起動 =================
  function boot() {
    const canvas = document.getElementById('gl');
    PT.World.init(canvas);
    PT.FX.init(PT.World.scene, PT.World.camera);
    PT.Physics.init(PT.World.scene);
    PT.UI.init();
    load();
    applyUnlocks(false);
    bindInput(canvas);
    bindEvents();

    document.getElementById('boot-cover').addEventListener('pointerdown', () => {
      PT.Audio.init();
      PT.Audio.resume();
      document.getElementById('boot-cover').classList.add('fade');
      startRound();
    }, { once: true });

    document.getElementById('next-btn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (G.state !== 'clear') return;
      G.round++;
      save();
      PT.Audio.fanfare();
      startRound();
    });

    document.getElementById('rebake-btn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (G.state === 'boot') return;
      PT.Audio.plop(0.8, 0.25);
      startRound();
    });

    requestAnimationFrame(tick);
  }

  function load() {
    try {
      G.stars = parseInt(localStorage.getItem('pt_stars') || '0', 10) || 0;
      G.round = parseInt(localStorage.getItem('pt_round') || '1', 10) || 1;
    } catch (e) { /* プライベートモード等 */ }
    PT.UI.setStars(G.stars);
  }
  function save() {
    try {
      localStorage.setItem('pt_stars', String(G.stars));
      localStorage.setItem('pt_round', String(G.round));
    } catch (e) { }
  }

  // ================= ラウンド =================
  function startRound() {
    PT.UI.showNext(false);
    PT.Physics.clearAll();
    const pancakes = PT.buildTower(G.round);
    PT.Physics.setTower(pancakes);
    G.state = 'bake';
    G.idleT = 0;
  }

  function bindEvents() {
    const P = PT.Physics;
    P.on.plop = (p, v) => {
      PT.Audio.plop(0.9 + (1 - p.idx / 18) * 0.7, PT.clamp(v * 0.04, 0.15, 0.4));
      if (v > 6) {
        p.mesh.getWorldPosition(_v);
        PT.FX.burst(_v, { n: 4, map: PT.FX.textures.dotWhite, speed: 2, life: 0.4, size: 0.3 });
      }
    };
    P.on.slip = () => {
      const now = performance.now();
      if (now - G.lastSlipSnd > 350) {
        G.lastSlipSnd = now;
        PT.Audio.slip();
      }
    };
    P.on.detach = (mode, count) => {
      PT.Audio.plop(mode === 'tip' ? 0.6 : 1.2, 0.3);
      if (mode === 'tip' && count >= 3) PT.Audio.note(180, { type: 'sine', gain: 0.2, dur: 0.5 });
    };
    P.on.microSlip = () => {
      const now = performance.now();
      if (now - G.lastCreak > 260) {
        G.lastCreak = now;
        PT.Audio.creak();
      }
    };
    P.on.collide = (impact, pos) => {
      PT.Audio.plop(PT.clamp(1.6 - impact * 0.08, 0.6, 1.4), PT.clamp(impact * 0.035, 0.12, 0.35));
      if (impact > 5) {
        _v.set(pos.x, pos.y, pos.z);
        PT.FX.burst(_v, { n: 4, map: PT.FX.textures.dotWhite, speed: 2, life: 0.4, size: 0.3 });
      }
    };
    P.on.serve = (p, plate) => {
      const n = p.type === 'rainbow' ? 3 : 1;
      G.stars += n;
      save();
      PT.UI.setStars(G.stars);
      p.mesh.getWorldPosition(_v);
      PT.Audio.chime(5 + PT.randi(0, 3));
      PT.FX.sparkle(_v, 10, p.type !== 'normal');
      for (let i = 0; i < n; i++) {
        PT.FX.flyIcon(_v, '⭐', document.getElementById('star-pill'));
      }
      applyUnlocks(true);
    };
    P.on.land = (p) => {
      PT.Audio.plop(PT.rand(0.7, 1.1), 0.2);
      if (Math.random() < 0.4) {
        p.mesh.getWorldPosition(_v);
        PT.FX.hearts(_v, 2);
      }
    };
    P.on.berryBounce = (be) => {
      PT.Audio.note(PT.rand(700, 1000), { type: 'sine', gain: 0.08, dur: 0.1 });
    };
    P.on.towerEmpty = () => {
      if (G.state !== 'play') return;
      G.state = 'clear';
      setTimeout(() => {
        PT.Audio.fanfare();
        PT.FX.confetti(new THREE.Vector3(0, 5, 0), 60);
        PT.UI.showNext(true);
        let i = 0;
        const iv = setInterval(() => {
          PT.FX.confetti(new THREE.Vector3(PT.rand(-3, 3), PT.rand(4, 8), PT.rand(-3, 3)), 18);
          PT.Audio.pop();
          if (++i > 4) clearInterval(iv);
        }, 380);
      }, 700);
    };
  }

  function applyUnlocks(withToast) {
    UNLOCKS.forEach((u) => {
      const deco = PT.World.decorations[u.key];
      if (G.stars >= u.stars && !deco.visible) {
        deco.visible = true;
        if (withToast) {
          PT.UI.unlockToast(u.icon);
          PT.Audio.fanfare();
        }
      }
    });
  }

  // ================= 入力 =================
  const input = {
    pointers: new Map(),
    dragging: false,
    onTower: false,
    lastHit: null,
    pinchD: 0,
  };

  function pickPancake(clientX, clientY) {
    _p2.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(_p2, PT.World.camera);
    // まず塔（と倒れかけ）を優先して当てる（散らばったパンケーキに邪魔されない）
    const stackMeshes = [];
    PT.Physics.stack.forEach((p) => { if (p.visibleNow) stackMeshes.push(p.bodyMesh); });
    PT.Physics.tipGroups.forEach((g) => g.pancakes.forEach((p) => stackMeshes.push(p.bodyMesh)));
    let hits = raycaster.intersectObjects(stackMeshes, false);
    if (!hits.length) {
      const meshes = [];
      PT.Physics.bodies.forEach((b) => b.items.forEach((it) => meshes.push(it.pan.bodyMesh)));
      PT.Physics.landedPancakes.forEach((p) => meshes.push(p.bodyMesh));
      hits = raycaster.intersectObjects(meshes, false);
    }
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !(o.userData && o.userData.pancake)) o = o.parent;
    if (!o) return null;
    return { pancake: o.userData.pancake, point: hits[0].point };
  }

  function bindInput(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      PT.Audio.resume();
      G.idleT = 0;
      PT.UI.hideHint();
      if (PT.UI.open) PT.UI.setOpen(false);
      input.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (input.pointers.size === 1) {
        const hit = G.state === 'play' || G.state === 'clear' ? pickPancake(e.clientX, e.clientY) : null;
        if (hit) {
          input.onTower = true;
          input.lastHit = hit;
          PT.Toppings.pointerDown(hit);
        } else {
          input.onTower = false;
          input.dragging = true;
        }
      } else if (input.pointers.size === 2) {
        // ピンチ開始
        PT.Toppings.pointerUp();
        input.onTower = false;
        const pts = [...input.pointers.values()];
        input.pinchD = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const pt = input.pointers.get(e.pointerId);
      if (!pt) return;
      const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
      pt.x = e.clientX; pt.y = e.clientY;
      G.idleT = 0;

      if (input.pointers.size === 2) {
        const pts = [...input.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (input.pinchD > 0) {
          G.zoom = PT.clamp(G.zoom * input.pinchD / d, 0.55, 1.8);
        }
        input.pinchD = d;
        return;
      }

      if (input.onTower) {
        const hit = pickPancake(e.clientX, e.clientY);
        if (hit) input.lastHit = hit;
      } else if (input.dragging) {
        PT.World.camAz += -dx * 0.007;
        PT.World.camAzVel = -dx * 0.12;
        PT.World.camPol = PT.clamp(PT.World.camPol - dy * 0.004, 0.62, 1.32);
      }
    });

    const up = (e) => {
      input.pointers.delete(e.pointerId);
      if (input.pointers.size === 0) {
        input.dragging = false;
        if (input.onTower) {
          input.onTower = false;
          input.lastHit = null;
          PT.Toppings.pointerUp();
        }
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);

    // iOSのダブルタップ拡大などを抑止
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ================= メインループ =================
  let lastT = 0;
  function tick(t) {
    requestAnimationFrame(tick);
    const dt = PT.clamp((t - lastT) / 1000, 0.001, 0.05);
    lastT = t;
    if (G.state === 'boot') return;

    // そそぎ続ける
    if (input.onTower && input.lastHit) {
      PT.Toppings.pointerMove(input.lastHit, dt);
    }

    PT.Physics.step(dt);
    PT.Toppings.update(dt);
    PT.FX.update(dt);
    PT.World.update(dt);

    // 焼き上がり判定
    if (G.state === 'bake') {
      const st = PT.Physics.stack;
      const ready = st.length && st.every((p) => p._spawned && p.yCur <= p.yTarget + 0.01);
      if (ready) {
        G.state = 'play';
        PT.Audio.chime(7);
      }
    }

    // すべり中の顔（下の層との相対速度で判定）
    const st = PT.Physics.stack;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (p.relSpeed > 0.8) p.setFace('wee');
      else if (p.faceKind === 'wee' && p.relSpeed < 0.25) p.setFace('normal');
    }

    // 着地済みのぷにぷに
    const lp = PT.Physics.landedPancakes;
    for (let i = 0; i < lp.length; i++) {
      const p = lp[i];
      const active = Math.abs(p.squash) > 0.002 || Math.abs(p.squashV) > 0.002 || p.jiggleAmp > 0.01;
      if (!active) continue;
      p.squashV += (-p.squash * 60 - p.squashV * 9) * dt;
      p.squash = PT.clamp(p.squash + p.squashV * dt, -0.5, 0.6);
      const s = p.squash;
      p.mesh.scale.set(1 + s * 0.3, Math.max(0.3, 1 - s * 0.45), 1 + s * 0.3);
      p.updateDeform(dt);
    }

    // ぐらぐら警告のかわいい音
    if (PT.Physics.instability > 0.55 && t - G.lastCreak > 700) {
      G.lastCreak = t;
      if (Math.random() < 0.6) PT.Audio.creak();
    }

    // ヒント（しばらく触っていないとき）
    if (G.state === 'play') {
      G.idleT += dt;
      if (G.idleT > 9 && st.length) {
        const p = st[Math.floor(st.length / 2)];
        _v.set(p.xz.x, p.yCur, p.xz.y).project(PT.World.camera);
        PT.UI.showHint(
          (_v.x * 0.5 + 0.5) * window.innerWidth,
          (-_v.y * 0.5 + 0.5) * window.innerHeight
        );
        G.idleT = 4;
      }
    }

    // カメラと描画
    const top = PT.Physics.towerTopY();
    PT.World.updateCamera(dt, top, input.dragging || input.pointers.size > 0, G.zoom);
    PT.Audio.updateMusic(dt);
    PT.World.renderer.render(PT.World.scene, PT.World.camera);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
