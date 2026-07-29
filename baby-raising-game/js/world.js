/* =========================================================
 * world.js — 虹と雲のファンタジーハウス（雲の上のピンクのお部屋）
 * ========================================================= */
(function () {
  'use strict';

  /* ---- 共通ヘルパー ---- */

  let _gradientMap = null;
  function gradientMap() {
    if (!_gradientMap) {
      const data = new Uint8Array([120, 190, 255]);
      _gradientMap = new THREE.DataTexture(data, 3, 1, THREE.LuminanceFormat);
      _gradientMap.minFilter = THREE.NearestFilter;
      _gradientMap.magFilter = THREE.NearestFilter;
      _gradientMap.needsUpdate = true;
    }
    return _gradientMap;
  }

  function toonMat(color, opts = {}) {
    return new THREE.MeshToonMaterial(Object.assign({
      color, gradientMap: gradientMap(),
    }, opts));
  }

  /** ハート形の Shape（ラグや飾りに使用） */
  function heartShape() {
    const s = new THREE.Shape();
    const x = -2.5, y = -5;
    s.moveTo(x + 2.5, y + 2.5);
    s.bezierCurveTo(x + 2.5, y + 2.5, x + 2, y, x, y);
    s.bezierCurveTo(x - 3, y, x - 3, y + 3.5, x - 3, y + 3.5);
    s.bezierCurveTo(x - 3, y + 5.5, x - 1.5, y + 7.7, x + 2.5, y + 9.5);
    s.bezierCurveTo(x + 6, y + 7.7, x + 8, y + 5.5, x + 8, y + 3.5);
    s.bezierCurveTo(x + 8, y + 3.5, x + 8, y, x + 5, y);
    s.bezierCurveTo(x + 3.5, y, x + 2.5, y + 2.5, x + 2.5, y + 2.5);
    return s;
  }

  /** モクモク雲（球の集まり） */
  function makeCloud(scale = 1, color = 0xffffff) {
    const g = new THREE.Group();
    const mat = toonMat(color);
    const puffs = [
      [0, 0, 0, 1.0], [0.9, -0.1, 0.1, 0.75], [-0.9, -0.1, -0.1, 0.7],
      [0.45, 0.35, 0, 0.65], [-0.45, 0.32, 0.15, 0.6], [1.5, -0.2, 0, 0.5],
      [-1.5, -0.22, 0, 0.45],
    ];
    puffs.forEach(([px, py, pz, r]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
      m.position.set(px, py, pz);
      g.add(m);
    });
    g.scale.setScalar(scale);
    return g;
  }

  /* ---- 空 ---- */

  function makeSky() {
    const uniforms = {
      topColor: { value: new THREE.Color(0x8fd3ff) },
      bottomColor: { value: new THREE.Color(0xffe0ef) },
      nightMix: { value: 0.0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float nightMix;
        varying vec3 vWorldPos;
        void main() {
          float h = clamp(normalize(vWorldPos).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 day = mix(bottomColor, topColor, pow(h, 0.8));
          vec3 nightTop = vec3(0.13, 0.15, 0.35);
          vec3 nightBottom = vec3(0.45, 0.32, 0.5);
          vec3 night = mix(nightBottom, nightTop, pow(h, 0.8));
          gl_FragColor = vec4(mix(day, night, nightMix), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), mat);
    return { sky, uniforms };
  }

  /* ---- 虹 ---- */

  function makeRainbow() {
    const g = new THREE.Group();
    const colors = [0xff6b8a, 0xffa14d, 0xffe14d, 0x7fe07f, 0x6fc8ff, 0xb48aff];
    colors.forEach((c, i) => {
      const r = 13 - i * 0.62;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.34, 10, 48, Math.PI),
        new THREE.MeshBasicMaterial({ color: c })
      );
      g.add(mesh);
    });
    return g;
  }

  /* ---- お部屋（1部屋完結・ピンク基調のジオラマ） ---- */

  const PALETTE = {
    wallPink: 0xffc4dc,
    wallPinkDark: 0xff9ec8,
    floorPink: 0xffdce9,
    carpet: 0xff9ec4,
    white: 0xffffff,
    cream: 0xfff6e8,
    wood: 0xf2c48f,
    mint: 0xa8e6d5,
    yellow: 0xffe08a,
    lavender: 0xd9c2ff,
  };

  function makeWindowWall(width, height, thickness, opening) {
    // opening: { x, y, w, h } 壁ローカル座標での窓穴
    const g = new THREE.Group();
    const mat = toonMat(PALETTE.wallPink);
    const { x: ox, y: oy, w: ow, h: oh } = opening;
    const halfW = width / 2;

    function panel(w, h, cx, cy) {
      if (w <= 0.01 || h <= 0.01) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), mat);
      m.position.set(cx, cy, 0);
      m.receiveShadow = true;
      m.castShadow = true;
      g.add(m);
    }

    const leftW = (ox - ow / 2) - (-halfW);
    const rightW = halfW - (ox + ow / 2);
    panel(leftW, height, -halfW + leftW / 2, height / 2);
    panel(rightW, height, halfW - rightW / 2, height / 2);
    panel(ow, oy - oh / 2, ox, (oy - oh / 2) / 2);
    panel(ow, height - (oy + oh / 2), ox, oy + oh / 2 + (height - (oy + oh / 2)) / 2);

    // 白い窓枠
    const frameMat = toonMat(PALETTE.white);
    const ft = 0.1;
    [
      [ow + ft * 2, ft, ox, oy + oh / 2 + ft / 2],
      [ow + ft * 2, ft, ox, oy - oh / 2 - ft / 2],
      [ft, oh, ox - ow / 2 - ft / 2, oy],
      [ft, oh, ox + ow / 2 + ft / 2, oy],
      [ft * 0.8, oh, ox, oy],           // 中央の桟（縦）
      [ow, ft * 0.8, ox, oy],           // 中央の桟（横）
    ].forEach(([w, h, cx, cy]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness + 0.06), frameMat);
      m.position.set(cx, cy, 0);
      g.add(m);
    });

    // カーテン
    const curtainMat = toonMat(PALETTE.wallPinkDark);
    [-1, 1].forEach((side) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, oh + 0.3, 10), curtainMat);
      c.position.set(ox + side * (ow / 2 + 0.16), oy, thickness / 2 + 0.18);
      c.scale.z = 0.55;
      g.add(c);
    });

    // 上のふち飾り
    const trim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, width, 10),
      toonMat(PALETTE.white)
    );
    trim.rotation.z = Math.PI / 2;
    trim.position.set(0, height + 0.02, 0);
    g.add(trim);

    return g;
  }

  function makeCrib() {
    const g = new THREE.Group();
    const wood = toonMat(PALETTE.white);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 1.0), wood);
    base.position.y = 0.32;
    base.castShadow = true;
    g.add(base);
    // マットと毛布
    const mat = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.14, 0.86), toonMat(PALETTE.cream));
    mat.position.y = 0.45;
    g.add(mat);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.1, 0.5), toonMat(PALETTE.carpet));
    blanket.position.set(0, 0.5, 0.14);
    g.add(blanket);
    const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), toonMat(PALETTE.white));
    pillow.scale.set(1.3, 0.55, 1);
    pillow.position.set(0, 0.56, -0.28);
    g.add(pillow);
    // 柵
    const railGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.62, 8);
    for (let i = 0; i <= 6; i++) {
      const x = -0.7 + (i / 6) * 1.4;
      const back = new THREE.Mesh(railGeo, wood);
      back.position.set(x, 0.62, -0.48);
      g.add(back);
      const front = new THREE.Mesh(railGeo, wood);
      front.position.set(x, 0.62, 0.48);
      g.add(front);
    }
    [-1, 1].forEach((s) => {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.06, 8), wood);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(s * 0.72, 0.93, 0);
      g.add(bar);
      for (let i = 0; i <= 3; i++) {
        const z = -0.42 + (i / 3) * 0.84;
        const p = new THREE.Mesh(railGeo, wood);
        p.position.set(s * 0.72, 0.62, z);
        g.add(p);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), toonMat(PALETTE.carpet));
      ball.position.set(s * 0.72, 1.02, -0.48);
      g.add(ball);
      const ball2 = ball.clone();
      ball2.position.z = 0.48;
      g.add(ball2);
    });
    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), wood);
    topRail.rotation.z = Math.PI / 2;
    topRail.position.set(0, 0.93, -0.48);
    g.add(topRail);
    const topRail2 = topRail.clone();
    topRail2.position.z = 0.48;
    g.add(topRail2);
    return g;
  }

  function makeToyBox() {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), toonMat(PALETTE.mint));
    box.position.y = 0.25;
    box.castShadow = true;
    g.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.1, 0.66), toonMat(PALETTE.white));
    lid.position.y = 0.53;
    g.add(lid);
    // 中からのぞくおもちゃ
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), toonMat(PALETTE.yellow));
    ball.position.set(-0.2, 0.62, 0);
    g.add(ball);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), toonMat(PALETTE.lavender));
    block.position.set(0.18, 0.64, 0.05);
    block.rotation.y = 0.5;
    g.add(block);
    return g;
  }

  function makeDresser() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.5), toonMat(PALETTE.white));
    body.position.y = 0.425;
    body.castShadow = true;
    g.add(body);
    const drawerMat = toonMat(PALETTE.wallPink);
    [0.22, 0.62].forEach((y) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.28, 0.06), drawerMat);
      d.position.set(0, y, 0.25);
      g.add(d);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toonMat(PALETTE.yellow));
      knob.position.set(0, y, 0.3);
      g.add(knob);
    });
    // 上にランプ
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.24, 10), toonMat(PALETTE.mint));
    lampBase.position.set(-0.3, 0.97, 0);
    g.add(lampBase);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12), toonMat(PALETTE.yellow, { emissive: 0x775500 }));
    shade.position.set(-0.3, 1.16, 0);
    g.add(shade);
    return g;
  }

  function makeTeddy() {
    const g = new THREE.Group();
    const mat = toonMat(0xd9a066);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
    body.position.y = 0.16;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
    head.position.y = 0.36;
    g.add(head);
    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat);
      ear.position.set(s * 0.09, 0.46, 0);
      g.add(ear);
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat);
      arm.scale.set(1, 1.4, 1);
      arm.position.set(s * 0.16, 0.18, 0.04);
      g.add(arm);
      const leg = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat);
      leg.position.set(s * 0.1, 0.05, 0.08);
      g.add(leg);
    });
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), toonMat(PALETTE.cream));
    muzzle.position.set(0, 0.33, 0.1);
    g.add(muzzle);
    return g;
  }

  function makeBlocks() {
    const g = new THREE.Group();
    const colors = [PALETTE.yellow, PALETTE.mint, PALETTE.lavender, PALETTE.carpet];
    const positions = [[0, 0.09, 0], [0.22, 0.09, 0.1], [0.1, 0.27, 0.05], [-0.2, 0.09, 0.14]];
    positions.forEach(([x, y, z], i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), toonMat(colors[i % colors.length]));
      b.position.set(x, y, z);
      b.rotation.y = i * 0.6;
      b.castShadow = true;
      g.add(b);
    });
    return g;
  }

  function makeBalloon(color) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), toonMat(color));
    b.scale.set(1, 1.15, 1);
    g.add(b);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 8), toonMat(color));
    knot.position.y = -0.3;
    knot.rotation.x = Math.PI;
    g.add(knot);
    const stringGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4);
    const string = new THREE.Mesh(stringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    string.position.y = -0.78;
    g.add(string);
    return g;
  }

  /* ---- 世界を組み立てる ---- */

  function build(scene) {
    const world = new THREE.Group();
    scene.add(world);

    // 空
    const { sky, uniforms: skyUniforms } = makeSky();
    world.add(sky);

    // 太陽
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
    );
    sun.position.set(-18, 20, -30);
    world.add(sun);

    // お月さま（夜用・普段は空の色に溶ける位置）
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff8d9, transparent: true, opacity: 0 })
    );
    moon.position.set(16, 18, -28);
    world.add(moon);

    // 虹（お部屋のうしろに大きく）
    const rainbow = makeRainbow();
    rainbow.position.set(0, -1.5, -22);
    world.add(rainbow);

    // ながれる雲
    const driftClouds = new THREE.Group();
    const cloudDefs = [
      [10, 5, -16, 1.6], [-12, 7, -14, 1.3], [14, 9, 6, 1.5], [-15, 4, 8, 1.2],
      [4, 11, -24, 2.0], [-6, 3, 18, 1.4], [18, 6, -4, 1.1], [-18, 9, -6, 1.7],
    ];
    cloudDefs.forEach(([x, y, z, s]) => {
      const c = makeCloud(s);
      c.position.set(x, y, z);
      driftClouds.add(c);
    });
    world.add(driftClouds);

    // 足もとの雲の島
    const islandClouds = new THREE.Group();
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 4.1 + Math.sin(i * 2.7) * 0.5;
      const c = makeCloud(0.9 + (i % 3) * 0.25);
      c.position.set(Math.cos(a) * r, -0.85 - (i % 2) * 0.25, Math.sin(a) * r);
      islandClouds.add(c);
    }
    const centerPuff = makeCloud(2.6);
    centerPuff.position.set(0, -3.0, 0);
    islandClouds.add(centerPuff);
    world.add(islandClouds);

    // 床（土台 + カーペット）
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(4.3, 4.5, 0.34, 36),
      toonMat(PALETTE.floorPink)
    );
    platform.position.y = -0.17;
    platform.receiveShadow = true;
    world.add(platform);

    const carpet = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 2.9, 0.06, 32),
      toonMat(PALETTE.carpet)
    );
    carpet.position.y = 0.03;
    carpet.receiveShadow = true;
    world.add(carpet);

    // ハートのラグ
    const heartGeo = new THREE.ShapeGeometry(heartShape());
    const rug = new THREE.Mesh(heartGeo, toonMat(0xffb0cf));
    rug.scale.setScalar(0.13);
    rug.rotation.x = -Math.PI / 2;
    rug.rotation.z = Math.PI;
    rug.position.set(0, 0.075, 0.6);
    rug.receiveShadow = true;
    world.add(rug);

    // 壁（うしろと左・窓つき）
    const wallH = 3.1;
    const backWall = makeWindowWall(7.6, wallH, 0.18, { x: 0.9, y: 1.7, w: 1.7, h: 1.3 });
    backWall.position.set(0, 0, -3.5);
    world.add(backWall);

    const leftWall = makeWindowWall(7.6, wallH, 0.18, { x: -0.8, y: 1.7, w: 1.7, h: 1.3 });
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-3.5, 0, 0);
    world.add(leftWall);

    // 壁の飾り（ハートと星）
    const heartDecoGeo = new THREE.ExtrudeGeometry(heartShape(), { depth: 1.2, bevelEnabled: false });
    const heartDeco = new THREE.Mesh(heartDecoGeo, toonMat(0xff7fb0));
    heartDeco.scale.setScalar(0.035);
    heartDeco.rotation.z = Math.PI;
    heartDeco.position.set(-1.6, 2.35, -3.38);
    world.add(heartDeco);

    const heartDeco2 = heartDeco.clone();
    heartDeco2.material = toonMat(PALETTE.yellow);
    heartDeco2.scale.setScalar(0.024);
    heartDeco2.rotation.y = Math.PI / 2;
    heartDeco2.rotation.z = Math.PI;
    heartDeco2.position.set(-3.38, 2.4, 1.5);
    world.add(heartDeco2);

    // 額縁（にじの絵）
    const frame = new THREE.Group();
    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.06), toonMat(PALETTE.white));
    frame.add(frameOuter);
    const framePic = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.58, 0.07), toonMat(0xbfe8ff));
    frame.add(framePic);
    const miniRainbowColors = [0xff6b8a, 0xffe14d, 0x6fc8ff];
    miniRainbowColors.forEach((c, i) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.24 - i * 0.06, 0.025, 6, 20, Math.PI),
        new THREE.MeshBasicMaterial({ color: c })
      );
      arc.position.set(0, -0.14, 0.04);
      frame.add(arc);
    });
    frame.position.set(-2.6, 2.1, -3.38);
    world.add(frame);

    // 家具
    const crib = makeCrib();
    crib.position.set(-2.2, 0, -2.5);
    crib.rotation.y = 0.35;
    world.add(crib);

    const toyBox = makeToyBox();
    toyBox.position.set(2.4, 0, -2.6);
    toyBox.rotation.y = -0.4;
    world.add(toyBox);

    const dresser = makeDresser();
    dresser.position.set(-2.9, 0, 0.9);
    dresser.rotation.y = Math.PI / 2;
    world.add(dresser);

    const teddy = makeTeddy();
    teddy.position.set(1.9, 0.06, 1.7);
    teddy.rotation.y = -0.8;
    world.add(teddy);

    const blocks = makeBlocks();
    blocks.position.set(-1.5, 0.06, 1.4);
    world.add(blocks);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), toonMat(PALETTE.mint));
    ball.position.set(2.6, 0.3, 0.4);
    ball.castShadow = true;
    world.add(ball);
    const ballStripe = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 24), toonMat(PALETTE.carpet));
    ballStripe.position.copy(ball.position);
    ballStripe.rotation.x = Math.PI / 2;
    world.add(ballStripe);

    // ふうせん
    const balloons = new THREE.Group();
    const balloon1 = makeBalloon(0xff8fbf);
    balloon1.position.set(3.1, 1.9, -1.4);
    balloons.add(balloon1);
    const balloon2 = makeBalloon(0x8fd3ff);
    balloon2.position.set(3.4, 2.2, -0.7);
    balloons.add(balloon2);
    world.add(balloons);

    /* ---- 更新・昼夜 ---- */

    let t = 0;
    let nightMix = 0;

    function update(dt) {
      t += dt;
      driftClouds.rotation.y = t * 0.012;
      driftClouds.children.forEach((c, i) => {
        c.position.y += Math.sin(t * 0.5 + i * 1.7) * 0.0012;
      });
      balloons.children.forEach((b, i) => {
        b.position.y += Math.sin(t * 1.1 + i * 2.1) * 0.0016;
        b.rotation.z = Math.sin(t * 0.9 + i) * 0.06;
      });
      islandClouds.rotation.y = Math.sin(t * 0.05) * 0.05;
    }

    function setNight(mix) {
      nightMix = mix;
      skyUniforms.nightMix.value = mix;
      moon.material.opacity = mix;
      sun.material.color.setHex(mix > 0.5 ? 0xccc4a8 : 0xfff3b0);
    }

    return {
      group: world,
      update,
      setNight,
      getNight: () => nightMix,
      cribPosition: new THREE.Vector3(-2.2, 0.55, -2.5),
      toonMat,
      heartShape,
      PALETTE,
    };
  }

  window.World = { build, toonMat, heartShape, PALETTE };
})();
