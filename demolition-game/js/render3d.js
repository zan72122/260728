/* render3d.js — Three.js による3D描画層。
 * 物理は Matter.js の2D（x, y）のまま、描画だけを3D化する。
 * 座標変換: three.x = matter.x / three.y = GROUND_Y - matter.y（地面の上面が y=0）
 */
(function () {
  'use strict';

  const { B, GROUND_Y, BRUSHES } = window.GameLevels;
  const R = {};

  let renderer, scene, camera;
  let levelGroup = null, fxGroup = null;
  let blockMeshes = [], hintNodes = [], neighborNodes = [], cloudNodes = [];
  const fxMap = new Map();   /* パーティクル → Object3D */
  const bombMap = new Map(); /* 爆弾 → 3Dグループ（ブロックに追従） */
  const editMap = new Map(); /* 建築モードの編集セル "c,r,layer" → { mesh, brush:{p,s}, hasWindow, layer } */
  let buildGridDots = [];    /* 建築モードのマス目ガイド（アクティブ層の平面に表示） */
  let editActiveLayer = 1;   /* 建築モードで現在アクティブなレイヤー（既定=なか） */
  let fitInfo = null;

  const ty = (my) => GROUND_Y - my; /* matter y → three y */
  const layerZ = (l) => (l - 1) * B * 1.12; /* レイヤー(0=おく,1=なか,2=まえ) → three z */

  /* ---------- カメラのビュー状態（ピンチズーム・パン・視点回転） ----------
   * zoom: 1が基準（大きいほど近づく）/ panX,panY: ワールド単位のオフセット（panXはmatter/three共通のx、panYはthree空間のy=上方向プラス）
   * az,el: fitCamera基準角(0.22/0.15)への加算オフセット */
  let view = { zoom: 1, panX: 0, panY: 0, az: 0, el: 0 };
  const ZOOM_MIN = 0.45, ZOOM_MAX = 2.6;
  const AZ_MIN = -0.9, AZ_MAX = 0.9;
  const EL_MIN = -0.2, EL_MAX = 0.5;

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function clampView() {
    view.zoom = clampNum(view.zoom, ZOOM_MIN, ZOOM_MAX);
    view.az = clampNum(view.az, AZ_MIN, AZ_MAX);
    view.el = clampNum(view.el, EL_MIN, EL_MAX);
    if (fitInfo && fitInfo.bounds) {
      const b = fitInfo.bounds;
      const bw = b.maxX - b.minX;
      const bh = ty(b.topY) - ty(b.bottomY);
      const maxPan = Math.max(bw, bh) * 0.9 + 260;
      view.panX = clampNum(view.panX, -maxPan, maxPan);
      view.panY = clampNum(view.panY, -maxPan, maxPan);
    }
  }

  /* ---------- キャンバス製テクスチャ ---------- */
  const texCache = new Map();
  function canvasTex(key, w, h, draw) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    texCache.set(key, t);
    return t;
  }

  function skyTex() {
    return canvasTex('sky', 4, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#4fa8e8');
      gr.addColorStop(0.45, '#8fd0f4');
      gr.addColorStop(0.78, '#d6f0fb');
      gr.addColorStop(1, '#f2fbff');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  }

  function softTex() {
    return canvasTex('soft', 128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    });
  }

  function ringTex() {
    return canvasTex('ring', 128, 128, (g) => {
      g.strokeStyle = 'rgba(255,255,255,1)';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(64, 64, 48, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 20;
      g.beginPath();
      g.arc(64, 64, 48, 0, Math.PI * 2);
      g.stroke();
    });
  }

  function cloudTex() {
    return canvasTex('cloud', 256, 128, (g) => {
      g.fillStyle = 'rgba(255,255,255,0.92)';
      for (const [x, y, r] of [[70, 80, 38], [120, 62, 46], [175, 78, 40], [110, 92, 40], [150, 90, 34]]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  function grassTex() {
    return canvasTex('grass', 256, 256, (g, w, h) => {
      g.fillStyle = '#7cb64e';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 420; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        g.fillStyle = Math.random() < 0.5 ? 'rgba(105,160,60,0.6)' : 'rgba(160,205,105,0.6)';
        g.fillRect(x, y, 3, 6);
      }
    });
  }

  function dirtTex() {
    return canvasTex('dirt', 256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#9a8168');
      gr.addColorStop(1, '#7c6650');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  function wallTex(palette, withWindow) {
    const key = 'wall:' + palette.wall + ':' + (withWindow ? 'w' : 'p');
    return canvasTex(key, 128, 128, (g, w, h) => {
      g.fillStyle = palette.wall;
      g.fillRect(0, 0, w, h);
      /* うっすら質感 */
      for (let i = 0; i < 60; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 8, 8);
      }
      /* ふち */
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = 7;
      g.strokeRect(3.5, 3.5, w - 7, h - 7);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 3;
      g.strokeRect(9.5, 9.5, w - 19, h - 19);
      if (withWindow) {
        /* ガラス窓 */
        const wx = 30, wy = 26, ww = 68, wh = 62;
        const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        gr.addColorStop(0, '#eaf9ff');
        gr.addColorStop(0.45, palette.win);
        gr.addColorStop(1, '#69b7dd');
        g.fillStyle = gr;
        g.fillRect(wx, wy, ww, wh);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 6;
        g.strokeRect(wx, wy, ww, wh);
        g.beginPath();
        g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh);
        g.moveTo(wx, wy + wh / 2); g.lineTo(wx + ww, wy + wh / 2);
        g.lineWidth = 4;
        g.stroke();
        /* まどのした かげ */
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(wx - 4, wy + wh + 4, ww + 8, 8);
      }
    });
  }

  function houseTex(n, mood) {
    const key = 'house:' + n.color + ':' + n.roof + ':' + mood;
    return canvasTex(key, 256, 256, (g, w, h) => {
      g.fillStyle = n.color;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
      /* とびら */
      g.fillStyle = n.roof;
      g.beginPath();
      const dw = 56, dh = 92, dx = w / 2 - dw / 2, dy = h - dh - 8;
      g.moveTo(dx, dy + dh); g.lineTo(dx, dy + 22);
      g.arc(dx + dw / 2, dy + 22, dw / 2, Math.PI, 0);
      g.lineTo(dx + dw, dy + dh);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffe9b8';
      g.beginPath();
      g.arc(dx + dw - 12, dy + dh / 2 + 8, 5, 0, Math.PI * 2);
      g.fill();
      /* まど x2 */
      for (const mx of [34, w - 34 - 44]) {
        g.fillStyle = '#fff6d8';
        g.fillRect(mx, 138, 44, 40);
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.lineWidth = 4;
        g.strokeRect(mx, 138, 44, 40);
      }
      /* かお */
      g.fillStyle = '#3d2c1e';
      g.strokeStyle = '#3d2c1e';
      const fy = 74;
      if (mood === 'happy') {
        g.beginPath(); g.arc(w / 2 - 36, fy, 9, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(w / 2 + 36, fy, 9, 0, Math.PI * 2); g.fill();
        g.lineWidth = 8;
        g.beginPath(); g.arc(w / 2, fy + 6, 30, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        /* ほっぺ */
        g.fillStyle = 'rgba(255,120,120,0.4)';
        g.beginPath(); g.arc(w / 2 - 58, fy + 18, 10, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(w / 2 + 58, fy + 18, 10, 0, Math.PI * 2); g.fill();
      } else {
        g.lineWidth = 7;
        g.beginPath(); g.arc(w / 2 - 36, fy, 12, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(w / 2 + 36, fy, 12, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(w / 2, fy + 34, 13, 0, Math.PI * 2); g.stroke();
      }
    });
  }

  function tntTex() {
    return canvasTex('tnt', 128, 128, (g, w, h) => {
      g.fillStyle = '#e63946';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.06 + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 10, 10);
      }
      g.fillStyle = '#fff5e6';
      g.fillRect(0, 46, w, 36);
      g.fillStyle = '#9d2230';
      g.font = 'bold 26px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TNT', w / 2, 64);
    });
  }

  function coneTex() {
    return canvasTex('cone', 32, 64, (g, w, h) => {
      g.fillStyle = '#ff7a1a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 26, w, 12);
    });
  }

  /* ---------- マテリアル ---------- */
  const matCache = new Map();
  function cachedMat(key, make) {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  }

  function shadeColor(hex, mult) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(mult);
    return c;
  }

  /* ---------- そざい別テクスチャ（いし・き・ゴム・ガラス） ---------- */
  function stoneTex(pal) {
    return canvasTex('stone:' + pal.wall, 128, 128, (g, w, h) => {
      g.fillStyle = pal.wall;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        g.fillStyle = 'rgba(0,0,0,' + (0.04 + Math.random() * 0.10) + ')';
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 9, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.08) + ')';
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
    });
  }

  function woodTex(pal) {
    return canvasTex('wood:' + pal.wall, 128, 128, (g, w, h) => {
      g.fillStyle = pal.wall;
      g.fillRect(0, 0, w, h);
      for (let y = 6; y < h; y += 20) {
        g.strokeStyle = 'rgba(0,0,0,0.14)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y + (Math.random() * 6 - 3));
        g.stroke();
      }
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = 'rgba(255,255,255,0.10)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, i * 14 + 4);
        g.lineTo(w, i * 14 + 4);
        g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
    });
  }

  function rubberTex(pal) {
    return canvasTex('rubber:' + pal.wall, 64, 64, (g, w, h) => {
      g.fillStyle = pal.wall;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = 'rgba(0,0,0,0.05)';
        g.fillRect(Math.random() * w, Math.random() * h, 4, 4);
      }
    });
  }

  /* ブロックの正面テクスチャ（素材ごとに切り替え。ガラスはテクスチャ無し＝flat透明色） */
  function materialFaceTex(pal, withWindow) {
    const material = pal.material || 'normal';
    if (material === 'stone') return stoneTex(pal);
    if (material === 'wood') return woodTex(pal);
    if (material === 'rubber') return rubberTex(pal);
    if (material === 'glass') return null;
    return wallTex(pal, withWindow);
  }

  function faceMaterial(pal, withWindow, opacity) {
    const tex = materialFaceTex(pal, withWindow);
    const params = tex ? { map: tex } : { color: pal.wall };
    if (opacity != null) { params.transparent = true; params.opacity = opacity; }
    return new THREE.MeshLambertMaterial(params);
  }

  function sideMaterial(pal, mult, opacity) {
    const params = { color: shadeColor(pal.wall, mult) };
    if (opacity != null) { params.transparent = true; params.opacity = opacity; }
    return new THREE.MeshLambertMaterial(params);
  }

  /* かたち別のマテリアル配列を作る。opts: { withWindow, dim }
   * shape: 'sq'(四角=既存6面) | 'tri'(三角柱=2面) | 'cir'(円柱パック=3面) */
  function blockMats(palette, shape, opts) {
    opts = opts || {};
    const withWindow = !!opts.withWindow;
    const dim = !!opts.dim;
    const material = palette.material || 'normal';
    const key = 'blk:' + shape + ':' + palette.wall + ':' + material + ':' +
      (withWindow ? 'w' : 'p') + ':' + (dim ? 'd' : 'n');
    return cachedMat(key, () => {
      const isGlass = material === 'glass';
      const faceOpacity = dim ? 0.3 : (isGlass ? 0.5 : null);
      const sideOpacity = dim ? 0.3 : (isGlass ? 0.5 : null);
      const face = faceMaterial(palette, withWindow, faceOpacity);
      if (shape === 'tri') {
        const side = sideMaterial(palette, 0.8, sideOpacity);
        return [side, face]; /* [がわ(押し出し), まえ・うしろのキャップ] */
      }
      if (shape === 'cir') {
        const side = sideMaterial(palette, 0.85, sideOpacity);
        const back = sideMaterial(palette, 0.65, sideOpacity);
        return [side, face, back]; /* [がわ, まえ(平面), うしろ(平面)] */
      }
      const side = sideMaterial(palette, 0.78, sideOpacity);
      const top = sideMaterial(palette, 1.06, sideOpacity);
      const bottom = sideMaterial(palette, 0.6, sideOpacity);
      const back = sideMaterial(palette, 0.9, sideOpacity);
      return [side, side, top, bottom, face, back]; /* +x,-x,+y,-y,+z,-z */
    });
  }

  /* ---------- ジオメトリ（共有） ---------- */
  const geoCache = new Map();
  function cachedGeo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }
  function triGeo() {
    return cachedGeo('block:tri', () => {
      const shapeT = new THREE.Shape();
      shapeT.moveTo(0, 2 * B / 3);
      shapeT.lineTo(-B / 2, -B / 3);
      shapeT.lineTo(B / 2, -B / 3);
      shapeT.closePath();
      const geo = new THREE.ExtrudeGeometry(shapeT, { depth: B, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, -B / 2);
      return geo;
    });
  }
  function cirGeo() {
    return cachedGeo('block:cir', () => {
      const geo = new THREE.CylinderGeometry(B * 0.48, B * 0.48, B, 24);
      geo.rotateX(Math.PI / 2); /* 円の平面が z 向き（カメラ側/うしろ側）になるように */
      return geo;
    });
  }
  function blockGeo(shape) {
    if (shape === 'tri') return triGeo();
    if (shape === 'cir') return cirGeo();
    return cachedGeo('block:sq', () => new THREE.BoxGeometry(B, B, B));
  }
  const chipGeo = () => cachedGeo('chip', () => new THREE.BoxGeometry(1, 1, 1));

  /* ---------- 初期化 ---------- */
  R.init = function (canvas) {
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = skyTex();
    scene.fog = new THREE.Fog(0xcfe9f7, 1400, 3400);

    camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 10, 6000);

    const hemi = new THREE.HemisphereLight(0xcfeaff, 0x9c8b74, 0.85);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff2dd, 1.25);
    dir.position.set(-420, 700, 520);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 2600;
    dir.shadow.bias = -0.0008;
    scene.add(dir);
    scene.add(dir.target);
    R._dir = dir;
  };

  R.resize = function () {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (fitInfo) fitCamera();
  };

  /* ---------- カメラフィット ---------- */
  function fitCamera() {
    const b = fitInfo.bounds;
    const cx0 = (b.minX + b.maxX) / 2;
    const topY = ty(b.topY);       /* 高いほう */
    const botY = ty(b.bottomY);    /* 低いほう（マイナス） */
    const cy0 = (topY + botY) / 2;
    const bw = b.maxX - b.minX;
    const bh = topY - botY;

    clampView(); /* zoom/az/el/pan をシーンに合わせてクランプ */

    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distBase = Math.max(
      (bh / 2) / Math.tan(vFov / 2),
      (bw / 2) / Math.tan(hFov / 2)
    ) * 1.14 + 120;
    const dist = distBase / view.zoom;

    const cx = cx0 + view.panX;
    const cy = cy0 + view.panY;
    const az = 0.22 + view.az, el = 0.15 + view.el; /* ちょっと斜めから見る（+ジェスチャー分） */
    const dx = Math.sin(az) * Math.cos(el);
    const dy = Math.sin(el);
    const dz = Math.cos(az) * Math.cos(el);
    fitInfo.base = new THREE.Vector3(cx + dx * dist, cy + dy * dist, dz * dist);
    fitInfo.look = new THREE.Vector3(cx, cy, 0);
    camera.position.copy(fitInfo.base);
    camera.lookAt(fitInfo.look);

    /* 霧と描画距離はカメラ距離に連動（縦画面はカメラが遠くなるため） */
    scene.fog.near = dist * 1.2;
    scene.fog.far = dist * 2.8;
    camera.far = dist * 3.2 + 1500;
    camera.updateProjectionMatrix();

    /* 影カメラをシーンに合わせる（パン・ズームには追従させず建物中心のまま） */
    const d = R._dir;
    d.target.position.set(cx0, 0, 0);
    d.position.set(cx0 - 420, 700, 520);
    const s = Math.max(bw, bh) * 0.9 + 300;
    d.shadow.camera.left = -s; d.shadow.camera.right = s;
    d.shadow.camera.top = s; d.shadow.camera.bottom = -s;
    d.shadow.camera.updateProjectionMatrix();
  }

  /* ---------- ビュー操作 API（カメラのピンチズーム・パン・視点回転用） ---------- */
  R.setView = function (partial) {
    if (partial) Object.assign(view, partial);
    clampView();
    if (fitInfo) fitCamera();
  };

  R.getView = function () {
    return { zoom: view.zoom, panX: view.panX, panY: view.panY, az: view.az, el: view.el };
  };

  R.resetView = function () {
    view = { zoom: 1, panX: 0, panY: 0, az: 0, el: 0 };
    if (fitInfo) fitCamera();
  };

  R.refreshCamera = function () {
    if (fitInfo) fitCamera();
  };

  R.screenPos = function (wx, wy, wz) {
    const v = new THREE.Vector3(wx, ty(wy), wz || 0).project(camera);
    return {
      x: (v.x + 1) / 2 * window.innerWidth,
      y: (1 - v.y) / 2 * window.innerHeight,
    };
  };

  /* 建築モード：どのレイヤーがアクティブかを設定し、他レイヤーの編集セルを半透明にする。
   * マス目ガイド（buildGridDots）もアクティブ層の平面に移動する。 */
  R.setActiveLayer = function (layer) {
    editActiveLayer = layer;
    for (const ent of editMap.values()) {
      const look = BRUSHES[ent.brush.p] || BRUSHES[0];
      const dim = ent.layer !== editActiveLayer;
      ent.mesh.material = blockMats(look, ent.brush.s, { withWindow: ent.hasWindow, dim });
    }
    for (const dot of buildGridDots) {
      dot.position.z = layerZ(editActiveLayer) + B / 2 + 10;
    }
  };

  /* 建築モード：セル1個のブロックメッシュを即時 追加/差替/削除する
   * （ドラッグ描画のためシーン全再構築を避ける）。brush = { p: ブラシindex, s: かたち } */
  R.setEditBlock = function (key, wx, wy, layer, brush, hasWindow) {
    let ent = editMap.get(key);
    if (!brush) {
      if (ent) {
        levelGroup.remove(ent.mesh);
        editMap.delete(key);
      }
      return;
    }
    const look = BRUSHES[brush.p] || BRUSHES[0];
    const dim = layer !== editActiveLayer;
    const mats = blockMats(look, brush.s, { withWindow: hasWindow, dim });
    if (ent && ent.brush.s === brush.s) {
      ent.mesh.material = mats;
    } else {
      if (ent) levelGroup.remove(ent.mesh);
      const mesh = new THREE.Mesh(blockGeo(brush.s), mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      levelGroup.add(mesh);
      ent = { mesh };
      editMap.set(key, ent);
    }
    ent.brush = { p: brush.p, s: brush.s };
    ent.hasWindow = hasWindow;
    ent.layer = layer;
    ent.mesh.position.set(wx, ty(wy), layerZ(layer));
  };

  /* 画面座標 → 任意z平面上のワールド座標（matter系）。planeZ省略時は z=0 */
  R.worldFromScreen = function (sx, sy, planeZ) {
    if (planeZ === undefined) planeZ = 0;
    const v = new THREE.Vector3(
      (sx / window.innerWidth) * 2 - 1,
      -(sy / window.innerHeight) * 2 + 1,
      0.5
    );
    v.unproject(camera);
    const dir = v.sub(camera.position).normalize();
    const t = (planeZ - camera.position.z) / dir.z;
    const p = camera.position.clone().addScaledVector(dir, t);
    return { x: p.x, y: GROUND_Y - p.y };
  };

  /* ---------- シーン構築 ---------- */
  function seeded(i) { /* 決定的な擬似乱数 */
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildGround(g, b) {
    const w = 7000;
    const grass = grassTex();
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(26, 3);
    const dirt = dirtTex();
    dirt.wrapS = dirt.wrapT = THREE.RepeatWrapping;
    dirt.repeat.set(30, 1);
    const mats = [
      new THREE.MeshLambertMaterial({ map: dirt }),
      new THREE.MeshLambertMaterial({ map: dirt }),
      new THREE.MeshLambertMaterial({ map: grass }),
      new THREE.MeshLambertMaterial({ color: 0x6b573f }),
      new THREE.MeshLambertMaterial({ map: dirt }),
      new THREE.MeshLambertMaterial({ map: dirt }),
    ];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 200, 860), mats);
    mesh.position.set((b.minX + b.maxX) / 2, -100, -80);
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  function cityTex() {
    return canvasTex('city', 64, 128, (g, w, h) => {
      g.fillStyle = '#8a8f96';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8dee6';
      for (let y = 8; y < h - 10; y += 18) {
        for (let x = 8; x < w - 10; x += 16) {
          g.fillRect(x, y, 8, 10);
        }
      }
    });
  }

  function buildCity(g, b) {
    const cx = (b.minX + b.maxX) / 2;
    const spread = (b.maxX - b.minX) * 2.6 + 1600;
    const colors = [0x9fc0da, 0xb4cde2, 0x92b4cc, 0xc2d5e4, 0xa8c6da];
    for (let i = 0; i < 14; i++) {
      const w = 90 + seeded(i) * 160;
      const h = 140 + seeded(i + 40) * 420;
      const x = cx - spread / 2 + spread * seeded(i + 80);
      const z = -750 - seeded(i + 120) * 750;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        cachedMat('city:' + (i % colors.length), () =>
          new THREE.MeshLambertMaterial({ map: cityTex(), color: colors[i % colors.length] }))
      );
      m.position.set(x, h / 2, z);
      g.add(m);
    }
    /* とおくの もり */
    for (let i = 0; i < 10; i++) {
      const s = 60 + seeded(i + 200) * 90;
      const x = cx - spread / 2 + spread * seeded(i + 260);
      const z = -480 - seeded(i + 300) * 300;
      const tree = makeTree(s);
      tree.position.set(x, 0, z);
      g.add(tree);
    }
  }

  function makeTree(s) {
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(
      cachedGeo('trunk', () => new THREE.CylinderGeometry(5, 7, 30, 8)),
      cachedMat('trunk', () => new THREE.MeshLambertMaterial({ color: 0x8a6a48 }))
    );
    trunk.position.y = 15;
    grp.add(trunk);
    const crown = new THREE.Mesh(
      cachedGeo('crown', () => new THREE.SphereGeometry(1, 10, 8)),
      cachedMat('crown', () => new THREE.MeshLambertMaterial({ color: 0x63a34e }))
    );
    crown.scale.set(s * 0.5, s * 0.55, s * 0.5);
    crown.position.y = 30 + s * 0.4;
    crown.castShadow = true;
    grp.add(crown);
    return grp;
  }

  function buildNearTrees(g, level, b) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (Math.max(Math.abs(b.minX), b.maxX) + 60 + seeded(i + 500) * 120);
      const tree = makeTree(46 + seeded(i + 520) * 30);
      tree.position.set(x, 0, 60 + seeded(i + 540) * 120);
      g.add(tree);
    }
  }

  function buildCone(g, x) {
    const cone = new THREE.Mesh(
      cachedGeo('cone', () => new THREE.ConeGeometry(15, 38, 18, 1, false)),
      cachedMat('coneM', () => new THREE.MeshLambertMaterial({ map: coneTex() }))
    );
    cone.position.set(x, 19, 60);
    cone.castShadow = true;
    g.add(cone);
    const base = new THREE.Mesh(
      cachedGeo('coneBase', () => new THREE.BoxGeometry(34, 5, 34)),
      cachedMat('coneBaseM', () => new THREE.MeshLambertMaterial({ color: 0xe96a12 }))
    );
    base.position.set(x, 2.5, 60);
    g.add(base);
  }

  function buildNeighbor(g, nb, index) {
    const n = nb.spec;
    const depth = 110;
    const grp = new THREE.Group();
    const wallMats = [
      new THREE.MeshLambertMaterial({ color: shadeColor(n.color, 0.8) }),
      new THREE.MeshLambertMaterial({ color: shadeColor(n.color, 0.8) }),
      new THREE.MeshLambertMaterial({ color: shadeColor(n.color, 1.0) }),
      new THREE.MeshLambertMaterial({ color: shadeColor(n.color, 0.7) }),
      new THREE.MeshLambertMaterial({ map: houseTex(n, 'happy') }),
      new THREE.MeshLambertMaterial({ color: shadeColor(n.color, 0.9) }),
    ];
    const wall = new THREE.Mesh(new THREE.BoxGeometry(n.w, n.h, depth), wallMats);
    wall.position.set(n.x, n.h / 2, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    grp.add(wall);

    /* やね（四角すい） */
    const roofR = Math.max(n.w, depth) * 0.78;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(roofR, n.w * 0.5, 4, 1),
      new THREE.MeshLambertMaterial({ color: n.roof })
    );
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = (depth + 30) / (roofR * 1.414);
    roof.scale.x = (n.w + 30) / (roofR * 1.414);
    roof.position.set(n.x, n.h + n.w * 0.25, 0);
    roof.castShadow = true;
    grp.add(roof);

    /* えんとつ */
    const chim = new THREE.Mesh(
      cachedGeo('chim', () => new THREE.BoxGeometry(18, 34, 18)),
      new THREE.MeshLambertMaterial({ color: shadeColor(n.roof, 0.85) })
    );
    chim.position.set(n.x + n.w * 0.28, n.h + n.w * 0.3, 0);
    grp.add(chim);

    g.add(grp);
    neighborNodes[index] = { wall, spec: n, mood: 'happy' };
  }

  function makeBombGroup() {
    const grp = new THREE.Group();
    const stickGeo = cachedGeo('stick', () => new THREE.CylinderGeometry(7.5, 7.5, 30, 12));
    const stickMat = cachedMat('stickM', () => new THREE.MeshLambertMaterial({ map: tntTex() }));
    for (const [ox, oz] of [[-9, 4], [0, -6], [9, 4]]) {
      const s = new THREE.Mesh(stickGeo, stickMat);
      s.position.set(ox, 0, oz);
      s.castShadow = true;
      grp.add(s);
    }
    const band = new THREE.Mesh(
      cachedGeo('band', () => new THREE.CylinderGeometry(14.5, 14.5, 7, 14)),
      cachedMat('bandM', () => new THREE.MeshLambertMaterial({ color: 0x6b4f2a }))
    );
    grp.add(band);
    /* どうかせん */
    const fuse = new THREE.Mesh(
      cachedGeo('fuse', () => new THREE.CylinderGeometry(1.8, 1.8, 16, 6)),
      cachedMat('fuseM', () => new THREE.MeshLambertMaterial({ color: 0x4a3520 }))
    );
    fuse.position.set(0, 22, 0);
    fuse.rotation.z = 0.3;
    grp.add(fuse);
    /* ひばな（点火時のみ表示） */
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softTex(), color: 0xffd23e, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    spark.position.set(-4, 30, 0);
    spark.scale.set(30, 30, 1);
    spark.visible = false;
    grp.add(spark);
    grp.userData.spark = spark;
    return grp;
  }

  function makeSocketMarker() {
    const grp = new THREE.Group();
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTex(), color: 0xffd23e, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    ring.scale.set(70, 70, 1);
    grp.add(ring);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softTex(), color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.9,
    }));
    core.scale.set(26, 26, 1);
    grp.add(core);
    grp.userData.ring = ring;
    return grp;
  }

  R.buildScene = function (state) {
    if (levelGroup) { scene.remove(levelGroup); }
    if (fxGroup) { scene.remove(fxGroup); }
    fxMap.clear();
    bombMap.clear();
    editMap.clear();
    levelGroup = new THREE.Group();
    fxGroup = new THREE.Group();
    blockMeshes = [];
    hintNodes = [];
    neighborNodes = [];
    cloudNodes = [];

    const b = state.bounds;
    buildGround(levelGroup, b);
    buildCity(levelGroup, b);
    buildNearTrees(levelGroup, state.level, b);
    buildCone(levelGroup, state.level.zone.l);
    buildCone(levelGroup, state.level.zone.r);
    state.neighbors.forEach((nb, i) => buildNeighbor(levelGroup, nb, i));

    /* ブロック */
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) {
        const meta = blk.plugin.meta;
        const pal = meta.palette || bld.spec.palette;
        const shape = meta.shape || 'sq';
        const mesh = new THREE.Mesh(blockGeo(shape), blockMats(pal, shape, { withWindow: meta.window }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.body = blk;
        levelGroup.add(mesh);
        blockMeshes.push(mesh);
      }
    }

    /* おすすめポイント（ヒント）の光るリング */
    for (const s of state.sockets) {
      const marker = makeSocketMarker();
      marker.position.set(s.x, ty(s.y), B / 2 + 14);
      levelGroup.add(marker);
      hintNodes.push({ marker, hint: s });
    }

    /* 建築モードのマス目ガイド（アクティブ層の平面にのみ表示） */
    buildGridDots = [];
    if (state.level.buildGrid) {
      const gg = state.level.buildGrid;
      const spec = state.level.buildings[0];
      const left = spec.x - (spec.cols * B) / 2;
      const dotMat = cachedMat('gridDot', () => new THREE.SpriteMaterial({
        map: softTex(), color: 0xffffff, transparent: true,
        opacity: 0.28, depthWrite: false,
      }));
      editActiveLayer = 1;
      const dz = layerZ(editActiveLayer) + B / 2 + 10;
      for (let r = 0; r < gg.rows; r++) {
        for (let c = 0; c < gg.cols; c++) {
          const dot = new THREE.Sprite(dotMat);
          dot.position.set(left + c * B + B / 2, ty(GROUND_Y - B / 2 - r * B), dz);
          dot.scale.set(10, 10, 1);
          levelGroup.add(dot);
          buildGridDots.push(dot);
        }
      }
    }

    /* たいよう と くも */
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softTex(), color: 0xffe28a, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false,
    }));
    sun.position.set(b.maxX + 500, ty(b.topY) + 420, -1100);
    sun.scale.set(560, 560, 1);
    levelGroup.add(sun);

    for (let i = 0; i < 4; i++) {
      const cl = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex(), transparent: true, depthWrite: false, opacity: 0.9,
      }));
      const sc = 180 + seeded(i + 700) * 160;
      cl.scale.set(sc * 2, sc, 1);
      cl.position.set(0, ty(b.topY) + 120 + seeded(i + 720) * 260, -520 - seeded(i + 740) * 300);
      cl.userData = {
        baseX: b.minX - 400 + seeded(i + 760) * ((b.maxX - b.minX) + 800),
        speed: 8 + seeded(i + 780) * 10,
      };
      levelGroup.add(cl);
      cloudNodes.push(cl);
    }

    scene.add(levelGroup);
    scene.add(fxGroup);

    if (window.GameHooks) window.GameHooks.emit('sceneBuilt', { scene, levelGroup, state });

    fitInfo = { bounds: b };
    fitCamera();
  };

  /* ---------- パーティクル同期 ---------- */
  function makeFxNode(p) {
    if (p.kind === 'chip') {
      const mesh = new THREE.Mesh(chipGeo(),
        new THREE.MeshLambertMaterial({ color: p.color, transparent: true }));
      mesh.scale.set(p.size, p.size, p.size);
      mesh.castShadow = true;
      return mesh;
    }
    let color = p.color, blending = THREE.NormalBlending, map = softTex();
    if (p.kind === 'fire' || p.kind === 'flash') blending = THREE.AdditiveBlending;
    if (p.kind === 'ring') { map = ringTex(); blending = THREE.AdditiveBlending; }
    if (p.kind === 'confetti') map = null;
    const mat = new THREE.SpriteMaterial({
      map: map || undefined, color, blending, transparent: true, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    return sp;
  }

  function syncFx(parts) {
    const alive = new Set(parts);
    for (const [p, node] of fxMap) {
      if (!alive.has(p)) {
        fxGroup.remove(node);
        if (node.material && node.material.dispose && p.kind !== 'chip') node.material.dispose();
        if (p.kind === 'chip') node.material.dispose();
        fxMap.delete(p);
      }
    }
    for (const p of parts) {
      let node = fxMap.get(p);
      if (!node) {
        node = makeFxNode(p);
        fxGroup.add(node);
        fxMap.set(p, node);
      }
      const t = p.life / p.maxLife;
      const zBase = p.kind === 'dust' ? 60 : 40;
      node.position.set(p.x, ty(p.y), zBase + (p.z || 0));
      if (p.kind === 'chip') {
        node.rotation.set(p.rot, p.rot * 0.7, p.rot * 1.3);
        node.material.opacity = 1 - t * t;
      } else {
        const mat = node.material;
        if (p.kind === 'dust') {
          mat.opacity = 0.45 * (1 - t * t);
          node.scale.set(p.r * 2.2, p.r * 2.2, 1);
        } else if (p.kind === 'fire') {
          mat.opacity = 1 - t;
          node.scale.set(p.r * 3, p.r * 3, 1);
        } else if (p.kind === 'flash') {
          mat.opacity = 0.9 * (1 - t);
          node.scale.set(p.r * (1 + t * 2.5), p.r * (1 + t * 2.5), 1);
        } else if (p.kind === 'ring') {
          mat.opacity = 0.85 * (1 - t);
          const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(t);
          node.scale.set(rr * 2, rr * 2, 1);
        } else if (p.kind === 'confetti') {
          mat.opacity = t > 0.75 ? (1 - t) * 4 : 1;
          mat.rotation = p.rot;
          node.scale.set(p.r * 1.6, p.r * 0.9, 1);
        }
      }
    }
  }

  /* ---------- 毎フレーム描画 ---------- */
  R.render = function (state, time, opts) {
    if (!state || !levelGroup) return;

    /* ブロック */
    for (const mesh of blockMeshes) {
      const body = mesh.userData.body;
      if (body.plugin.meta.removed) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(body.position.x, ty(body.position.y), layerZ(body.plugin.meta.layer || 1));
      mesh.rotation.z = -body.angle;
    }

    /* おすすめポイント（爆弾がのっているところは消す） */
    const bombs = opts.bombs || [];
    for (const node of hintNodes) {
      const s = node.hint;
      const covered = bombs.some((b) =>
        b.status !== 'done' &&
        Math.hypot(b.host.position.x - s.x, b.host.position.y - s.y) < B * 0.7);
      node.marker.visible = !!opts.showSockets && !covered;
      if (node.marker.visible) {
        const pulse = 1 + Math.sin(time * 5) * 0.18;
        node.marker.userData.ring.scale.set(70 * pulse, 70 * pulse, 1);
      }
    }

    /* 爆弾：ブロックに貼り付いて一緒に動く */
    const liveBombs = new Set();
    for (const b of bombs) {
      if (b.status === 'done') continue;
      liveBombs.add(b);
      let grp = bombMap.get(b);
      if (!grp) {
        grp = makeBombGroup();
        levelGroup.add(grp);
        bombMap.set(b, grp);
      }
      const host = b.host;
      const w = window.GameCore.bombWorldPos(b);
      const bz = layerZ(host.plugin.meta.layer || 1) + B / 2 + 12;
      grp.position.set(w.x, ty(w.y) - 6, bz);
      grp.rotation.z = -host.angle;
      const spark = grp.userData.spark;
      spark.visible = b.status === 'lit';
      if (spark.visible) {
        const ss = 24 + Math.sin(time * 32) * 10;
        spark.scale.set(ss, ss, 1);
      }
      if (b.status === 'armed' && opts.pulseBombs) {
        const k = 1 + Math.sin(time * 5) * 0.08;
        grp.scale.set(k, k, k);
      } else {
        grp.scale.set(1, 1, 1);
      }
    }
    for (const [b, grp] of bombMap) {
      if (!liveBombs.has(b)) {
        levelGroup.remove(grp);
        bombMap.delete(b);
      }
    }

    /* おとなりの ひょうじょう */
    for (let i = 0; i < neighborNodes.length; i++) {
      const nn = neighborNodes[i];
      const hit = state.neighbors[i].hit;
      const mood = hit ? 'shock' : 'happy';
      if (nn.mood !== mood) {
        nn.mood = mood;
        nn.wall.material[4].map = houseTex(nn.spec, mood);
        nn.wall.material[4].needsUpdate = true;
      }
    }

    /* くも */
    for (const cl of cloudNodes) {
      const span = (fitInfo.bounds.maxX - fitInfo.bounds.minX) + 1400;
      let x = cl.userData.baseX + time * cl.userData.speed;
      const min = fitInfo.bounds.minX - 700;
      x = min + ((x - min) % span + span) % span;
      cl.position.x = x;
    }

    /* パーティクル */
    syncFx(window.GameFx.parts);

    /* カメラシェイク */
    const sh = window.GameFx.getShake();
    camera.position.set(
      fitInfo.base.x + (Math.random() - 0.5) * sh,
      fitInfo.base.y + (Math.random() - 0.5) * sh,
      fitInfo.base.z
    );
    camera.lookAt(fitInfo.look);

    if (window.GameHooks) window.GameHooks.emit('frame', state, time, opts);

    renderer.render(scene, camera);
  };

  window.GameRender = R;
})();
