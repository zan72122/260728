// Toy definitions & meshes — see docs/CONTRACTS.md ("ToyDef", "src/toys.js — F").
// Owner: F (toys). Procedural geometry + a few canvas textures, generated
// once and cached. No build step, no external deps beyond three.js.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// ToyDef table. ids/shapes/radii/densities/softness are fixed by the
// contract (docs/CONTRACTS.md); name/emoji/color/bounciness are this
// module's own kid-friendly tuning.
// ---------------------------------------------------------------------------
export const TOYS = [
  { id: 'pingpong',  name: 'ピンポンだま', emoji: '🏓', shape: 'sphere', radius: 0.12, density: 0.08, softness: 0,   bounciness: 0.85, color: 0xffffff },
  { id: 'heavyball', name: 'おもいボール', emoji: '🎳', shape: 'sphere', radius: 0.35, density: 2.6,  softness: 0,   bounciness: 0.15, color: 0x1c1c2e },
  { id: 'beachball', name: 'ビーチボール', emoji: '🏖', shape: 'sphere', radius: 0.5,  density: 0.05, softness: 0,   bounciness: 0.6,  color: 0xff5252 },
  { id: 'disc',      name: 'えんばん',     emoji: '🥏', shape: 'disc',   radius: 0.42, density: 1.3,  softness: 0,   bounciness: 0.35, color: 0x42a5f5 },
  { id: 'cup',       name: 'コップ',       emoji: '🥤', shape: 'cup',    radius: 0.24, density: 0.45, softness: 0,   bounciness: 0.2,  color: 0xffb6c8 },
  { id: 'sponge',    name: 'スポンジ',     emoji: '🧽', shape: 'box',    radius: 0.3,  density: 0.15, softness: 0.7, bounciness: 0.1,  color: 0xfff176 },
  { id: 'ring',      name: 'うきわ',       emoji: '🛟', shape: 'torus',  radius: 0.45, density: 0.09, softness: 0,   bounciness: 0.4,  color: 0xff5252 },
  { id: 'jelly',     name: 'ゼリーボール', emoji: '🍮', shape: 'sphere', radius: 0.3,  density: 1.05, softness: 1,   bounciness: 0.9,  color: 0xff8fc7 },
];

// ---------------------------------------------------------------------------
// Canvas texture cache — every texture is generated exactly once (lazily,
// on first use) and reused by all mesh instances of that toy.
// ---------------------------------------------------------------------------
const _texCache = new Map();

