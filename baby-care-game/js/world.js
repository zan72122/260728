import * as THREE from 'three';

// 3段階のトゥーン用グラデーションテクスチャ
let toonGradient = null;
function gradientMap() {
  if (!toonGradient) {
    toonGradient = new THREE.DataTexture(
      new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
    toonGradient.minFilter = THREE.NearestFilter;
    toonGradient.magFilter = THREE.NearestFilter;
    toonGradient.needsUpdate = true;
  }
  return toonGradient;
}

export function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ---------- 空・虹・雲 ----------
function makeSky() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#6ec2ff');
  grad.addColorStop(0.55, '#aee0ff');
  grad.addColorStop(0.78, '#fdeaf5');
  grad.addColorStop(1, '#ffd9ec');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(38, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  return sky;
}

const RAINBOW_COLORS = [0xff5f6d, 0xff9a3d, 0xffd93d, 0x6dd873, 0x5fb7ff, 0x7a7aff, 0xc17aff];

function makeRainbow(radius = 1, tube = 0.06) {
  const group = new THREE.Group();
  RAINBOW_COLORS.forEach((c, i) => {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius + i * tube * 2.05, tube, 10, 48, Math.PI),
      new THREE.MeshBasicMaterial({ color: c })
    );
    group.add(torus);
  });
  return group;
}

function makeCloud(scale = 1) {
  const group = new THREE.Group();
  const mat = toon(0xffffff);
  const blobs = [
    [0, 0, 0, 0.5], [0.45, 0.08, 0.05, 0.38], [-0.45, 0.05, -0.05, 0.36],
    [0.15, 0.28, 0, 0.34], [-0.2, 0.24, 0.08, 0.3],
  ];
  for (const [x, y, z, r] of blobs) {
    group.add(mesh(new THREE.SphereGeometry(r, 14, 12), mat, x, y, z, false));
  }
  group.scale.setScalar(scale);
  return group;
}

// ---------- 窓つきの壁 ----------
// 壁はローカルXY平面（+Z が部屋の内側）で作り、あとで回して配置する。
// 平面は表しか描画しないので、カメラが外側に回ると自動的に壁が消えて中が見える。
function makeWall(width, height, mat, win = null) {
  const group = new THREE.Group();
  const plane = (w, h, x, y) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, 0);
    p.receiveShadow = true;
    group.add(p);
  };
  if (!win) {
    plane(width, height, 0, height / 2);
    return group;
  }
  const { x: wx, y: wy, w: ww, h: wh } = win;
  const left = wx - ww / 2;
  const right = wx + ww / 2;
  const bottom = wy - wh / 2;
  const top = wy + wh / 2;
  plane(width, bottom, 0, bottom / 2); // 窓の下
  plane(width, height - top, 0, (height + top) / 2); // 窓の上
  plane(left + width / 2, wh, (left - width / 2) / 2, wy); // 窓の左
  plane(width / 2 - right, wh, (right + width / 2) / 2, wy); // 窓の右

  // 白い窓枠と桟
  const frameMat = toon(0xffffff);
  const t = 0.09;
  const bar = (w, h, x, y, z = 0.02) =>
    group.add(mesh(new THREE.BoxGeometry(w, h, 0.08), frameMat, x, y, z, false));
  bar(ww + t * 2, t, wx, top + t / 2);
  bar(ww + t * 2, t, wx, bottom - t / 2);
  bar(t, wh + t * 2, left - t / 2, wy);
  bar(t, wh + t * 2, right + t / 2, wy);
  bar(ww, t * 0.6, wx, wy); // 十字の桟
  bar(t * 0.6, wh, wx, wy);

  // カーテン
  const curtainMat = toon(0xffb7d5, { side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const c = mesh(
      new THREE.PlaneGeometry(0.34, wh + 0.5),
      curtainMat,
      wx + side * (ww / 2 + 0.24), wy + 0.05, 0.09, false);
    group.add(c);
  }
  return group;
}

// ---------- 家具 ----------
function makeCrib() {
  const group = new THREE.Group();
  const white = toon(0xfffdfd);
  const pink = toon(0xffc2da);
  const W = 1.7, D = 1.0, H = 1.05;
  group.add(mesh(new THREE.BoxGeometry(W, 0.3, D), pink, 0, 0.42, 0)); // マットレス
  group.add(mesh(new THREE.BoxGeometry(W - 0.15, 0.1, D - 0.15), toon(0xfff3f8), 0, 0.6, 0)); // おふとん
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, H, 10), white, sx * W / 2, H / 2, sz * D / 2));
      group.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), pink, sx * W / 2, H + 0.04, sz * D / 2));
    }
  }
  for (const sz of [-1, 1]) {
    group.add(mesh(new THREE.BoxGeometry(W, 0.07, 0.06), white, 0, 0.95, sz * D / 2));
    for (let i = 1; i <= 6; i++) {
      const x = -W / 2 + (W / 7) * i;
      group.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8), white, x, 0.73, sz * D / 2));
    }
  }
  return group;
}

