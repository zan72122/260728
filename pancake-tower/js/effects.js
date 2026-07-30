/* ============================================================
 * effects.js — パーティクル（きらきら・紙吹雪・しずく）と
 *              DOMを使った星/ハートの飛翔演出
 * ============================================================ */
(function () {
  const FX = {
    scene: null,
    camera: null,
    pool: [],       // スプライトパーティクル
    drips: [],      // しずく（3Dメッシュ）
    textures: {},
    dripGeo: null,
    dripMats: {},
  };
  PT.FX = FX;

  function heartTexture(color) {
    const c = PT.makeCanvas(64, 64), g = c.getContext('2d');
    g.fillStyle = color;
    g.translate(32, 30);
    g.beginPath();
    g.moveTo(0, 22);
    g.bezierCurveTo(-30, 0, -16, -22, 0, -8);
    g.bezierCurveTo(16, -22, 30, 0, 0, 22);
    g.fill();
    return PT.srgb(new THREE.CanvasTexture(c));
  }

  FX.init = function (scene, camera) {
    FX.scene = scene;
    FX.camera = camera;
    FX.textures = {
      sparkle: PT.starTexture('#fff59d'),
      sparklePink: PT.starTexture('#ff9ec4'),
      dotWhite: PT.dotTexture('rgba(255,255,255,1)', 'rgba(255,240,250,0.8)'),
      dotAmber: PT.dotTexture('rgba(255,190,80,1)', 'rgba(255,160,60,0.7)'),
      dotChoco: PT.dotTexture('rgba(120,72,40,1)', 'rgba(100,60,34,0.7)'),
      dotPink: PT.dotTexture('rgba(255,150,190,1)', 'rgba(255,190,220,0.7)'),
      heart: heartTexture('#ff7fa8'),
      confetti: PT.dotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,1)'),
    };
    // プール生成
    for (let i = 0; i < 180; i++) {
      const m = new THREE.SpriteMaterial({
        map: FX.textures.dotWhite, transparent: true, depthWrite: false,
      });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.userData = { life: 0 };
      scene.add(s);
      FX.pool.push(s);
    }
    // しずく
    FX.dripGeo = new THREE.SphereGeometry(0.11, 6, 5);
    FX.dripMats = {
      syrup: new THREE.MeshStandardMaterial({ color: 0xdd8a1f, roughness: 0.15, metalness: 0.1 }),
      choco: new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.3 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xfff6f9, roughness: 0.6 }),
    };
  };

  function grab() {
    for (let i = 0; i < FX.pool.length; i++) {
      if (!FX.pool[i].visible) return FX.pool[i];
    }
    return null;
  }

  // きらきら・紙吹雪など汎用スポーン
  FX.burst = function (pos, opt) {
    opt = opt || {};
    const n = opt.n || 8;
    for (let i = 0; i < n; i++) {
      const s = grab();
      if (!s) return;
      const u = s.userData;
      s.visible = true;
      s.position.copy(pos);
      s.position.x += PT.rand(-0.3, 0.3);
      s.position.y += PT.rand(-0.2, 0.3);
      s.position.z += PT.rand(-0.3, 0.3);
      s.material.map = opt.map || FX.textures.sparkle;
      s.material.color.set(opt.tint || 0xffffff);
      s.material.opacity = 1;
      s.material.rotation = PT.rand(0, 6.28);
      const sp = opt.speed || 3;
      u.vx = PT.rand(-sp, sp);
      u.vy = PT.rand(sp * 0.4, sp * 1.5);
      u.vz = PT.rand(-sp, sp);
      u.g = opt.gravity != null ? opt.gravity : 9;
      u.drag = opt.drag != null ? opt.drag : 0.5;
      u.spin = PT.rand(-4, 4);
      u.life = u.life0 = opt.life || PT.rand(0.5, 0.9);
      u.size0 = opt.size || PT.rand(0.25, 0.5);
      s.scale.setScalar(u.size0);
    }
  };

  // きらきら（トッピング時など）
  FX.sparkle = function (pos, n, pink) {
    FX.burst(pos, {
      n: n || 6,
      map: pink ? FX.textures.sparklePink : FX.textures.sparkle,
      speed: 2.2, gravity: 2.5, life: 0.7, size: 0.4,
    });
  };

  // 紙吹雪（お祝い）
  FX.confetti = function (center, n) {
    const cols = [0xff8fb3, 0xffd54f, 0x8ee6c9, 0x9fc9ff, 0xe6b3ff, 0xfff59d];
    for (let i = 0; i < (n || 50); i++) {
      const s = grab();
      if (!s) return;
      const u = s.userData;
      s.visible = true;
      s.position.set(center.x + PT.rand(-4, 4), center.y + PT.rand(1, 6), center.z + PT.rand(-4, 4));
      s.material.map = FX.textures.confetti;
      s.material.color.set(PT.pick(cols));
      s.material.opacity = 1;
      u.vx = PT.rand(-1.5, 1.5);
      u.vy = PT.rand(-0.5, 2.5);
      u.vz = PT.rand(-1.5, 1.5);
      u.g = 2.2;
      u.drag = 0.9;
      u.spin = PT.rand(-6, 6);
      u.life = u.life0 = PT.rand(1.6, 2.8);
      u.size0 = PT.rand(0.18, 0.3);
      s.scale.setScalar(u.size0);
    }
  };

  // ハートがぽわん
  FX.hearts = function (pos, n) {
    FX.burst(pos, {
      n: n || 4, map: FX.textures.heart, speed: 1.2, gravity: -1.5,
      drag: 0.8, life: 1.1, size: 0.45,
    });
  };

  // しずく（シロップ／チョコを注ぐとき）
  FX.drip = function (pos, kind, vel) {
    if (FX.drips.length > 60) return;
    const m = new THREE.Mesh(FX.dripGeo, FX.dripMats[kind] || FX.dripMats.syrup);
    m.position.copy(pos);
    m.scale.set(1, PT.rand(1.2, 1.9), 1);
    m.userData = {
      vx: (vel && vel.x || 0) + PT.rand(-0.4, 0.4),
      vy: (vel && vel.y || 0),
      vz: (vel && vel.z || 0) + PT.rand(-0.4, 0.4),
      kind,
    };
    FX.scene.add(m);
    FX.drips.push(m);
  };

  FX.update = function (dt) {
    // スプライト
    for (let i = 0; i < FX.pool.length; i++) {
      const s = FX.pool[i];
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      const dr = Math.pow(1 - u.drag * 0.5, dt * 10);
      u.vx *= dr; u.vz *= dr;
      u.vy -= u.g * dt;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      s.material.rotation += u.spin * dt;
      const t = u.life / u.life0;
      s.material.opacity = Math.min(1, t * 2.2);
      s.scale.setScalar(u.size0 * (0.5 + 0.5 * t));
      if (s.position.y < 0.05) { s.position.y = 0.05; u.vy = Math.abs(u.vy) * 0.3; }
    }
    // しずく
    for (let i = FX.drips.length - 1; i >= 0; i--) {
      const d = FX.drips[i];
      const u = d.userData;
      u.vy -= PT.G * dt;
      d.position.x += u.vx * dt;
      d.position.y += u.vy * dt;
      d.position.z += u.vz * dt;
      const gh = PT.Physics ? PT.Physics.groundHeight(d.position.x, d.position.z) : 0;
      if (d.position.y < gh + 0.06) {
        // ちいさな波紋きらり
        FX.burst(d.position, {
          n: 2, map: u.kind === 'choco' ? FX.textures.dotChoco : FX.textures.dotAmber,
          speed: 0.8, gravity: 3, life: 0.35, size: 0.2,
        });
        FX.scene.remove(d);
        FX.drips.splice(i, 1);
      }
    }
  };

  // ---- DOM演出: 星やハートがカウンターへ飛ぶ ----
  FX.flyIcon = function (worldPos, icon, toEl) {
    const layer = document.getElementById('fx-layer');
    if (!layer || !FX.camera) return;
    const v = worldPos.clone().project(FX.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'fly-icon';
    el.textContent = icon;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    let tx = x, ty = y - 90;
    if (toEl) {
      const r = toEl.getBoundingClientRect();
      tx = r.left + r.width / 2;
      ty = r.top + r.height / 2;
    }
    const anim = el.animate([
      { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0.5 },
      { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: 0.25 },
      { transform: `translate(calc(${tx - x}px - 50%), calc(${ty - y}px - 50%)) scale(${toEl ? 0.4 : 1})`, opacity: toEl ? 0.9 : 0 },
    ], { duration: 900, easing: 'cubic-bezier(.5,0,.6,1)' });
    anim.onfinish = () => el.remove();
  };
})();
