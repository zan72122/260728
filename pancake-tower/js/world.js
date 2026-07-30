/* ============================================================
 * world.js — レンダラー / シーン / カメラ / 舞台美術
 * ============================================================ */
(function () {
  const W = {
    renderer: null, scene: null, camera: null,
    servePlates: [],   // {pos:V3, mesh, stackH}
    camAz: 0.6, camPol: 1.08, camDist: 15, camTargetY: 3,
    camAzVel: 0, autoRot: true,
    decorations: {},
    clouds: [],
    time: 0,
  };
  PT.World = W;

  W.init = function (canvas) {
    W.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    W.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    W.renderer.outputEncoding = THREE.sRGBEncoding;
    W.renderer.shadowMap.enabled = true;
    W.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    W.scene = new THREE.Scene();
    W.scene.fog = new THREE.Fog(0xffe0ee, 30, 80);

    W.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);

    // ---- 光 ----
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0xffc9de, 0.55);
    W.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 0.85);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 44;
    sun.shadow.bias = -0.002;
    W.scene.add(sun);

    // ---- 空 ----
    const skyGeo = new THREE.SphereGeometry(90, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: PT.skyTexture(), side: THREE.BackSide, fog: false });
    W.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // ---- テーブル ----
    const table = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48),
      new THREE.MeshStandardMaterial({ map: PT.tableTexture(), roughness: 0.95 })
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    W.scene.add(table);

    // ---- 中央の大皿 ----
    W.scene.add(makePlate(new THREE.Vector3(0, 0, 0), PT.PLATE_R, PT.PLATE_H, 0xffffff, 0xffb3cf));

    // ---- サーブ皿（3枚） ----
    const plateCols = [0xffc94d, 0x5ecfa5, 0x7fa8f5];
    PT.SERVE_ANGLES.forEach((a, i) => {
      const pos = new THREE.Vector3(Math.cos(a) * PT.SERVE_DIST, 0, Math.sin(a) * PT.SERVE_DIST);
      const mesh = makePlate(pos, PT.SERVE_R, PT.SERVE_H, 0xffffff, plateCols[i]);
      W.scene.add(mesh);
      W.servePlates.push({ pos, mesh, count: 0 });
    });

    // ---- 雲 ----
    for (let i = 0; i < 7; i++) {
      const cl = makeCloud();
      const a = PT.rand(0, Math.PI * 2);
      const r = PT.rand(24, 46);
      cl.position.set(Math.cos(a) * r, PT.rand(9, 22), Math.sin(a) * r);
      cl.userData.baseY = cl.position.y;
      cl.userData.ph = PT.rand(0, 6);
      W.scene.add(cl);
      W.clouds.push(cl);
    }

    // ---- アンロック飾り（最初は非表示） ----
    W.decorations.rainbow = makeRainbow();
    W.decorations.rainbow.visible = false;
    W.scene.add(W.decorations.rainbow);
    W.decorations.balloon = makeBalloon();
    W.decorations.balloon.visible = false;
    W.scene.add(W.decorations.balloon);
    W.decorations.castle = makeCastle();
    W.decorations.castle.visible = false;
    W.scene.add(W.decorations.castle);

    W.resize();
    window.addEventListener('resize', W.resize);
  };

  function makePlate(pos, r, h, col, rimCol) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.72, h, 36),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })
    );
    body.position.y = h / 2;
    body.receiveShadow = true;
    body.castShadow = true;
    grp.add(body);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.97, h * 0.22, 10, 40),
      new THREE.MeshStandardMaterial({ color: rimCol, roughness: 0.4 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h * 0.95;
    grp.add(rim);
    grp.position.copy(pos);
    return grp;
  }

  function makeCloud() {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xfff0f6, emissiveIntensity: 0.35 });
    const n = PT.randi(3, 5);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(PT.rand(1.2, 2.4), 10, 8), mat);
      s.position.set(i * 1.6 - n * 0.8, PT.rand(-0.4, 0.4), PT.rand(-0.6, 0.6));
      s.scale.y = 0.65;
      grp.add(s);
    }
    return grp;
  }

  function makeRainbow() {
    const grp = new THREE.Group();
    const cols = [0xff8fa3, 0xffc48f, 0xfff59d, 0xa8e6cf, 0x9fc9ff, 0xd0b3ff];
    cols.forEach((c, i) => {
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(16 - i * 0.9, 0.42, 8, 40, Math.PI),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.25, fog: false })
      );
      grp.add(t);
    });
    grp.position.set(0, 0, -34);
    return grp;
  }

  function makeBalloon() {
    const grp = new THREE.Group();
    const b = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xff8fb3, roughness: 0.5, emissive: 0xff5f93, emissiveIntensity: 0.15 })
    );
    b.scale.y = 1.15;
    grp.add(b);
    const stripe = new THREE.Mesh(
      new THREE.SphereGeometry(2.62, 16, 12, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xfff3b8, roughness: 0.5 })
    );
    stripe.scale.y = 1.15;
    grp.add(stripe);
    const basket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.55, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.9 })
    );
    basket.position.y = -3.6;
    grp.add(basket);
    grp.position.set(-20, 14, -18);
    return grp;
  }

  function makeCastle() {
    const grp = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffe9f2, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xff8fb3, roughness: 0.7 });
    function tower(x, z, h, r) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), wallMat);
      t.position.set(x, h / 2, z);
      grp.add(t);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, r * 2.6, 10), roofMat);
      roof.position.set(x, h + r * 1.3, z);
      grp.add(roof);
    }
    tower(0, 0, 10, 2.2);
    tower(-4.5, 1.5, 7, 1.5);
    tower(4.5, 1.5, 7, 1.5);
    const gate = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 2.6), wallMat);
    gate.position.set(0, 2.2, 1.5);
    grp.add(gate);
    grp.position.set(26, 0, -26);
    grp.rotation.y = -0.6;
    return grp;
  }

  // ---- カメラ ----
  W.resize = function () {
    const w = window.innerWidth, h = window.innerHeight;
    W.renderer.setSize(w, h, false);
    W.camera.aspect = w / h;
    // 縦画面では少し広角に
    W.camera.fov = w < h ? 58 : 46;
    W.camera.updateProjectionMatrix();
  };

  W.updateCamera = function (dt, towerTopY, interacting, zoom) {
    // 目標距離: 塔の高さと画面向きに応じて
    const portrait = window.innerWidth < window.innerHeight;
    const wantDist = Math.max(13, towerTopY * (portrait ? 2.0 : 1.65) + 6.5) * (zoom || 1);
    W.camDist = PT.lerp(W.camDist, wantDist, 1 - Math.pow(0.15, dt));
    const wantTy = Math.max(2.5, towerTopY * 0.42);
    W.camTargetY = PT.lerp(W.camTargetY, wantTy, 1 - Math.pow(0.2, dt));

    if (W.autoRot && !interacting) W.camAzVel += (0.045 - W.camAzVel) * dt * 0.8;
    W.camAz += W.camAzVel * dt;
    W.camAzVel *= Math.pow(0.12, dt);
    W.camPol = PT.clamp(W.camPol, 0.62, 1.32);

    const sp = Math.sin(W.camPol), cp = Math.cos(W.camPol);
    W.camera.position.set(
      Math.cos(W.camAz) * sp * W.camDist,
      cp * W.camDist + W.camTargetY,
      Math.sin(W.camAz) * sp * W.camDist
    );
    W.camera.lookAt(0, W.camTargetY, 0);
  };

  W.update = function (dt) {
    W.time += dt;
    W.clouds.forEach((c) => {
      c.position.y = c.userData.baseY + Math.sin(W.time * 0.4 + c.userData.ph) * 0.6;
      c.rotation.y += dt * 0.02;
    });
    if (W.decorations.balloon.visible) {
      W.decorations.balloon.position.y = 14 + Math.sin(W.time * 0.5) * 1.2;
      W.decorations.balloon.rotation.y += dt * 0.1;
    }
  };
})();