function makeShelf() {
  const group = new THREE.Group();
  const white = toon(0xfffdfd);
  group.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.42), white, 0, 0.45, 0));
  group.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.42), white, 0, 0.95, 0));
  for (const sx of [-1, 1]) {
    group.add(mesh(new THREE.BoxGeometry(0.08, 1.0, 0.42), toon(0xffd7e6), sx * 0.72, 0.5, 0));
  }
  // つみき
  const colors = [0xff8fb3, 0x8fd4ff, 0xffe08f];
  colors.forEach((c, i) => {
    group.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), toon(c), -0.4 + i * 0.32, 1.09, 0));
  });
  // あひる
  const duck = new THREE.Group();
  const yellow = toon(0xffd94d);
  duck.add(mesh(new THREE.SphereGeometry(0.14, 14, 12), yellow, 0, 0.12, 0));
  duck.add(mesh(new THREE.SphereGeometry(0.1, 14, 12), yellow, 0.1, 0.26, 0));
  duck.add(mesh(new THREE.ConeGeometry(0.045, 0.09, 10), toon(0xff8a3d), 0.21, 0.25, 0)).children;
  duck.children[2].rotation.z = -Math.PI / 2;
  duck.position.set(0.35, 0.49, 0);
  group.add(duck);
  // おむつのストック
  for (let i = 0; i < 2; i++) {
    group.add(mesh(new THREE.BoxGeometry(0.34, 0.22, 0.3), toon(0xffffff), -0.35 + i * 0.42, 0.62, 0));
  }
  return group;
}

function makeChangingMat() {
  const group = new THREE.Group();
  group.add(mesh(new THREE.BoxGeometry(1.45, 0.08, 0.95), toon(0xffffff), 0, 0.04, 0));
  group.add(mesh(new THREE.BoxGeometry(1.3, 0.06, 0.8), toon(0xffe3ef), 0, 0.1, 0));
  const bolster = new THREE.CapsuleGeometry(0.07, 1.16, 6, 10);
  for (const sz of [-1, 1]) {
    const b = mesh(bolster, toon(0xffb7d5), 0, 0.14, sz * 0.42);
    b.rotation.z = Math.PI / 2;
    group.add(b);
  }
  return group;
}

function makeDiaperPot() {
  const group = new THREE.Group();
  const purple = toon(0xd4c2fb);
  group.add(mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.58, 18), purple, 0, 0.29, 0));
  const lid = new THREE.Group();
  lid.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18), toon(0xbba4f5), 0, 0.05, 0));
  lid.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon(0xfff3f8), 0, 0.13, 0));
  lid.position.y = 0.58;
  group.add(lid);
  group.userData.lid = lid;
  // にこにこの目玉シール
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5a4a6a });
  for (const sx of [-1, 1]) {
    group.add(mesh(new THREE.SphereGeometry(0.028, 8, 8), eyeMat, sx * 0.09, 0.4, 0.23, false));
  }
  return group;
}

