import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { LoadedAssets } from './assets';
import type { Game } from '../game';
import * as M from './materials';
import { starGeo } from './mechanic3d';
import { LIFT_H } from './car3d';

export const COL_X = 2.35;
export const LEVER_X = 3.35;
export const LEVER_Z = 0.35;
export const MECH_HOME_X = 4.35;
export const PLATE_POS = new THREE.Vector3(-3.6, 1.05, -1.4);

export class Garage3D {
  root = new THREE.Group();
  leverKnob!: THREE.Mesh;
  private leverArrowUp!: THREE.Mesh;
  private leverArrowDown!: THREE.Mesh;
  private carriages: THREE.Group[] = [];
  private latchLight!: THREE.Mesh;
  private door!: THREE.Mesh;
  private sign = new THREE.Group();
  plate = new THREE.Group();
  floorGroup = new THREE.Group();
  private windowGlow!: THREE.Mesh;

  constructor(private assets: LoadedAssets) {
    this.build();
  }

  private build(): void {
    const r = this.root;

    // diorama plinth + floor (grouped so the under-car camera can hide them)
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(15, 0.7, 16, 4, 0.18), M.wood(0xa9793f));
    plinth.position.set(0, -0.36, 2.6);
    plinth.receiveShadow = true;
    this.floorGroup.add(plinth);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(14.4, 0.06, 15.2),
      new THREE.MeshStandardMaterial({ color: 0xa8abb5, roughness: 0.85 }),
    );
    floor.position.set(0, 0, 2.6);
    floor.receiveShadow = true;
    this.floorGroup.add(floor);
    // painted work lane
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.005, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x9b9ea9, roughness: 0.8 }),
    );
    lane.position.set(0, 0.035, 0);
    lane.receiveShadow = true;
    this.floorGroup.add(lane);
    const laneStripe = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.004, 0.12),
      M.plastic(0xffd166, 0.6),
    );
    for (const z of [-1.8, 1.8]) {
      const s = laneStripe.clone();
      s.position.set(0, 0.04, z);
      this.floorGroup.add(s);
    }
    r.add(this.floorGroup);

    // back wall (tall enough to fill portrait frames)
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(14.4, 9, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xefdcc2, roughness: 0.9 }),
    );
    wall.position.set(0, 4.5, -3.6);
    wall.receiveShadow = true;
    r.add(wall);
    const base = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.22, 0.34), M.wood(0xc9b090));
    base.position.set(0, 0.11, -3.58);
    r.add(base);

    // window
    const winFrame = new THREE.Mesh(new RoundedBoxGeometry(2.3, 1.5, 0.16, 3, 0.06), M.wood(0xd9c3a3));
    winFrame.position.set(-3.4, 2.75, -3.44);
    r.add(winFrame);
    this.windowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.2),
      M.emissive(0xbfe8fa, 0.9),
    );
    this.windowGlow.position.set(-3.4, 2.75, -3.35);
    r.add(this.windowGlow);
    for (const [dx, dy, w, h] of [[0, 0, 0.08, 1.2], [0, 0, 2.0, 0.08]] as Array<[number, number, number, number]>) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), M.wood(0xd9c3a3));
      bar.position.set(-3.4 + dx, 2.75 + dy, -3.33);
      r.add(bar);
    }

    // tool board
    const board = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.3, 0.1, 3, 0.05), M.wood(0xe0b98a));
    board.position.set(4.6, 2.75, -3.47);
    r.add(board);
    this.addToolShapes(board.position);

    // tool cart
    this.buildCart(new THREE.Vector3(-4.6, 0, -2.2));
    // props: cones + tire stack + box
    const cone = this.assets.prop('cone');
    cone.scale.setScalar(1.6);
    cone.position.set(-4.9, 0.02, 0.9);
    r.add(cone);
    const cone2 = this.assets.prop('cone');
    cone2.scale.setScalar(1.6);
    cone2.position.set(-5.1, 0.02, 1.5);
    r.add(cone2);
    for (let i = 0; i < 3; i++) {
      const tire = this.assets.prop('debris-tire');
      tire.scale.setScalar(1.5);
      tire.position.set(5.2, 0.02 + i * 0.27, -2.6);
      tire.rotation.y = i * 0.7;
      r.add(tire);
    }
    const box = this.assets.prop('box');
    box.scale.setScalar(1.4);
    box.position.set(4.4, 0.02, -2.9);
    r.add(box);

    // upper-wall décor (fills the tall portrait framing)
    const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 24), M.plastic(0xf6f2e8, 0.5));
    clockFace.rotation.x = Math.PI / 2;
    clockFace.position.set(0.2, 5.4, -3.42);
    r.add(clockFace);
    const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 10, 28), M.plastic(0xe5604a, 0.45));
    clockRim.position.set(0.2, 5.4, -3.4);
    r.add(clockRim);
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.03), M.plastic(0x39404e, 0.4));
    hourHand.position.set(0.2, 5.5, -3.36);
    r.add(hourHand);
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.03), M.plastic(0x39404e, 0.4));
    minHand.rotation.z = -1.2;
    minHand.position.set(0.33, 5.42, -3.36);
    r.add(minHand);
    // shelf with paint cans
    const shelf = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.1, 0.5, 2, 0.03), M.wood(0xc9a06a));
    shelf.position.set(-2.6, 4.6, -3.35);
    r.add(shelf);
    for (let i = 0; i < 4; i++) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.34, 14),
        M.plastic([0x5ecfbf, 0xffc94d, 0xef6a5a, 0x8fd0f0][i], 0.5),
      );
      can.position.set(-3.5 + i * 0.6, 4.85, -3.35);
      r.add(can);
    }
    // hanging pennant string
    for (let i = 0; i < 7; i++) {
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.34, 3),
        M.plastic([0xffd166, 0xf291b1, 0x8fd0f0, 0xc5f6d0][i % 4], 0.55),
      );
      flag.rotation.z = Math.PI;
      flag.rotation.y = Math.PI / 6;
      flag.position.set(2.2 + i * 0.55, 6.1 - Math.sin((i / 6) * Math.PI) * 0.5, -3.3);
      r.add(flag);
    }

    this.buildLift();
    this.buildLever();
    this.buildDoor();
    this.buildSign();
    this.buildPlate();
  }

  private addToolShapes(at: THREE.Vector3): void {
    const mat = M.wood(0x8a6444);
    const mk = (geo: THREE.BufferGeometry, x: number, y: number): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(at.x + x, at.y + y, at.z + 0.08);
      this.root.add(m);
    };
    mk(new THREE.CapsuleGeometry(0.035, 0.5, 3, 8), -0.55, -0.05);
    mk(new THREE.TorusGeometry(0.09, 0.03, 6, 14, Math.PI * 1.5), -0.55, 0.35);
    mk(new THREE.CapsuleGeometry(0.035, 0.45, 3, 8), 0, -0.08);
    mk(new RoundedBoxGeometry(0.3, 0.14, 0.06, 2, 0.02), 0, 0.28);
    mk(new THREE.CapsuleGeometry(0.03, 0.4, 3, 8), 0.55, -0.05);
    mk(new RoundedBoxGeometry(0.12, 0.2, 0.06, 2, 0.03), 0.55, 0.3);
  }

  private buildCart(at: THREE.Vector3): void {
    const cart = new THREE.Group();
    const bodyM = new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.15, 0.7, 3, 0.07), M.plastic(0xd0442f, 0.45));
    bodyM.position.y = 0.75;
    bodyM.castShadow = true;
    cart.add(bodyM);
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.24, 0.05, 2, 0.02), M.plastic(0xe5604a, 0.5));
      drawer.position.set(0, 0.42 + i * 0.32, 0.36);
      cart.add(drawer);
      const handle = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.05, 0.04, 1, 0.02), M.plastic(0xf7d9a0, 0.4));
      handle.position.set(0, 0.42 + i * 0.32, 0.4);
      cart.add(handle);
    }
    for (const [x, z] of [[-0.4, 0.25], [0.4, 0.25], [-0.4, -0.25], [0.4, -0.25]] as Array<[number, number]>) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), M.rubber());
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.1, z);
      cart.add(wheel);
    }
    cart.position.copy(at);
    this.root.add(cart);
  }

  private buildLift(): void {
    for (const x of [-COL_X, COL_X]) {
      const col = new THREE.Mesh(new RoundedBoxGeometry(0.34, 2.7, 0.34, 3, 0.08), M.plastic(0xf09a3c, 0.5));
      col.position.set(x, 1.35, 0);
      col.castShadow = true;
      this.root.add(col);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.12, 0.7, 2, 0.05), M.wood(0x8a6a3c));
      foot.position.set(x, 0.06, 0);
      this.root.add(foot);
      // carriage with arms toward the car
      const carriage = new THREE.Group();
      const block = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.34, 0.42, 2, 0.06), M.metal(0x5a5f6b, 0.5));
      carriage.add(block);
      const toCar = x < 0 ? 1 : -1;
      for (const z of [-0.42, 0.42]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.14), M.metal(0x454a55, 0.5));
        arm.position.set(toCar * 0.72, -0.06, z);
        carriage.add(arm);
        const pad = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.08, 0.2, 2, 0.03), M.rubber());
        pad.position.set(toCar * 1.2, -0.02, z);
        carriage.add(pad);
      }
      carriage.position.set(x, 0.35, 0);
      this.root.add(carriage);
      this.carriages.push(carriage);
    }
    // safety latch light on the right column
    this.latchLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.emissive(0xc8cdd6, 0.3));
    this.latchLight.position.set(COL_X + 0.13, 2.5, 0.14);
    this.root.add(this.latchLight);
  }

  private buildLever(): void {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.0, 14), M.metal(0x7c8494, 0.45));
    ped.position.set(LEVER_X, 0.5, LEVER_Z);
    ped.castShadow = true;
    this.root.add(ped);
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.85, 0.18, 3, 0.07), M.plastic(0x5a6272, 0.45));
    panel.position.set(LEVER_X, 1.35, LEVER_Z);
    panel.rotation.x = -0.15;
    panel.castShadow = true;
    this.root.add(panel);
    // slot
    const slot = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.58, 0.05, 2, 0.03), M.plastic(0x22262e, 0.6));
    slot.position.set(LEVER_X, 1.35, LEVER_Z + 0.1);
    slot.rotation.x = -0.15;
    this.root.add(slot);
    // stick + big red ball knob
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), M.paint(0xe5604a));
    knob.castShadow = true;
    this.root.add(knob);
    this.leverKnob = knob;
    // arrows
    const arrowGeo = chevronGeo(0.15);
    this.leverArrowUp = new THREE.Mesh(arrowGeo, M.emissive(0xffd166, 0.35));
    this.leverArrowUp.position.set(LEVER_X, 1.82, LEVER_Z + 0.13);
    this.leverArrowUp.rotation.x = -0.15;
    this.root.add(this.leverArrowUp);
    this.leverArrowDown = new THREE.Mesh(arrowGeo, M.emissive(0xffd166, 0.35));
    this.leverArrowDown.position.set(LEVER_X, 0.9, LEVER_Z + 0.13);
    this.leverArrowDown.rotation.x = Math.PI - 0.15;
    this.root.add(this.leverArrowDown);
  }

  private buildDoor(): void {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.3, 3.4, 3.4, 2, 0.08), M.wood(0xd9c3a3));
    frame.position.set(6.2, 1.7, 0);
    this.root.add(frame);
    this.door = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 3.0, 3.0),
      new THREE.MeshStandardMaterial({ color: 0x8fa4ae, roughness: 0.6, metalness: 0.3 }),
    );
    this.door.position.set(6.2, 1.5, 0);
    this.root.add(this.door);
    // slat lines
    for (let i = 0; i < 6; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 3.0), M.metal(0x6d818c, 0.5));
      slat.position.set(0, -1.3 + i * 0.5, 0);
      this.door.add(slat);
    }
  }

  private buildSign(): void {
    const board = new THREE.Mesh(new RoundedBoxGeometry(2.7, 1.2, 0.14, 3, 0.1), M.wood(0xc98f4e));
    this.sign.add(board);
    const tex = M.canvasTexture(1024, 448, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#5a3d1e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 104px "Hiragino Maru Gothic ProN", "BIZ UDGothic", "Yu Gothic", sans-serif';
      ctx.fillText('スルッ！ピカッ！', w / 2, h * 0.32);
      ctx.font = 'bold 88px "Hiragino Maru Gothic ProN", "BIZ UDGothic", "Yu Gothic", sans-serif';
      ctx.fillText('おなかのガレージ', w / 2, h * 0.68);
    });
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 1.1),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8 }),
    );
    face.position.z = 0.08;
    this.sign.add(face);
    for (const s of [-1, 1]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), M.wood(0x8a6a3c));
      rope.position.set(s * 0.95, 1.0, 0);
      this.sign.add(rope);
      const star = new THREE.Mesh(starGeo(0.12), M.emissive(0xfff3b0, 0.5));
      star.position.set(s * 1.2, s * 0.4, 0.1);
      this.sign.add(star);
    }
    this.sign.position.set(0, 3.05, -0.9);
    this.root.add(this.sign);
  }

  private buildPlate(): void {
    // practice welding plate on an easel (free play)
    const legs = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), M.wood(0x8a6a3c));
      leg.position.set(s * 0.55, -0.45, s * 0.05);
      leg.rotation.z = s * 0.12;
      legs.add(leg);
    }
    this.plate.add(legs);
    // clean seamless steel sheet with corner rivets (invites doodling)
    const sheet = new THREE.Mesh(
      new RoundedBoxGeometry(1.95, 1.95, 0.1, 3, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.4, metalness: 0.6 }),
    );
    sheet.rotation.x = -0.12;
    sheet.position.set(0, 0.1, 0);
    this.plate.add(sheet);
    for (const [rx, ry] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as Array<[number, number]>) {
      const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), M.metal(0x7c8494, 0.4));
      rivet.rotation.x = Math.PI / 2 - 0.12;
      rivet.position.set(rx, 0.1 + ry * Math.cos(0.12), 0.06 + ry * Math.sin(0.12) * -1);
      this.plate.add(rivet);
    }
    this.plate.position.copy(PLATE_POS);
    this.root.add(this.plate);
  }

  update(g: Game, time: number): void {
    // lift carriages + latch
    for (const c of this.carriages) c.position.y = 0.35 + g.liftT * LIFT_H;
    const latch = this.latchLight.material as THREE.MeshStandardMaterial;
    latch.color.set(g.locked ? 0x7ddf8f : 0xc8cdd6);
    latch.emissive.set(g.locked ? 0x7ddf8f : 0xc8cdd6);
    latch.emissiveIntensity = g.locked ? 1.6 + g.lockFlash * 3 : 0.25;

    // lever knob slides in the slot
    const knobY = 1.35 + (g.liftT - 0.5) * 0.5 + g.leverPull * 0.16;
    this.leverKnob.position.set(LEVER_X, knobY, LEVER_Z + 0.16 + (1.35 - knobY) * -0.15);

    const canUse = g.phase === 'garage' && !g.liftAnim && !g.fade;
    const pulse = (Math.sin(time * 4.5) + 1) / 2;
    const upAct = canUse && g.liftT === 0;
    const downAct = canUse && g.liftT >= 1 && (g.freePlay || g.allRepaired());
    (this.leverArrowUp.material as THREE.MeshStandardMaterial).emissiveIntensity = upAct ? 0.7 + pulse * 1.6 : 0.15;
    (this.leverArrowDown.material as THREE.MeshStandardMaterial).emissiveIntensity = downAct ? 0.7 + pulse * 1.6 : 0.15;

    // rolling door
    this.door.position.y = 1.5 + g.doorT * 2.6;
    this.door.visible = g.doorT < 0.98;

    // title sign floats gently, only on the title screen
    this.sign.visible = g.phase === 'title';
    this.sign.position.y = 3.05 + Math.sin(time * 1.4) * 0.04;
    this.sign.rotation.z = Math.sin(time * 0.9) * 0.02;

    this.plate.visible = g.freePlay
      && (g.phase === 'garage' || g.phase === 'slideIn' || g.phase === 'slideOut' || g.phase === 'freeweld');
    void this.windowGlow;
  }
}

function chevronGeo(r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-r, -r * 0.4);
  s.lineTo(0, r * 0.5);
  s.lineTo(r, -r * 0.4);
  s.lineTo(r * 0.62, -r * 0.75);
  s.lineTo(0, -r * 0.05);
  s.lineTo(-r * 0.62, -r * 0.75);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: r * 0.3, bevelEnabled: false });
}
