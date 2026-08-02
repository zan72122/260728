import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as M from './materials';

// Two short test courses built as real terrain the car actually drives over.

export function courseGround(course: number, x: number): number {
  if (course === 0) {
    const m = ((x % 34) + 34) % 34;
    const bump = (cx: number, h: number, w: number): number => {
      const d = (m - cx) / w;
      return h * Math.exp(-d * d);
    };
    return bump(12, 0.42, 2.6) + bump(23, 0.34, 2.2);
  }
  const m = ((x % 44) + 44) % 44;
  const d = (m - 16) / 5.5;
  return 0.5 * Math.exp(-d * d);
}

export const COURSE_LEN = 78;

export class Test3D {
  root = new THREE.Group();
  private built = -1;
  private lightBulbs: THREE.InstancedMesh | null = null;

  build(course: number): void {
    if (this.built === course) return;
    this.built = course;
    this.root.clear();

    // road ribbon following the bumps
    const width = 3.2;
    const segs = 260;
    const x0 = -14;
    const x1 = COURSE_LEN + 20;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const x = x0 + ((x1 - x0) * i) / segs;
      const y = courseGround(course, x);
      pos.push(x, y, -width / 2, x, y, width / 2);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: course === 0 ? 0x62666f : 0x4a5064, roughness: 0.9,
    }));
    road.receiveShadow = true;
    this.root.add(road);

    // center dashes
    const dash = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.7, 0.02, 0.12),
      M.plastic(0xffeba0, 0.6),
      120,
    );
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) {
      const x = x0 + i * 1.6;
      m4.makeTranslation(x, courseGround(course, x) + 0.02, 0);
      dash.setMatrixAt(i, m4);
    }
    this.root.add(dash);

    // ground plane beside the road
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 + 30, 60),
      new THREE.MeshStandardMaterial({ color: course === 0 ? 0x7cc98b : 0x2f3a5e, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, -0.05, 0);
    ground.receiveShadow = true;
    this.root.add(ground);

    // parallax hills
    for (let i = 0; i < 26; i++) {
      const hx = x0 + i * 4.2 + (i % 3);
      const depth = -6 - (i % 3) * 5;
      const s = 3 + (i % 4);
      const hill = new THREE.Mesh(
        new THREE.SphereGeometry(s, 16, 10),
        new THREE.MeshStandardMaterial({
          color: course === 0 ? (i % 2 ? 0x8fce7d : 0x6fbc80) : (i % 2 ? 0x3c3266 : 0x2e4177),
          roughness: 1,
        }),
      );
      hill.scale.y = 0.42;
      hill.position.set(hx, -0.4, depth);
      this.root.add(hill);
    }

    if (course === 0) {
      // sun
      const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), M.emissive(0xfff4c9, 1.8));
      sun.position.set(30, 12, -26);
      this.root.add(sun);
      // clouds
      for (let i = 0; i < 8; i++) {
        const cl = new THREE.Group();
        for (let j = 0; j < 3; j++) {
          const puff = new THREE.Mesh(
            new THREE.SphereGeometry(0.9 - j * 0.18, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
          );
          puff.position.x = j * 0.8 - 0.8;
          cl.add(puff);
        }
        cl.position.set(i * 11 - 4, 7 + (i % 3), -18 - (i % 2) * 6);
        this.root.add(cl);
      }
      // flowers along the roadside
      for (let i = 0; i < 40; i++) {
        const f = flower(i % 2 ? 0xff9fb6 : 0xffd166);
        f.position.set(x0 + i * 2.3, courseGround(course, x0 + i * 2.3) * 0.2, (i % 2 ? 2.4 : -2.6) + (i % 3) * 0.4);
        this.root.add(f);
      }
    } else {
      // string lights
      const bulbs = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ emissiveIntensity: 2.4, roughness: 0.4, color: 0x222222, emissive: 0xffffff }),
        160,
      );
      const colors = [0xffd166, 0xff9fb6, 0x8fd0f0, 0xc5f6d0];
      const cm = new THREE.Color();
      for (let i = 0; i < 160; i++) {
        const x = x0 + i * 0.62;
        const y = 4.6 + Math.sin(x * 0.5) * 0.5;
        m4.makeTranslation(x, y, -2.2);
        bulbs.setMatrixAt(i, m4);
        cm.set(colors[i % 4]);
        bulbs.setColorAt(i, cm);
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      this.root.add(bulbs);
      this.lightBulbs = bulbs;
      // wire
      const wirePts: THREE.Vector3[] = [];
      for (let x = x0; x < x1; x += 1.5) wirePts.push(new THREE.Vector3(x, 4.68 + Math.sin(x * 0.5) * 0.5, -2.2));
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePts), 120, 0.015, 5, false),
        M.plastic(0xcccccc, 0.7),
      );
      this.root.add(wire);
      // tunnel arches
      for (const ax of [40, 43, 46]) {
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(2.6, 0.35, 8, 18, Math.PI),
          new THREE.MeshStandardMaterial({ color: 0x39415c, roughness: 0.8 }),
        );
        arch.position.set(ax, courseGround(course, ax) + 0.1, 0);
        arch.rotation.y = Math.PI / 2;
        this.root.add(arch);
      }
      // stars
      const starGeo = new THREE.BufferGeometry();
      const sp: number[] = [];
      for (let i = 0; i < 120; i++) {
        sp.push(x0 + Math.random() * 100, 8 + Math.random() * 10, -20 - Math.random() * 14);
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xfffadc, size: 0.14, sizeAttenuation: true,
      }));
      this.root.add(stars);
    }
    // little finish flags near the end
    for (const z of [-1.9, 1.9]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), M.metal(0xd8dce4, 0.4));
      pole.position.set(COURSE_LEN - 6, 0.7, z);
      this.root.add(pole);
      const flag = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.32, 0.02, 1, 0.01), M.plastic(0xffd166, 0.5));
      flag.position.set(COURSE_LEN - 5.75, 1.2, z);
      this.root.add(flag);
    }
  }
}

function flower(color: number): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), M.plastic(0x4a9b57, 0.8));
  stem.position.y = 0.15;
  g.add(stem);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.plastic(color, 0.5));
  head.scale.z = 0.55;
  head.position.y = 0.34;
  g.add(head);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.plastic(0xffe9a8, 0.4));
  core.position.set(0, 0.34, 0.05);
  g.add(core);
  return g;
}
