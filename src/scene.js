// src/scene.js — B (environment)
// Builds the toy-world environment: sky, lights, pool basin, diving tower,
// background props. Does NOT create the water surface (owned by C).
// See docs/CONTRACTS.md for the exact contract.
import * as THREE from 'three';
import { POOL, PLATFORMS, SKY } from './constants.js';

// ---------------------------------------------------------------------------
// Small math helpers (no per-frame allocation) — mirrors rabbit.js's set,
// duplicated locally since scene.js has no dependency on rabbit.js.
// ---------------------------------------------------------------------------
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
function easeOutCubic(t) {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

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
// Balloon + gondola: geometry & texture helpers.
// See docs/CONTRACTS-MEGA.md "M1 — balloon, sky access, rabbit".
// ---------------------------------------------------------------------------

// Cheerful vertical candy stripes for the envelope, painted so they wrap
// exactly once around a LatheGeometry (whose U coordinate already spans one
// full revolution) — same "paint stripes, let the UV wrap them" trick as
// toys.js's ringTexture, just with 3 colors instead of 2.
function makeBalloonStripeTexture() {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const colors = ['#ff5c72', '#ffd23f', '#4fc3f7'];
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
  }
  // Thin white seams between panels (stitched-fabric read).
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= stripes; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / stripes, 0);
    ctx.lineTo((i * w) / stripes, h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Warm woven-wicker look for the gondola basket: two crossing diagonal hatch
// passes over a tan base, tiled around the basket walls.
function makeWickerTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d9a962';
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(140,90,40,0.5)';
  for (let i = -size; i < size * 2; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,224,170,0.35)';
  for (let i = -size; i < size * 2; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, size);
    ctx.lineTo(i + size, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Giant-crate face: warm plank crate with a big gold star and a readable
// 「おおきい」("big!") mark — painted once, shared by every face of the box
// (BoxGeometry's default per-face UVs are all 0..1, so every face reads the
// same "branded crate" front — a cute, intentional look, not a UV bug).
function makeGiantCrateTexture() {
  // Canvas aspect matches the crate's own wide-short wall faces
  // (GIANT_CRATE_DIMS.w / .h ≈ 2.1, .d / .h ≈ 1.6) far better than a square
  // canvas would — a square texture stretched onto a squat rectangular wall
  // squished the star and clipped the text. Star + text sit side-by-side
  // (rather than stacked) so both stay legible even squeezed vertically.
  const w = 512;
  const h = 260;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c17f3e';
  ctx.fillRect(0, 0, w, h);

  // Plank seams.
  ctx.strokeStyle = 'rgba(110,65,25,0.5)';
  ctx.lineWidth = 5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / 4, 0);
    ctx.lineTo((i * w) / 4, h);
    ctx.stroke();
  }
  // Frame border.
  ctx.strokeStyle = '#7a4a1f';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, w - 12, h - 12);

  // Big gold star (left).
  const cx = w * 0.27;
  const cy = h * 0.52;
  const outer = h * 0.4;
  const inner = outer * 0.44;
  const grad = ctx.createRadialGradient(cx, cy, inner * 0.3, cx, cy, outer);
  grad.addColorStop(0, '#fff4b8');
  grad.addColorStop(0.6, '#ffd23f');
  grad.addColorStop(1, '#f2a300');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#a85c00';
  ctx.lineWidth = 6;
  ctx.beginPath();
  const spikes = 5;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 「おおきい」 mark (right) — IPAGothic is present in this environment and
  // covers hiragana; sans-serif is a harmless fallback if a target lacks it.
  // Two lines (お＋おきい) so each glyph stays large within the short canvas
  // instead of one cramped long line.
  ctx.font = 'bold 74px "IPAGothic", "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#a83232';
  const tx = w * 0.71;
  ctx.strokeText('おおき', tx, h * 0.36);
  ctx.fillText('おおき', tx, h * 0.36);
  ctx.strokeText('い！', tx, h * 0.72);
  ctx.fillText('い！', tx, h * 0.72);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial-gradient cloud blobs (fluffier & higher-res than the ground
// prop clouds, since the balloon flies close past these) — same "cluster of
// overlapping circles" technique as _buildProps's ground clouds.
function makeAltitudeCloudTexture() {
  const w = 256;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const blobs = [
    [80, 95, 46], [140, 95, 54], [190, 100, 38],
    [115, 62, 42], [165, 58, 34], [60, 70, 30],
  ];
  for (const [x, y, r] of blobs) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Open shell (4 walls, optionally + floor, DoubleSide) — used for the
// gondola basket (with floor) and the giant crate's WALLS ONLY (see
// `includeFloor=false` below — the crate's floor is a separate, plainer
// mesh, so the star+text mark painted on the walls doesn't also repeat
// across the floor when seen from directly above through the open top,
// which read as a confusing "two crates stacked" during visual QA). Same
// technique as rabbit.js's per-platform toy crates, duplicated locally
// (scene.js does not depend on rabbit.js).
function buildOpenShellGeometry(w, h, d, includeFloor = true) {
  const hw = w / 2;
  const hd = d / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  function quad(p0, p1, p2, p3, n) {
    const pts = [p0, p1, p2, p0, p2, p3];
    const uvList = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 6; i++) {
      positions.push(pts[i][0], pts[i][1], pts[i][2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uvList[i][0], uvList[i][1]);
    }
  }
  if (includeFloor) {
    quad([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [0, 1, 0]); // floor
  }
  quad([-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [hw, 0, -hd], [0, 0, -1]); // front wall
  quad([hw, 0, hd], [hw, h, hd], [-hw, h, hd], [-hw, 0, hd], [0, 0, 1]); // back wall
  quad([-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-hw, 0, -hd], [-1, 0, 0]); // left wall
  quad([hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [hw, 0, hd], [1, 0, 0]); // right wall
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

// Lathe profile for the balloon envelope: a rounded onion/teardrop shape,
// narrow neck at the bottom (where the ropes gather) flaring to a wide
// bulge, tapering to a point at the top vent. Local origin sits at the very
// bottom of the neck skirt.
// M6 INTEGRATION FIX (supervisor concern (a)): radii (x) scaled 1.2x from
// the original profile — verified in-game the envelope read as visually
// small/thin next to the huge gondola basket (BASKET_W=2.9); the original
// max radius (1.3, diameter 2.6) was barely narrower than the basket's own
// width. Widening it past the basket's half-width makes the envelope read
// as the dominant, "huge hot air balloon" silhouette it's meant to be.
// Height (y) untouched — NECK_Y above already gives it the vertical
// clearance the held giant toy needs.
const ENVELOPE_RADIUS_SCALE = 1.2;
function buildEnvelopeGeometry() {
  const pts = [
    new THREE.Vector2(0.0 * ENVELOPE_RADIUS_SCALE, 0.0),
    new THREE.Vector2(0.4 * ENVELOPE_RADIUS_SCALE, 0.05),
    new THREE.Vector2(0.55 * ENVELOPE_RADIUS_SCALE, 0.16),
    new THREE.Vector2(0.95 * ENVELOPE_RADIUS_SCALE, 0.55),
    new THREE.Vector2(1.22 * ENVELOPE_RADIUS_SCALE, 1.05),
    new THREE.Vector2(1.3 * ENVELOPE_RADIUS_SCALE, 1.55),
    new THREE.Vector2(1.14 * ENVELOPE_RADIUS_SCALE, 2.15),
    new THREE.Vector2(0.74 * ENVELOPE_RADIUS_SCALE, 2.85),
    new THREE.Vector2(0.26 * ENVELOPE_RADIUS_SCALE, 3.22),
    new THREE.Vector2(0.0 * ENVELOPE_RADIUS_SCALE, 3.4),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

// Cheap "cross billboard" (two perpendicular quads sharing one texture) for
// the altitude cloud layers: since the game camera never orbits (see
// docs/CONTRACTS.md), a true per-frame billboard isn't needed for a
// plausible read from the handful of angles the camera actually visits
// during ascent — this reads fine from far more angles than a single flat
// quad would, for the same ONE draw call per InstancedMesh layer.
function buildCloudCrossGeometry(size) {
  const hw = size / 2;
  const positions = [
    -hw, -hw * 0.6, 0, hw, -hw * 0.6, 0, hw, hw * 0.6, 0,
    -hw, -hw * 0.6, 0, hw, hw * 0.6, 0, -hw, hw * 0.6, 0,
    0, -hw * 0.6, -hw, 0, -hw * 0.6, hw, 0, hw * 0.6, hw,
    0, -hw * 0.6, -hw, 0, hw * 0.6, hw, 0, hw * 0.6, -hw,
  ];
  const uvs = [
    0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

// ---------------------------------------------------------------------------
// Balloon + gondola tunables (meters). All balloon-local geometry is built
// inside a `swayPivot` whose LOCAL origin (0,0,0) is the gondola basket's
// floor center — exactly the point exposed as `gondolaAnchor`. `group` (the
// object returned to callers) carries the flight-path position computed by
// setProgress(); swayPivot only carries the small time-based idle bob/tilt
// added every frame by SceneEnv.update() (see _updateBalloon) — keeping
// setProgress() itself a pure function of p, per contract ("stateless
// positioning").
// ---------------------------------------------------------------------------
const BASKET_W = 2.9; // gondola footprint, local X
const BASKET_D = 1.9; // gondola footprint, local Z
const BASKET_H = 0.95; // wicker wall height above the floor
const ROPE_COUNT = 8;
const ROPE_R = 0.018;
// M6 INTEGRATION FIX (supervisor concern (a), docs/CONTRACTS-MEGA.md M1):
// verified in-game (rabbit.js's real sky-ready view, GONDOLA_PAW_Y_OFFSET =
// basket floor + 2.2m) that the ORIGINAL NECK_Y (BASKET_H + 1.5 = 2.45) put
// the envelope's flare starting well BELOW the held giant toy's lowest
// point for every giant def — worst case giantbeach (paw 2.2 + radius 1.5 =
// top 3.7, bottom 0.7) already has its bottom hemisphere overlapping the
// neck/flare at 2.45, and even the smallest, giantheavy (top 3.3), still
// overlaps it substantially. On screen this reads as the giant ball
// swallowed into the balloon's fabric, not held beneath it. Raising the
// neck comfortably above the tallest held-toy point (giantbeach's 3.7)
// fixes the clipping outright; per the contract's own guidance ("bigger/
// higher envelope is likely better than moving the paw" — moving the paw
// down instead would just crowd the toy back into the basket rim/rabbit).
const NECK_Y = BASKET_H + 3.4; // envelope neck height above the basket floor
const NECK_R = 0.55 * 1.2; // matches ENVELOPE_RADIUS_SCALE below so ropes meet the (now wider) neck
// "~4x normal crate" per contract (normal: 0.34 x 0.16 x 0.26, see
// rabbit.js) — 3.2x rather than a literal 4x so the crate (1.09 x 0.51 x
// 0.83) fits inside a gondola basket sized to also hold a standing rabbit
// without the two footprints overlapping; still unmistakably "giant" next
// to the normal crates. See report for the exact numbers.
const GIANT_CRATE_SCALE = 3.2;
const GIANT_CRATE_DIMS = {
  w: 0.34 * GIANT_CRATE_SCALE,
  h: 0.16 * GIANT_CRATE_SCALE,
  d: 0.26 * GIANT_CRATE_SCALE,
};
// Offset from the basket floor center (== gondolaAnchor), so the crate sits
// to one side and the rabbit's gondolaAnchor stand point stays clear of it.
const GIANT_CRATE_LOCAL = { x: 0.75, z: 0 };

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
    this.balloon = this._buildBalloon();
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
  //
  // NOTE on the camera angle: the game camera sits on the +X side and looks
  // mostly along -X (see cameraFX.js `lookAt` targets around x=-1..-1.3),
  // so world-X is close to the camera's view/depth axis, not the on-screen
  // horizontal. A *thin round* shape whose long axis runs along X (the old
  // CapsuleGeometry boards, and the old rung box that was long in X instead
  // of Z) gets foreshortened almost end-on into an unreadable diagonal
  // blob/streak — that was the "diagonal floating pills" / "scattered
  // debris" bug. The fix keeps the boards' required long axis along X (tips
  // must land exactly on PLATFORMS[i].tip, pillars must stay outside the
  // pool on the X axis) but gives them a flat, WIDE (in Z) plank cross
  // section instead of a thin round one, so they still read clearly as toy
  // diving boards even when viewed close to end-on. The ladder rungs are
  // fixed to run along Z (the axis that actually spans between the two
  // pillars) instead of X.
  _buildTower() {
    const group = new THREE.Group();
    group.name = 'divingTower';
    this.scene.add(group);

    const boardColors = { low: 0xff5b5b, mid: 0xffd23f, high: 0x4fb0ff };
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const ladderMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 });

    const BOARD_LEN = 2.6; // total physical length of each board, incl. caps
    const BOARD_THICK = 0.24; // flat vertical thickness of the plank
    const BOARD_WIDTH = 1.0; // wide sideways so it reads as a board, not a pole
    const tipX = PLATFORMS[0].tip.x; // all tips share the same x (-3.4)
    const PILLAR_X = tipX - BOARD_LEN; // dry deck, outside POOL.RADIUS
    const PILLAR_DZ = 0.55; // half-gap between the two rail pillars

    // Two chunky rounded pillars supporting all boards, from the ground up
    // to just above the highest board.
    const topHeight = PLATFORMS[PLATFORMS.length - 1].height + 0.6;
    const pillarGeo = new THREE.CapsuleGeometry(0.22, topHeight, 4, 8);
    const offsets = [-PILLAR_DZ, PILLAR_DZ];
    for (const dz of offsets) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(PILLAR_X, topHeight / 2, dz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }

    // Ladder rungs climbing between the two pillars (cheap: InstancedMesh).
    // Each rung must be long along Z (the axis that separates the two rail
    // pillars) and thin along X/Y — the previous version had this backwards
    // (long along X), which made every rung foreshorten into a tiny scattered
    // speck instead of a horizontal step.
    const rungCount = 12;
    const rungGeo = new THREE.BoxGeometry(0.07, 0.06, PILLAR_DZ * 2 - 0.1);
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
      const boardMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });

      // Flat wide plank: BoxGeometry's local X is already the length axis,
      // so no rotation is needed (avoids re-introducing an axis mixup).
      // The straight box covers the middle stretch; a rounded cap sits at
      // each end so the *outer surface* of the tip cap — not just its
      // center — lands exactly on the platform tip, matching the contract.
      const capR = BOARD_WIDTH / 2;
      const boardLenMid = BOARD_LEN - 2 * capR;
      const boardGeo = new THREE.BoxGeometry(boardLenMid, BOARD_THICK, BOARD_WIDTH);
      const board = new THREE.Mesh(boardGeo, boardMat);
      // Center the board between the two end caps (see below).
      board.position.set(p.tip.x - BOARD_LEN / 2, p.height, p.tip.z);
      board.castShadow = true;
      board.receiveShadow = true;
      boardGroup.add(board);

      // Rounded cap at the tip end (cute toddler-toy detail, also reads as
      // a visual marker for where the toy will hover) — flattened so it
      // continues the plank's profile instead of reading as a stray ball.
      // Its outer edge (center - capR) lands exactly on p.tip.x.
      const tipCapGeo = new THREE.SphereGeometry(capR, 12, 8);
      const tipCap = new THREE.Mesh(tipCapGeo, boardMat);
      tipCap.scale.set(1, BOARD_THICK / BOARD_WIDTH, 1);
      tipCap.position.set(p.tip.x - capR, p.height, p.tip.z);
      tipCap.castShadow = true;
      boardGroup.add(tipCap);

      // Matching rounded cap at the pillar end, so the plank reads as one
      // continuous rounded board from rail to water.
      const railCap = new THREE.Mesh(tipCapGeo, boardMat);
      railCap.scale.set(1, BOARD_THICK / BOARD_WIDTH, 1);
      railCap.position.set(PILLAR_X + capR, p.height, p.tip.z);
      railCap.castShadow = true;
      boardGroup.add(railCap);

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

  // -- Balloon + gondola -----------------------------------------------------
  // Builds the moored hot-air balloon beside the tower top: striped
  // envelope, ropes, wicker gondola, giant crate, and the two altitude
  // cloud layers along the flight path. Returns the public
  // `{ group, gondolaAnchor, setProgress }` object (plus a few extra,
  // non-contractual fields — `crateAnchor`, `progress` — that rabbit.js,
  // the other M1-owned file, reads directly).
  _buildBalloon() {
    const group = new THREE.Group();
    group.name = 'balloon';
    this.scene.add(group);

    const swayPivot = new THREE.Group();
    swayPivot.name = 'balloonSway';
    group.add(swayPivot);

    // ---- gondola basket (wicker) ----
    const basketGeo = buildOpenShellGeometry(BASKET_W, BASKET_H, BASKET_D);
    const basketMat = new THREE.MeshStandardMaterial({
      map: makeWickerTexture(),
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const basket = new THREE.Mesh(basketGeo, basketMat);
    basket.castShadow = true;
    basket.receiveShadow = true;
    swayPivot.add(basket);

    // A slim rim cap so the basket top reads as a finished edge (reuses the
    // pool's own rim-cap trick, no new draw call budget worry since it's
    // folded into the same torus approach — kept as its own tiny mesh here
    // for clarity, still well inside the ≤12 draw-call growth budget).
    const rimGeo = new THREE.TorusGeometry(
      Math.min(BASKET_W, BASKET_D) / 2 + 0.03,
      0.035,
      6,
      24
    );
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(BASKET_W / Math.min(BASKET_W, BASKET_D), BASKET_D / Math.min(BASKET_W, BASKET_D), 1);
    rim.position.y = BASKET_H;
    swayPivot.add(rim);

    // ---- giant crate ---- (walls carry the star+text mark; the floor is a
    // separate plain-wood mesh so the mark doesn't also repeat across the
    // floor when seen from above through the open top — see
    // buildOpenShellGeometry's comment).
    const crateGeo = buildOpenShellGeometry(GIANT_CRATE_DIMS.w, GIANT_CRATE_DIMS.h, GIANT_CRATE_DIMS.d, false);
    const crateMat = new THREE.MeshStandardMaterial({
      map: makeGiantCrateTexture(),
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const giantCrate = new THREE.Mesh(crateGeo, crateMat);
    giantCrate.position.set(GIANT_CRATE_LOCAL.x, 0, GIANT_CRATE_LOCAL.z);
    giantCrate.castShadow = true;
    giantCrate.receiveShadow = true;
    swayPivot.add(giantCrate);

    const crateFloorGeo = new THREE.PlaneGeometry(GIANT_CRATE_DIMS.w, GIANT_CRATE_DIMS.d);
    crateFloorGeo.rotateX(-Math.PI / 2);
    const crateFloor = new THREE.Mesh(
      crateFloorGeo,
      new THREE.MeshStandardMaterial({ color: 0x8a5228, roughness: 0.8 })
    );
    crateFloor.position.set(GIANT_CRATE_LOCAL.x, 0.005, GIANT_CRATE_LOCAL.z);
    crateFloor.receiveShadow = true;
    swayPivot.add(crateFloor);

    // ---- envelope ----
    const envelopeMat = new THREE.MeshStandardMaterial({
      map: makeBalloonStripeTexture(),
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const envelope = new THREE.Mesh(buildEnvelopeGeometry(), envelopeMat);
    envelope.position.set(0, NECK_Y, 0);
    envelope.castShadow = true;
    swayPivot.add(envelope);

    // ---- ropes: basket rim (rectangular-ish ring) up to the envelope neck ----
    const ropeGeo = new THREE.CylinderGeometry(ROPE_R, ROPE_R, 1, 6, 1);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcaa15a, roughness: 0.8 });
    const ropeMesh = new THREE.InstancedMesh(ropeGeo, ropeMat, ROPE_COUNT);
    ropeMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const rw = (BASKET_W / 2) * 0.92;
    const rd = (BASKET_D / 2) * 0.92;
    for (let i = 0; i < ROPE_COUNT; i++) {
      const ang = (i / ROPE_COUNT) * Math.PI * 2;
      from.set(Math.cos(ang) * rw, BASKET_H, Math.sin(ang) * rd);
      to.set(Math.cos(ang) * NECK_R, NECK_Y + 0.1, Math.sin(ang) * NECK_R);
      dir.subVectors(to, from);
      const len = dir.length();
      dir.normalize();
      mid.addVectors(from, to).multiplyScalar(0.5);
      dummy.position.copy(mid);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      ropeMesh.setMatrixAt(i, dummy.matrix);
    }
    ropeMesh.instanceMatrix.needsUpdate = true;
    swayPivot.add(ropeMesh);

    // ---- gondolaAnchor: Object3D at basket floor center (contract API) ----
    const gondolaAnchor = new THREE.Object3D();
    gondolaAnchor.name = 'gondolaAnchor';
    swayPivot.add(gondolaAnchor);

    // Extra (non-contract) anchor at the giant crate, so rabbit.js can find
    // it in world space for fetchGiantToy without duplicating its offset.
    const crateAnchor = new THREE.Object3D();
    crateAnchor.name = 'giantCrateAnchor';
    crateAnchor.position.set(GIANT_CRATE_LOCAL.x, GIANT_CRATE_DIMS.h * 0.6, GIANT_CRATE_LOCAL.z);
    swayPivot.add(crateAnchor);

    // ---- moored (p=0) / sky-drop (p=1) path endpoints ----
    const topPlat = this.platforms[this.platforms.length - 1];
    const mooredPos = new THREE.Vector3(
      topPlat.tip.x - 1.2,
      topPlat.tip.y - 4.7,
      topPlat.tip.z - 1.5
    );
    const dropPos = new THREE.Vector3(SKY.drop.x, SKY.drop.y, SKY.drop.z);
    group.position.copy(mooredPos);

    const balloon = {
      group,
      swayPivot,
      gondolaAnchor,
      crateAnchor,
      mooredPos,
      dropPos,
      progress: 0,
      bobPhase: Math.random() * Math.PI * 2,
      cloudLayers: null,
      setProgress: (p) => this._setBalloonProgress(p),
    };
    this.balloon = balloon;
    balloon.cloudLayers = this._buildCloudLayers(mooredPos, dropPos);
    return balloon;
  }

  // setProgress(p): pure function of p (stateless positioning, per
  // contract) — rise happens mostly in the first stretch of progress while
  // horizontal drift toward the sky-drop x/z continues the whole way, so the
  // path reads as "rise, then drift" rather than a straight diagonal line;
  // a small p-only sinusoidal wobble is layered onto X so the ascent doesn't
  // look like it's riding a rail (exactly 0 at both p=0 and p=1, so moored
  // and drop poses land exactly on their target points).
  _setBalloonProgress(p) {
    const b = this.balloon;
    if (!b) return;
    const cp = clamp01(p);
    b.progress = cp;
    const y = lerp(b.mooredPos.y, b.dropPos.y, easeOutCubic(cp));
    const xzT = smoothstep(clamp01((cp - 0.15) / 0.85));
    const x = lerp(b.mooredPos.x, b.dropPos.x, xzT);
    const z = lerp(b.mooredPos.z, b.dropPos.z, xzT);
    const wobble = Math.sin(cp * Math.PI * 3) * 0.35 * (1 - cp);
    b.group.position.set(x + wobble, y, z);
  }

  // Two cloud layers (y≈10 and y≈18) arranged in a loose ring around the
  // flight path's horizontal midpoint, so the ascending balloon (and the
  // camera following it) passes between/through them. Each layer is ONE
  // InstancedMesh (one draw call) of cross-billboard quads.
  _buildCloudLayers(mooredPos, dropPos) {
    const tex = makeAltitudeCloudTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.92,
    });
    const centerX = (mooredPos.x + dropPos.x) / 2;
    const centerZ = (mooredPos.z + dropPos.z) / 2;
    const layerDefs = [
      { y: 10, count: 5, radius: 4.6, scale: 3.2 },
      { y: 18, count: 6, radius: 6.2, scale: 4.0 },
    ];
    const geo = buildCloudCrossGeometry(1);
    const layers = [];
    for (const ld of layerDefs) {
      const mesh = new THREE.InstancedMesh(geo, mat, ld.count);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      const insts = [];
      for (let i = 0; i < ld.count; i++) {
        const ang = (i / ld.count) * Math.PI * 2 + i * 0.7; // desync from a perfect polygon
        insts.push({
          baseX: centerX + Math.cos(ang) * ld.radius,
          baseZ: centerZ + Math.sin(ang) * ld.radius,
          scale: ld.scale * (0.8 + (0.4 * ((i * 53) % 7)) / 7),
          phase: i * 1.7,
          speed: 0.05 + 0.02 * (i % 3),
        });
      }
      layers.push({ mesh, insts, y: ld.y });
    }
    this._writeCloudLayerInstances(layers, 0);
    return layers;
  }

  _writeCloudLayerInstances(layers, time) {
    const dummy = this._balloonDummy || (this._balloonDummy = new THREE.Object3D());
    for (const layer of layers) {
      for (let i = 0; i < layer.insts.length; i++) {
        const c = layer.insts[i];
        const dx = Math.sin(time * c.speed + c.phase) * 0.6;
        const dz = Math.cos(time * c.speed * 0.8 + c.phase) * 0.5;
        dummy.position.set(c.baseX + dx, layer.y, c.baseZ + dz);
        dummy.rotation.set(0, c.phase, 0);
        dummy.scale.setScalar(c.scale);
        dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, dummy.matrix);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Gentle idle bob/sway (contract: "gentle bob in SceneEnv.update") — kept
  // separate from setProgress so the latter stays a pure function of p.
  _updateBalloon(dt, time) {
    const b = this.balloon;
    if (!b) return;
    const bob = Math.sin(time * 0.9 + b.bobPhase) * 0.05;
    const swayX = Math.sin(time * 0.55 + b.bobPhase * 1.3) * 0.035;
    const swayZ = Math.cos(time * 0.5 + b.bobPhase * 0.7) * 0.03;
    const tiltZ = Math.sin(time * 0.6 + b.bobPhase) * 0.025;
    const tiltX = Math.cos(time * 0.7 + b.bobPhase * 1.1) * 0.018;
    b.swayPivot.position.set(swayX, bob, swayZ);
    b.swayPivot.rotation.set(tiltX, 0, tiltZ);
    if (b.cloudLayers) this._writeCloudLayerInstances(b.cloudLayers, time);
  }

  // -- Per-frame update ------------------------------------------------------
  update(dt, time) {
    for (const c of this._clouds) {
      c.mesh.position.y = c.baseY + Math.sin(time * 0.3 + c.phase) * 0.3;
      c.mesh.position.x = c.baseX + Math.sin(time * c.speed + c.phase) * 1.5;
    }
    this._updateBalloon(dt, time);
  }
}
