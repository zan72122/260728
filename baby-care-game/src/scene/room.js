import * as THREE from 'three';
import { PALETTE, toon, toonUnique } from './palette.js';
import { makeWoodTexture, makeStoneTexture, makeSkyTexture } from './textures.js';
import { makeArchGeometry } from '../util/shapes.js';
import { damp } from '../util/tween.js';

export const ROOM_HALF = 4.6;   // 部屋の半分の広さ
export const WALL_HEIGHT = 3.2;

const ROOF_COLORS = [PALETTE.pink, PALETTE.mint, PALETTE.sky, PALETTE.lilac];

/**
 * お城風ベビーハウス（1部屋）。
 * カメラが自由に回るので、手前になった壁と塔は自動で透けさせる。
 */
export class Room {
  constructor() {
    this.group = new THREE.Group();
    this.faders = [];

    this._buildFloor();
    this._buildWalls();
    this._buildTowers();

    this._camDir = new THREE.Vector3();
  }

  /**
   * 透け対象として登録する。outward は部屋の中心から外向きのベクトル。
   * groups には マテリアルの配列を入れる（あとから増える配列でもよい）。
   */
  _registerFader(outward, materials) {
    const fader = { outward: outward.clone().normalize(), groups: [materials] };
    this.faders.push(fader);
    return fader;
  }

  /** かべに 物をとりつけ、かべといっしょに 透けるようにする。 */
  attachToWall(name, object, materials) {
    const wall = this.walls[name];
    if (!wall) return;
    wall.add(object);
    if (materials) this.wallFaders[name].groups.push(materials);
  }

  _buildFloor() {
    const tex = makeWoodTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2),
      new THREE.MeshToonMaterial({ map: tex, color: 0xffffff })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    this.floor = floor;

