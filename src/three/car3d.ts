import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { LoadedAssets } from './assets';
import { crackLocalPts, densify, type CarSpec } from '../car';
import { CRACK_N, type Game, type FaultState } from '../game';
import { PART } from '../layout';
import * as M from './materials';

export const CAR_LEN = 3.6;
export const LIFT_H = 1.75;
const BELLY_Y = 0.42;
export const FLANK_Z = 0.80;

// PART-coordinate (1000x420) mapping into carRoot local space:
// +x = car front, +y = up, +z = camera/near side
export function partToLocal(ux: number, uy: number, drop = 0): THREE.Vector3 {
  return new THREE.Vector3(
    ((ux - 500) / 1000) * 3.15,
    BELLY_Y - drop,
    ((uy - 210) / 420) * 1.35,
  );
}

export function localToPart(v: THREE.Vector3): { x: number; y: number } {
  return {
    x: (v.x / 3.15) * 1000 + 500,
    y: (v.z / 1.35) * 420 + 210,
  };
}

export function bellyPlaneY(carRootY: number): number {
  return carRootY + BELLY_Y;
}

interface CrackViz {
  group: THREE.Group;
  darkTube: THREE.Mesh | null;
  emberTube: THREE.Mesh | null;
  beads: THREE.InstancedMesh;
  pts: THREE.Vector3[]; // carRoot-local
  lastWeldCount: number;
  emberMat: THREE.MeshStandardMaterial;
}

export class Car3D {
  root = new THREE.Group();
  private shells = new Map<string, THREE.Group>();
  private wheels: THREE.Object3D[] = [];
  private crack: CrackViz | null = null;
  private currentId = '';

  // fault station parts
  private belly = new THREE.Group();
  private bolt!: THREE.Group;
  private clipCover!: THREE.Mesh;
  private clipPiece!: THREE.Group;
  private clipRing!: THREE.Mesh;
  private hoseGroup = new THREE.Group();
  private hoseOuter: THREE.Mesh | null = null;
  private hoseInner: THREE.Mesh | null = null;
  private hoseEndPlug!: THREE.Mesh;
  private hoseRing!: THREE.Mesh;
  private coolTex!: THREE.CanvasTexture;
  private exhaustRear!: THREE.Group;
  private strapFront!: THREE.Mesh;
  private lastHoseEnd = new THREE.Vector3(1e9, 0, 0);

  constructor(private assets: LoadedAssets) {
    this.buildBelly();
    this.root.add(this.belly);
  }

  setSpec(spec: CarSpec): void {
    if (this.currentId === spec.id) {
      this.rebuildCrack(spec);
      return;
    }
    // swap shell
    for (const [, s] of this.shells) this.root.remove(s);
    let shell = this.shells.get(spec.id);
    if (!shell) {
      const src = this.assets.cars.get(spec.id)!;
      shell = new THREE.Group();
      const inner = src;
      const box = new THREE.Box3().setFromObject(inner);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = CAR_LEN / Math.max(size.z, 0.001);
      inner.scale.setScalar(s);
      inner.position.y = -box.min.y * s;
      inner.rotation.y = Math.PI / 2; // glb +z (front) -> world +x
      shell.add(inner);
      this.shells.set(spec.id, shell);
    }
    this.root.add(shell);
    this.wheels = [];
    shell.traverse((o) => {
      if (/^wheel/.test(o.name)) this.wheels.push(o);
    });
    this.currentId = spec.id;
    this.rebuildCrack(spec);
  }

