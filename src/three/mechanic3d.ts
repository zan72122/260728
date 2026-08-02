import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as M from './materials';

// The robot mechanic レンチちゃん, built procedurally so the face, eyes and
// poses stay fully controllable (glTF robots can't emote like this).

const CREAM = 0xf7f3ea;
const SUIT = 0xff8a5c;
const SUIT_DARK = 0xe06a3e;
const PINK = 0xf291b1;

export type Pose = 'lie' | 'stand' | 'weld';

export class Mechanic3D {
  root = new THREE.Group();       // positioned by scene3d
  creeper = new THREE.Group();    // board + casters (child of root when lying)
  body = new THREE.Group();

  private head = new THREE.Group();
  private eyeL!: THREE.Mesh;
  private eyeR!: THREE.Mesh;
  private lidL!: THREE.Mesh;
  private lidR!: THREE.Mesh;
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private legR = new THREE.Group();
  private legL = new THREE.Group();
  private torso!: THREE.Mesh;
  private antennaTip!: THREE.Mesh;
  private maskGroup = new THREE.Group();
  private torch = new THREE.Group();
  private casters: THREE.Mesh[] = [];
  lamp: THREE.SpotLight;
  private lampBulb!: THREE.Mesh;

  private pose: Pose = 'stand';
  private poseMix = 1;
  private targetYaw = 0;

  constructor() {
    this.buildCreeper();
    this.buildBody();
    this.root.add(this.creeper);
    this.root.add(this.body);
    this.lamp = new THREE.SpotLight(0xffe9a8, 0, 6, 0.85, 0.75, 1.2);
    this.root.add(this.lamp);
    this.root.add(this.lamp.target);
  }