    // 床のふちの飾り板
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_HALF * 2 + 0.5, 0.16, ROOM_HALF * 2 + 0.5),
      toon(PALETTE.woodDark)
    );
    skirt.position.y = -0.09;
    this.group.add(skirt);
  }

  _buildWalls() {
    const stone = makeStoneTexture();
    const sky = makeSkyTexture();

    const sides = [
      { rotY: 0, pos: new THREE.Vector3(0, 0, -ROOM_HALF), outward: new THREE.Vector3(0, 0, -1), kind: 'back' },
      { rotY: Math.PI, pos: new THREE.Vector3(0, 0, ROOM_HALF), outward: new THREE.Vector3(0, 0, 1), kind: 'front' },
      { rotY: Math.PI / 2, pos: new THREE.Vector3(-ROOM_HALF, 0, 0), outward: new THREE.Vector3(-1, 0, 0), kind: 'window' },
      { rotY: -Math.PI / 2, pos: new THREE.Vector3(ROOM_HALF, 0, 0), outward: new THREE.Vector3(1, 0, 0), kind: 'window' },
    ];

    this.walls = {};
    this.wallFaders = {};

    for (const side of sides) {
      const wall = new THREE.Group();
      wall.position.copy(side.pos);
      wall.rotation.y = side.rotY;
      const mats = [];

      const stoneMat = new THREE.MeshToonMaterial({ map: stone, color: 0xffffff, transparent: true });
      mats.push(stoneMat);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF * 2 + 0.24, WALL_HEIGHT, 0.24), stoneMat);
      slab.position.y = WALL_HEIGHT / 2;
      slab.receiveShadow = true;
      wall.add(slab);

      // 腰板（木目）とその上のパステルの帯
      const wainscot = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF * 2 + 0.26, 0.75, 0.06), toonUnique(PALETTE.wood, { transparent: true }));
      wainscot.position.set(0, 0.375, 0.13);
      mats.push(wainscot.material);
      wall.add(wainscot);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF * 2 + 0.26, 0.1, 0.08), toonUnique(PALETTE.mint, { transparent: true }));
      stripe.position.set(0, 0.79, 0.14);
      mats.push(stripe.material);
      wall.add(stripe);

      if (side.kind === 'window') {
        for (const x of [-1.7, 1.7]) mats.push(...this._addWindow(wall, x, sky));
      } else if (side.kind === 'front') {
        mats.push(...this._addDoor(wall));
      } else {
        mats.push(...this._addRoundWindow(wall, sky));
      }

      mats.push(this._addBattlement(wall));

      const name = side.kind === 'window' ? (side.outward.x < 0 ? 'left' : 'right') : side.kind;
      this.group.add(wall);
      this.walls[name] = wall;
      this.wallFaders[name] = this._registerFader(side.outward, mats);
    }
  }

  /** アーチ窓（枠 → 空 → 桟）。壁の内側にすこし彫り込む。 */
  _addWindow(wall, x, skyTex) {
    const mats = [];
    const frameMat = toonUnique(PALETTE.woodDark, { transparent: true });
    const frame = new THREE.Mesh(makeArchGeometry(1.45, 2.0, 0.1), frameMat);
    frame.position.set(x, 0.95, 0.1);
    wall.add(frame);
    mats.push(frameMat);

    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, transparent: true });
    const pane = new THREE.Mesh(makeArchGeometry(1.2, 1.8, 0.04), skyMat);
    pane.position.set(x, 1.05, 0.13);
    wall.add(pane);
    mats.push(skyMat);

    const barMat = toonUnique(PALETTE.cream, { transparent: true });
    const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.45, 0.06), barMat);
    vbar.position.set(x, 1.82, 0.17);
    wall.add(vbar);
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.07, 0.06), barMat);
    hbar.position.set(x, 1.9, 0.17);
    wall.add(hbar);
    mats.push(barMat);

    // 窓辺の小さな鉢植え
    const potMat = toonUnique(PALETTE.peach, { transparent: true });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.16, 12), potMat);
    pot.position.set(x, 0.19, 0.28);
    wall.add(pot);
    mats.push(potMat);
    const leafMat = toonUnique(PALETTE.mint, { transparent: true });
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), leafMat);
      leaf.position.set(x + (i - 1) * 0.09, 0.32 + (i === 1 ? 0.06 : 0), 0.28);
      leaf.scale.set(1, 1.3, 1);
      wall.add(leaf);
    }
    mats.push(leafMat);
    return mats;
  }

  _addRoundWindow(wall, skyTex) {
    const mats = [];
    const frameMat = toonUnique(PALETTE.woodDark, { transparent: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 20), frameMat);
    ring.position.set(0, 2.76, 0.14);
    wall.add(ring);
    mats.push(frameMat);

    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, transparent: true });
    const pane = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), skyMat);
    pane.position.set(0, 2.76, 0.13);
    wall.add(pane);
    mats.push(skyMat);
    return mats;
  }

  _addDoor(wall) {
    const mats = [];
    const doorMat = toonUnique(PALETTE.wood, { transparent: true });
    const door = new THREE.Mesh(makeArchGeometry(1.4, 2.2, 0.12), doorMat);
    door.position.set(0, 0.05, 0.12);
    wall.add(door);
    mats.push(doorMat);

    const panelMat = toonUnique(PALETTE.woodLight, { transparent: true });
    const panel = new THREE.Mesh(makeArchGeometry(1.1, 1.9, 0.06), panelMat);
    panel.position.set(0, 0.12, 0.17);
    wall.add(panel);
    mats.push(panelMat);

    const knobMat = toonUnique(PALETTE.butter, { transparent: true });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), knobMat);
    knob.position.set(0.42, 1.0, 0.22);
    wall.add(knob);
    mats.push(knobMat);
    return mats;
  }

  /** 壁の上のギザギザ（狭間）。ひとつの InstancedMesh でまとめて描く。 */
  _addBattlement(wall) {
    const step = 0.86;
    const count = Math.floor((ROOM_HALF * 2) / step) + 1;
    const mat = toonUnique(PALETTE.wallStoneAlt, { transparent: true });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.38, 0.3), mat, count);
    const m = new THREE.Matrix4();
    const start = -((count - 1) * step) / 2;
    for (let i = 0; i < count; i++) {
      m.makeTranslation(start + i * step, WALL_HEIGHT + 0.19, 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    wall.add(mesh);
    return mat;
  }

  /** 四隅のとんがり屋根の塔。お城らしさはここで出る。 */
  _buildTowers() {
    const corners = [
      new THREE.Vector3(-ROOM_HALF, 0, -ROOM_HALF),
      new THREE.Vector3(ROOM_HALF, 0, -ROOM_HALF),
      new THREE.Vector3(-ROOM_HALF, 0, ROOM_HALF),
      new THREE.Vector3(ROOM_HALF, 0, ROOM_HALF),
    ];

    corners.forEach((pos, i) => {
      const tower = new THREE.Group();
      tower.position.copy(pos);
      const mats = [];

      const bodyMat = toonUnique(PALETTE.wallStone, { transparent: true });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, WALL_HEIGHT + 0.6, 16), bodyMat);
      body.position.y = (WALL_HEIGHT + 0.6) / 2;
      tower.add(body);
      mats.push(bodyMat);

      const bandMat = toonUnique(PALETTE.woodLight, { transparent: true });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.14, 16), bandMat);
      band.position.y = WALL_HEIGHT + 0.6;
      tower.add(band);
      mats.push(bandMat);

      const roofMat = toonUnique(ROOF_COLORS[i], { transparent: true });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.5, 16), roofMat);
      roof.position.y = WALL_HEIGHT + 1.4;
      tower.add(roof);
      mats.push(roofMat);

      const poleMat = toonUnique(PALETTE.woodDark, { transparent: true });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), poleMat);
      pole.position.y = WALL_HEIGHT + 2.45;
      tower.add(pole);
      mats.push(poleMat);

      const flagMat = toonUnique(ROOF_COLORS[(i + 2) % 4], { transparent: true, side: THREE.DoubleSide });
      const flagShape = new THREE.Shape();
      flagShape.moveTo(0, 0); flagShape.lineTo(0.42, -0.11); flagShape.lineTo(0, -0.24); flagShape.closePath();
      const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), flagMat);
      flag.position.set(0.02, WALL_HEIGHT + 2.75, 0);
      tower.add(flag);
      mats.push(flagMat);
      tower.userData.flag = flag;

      this.group.add(tower);
      this._registerFader(pos, mats);
    });
  }

  update(camera, dt, time) {
    // 手前にきた壁・塔を透かして、部屋の中がいつでも見えるようにする
    this._camDir.set(camera.position.x, 0, camera.position.z).normalize();
    for (const fader of this.faders) {
      const facing = fader.outward.dot(this._camDir);
      const target = facing > 0.12 ? 0.05 : 1;
      for (const group of fader.groups) {
        for (const mat of group) {
          mat.opacity = damp(mat.opacity, target, 8, dt);
          mat.depthWrite = mat.opacity > 0.85;
          mat.visible = mat.opacity > 0.02;
        }
      }
    }
    // 旗をひらひらさせる
    this.group.children.forEach((child) => {
      if (child.userData.flag) child.userData.flag.rotation.y = Math.sin(time * 2.2 + child.position.x) * 0.35;
    });
  }
}
