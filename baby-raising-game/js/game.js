/* =========================================================
 * game.js — ゲーム本体
 *   ・レンダリング / 自由に動かせるカメラ（タッチ対応）
 *   ・お世話（ミルク・おむつ・ねんね・あそぶ・おふろ）
 *   ・ごきげんメーターとふきだし
 *   ・パーティクル演出とセーブ
 * ========================================================= */
(function () {
  'use strict';

  /* ================= 基本セットアップ ================= */

  const canvas = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(10, 6, 14);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.target.set(0, 1.2, 0.6);
  if (THREE.TOUCH) {
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  }

  // ライト
  const DAY_HEMI = 0.55;
  const DAY_SUN = 0.5;
  const hemi = new THREE.HemisphereLight(0xfff4fb, 0xffcfe0, DAY_HEMI);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffffff, DAY_SUN);
  sunLight.position.set(6, 9, 5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -6;
  sunLight.shadow.camera.right = 6;
  sunLight.shadow.camera.top = 8;
  sunLight.shadow.camera.bottom = -4;
  sunLight.shadow.camera.far = 30;
  scene.add(sunLight);

  // 世界と赤ちゃん
  const world = World.build(scene);
  const baby = new Baby(World.toonMat);
  baby.group.position.set(0, 0.08, 0.6);
  scene.add(baby.group);

  /* ================= パーティクル ================= */

  function makeTexture(draw) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    draw(ctx, 128);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  function drawHeart(ctx, s, color = '#ff6fa5') {
    ctx.translate(s / 2, s / 2);
    ctx.scale(s / 34, s / 34);
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.bezierCurveTo(-14, 0, -12, -12, -4, -12);
    ctx.bezierCurveTo(-1, -12, 0, -9, 0, -8);
    ctx.bezierCurveTo(0, -9, 1, -12, 4, -12);
    ctx.bezierCurveTo(12, -12, 14, 0, 0, 12);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  function drawStar(ctx, s, color = '#ffd34d', points = 5) {
    ctx.translate(s / 2, s / 2);
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = (i % 2 === 0) ? s * 0.42 : s * 0.18;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  const TEXTURES = {
    heart: makeTexture((ctx, s) => drawHeart(ctx, s)),
    star: makeTexture((ctx, s) => drawStar(ctx, s)),
    sparkle: makeTexture((ctx, s) => drawStar(ctx, s, '#fff8d0', 4)),
    note: makeTexture((ctx, s) => {
      ctx.strokeStyle = '#8f6bd6';
      ctx.fillStyle = '#8f6bd6';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(s * 0.35, s * 0.72, s * 0.13, s * 0.1, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.46, s * 0.7);
      ctx.lineTo(s * 0.46, s * 0.22);
      ctx.quadraticCurveTo(s * 0.62, s * 0.26, s * 0.72, s * 0.38);
      ctx.stroke();
    }),
    zzz: makeTexture((ctx, s) => {
      ctx.font = `bold ${s * 0.62}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText('Z', s / 2, s / 2);
      ctx.fillStyle = '#7fa8ff';
      ctx.fillText('Z', s / 2, s / 2);
    }),
    bubble: makeTexture((ctx, s) => {
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.1, s * 0.5, s * 0.5, s * 0.45);
      g.addColorStop(0, 'rgba(220,245,255,0.15)');
      g.addColorStop(0.8, 'rgba(190,230,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.ellipse(s * 0.36, s * 0.34, s * 0.09, s * 0.055, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }),
    poof: makeTexture((ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.48);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(255,240,250,0.55)');
      g.addColorStop(1, 'rgba(255,240,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.48, 0, Math.PI * 2);
      ctx.fill();
    }),
    tear: makeTexture((ctx, s) => {
      ctx.translate(s / 2, s / 2);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.32);
      ctx.quadraticCurveTo(s * 0.26, s * 0.05, s * 0.18, s * 0.2);
      ctx.arc(0, s * 0.14, s * 0.19, 0.3, Math.PI - 0.3);
      ctx.quadraticCurveTo(-s * 0.26, s * 0.05, 0, -s * 0.32);
      ctx.fillStyle = '#9fd2ff';
      ctx.fill();
    }),
  };

  const particles = [];
  const particlePool = {};

  function spawnParticle(type, pos, opts = {}) {
    let p = (particlePool[type] || []).pop();
    if (!p) {
      const mat = new THREE.SpriteMaterial({
        map: TEXTURES[type], transparent: true, depthWrite: false,
      });
      p = { sprite: new THREE.Sprite(mat), type };
      scene.add(p.sprite);
    }
    p.sprite.visible = true;
    p.sprite.position.copy(pos);
    p.vel = opts.vel ? opts.vel.clone() : new THREE.Vector3(0, 0.8, 0);
    p.gravity = opts.gravity !== undefined ? opts.gravity : 0;
    p.life = 0;
    p.maxLife = opts.life || 1.2;
    p.size = opts.size || 0.3;
    p.grow = opts.grow || 0;
    p.spin = opts.spin || 0;
    p.sprite.scale.setScalar(p.size);
    p.sprite.material.opacity = 1;
    p.sprite.material.rotation = Math.random() * Math.PI * 2 * (p.spin ? 1 : 0);
    particles.push(p);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.sprite.visible = false;
        particles.splice(i, 1);
        (particlePool[p.type] = particlePool[p.type] || []).push(p);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      p.sprite.material.opacity = 1 - k * k;
      p.sprite.scale.setScalar(p.size + p.grow * k);
      if (p.spin) p.sprite.material.rotation += p.spin * dt;
    }
  }

  function heartBurst(center, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      spawnParticle('heart', center, {
        vel: new THREE.Vector3(Math.cos(a) * 0.9, 1.4 + Math.random() * 0.8, Math.sin(a) * 0.9),
        gravity: 1.2, life: 1.3, size: 0.22 + Math.random() * 0.14,
      });
    }
  }

  /* ================= ふきだし（ほしい物のアイコン） ================= */

  const NEED_EMOJI = { hunger: '🍼', diaper: '🩲', sleepy: '🌙', fun: '🧸', clean: '🛁' };

  function makeBubbleTexture(emoji) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff9ec8';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(140, 105, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(62, 205, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 238, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '100px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 140, 112);
    return new THREE.CanvasTexture(c);
  }

  const bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  bubbleSprite.scale.setScalar(0.95);
  bubbleSprite.visible = false;
  scene.add(bubbleSprite);
  const bubbleTexCache = {};
  let bubbleNeed = null;

  function showBubble(needKey) {
    if (bubbleNeed === needKey) return;
    bubbleNeed = needKey;
    if (!needKey) { bubbleSprite.visible = false; return; }
    if (!bubbleTexCache[needKey]) bubbleTexCache[needKey] = makeBubbleTexture(NEED_EMOJI[needKey]);
    bubbleSprite.material.map = bubbleTexCache[needKey];
    bubbleSprite.material.needsUpdate = true;
    bubbleSprite.visible = true;
  }

  /* ================= ごきげん（ニーズ）管理 ================= */

  const needs = { hunger: 62, diaper: 72, sleepy: 88, fun: 58, clean: 82 };
  const DECAY = { hunger: 0.5, diaper: 0.4, sleepy: 0.26, fun: 0.6, clean: 0.24 };
  const LOW = 30;

  const chipEls = {};
  document.querySelectorAll('.status-chip').forEach((el) => { chipEls[el.dataset.need] = el; });
  const actionBtns = {};
  document.querySelectorAll('.action-btn').forEach((el) => { actionBtns[el.dataset.action] = el; });
  const ACTION_NEED = { feed: 'hunger', diaper: 'diaper', sleep: 'sleepy', play: 'fun', bath: 'clean' };

  let busy = false;
  let crying = false;

  function updateNeedsUI() {
    for (const key in needs) {
      const chip = chipEls[key];
      if (!chip) continue;
      chip.querySelector('.chip-fill').style.width = `${needs[key]}%`;
      chip.classList.toggle('low', needs[key] < LOW);
    }
    for (const action in actionBtns) {
      const need = ACTION_NEED[action];
      actionBtns[action].classList.toggle('attention', !busy && needs[need] < LOW);
    }
  }

  function lowestNeed() {
    let minKey = null;
    let minVal = Infinity;
    for (const key in needs) {
      if (needs[key] < minVal) { minVal = needs[key]; minKey = key; }
    }
    return { key: minKey, val: minVal };
  }

  function evaluateMood() {
    if (busy) return;
    const { key, val } = lowestNeed();
    if (val < LOW) {
      if (!crying) {
        crying = true;
        baby.setAnim('cry');
        SFX.startCry();
      }
      showBubble(key);
    } else {
      if (crying) { crying = false; SFX.stopCry(); }
      if (baby.anim !== 'idle') baby.setAnim('idle');
      showBubble(null);
    }
    baby.setDiaperDirty(needs.diaper < LOW);
  }

  /* ================= お世話アクション ================= */

  function setButtonsEnabled(enabled) {
    for (const a in actionBtns) actionBtns[a].disabled = !enabled;
  }

  function schedule(events, total, onEnd) {
    events.forEach(([ms, fn]) => setTimeout(fn, ms));
    setTimeout(() => {
      busy = false;
      setButtonsEnabled(true);
      if (onEnd) onEnd();
      evaluateMood();
      updateNeedsUI();
    }, total);
  }

  function beginAction() {
    busy = true;
    crying = false;
    SFX.stopCry();
    SFX.tap();
    showBubble(null);
    setButtonsEnabled(false);
  }

  function babyCenter() {
    return baby.group.position.clone().add(new THREE.Vector3(0, 0.9, 0.2));
  }

  function reward() {
    baby.setAnim('happy');
    SFX.chime();
    heartBurst(babyCenter());
  }

  const ACTIONS = {
    feed() {
      beginAction();
      baby.setAnim('drink');
      baby.setMilkLevel(1);
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push([600 + i * 750, () => {
          SFX.gulp();
          baby.setMilkLevel(1 - (i + 1) * 0.19);
          needs.hunger = Math.min(100, needs.hunger + 7);
        }]);
      }
      events.push([4400, () => {
        SFX.burp();
        spawnParticle('star', babyCenter().add(new THREE.Vector3(0.3, 0.4, 0.2)), {
          vel: new THREE.Vector3(0.3, 1, 0), life: 1, size: 0.3,
        });
      }]);
      events.push([4700, () => { needs.hunger = 100; reward(); }]);
      schedule(events, 6100);
    },

    diaper() {
      beginAction();
      baby.setAnim('diaper');
      const hip = () => baby.group.position.clone().add(new THREE.Vector3(0, 0.4, 0.2));
      schedule([
        [700, () => {
          SFX.poof();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            spawnParticle('poof', hip(), {
              vel: new THREE.Vector3(Math.cos(a) * 0.7, 0.35 + Math.random() * 0.3, Math.sin(a) * 0.7),
              life: 0.9, size: 0.45, grow: 0.5,
            });
          }
        }],
        [1300, () => {
          baby.setDiaperDirty(false);
          needs.diaper = 100;
          SFX.sparkle();
          for (let i = 0; i < 6; i++) {
            spawnParticle('sparkle', hip(), {
              vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2),
              life: 1, size: 0.22, spin: 2,
            });
          }
        }],
        [2300, () => reward()],
      ], 3900);
    },

    sleep() {
      beginAction();
      baby.setAnim('sleep');
      SFX.startLullaby();
      nightTarget = 1;
      const events = [];
      for (let i = 0; i < 8; i++) {
        events.push([500 + i * 900, () => {
          spawnParticle('zzz', baby.getHeadTopWorld().add(new THREE.Vector3(0.25, 0.1, 0)), {
            vel: new THREE.Vector3(0.22, 0.5, 0), life: 1.8, size: 0.2, grow: 0.25,
          });
          needs.sleepy = Math.min(100, needs.sleepy + 9);
        }]);
      }
      events.push([8000, () => {
        SFX.stopLullaby();
        nightTarget = 0;
        needs.sleepy = 100;
        reward();
      }]);
      schedule(events, 9600);
    },

    play() {
      beginAction();
      baby.setAnim('play');
      const events = [];
      [800, 2400, 4000].forEach((ms) => events.push([ms, () => SFX.giggle()]));
      for (let i = 0; i < 7; i++) {
        events.push([500 + i * 650, () => {
          spawnParticle('note', babyCenter().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4, 0.2)), {
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1, 0), life: 1.4, size: 0.26,
          });
          needs.fun = Math.min(100, needs.fun + 6);
        }]);
      }
      events.push([4700, () => { needs.fun = 100; reward(); }]);
      schedule(events, 6100);
    },

    bath() {
      beginAction();
      baby.setAnim('bath');
      const events = [];
      [300, 1500, 2700].forEach((ms) => events.push([ms, () => SFX.shower()]));
      for (let i = 0; i < 16; i++) {
        events.push([300 + i * 260, () => {
          SFX.bubble();
          spawnParticle('bubble', babyCenter().add(new THREE.Vector3((Math.random() - 0.5) * 1.1, -0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8)), {
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.5, 0), life: 1.6, size: 0.16 + Math.random() * 0.18,
          });
          needs.clean = Math.min(100, needs.clean + 5);
        }]);
      }
      events.push([4600, () => {
        SFX.sparkle();
        needs.clean = 100;
        for (let i = 0; i < 6; i++) {
          spawnParticle('sparkle', babyCenter(), {
            vel: new THREE.Vector3((Math.random() - 0.5) * 1.4, 1 + Math.random() * 0.5, (Math.random() - 0.5) * 1.4),
            life: 1, size: 0.24, spin: 2,
          });
        }
      }]);
      events.push([5000, () => reward()]);
      schedule(events, 6400);
    },
  };

  function tickleBaby() {
    if (busy) return;
    busy = true;
    SFX.giggle();
    baby.setAnim('tickle');
    needs.fun = Math.min(100, needs.fun + 8);
    heartBurst(babyCenter(), 5);
    setTimeout(() => {
      busy = false;
      evaluateMood();
      updateNeedsUI();
    }, 1200);
  }

  /* ================= 昼夜（ねんね中は暗く） ================= */

  let nightTarget = 0;
  let nightMix = 0;

  function updateNight(dt) {
    const speed = 1.2;
    if (Math.abs(nightMix - nightTarget) > 0.001) {
      nightMix += Math.sign(nightTarget - nightMix) * Math.min(speed * dt, Math.abs(nightTarget - nightMix));
      world.setNight(nightMix);
      hemi.intensity = DAY_HEMI - nightMix * 0.28;
      sunLight.intensity = DAY_SUN - nightMix * 0.32;
    }
  }

  /* ================= カメラ演出 ================= */

  let camAnim = null;

  function animateCamera(toPos, toTarget, dur) {
    camAnim = {
      fromPos: camera.position.clone(),
      toPos, fromTarget: controls.target.clone(), toTarget,
      t: 0, dur,
    };
    controls.enabled = false;
  }

  function updateCameraAnim(dt) {
    if (!camAnim) return;
    camAnim.t += dt;
    const k = Math.min(1, camAnim.t / camAnim.dur);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, e);
    if (k >= 1) {
      camAnim = null;
      controls.enabled = true;
    }
  }

  const CLOSEUP_POS = new THREE.Vector3(0.55, 1.7, 3.6);
  const CLOSEUP_TARGET = new THREE.Vector3(0, 0.95, 0.5);

  /* ================= タップで赤ちゃんをこちょこちょ ================= */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downPos = null;
  let downTime = 0;

  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    downTime = performance.now();
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    const elapsed = performance.now() - downTime;
    downPos = null;
    if (moved > 12 || elapsed > 400) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(baby.group, true);
    if (hits.length > 0) tickleBaby();
  });

  /* ================= セーブ / ロード ================= */

  const SAVE_KEY = 'niji-baby-save-v1';

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        needs, muted: SFX.muted, time: Date.now(),
      }));
    } catch (e) { /* プライベートモード等では保存しない */ }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.needs) {
        const elapsed = Math.min(300, Math.max(0, (Date.now() - (data.time || 0)) / 1000));
        for (const key in needs) {
          if (typeof data.needs[key] === 'number') {
            needs[key] = Math.max(15, Math.min(100, data.needs[key] - DECAY[key] * elapsed));
          }
        }
      }
      if (data.muted) {
        SFX.setMuted(true);
        document.getElementById('btn-mute').textContent = '🔇';
      }
    } catch (e) { /* 壊れたセーブは無視 */ }
  }

  /* ================= UI イベント ================= */

  for (const action in actionBtns) {
    actionBtns[action].addEventListener('click', () => {
      if (busy) return;
      SFX.resume();
      ACTIONS[action]();
      updateNeedsUI();
    });
  }

  document.getElementById('btn-mute').addEventListener('click', (e) => {
    SFX.setMuted(!SFX.muted);
    e.currentTarget.textContent = SFX.muted ? '🔇' : '🔊';
    saveGame();
  });

  document.getElementById('btn-camera').addEventListener('click', () => {
    SFX.tap();
    animateCamera(CLOSEUP_POS.clone(), CLOSEUP_TARGET.clone(), 1.2);
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    SFX.init();
    SFX.startBgm();
    loadGame();
    updateNeedsUI();
    const overlay = document.getElementById('start-overlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.classList.add('hidden'), 800);
    document.getElementById('hud').classList.remove('hidden');
    // 外の景色（虹の家）から赤ちゃんへズームイン
    camera.position.set(11, 7, 15);
    controls.target.set(0, 1.5, 0);
    animateCamera(CLOSEUP_POS.clone(), CLOSEUP_TARGET.clone(), 3.2);
    started = true;
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) SFX.resume();
    else saveGame();
  });

  // iOS のダブルタップ拡大などを抑止
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  /* ================= メインループ ================= */

  let started = false;
  const clock = new THREE.Clock();
  let tearTimer = 0;
  let needsUiTimer = 0;
  let saveTimer = 0;
  const tmpVec = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    world.update(dt);
    baby.update(dt);
    updateParticles(dt);
    updateNight(dt);
    updateCameraAnim(dt);
    controls.update();

    if (started) {
      // ニーズの減少
      for (const key in needs) {
        needs[key] = Math.max(0, needs[key] - DECAY[key] * dt);
      }
      needsUiTimer += dt;
      if (needsUiTimer > 0.5) {
        needsUiTimer = 0;
        updateNeedsUI();
        evaluateMood();
      }
      saveTimer += dt;
      if (saveTimer > 6) { saveTimer = 0; saveGame(); }

      // 泣いているあいだの涙
      if (baby.anim === 'cry') {
        tearTimer += dt;
        if (tearTimer > 0.5) {
          tearTimer = 0;
          [-1, 1].forEach((side) => {
            spawnParticle('tear', baby.getEyeWorld(side, tmpVec), {
              vel: new THREE.Vector3(side * 0.35, -0.2, 0.2),
              gravity: 2.2, life: 0.8, size: 0.13,
            });
          });
        }
      }

      // ふきだしを頭の上にふわふわ
      if (bubbleSprite.visible) {
        baby.getHeadTopWorld(tmpVec);
        bubbleSprite.position.set(tmpVec.x + 0.6, tmpVec.y + 0.5 + Math.sin(t * 2.4) * 0.05, tmpVec.z);
      }
    }

    renderer.render(scene, camera);
  }

  updateNeedsUI();
  animate();
})();