  private rebuildCrack(spec: CarSpec): void {
    if (this.crack) {
      this.root.remove(this.crack.group);
      this.crack = null;
    }
    const local = densify(crackLocalPts(spec.crack), CRACK_N);
    const pts = local.map(([u, v]) => new THREE.Vector3(u * CAR_LEN, v * CAR_LEN, FLANK_Z));
    const group = new THREE.Group();
    const beads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd4, roughness: 0.3, metalness: 0.9 }),
      CRACK_N,
    );
    beads.count = CRACK_N;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CRACK_N; i++) beads.setMatrixAt(i, zero);
    beads.instanceMatrix.needsUpdate = true;
    beads.castShadow = false;
    group.add(beads);
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff9a4d, emissive: 0xff7a30, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.crack = { group, darkTube: null, emberTube: null, beads, pts, lastWeldCount: -1, emberMat };
    this.root.add(group);
  }

  /** world position helper for crack points (carRoot must be up to date) */
  crackWorldPts(): THREE.Vector3[] {
    if (!this.crack) return [];
    this.root.updateMatrixWorld();
    return this.crack.pts.map((p) => p.clone().applyMatrix4(this.root.matrixWorld));
  }

  spinWheels(delta: number): void {
    for (const w of this.wheels) w.rotation.x += delta;
  }

  update(g: Game, time: number): void {
    // crack visuals
    const c = this.crack;
    const state = g.cracks[0];
    if (c) {
      if (!state) {
        c.group.visible = false;
      } else {
        c.group.visible = true;
        const count = state.welded.filter(Boolean).length;
        if (count !== c.lastWeldCount) {
          c.lastWeldCount = count;
          this.rebuildCrackTubes(state.welded);
          const m = new THREE.Matrix4();
          for (let i = 0; i < CRACK_N; i++) {
            if (state.welded[i]) {
              m.makeTranslation(c.pts[i].x, c.pts[i].y, c.pts[i].z);
            } else {
              m.makeScale(0, 0, 0);
            }
            c.beads.setMatrixAt(i, m);
          }
          c.beads.instanceMatrix.needsUpdate = true;
        }
        const ember = (g.phase === 'weld' && !state.done) ? 0.75 + Math.sin(time * 3.2) * 0.45 : 0;
        c.emberMat.emissiveIntensity = ember * 1.6;
        c.emberMat.opacity = ember > 0 ? 0.5 : 0;
        if (c.emberTube) c.emberTube.visible = ember > 0;
      }
    }
    this.updateFaults(g, time);
  }

  private rebuildCrackTubes(welded: boolean[]): void {
    const c = this.crack!;
    if (c.darkTube) { c.group.remove(c.darkTube); c.darkTube.geometry.dispose(); c.darkTube = null; }
    if (c.emberTube) { c.group.remove(c.emberTube); c.emberTube.geometry.dispose(); c.emberTube = null; }
    const un: THREE.Vector3[] = [];
    for (let i = 0; i < CRACK_N; i++) if (!welded[i]) un.push(c.pts[i]);
    if (un.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(un);
      const dark = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.03, 6, false),
        new THREE.MeshStandardMaterial({ color: 0x181414, roughness: 0.9 }),
      );
      const emberGeo = new THREE.TubeGeometry(curve, 40, 0.055, 6, false);
      const emberMesh = new THREE.Mesh(emberGeo, c.emberMat);
      c.group.add(emberMesh);
      c.group.add(dark);
      c.darkTube = dark;
      c.emberTube = emberMesh;
    }
  }

  // ---------------------------------------------------------------- belly

  private buildBelly(): void {
    const b = this.belly;
    // base pan
    const pan = new THREE.Mesh(
      new RoundedBoxGeometry(3.15, 0.1, 1.42, 3, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x454b58, roughness: 0.7, metalness: 0.35 }),
    );
    pan.position.y = BELLY_Y + 0.05;
    b.add(pan);
    // frame rails
    for (const z of [-0.52, 0.52]) {
      const rail = new THREE.Mesh(
        new RoundedBoxGeometry(2.9, 0.09, 0.12, 2, 0.03),
        M.metal(0x5c6373, 0.5),
      );
      rail.position.set(0, BELLY_Y - 0.02, z);
      b.add(rail);
    }
    // cross members (kept dark so the fault markers stay the brightest things)
    for (const x of [-1.0, 0.0, 1.0]) {
      const cm = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 1.1, 2, 0.02), M.metal(0x3c414c, 0.6));
      cm.position.set(x, BELLY_Y - 0.01, 0);
      b.add(cm);
    }
    // kenney drivetrain detail (rear half)
    const dt = this.assets.prop('debris-drivetrain');
    dt.scale.setScalar(1.15);
    dt.rotation.x = Math.PI; // hang under
    dt.rotation.y = Math.PI / 2;
    dt.position.copy(partToLocal(320, 210, 0.02));
    b.add(dt);
    // gearbox
    const gear = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 0.3, 3, 0.06), M.metal(0x8b93a3, 0.45));
    gear.position.copy(partToLocal(555, 210, 0.1));
    b.add(gear);
    // engine bottom
    const eng = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.24, 0.7, 3, 0.08), M.metal(0x767d8a, 0.5));
    eng.position.copy(partToLocal(810, 160, 0.1));
    b.add(eng);
    // side skirts: keep the hanging parts hidden from the outside view
    for (const z of [-0.72, 0.72]) {
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(2.9, 0.16, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x363b45, roughness: 0.8 }),
      );
      skirt.position.set(0, BELLY_Y - 0.05, z);
      b.add(skirt);
    }

    this.buildOilPan(b);
    this.buildClip(b);
    this.buildHose(b);
    this.buildExhaust(b);
  }

  private buildOilPan(b: THREE.Group): void {
    const pan = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.18, 0.38, 3, 0.07), M.chrome(0xb9bfc9));
    pan.position.copy(partToLocal(PART.oilPan.x, PART.oilPan.y, 0.08));
    b.add(pan);
    // the big bolt (kenney debris-bolt, head down, brass-tinted so it pops)
    const bolt = this.assets.prop('debris-bolt');
    bolt.scale.setScalar(2.1);
    bolt.rotation.z = Math.PI;
    bolt.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = (o.material as THREE.MeshPhysicalMaterial).clone();
        m.color.setRGB(1.5, 1.2, 0.62);
        o.material = m;
      }
    });
    const holder = new THREE.Group();
    holder.position.copy(partToLocal(PART.boltPos.x, PART.boltPos.y, 0.14));
    holder.add(bolt);
    bolt.position.y = 0.26;
    b.add(holder);
    this.bolt = holder;
  }

  private buildClip(b: THREE.Group): void {
    // hinged cover
    const hinge = new THREE.Group();
    hinge.position.copy(partToLocal(PART.coverPos.x - 60, PART.coverPos.y, 0.1));
    const cover = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.05, 0.3, 2, 0.02), M.metal(0x8f96a4, 0.5));
    cover.position.x = 0.2;
    hinge.add(cover);
    b.add(hinge);
    this.clipCover = cover;
    this.clipCoverHinge = hinge;

    // slot ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.02, 8, 24),
      M.emissive(0xffd166, 0.8),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(partToLocal(PART.clipSlot.x, PART.clipSlot.y, 0.12));
    b.add(ring);
    this.clipRing = ring;
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.9 }),
    );
    hole.position.copy(partToLocal(PART.clipSlot.x, PART.clipSlot.y, 0.1));
    b.add(hole);

    // the clip piece itself (yellow push-pin)
    const clip = new THREE.Group();
    const capMat = M.plastic(0xffd166, 0.4);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 18), capMat);
    clip.add(cap);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.11, 10), M.plastic(0xffdf8d, 0.45));
    stem.position.y = 0.07;
    clip.add(stem);
    b.add(clip);
    this.clipPiece = clip;
    this.clipCapMat = capMat;
  }

  private clipCoverHinge!: THREE.Group;
  private clipCapMat!: THREE.MeshStandardMaterial;

  private buildHose(b: THREE.Group): void {
    b.add(this.hoseGroup);
    // fixed flange
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14), M.metal(0x767d8a, 0.5));
    flange.position.copy(partToLocal(PART.hoseFixed.x, PART.hoseFixed.y, 0.09));
    b.add(flange);
    // target fitting + ring
    const fit = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.09, 14), M.metal(0x8b93a3, 0.4));
    fit.position.copy(partToLocal(PART.hoseFit.x, PART.hoseFit.y, 0.1));
    b.add(fit);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 24), M.emissive(0x8fd0f0, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(partToLocal(PART.hoseFit.x, PART.hoseFit.y, 0.14));
    b.add(ring);
    this.hoseRing = ring;
    // orange end plug on the free end
    const plug = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.09, 0.11, 2, 0.03), M.plastic(0xffb45e, 0.4));
    b.add(plug);
    this.hoseEndPlug = plug;
    // animated coolant stripes
    this.coolTex = M.canvasTexture(64, 8, (ctx, w, h) => {
      ctx.fillStyle = '#57c8f0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#bfeafc';
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 7, h);
    });
    this.coolTex.wrapS = THREE.RepeatWrapping;
    this.coolTex.repeat.set(3, 1);
  }

  private buildExhaust(b: THREE.Group): void {
    // front fixed pipe
    const p0 = partToLocal(700, 322, 0.14);
    const pv = partToLocal(PART.exhaustPivot.x, PART.exhaustPivot.y, 0.14);
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, p0.distanceTo(pv) + 0.1, 12),
      M.chrome(0x9aa1ae),
    );
    front.position.copy(p0.clone().lerp(pv, 0.5));
    front.rotation.z = Math.PI / 2;
    b.add(front);

    // hanging rear section pivoted at the joint
    const rear = new THREE.Group();
    rear.position.copy(pv);
    const rearLen = 1.1;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, rearLen, 12), M.chrome(0x9aa1ae));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.x = -rearLen / 2;
    rear.add(pipe);
    const muffler = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 6, 14), M.chrome(0xc3c9d3));
    muffler.rotation.z = Math.PI / 2;
    muffler.position.x = -rearLen - 0.18;
    rear.add(muffler);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.24, 10), M.metal(0x7a8290, 0.35));
    tip.rotation.z = Math.PI / 2;
    tip.position.x = -rearLen - 0.52;
    rear.add(tip);
    b.add(rear);
    this.exhaustRear = rear;

    // strap brackets
    for (const [ux, open] of [[300, true], [480, false]] as Array<[number, boolean]>) {
      const strap = new THREE.Mesh(
        new THREE.TorusGeometry(0.09, 0.018, 8, 20, Math.PI * 1.3),
        open ? M.plastic(0xffd166, 0.4) : M.metal(0x767d8a, 0.5),
      );
      strap.position.copy(partToLocal(ux, 306, 0.1));
      strap.rotation.y = Math.PI / 2;
      strap.rotation.z = Math.PI * 0.85;
      b.add(strap);
      if (open) this.strapFront = strap;
    }
  }

  private updateFaults(g: Game, time: number): void {
    const find = (k: string): FaultState | undefined => g.faults.find((f) => f.kind === k);

    // bolt
    const fb = find('bolt');
    const boltBroken = fb && !fb.fixed;
    this.bolt.rotation.y = (fb ? fb.taps * 2.1 + fb.boltSpin : 0.4);
    this.bolt.position.y = partToLocal(0, 0, 0.16).y - (boltBroken ? 0.05 + Math.sin(time * 9) * 0.012 : 0);
    this.bolt.rotation.z = boltBroken ? Math.sin(time * 8.6) * 0.06 : 0;

    // clip
    const fc = find('clip');
    const clipBroken = fc && !fc.fixed;
    this.clipCoverHinge.rotation.x = clipBroken ? 0.5 + Math.sin(time * 3.1) * 0.1 : 0;
    this.clipRing.visible = !!clipBroken;
    const clipPos = fc ? (fc.fixed ? PART.clipSlot : (fc.drag ?? PART.clipLoose)) : PART.clipSlot;
    this.clipPiece.position.copy(partToLocal(clipPos.x, clipPos.y, fc && !fc.fixed ? 0.3 : 0.13));
    this.clipPiece.rotation.z = clipBroken ? Math.PI + Math.sin(time * 2) * 0.15 : Math.PI;
    this.clipCapMat.color.set(clipBroken ? 0xffd166 : 0x9aa4b5);

    // hose
    const fh = find('hose');
    const hoseEndPart = fh ? (fh.fixed ? PART.hoseFit : (fh.drag ?? PART.hoseLoose)) : PART.hoseFit;
    const endV = partToLocal(hoseEndPart.x, hoseEndPart.y, fh && !fh.fixed ? 0.34 : 0.16);
    this.hoseRing.visible = !!(fh && !fh.fixed);
    this.hoseEndPlug.position.copy(endV);
    if (endV.distanceTo(this.lastHoseEnd) > 0.005) {
      this.lastHoseEnd.copy(endV);
      this.rebuildHose(endV);
    }
    if (this.hoseInner) {
      const mat = this.hoseInner.material as THREE.MeshStandardMaterial;
      if (fh?.fixed) {
        mat.map = this.coolTex;
        mat.color.set(0xffffff);
        mat.opacity = 0.95;
        this.coolTex.offset.x = -g.coolantFlow * 1.6;
        this.coolTex.needsUpdate = true;
      } else {
        mat.map = null;
        mat.color.set(0x57c8f0);
        mat.opacity = 0.3;
      }
      mat.needsUpdate = true;
    }

    // exhaust
    const fe = find('exhaust');
    const lift01 = fe ? (fe.fixed ? 1 : fe.lift01) : 1;
    const jitter = fe && !fe.fixed && !fe.held ? Math.sin(time * 22) * 0.012 : 0;
    this.exhaustRear.rotation.z = -((1 - lift01) * 0.30) + jitter;
    if (this.strapFront) {
      (this.strapFront.material as THREE.MeshStandardMaterial).color.set(
        fe && !fe.fixed ? 0xffd166 : 0x767d8a,
      );
    }
  }

  private rebuildHose(end: THREE.Vector3): void {
    if (this.hoseOuter) {
      this.hoseGroup.remove(this.hoseOuter);
      this.hoseOuter.geometry.dispose();
      this.hoseOuter = null;
    }
    if (this.hoseInner) {
      this.hoseGroup.remove(this.hoseInner);
      this.hoseInner.geometry.dispose();
      this.hoseInner = null;
    }
    const a = partToLocal(PART.hoseFixed.x, PART.hoseFixed.y, 0.12);
    const mid = a.clone().lerp(end, 0.5);
    mid.y -= 0.22; // sag
    const curve = new THREE.CatmullRomCurve3([a, mid, end]);
    const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.055, 10, false), M.hoseTube());
    const inner = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 20, 0.032, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x57c8f0, transparent: true, opacity: 0.3, roughness: 0.3 }),
    );
    this.hoseGroup.add(outer);
    this.hoseGroup.add(inner);
    this.hoseOuter = outer;
    this.hoseInner = inner;
  }
}
