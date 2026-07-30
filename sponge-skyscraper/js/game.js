/* =========================================================
   スポンジ摩天楼 (Sponge Skyscraper)
   4さいむけ・さわって観察する 3D スポンジトイ

   設計の柱:
   - 水をかける→重く・やわらかく→ゆっくり沈む・かたむく→ぽよんと崩れる
   - 乾かす→軽く・元気に→ぷるんと立ち直る
   - 崩壊は罰ではなく「みんなおやすみ」のごほうびイベント
   - スローモーションで因果がずっと見えている
   ========================================================= */
(function () {
  'use strict';

  /* ================= 定数 ================= */
  var BW = 1.6, BH = 0.95;          // ブロック基本サイズ
  var GRAV = 7.5;                    // ゆめのなかの重力（スローモー）
  var GROUND_Y = 0;
  var MAX_CUSHION = 6;
  var STAR_GOAL = 7;                 // にじが完成するほし数

  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rand = function (a, b) { return a + Math.random() * (b - a); };

  /* ================= キャンバス製テクスチャ ================= */
  var TEX = (function () {
    var cache = {};

    function cv(w, h) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    function toTex(c) {
      var t = new THREE.CanvasTexture(c);
      t.anisotropy = 2;
      return t;
    }

    /* スポンジの穴もよう（白ベース、色はマテリアルで乗算） */
    function sponge() {
      if (cache.sponge) return cache.sponge;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 46; i++) {
        var r = rand(4, 13);
        x.beginPath();
        x.ellipse(rand(0, 256), rand(0, 256), r, r * rand(0.6, 1), rand(0, 3), 0, 7);
        x.fillStyle = 'rgba(90,60,70,' + rand(0.05, 0.13).toFixed(2) + ')';
        x.fill();
      }
      for (i = 0; i < 18; i++) {
        x.beginPath();
        x.arc(rand(0, 256), rand(0, 256), rand(2, 5), 0, 7);
        x.fillStyle = 'rgba(255,255,255,0.35)';
        x.fill();
      }
      cache.sponge = toTex(c);
      return cache.sponge;
    }

    /* おかお  style:0..2  expr: normal|blink|joy|squish|sleep|wow */
    function face(style, expr) {
      var key = 'f' + style + expr;
      if (cache[key]) return cache[key];
      var c = cv(256, 256), x = c.getContext('2d');
      x.clearRect(0, 0, 256, 256);
      // ほっぺ
      x.fillStyle = 'rgba(255,120,150,0.45)';
      x.beginPath(); x.arc(58, 152, 26, 0, 7); x.fill();
      x.beginPath(); x.arc(198, 152, 26, 0, 7); x.fill();

      var ey = 108, exL = 88, exR = 168;
      x.strokeStyle = '#5a3a44'; x.fillStyle = '#5a3a44';
      x.lineWidth = 10; x.lineCap = 'round';

      function dotEye(px) {
        var r = style === 1 ? 19 : 15;
        x.beginPath();
        if (style === 2) { x.ellipse(px, ey, r * 0.75, r * 1.15, 0, 0, 7); }
        else { x.arc(px, ey, r, 0, 7); }
        x.fill();
        x.fillStyle = '#ffffff';
        x.beginPath(); x.arc(px + r * 0.35, ey - r * 0.35, r * 0.32, 0, 7); x.fill();
        x.fillStyle = '#5a3a44';
      }
      function arcEye(px, up) {
        x.beginPath();
        x.arc(px, ey + (up ? 8 : -2), 16, up ? Math.PI : 0.15 * Math.PI, up ? 2 * Math.PI : 0.85 * Math.PI);
        x.stroke();
      }
      function crossEye(px) { // ><
        var s = px < 128 ? 1 : -1;
        x.beginPath();
        x.moveTo(px - 12 * s, ey - 12); x.lineTo(px + 10 * s, ey);
        x.lineTo(px - 12 * s, ey + 12);
        x.stroke();
      }
      function ringEye(px) {
        x.lineWidth = 9;
        x.beginPath(); x.arc(px, ey, 14, 0, 7); x.stroke();
        x.lineWidth = 10;
      }

      if (expr === 'normal') { dotEye(exL); dotEye(exR); }
      else if (expr === 'blink' || expr === 'sleep') { arcEye(exL, false); arcEye(exR, false); }
      else if (expr === 'joy') { arcEye(exL, true); arcEye(exR, true); }
      else if (expr === 'squish') { crossEye(exL); crossEye(exR); }
      else if (expr === 'wow') { ringEye(exL); ringEye(exR); }

      // くち
      var my = 168;
      if (expr === 'joy' || expr === 'wow') {
        x.fillStyle = '#a8515f';
        x.beginPath();
        x.ellipse(128, my + 4, expr === 'wow' ? 12 : 20, expr === 'wow' ? 15 : 17, 0, 0, 7);
        x.fill();
        x.fillStyle = '#ff8fa0';
        x.beginPath(); x.ellipse(128, my + 12, expr === 'wow' ? 7 : 12, 8, 0, 0, 7); x.fill();
      } else if (expr === 'squish') {
        x.beginPath();
        x.moveTo(104, my);
        x.quadraticCurveTo(116, my - 12, 128, my);
        x.quadraticCurveTo(140, my + 12, 152, my);
        x.stroke();
      } else if (expr === 'sleep') {
        x.lineWidth = 8;
        x.beginPath(); x.arc(128, my, 9, 0, 7); x.stroke();
        // ねいき（あわ）
        x.strokeStyle = 'rgba(150,200,255,0.9)';
        x.beginPath(); x.arc(190, 78, 12, 0, 7); x.stroke();
        x.beginPath(); x.arc(212, 52, 7, 0, 7); x.stroke();
      } else {
        x.beginPath();
        x.arc(128, my - 6, 16, 0.2 * Math.PI, 0.8 * Math.PI);
        x.stroke();
      }
      cache[key] = toTex(c);
      return cache[key];
    }

    /* まるい粒（色つき） */
    function dot(color, soft) {
      var key = 'd' + color + (soft ? 's' : '');
      if (cache[key]) return cache[key];
      var c = cv(64, 64), x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, color);
      g.addColorStop(soft ? 0.4 : 0.8, color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      cache[key] = toTex(c);
      return cache[key];
    }

    /* キラキラ星 */
    function sparkle(color) {
      var key = 'sp' + color;
      if (cache[key]) return cache[key];
      var c = cv(64, 64), x = c.getContext('2d');
      x.translate(32, 32);
      x.fillStyle = color;
      x.beginPath();
      for (var i = 0; i < 8; i++) {
        var r = i % 2 === 0 ? 28 : 7;
        var a = i * Math.PI / 4;
        x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath(); x.fill();
      cache[key] = toTex(c);
      return cache[key];
    }

    /* ハート */
    function heart(color) {
      var key = 'h' + color;
      if (cache[key]) return cache[key];
      var c = cv(64, 64), x = c.getContext('2d');
      x.fillStyle = color;
      x.beginPath();
      x.moveTo(32, 56);
      x.bezierCurveTo(2, 34, 8, 6, 32, 20);
      x.bezierCurveTo(56, 6, 62, 34, 32, 56);
      x.fill();
      cache[key] = toTex(c);
      return cache[key];
    }

    /* くも */
    function cloud() {
      if (cache.cloud) return cache.cloud;
      var c = cv(256, 128), x = c.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,0.95)';
      var puffs = [[60, 84, 34], [110, 66, 44], [170, 74, 38], [210, 90, 26], [130, 92, 40]];
      puffs.forEach(function (p) {
        x.beginPath(); x.arc(p[0], p[1], p[2], 0, 7); x.fill();
      });
      cache.cloud = toTex(c);
      return cache.cloud;
    }

    /* おひさま */
    function sun() {
      if (cache.sun) return cache.sun;
      var c = cv(128, 128), x = c.getContext('2d');
      x.translate(64, 64);
      x.strokeStyle = '#ffb347'; x.lineWidth = 7; x.lineCap = 'round';
      for (var i = 0; i < 10; i++) {
        var a = i * Math.PI / 5;
        x.beginPath();
        x.moveTo(Math.cos(a) * 40, Math.sin(a) * 40);
        x.lineTo(Math.cos(a) * 56, Math.sin(a) * 56);
        x.stroke();
      }
      var g = x.createRadialGradient(0, 0, 5, 0, 0, 36);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(1, '#ffc95e');
      x.fillStyle = g;
      x.beginPath(); x.arc(0, 0, 34, 0, 7); x.fill();
      x.fillStyle = '#e8925a';
      x.beginPath(); x.arc(-11, -4, 4, 0, 7); x.fill();
      x.beginPath(); x.arc(11, -4, 4, 0, 7); x.fill();
      x.strokeStyle = '#e8925a'; x.lineWidth = 4;
      x.beginPath(); x.arc(0, 6, 9, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
      cache.sun = toTex(c);
      return cache.sun;
    }

    /* かぜのすじ */
    function streak() {
      if (cache.streak) return cache.streak;
      var c = cv(128, 32), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(64, 16, 62, 7, 0, 0, 7);
      x.fill();
      cache.streak = toTex(c);
      return cache.streak;
    }

    /* みずたまり */
    function puddle() {
      if (cache.puddle) return cache.puddle;
      var c = cv(128, 128), x = c.getContext('2d');
      var g = x.createRadialGradient(64, 64, 8, 64, 64, 60);
      g.addColorStop(0, 'rgba(140,205,255,0.75)');
      g.addColorStop(0.8, 'rgba(140,205,255,0.5)');
      g.addColorStop(1, 'rgba(140,205,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(64, 64, 58, 50, 0.3, 0, 7);
      x.fill();
      cache.puddle = toTex(c);
      return cache.puddle;
    }

    /* じめん（パステルのまる舞台つき） */
    function ground() {
      if (cache.ground) return cache.ground;
      var c = cv(1024, 1024), x = c.getContext('2d');
      var g = x.createRadialGradient(512, 512, 60, 512, 512, 512);
      g.addColorStop(0, '#ffeef6');
      g.addColorStop(0.35, '#ffe3ef');
      g.addColorStop(0.7, '#ffdcd2');
      g.addColorStop(1, '#ffd9c9');
      x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
      // まる舞台
      x.fillStyle = '#ffc9dd';
      x.beginPath(); x.arc(512, 512, 128, 0, 7); x.fill();
      x.strokeStyle = '#ffb1cf'; x.lineWidth = 10;
      x.beginPath(); x.arc(512, 512, 128, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 6;
      x.beginPath(); x.arc(512, 512, 112, 0, 7); x.stroke();
      // みずたまドット
      for (var i = 0; i < 90; i++) {
        var a = rand(0, Math.PI * 2), r = rand(150, 500);
        var px = 512 + Math.cos(a) * r, py = 512 + Math.sin(a) * r;
        x.fillStyle = ['rgba(255,255,255,0.5)', 'rgba(255,170,200,0.35)', 'rgba(170,220,255,0.3)', 'rgba(255,230,150,0.35)'][i % 4];
        x.beginPath(); x.arc(px, py, rand(4, 14), 0, 7); x.fill();
      }
      cache.ground = toTex(c);
      return cache.ground;
    }

    /* そら（グラデーション球用） */
    function sky() {
      if (cache.sky) return cache.sky;
      var c = cv(16, 256), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#ffd0e8');
      g.addColorStop(0.45, '#ffe9f0');
      g.addColorStop(0.75, '#fff5e4');
      g.addColorStop(1, '#ffe9d8');
      x.fillStyle = g; x.fillRect(0, 0, 16, 256);
      cache.sky = toTex(c);
      return cache.sky;
    }

    return { sponge: sponge, face: face, dot: dot, sparkle: sparkle, heart: heart, cloud: cloud, sun: sun, streak: streak, puddle: puddle, ground: ground, sky: sky };
  })();

  /* ================= シーン ================= */
  var canvas = document.getElementById('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffe9dd, 38, 95);

  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  var cam = { theta: 0.5, phi: 1.12, radius: 15, targetY: 3.2, autoT: 0 };

  // そら
  var skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(140, 24, 16),
    new THREE.MeshBasicMaterial({ map: TEX.sky(), side: THREE.BackSide, fog: false })
  );
  scene.add(skyMesh);

  // ひかり
  scene.add(new THREE.HemisphereLight(0xfff1f6, 0xffd9c0, 0.62));
  var sunLight = new THREE.DirectionalLight(0xfff2e0, 0.75);
  sunLight.position.set(7, 16, 6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -13; sunLight.shadow.camera.right = 13;
  sunLight.shadow.camera.top = 16; sunLight.shadow.camera.bottom = -13;
  sunLight.shadow.camera.far = 50;
  scene.add(sunLight);

  // じめん
  var groundMesh = new THREE.Mesh(
    new THREE.CircleGeometry(70, 48),
    new THREE.MeshStandardMaterial({ map: TEX.ground(), roughness: 1 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // くも
  var clouds = [];
  (function () {
    for (var i = 0; i < 7; i++) {
      var m = new THREE.SpriteMaterial({ map: TEX.cloud(), transparent: true, opacity: rand(0.7, 0.95), fog: false });
      var s = new THREE.Sprite(m);
      var a = rand(0, Math.PI * 2), r = rand(38, 70);
      s.position.set(Math.cos(a) * r, rand(9, 24), Math.sin(a) * r);
      var sc = rand(7, 13);
      s.scale.set(sc, sc * 0.5, 1);
      s.userData.speed = rand(0.15, 0.5);
      scene.add(s);
      clouds.push(s);
    }
  })();

  /* ================= パーティクル ================= */
  var particles = [];
  var particlePool = [];

  function spawnP(tex, opt) {
    var p = particlePool.pop();
    if (!p) {
      p = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      scene.add(p);
    }
    p.material.map = tex;
    p.material.opacity = opt.opacity !== undefined ? opt.opacity : 1;
    p.material.color.set(opt.color || '#ffffff');
    p.material.rotation = opt.rot || 0;
    p.position.copy(opt.pos);
    p.visible = true;
    p.userData = {
      vel: opt.vel || new THREE.Vector3(),
      grav: opt.grav !== undefined ? opt.grav : 0,
      life: opt.life || 1,
      age: 0,
      size0: opt.size || 0.4,
      size1: opt.size1 !== undefined ? opt.size1 : (opt.size || 0.4),
      spin: opt.spin || 0,
      fade: opt.fade !== undefined ? opt.fade : true,
      stretch: opt.stretch || 1
    };
    p.scale.set(p.userData.size0 * p.userData.stretch, p.userData.size0, 1);
    particles.push(p);
    return p;
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i], u = p.userData;
      u.age += dt;
      if (u.age >= u.life) {
        p.visible = false;
        particles.splice(i, 1);
        particlePool.push(p);
        continue;
      }
      u.vel.y -= u.grav * dt;
      p.position.addScaledVector(u.vel, dt);
      var t = u.age / u.life;
      var s = lerp(u.size0, u.size1, t);
      p.scale.set(s * u.stretch, s, 1);
      if (u.fade) p.material.opacity = (1 - t) * (u.opacity0 || 1);
      if (u.spin) p.material.rotation += u.spin * dt;
    }
  }

  function burstSparkles(pos, n, colors) {
    colors = colors || ['#fff6a8', '#ffd1ea', '#c3ecff', '#d8ffd1'];
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2);
      spawnP(TEX.sparkle(colors[i % colors.length]), {
        pos: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3))),
        vel: new THREE.Vector3(Math.cos(a) * rand(0.5, 2.2), rand(1, 3), Math.sin(a) * rand(0.5, 2.2)),
        grav: 2.5, life: rand(0.6, 1.2), size: rand(0.25, 0.55), size1: 0.05, spin: rand(-3, 3)
      });
    }
  }

  function confettiRain(center, n) {
    var cols = ['#ff8fb7', '#ffd166', '#8ce99a', '#74c0fc', '#b197fc', '#ffa8a8', '#66d9e8'];
    for (var i = 0; i < n; i++) {
      spawnP(TEX.dot(cols[i % cols.length], false), {
        pos: new THREE.Vector3(center.x + rand(-6, 6), rand(9, 14), center.z + rand(-6, 6)),
        vel: new THREE.Vector3(rand(-0.6, 0.6), rand(-1.5, -0.5), rand(-0.6, 0.6)),
        grav: 0.6, life: rand(2.5, 4.5), size: rand(0.18, 0.36), size1: 0.14,
        spin: rand(-4, 4), color: cols[i % cols.length]
      });
    }
  }

  /* ================= ブロック ================= */
  var geoCache = {};
  function roundedBoxGeo(w, h, d, r) {
    var key = [w, h, d, r].join('_');
    if (geoCache[key]) return geoCache[key];
    var w2 = w - 2 * r, h2 = h - 2 * r;
    var shape = new THREE.Shape();
    shape.moveTo(-w2 / 2, -h2 / 2);
    shape.lineTo(w2 / 2, -h2 / 2);
    shape.lineTo(w2 / 2, h2 / 2);
    shape.lineTo(-w2 / 2, h2 / 2);
    shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r,
      bevelSegments: 3, curveSegments: 4
    });
    geo.translate(0, 0, -(d - 2 * r) / 2);
    geoCache[key] = geo;
    return geo;
  }

  function heartGeo(size) {
    if (geoCache.heart) return geoCache.heart;
    var s = new THREE.Shape();
    var k = size / 30;
    s.moveTo(0 * k, -12 * k);
    s.bezierCurveTo(-18 * k, 2 * k, -14 * k, 18 * k, 0 * k, 8 * k);
    s.bezierCurveTo(14 * k, 18 * k, 18 * k, 2 * k, 0 * k, -12 * k);
    var geo = new THREE.ExtrudeGeometry(s, {
      depth: size * 0.4, bevelEnabled: true, bevelThickness: size * 0.12,
      bevelSize: size * 0.1, bevelSegments: 3, curveSegments: 10
    });
    geo.translate(0, size * 0.05, -size * 0.2);
    geo.rotateX(Math.PI);
    geo.rotateZ(Math.PI);
    geoCache.heart = geo;
    return geo;
  }

  function coneGeo(rad, h) {
    var key = 'cone' + rad + '_' + h;
    if (geoCache[key]) return geoCache[key];
    geoCache[key] = new THREE.ConeGeometry(rad, h, 20);
    return geoCache[key];
  }

  var blockId = 0;
  function makeBlock(opt) {
    // opt: {w,h,d,color,shape,face}
    var b = {
      id: blockId++,
      w: opt.w || BW, h: opt.h || BH, d: opt.d || BW,
      baseColor: new THREE.Color(opt.color),
      shape: opt.shape || 'box',
      wet: 0, wetDir: new THREE.Vector2(),
      squash: 1, squashV: 0,
      shear: new THREE.Vector2(), shearV: new THREE.Vector2(),
      state: 'attached',  // attached | free | asleep | returning
      vel: new THREE.Vector3(), angV: new THREE.Vector3(),
      baseMass: (opt.w || BW) * (opt.h || BH) * (opt.d || BW) / (BW * BH * BW),
      faceStyle: Math.random() * 3 | 0,
      expr: '', blinkT: rand(1, 5),
      wobble: rand(0.85, 1.2),       // 個体差：くずれやすさが毎回すこし違う
      settleT: 0, dirty: true
    };
    var geo;
    if (b.shape === 'roof') geo = coneGeo(b.w * 0.62, b.h);
    else if (b.shape === 'heart') geo = heartGeo(b.w * 0.85);
    else geo = roundedBoxGeo(b.w, b.h, b.d, Math.min(b.w, b.h) * 0.16);

    b.mat = new THREE.MeshStandardMaterial({
      map: b.shape === 'box' ? TEX.sponge() : null,
      color: b.baseColor.clone(), roughness: 0.92, metalness: 0
    });
    b.mesh = new THREE.Mesh(geo, b.mat);
    b.mesh.castShadow = true;
    b.mesh.receiveShadow = true;
    scene.add(b.mesh);

    if (opt.face !== false && b.shape === 'box') {
      var fm = new THREE.MeshBasicMaterial({
        map: TEX.face(b.faceStyle, 'normal'), transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
      });
      b.facePlane = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.72, b.h * 0.82), fm);
      b.facePlane.position.z = b.d / 2 + 0.015;
      b.mesh.add(b.facePlane);
    }
    return b;
  }

  function setExpr(b, expr) {
    if (!b.facePlane || b.expr === expr) return;
    b.expr = expr;
    b.facePlane.material.map = TEX.face(b.faceStyle, expr);
  }

  function blockMass(b) { return b.baseMass * (1 + 2.2 * b.wet); }

  function refreshWetLook(b) {
    if (!b.dirty) return;
    b.dirty = false;
    var c = b.baseColor.clone();
    var deep = b.baseColor.clone().multiplyScalar(0.52).lerp(new THREE.Color('#3a5f8a'), 0.18);
    c.lerp(deep, b.wet * 0.75);
    b.mat.color.copy(c);
    b.mat.roughness = 0.92 - 0.55 * b.wet;
  }

  /* ================= 塔の定義 ================= */
  var PASTELS = ['#ff9db1', '#ffbe8f', '#ffe38f', '#a6e6a1', '#8fd0ff', '#b9a8ff', '#ff9de5'];
  var PINKS = ['#ffc2d4', '#ffaec9', '#ff98bd', '#ff82b0', '#ff6ba3', '#ff5f9b'];

  function shuffleHue(hex, amt) {
    var c = new THREE.Color(hex);
    var hsl = {};
    c.getHSL(hsl);
    c.setHSL((hsl.h + rand(-amt, amt) + 1) % 1, clamp(hsl.s + rand(-0.05, 0.08), 0, 1), clamp(hsl.l + rand(-0.04, 0.04), 0.3, 0.85));
    return c;
  }

  var TOWERS = [
    {
      id: 'rainbow', icon: '🌈', label: 'にじタワー',
      build: function () {
        var col = { base: new THREE.Vector2(0, 0), blocks: [] };
        for (var i = 0; i < 8; i++) {
          col.blocks.push(makeBlock({ color: shuffleHue(PASTELS[i % 7], 0.02) }));
        }
        return [col];
      }
    },
    {
      id: 'castle', icon: '🏰', label: 'おしろ',
      build: function () {
        var cols = [];
        var main = { base: new THREE.Vector2(0, 0), blocks: [] };
        for (var i = 0; i < 6; i++) main.blocks.push(makeBlock({ color: shuffleHue(i % 2 ? '#ffd9e8' : '#ffeef3', 0.015) }));
        main.blocks.push(makeBlock({ color: '#c7b4ff', shape: 'roof', h: BH * 1.4, face: false }));
        cols.push(main);
        [-1, 1].forEach(function (s) {
          var c2 = { base: new THREE.Vector2(s * 2.6, 0.3), blocks: [] };
          for (var j = 0; j < 4; j++) c2.blocks.push(makeBlock({ w: BW * 0.8, d: BW * 0.8, color: shuffleHue(j % 2 ? '#ffe0ec' : '#fff2f6', 0.015) }));
          c2.blocks.push(makeBlock({ w: BW * 0.8, d: BW * 0.8, color: '#a5d8ff', shape: 'roof', h: BH * 1.2, face: false }));
          cols.push(c2);
        });
        return cols;
      }
    },
    {
      id: 'stairs', icon: '🪜', label: 'かいだん',
      build: function () {
        var cols = [];
        var heights = [3, 5, 8];
        var xs = [-2.6, 0, 2.6];
        var pal = ['#a6e6a1', '#8fd0ff', '#b9a8ff', '#ffe38f'];
        for (var c = 0; c < 3; c++) {
          var col = { base: new THREE.Vector2(xs[c], 0), blocks: [] };
          for (var i = 0; i < heights[c]; i++) col.blocks.push(makeBlock({ color: shuffleHue(pal[(i + c) % 4], 0.02) }));
          cols.push(col);
        }
        return cols;
      }
    },
    {
      id: 'pudding', icon: '🍮', label: 'ぷりん',
      build: function () {
        var col = { base: new THREE.Vector2(0, 0), blocks: [] };
        var sizes = [2.2, 1.9, 1.6, 1.3, 1.0, 0.8];
        var colors = ['#ffe9b3', '#ffe2a1', '#ffd98c', '#ffcf78', '#c98850', '#b06f3a'];
        for (var i = 0; i < 6; i++) {
          col.blocks.push(makeBlock({ w: BW * sizes[i], d: BW * sizes[i], h: BH * 1.05, color: shuffleHue(colors[i], 0.012) }));
        }
        col.blocks.push(makeBlock({ w: BW * 0.55, d: BW * 0.55, h: BH * 0.6, color: '#fff7f0', face: false }));
        return [col];
      }
    },
    {
      id: 'heart', icon: '💖', label: 'はーと',
      build: function () {
        var col = { base: new THREE.Vector2(0, 0), blocks: [] };
        for (var i = 0; i < 7; i++) col.blocks.push(makeBlock({ color: shuffleHue(PINKS[i % 6], 0.015) }));
        col.blocks.push(makeBlock({ color: '#ff4f93', shape: 'heart', w: BW * 1.15, h: BH * 1.5, face: false }));
        return [col];
      }
    },
    {
      id: 'random', icon: '🎲', label: 'びっくり',
      build: function () {
        var cols = [];
        var n = 1 + (Math.random() * 3 | 0);
        var xs = n === 1 ? [0] : (n === 2 ? [-1.8, 1.8] : [-2.8, 0, 2.8]);
        for (var c = 0; c < n; c++) {
          var col = { base: new THREE.Vector2(xs[c], rand(-0.5, 0.5)), blocks: [] };
          var hnum = 3 + (Math.random() * 6 | 0);
          for (var i = 0; i < hnum; i++) {
            var s = rand(0.75, 1.5);
            col.blocks.push(makeBlock({
              w: BW * s, d: BW * s, h: BH * rand(0.8, 1.3),
              color: shuffleHue(PASTELS[Math.random() * 7 | 0], 0.06)
            }));
          }
          if (Math.random() < 0.4) col.blocks.push(makeBlock({ color: shuffleHue('#c7b4ff', 0.1), shape: 'roof', h: BH * 1.3, face: false }));
          cols.push(col);
        }
        return cols;
      }
    }
  ];

  /* =========================================================
     いっぱいスポンジ（ボクセル）エンジン
     - 数千個の小スポンジを InstancedMesh 1つで描画
     - 縦の「柱」に分解して、しずみ(squash)・かたむき(shear)を柱単位で計算
     - 柱同士は となり拡散で つながって ゆれる
     - 接地していない柱（アーチのてっぺん等）は ささえ判定で 連鎖崩壊
     ========================================================= */

  /* --- 端末性能の自動判定（CPUベンチ + URL ?tier= 上書き） --- */
  var VOXTIER = (function () {
    var q = /[?&]tier=(high|mid|low)/.exec(location.search);
    if (q) return q[1];
    var m = new THREE.Matrix4(), p = new THREE.Vector3(), qt = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    var t0 = performance.now(), n = 0;
    do {
      for (var i = 0; i < 1000; i++) { p.set(i, i * 2, i * 3); s.set(1, 1 + i % 3, 1); m.compose(p, qt, s); }
      n += 1000;
    } while (performance.now() - t0 < 20);
    var ops = n / Math.max(performance.now() - t0, 1);
    if (ops > 20000) return 'high';
    if (ops > 8000) return 'mid';
    return 'low';
  })();
  var VOXCONF = {
    high: { res: 1.15, cap: 3000, shadow: true },
    mid: { res: 0.95, cap: 1700, shadow: true },
    low: { res: 0.7, cap: 850, shadow: false }
  }[VOXTIER];
  var perfScale = 1;          // 実行中fpsが落ちたら 0.4 に（粒子減量）

  /* --- ボクセルアート生成ヘルパ --- */
  /* 2D シルエット test(u,v) を壁として立てる  u:-1..1(横) v:-1..1(縦) */
  function genWall(W, H, D, test, colorOf) {
    var cells = [];
    for (var iy = 0; iy < H; iy++) {
      for (var ix = 0; ix < W; ix++) {
        var u = (ix + 0.5) / W * 2 - 1;
        var v = (iy + 0.5) / H * 2 - 1;
        if (!test(u, v)) continue;
        for (var iz = 0; iz < D; iz++) cells.push({ ix: ix, iy: iy, iz: iz, c: colorOf(u, v, iz, D) });
      }
    }
    return cells;
  }

  function heartTest(u, v) {
    var x = u * 1.25, y = v * 1.3 + 0.12;
    var a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y < 0;
  }
  function starTest(u, v) {
    var r = Math.sqrt(u * u + v * v);
    if (r < 0.001) return true;
    var th = Math.atan2(v, u) - Math.PI / 2;
    var seg = Math.PI * 2 / 5;
    var a = ((th % seg) + seg) % seg;
    var t = Math.abs(a - seg / 2) / (seg / 2); // 0=山のあいだ 1=山のさき
    var rmax = lerp(0.44, 1.0, t * t);
    return r < rmax;
  }
  function ellipse(u, v, cx, cy, rx, ry, rot) {
    var dx = u - cx, dy = v - cy;
    if (rot) {
      var c = Math.cos(rot), s = Math.sin(rot);
      var tx = dx * c + dy * s; dy = -dx * s + dy * c; dx = tx;
    }
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1;
  }

  var VOXTOWERS = [
    {
      id: 'vheart', icon: '💖', label: 'はーと', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        return genWall(W, H, D, heartTest, function (u, v, iz) {
          var r = Math.sqrt(u * u + v * v);
          if (iz === 0 && Math.random() < 0.06) return '#ffffff';
          return ['#ff5f9b', '#ff77a9', '#ff98bd', '#ffb7cf'][Math.min(3, Math.floor((1 - r) * 4.2))];
        });
      }, dims: [27, 24, 4]
    },
    {
      id: 'vstar', icon: '⭐', label: 'おほしさま', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        return genWall(W, H, D, starTest, function (u, v, iz) {
          var r = Math.sqrt(u * u + v * v);
          if (r < 0.3) return '#fff6c9';
          return ['#ffe38f', '#ffd86b', '#ffc94d', '#ffba36'][Math.floor(Math.min(0.99, r) * 4)];
        });
      }, dims: [30, 28, 4]
    },
    {
      id: 'vrainbow', icon: '🌈', label: 'にじのはし', kind: 'voxel', baseCell: 0.55,
      gen: function (W, H, D) {
        var cells = [];
        var R = W / 2;
        var BANDS = ['#ff8f8f', '#ffbe8f', '#ffe38f', '#a6e6a1', '#8fd0ff', '#b9a8ff'];
        var thick = Math.max(0.9, R / 11);
        for (var iy = 0; iy < H; iy++) {
          for (var ix = 0; ix < W; ix++) {
            var x = ix - (W - 1) / 2, y = iy;
            var r = Math.sqrt(x * x + y * y);
            var bi = Math.floor((R - r) / thick);
            if (r > R || bi < 0 || bi >= 6) continue;
            for (var iz = 0; iz < D; iz++) cells.push({ ix: ix, iy: iy, iz: iz, c: BANDS[bi] });
          }
        }
        // 足もとの くも
        var feet = [[2, '#ffffff'], [W - 3, '#fff6f9']];
        for (var f = 0; f < 2; f++) {
          for (var iy2 = 0; iy2 < 3; iy2++) for (var dx = -2; dx <= 2; dx++) for (var iz2 = -1; iz2 <= D; iz2++) {
            if (Math.abs(dx) + iy2 > 3 || Math.random() < 0.15) continue;
            cells.push({ ix: feet[f][0] + dx, iy: iy2, iz: iz2 < 0 ? 0 : Math.min(iz2, D - 1), c: feet[f][1] });
          }
        }
        return cells;
      }, dims: [30, 16, 4]
    },
    {
      id: 'vflower', icon: '🌸', label: 'おおきなおはな', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        return genWall(W, H, D, function (u, v) {
          var cy = 0.42;
          if (ellipse(u, v, 0, cy, 0.24, 0.22)) return true;            // まんなか
          for (var k = 0; k < 8; k++) {
            var a = k * Math.PI / 4;
            if (ellipse(u, v, Math.cos(a) * 0.5, cy + Math.sin(a) * 0.46, 0.3, 0.26, a)) return true;
          }
          if (Math.abs(u) < 0.07 && v < cy - 0.5 && v > -1) return true; // くき
          if (ellipse(u, v, 0.3, -0.55, 0.24, 0.12, 0.6)) return true;   // はっぱ
          if (ellipse(u, v, -0.3, -0.75, 0.24, 0.12, -0.6)) return true;
          return false;
        }, function (u, v, iz) {
          var cy = 0.42;
          if (ellipse(u, v, 0, cy, 0.24, 0.22)) return Math.random() < 0.25 ? '#ffb347' : '#ffd86b';
          if (Math.abs(u) < 0.08 && v < cy - 0.4) return '#8fce7f';
          if (v < -0.4 && Math.abs(u) > 0.1) return '#a6e6a1';
          var d = Math.sqrt(u * u + (v - cy) * (v - cy));
          return d < 0.55 ? '#ff98bd' : (d < 0.8 ? '#ffb7cf' : '#ffd3e2');
        });
      }, dims: [26, 29, 4]
    },
    {
      id: 'vbutterfly', icon: '🦋', label: 'ちょうちょ', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        return genWall(W, H, D, function (u, v) {
          if (ellipse(u, v, 0, 0, 0.1, 0.42)) return true;                       // からだ
          if (ellipse(u, v, 0.46, 0.3, 0.4, 0.34, 0.35)) return true;            // うわばね
          if (ellipse(u, v, -0.46, 0.3, 0.4, 0.34, -0.35)) return true;
          if (ellipse(u, v, 0.34, -0.38, 0.3, 0.26, -0.4)) return true;          // したばね
          if (ellipse(u, v, -0.34, -0.38, 0.3, 0.26, 0.4)) return true;
          if (Math.abs(Math.abs(u) - 0.16) < 0.045 && v > 0.42 && v < 0.75) return true; // しょっかく
          return false;
        }, function (u, v, iz) {
          if (Math.abs(u) < 0.12) return '#b98a68';
          var au = Math.abs(u);
          if (ellipse(u, v, u > 0 ? 0.46 : -0.46, 0.3, 0.16, 0.13, 0)) return '#fff6c9'; // もよう
          if (ellipse(u, v, u > 0 ? 0.34 : -0.34, -0.38, 0.1, 0.08, 0)) return '#ffffff';
          if (v > 0) return au > 0.62 ? '#b9a8ff' : '#8fd0ff';
          return au > 0.45 ? '#ff98bd' : '#ffbe8f';
        });
      }, dims: [30, 22, 4]
    },
    {
      id: 'vrabbit', icon: '🐰', label: 'うさぎ', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        return genWall(W, H, D, function (u, v) {
          if (ellipse(u, v, 0, -0.35, 0.62, 0.55)) return true;                  // かお
          if (ellipse(u, v, 0.3, 0.5, 0.17, 0.5)) return true;                   // みみ
          if (ellipse(u, v, -0.3, 0.5, 0.17, 0.5)) return true;
          return false;
        }, function (u, v, iz, D2) {
          if (iz === 0 || iz === D2 - 1) {
            if (ellipse(u, v, 0.3, 0.52, 0.08, 0.34)) return '#ffb7cf';           // みみのうち
            if (ellipse(u, v, -0.3, 0.52, 0.08, 0.34)) return '#ffb7cf';
            if (ellipse(u, v, 0.3, -0.42, 0.1, 0.09)) return '#ff98bd';           // ほっぺ
            if (ellipse(u, v, -0.3, -0.42, 0.1, 0.09)) return '#ff98bd';
            if (ellipse(u, v, 0, -0.5, 0.06, 0.05)) return '#ff77a9';             // おはな
          }
          return Math.random() < 0.06 ? '#fff0f6' : '#ffffff';
        });
      }, dims: [24, 30, 4]
    },
    {
      id: 'vcastle', icon: '🏰', label: 'おおきなおしろ', kind: 'voxel', baseCell: 0.55,
      gen: function (W, H, D) {
        var cells = [];
        var S = W;                                     // 城壁の一辺（解像度に追従）
        var WH = Math.max(4, Math.round(H * 0.38));    // 城壁の高さ
        var TH = Math.max(WH + 2, Math.round(H * 0.62)); // すみの塔の高さ
        var KH = Math.max(WH + 1, Math.round(H * 0.5));  // ほんまるの高さ
        function push(ix, iy, iz, c) { cells.push({ ix: ix, iy: iy, iz: iz, c: c }); }
        function wallColor(iy) { return iy % 2 ? '#ffd9e8' : '#ffeef3'; }
        // 城壁（中空の四角リング・正面にもん）
        for (var ix = 0; ix < S; ix++) for (var iz = 0; iz < S; iz++) {
          var edge = ix < 2 || ix >= S - 2 || iz < 2 || iz >= S - 2;
          if (!edge) continue;
          var isGate = iz >= S - 2 && Math.abs(ix - (S - 1) / 2) < S * 0.12;
          for (var iy = 0; iy < WH; iy++) {
            if (isGate && iy < WH - 2) continue;
            push(ix, iy, iz, wallColor(iy));
          }
          // ぎざぎざ
          if ((ix + iz) % 2 === 0) push(ix, WH, iz, '#ffc9dd');
        }
        // すみの とう ＋ とんがりやね
        var corners = [[0, 0], [0, S - 1], [S - 1, 0], [S - 1, S - 1]];
        corners.forEach(function (co, ci) {
          for (var dy = 0; dy < TH; dy++) for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
            push(co[0] + dx, dy, co[1] + dz, dy % 2 ? '#fff2f6' : '#ffe0ec');
          }
          var roofC = ci % 2 ? '#b9a8ff' : '#a5d8ff';
          for (var ry = 0; ry < 3; ry++) {
            for (var dx2 = -1; dx2 <= 1; dx2++) for (var dz2 = -1; dz2 <= 1; dz2++) {
              if (Math.abs(dx2) + Math.abs(dz2) > (ry === 0 ? 2 : (ry === 1 ? 1 : 0))) continue;
              push(co[0] + dx2, TH + ry, co[1] + dz2, roofC);
            }
          }
        });
        // まんなかの ほんまる
        var c0 = (S - 1) / 2;
        var kr = Math.max(2, Math.round(S * 0.17));
        for (var dy2 = 0; dy2 < KH; dy2++) for (var dx3 = -kr; dx3 <= kr; dx3++) for (var dz3 = -kr; dz3 <= kr; dz3++) {
          push(Math.round(c0 + dx3), dy2, Math.round(c0 + dz3), dy2 % 2 ? '#ffe0ec' : '#fff2f6');
        }
        for (var ry2 = 0; ry2 <= kr + 1; ry2++) {
          var lim = kr + 1 - ry2;
          for (var dx4 = -kr; dx4 <= kr; dx4++) for (var dz4 = -kr; dz4 <= kr; dz4++) {
            if (Math.abs(dx4) + Math.abs(dz4) > lim) continue;
            push(Math.round(c0 + dx4), KH + ry2, Math.round(c0 + dz4), '#c7b4ff');
          }
        }
        return cells;
      }, dims: [15, 16, 15]
    },
    {
      id: 'vcake', icon: '🎂', label: 'ケーキ', kind: 'voxel', baseCell: 0.5,
      gen: function (W, H, D) {
        var cells = [];
        var c0 = (W - 1) / 2;
        var h1 = Math.max(3, Math.round(H * 0.27));
        var h2 = Math.max(3, Math.round(H * 0.27));
        var h3 = Math.max(2, Math.round(H * 0.2));
        var tiers = [
          { r: W / 2 - 0.5, y0: 0, h: h1, c1: '#ffe9b3', c2: '#ffd9e8' },
          { r: W * 0.335, y0: h1, h: h2, c1: '#ffd3e2', c2: '#fff6f9' },
          { r: W * 0.19, y0: h1 + h2, h: h3, c1: '#fff0d9', c2: '#ffc9dd' }
        ];
        tiers.forEach(function (tr) {
          for (var iy = tr.y0; iy < tr.y0 + tr.h; iy++) {
            for (var ix = 0; ix < W; ix++) for (var iz = 0; iz < W; iz++) {
              var dx = ix - c0, dz = iz - c0;
              var r = Math.sqrt(dx * dx + dz * dz);
              if (r > tr.r) continue;
              var top = iy === tr.y0 + tr.h - 1;
              var rim = r > tr.r - 1.2;
              var drip = rim && ((ix * 7 + iz * 13) % 5 < 2);
              var c = top ? '#fffdf7' : (drip && iy === tr.y0 + tr.h - 2 ? '#fffdf7' : (iy % 2 ? tr.c1 : tr.c2));
              cells.push({ ix: ix, iy: iy, iz: iz, c: c });
              // さくらんぼ
              if (top && rim && (ix * 11 + iz * 5) % 9 === 0) cells.push({ ix: ix, iy: iy + 1, iz: iz, c: '#ff5f6b' });
            }
          }
        });
        // ろうそく
        var cTop = h1 + h2 + h3;
        for (var cy = cTop; cy < cTop + 3; cy++) cells.push({ ix: Math.round(c0), iy: cy, iz: Math.round(c0), c: cy === cTop + 2 ? '#ffd86b' : '#ffffff' });
        return cells;
      }, dims: [20, 16, 20]
    }
  ];

  /* --- ボクセル塔の構築 --- */
  var voxGeo = null;
  function buildVoxelTower(def) {
    clearTower();
    var res = VOXCONF.res;
    // 個数上限に収まるように 解像度を落とす
    var W, H, D, cells;
    for (var tryN = 0; tryN < 5; tryN++) {
      W = Math.max(8, Math.round(def.dims[0] * res));
      H = Math.max(8, Math.round(def.dims[1] * res));
      D = Math.max(2, Math.round(def.dims[2] * res));
      cells = def.gen(W, H, D);
      if (cells.length <= VOXCONF.cap) break;
      res *= Math.pow(VOXCONF.cap / cells.length, 0.34);
    }
    var cell = def.baseCell * def.dims[0] / W; // 解像度が変わっても実寸を保つ

    // かぶり除去
    var seen = {};
    cells = cells.filter(function (c) {
      var k = c.ix + '_' + c.iy + '_' + c.iz;
      if (seen[k]) return false;
      seen[k] = 1; return true;
    });
    // 負のインデックスが出ないように 全体を平行移動
    var sMinX = 1e9, sMinY = 1e9, sMinZ = 1e9;
    cells.forEach(function (c) {
      sMinX = Math.min(sMinX, c.ix); sMinY = Math.min(sMinY, c.iy); sMinZ = Math.min(sMinZ, c.iz);
    });
    cells.forEach(function (c) { c.ix -= sMinX; c.iy -= sMinY; c.iz -= sMinZ; });

    var n = cells.length;
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxIy = 0;
    cells.forEach(function (c) {
      minX = Math.min(minX, c.ix); maxX = Math.max(maxX, c.ix);
      minZ = Math.min(minZ, c.iz); maxZ = Math.max(maxZ, c.iz);
      maxIy = Math.max(maxIy, c.iy);
    });
    var ox = -(minX + maxX) / 2 * cell, oz = -(minZ + maxZ) / 2 * cell;

    if (!voxGeo) voxGeo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    var mesh = new THREE.InstancedMesh(voxGeo, mat, n);
    mesh.castShadow = VOXCONF.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    // グリッドと柱
    var nx = maxX + 2, ny = maxIy + 2, nz = maxZ + 2;
    var grid = new Int32Array(nx * ny * nz).fill(-1);
    var gi = function (ix, iy, iz) {
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return -1;
      return (ix * ny + iy) * nz + iz;
    };
    var voxels = [];
    var tmpC = new THREE.Color();
    cells.forEach(function (c, i) {
      var v = {
        id: i, ix: c.ix, iy: c.iy, iz: c.iz,
        wet: 0, st: 0, sq: 1, birth: c.iy * 0.055 + Math.random() * 0.35,
        color: new THREE.Color(c.c)
      };
      // ちょっとだけ 色ゆらぎ
      v.color.offsetHSL(rand(-0.008, 0.008), 0, rand(-0.02, 0.02));
      voxels.push(v);
      grid[gi(c.ix, c.iy, c.iz)] = i;
      mesh.setColorAt(i, v.color);
    });
    mesh.instanceColor.needsUpdate = true;

    // 柱 = 同じ(ix,iz)の 連続した縦の並び
    var columns = [];
    var colMap = {};
    voxels.forEach(function (v) { colMap[v.ix + '_' + v.iz] = 1; });
    Object.keys(colMap).forEach(function (key) {
      var p = key.split('_');
      var ix = +p[0], iz = +p[1];
      var run = null;
      for (var iy = 0; iy < ny; iy++) {
        var id = grid[gi(ix, iy, iz)];
        if (id >= 0) {
          if (!run) {
            run = {
              ix: ix, iz: iz, baseIy: iy, vox: [], attLen: 0,
              shear: new THREE.Vector2(), shearV: new THREE.Vector2(),
              wetDir: new THREE.Vector2(), wobble: rand(0.8, 1.25),
              wx: ox + ix * cell, wz: oz + iz * cell, pend: 0
            };
          }
          run.vox.push(voxels[id]);
          voxels[id].col = run;
          voxels[id].inCol = run.vox.length - 1;
        } else if (run) {
          run.attLen = run.vox.length;
          columns.push(run); run = null;
        }
      }
      if (run) { run.attLen = run.vox.length; columns.push(run); }
    });

    // となりの柱（拡散用）
    var colGrid = {};
    columns.forEach(function (c) { colGrid[c.ix + '_' + c.iz + '_' + c.baseIy] = c; });
    columns.forEach(function (c) {
      c.nb = [];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        // baseIy が近い柱を となりとみなす
        for (var dy = -2; dy <= 2; dy++) {
          var o = colGrid[(c.ix + d[0]) + '_' + (c.iz + d[1]) + '_' + (c.baseIy + dy)];
          if (o) { c.nb.push(o); return; }
        }
      });
    });

    // おともだち（顔つきマスコット）
    var halfW = (maxX - minX) / 2 * cell;
    var friendCols = [];
    var friendBlocks = [];
    [[-halfW - 2.2, 2.2], [halfW + 2.2, 2.0], [0, halfW + 3.0]].forEach(function (fp, i) {
      var b = makeBlock({ color: shuffleHue(PASTELS[(Math.random() * 7) | 0], 0.04), w: BW * rand(0.85, 1.1), d: BW * rand(0.85, 1.1) });
      var col = { base: new THREE.Vector2(fp[0], fp[1]), blocks: [b] };
      b.col = col; b.idx = 0;
      friendCols.push(col);
      friendBlocks.push(b);
    });

    G.tower = {
      kind: 'voxel', def: def, cols: friendCols, blocks: friendBlocks,
      starGiven: false, everCollapsed: false, napT: 0,
      vox: {
        mesh: mesh, voxels: voxels, columns: columns, cell: cell,
        grid: grid, gi: gi, nx: nx, ny: ny, nz: nz, ox: ox, oz: oz,
        freeList: [], dirtyColor: [], pending: [],
        center: new THREE.Vector3(0, (maxIy * cell) / 2, 0),
        halfW: Math.max((maxX - minX), (maxZ - minZ)) / 2 * cell,
        maxAttY: maxIy * cell, supportT: 0,
        comRest: new THREE.Vector2(), comCur: new THREE.Vector2(), attN: n,
        napThresh: 4, // ずぶぬれ柱の生き残りは最大4セル（物理仕様）なので、それ以下なら「もう倒れた」扱い
        sfxT: 0
      }
    };
    // おともだちの登場
    friendBlocks.forEach(function (b, i) {
      b.state = 'returning';
      b.retT = -i * 0.15 - 0.2;
      b.retFrom = new THREE.Vector3(b.col.base.x, 12, b.col.base.y);
      b.retFromQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-1, 1), rand(-1, 1), 0));
    });
    layoutAttached(0);

    // カメラ
    var wSize = Math.max(maxX - minX, maxZ - minZ) * cell;
    cam.targetY = maxIy * cell * 0.45 + 0.5;
    cam.radius = clamp(Math.max(wSize * 1.25, maxIy * cell * 1.5) + 7, 12, 26);
    voxT0 = performance.now() / 1000;
    SFX.pop();
  }

  /* --- ボクセル物理 --- */
  var _vP = new THREE.Vector3(), _vQ = new THREE.Quaternion(), _vS = new THREE.Vector3(), _vM = new THREE.Matrix4(), _vE = new THREE.Euler();

  function voxDetach(col, k, extra) {
    var vx = G.tower.vox;
    var dl = col.shear.length() || 1;
    var dx = col.shear.x / dl, dz = col.shear.y / dl;
    if (dl < 0.05) { var a = rand(0, Math.PI * 2); dx = Math.cos(a); dz = Math.sin(a); }
    G.tower.everCollapsed = true;
    for (var j = k; j < col.attLen; j++) {
      var v = col.vox[j];
      var hFrac = (j + 1) / col.vox.length;
      v.st = 2;
      // いまの見た目位置から出発
      var f = Math.pow((j + 1) / col.vox.length, 1.15);
      v.px = col.wx + col.shear.x * f;
      v.py = GROUND_Y + (col.baseIy + j + 0.5) * vx.cell * 0.98;
      v.pz = col.wz + col.shear.y * f;
      v.vx_ = dx * (0.5 + 1.6 * hFrac) + col.shearV.x * 0.5 + rand(-0.5, 0.5) + (extra ? extra.x : 0);
      v.vy_ = rand(0.2, 0.8);
      v.vz_ = dz * (0.5 + 1.6 * hFrac) + col.shearV.y * 0.5 + rand(-0.5, 0.5) + (extra ? extra.z : 0);
      v.ex = 0; v.ey = rand(0, 6.28); v.ez = 0;
      v.ax = rand(-3, 3) * dz - rand(1, 2) * dz; v.ay = rand(-2, 2); v.az = rand(-3, 3) * dx;
      v.settle = 0;
      vx.freeList.push(v);
      vx.grid[vx.gi(v.ix, v.iy, v.iz)] = -1;
      vx.attN--;
    }
    col.attLen = k;
    col.shear.multiplyScalar(0.3);
    col.shearV.multiplyScalar(0.3);
    vx.supportT = 0.05; // すぐ ささえ再チェック
    // 音（まとめて鳴らしすぎない）
    if (vx.sfxT <= 0) { SFX.wheee(); SFX.squish(0.5); vx.sfxT = 0.45; }
  }

  function simulateVox(dt, t) {
    var tw = G.tower, vx = tw.vox;
    var cell = vx.cell;
    vx.sfxT -= dt;

    // --- 重心オフセット（前フレームの見た目から） ---
    var comOffX = 0, comOffZ = 0, comN = 0;

    // --- 水は下へながれる（ぬれ筋がツーッと下に走る） ---
    var cols = vx.columns;
    for (var fci = 0; fci < cols.length; fci++) {
      var fc = cols[fci];
      for (var fk = fc.attLen - 1; fk >= 1; fk--) {
        var fv = fc.vox[fk];
        if (fv.wet > 0.42) {
          var below = fc.vox[fk - 1];
          var mv = (fv.wet - 0.42) * 0.55 * dt;
          fv.wet -= mv * 0.5;                       // 半分は通り道に残る
          below.wet = Math.min(1, below.wet + mv);
          if (!fv.dirty) { fv.dirty = 1; vx.dirtyColor.push(fv); }
          if (!below.dirty) { below.dirty = 1; vx.dirtyColor.push(below); }
        }
      }
      // いちばん下が びしょびしょ → 張り出しから ポタポタ・じめんに 水たまり
      if (fc.attLen > 0) {
        var fb = fc.vox[0];
        if (fb.wet > 0.75 && Math.random() < dt * 2.5) {
          var dripY = GROUND_Y + fc.baseIy * vx.cell;
          if (Math.random() < perfScale) {
            spawnP(TEX.dot('#7ec8ff', true), {
              pos: new THREE.Vector3(fc.wx + rand(-0.2, 0.2), dripY, fc.wz + rand(-0.2, 0.2)),
              vel: new THREE.Vector3(0, -0.5, 0),
              grav: 5, life: 0.7, size: 0.14, fade: false
            });
          }
          addPuddle(fc.wx, fc.wz, 0.06);
          fb.wet = Math.max(0, fb.wet - 0.015);
        }
      }
    }
    for (var ci = 0; ci < cols.length; ci++) {
      var col = cols[ci];
      if (col.attLen <= 0) continue;
      var len = col.vox.length;
      var Hc = col.attLen * cell;

      // ぬれ集計 と つぶれ（上から荷重を積む）
      var wetSum = 0, load = 0;
      for (var k = col.attLen - 1; k >= 0; k--) {
        var v = col.vox[k];
        if (v.wet > 0) { v.wet = Math.max(0, v.wet - dt * 0.004); v.dirty || (v.dirty = 1, vx.dirtyColor.push(v)); }
        wetSum += v.wet;
        var soft = lerp(0.02, 0.3, v.wet);
        v.sq = clamp(1 - load * soft * 0.075 - v.wet * 0.08, 0.55, 1);
        load += 1 + 2 * v.wet;
      }
      var wetAvg = wetSum / col.attLen;

      // よこずれ ばね
      var stiff = lerp(46, 7, wetAvg) * col.wobble;
      var fx = col.wetDir.x * wetAvg * 3.4 * clamp(load / 8, 0.3, 1.4);
      var fz = col.wetDir.y * wetAvg * 3.4 * clamp(load / 8, 0.3, 1.4);
      // ずぶぬれの柱は ゆっくり ふらふら（つりあいで固まらないように）
      if (wetAvg > 0.45) {
        var dA = col.wobble * 9 + t * 0.7;
        var dK = (wetAvg - 0.45) * 2.6 * clamp(Hc / 4, 0.3, 1.2);
        fx += Math.cos(dA) * dK;
        fz += Math.sin(dA) * dK;
      }
      fx += G.wind.x * (0.5 + 0.5 * clamp(Hc / 6, 0, 1)) * (1.25 - wetAvg) * 2.3;
      fz += G.wind.y * (0.5 + 0.5 * clamp(Hc / 6, 0, 1)) * (1.25 - wetAvg) * 2.3;
      var co = vx.comCur;
      var coLen = Math.sqrt(co.x * co.x + co.y * co.y);
      if (coLen > 0.2) {
        fx += (co.x / coLen) * (coLen - 0.2) * 5.5 * clamp(Hc / 5, 0.3, 1.3);
        fz += (co.y / coLen) * (coLen - 0.2) * 5.5 * clamp(Hc / 5, 0.3, 1.3);
      }
      // クッションのささえ
      for (var cu = 0; cu < G.cushions.length; cu++) {
        var cus = G.cushions[cu];
        var ddx = cus.pos.x - col.wx, ddz = cus.pos.z - col.wz;
        var ddl = Math.sqrt(ddx * ddx + ddz * ddz);
        if (ddl > 0.3 && ddl < 3.0) {
          var nnx = ddx / ddl, nnz = ddz / ddl;
          var proj = col.shear.x * nnx + col.shear.y * nnz;
          if (proj > 0.03) {
            fx -= nnx * proj * 34 * (1 - ddl / 3.0);
            fz -= nnz * proj * 34 * (1 - ddl / 3.0);
            cus.press = Math.min(1, cus.press + dt * 2);
          }
        }
      }
      col.shearV.x += (fx - stiff * col.shear.x * (1 / Math.max(Hc, 0.5)) - 3.4 * col.shearV.x) * dt;
      col.shearV.y += (fz - stiff * col.shear.y * (1 / Math.max(Hc, 0.5)) - 3.4 * col.shearV.y) * dt;
      col.shearV.clampLength(0, 8);
      col.shear.x += col.shearV.x * dt;
      col.shear.y += col.shearV.y * dt;

      // となりと つながって ゆれる（拡散）
      if (col.nb.length) {
        var ax2 = 0, az2 = 0;
        for (var nbI = 0; nbI < col.nb.length; nbI++) { ax2 += col.nb[nbI].shear.x; az2 += col.nb[nbI].shear.y; }
        ax2 /= col.nb.length; az2 /= col.nb.length;
        var mix = Math.min(dt * 3.2, 1);
        col.shear.x += (ax2 - col.shear.x) * mix * 0.35;
        col.shear.y += (az2 - col.shear.y) * mix * 0.35;
      }

      // くずれ判定
      var lim = Math.max(cell * 2.0, Hc * 0.24) * (1 - 0.45 * wetAvg) * col.wobble;
      var shLen = col.shear.length();
      // ずぶぬれで おもすぎる 背の高い柱は「くたっ」と ざくつ
      var buckle = col.attLen >= 4 && wetAvg > 0.5 && col.vox[0].sq <= 0.6 && Math.random() < dt * 0.9;
      if (buckle) {
        voxDetach(col, Math.max(1 + (Math.random() * col.attLen * 0.5 | 0), col.baseIy === 0 ? 1 : 0));
      } else if (shLen > lim && col.attLen > 0) {
        // いちばん ぬれている あたりで おれる
        var bk = 0, bw = -1;
        for (var k2 = 0; k2 < col.attLen; k2++) {
          var sc = col.vox[k2].wet + k2 / col.attLen * 0.3 + Math.random() * 0.2;
          if (sc > bw) { bw = sc; bk = k2; }
        }
        voxDetach(col, Math.max(bk, col.baseIy === 0 ? 1 : 0));
      } else if (shLen > lim * 0.55) {
        creakLevel = Math.max(creakLevel, clamp((shLen - lim * 0.55) / (lim * 0.45), 0, 1) * 0.8);
      }
    }

    // --- ささえ再チェック（宙に浮いた柱は 連鎖でくずれる） ---
    vx.supportT -= dt;
    if (vx.supportT <= 0) {
      vx.supportT = 0.22;
      for (var ci2 = 0; ci2 < cols.length; ci2++) {
        var c2 = cols[ci2];
        if (c2.attLen <= 0 || c2.baseIy === 0 || c2.pend > 0) continue;
        var supported = vx.grid[vx.gi(c2.ix, c2.baseIy - 1, c2.iz)] >= 0;
        if (!supported) {
          var latN = 0;
          if (vx.grid[vx.gi(c2.ix + 1, c2.baseIy, c2.iz)] >= 0) latN++;
          if (vx.grid[vx.gi(c2.ix - 1, c2.baseIy, c2.iz)] >= 0) latN++;
          if (vx.grid[vx.gi(c2.ix, c2.baseIy, c2.iz + 1)] >= 0) latN++;
          if (vx.grid[vx.gi(c2.ix, c2.baseIy, c2.iz - 1)] >= 0) latN++;
          var wetHere = c2.vox[0].wet;
          if (latN === 0 || (latN <= 1 && wetHere > 0.4) || (wetHere > 0.75 && Math.random() < 0.5)) {
            c2.pend = rand(0.06, 0.4); // ちょっと ためて 連鎖のドラマ
          }
        }
      }
    }
    for (var ci3 = 0; ci3 < cols.length; ci3++) {
      var c3 = cols[ci3];
      if (c3.pend > 0) {
        c3.pend -= dt;
        if (c3.pend <= 0 && c3.attLen > 0) { voxDetach(c3, 0); c3.pend = 0; }
      }
    }

    // --- 自由落下ボクセル ---
    var fl = vx.freeList;
    // 空間ハッシュ（じめん付近の 反発用）
    var hash = {};
    var hc = cell * 1.15;
    function hkey(x, z) { return ((x / hc) | 0) * 100000 + ((z / hc) | 0); }
    for (var fi0 = 0; fi0 < fl.length; fi0++) {
      var v0 = fl[fi0];
      if (v0.py < cell * 2.5) {
        var kk = hkey(v0.px, v0.pz);
        (hash[kk] || (hash[kk] = [])).push(v0);
      }
    }
    for (var fi = fl.length - 1; fi >= 0; fi--) {
      var v2 = fl[fi];
      v2.vy_ -= GRAV * dt;
      var drag = Math.pow(0.88, dt);
      v2.vx_ *= drag; v2.vz_ *= drag;
      v2.px += v2.vx_ * dt; v2.py += v2.vy_ * dt; v2.pz += v2.vz_ * dt;
      v2.ex += v2.ax * dt; v2.ey += v2.ay * dt; v2.ez += v2.az * dt;
      v2.sq = v2.sq + (1 - v2.sq) * Math.min(dt * 7, 1);

      // ちかくの粒と ふんわり反発
      if (v2.py < cell * 2.2) {
        var gx0 = (v2.px / hc) | 0, gz0 = (v2.pz / hc) | 0;
        for (var ha = -1; ha <= 1; ha++) for (var hb = -1; hb <= 1; hb++) {
          var arr = hash[(gx0 + ha) * 100000 + (gz0 + hb)];
          if (!arr) continue;
          for (var hi2 = 0; hi2 < arr.length; hi2++) {
            var o2 = arr[hi2];
            if (o2 === v2) continue;
            var dxr = v2.px - o2.px, dzr = v2.pz - o2.pz;
            var dr = Math.sqrt(dxr * dxr + dzr * dzr);
            if (dr > 0.001 && dr < cell * 0.95) {
              var pu = (cell * 0.95 - dr) * 1.6 * dt;
              v2.px += dxr / dr * pu; v2.pz += dzr / dr * pu;
            }
          }
        }
      }

      // じめん
      var half = cell * 0.5 * v2.sq;
      if (v2.py - half < GROUND_Y && v2.vy_ < 0) {
        v2.py = GROUND_Y + half;
        var spd = -v2.vy_;
        var onCu = null;
        for (var cui = 0; cui < G.cushions.length; cui++) {
          var cdx2 = v2.px - G.cushions[cui].pos.x, cdz2 = v2.pz - G.cushions[cui].pos.z;
          if (cdx2 * cdx2 + cdz2 * cdz2 < 2.1) { onCu = G.cushions[cui]; break; }
        }
        var rest = onCu ? 0.7 : lerp(0.35, 0.05, v2.wet);
        v2.vy_ = spd * rest;
        v2.vx_ *= 0.7; v2.vz_ *= 0.7;
        v2.ax *= 0.5; v2.ay *= 0.5; v2.az *= 0.5;
        if (spd > 1.5) {
          v2.sq = 0.55;
          if (onCu) { onCu.press = 1; if (vx.sfxT <= 0 && Math.random() < 0.4) { SFX.boing(0.4); vx.sfxT = 0.3; } }
          else if (vx.sfxT <= 0 && Math.random() < 0.25) {
            if (v2.wet > 0.5) SFX.splat(); else SFX.squish(0.35);
            vx.sfxT = 0.3;
          }
          if (Math.random() < 0.25 * perfScale) {
            spawnP(TEX.dot(v2.wet > 0.5 ? '#8ec9ff' : '#ffffff', true), {
              pos: new THREE.Vector3(v2.px, GROUND_Y + 0.1, v2.pz),
              vel: new THREE.Vector3(rand(-1, 1), rand(0.8, 1.8), rand(-1, 1)),
              grav: 5, life: 0.5, size: 0.15, size1: 0.04
            });
          }
        }
      }

      // ねむる
      var slow2 = v2.vx_ * v2.vx_ + v2.vy_ * v2.vy_ + v2.vz_ * v2.vz_ < 0.05;
      if (slow2 && v2.py < GROUND_Y + half + 0.1) {
        v2.settle += dt;
        v2.ex = lerp(v2.ex, 0, Math.min(dt * 3, 1));
        v2.ez = lerp(v2.ez, 0, Math.min(dt * 3, 1));
        if (v2.settle > 0.7) {
          v2.st = 3;
          v2.sq = 1;
          // 最終の見た目を書き込んで 以後は静止
          _vP.set(v2.px, GROUND_Y + cell * 0.5, v2.pz);
          _vQ.setFromEuler(_vE.set(0, v2.ey, 0));
          _vS.set(1 + 0.22 * v2.wet, 1, 1 + 0.22 * v2.wet);
          _vM.compose(_vP, _vQ, _vS);
          vx.mesh.setMatrixAt(v2.id, _vM);
          fl.splice(fi, 1);
          continue;
        }
      } else v2.settle = 0;
    }
    // 動きすぎ防止：多すぎたら 古い子から ねかせる
    if (fl.length > 700) {
      for (var ov = 0; ov < fl.length - 700; ov++) fl[ov].settle = 10;
    }

    // --- 行列の書き込み ---
    var maxAttY = 0;
    var comX = 0, comZ = 0, homeX = 0, homeZ = 0;
    comN = 0;
    for (var ci4 = 0; ci4 < cols.length; ci4++) {
      var c4 = cols[ci4];
      if (c4.attLen <= 0) continue;
      var y = GROUND_Y + c4.baseIy * cell;
      var lenF = c4.vox.length;
      var HcF = Math.max(c4.attLen * cell, 0.001);
      _vQ.setFromEuler(_vE.set(
        clamp(c4.shear.y / HcF, -0.4, 0.4) * 0.7, 0,
        clamp(-c4.shear.x / HcF, -0.4, 0.4) * 0.7
      ));
      for (var k3 = 0; k3 < c4.attLen; k3++) {
        var v3 = c4.vox[k3];
        var h3 = cell * v3.sq;
        y += h3;
        var f3 = Math.pow((k3 + 1) / lenF, 1.15);
        var px3 = c4.wx + c4.shear.x * f3;
        var pz3 = c4.wz + c4.shear.y * f3;
        // ぬれると ぷっくり ふくらむ ＋ 水風船のぷにぷに波
        var puff = 0;
        if (v3.puffA) {
          var ph = (t - v3.puffT0) / 0.38;
          if (ph >= 1) v3.puffA = 0;
          else if (ph > 0) puff = v3.puffA * Math.sin(Math.PI * ph);
        }
        var sw3 = (1 + (1 - v3.sq) * 0.5 + 0.22 * v3.wet + puff) * cell * 0.96;
        var sy3 = (v3.sq + puff * 0.6) * cell * 0.96;
        if (v3.st === 0) {
          var pop3 = clamp((t - voxT0 - v3.birth) / 0.4, 0, 1);
          pop3 = 1 - Math.pow(1 - pop3, 3);
          if (pop3 >= 1) v3.st = 1;
          sw3 *= pop3; sy3 *= pop3;
          if (sy3 < 0.001) { sw3 = 0.001; sy3 = 0.001; }
        }
        _vP.set(px3, y - h3 / 2, pz3);
        _vS.set(sw3, sy3, sw3);
        _vM.compose(_vP, _vQ, _vS);
        vx.mesh.setMatrixAt(v3.id, _vM);
        comX += px3; comZ += pz3; homeX += c4.wx; homeZ += c4.wz; comN++;
        if (y > maxAttY) maxAttY = y;
      }
    }
    // 自由落下ぶん
    for (var fi2 = 0; fi2 < fl.length; fi2++) {
      var v4 = fl[fi2];
      _vP.set(v4.px, v4.py, v4.pz);
      _vQ.setFromEuler(_vE.set(v4.ex, v4.ey, v4.ez));
      var swF = (1 + (1 - v4.sq) * 0.5) * cell * 0.96;
      _vS.set(swF, v4.sq * cell * 0.96, swF);
      _vM.compose(_vP, _vQ, _vS);
      vx.mesh.setMatrixAt(v4.id, _vM);
    }
    vx.mesh.instanceMatrix.needsUpdate = true;
    vx.maxAttY = maxAttY;

    // 重心オフセット更新（いま積まれている子たちの「おうち」基準）
    if (comN > 0) {
      vx.comCur.set(comX / comN - homeX / comN, comZ / comN - homeZ / comN);
    } else vx.comCur.set(0, 0);

    // ねている子は とてもゆっくり かわく（毎フレーム少しずつ順番に見る）
    var vAll = vx.voxels;
    for (var ds = 0; ds < 80 && vAll.length; ds++) {
      vx.dryIdx = ((vx.dryIdx || 0) + 1) % vAll.length;
      var dvv = vAll[vx.dryIdx];
      if (dvv.st === 3 && dvv.wet > 0) {
        dvv.wet = Math.max(0, dvv.wet - 0.012 * (vAll.length / 80) * dt);
        if (!dvv.dirty) { dvv.dirty = 1; vx.dirtyColor.push(dvv); }
      }
    }

    // 色の更新
    if (vx.dirtyColor.length) {
      for (var dci = 0; dci < vx.dirtyColor.length; dci++) {
        var dv = vx.dirtyColor[dci];
        dv.dirty = 0;
        tmpWetColor.copy(dv.color);
        tmpWetDeep.copy(dv.color).multiplyScalar(0.5).lerp(tmpWetBlue, 0.2);
        tmpWetColor.lerp(tmpWetDeep, dv.wet * 0.8);
        vx.mesh.setColorAt(dv.id, tmpWetColor);
      }
      vx.dirtyColor.length = 0;
      vx.mesh.instanceColor.needsUpdate = true;
    }
  }
  var tmpWetColor = new THREE.Color(), tmpWetDeep = new THREE.Color(), tmpWetBlue = new THREE.Color('#3a5f8a');
  var voxT0 = 0; // 登場アニメの基準時刻

  /* --- ボクセルへの水・乾燥 --- */

  /* ブラシ半径：構造の大きさに連動（1回で数十個が変わる） */
  function waterBrushR() {
    if (!G.tower) return 1.4;
    if (G.tower.kind === 'voxel') return clamp(G.tower.vox.halfW * 0.4, 1.2, 2.6);
    return 1.6;
  }

  /* ボクセルのだいたいの現在位置（走査用） */
  var _wp = new THREE.Vector3();
  function voxWorldPos(v, vx) {
    if (v.st === 2 || v.st === 3) {
      _wp.set(v.px || 0, v.py || 0, v.pz || 0);
    } else {
      var c = v.col;
      _wp.set(c.wx + c.shear.x * ((v.inCol + 1) / c.vox.length),
        GROUND_Y + (c.baseIy + v.inCol + 0.5) * vx.cell,
        c.wz + c.shear.y * ((v.inCol + 1) / c.vox.length));
    }
    return _wp;
  }

  /* 球のなかの全ボクセルに cb(v, falloff, dist) を実行 */
  function forEachVoxInSphere(point, R, cb) {
    if (!G.tower || G.tower.kind !== 'voxel') return;
    var vx = G.tower.vox;
    var R2 = R * R;
    for (var i = 0; i < vx.voxels.length; i++) {
      var v = vx.voxels[i];
      var p = voxWorldPos(v, vx);
      var dx = p.x - point.x, dy = p.y - point.y, dz = p.z - point.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      var d = Math.sqrt(d2);
      cb(v, 1 - (d / R) * 0.65, d);
    }
  }

  function pickVox(cx, cy) {
    if (!G.tower || G.tower.kind !== 'voxel') return null;
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObject(G.tower.vox.mesh, false);
    if (!hits.length) return null;
    return { vi: hits[0].instanceId, point: hits[0].point, dist: hits[0].distance };
  }

  function wetVoxel(v, amount, hitPoint) {
    var vx = G.tower.vox;
    var before = v.wet;
    v.wet = clamp(v.wet + amount, 0, 1);
    if (v.wet !== before && !v.dirty) { v.dirty = 1; vx.dirtyColor.push(v); }
    if (v.col && hitPoint) {
      var dxw = hitPoint.x - v.col.wx, dzw = hitPoint.z - v.col.wz;
      var dlw = Math.sqrt(dxw * dxw + dzw * dzw);
      if (dlw > 0.1) {
        v.col.wetDir.x = lerp(v.col.wetDir.x, dxw / dlw, 0.12);
        v.col.wetDir.y = lerp(v.col.wetDir.y, dzw / dlw, 0.12);
      }
    }
  }

  function applyWaterVox(hit, rate, dt) {
    // シャワー：ブラシ半径のなかを まとめて ぬらす（数十個が同時にかわる）
    var R = waterBrushR();
    forEachVoxInSphere(hit.point, R, function (v, fall) {
      wetVoxel(v, rate * dt * 1.7 * fall, v.st <= 1 ? hit.point : null);
    });
    if (Math.random() < dt * 22 * perfScale) {
      spawnP(TEX.dot('#aaddff', true), {
        pos: hit.point.clone().add(new THREE.Vector3(rand(-R, R) * 0.5, rand(0, 0.4), rand(-R, R) * 0.5)),
        vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)),
        grav: 5, life: 0.5, size: 0.15, size1: 0.04
      });
    }
    addPuddle(hit.point.x, hit.point.z, rate * dt * 0.9);
  }

  function applyDryVox(hit, dt) {
    var vx = G.tower.vox;
    var did = false;
    // おひさまも 水と同じ広さで きく
    forEachVoxInSphere(hit.point, waterBrushR(), function (v, fall) {
      if (v.wet > 0) {
        v.wet = Math.max(0, v.wet - dt * 0.9 * fall);
        if (!v.dirty) { v.dirty = 1; vx.dirtyColor.push(v); }
        did = true;
      }
    });
    if (did && Math.random() < dt * 10 * perfScale) {
      spawnP(TEX.dot('#ffffff', true), {
        pos: hit.point.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0.15, rand(-0.2, 0.2))),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.7, 1.4), rand(-0.2, 0.2)),
        grav: -0.5, life: 1, size: 0.22, size1: 0.6, opacity: 0.7
      });
      SFX.steam();
    }
  }

  /* =========================================================
     みずふうせん（タップ＝ポーンと飛んで バシャッ）
     ========================================================= */
  var balloons = [];

  function throwBalloon(target) {
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 14, 10),
      new THREE.MeshStandardMaterial({ color: '#8ecfff', transparent: true, opacity: 0.88, roughness: 0.25 })
    );
    mesh.castShadow = true;
    var dir = camera.getWorldDirection(new THREE.Vector3());
    var from = camera.position.clone().addScaledVector(dir, 3.5).add(new THREE.Vector3(0, -1.2, 0));
    mesh.position.copy(from);
    scene.add(mesh);
    balloons.push({ mesh: mesh, from: from, to: target.clone(), t: 0 });
    SFX.pop();
  }

  function updateBalloons(dt) {
    for (var i = balloons.length - 1; i >= 0; i--) {
      var b = balloons[i];
      b.t += dt / 0.5; // 0.5秒で とうちゃく
      var t = Math.min(b.t, 1);
      b.mesh.position.lerpVectors(b.from, b.to, t);
      b.mesh.position.y += Math.sin(t * Math.PI) * 2.2;
      var wob = 1 + Math.sin(t * 22) * 0.12;
      b.mesh.scale.set(wob, 2 - wob, wob);
      if (b.t >= 1) {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        balloons.splice(i, 1);
        burstAt(b.to);
      }
    }
  }

  function clearBalloons() {
    balloons.forEach(function (b) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    });
    balloons.length = 0;
  }

  /* 着弾：広いはんいを 一気にぬらして ぷにぷに波 */
  function burstAt(point) {
    G._bursts = (G._bursts || 0) + 1;
    var tNow = performance.now() / 1000;
    var R = waterBrushR() * 1.9;
    // ボクセル
    if (G.tower && G.tower.kind === 'voxel') {
      var vx = G.tower.vox;
      forEachVoxInSphere(point, R, function (v, fall, d) {
        wetVoxel(v, 0.5 * fall, v.st <= 1 ? point : null);
        if (v.st <= 1) {
          var amp = 0.32 * fall + 0.06;
          if (amp > (v.puffA || 0)) {
            v.puffA = amp;
            v.puffT0 = tNow + d * 0.07; // 外へ 波が つたわる
          }
        }
      });
    }
    // おおきなスポンジ（おともだち・従来ステージ）
    if (G.tower) {
      G.tower.blocks.forEach(function (b) {
        var d = b.mesh.position.distanceTo(point);
        var R2 = R + 1.0;
        if (d > R2) return;
        var fall = 1 - d / R2 * 0.7;
        if (b.state === 'attached' || b.state === 'asleep') {
          b.wet = clamp(b.wet + 0.55 * fall, 0, 1);
          b.dirty = true;
          b.squashV -= 2.2 * fall;  // ぷにっ
          var dxb = point.x - b.mesh.position.x, dzb = point.z - b.mesh.position.z;
          var dlb = Math.sqrt(dxb * dxb + dzb * dzb);
          if (dlb > 0.2) {
            b.wetDir.x = lerp(b.wetDir.x, dxb / dlb, 0.5 * fall);
            b.wetDir.y = lerp(b.wetDir.y, dzb / dlb, 0.5 * fall);
          }
        }
      });
    }
    // しぶき・音・水たまり
    SFX.splat(); SFX.plink();
    for (var i = 0; i < Math.round(16 * perfScale); i++) {
      var a = rand(0, Math.PI * 2);
      spawnP(TEX.dot('#8ec9ff', true), {
        pos: point.clone(),
        vel: new THREE.Vector3(Math.cos(a) * rand(1, 3.2), rand(1.2, 3), Math.sin(a) * rand(1, 3.2)),
        grav: 6, life: rand(0.4, 0.8), size: rand(0.16, 0.3), size1: 0.05
      });
    }
    burstSparkles(point.clone(), 5, ['#c3ecff', '#ffffff', '#ffd1ea']);
    addPuddle(point.x, point.z, 0.8);
  }

  /* =========================================================
     あめくも（⭐1個で かいきん の ごほうびツール）
     ========================================================= */
  var cloudTool = (function () {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    [[0, 0, 0, 0.95], [0.9, 0.12, 0.1, 0.66], [-0.85, 0.1, -0.05, 0.62], [0.1, 0.42, -0.28, 0.55], [-0.2, 0.05, 0.5, 0.5]].forEach(function (p) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(p[3], 14, 10), mat);
      m.position.set(p[0], p[1], p[2]);
      g.add(m);
    });
    g.scale.set(1.5, 1.2, 1.5);
    g.visible = false;
    scene.add(g);
    return { group: g, mat: mat, hold: 0, vis: 0 };
  })();

  /* ゆびの下の たかさ planeY の水平面のうえの点 */
  function pickPlane(cx, cy, planeY) {
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    var tt = (planeY - o.y) / d.y;
    if (tt < 0) return null;
    return o.clone().addScaledVector(d, tt);
  }

  function applyCloud(cx, cy, dt) {
    var topY = (G.tower && G.tower.kind === 'voxel') ? G.tower.vox.maxAttY : 7;
    var cy2 = clamp(topY + 2.6, 4.5, 10);
    // ゆびの真下に くもが くるように（雲の高さの水平面で交差）
    var g = pickPlane(cx, cy, cy2);
    if (!g) g = pickGround(cx, cy);
    if (!g) return;
    g.x = clamp(g.x, -18, 18); g.z = clamp(g.z, -18, 18);
    cloudTool.hold = Math.min(cloudTool.hold + dt, 1.6);
    var pw = cloudTool.hold / 1.6;                  // ながおしで どしゃぶり
    var R = waterBrushR() * (1.9 + 1.2 * pw);
    var rate = 0.9 + 1.6 * pw;
    cloudTool.vis = 1;
    cloudTool.group.visible = true;
    cloudTool.group.position.lerp(new THREE.Vector3(g.x, cy2, g.z), Math.min(dt * 6, 1));
    cloudTool.mat.color.lerpColors(new THREE.Color('#ffffff'), new THREE.Color('#aebfd8'), pw);
    var sc = 1.5 * (1 + 0.35 * pw);
    cloudTool.group.scale.set(sc, sc * 0.8, sc);
    SFX.pour(0.35 + 0.5 * pw);

    var c = cloudTool.group.position;
    // あめつぶ
    var drops = (3 + 9 * pw) * perfScale;
    for (var i = 0; i < drops; i++) {
      if (Math.random() > dt * 22) continue;
      var a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * R * 0.8;
      spawnP(TEX.dot('#8ec9ff', true), {
        pos: new THREE.Vector3(c.x + Math.cos(a) * rr, c.y - 0.8, c.z + Math.sin(a) * rr),
        vel: new THREE.Vector3(0, -7, 0),
        grav: 2, life: 1.1, size: 0.15, fade: false, stretch: 0.4
      });
    }
    // くもの下を まとめて ぬらす（うえから）
    if (G.tower && G.tower.kind === 'voxel') {
      var vx = G.tower.vox;
      for (var ci = 0; ci < vx.columns.length; ci++) {
        var col = vx.columns[ci];
        if (col.attLen <= 0) continue;
        var dx = col.wx - c.x, dz = col.wz - c.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > R) continue;
        var fall = 1 - d / R * 0.5;
        // てっぺんから 2〜3こに あめ
        for (var k = col.attLen - 1; k >= Math.max(0, col.attLen - 3); k--) {
          wetVoxel(col.vox[k], rate * dt * fall * (k === col.attLen - 1 ? 1 : 0.4), null);
        }
        if (d > 0.3) {
          col.wetDir.x = lerp(col.wetDir.x, dx / d, dt * 0.8);
          col.wetDir.y = lerp(col.wetDir.y, dz / d, dt * 0.8);
        }
      }
    }
    if (G.tower) {
      G.tower.blocks.forEach(function (b) {
        if (b.state !== 'attached' && b.state !== 'asleep') return;
        var dxb = b.mesh.position.x - c.x, dzb = b.mesh.position.z - c.z;
        if (dxb * dxb + dzb * dzb > R * R) return;
        b.wet = clamp(b.wet + rate * dt * 0.8, 0, 1);
        b.dirty = true;
      });
    }
    if (Math.random() < dt * 3) addPuddle(c.x + rand(-R, R) * 0.5, c.z + rand(-R, R) * 0.5, 0.25);
  }

  function updateCloudTool(dt, t) {
    if (!(toolTouch && toolTouch.mode === 'tool' && tool === TOOL.CLOUD)) {
      cloudTool.hold = Math.max(0, cloudTool.hold - dt * 2);
      cloudTool.vis = Math.max(0, cloudTool.vis - dt * 2.5);
      if (cloudTool.vis <= 0) cloudTool.group.visible = false;
    }
    if (cloudTool.group.visible) {
      cloudTool.group.position.y += Math.sin(t * 2.2) * 0.003;
    }
  }

  /* --- ボクセルの おやすみ判定 --- */
  function updateNapVox(dt) {
    var tw = G.tower, vx = tw.vox;
    if (tw.starGiven || !tw.everCollapsed) return;
    // たかいところに のこっている柱が あるか
    var high = 0;
    for (var i = 0; i < vx.columns.length; i++) {
      var c = vx.columns[i];
      if (c.attLen > 0 && c.baseIy + c.attLen - 1 >= vx.napThresh) high++;
    }
    if (high > 0 || vx.freeList.length > 0) { tw.napT = 0; return; }
    tw.napT += dt;
    if (tw.napT > 1.2) {
      // のこった みじかい柱たちも すやすや（波のように ねていく）
      var slept = 0, remain = 0;
      for (var i2 = 0; i2 < vx.columns.length; i2++) {
        var c2 = vx.columns[i2];
        if (c2.attLen <= 0) continue;
        remain++;
        if (slept < 10) {
          for (var k = 0; k < c2.attLen; k++) {
            var v = c2.vox[k];
            v.st = 3;
            v.px = c2.wx; v.py = GROUND_Y + (c2.baseIy + k + 0.5) * vx.cell; v.pz = c2.wz;
            _vP.set(v.px, v.py, v.pz);
            _vQ.identity();
            _vS.set(vx.cell * 0.96, vx.cell * 0.96, vx.cell * 0.96);
            _vM.compose(_vP, _vQ, _vS);
            vx.mesh.setMatrixAt(v.id, _vM);
            vx.grid[vx.gi(v.ix, v.iy, v.iz)] = -1;
          }
          vx.mesh.instanceMatrix.needsUpdate = true;
          c2.attLen = 0;
          slept++;
          if (Math.random() < 0.4) {
            spawnP(TEX.sparkle('#fff2b0'), {
              pos: new THREE.Vector3(c2.wx, GROUND_Y + 1, c2.wz),
              vel: new THREE.Vector3(0, 0.6, 0), life: 0.8, size: 0.3, size1: 0.04
            });
          }
        }
      }
      if (remain === 0) {
        tw.starGiven = true;
        celebrate();
      }
    }
  }

  /* --- ボクセル塔の たてなおし --- */
  function rebuildVoxelTower() {
    var tw = G.tower, vx = tw.vox;
    tw.starGiven = false;
    tw.everCollapsed = false;
    tw.napT = 0;
    voxT0 = performance.now() / 1000;
    // 柱の復元
    vx.freeList.length = 0;
    vx.pending.length = 0;
    vx.grid.fill(-1);
    vx.columns.forEach(function (c) {
      c.attLen = c.vox.length;
      c.shear.set(0, 0); c.shearV.set(0, 0);
      c.wetDir.set(0, 0); c.pend = 0;
      c.wobble = rand(0.8, 1.25);
    });
    vx.voxels.forEach(function (v) {
      v.st = 0; v.sq = 1; v.settle = 0; v.puffA = 0;
      v.birth = v.iy * 0.055 + Math.random() * 0.35;
      if (v.wet > 0) { v.wet = 0; if (!v.dirty) { v.dirty = 1; vx.dirtyColor.push(v); } }
      vx.grid[vx.gi(v.ix, v.iy, v.iz)] = v.id;
    });
    vx.attN = vx.voxels.length;
    // おともだちも もどす
    tw.blocks.forEach(function (b, i) {
      b.wet = 0; b.dirty = true; b.wetDir.set(0, 0);
      b.squash = 1; b.squashV = 0;
      b.shear.set(0, 0); b.shearV.set(0, 0);
      b.faceStyle = Math.random() * 3 | 0; b.expr = '';
      refreshWetLook(b);
      b.state = 'returning';
      b.retT = -i * 0.1;
      b.retFrom = b.mesh.position.clone();
      b.retFromQ = b.mesh.quaternion.clone();
      b.landed = false; b.napTimer = 0;
      setExpr(b, 'joy');
    });
    layoutAttached(0);
    SFX.chime();
  }

  /* ================= ゲーム状態 ================= */
  var G = {
    screen: 'title',           // title | select | play
    tower: null,               // {cols:[], blocks:[], def, starGiven, everCollapsed}
    wind: new THREE.Vector2(), windTarget: new THREE.Vector2(),
    cushions: [],
    stars: parseInt(localStorage.getItem('sponge_stars') || '0', 10),
    rainbows: parseInt(localStorage.getItem('sponge_rainbows') || '0', 10),
    starsTotal: parseInt(localStorage.getItem('sponge_total') || '-1', 10),
    lastTouch: 0,
    celebration: 0,
    sparkleMode: false
  };
  G.sparkleMode = G.rainbows > 0;
  if (G.starsTotal < 0) G.starsTotal = G.stars + G.rainbows * STAR_GOAL;

  function saveStars() {
    localStorage.setItem('sponge_stars', String(G.stars));
    localStorage.setItem('sponge_rainbows', String(G.rainbows));
    localStorage.setItem('sponge_total', String(G.starsTotal));
  }

  /* ================= 塔の生成・削除 ================= */
  function clearTower() {
    if (!G.tower) return;
    G.tower.blocks.forEach(function (b) {
      scene.remove(b.mesh);
    });
    if (G.tower.kind === 'voxel' && G.tower.vox) {
      scene.remove(G.tower.vox.mesh);
      G.tower.vox.mesh.dispose();
      G.tower.vox.mesh.material.dispose();
    }
    G.tower = null;
  }

  function buildTower(def) {
    clearTower();
    var cols = def.build();
    var blocks = [];
    cols.forEach(function (col) {
      col.blocks.forEach(function (b, i) {
        b.col = col; b.idx = i;
        blocks.push(b);
      });
    });
    G.tower = { def: def, cols: cols, blocks: blocks, starGiven: false, everCollapsed: false, napT: 0 };
    layoutAttached(0);
    // カメラフィット
    var maxH = 0;
    cols.forEach(function (c) {
      var h = 0;
      c.blocks.forEach(function (b) { h += b.h; });
      maxH = Math.max(maxH, h);
    });
    cam.targetY = maxH * 0.42 + 0.6;
    cam.radius = clamp(maxH * 1.55 + 5.5, 11, 20);
    // とうじょう演出
    blocks.forEach(function (b, i) {
      b.state = 'returning';
      b.retT = -i * 0.06 - 0.1;
      b.retFrom = b.mesh.position.clone().setY(14 + i * 1.2);
      b.retFrom.x += rand(-3, 3); b.retFrom.z += rand(-3, 3);
      b.retFromQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-1, 1), rand(-1, 1), rand(-1, 1)));
    });
  }

  /* attached ブロックの整列座標（squash/shear 反映） */
  function layoutAttached(t) {
    G.tower.cols.forEach(function (col) {
      var y = GROUND_Y;
      var offX = 0, offZ = 0;
      for (var i = 0; i < col.blocks.length; i++) {
        var b = col.blocks[i];
        if (b.state !== 'attached' && b.state !== 'returning') continue;
        offX += b.shear.x; offZ += b.shear.y;
        var h = b.h * b.squash;
        var breathe = 1 + Math.sin(t * 2.1 + b.id * 1.7) * 0.012;
        var wide = (1 + 0.09 * b.wet) * (1 + (1 - b.squash) * 0.55);
        b.homePos = b.homePos || new THREE.Vector3();
        b.homePos.set(col.base.x + offX, y + h / 2, col.base.y + offZ);
        b.homeScale = b.homeScale || new THREE.Vector3();
        b.homeScale.set(wide * breathe, b.squash * (2 - breathe), wide * breathe);
        b.homeTilt = b.homeTilt || new THREE.Euler();
        b.homeTilt.set(
          clamp(b.shear.y / b.h, -0.45, 0.45) * 0.7,
          0,
          clamp(-b.shear.x / b.h, -0.45, 0.45) * 0.7
        );
        if (b.state === 'attached') {
          b.mesh.position.copy(b.homePos);
          b.mesh.scale.copy(b.homeScale);
          b.mesh.rotation.copy(b.homeTilt);
        }
        y += h;
      }
    });
  }

  /* ================= シミュレーション ================= */
  var creakLevel = 0;

  function simulate(dt, t) {
    if (!G.tower) return;
    var tower = G.tower;
    creakLevel *= 0.92;

    // かぜ：目標へなめらかに
    G.wind.lerp(G.windTarget, 1 - Math.pow(0.02, dt));
    G.windTarget.multiplyScalar(Math.pow(0.45, dt)); // 徐々におさまる

    tower.cols.forEach(function (col) {
      var att = col.blocks.filter(function (b) { return b.state === 'attached'; });
      if (!att.length) return;
      var n = att.length;

      // 質量と上載荷重
      var masses = att.map(blockMass);
      var loadAbove = new Array(n);
      var acc = 0;
      for (var i = n - 1; i >= 0; i--) { loadAbove[i] = acc; acc += masses[i]; }
      var total = acc;

      // 現在の重心オフセット（前フレームの shear 累積から）
      var cum = 0, cumZ = 0, comX = 0, comZ = 0;
      var offs = [];
      for (i = 0; i < n; i++) {
        cum += att[i].shear.x; cumZ += att[i].shear.y;
        offs.push([cum, cumZ]);
        comX += cum * masses[i]; comZ += cumZ * masses[i];
      }
      comX /= total; comZ /= total;
      var comOff = Math.sqrt(comX * comX + comZ * comZ);

      // みしみし音
      if (comOff > 0.35) creakLevel = Math.max(creakLevel, clamp((comOff - 0.35) / 0.8, 0, 1));

      for (i = 0; i < n; i++) {
        var b = att[i];

        // --- 自然乾燥（とてもゆっくり）
        if (b.wet > 0) { b.wet = Math.max(0, b.wet - dt * 0.004); b.dirty = true; }

        // --- つぶれ（squash）ばね
        var soft = lerp(0.045, 0.42, b.wet);
        var target = clamp(1 - loadAbove[i] * soft * 0.16 - b.wet * 0.13, 0.42, 1);
        var sa = (target - b.squash) * 26 - b.squashV * 5.5;
        b.squashV += sa * dt;
        var oldSq = b.squash;
        b.squash += b.squashV * dt;
        b.squash = clamp(b.squash, 0.35, 1.08);
        if (oldSq - b.squash > 0.9 * dt && Math.random() < dt * 3) SFX.squish(0.4);

        // --- 横ずれ（shear）ばね：ここが「かたむき」の心臓部
        var stiff = lerp(30, 4.5, b.wet) * b.wobble;
        var hf = (i + 1) / n;
        var fx = 0, fz = 0;
        // 濡れた側へじわっとしずむ
        var slump = b.wet * (0.45 + 0.55 * clamp(loadAbove[i] / 4, 0, 1)) * 2.6;
        fx += b.wetDir.x * slump;
        fz += b.wetDir.y * slump;
        // かぜ
        var windK = (0.35 + 0.65 * hf) * (1.25 - b.wet) * 1.5;
        fx += G.wind.x * windK;
        fz += G.wind.y * windK;
        // 倒れはじめの加速（重心が出るほど押される）
        var dead = 0.16;
        if (comOff > dead) {
          var tipK = 7.5 * hf * clamp(total / 6, 0.4, 1.2);
          fx += (comX / comOff) * (comOff - dead) * tipK;
          fz += (comZ / comOff) * (comOff - dead) * tipK;
        }
        // クッションのささえ
        for (var ci = 0; ci < G.cushions.length; ci++) {
          var cu = G.cushions[ci];
          var dx = cu.pos.x - col.base.x, dz = cu.pos.z - col.base.y;
          var dl = Math.sqrt(dx * dx + dz * dz);
          if (dl > 0.3 && dl < 3.2 && i < n * 0.7) {
            var nx = dx / dl, nz = dz / dl;
            var proj = offs[i][0] * nx + offs[i][1] * nz;
            if (proj > 0.05) {
              var sup = proj * 30 * (1 - dl / 3.2);
              fx -= nx * sup; fz -= nz * sup;
              cu.press = Math.min(1, cu.press + dt * 2);
            }
          }
        }

        var ax = fx - stiff * b.shear.x - 3.2 * b.shearV.x;
        var az = fz - stiff * b.shear.y - 3.2 * b.shearV.y;
        b.shearV.x += ax * dt; b.shearV.y += az * dt;
        b.shearV.clampLength(0, 6);
        b.shear.x += b.shearV.x * dt;
        b.shear.y += b.shearV.y * dt;
        b.shear.clampLength(0, b.w * 0.95);
      }

      // --- くずれ判定：下から順に、支点を超えた関節で上を切り離す
      var cumX2 = 0, cumZ2 = 0;
      var breakAt = -1;
      for (i = 0; i < n; i++) {
        cumX2 += att[i].shear.x; cumZ2 += att[i].shear.y;
        // i より上（i+1..n-1）の重心
        if (i >= n - 1) break;
        var m2 = 0, cx2 = 0, cz2 = 0;
        var runX = cumX2, runZ = cumZ2;
        for (var j = i + 1; j < n; j++) {
          runX += att[j].shear.x; runZ += att[j].shear.y;
          cx2 += runX * masses[j]; cz2 += runZ * masses[j];
          m2 += masses[j];
        }
        cx2 = cx2 / m2 - cumX2; cz2 = cz2 / m2 - cumZ2;
        var grip = (0.60 - att[i].wet * 0.22) * att[i].w * att[i + 1].wobble;
        if (Math.sqrt(cx2 * cx2 + cz2 * cz2) > grip) { breakAt = i + 1; break; }
        if (att[i + 1].shear.length() > att[i + 1].w * 0.9) { breakAt = i + 1; break; }
      }
      if (breakAt >= 0) detachAbove(col, att, breakAt);
    });

    if (creakLevel > 0.05) SFX.creak(creakLevel); else SFX.creak(0);

    layoutAttached(t);
    simulateFree(dt);
    simulateAsleep(dt, t);
    simulateReturning(dt);
    if (G.tower.kind === 'voxel') {
      simulateVox(dt, t);
      updateNapVox(dt);
    } else {
      updateNap(dt);
    }
  }

  function detachAbove(col, att, k) {
    var dirX = 0, dirZ = 0;
    for (var j = 0; j < att.length; j++) { dirX += att[j].shear.x; dirZ += att[j].shear.y; }
    var dl = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    dirX /= dl; dirZ /= dl;
    SFX.wheee();
    G.tower.everCollapsed = true;
    for (j = k; j < att.length; j++) {
      var b = att[j];
      var rel = (j - k + 1) / (att.length - k + 1);
      b.state = 'free';
      b.vel.set(
        dirX * (0.6 + 1.8 * rel) + b.shearV.x * 0.6 + rand(-0.4, 0.4),
        0.6 + rel * 0.8,
        dirZ * (0.6 + 1.8 * rel) + b.shearV.y * 0.6 + rand(-0.4, 0.4)
      );
      // 倒れる方向と直交した軸でくるん
      b.angV.set(dirZ * rand(1.2, 3.2), rand(-1, 1), -dirX * rand(1.2, 3.2));
      b.quatObj = b.mesh.quaternion.clone();
      setExpr(b, 'wow');
    }
  }

  function simulateFree(dt) {
    var free = G.tower.blocks.filter(function (b) { return b.state === 'free'; });
    for (var i = 0; i < free.length; i++) {
      var b = free[i];
      b.vel.y -= GRAV * dt;
      b.vel.multiplyScalar(Math.pow(0.9, dt)); // 空気のやわらかさ
      b.mesh.position.addScaledVector(b.vel, dt);

      // 回転
      var av = b.angV;
      var q = new THREE.Quaternion(av.x * dt / 2, av.y * dt / 2, av.z * dt / 2, 1).normalize();
      b.mesh.quaternion.premultiply(q);

      // つぶれ回復ばね
      var sa = (1 - b.squash) * 18 - b.squashV * 5;
      b.squashV += sa * dt; b.squash += b.squashV * dt;
      b.squash = clamp(b.squash, 0.35, 1.15);
      var wide = (1 + 0.09 * b.wet) * (1 + (1 - b.squash) * 0.55);
      b.mesh.scale.set(wide, b.squash, wide);

      // ブロック同士のふんわり反発（地面近くのみ・ねている子ともぶつからない）
      if (b.mesh.position.y < b.h * 1.6) {
        var others = G.tower.blocks;
        for (var j = 0; j < others.length; j++) {
          if (others[j] === b) continue;
          if (others[j].state !== 'free' && others[j].state !== 'asleep') continue;
          var o = others[j].mesh.position;
          var dx = b.mesh.position.x - o.x, dz = b.mesh.position.z - o.z;
          var dd = Math.sqrt(dx * dx + dz * dz);
          var minD = (b.w + others[j].w) * 0.44;
          if (dd > 0.001 && dd < minD) {
            var push = (minD - dd) * 2.2 * dt;
            b.mesh.position.x += dx / dd * push;
            b.mesh.position.z += dz / dd * push;
          }
        }
      }

      // 地面
      var bottom = b.mesh.position.y - (b.h * b.squash) / 2;
      if (bottom < GROUND_Y && b.vel.y < 0) {
        b.mesh.position.y = GROUND_Y + (b.h * b.squash) / 2;
        var speed = -b.vel.y;
        var onCushion = null;
        for (var ci = 0; ci < G.cushions.length; ci++) {
          var cu = G.cushions[ci];
          var cdx = b.mesh.position.x - cu.pos.x, cdz = b.mesh.position.z - cu.pos.z;
          if (cdx * cdx + cdz * cdz < 2.1) { onCushion = cu; break; }
        }
        var rest = onCushion ? 0.72 : lerp(0.42, 0.06, b.wet);
        b.vel.y = speed * rest;
        b.vel.x *= 0.72; b.vel.z *= 0.72;
        b.angV.multiplyScalar(0.55);
        if (speed > 1.2) {
          b.squashV -= speed * 0.55;
          if (onCushion) {
            onCushion.press = 1;
            SFX.boing(clamp(speed / 6, 0.2, 1));
            for (var hp = 0; hp < 3; hp++) {
              spawnP(TEX.heart('#ff8fb7'), {
                pos: b.mesh.position.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(1.5, 2.5), rand(-1, 1)),
                grav: 2.2, life: 1, size: 0.35, size1: 0.1
              });
            }
          } else if (b.wet > 0.5) {
            SFX.splat();
            for (var sp = 0; sp < 6; sp++) {
              spawnP(TEX.dot('#8ec9ff', true), {
                pos: b.mesh.position.clone().setY(GROUND_Y + 0.1),
                vel: new THREE.Vector3(rand(-2, 2), rand(1, 2.5), rand(-2, 2)),
                grav: 6, life: 0.7, size: 0.22, size1: 0.05
              });
            }
            addPuddle(b.mesh.position.x, b.mesh.position.z, 0.5);
          } else {
            SFX.boing(clamp(speed / 7, 0.15, 0.8));
          }
        }
      }

      // ねむる判定
      var slow = b.vel.lengthSq() < 0.06 && b.angV.lengthSq() < 0.25;
      var grounded = b.mesh.position.y < (b.h * b.squash) / 2 + 0.12;
      if (slow && grounded) {
        b.settleT += dt;
        // すわりなおし（ゆっくり起き上がる：ぷにっと座る演出）
        var e = new THREE.Euler().setFromQuaternion(b.mesh.quaternion, 'YXZ');
        var tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0));
        b.mesh.quaternion.slerp(tq, clamp(dt * 2.2, 0, 1));
        b.mesh.position.y = lerp(b.mesh.position.y, GROUND_Y + (b.h * b.squash) / 2, dt * 3);
        if (b.settleT > 1.1) {
          b.state = 'asleep';
          setExpr(b, 'sleep');
          spawnP(TEX.sparkle('#fff2b0'), {
            pos: b.mesh.position.clone().add(new THREE.Vector3(0, b.h, 0)),
            vel: new THREE.Vector3(0, 0.6, 0), life: 1, size: 0.4, size1: 0.05
          });
        }
      } else {
        b.settleT = 0;
      }
    }
  }

  /* ねているあいだ すやすや呼吸して、ぺちゃんこも ゆっくり もどる */
  function simulateAsleep(dt, t) {
    var sleepers = G.tower.blocks.filter(function (b) { return b.state === 'asleep'; });
    // おしくらまんじゅうを ゆっくり ほどいて、ここちよい寝場所へ
    for (var i = 0; i < sleepers.length; i++) {
      for (var j = i + 1; j < sleepers.length; j++) {
        var pa = sleepers[i].mesh.position, pb = sleepers[j].mesh.position;
        var dx = pa.x - pb.x, dz = pa.z - pb.z;
        var dd = Math.sqrt(dx * dx + dz * dz);
        var minD = (sleepers[i].w + sleepers[j].w) * 0.46;
        if (dd > 0.001 && dd < minD) {
          var push = Math.min((minD - dd) * 0.5, 0.5) * dt;
          pa.x += dx / dd * push; pa.z += dz / dd * push;
          pb.x -= dx / dd * push; pb.z -= dz / dd * push;
        }
      }
    }
    G.tower.blocks.forEach(function (b) {
      if (b.state !== 'asleep') return;
      b.squash = lerp(b.squash, 1, dt * 1.2);
      var breathe = 1 + Math.sin(t * 1.6 + b.id * 2.3) * 0.025;
      var wide = (1 + 0.09 * b.wet) * (1 + (1 - b.squash) * 0.55);
      b.mesh.scale.set(wide * breathe, b.squash * (2 - breathe), wide * breathe);
      b.mesh.position.y = GROUND_Y + (b.h * b.squash * (2 - breathe)) / 2;
      // ねながら かわく
      if (b.wet > 0) { b.wet = Math.max(0, b.wet - dt * 0.01); b.dirty = true; }
    });
  }

  function simulateReturning(dt) {
    var done = true;
    G.tower.blocks.forEach(function (b) {
      if (b.state !== 'returning') return;
      b.retT += dt * 0.85;
      if (b.retT < 0) { done = false; b.mesh.position.copy(b.retFrom); return; }
      var t = clamp(b.retT, 0, 1);
      if (t < 1) done = false;
      // easeOutBack ぎみ
      var e = 1 - Math.pow(1 - t, 3);
      var over = Math.sin(t * Math.PI) * 0.0;
      b.mesh.position.lerpVectors(b.retFrom, b.homePos, e + over);
      b.mesh.quaternion.copy(b.retFromQ).slerp(new THREE.Quaternion(), e);
      var pop = 1 + Math.sin(clamp((t - 0.7) / 0.3, 0, 1) * Math.PI) * 0.12;
      b.mesh.scale.set(pop, pop, pop);
      if (t >= 1 && !b.landed) {
        b.landed = true;
        SFX.pop();
        burstSparkles(b.mesh.position, 3);
      }
    });
    if (done) {
      G.tower.blocks.forEach(function (b) {
        if (b.state === 'returning') {
          b.state = 'attached';
          b.landed = false;
          b.mesh.rotation.set(0, 0, 0);
        }
      });
    }
  }

  /* みんなおやすみ → おほしさま */
  function updateNap(dt) {
    var tw = G.tower;
    if (!tw || tw.starGiven || !tw.everCollapsed) return;
    // ひとりだけ のこった子は、まわりが静かになったら その場で おやすみ
    var anyFree = tw.blocks.some(function (b) { return b.state === 'free'; });
    if (!anyFree) {
      tw.cols.forEach(function (col) {
        var att = col.blocks.filter(function (b) { return b.state === 'attached'; });
        if (att.length === 1) {
          var b = att[0];
          b.napTimer = (b.napTimer || 0) + dt;
          if (b.napTimer > 2.2) {
            b.state = 'asleep';
            setExpr(b, 'sleep');
            spawnP(TEX.sparkle('#fff2b0'), {
              pos: b.mesh.position.clone().add(new THREE.Vector3(0, b.h, 0)),
              vel: new THREE.Vector3(0, 0.6, 0), life: 1, size: 0.4, size1: 0.05
            });
          }
        }
      });
    }
    var all = tw.blocks.every(function (b) { return b.state === 'asleep'; });
    if (!all) { tw.napT = 0; return; }
    tw.napT += dt;
    if (tw.napT > 0.8) {
      tw.starGiven = true;
      celebrate();
    }
  }

  function celebrate() {
    G.celebration = 3.5;
    SFX.sleepy();
    setTimeout(function () { SFX.chime(); }, 700);
    G.stars++;
    G.starsTotal++;
    if (G.starsTotal === 1) setTimeout(revealCloudBtn, 2200); // はじめての⭐で あめくも かいきん
    var full = G.stars >= STAR_GOAL;
    if (full) {
      G.stars = 0; G.rainbows++; G.sparkleMode = true;
      setTimeout(function () { SFX.tada(); }, 1400);
    }
    saveStars();
    var c = towerCenter();
    confettiRain(c, full ? 90 : 45);
    burstSparkles(new THREE.Vector3(c.x, 4, c.z), 20);
    updateStarUI(true);
    pulseRebuild(true);
    if (full) showRainbowBanner();
  }

  function towerCenter() {
    var c = new THREE.Vector3();
    var n = 0;
    if (G.tower) {
      if (G.tower.kind === 'voxel') return G.tower.vox.center.clone();
      G.tower.blocks.forEach(function (b) { c.add(b.mesh.position); n++; });
      if (n) c.multiplyScalar(1 / n);
    }
    return c;
  }

  /* ================= みずたまり ================= */
  var puddles = [];
  function addPuddle(x, z, amt) {
    var p = null;
    for (var i = 0; i < puddles.length; i++) {
      var dx = puddles[i].mesh.position.x - x, dz = puddles[i].mesh.position.z - z;
      if (dx * dx + dz * dz < 1.4) { p = puddles[i]; break; }
    }
    if (!p) {
      if (puddles.length >= 8) { p = puddles.shift(); }
      else {
        var m = new THREE.Mesh(
          new THREE.CircleGeometry(1, 24),
          new THREE.MeshBasicMaterial({ map: TEX.puddle(), transparent: true, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        scene.add(m);
        p = { mesh: m, size: 0 };
      }
      p.mesh.position.set(x, GROUND_Y + 0.02 + puddles.length * 0.002, z);
      puddles.push(p);
    }
    p.size = Math.min(2.2, p.size + amt * 0.5);
  }
  function updatePuddles(dt) {
    for (var i = puddles.length - 1; i >= 0; i--) {
      var p = puddles[i];
      p.size = Math.max(0, p.size - dt * 0.05);
      p.mesh.scale.set(p.size, p.size, 1);
      p.mesh.material.opacity = clamp(p.size, 0, 1) * 0.8;
      if (p.size <= 0.01) {
        scene.remove(p.mesh);
        puddles.splice(i, 1);
      }
    }
  }

  /* ================= クッション ================= */
  function placeCushion(x, z) {
    if (G.cushions.length >= MAX_CUSHION) {
      var old = G.cushions.shift();
      scene.remove(old.group);
      SFX.pop();
    }
    var group = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 20, 14),
      new THREE.MeshStandardMaterial({ color: '#ffb3cf', roughness: 0.85 })
    );
    body.scale.set(1, 0.62, 1);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    var topBtn = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#fff0f6', roughness: 0.7 })
    );
    topBtn.position.y = 0.42;
    group.add(topBtn);
    group.position.set(x, GROUND_Y + 0.42, z);
    scene.add(group);
    var cu = { group: group, pos: new THREE.Vector3(x, GROUND_Y, z), press: 0, born: 0 };
    G.cushions.push(cu);
    SFX.boing(0.3);
    burstSparkles(new THREE.Vector3(x, 0.8, z), 6, ['#ffd1ea', '#fff6a8']);
  }
  function updateCushions(dt, t) {
    G.cushions.forEach(function (cu) {
      cu.born = Math.min(1, cu.born + dt * 3);
      cu.press = Math.max(0, cu.press - dt * 1.8);
      var pop = 1 - Math.pow(1 - cu.born, 3);
      var sq = 1 - cu.press * 0.4;
      var breathe = 1 + Math.sin(t * 2.4 + cu.pos.x) * 0.02;
      cu.group.scale.set(pop * (2 - sq) * 0.9 * breathe, pop * sq, pop * (2 - sq) * 0.9 * breathe);
    });
  }

  /* ================= どうぐ ================= */
  var TOOL = { WATER: 'water', DRY: 'dry', WIND: 'wind', CLOUD: 'cloud', CUSHION: 'cushion' };
  var tool = TOOL.WATER;

  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  function pickBlock(cx, cy) {
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var meshes = G.tower ? G.tower.blocks.map(function (b) { return b.mesh; }) : [];
    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      var m = hits[0].object;
      for (var i = 0; i < G.tower.blocks.length; i++) {
        if (G.tower.blocks[i].mesh === m) return { block: G.tower.blocks[i], point: hits[0].point, dist: hits[0].distance };
      }
    }
    return null;
  }
  function pickGround(cx, cy) {
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObject(groundMesh, false);
    return hits.length ? hits[0].point : null;
  }

  /* --- じょうろ 3D モデル --- */
  var can = (function () {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: '#ff8fb7', roughness: 0.5 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 0.8, 16), mat);
    g.add(body);
    var spout = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.9, 8), mat);
    spout.position.set(-0.65, 0.15, 0);
    spout.rotation.z = 0.9;
    g.add(spout);
    var nozzle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
    nozzle.position.set(-1.0, 0.42, 0);
    g.add(nozzle);
    var handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 16), mat);
    handle.position.set(0.5, 0.2, 0);
    handle.rotation.y = Math.PI / 2 * 0 + 0;
    g.add(handle);
    var deco = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff0f6' }));
    deco.position.set(0, 0.42, 0.3);
    g.add(deco);
    g.visible = false;
    scene.add(g);
    return g;
  })();
  var canSpout = new THREE.Vector3();

  /* --- おひさま（乾かす）スプライト --- */
  var sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.sun(), transparent: true, depthWrite: false }));
  sunSprite.scale.set(2.2, 2.2, 1);
  sunSprite.visible = false;
  scene.add(sunSprite);

  /* --- ツール適用 --- */
  var pourHold = 0;

  function applyWater(cx, cy, dt) {
    var hit = pickBlock(cx, cy);
    var vhit = pickVox(cx, cy);
    if (hit && vhit) { if (vhit.dist < hit.dist) hit = null; else vhit = null; }
    pourHold = Math.min(pourHold + dt, 2);
    var rate = 0.35 + pourHold * 0.45; // ながおしで だんだん たっぷり
    SFX.pour(clamp(0.4 + pourHold * 0.3, 0, 1));

    var target = hit ? hit.point : (vhit ? vhit.point : pickGround(cx, cy));
    if (!target) { can.visible = false; return; }

    // じょうろの位置：ターゲット上空、カメラの右側から注ぐ
    var right = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(0, 1, 0)).normalize();
    can.visible = true;
    can.position.copy(target).addScaledVector(right, 1.4).add(new THREE.Vector3(0, 1.7, 0));
    can.lookAt(target.x, can.position.y, target.z);
    can.rotation.z = -0.5 - pourHold * 0.15;
    canSpout.set(-1.05, 0.5, 0).applyEuler(can.rotation).add(can.position);

    // しずくパーティクル
    var drops = 2 + pourHold * 3;
    for (var i = 0; i < drops; i++) {
      if (Math.random() > dt * 30) continue;
      var toT = target.clone().sub(canSpout);
      spawnP(TEX.dot('#7ec8ff', true), {
        pos: canSpout.clone().add(new THREE.Vector3(rand(-0.08, 0.08), 0, rand(-0.08, 0.08))),
        vel: toT.multiplyScalar(1.6).setY(-1.2).add(new THREE.Vector3(rand(-0.4, 0.4), 0, rand(-0.4, 0.4))),
        grav: 5, life: 0.55, size: rand(0.12, 0.22), fade: false
      });
    }
    if (Math.random() < dt * 6) SFX.plink();

    if (hit && (hit.block.state === 'attached' || hit.block.state === 'asleep')) {
      var b = hit.block;
      var before = b.wet;
      b.wet = clamp(b.wet + rate * dt, 0, 1);
      b.dirty = true;
      // ぬれた方向を記録（塔の中心からヒット点へ）
      var dirx = hit.point.x - b.mesh.position.x;
      var dirz = hit.point.z - b.mesh.position.z;
      var dl = Math.sqrt(dirx * dirx + dirz * dirz);
      if (dl > 0.15) {
        b.wetDir.x = lerp(b.wetDir.x, dirx / dl, dt * 2.5);
        b.wetDir.y = lerp(b.wetDir.y, dirz / dl, dt * 2.5);
      }
      // したのブロックへ したたる
      if (b.state === 'attached' && b.idx > 0) {
        var below = b.col.blocks[b.idx - 1];
        if (below && below.state === 'attached') {
          below.wet = clamp(below.wet + rate * dt * 0.4, 0, 1);
          below.wetDir.lerp(b.wetDir, dt);
          below.dirty = true;
        }
      }
      // はねる水しぶき
      if (Math.random() < dt * 20) {
        spawnP(TEX.dot('#aaddff', true), {
          pos: hit.point.clone(),
          vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)),
          grav: 5, life: 0.5, size: 0.15, size1: 0.04
        });
      }
      if (before < 0.99 && b.wet >= 0.99) SFX.squish(0.5);
      // まわりの おおきなスポンジにも しぶきが かかる
      G.tower.blocks.forEach(function (nb) {
        if (nb === b || (nb.state !== 'attached' && nb.state !== 'asleep')) return;
        var nd = nb.mesh.position.distanceTo(hit.point);
        if (nd < 2.2) {
          nb.wet = clamp(nb.wet + rate * dt * 0.45 * (1 - nd / 2.2), 0, 1);
          nb.dirty = true;
        }
      });
      addPuddle(b.mesh.position.x, b.mesh.position.z, rate * dt * 0.8);
    } else if (vhit) {
      applyWaterVox(vhit, rate, dt);
    } else if (target) {
      addPuddle(target.x, target.z, rate * dt);
    }
  }

  function applyDry(cx, cy, dt) {
    var hit = pickBlock(cx, cy);
    var vhit = pickVox(cx, cy);
    if (hit && vhit) { if (vhit.dist < hit.dist) hit = null; else vhit = null; }
    var target = hit ? hit.point : (vhit ? vhit.point : pickGround(cx, cy));
    if (!target) { sunSprite.visible = false; return; }
    sunSprite.visible = true;
    sunSprite.position.copy(target).add(new THREE.Vector3(0, 1.6, 0));
    sunSprite.material.rotation += dt * 1.2;

    if (vhit) applyDryVox(vhit, dt);
    if (hit) {
      var b = hit.block;
      if (b.wet > 0) {
        b.wet = Math.max(0, b.wet - dt * 0.5);
        b.dirty = true;
        // ゆげ
        if (Math.random() < dt * 14) {
          spawnP(TEX.dot('#ffffff', true), {
            pos: hit.point.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.2, rand(-0.3, 0.3))),
            vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.8, 1.5), rand(-0.2, 0.2)),
            grav: -0.5, life: 1.1, size: 0.25, size1: 0.7, opacity: 0.7
          });
          SFX.steam();
        }
        // かわいて ぷるんと たちなおる
        if (b.wet < 0.02 && b.state === 'attached') {
          b.shearV.x -= b.shear.x * dt * 8;
          b.shearV.y -= b.shear.y * dt * 8;
        }
      } else if (b.state === 'attached') {
        // からからのスポンジは ぷるぷる よろこぶ
        if (Math.random() < dt * 2) {
          b.squashV += 0.8;
          SFX.boing(0.15);
        }
      }
    }
  }

  var windAngle = 0;
  function applyWindDrag(dx, dy) {
    // 画面のドラッグを世界のかぜへ
    var fwd = camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0; fwd.normalize();
    var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize().negate();
    var wx = right.x * dx * 0.011 + fwd.x * (-dy * 0.011);
    var wz = right.z * dx * 0.011 + fwd.z * (-dy * 0.011);
    G.windTarget.x = clamp(G.windTarget.x + wx, -3.2, 3.2);
    G.windTarget.y = clamp(G.windTarget.y + wz, -3.2, 3.2);
    windAngle = Math.atan2(dy, dx);
    var lv = clamp(G.windTarget.length() / 3.2, 0, 1);
    SFX.wind(lv);
  }

  function updateWindFx(dt) {
    var lv = G.wind.length();
    if (lv < 0.15) { SFX.wind(0); return; }
    SFX.wind(clamp(lv / 3.2, 0, 1) * 0.8);
    if (Math.random() < dt * lv * 14) {
      var dir = G.wind.clone().normalize();
      var c = towerCenter();
      var perp = new THREE.Vector2(-dir.y, dir.x);
      var off = rand(-4, 4);
      spawnP(TEX.streak(), {
        pos: new THREE.Vector3(
          c.x - dir.x * 8 + perp.x * off,
          rand(0.5, 7),
          c.z - dir.y * 8 + perp.y * off
        ),
        vel: new THREE.Vector3(dir.x * lv * 3.5, 0, dir.y * lv * 3.5),
        life: 1.4, size: rand(0.7, 1.2), size1: 0.4, stretch: 3.2,
        rot: -windAngle, opacity: 0.75
      });
    }
  }

  /* ================= 入力 ================= */
  var pointers = new Map();
  var toolTouch = null;    // {id, x, y, mode:'tool'|'cam', downT, moved}
  var pinchDist = 0;

  function onDown(e) {
    SFX.unlock();
    G.lastTouch = performance.now();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (toolTouch) endTool();
      return;
    }
    if (G.screen !== 'play') return;

    var mode = 'tool';
    if (tool !== TOOL.WIND && tool !== TOOL.CLOUD) {
      var hitB = pickBlock(e.clientX, e.clientY);
      var hitV = pickVox(e.clientX, e.clientY);
      var hitG = pickGround(e.clientX, e.clientY);
      var nearTower = false;
      if (hitG && G.tower) {
        for (var i = 0; i < G.tower.cols.length; i++) {
          var base = G.tower.cols[i].base;
          if (Math.hypot(hitG.x - base.x, hitG.z - base.y) < 7) { nearTower = true; break; }
        }
        if (G.tower.kind === 'voxel' && Math.hypot(hitG.x, hitG.z) < 11) nearTower = true;
      }
      if (!hitB && !hitV && !(nearTower || tool === TOOL.CUSHION && hitG)) mode = 'cam';
    }
    toolTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: mode, downT: performance.now(), moved: 0 };
    pourHold = 0;
  }

  function onMove(e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    G.lastTouch = performance.now();

    if (pointers.size >= 2) {
      // 2ほんゆび：カメラ
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist > 0) {
        cam.radius = clamp(cam.radius * (pinchDist / d), 8, 26);
      }
      pinchDist = d;
      cam.theta -= dx * 0.004;
      cam.phi = clamp(cam.phi + dy * 0.003, 0.5, 1.45);
      return;
    }

    if (!toolTouch || toolTouch.id !== e.pointerId) return;
    toolTouch.moved += Math.abs(dx) + Math.abs(dy);
    toolTouch.x = e.clientX; toolTouch.y = e.clientY;

    if (toolTouch.mode === 'cam') {
      cam.theta -= dx * 0.006;
      cam.phi = clamp(cam.phi + dy * 0.004, 0.5, 1.45);
    } else if (tool === TOOL.WIND) {
      applyWindDrag(dx, dy);
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (toolTouch && toolTouch.id === e.pointerId) {
      var dt = performance.now() - toolTouch.downT;
      if (tool === TOOL.CUSHION && toolTouch.mode === 'tool' && toolTouch.moved < 25 && dt < 600) {
        var g = pickGround(toolTouch.x, toolTouch.y);
        if (g && Math.hypot(g.x, g.z) < 20) placeCushion(g.x, g.z);
      }
      // タップ＝みずふうせん ポーン
      if (tool === TOOL.WATER && toolTouch.mode === 'tool' && toolTouch.moved < 30 && dt < 600) {
        var hb = pickBlock(toolTouch.x, toolTouch.y);
        var hv = pickVox(toolTouch.x, toolTouch.y);
        if (hb && hv) { if (hv.dist < hb.dist) hb = null; else hv = null; }
        var tp = hb ? hb.point : (hv ? hv.point : pickGround(toolTouch.x, toolTouch.y));
        if (tp && Math.hypot(tp.x, tp.z) < 24) throwBalloon(tp);
      }
      endTool();
    }
    if (pointers.size < 2) pinchDist = 0;
  }

  function endTool() {
    toolTouch = null;
    can.visible = false;
    sunSprite.visible = false;
    SFX.pour(0);
    pourHold = 0;
  }

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.addEventListener('touchmove', function (e) {
    // とうえらび画面のスクロールだけは ゆるす
    if (e.target && e.target.closest && e.target.closest('.selScroll')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ================= UI ================= */
  var $ = function (s) { return document.querySelector(s); };

  function show(id) {
    ['#title', '#select', '#hud'].forEach(function (s) {
      $(s).classList.toggle('on', s === id);
    });
  }

  function updateStarUI(anim) {
    var wrap = $('#stars');
    var html = '';
    for (var i = 0; i < STAR_GOAL; i++) {
      html += '<span class="st' + (i < G.stars ? ' got' : '') + (anim && i === G.stars - 1 ? ' newstar' : '') + '">⭐</span>';
    }
    for (i = 0; i < G.rainbows; i++) html += '<span class="crown">🌈</span>';
    wrap.innerHTML = html;
  }

  function pulseRebuild(on) {
    $('#rebuildBtn').classList.toggle('pulse', on);
  }

  function showRainbowBanner() {
    var b = $('#rainbowBanner');
    b.classList.add('on');
    setTimeout(function () { b.classList.remove('on'); }, 3500);
  }

  /* タイトル・セレクト画面の生成 */
  (function buildSelect() {
    function fill(gridSel, defs) {
      var grid = $(gridSel);
      defs.forEach(function (def) {
        var card = document.createElement('button');
        card.className = 'towerCard';
        card.innerHTML = '<span class="tIcon">' + def.icon + '</span><span class="tLabel">' + def.label + '</span>';
        card.addEventListener('pointerup', function () {
          SFX.unlock(); SFX.ting(3);
          startPlay(def);
        });
        grid.appendChild(card);
      });
    }
    fill('#towerGrid', TOWERS);
    fill('#voxGrid', VOXTOWERS);
  })();

  function startPlay(def) {
    show('#hud');
    G.screen = 'play';
    G.cushions.forEach(function (c) { scene.remove(c.group); });
    G.cushions = [];
    G.windTarget.set(0, 0);
    G.wind.set(0, 0);
    clearBalloons();
    if (def.kind === 'voxel') buildVoxelTower(def);
    else buildTower(def);
    pulseRebuild(false);
    updateStarUI(false);
  }

  $('#playBtn').addEventListener('pointerup', function () {
    SFX.unlock(); SFX.chime();
    G.screen = 'select';
    show('#select');
  });
  $('#homeBtn').addEventListener('pointerup', function () {
    SFX.ting(1);
    G.screen = 'select';
    show('#select');
  });
  $('#rebuildBtn').addEventListener('pointerup', function () {
    if (!G.tower) return;
    SFX.ting(5);
    pulseRebuild(false);
    if (G.tower.kind === 'voxel') rebuildVoxelTower();
    else rebuildTower();
  });

  function rebuildTower() {
    var tw = G.tower;
    tw.starGiven = false;
    tw.everCollapsed = false;
    tw.napT = 0;
    // いまの位置から、あたらしい隊形へ とんでかえる
    tw.blocks.forEach(function (b, i) {
      b.wet = 0; b.dirty = true;
      b.wetDir.set(0, 0);
      b.squash = 1; b.squashV = 0;
      b.shear.set(0, 0); b.shearV.set(0, 0);
      b.faceStyle = Math.random() * 3 | 0;
      b.expr = '';
      refreshWetLook(b);
      b.state = 'returning';
      b.retT = -i * 0.05;
      b.retFrom = b.mesh.position.clone();
      b.retFromQ = b.mesh.quaternion.clone();
      b.landed = false;
      b.napTimer = 0;
      b.wobble = rand(0.85, 1.2);
      setExpr(b, 'joy');
    });
    layoutAttached(0); // homePos を更新
  }

  /* ツールバー */
  var toolBtns = {};
  [['water', '💧'], ['dry', '☀️'], ['wind', '🌬️'], ['cloud', '🌧️'], ['cushion', '🛏️']].forEach(function (def) {
    var btn = document.createElement('button');
    btn.className = 'toolBtn' + (def[0] === tool ? ' sel' : '');
    btn.id = 'tool_' + def[0];
    btn.textContent = def[1];
    btn.addEventListener('pointerup', function () {
      tool = def[0];
      SFX.pop();
      Object.keys(toolBtns).forEach(function (k) {
        toolBtns[k].classList.toggle('sel', k === tool);
      });
    });
    toolBtns[def[0]] = btn;
    $('#toolbar').insertBefore(btn, $('#rebuildBtn'));
  });

  function cloudUnlocked() { return G.starsTotal >= 1; }

  function revealCloudBtn() {
    var btn = toolBtns.cloud;
    if (!btn.classList.contains('locked')) return;
    btn.classList.remove('locked');
    btn.classList.add('unlock', 'pulse');
    SFX.tada();
    setTimeout(function () { btn.classList.remove('pulse'); }, 6000);
  }

  if (!cloudUnlocked()) toolBtns.cloud.classList.add('locked');

  updateStarUI(false);

  /* ================= 表情の更新 ================= */
  function updateFaces(dt) {
    if (!G.tower) return;
    G.tower.blocks.forEach(function (b) {
      if (!b.facePlane) return;
      if (b.state === 'asleep') { setExpr(b, 'sleep'); return; }
      if (b.state === 'free') { setExpr(b, 'wow'); return; }
      if (b.state === 'returning') { setExpr(b, 'joy'); return; }
      if (G.celebration > 0) { setExpr(b, 'joy'); return; }
      if (b.squash < 0.72) { setExpr(b, 'squish'); return; }
      // まばたき
      b.blinkT -= dt;
      if (b.blinkT < 0) {
        setExpr(b, 'blink');
        if (b.blinkT < -0.15) { b.blinkT = rand(1.6, 5); setExpr(b, 'normal'); }
      } else {
        setExpr(b, b.wet > 0.75 ? 'joy' : 'normal');
      }
    });
  }

  /* キラキラモード（にじ達成ごほうび） */
  var sparkleT = 0;
  function updateSparkleMode(dt) {
    if (!G.sparkleMode || !G.tower) return;
    sparkleT -= dt;
    if (sparkleT < 0) {
      sparkleT = 0.35;
      var bs = G.tower.blocks;
      var b = bs[Math.random() * bs.length | 0];
      spawnP(TEX.sparkle('#fff6a8'), {
        pos: b.mesh.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.5), rand(-0.6, 0.6))),
        vel: new THREE.Vector3(0, 0.5, 0), life: 0.8, size: 0.28, size1: 0.02, spin: 2
      });
    }
  }

  /* ================= メインループ ================= */
  var lastT = performance.now();

  function resize() {
    var w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦画面では少しひいて全体が見えるように
    camera.fov = h > w ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 300); });
  resize();

  var fpsAcc = 0, fpsN = 0;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    var rawDt = (nowMs - lastT) / 1000;
    var dt = Math.min(rawDt, 0.033);
    lastT = nowMs;
    var t = nowMs / 1000;

    // パフォーマンス見はり：かくつく端末では 粒子と影を自動でひかえめに
    fpsAcc += rawDt; fpsN++;
    if (fpsAcc > 3) {
      var avgFps = fpsN / fpsAcc;
      if (avgFps < 20 && perfScale > 0.5) {
        perfScale = 0.4;
        if (G.tower && G.tower.kind === 'voxel') G.tower.vox.mesh.castShadow = false;
      }
      fpsAcc = 0; fpsN = 0;
    }

    // カメラ：塔がひくくなったら、ゆっくり目線もおりる
    if (G.screen === 'play' && G.tower) {
      var hi = 1.5;
      if (G.tower.kind === 'voxel') {
        hi = Math.max(hi, G.tower.vox.maxAttY);
      } else {
        G.tower.blocks.forEach(function (b) {
          if (b.state === 'attached' || b.state === 'asleep') hi = Math.max(hi, b.mesh.position.y);
          else if (b.state === 'returning' && b.homePos) hi = Math.max(hi, b.homePos.y);
        });
      }
      var desired = clamp(hi * 0.5 + 1.2, 1.9, 8.5);
      cam.targetY = lerp(cam.targetY, desired, Math.min(dt * 0.8, 1));
    }
    var idle = (performance.now() - G.lastTouch) / 1000;
    if (G.screen === 'play' && idle > 6) cam.theta += dt * 0.05; // ぼーっと眺めモード
    if (G.screen === 'title' || G.screen === 'select') cam.theta += dt * 0.12;
    var sy = Math.cos(cam.phi);
    var sr = Math.sin(cam.phi);
    camera.position.set(
      Math.sin(cam.theta) * cam.radius * sr,
      cam.targetY + cam.radius * sy,
      Math.cos(cam.theta) * cam.radius * sr
    );
    camera.lookAt(0, cam.targetY, 0);

    // くも
    clouds.forEach(function (c) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 80) c.position.x = -80;
    });

    if (G.screen === 'play' && G.tower) {
      // ツール適用（ドラッグ中）
      if (toolTouch && toolTouch.mode === 'tool') {
        if (tool === TOOL.WATER) applyWater(toolTouch.x, toolTouch.y, dt);
        else if (tool === TOOL.DRY) applyDry(toolTouch.x, toolTouch.y, dt);
        else if (tool === TOOL.CLOUD) applyCloud(toolTouch.x, toolTouch.y, dt);
      } else {
        SFX.pour(0);
      }
      updateBalloons(dt);
      updateCloudTool(dt, t);
      simulate(dt, t);
      updateWindFx(dt);
      updateFaces(dt);
      updateSparkleMode(dt);
      G.tower.blocks.forEach(refreshWetLook);
      if (G.celebration > 0) G.celebration -= dt;
    }

    updateParticles(dt);
    updatePuddles(dt);
    updateCushions(dt, t);

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  /* タイトル画面用に、うしろで小さな塔をまわしておく */
  buildTower(TOWERS[0]);
  G.screen = 'title';
  show('#title');

  /* 開発・自動テスト用フック（ゲームには影響しない） */
  window.__SPONGE__ = {
    tier: VOXTIER,
    state: function () {
      var out = {
        screen: G.screen,
        stars: G.stars,
        blocks: G.tower ? G.tower.blocks.map(function (b) {
          var v = b.mesh.position.clone().project(camera);
          return {
            state: b.state, wet: +b.wet.toFixed(2), squash: +b.squash.toFixed(2),
            sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight
          };
        }) : []
      };
      if (G.tower && G.tower.kind === 'voxel') {
        var vx = G.tower.vox;
        var att = 0, free = vx.freeList.length, asleep = 0, asm = 0;
        vx.voxels.forEach(function (v) {
          if (v.st === 0) asm++;
          else if (v.st === 1) att++;
          else if (v.st === 3) asleep++;
        });
        out.vox = { total: vx.voxels.length, assembling: asm, attached: att, free: free, asleep: asleep, cell: +vx.cell.toFixed(3) };
      }
      return out;
    },
    /* テスト用：みずふうせん */
    balloons: function () { return { active: balloons.length, bursts: G._bursts || 0 }; },
    /* テスト用：ぬれ具合の合計 */
    wetSum: function () {
      if (!G.tower) return 0;
      if (G.tower.kind === 'voxel') {
        var s = 0;
        G.tower.vox.voxels.forEach(function (v) { s += v.wet; });
        return +s.toFixed(2);
      }
      var s2 = 0;
      G.tower.blocks.forEach(function (b) { s2 += b.wet; });
      return +s2.toFixed(2);
    },
    /* テスト用：のこっている柱の内訳 */
    cols: function () {
      if (!G.tower || G.tower.kind !== 'voxel') return [];
      return G.tower.vox.columns.filter(function (c) { return c.attLen > 0; }).map(function (c) {
        return { ix: c.ix, iz: c.iz, baseIy: c.baseIy, attLen: c.attLen, top: c.baseIy + c.attLen - 1, wet0: +c.vox[0].wet.toFixed(2), shear: +c.shear.length().toFixed(2), pend: c.pend };
      });
    },
    /* テスト用：ぜんぶ ぬらす */
    wetAll: function (amount) {
      if (!G.tower) return;
      if (G.tower.kind === 'voxel') {
        var vx = G.tower.vox;
        vx.voxels.forEach(function (v) {
          if (v.st <= 1) {
            v.wet = clamp(v.wet + amount, 0, 1);
            if (!v.dirty) { v.dirty = 1; vx.dirtyColor.push(v); }
          }
        });
        vx.columns.forEach(function (c) {
          if (c.attLen > 0) c.wetDir.set(rand(-1, 1), rand(-1, 1)).normalize();
        });
      } else {
        G.tower.blocks.forEach(function (b) {
          if (b.state === 'attached') {
            b.wet = clamp(b.wet + amount, 0, 1);
            b.dirty = true;
            if (b.wetDir.lengthSq() < 0.01) b.wetDir.set(rand(-1, 1), rand(-1, 1)).normalize();
          }
        });
      }
    }
  };
})();