function cachedTexture(key, w, h, draw) {
  let tex = _texCache.get(key);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// ---- beach ball: 6 rainbow longitude stripes on an equirect map -----------
function beachballTexture() {
  return cachedTexture('beachball', 512, 256, (ctx, w, h) => {
    const colors = ['#ff5252', '#ffca28', '#66bb6a', '#42a5f5', '#ab47bc', '#ffffff'];
    const n = colors.length;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i];
      ctx.fillRect((i * w) / n, 0, w / n + 1, h);
    }
    // white polar caps so the stripes taper like a real beach ball
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(w / 2, 0, w / 2, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w / 2, h, w / 2, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ---- heavy ball: 3 finger-hole dots clustered near one pole ---------------
function heavyballTexture() {
  return cachedTexture('heavyball', 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c1c2e';
    ctx.fillRect(0, 0, w, h);
    const dots = [
      [0.52, 0.2],
      [0.63, 0.2],
      [0.575, 0.31],
    ];
    for (const [u, v] of dots) {
      const x = u * w;
      const y = v * h;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, w * 0.035);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(1, '#141420');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, w * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ---- sponge: yellow with darker irregular holes ----------------------------
function spongeTexture() {
  return cachedTexture('sponge', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fff176';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(180, 150, 40, 0.55)';
    // fixed layout, generated once — purely cosmetic, no gameplay determinism needed
    const holes = [
      [0.2, 0.25, 10], [0.6, 0.18, 8], [0.42, 0.4, 12], [0.8, 0.35, 7],
      [0.15, 0.65, 9], [0.5, 0.7, 11], [0.75, 0.75, 8], [0.3, 0.85, 7],
      [0.88, 0.6, 6], [0.08, 0.45, 6],
    ];
    for (const [u, v, r] of holes) {
      ctx.beginPath();
      ctx.arc(u * w, v * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ---- ring float: red/white candy stripes around the tube ------------------
function ringTexture() {
  return cachedTexture('ring', 256, 64, (ctx, w, h) => {
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ff5252' : '#ffffff';
      ctx.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
    }
  });
}

// ---- cup: small star sticker (transparent background) ---------------------
function starTexture() {
  return cachedTexture('star', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = '#ffe95c';
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const spikes = 5;
    const outer = w * 0.38;
    const inner = outer * 0.45;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI * i) / spikes - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

// ---------------------------------------------------------------------------
// Geometry builders — one per toy id. Each returns a THREE.Group centered on
// the geometric origin, ready for userData.def to be attached.
// ---------------------------------------------------------------------------

function buildSphereMesh(def, map, matOpts) {
  const geo = new THREE.SphereGeometry(def.radius, 24, 18);
  const mat = new THREE.MeshStandardMaterial(Object.assign(
    { color: def.color, roughness: 0.45, metalness: 0.05, map: map || null },
    matOpts
  ));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function buildPingpong(def) {
  const group = new THREE.Group();
  group.add(buildSphereMesh(def, null, { roughness: 0.3 }));
  // subtle seam: a thin ring hugging the surface, slightly tilted
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius * 0.99, def.radius * 0.018, 6, 32),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 })
  );
  seam.rotation.x = Math.PI / 2.3;
  group.add(seam);
  return group;
}

function buildHeavyball(def) {
  const group = new THREE.Group();
  group.add(buildSphereMesh(def, heavyballTexture(), { roughness: 0.15, metalness: 0.25 }));
  return group;
}

function buildBeachball(def) {
  const group = new THREE.Group();
  group.add(buildSphereMesh(def, beachballTexture(), { roughness: 0.5, metalness: 0 }));
  return group;
}

function buildJelly(def) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({
    color: def.color,
    transparent: true,
    opacity: 0.55,
    shininess: 90,
    specular: 0xffffff,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 24, 18), mat);
  group.add(mesh);
  // inner "fruit" dot floating at the center, visible through the jelly
  const fruit = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff4d8a, roughness: 0.4 })
  );
  group.add(fruit);
  return group;
}

function buildDisc(def) {
  const r = def.radius;
  const th = r * 0.16;
  // profile revolved around Y: bottom pole -> rim (with a groove ripple) -> top pole
  const pts = [
    new THREE.Vector2(0, -th),
    new THREE.Vector2(r * 0.8, -th * 0.9),
    new THREE.Vector2(r, -th * 0.25),
    new THREE.Vector2(r, th * 0.05),
    new THREE.Vector2(r * 0.94, th * 0.45),
    new THREE.Vector2(r * 0.86, th * 0.3),
    new THREE.Vector2(r * 0.78, th * 0.5),
    new THREE.Vector2(r * 0.55, th * 0.6),
    new THREE.Vector2(0, th * 0.55),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function buildCup(def) {
  const R = def.radius;
  const half = R * 0.62;
  const rimOuter = R * 0.98;
  const rimInner = R * 0.82;
  const baseOuter = R * 0.7;
  const baseInner = R * 0.58;
  // profile: rim outer -> down outside -> across bottom -> up inside -> rim
  // inner. This single revolved surface yields a genuinely hollow, open cup.
  const pts = [
    new THREE.Vector2(rimOuter, half),
    new THREE.Vector2(baseOuter, -half + R * 0.06),
    new THREE.Vector2(baseOuter * 0.92, -half),
    new THREE.Vector2(baseInner * 0.92, -half),
    new THREE.Vector2(baseInner, -half + R * 0.1),
    new THREE.Vector2(rimInner, half - R * 0.03),
    new THREE.Vector2(rimInner, half),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  const mat = new THREE.MeshStandardMaterial({
    color: def.color, roughness: 0.4, metalness: 0.03, side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = body.receiveShadow = true;
  const group = new THREE.Group();
  group.add(body);

  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(R * 0.55, R * 0.55),
    new THREE.MeshBasicMaterial({ map: starTexture(), transparent: true, alphaTest: 0.3 })
  );
  sticker.position.set(0, 0, rimOuter * 0.99);
  group.add(sticker);
  return group;
}

// Rounds the corners of a subdivided box by clamping each vertex toward an
// inner box and pushing the remainder out to a fixed radius (superellipsoid-
// style corner rounding). Cheap: runs once at mesh-creation time only.
function makeRoundedBoxGeometry(sx, sy, sz, radius, segments) {
  const geo = new THREE.BoxGeometry(sx, sy, sz, segments, segments, segments);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const innerX = sx / 2 - radius;
  const innerY = sy / 2 - radius;
  const innerZ = sz / 2 - radius;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -innerX, innerX);
    const cy = THREE.MathUtils.clamp(v.y, -innerY, innerY);
    const cz = THREE.MathUtils.clamp(v.z, -innerZ, innerZ);
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dz = v.z - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
      const s = radius / len;
      v.set(cx + dx * s, cy + dy * s, cz + dz * s);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function buildSponge(def) {
  // rounded rectangular block (wider than tall), bounding sphere == def.radius
  const ax = 1.25, ay = 0.7, az = 1.0; // relative shape ratios
  const norm = Math.sqrt(ax * ax + ay * ay + az * az) / 2;
  const k = def.radius / norm;
  const sx = ax * k, sy = ay * k, sz = az * k;
  const geo = makeRoundedBoxGeometry(sx, sy, sz, Math.min(sx, sy, sz) * 0.28, 4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: spongeTexture(), roughness: 0.9, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function buildRing(def) {
  const tube = def.radius * 0.32;
  const major = def.radius - tube;
  const geo = new THREE.TorusGeometry(major, tube, 16, 40);
  geo.rotateX(Math.PI / 2); // lie flat like a float, hole axis pointing +Y
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: ringTexture(), roughness: 0.5, metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

const BUILDERS = {
  pingpong: buildPingpong,
  heavyball: buildHeavyball,
  beachball: buildBeachball,
  disc: buildDisc,
  cup: buildCup,
  sponge: buildSponge,
  ring: buildRing,
  jelly: buildJelly,
};

// createToyMesh(def) -> THREE.Object3D, procedural + cheap (<=3 draw calls),
// origin at geometric center, bounding radius ~= def.radius, cup opening +Y.
export function createToyMesh(def) {
  const build = BUILDERS[def.id] || buildSphereGeneric;
  const obj = build(def);
  obj.userData.def = def;
  obj.userData.baseScale = new THREE.Vector3(1, 1, 1);
  return obj;
}

// Fallback for an unrecognized future toy id — keeps the module robust.
function buildSphereGeneric(def) {
  const group = new THREE.Group();
  group.add(buildSphereMesh(def, null, {}));
  return group;
}

// ---------------------------------------------------------------------------
// deformToy: cheap, idempotent visual squash/stretch. amount is 0..1 (0
// restores the mesh to its original scale exactly), dirY is roughly the
// vertical component of the impact/deform direction (used to weight how
// much of the squash lands on the Y axis vs. being more uniform). Safe to
// call every frame; no per-call allocation.
// ---------------------------------------------------------------------------
const _deformScale = new THREE.Vector3();

export function deformToy(obj, amount, dirY) {
  if (!obj) return;
  if (!obj.userData.baseScale) obj.userData.baseScale = obj.scale.clone();
  const base = obj.userData.baseScale;
  const def = obj.userData.def;
  const softness = def ? def.softness || 0 : 0;
  // rigid toys barely deform; jelly/sponge wobble a lot
  const maxSquash = 0.12 + 0.5 * softness;
  const a = THREE.MathUtils.clamp(amount, 0, 1);
  const w = dirY === undefined || dirY === null
    ? 1
    : THREE.MathUtils.clamp(Math.abs(dirY), 0, 1) * 0.6 + 0.4;
  const yScale = 1 - a * maxSquash * w;
  const xzScale = 1 / Math.sqrt(Math.max(0.35, yScale));
  _deformScale.set(base.x * xzScale, base.y * yScale, base.z * xzScale);
  obj.scale.copy(_deformScale);
}
