// src/scene.js — B (environment)
// Builds the toy-world environment: sky, lights, pool basin, diving tower,
// background props. Does NOT create the water surface (owned by C).
// See docs/CONTRACTS.md for the exact contract.
import * as THREE from 'three';
import { POOL, PLATFORMS } from './constants.js';

// ---------------------------------------------------------------------------
// Small canvas-texture helpers (procedural only, generated once).
// ---------------------------------------------------------------------------

function makeTileTexture() {
  // Light-blue pool tiles with grout lines — used for inner wall & floor.
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#bdeeff';
  ctx.fillRect(0, 0, size, size);

  const tiles = 8;
  const step = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const shade = (x + y) % 2 === 0 ? '#cff5ff' : '#a9e6f7';
      ctx.fillStyle = shade;
      ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
    }
  }

  // Grout lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDeckTexture() {
  // Warm sandy-cream deck ring with speckles.
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffe9b8';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.6 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// SceneEnv
// ---------------------------------------------------------------------------

export class SceneEnv {
  constructor(scene) {
    this.scene = scene;
    this._clouds = []; // { mesh, baseY, speed, phase }

    this._buildSky();
    this._buildLights();
    this._buildPool();
    this.platforms = this._buildTower();
    this._buildProps();
  }

  // -- Sky -------------------------------------------------------------
  _buildSky() {
    // scene.background as a flat sky-blue fallback (cheap, always correct).
    this.scene.background = new THREE.Color(0x8fd7ff);
    // Gentle fog for depth cueing, matching the horizon color.
    this.scene.fog = new THREE.Fog(0xbdeeff, 30, 90);

    // Big inverted dome with a cheap vertical-gradient shader for a nicer sky.
    const geo = new THREE.SphereGeometry(70, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x3fa9f5) },
        bottomColor: { value: new THREE.Color(0xe7f8ff) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        void main() {
          float h = clamp(vPos.y / 70.0, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.55)), 1.0);
        }
      `,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -10;
    this.scene.add(dome);
  }

  // -- Lights ------------------------------------------------------------
  _buildLights() {
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 30;
    sun.shadow.bias = -0.003;
    this.scene.add(sun);
    this.sun = sun;

    const hemi = new THREE.HemisphereLight(0xbfe9ff, 0xfff0cf, 1.1);
    this.scene.add(hemi);
    this.hemi = hemi;
  }

  // -- Pool basin ----------------------------------------------------------
  _buildPool() {
    const tileTex = makeTileTexture();
    tileTex.repeat.set(10, 1.4);
    const deckTex = makeDeckTexture();
    deckTex.repeat.set(12, 12);

    const R = POOL.RADIUS;
    const WR = POOL.WATER_RADIUS;
    const DEPTH = POOL.DEPTH;

    // Deck ring around the rim (flat annulus, slightly above y=0).
    const deckGeo = new THREE.RingGeometry(R, R + 1.6, 48, 1);
    // Map ring UVs radially so the speckle texture tiles nicely.
    {
      const pos = deckGeo.attributes.position;
      const uv = deckGeo.attributes.uv;
      const v3 = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i);
        const ang = Math.atan2(v3.z, v3.x);
        const rad = Math.sqrt(v3.x * v3.x + v3.z * v3.z);
        uv.setXY(i, (ang / (Math.PI * 2)) * 12, rad * 0.5);
      }
    }
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.95 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 0.02;
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Inner wall (tiled cylinder), visible above and below the waterline.
    const wallHeight = 0.5 + DEPTH;
    const wallGeo = new THREE.CylinderGeometry(WR, WR, wallHeight, 48, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
      map: tileTex,
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    // Top of the wall sits slightly above y=0, bottom reaches the floor.
    wall.position.y = 0.5 - wallHeight / 2;
    this.scene.add(wall);

    // Floor disc at y = -DEPTH.
    const floorGeo = new THREE.CircleGeometry(WR, 48);
    const floorMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.6 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -DEPTH;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // A slim rim cap (torus) to hide the seam between deck and wall/water.
    const rimGeo = new THREE.TorusGeometry(WR + 0.06, 0.1, 8, 48);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff8fb1, roughness: 0.6 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    this.scene.add(rim);
  }

  // -- Diving tower ----------------------------------------------------------
  // The tower's upright pillars stand on dry deck outside the pool basin;
  // each board reaches inward from the pillars so its far end lands exactly
  // on the platform's `tip` from constants (which sits over the water).
  _buildTower() {
    const group = new THREE.Group();
    group.name = 'divingTower';
    this.scene.add(group);

    const boardColors = { low: 0xff5b5b, mid: 0xffd23f, high: 0x4fb0ff };
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const ladderMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 });

    const BOARD_LEN = 2.6; // total physical length of each board, incl. caps
    const tipX = PLATFORMS[0].tip.x; // all tips share the same x (-3.4)
    const PILLAR_X = tipX - BOARD_LEN; // dry deck, outside POOL.RADIUS

    // Two chunky rounded pillars supporting all boards, from the ground up
    // to just above the highest board.
    const topHeight = PLATFORMS[PLATFORMS.length - 1].height + 0.6;
    const pillarGeo = new THREE.CapsuleGeometry(0.22, topHeight, 4, 8);
    const offsets = [-0.55, 0.55];
    for (const dz of offsets) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(PILLAR_X, topHeight / 2, dz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }

    // Ladder rungs climbing between the two pillars (cheap: InstancedMesh).
    const rungCount = 12;
    const rungGeo = new THREE.BoxGeometry(1.1, 0.06, 0.08);
    const rungs = new THREE.InstancedMesh(rungGeo, ladderMat, rungCount);
    rungs.castShadow = false;
    const m = new THREE.Matrix4();
    for (let i = 0; i < rungCount; i++) {
      const y = 0.3 + (i / (rungCount - 1)) * (topHeight - 0.3);
      m.makeTranslation(PILLAR_X, y, 0);
      rungs.setMatrixAt(i, m);
    }
    rungs.instanceMatrix.needsUpdate = true;
    group.add(rungs);

    const platforms = [];

    for (const p of PLATFORMS) {
      const color = boardColors[p.id] ?? 0xffffff;
      const boardGroup = new THREE.Group();
      boardGroup.name = `board-${p.id}`;

      // Capsule cylinder length + 2*radius === BOARD_LEN when rotated flat.
      const boardMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
      const boardGeo = new THREE.CapsuleGeometry(0.34, BOARD_LEN - 0.68, 4, 10);
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.rotation.z = Math.PI / 2; // capsule axis becomes X (horizontal)
      // Center the board so its far end lands exactly on the platform tip.
      board.position.set(p.tip.x - BOARD_LEN / 2, p.height, p.tip.z);
      board.castShadow = true;
      board.receiveShadow = true;
      boardGroup.add(board);

      // Small rounded knob at the tip end (cute toddler-toy detail, also
      // reads as a visual marker for where the toy will hover).
      const knobGeo = new THREE.SphereGeometry(0.3, 10, 8);
      const knob = new THREE.Mesh(knobGeo, boardMat);
      knob.position.set(p.tip.x, p.height + 0.02, p.tip.z);
      boardGroup.add(knob);

      group.add(boardGroup);

      // "focus" Object3D at the tip — other systems can target it.
      const focus = new THREE.Object3D();
      focus.position.set(p.tip.x, p.tip.y, p.tip.z);
      group.add(focus);

      platforms.push({
        id: p.id,
        height: p.height,
        tip: new THREE.Vector3(p.tip.x, p.tip.y, p.tip.z),
        focus,
      });
    }

    return platforms;
  }

  // -- Background props ----------------------------------------------------
  _buildProps() {
    // Sun: a simple warm sprite, cheap and always facing the camera.
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 128;
    sunCanvas.height = 128;
    const sctx = sunCanvas.getContext('2d');
    const grad = sctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,200,1)');
    grad.addColorStop(0.5, 'rgba(255,224,120,0.85)');
    grad.addColorStop(1, 'rgba(255,224,120,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, depthWrite: false, fog: false });
    const sun = new THREE.Sprite(sunMat);
    sun.scale.set(9, 9, 1);
    sun.position.set(10, 16, -20);
    this.scene.add(sun);

    // Clouds: soft round blob sprites, a handful drifting slowly.
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 128;
    cloudCanvas.height = 80;
    const cctx = cloudCanvas.getContext('2d');
    cctx.fillStyle = 'rgba(255,255,255,0)';
    cctx.fillRect(0, 0, 128, 80);
    const blobs = [
      [40, 45, 26], [70, 45, 30], [95, 48, 20], [58, 32, 22], [80, 30, 18],
    ];
    cctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [x, y, r] of blobs) {
      cctx.beginPath();
      cctx.arc(x, y, r, 0, Math.PI * 2);
      cctx.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTex,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });

    const cloudDefs = [
      { x: -8, y: 13, z: -18, s: 7, speed: 0.15 },
      { x: 6, y: 15, z: -22, s: 9, speed: 0.1 },
      { x: -2, y: 17, z: -25, s: 6, speed: 0.2 },
    ];
    for (const c of cloudDefs) {
      const spr = new THREE.Sprite(cloudMat);
      spr.scale.set(c.s * 1.6, c.s, 1);
      spr.position.set(c.x, c.y, c.z);
      this.scene.add(spr);
      this._clouds.push({ mesh: spr, baseX: c.x, baseY: c.y, speed: c.speed, phase: Math.random() * Math.PI * 2 });
    }
  }

  // -- Per-frame update ------------------------------------------------------
  update(dt, time) {
    for (const c of this._clouds) {
      c.mesh.position.y = c.baseY + Math.sin(time * 0.3 + c.phase) * 0.3;
      c.mesh.position.x = c.baseX + Math.sin(time * c.speed + c.phase) * 1.5;
    }
  }
}