  private buildCreeper(): void {
    const board = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.09, 0.62, 3, 0.045), M.plastic(PINK, 0.5));
    board.position.y = 0.14;
    board.castShadow = true;
    this.creeper.add(board);
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.08, 0.5, 3, 0.04), M.plastic(0xfbd0de, 0.7));
    cushion.position.set(-0.5, 0.2, 0);
    this.creeper.add(cushion);
    // star sticker
    const star = new THREE.Mesh(starGeo(0.09), M.emissive(0xfff3b0, 0.35));
    star.rotation.x = -Math.PI / 2;
    star.position.set(0.45, 0.19, 0.16);
    this.creeper.add(star);
    for (const [x, z] of [[-0.58, -0.22], [-0.58, 0.22], [0.58, -0.22], [0.58, 0.22], [0, -0.22], [0, 0.22]] as Array<[number, number]>) {
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), M.rubber(0x3a3e46));
      caster.rotation.x = Math.PI / 2;
      caster.position.set(x, 0.055, z);
      this.creeper.add(caster);
      this.casters.push(caster);
    }
  }

  private buildBody(): void {
    const b = this.body;
    // torso
    this.torso = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.62, 0.4, 4, 0.14), M.plastic(SUIT, 0.55));
    this.torso.position.y = 0.75;
    this.torso.castShadow = true;
    b.add(this.torso);
    // chest pocket + star badge
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.05, 2, 0.02), M.plastic(0xffb08a, 0.6));
    pocket.position.set(0, 0.62, 0.2);
    b.add(pocket);
    const badge = new THREE.Mesh(starGeo(0.05), M.emissive(0xfff3b0, 0.4));
    badge.position.set(-0.14, 0.92, 0.21);
    b.add(badge);
    // chest lamp
    this.lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), M.emissive(0xffe9a8, 0));
    this.lampBulb.position.set(0.13, 0.92, 0.2);
    b.add(this.lampBulb);

    // head
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), M.plastic(CREAM, 0.35));
    skull.castShadow = true;
    this.head.add(skull);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 18), M.plastic(0xffffff, 0.3));
    face.position.z = 0.035;
    this.head.add(face);
    // eyes
    const eyeGeo = new THREE.SphereGeometry(0.045, 12, 10);
    const eyeMat = M.plastic(0x3b4250, 0.25);
    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeL.position.set(-0.085, 0.02, 0.245);
    this.eyeR.position.set(0.085, 0.02, 0.245);
    this.eyeL.scale.set(1, 1.35, 0.6);
    this.eyeR.scale.set(1, 1.35, 0.6);
    this.head.add(this.eyeL, this.eyeR);
    // eyelids (blink = scale down eyes instead; lids kept invisible tiny)
    this.lidL = new THREE.Mesh(eyeGeo, M.plastic(CREAM, 0.35));
    this.lidR = new THREE.Mesh(eyeGeo, M.plastic(CREAM, 0.35));
    this.lidL.visible = false;
    this.lidR.visible = false;
    // cheeks
    const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff9a8c, roughness: 0.6, transparent: true, opacity: 0.7 });
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), cheekMat);
      cheek.position.set(s * 0.15, -0.06, 0.23);
      cheek.scale.z = 0.4;
      this.head.add(cheek);
    }
    // smile
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.012, 8, 20, Math.PI * 0.8),
      M.plastic(0x7a6f63, 0.4),
    );
    smile.position.set(0, -0.05, 0.24);
    smile.rotation.z = Math.PI + Math.PI * 0.1;
    this.head.add(smile);
    // antenna
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), M.metal(0x9aa1ae, 0.4));
    ant.position.y = 0.32;
    this.head.add(ant);
    this.antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), M.emissive(0xffd166, 0.3));
    this.antennaTip.position.y = 0.41;
    this.head.add(this.antennaTip);
    this.head.position.y = 1.32;
    b.add(this.head);

    // welding mask (parked above head, flips down over face)
    const shell = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.56, 0.3, 4, 0.12), M.plastic(0x4aa8a0, 0.45));
    shell.position.z = 0.1;
    this.maskGroup.add(shell);
    const win = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.18, 0.06, 2, 0.03), M.plastic(0x232936, 0.2));
    win.position.set(0, 0.04, 0.26);
    this.maskGroup.add(win);
    const mstar = new THREE.Mesh(starGeo(0.045), M.emissive(0xfff3b0, 0.4));
    mstar.position.set(0.14, -0.16, 0.26);
    this.maskGroup.add(mstar);
    this.maskGroup.position.set(0, 0.1, 0.02);
    this.maskGroup.visible = false;
    this.head.add(this.maskGroup);

    // limbs
    const armGeo = new THREE.CapsuleGeometry(0.07, 0.3, 4, 10);
    for (const [g, s] of [[this.armL, -1], [this.armR, 1]] as Array<[THREE.Group, number]>) {
      const upper = new THREE.Mesh(armGeo, M.plastic(SUIT, 0.55));
      upper.position.y = -0.19;
      g.add(upper);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), M.plastic(0xfff1d6, 0.5));
      glove.position.y = -0.42;
      g.add(glove);
      g.position.set(s * 0.3, 1.0, 0);
      b.add(g);
    }
    const legGeo = new THREE.CapsuleGeometry(0.085, 0.26, 4, 10);
    for (const [g, s] of [[this.legL, -1], [this.legR, 1]] as Array<[THREE.Group, number]>) {
      const upper = new THREE.Mesh(legGeo, M.plastic(SUIT_DARK, 0.6));
      upper.position.y = -0.2;
      g.add(upper);
      const boot = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.11, 0.26, 2, 0.04), M.plastic(0x5b4a3f, 0.6));
      boot.position.set(0, -0.4, 0.05);
      g.add(boot);
      g.position.set(s * 0.14, 0.45, 0);
      b.add(g);
    }

    // torch (attached to right glove when welding)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10), M.metal(0x4a5163, 0.4));
    barrel.rotation.x = Math.PI / 2;
    this.torch.add(barrel);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.14, 8), M.metal(0xc9834e, 0.35));
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.2;
    this.torch.add(nozzle);
    this.torch.visible = false;
    b.add(this.torch);
  }

  setPose(p: Pose, yaw = 0): void {
    if (this.pose !== p || Math.abs(yaw - this.targetYaw) > 0.01) {
      if (this.pose !== p) this.poseMix = 0;
      this.pose = p;
      this.targetYaw = yaw;
    }
  }

  /** eyes look toward a local offset (-1..1 each) */
  look(x: number, y: number, blink: number): void {
    const sx = THREE.MathUtils.clamp(x, -1, 1) * 0.045;
    const sy = THREE.MathUtils.clamp(y, -1, 1) * 0.04;
    this.eyeL.position.set(-0.085 + sx, 0.02 + sy, 0.245);
    this.eyeR.position.set(0.085 + sx, 0.02 + sy, 0.245);
    const open = 1 - blink * 0.9;
    this.eyeL.scale.set(1, 1.35 * open, 0.6);
    this.eyeR.scale.set(1, 1.35 * open, 0.6);
  }

  setLamp(on: number, aimLocal: THREE.Vector3): void {
    this.lamp.intensity = on * 8;
    (this.lampBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = on * 1.6;
    this.lamp.target.position.copy(aimLocal);
  }

  setAntenna(pulse: number): void {
    (this.antennaTip.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + pulse * 1.6;
  }

  setMask(down01: number): void {
    this.maskGroup.visible = down01 > 0.02;
    // flip from parked (above head, tilted back) to covering the face
    const t = THREE.MathUtils.clamp(down01, 0, 1);
    this.maskGroup.rotation.x = (1 - t) * -1.5;
    this.maskGroup.position.set(0, 0.1 + (1 - t) * 0.22, 0.02);
  }

  /** aim the torch (right arm) at a world position; call only in weld pose */
  aimTorch(worldTarget: THREE.Vector3 | null): void {
    if (!worldTarget) {
      this.torch.visible = false;
      return;
    }
    this.torch.visible = true;
    const local = this.body.worldToLocal(worldTarget.clone());
    // arm points from shoulder toward target
    const sh = new THREE.Vector3(0.3, 1.0, 0);
    const dir = local.clone().sub(sh);
    this.armR.rotation.z = Math.atan2(dir.x, -dir.y) * -1;
    this.armR.rotation.x = Math.atan2(dir.z, Math.sqrt(dir.x * dir.x + dir.y * dir.y) * 0.9);
    // torch at glove, aiming at target
    const glove = new THREE.Vector3(0, -0.42, 0);
    this.armR.updateMatrixWorld();
    const gw = this.armR.localToWorld(glove.clone());
    const gl = this.body.worldToLocal(gw);
    this.torch.position.copy(gl);
    this.torch.lookAt(this.body.localToWorld(local.clone()));
  }

  spinCasters(d: number): void {
    for (const c of this.casters) c.rotation.y += d;
  }

  update(dt: number, time: number): void {
    this.poseMix = Math.min(1, this.poseMix + dt * 5);
    const k = easeInOut(this.poseMix);
    if (this.pose === 'lie') {
      // body lies on the creeper: rotate back, head slightly raised
      lerpTo(this.body.rotation, -Math.PI / 2 + 0.08, this.targetYaw, 0, k);
      lerpTo(this.body.position, -0.15, 0.3, 0, k);
      this.creeper.visible = true;
      this.head.rotation.x = 0.5;
      this.armL.rotation.x = -0.5;
      this.armR.rotation.x = -0.5;
      this.legL.rotation.x = 0.85;
      this.legR.rotation.x = 0.7 + Math.sin(time * 1.7) * 0.06;
    } else if (this.pose === 'stand') {
      lerpTo(this.body.rotation, 0, this.targetYaw, 0, k);
      lerpTo(this.body.position, 0, 0, 0, k);
      this.creeper.visible = false;
      this.head.rotation.x = 0;
      this.armL.rotation.x = 0;
      this.armR.rotation.x = 0;
      this.armL.rotation.z = 0.15 + Math.sin(time * 1.8) * 0.05;
      this.armR.rotation.z = -0.15;
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    } else {
      // weld stance: stable feet, mask down handled separately
      lerpTo(this.body.rotation, 0, this.targetYaw, 0, k);
      lerpTo(this.body.position, 0, 0, 0, k);
      this.creeper.visible = false;
      this.head.rotation.x = -0.12;
      this.armL.rotation.z = 0.3;
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    }
  }

  /** reach the arms up while lying (0..1) */
  reach(r: number): void {
    if (this.pose !== 'lie') return;
    this.armL.rotation.x = -0.5 - r * 1.4;
    this.armR.rotation.x = -0.5 - r * 1.6;
  }
}

function lerpTo(target: THREE.Euler | THREE.Vector3, x: number, y: number, z: number, k: number): void {
  target.x += (x - target.x) * k;
  target.y += (y - target.y) * k;
  target.z += (z - target.z) * k;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function starGeo(r: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: r * 0.25, bevelEnabled: false });
}