// ---------- 部屋ぜんたい ----------
export function buildWorld(scene) {
  scene.add(makeSky());

  // そとの虹と雲とおひさま
  const bigRainbow = makeRainbow(5.2, 0.16);
  bigRainbow.position.set(1.2, -1.5, -16);
  scene.add(bigRainbow);
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe27a }));
  sun.position.set(-9, 9, -14);
  scene.add(sun);
  const outdoorClouds = [];
  const cloudSpots = [
    [-5, 4.5, -12, 1.6], [4, 6, -13, 2.0], [9, 3.5, -6, 1.4],
    [12, 5, 2, 1.7], [-11, 6, -3, 1.8], [7, 7.5, -10, 1.2],
  ];
  for (const [x, y, z, s] of cloudSpots) {
    const c = makeCloud(s);
    c.position.set(x, y, z);
    scene.add(c);
    outdoorClouds.push(c);
  }

  // ゆか（ピンクのカーペット + まるいラグ）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), toon(0xffd7e6));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const rug = mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.03, 40), toon(0xffffff), 0, 0.015, 0.3);
  scene.add(rug);
  const rugInner = mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.032, 40), toon(0xffaecf), 0, 0.017, 0.3);
  scene.add(rugInner);

  // かべ4面（外から見ると消える）
  const wallMat = toon(0xfff0f6);
  const H = 3.1;
  const backWall = makeWall(7, H, wallMat, { x: 1.1, y: 1.75, w: 1.7, h: 1.5 });
  backWall.position.set(0, 0, -3.5);
  scene.add(backWall);
  const rightWall = makeWall(7, H, wallMat, { x: -0.6, y: 1.75, w: 1.7, h: 1.5 });
  rightWall.position.set(3.5, 0, 0);
  rightWall.rotation.y = -Math.PI / 2;
  scene.add(rightWall);
  const leftWall = makeWall(7, H, wallMat);
  leftWall.position.set(-3.5, 0, 0);
  leftWall.rotation.y = Math.PI / 2;
  scene.add(leftWall);
  const frontWall = makeWall(7, H, wallMat);
  frontWall.position.set(0, 0, 3.5);
  frontWall.rotation.y = Math.PI;
  scene.add(frontWall);

  // かべの水玉もよう（左かべ）
  for (const [y, z, r, c] of [[1.6, -1.2, 0.28, 0xffc2da], [2.1, 0.4, 0.2, 0xc9e9ff], [1.2, 1.4, 0.24, 0xfff0b3]]) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(r, 24), toon(c));
    dot.position.set(-3.48, y, z);
    dot.rotation.y = Math.PI / 2;
    scene.add(dot);
  }

  // 家具の配置
  const crib = makeCrib();
  crib.position.set(-2.2, 0, -2.6);
  scene.add(crib);

  const shelf = makeShelf();
  shelf.position.set(2.6, 0, -3.15);
  scene.add(shelf);

  const matGroup = makeChangingMat();
  const matCenter = new THREE.Vector3(1.5, 0, 1.1);
  matGroup.position.copy(matCenter);
  matGroup.rotation.y = -0.35;
  scene.add(matGroup);

  const pot = makeDiaperPot();
  const potPos = new THREE.Vector3(2.75, 0, 2.0);
  pot.position.copy(potPos);
  scene.add(pot);

  // ゆかのつみき
  for (const [x, z, c, ry] of [[-1.1, 1.6, 0xa5e8b0, 0.4], [-1.35, 1.35, 0x8fd4ff, -0.3], [-1.2, 1.42, 0xff8fb3, 0.9]]) {
    const b = mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), toon(c), x, 0.11, z);
    b.rotation.y = ry;
    scene.add(b);
  }

  // おへやのなかのファンタジー要素：ちいさな虹と、ふわふわ雲と星
  const miniRainbow = makeRainbow(0.75, 0.045);
  miniRainbow.position.set(-2.2, 1.85, -3.4);
  scene.add(miniRainbow);

  const indoorFloaties = [];
  for (const [x, y, z, s] of [[-2.2, 2.75, -2.4, 0.42], [1.8, 2.9, -1.6, 0.5], [-0.6, 3.0, 1.8, 0.38]]) {
    const c = makeCloud(s);
    c.position.set(x, y, z);
    c.userData.baseY = y;
    c.userData.phase = Math.random() * Math.PI * 2;
    scene.add(c);
    indoorFloaties.push(c);
  }
  const starMat = toon(0xffe27a, { emissive: 0x996f00 });
  for (const [x, y, z] of [[-2.6, 2.2, -2.0], [-1.7, 2.45, -2.3], [0.8, 2.6, -2.9]]) {
    const star = mesh(new THREE.OctahedronGeometry(0.11), starMat, x, y, z, false);
    star.scale.y = 1.4;
    star.userData.baseY = y;
    star.userData.phase = Math.random() * Math.PI * 2;
    scene.add(star);
    indoorFloaties.push(star);
  }

  // ライティング
  scene.add(new THREE.HemisphereLight(0xfff6fa, 0xffc9de, 0.95));
  const sunLight = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sunLight.position.set(4, 7, 4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.05;
  sunLight.shadow.camera.left = -5;
  sunLight.shadow.camera.right = 5;
  sunLight.shadow.camera.top = 6;
  sunLight.shadow.camera.bottom = -5;
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xd8ecff, 0.4);
  fill.position.set(-5, 4, -3);
  scene.add(fill);

  return {
    matCenter,
    matRotationY: -0.35,
    potPos,
    potLid: pot.userData.lid,
    indoorFloaties,
    outdoorClouds,
    update(t) {
      for (const f of indoorFloaties) {
        f.position.y = f.userData.baseY + Math.sin(t * 0.9 + f.userData.phase) * 0.07;
        if (f.geometry) f.rotation.y = t * 0.4 + f.userData.phase; // 星だけくるくる
      }
      for (let i = 0; i < outdoorClouds.length; i++) {
        const c = outdoorClouds[i];
        c.position.x += Math.sin(t * 0.1 + i) * 0.0012;
      }
    },
  };
}
