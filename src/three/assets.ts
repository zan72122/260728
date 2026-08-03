import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CarSpec } from '../car';

// Kenney "Car Kit" (CC0) models, committed under public/assets/kenney.
// The kit uses one flat-color atlas ("colormap"); we retint each car by
// finding the atlas color the body uses most (by UV triangle area) and
// replacing exactly that color in a per-car copy of the atlas.

const DIR = 'assets/kenney/';

export interface LoadedAssets {
  cars: Map<string, THREE.Group>;
  prop: (name: PropName) => THREE.Group;
}

export type PropName =
  | 'wheel-default' | 'wheel-dark' | 'debris-bolt' | 'debris-nut'
  | 'debris-drivetrain' | 'debris-drivetrain-axle' | 'debris-plate-a'
  | 'debris-plate-small-a' | 'debris-tire' | 'debris-bumper' | 'cone' | 'box';

const PROP_FILES: PropName[] = [
  'wheel-default', 'wheel-dark', 'debris-bolt', 'debris-nut',
  'debris-drivetrain', 'debris-drivetrain-axle', 'debris-plate-a',
  'debris-plate-small-a', 'debris-tire', 'debris-bumper', 'cone', 'box',
];

const CAR_FILES: Record<string, string> = {
  poko: 'hatchback-sports.glb',
  bunbun: 'van.glb',
  tomato: 'truck.glb',
};

function upgradeMaterial(mat: THREE.Material, map: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const out = new THREE.MeshPhysicalMaterial({
    map: map ?? ((mat as THREE.MeshStandardMaterial).map ?? null),
    roughness: 0.55,
    metalness: 0.05,
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
  });
  return out;
}

function textureToCanvas(tex: THREE.Texture): HTMLCanvasElement {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return c;
}

type RGB = [number, number, number];

function hueOf(c: RGB): number {
  const [r, g, bl] = c.map((v) => v / 255);
  const mx = Math.max(r, g, bl);
  const mn = Math.min(r, g, bl);
  if (mx === mn) return 0;
  let h = 0;
  if (mx === r) h = (g - bl) / (mx - mn);
  else if (mx === g) h = 2 + (bl - r) / (mx - mn);
  else h = 4 + (r - g) / (mx - mn);
  return ((h * 60) + 360) % 360;
}

function lumOf(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

// The atlas is a gradient sheet, so we characterise the paint as a hue band:
// the dominant saturated hue used by the model (by UV area) + its mean
// luminance, then re-tint every pixel in that band keeping relative shading.
function paintFamily(
  root: THREE.Object3D,
  atlas: HTMLCanvasElement,
): { hue: number; meanLum: number } | null {
  const ctx = atlas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
  const areaByColor = new Map<string, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (/^wheel/.test(o.name) || /^wheel/.test(o.parent?.name ?? '')) return;
    const geo = o.geometry;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!uv || !pos) return;
    const idx = geo.getIndex();
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      const area = b.sub(a).cross(c.sub(a)).length() / 2;
      const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
      const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
      const px = Math.min(atlas.width - 1, Math.max(0, Math.round(u * atlas.width)));
      const py = Math.min(atlas.height - 1, Math.max(0, Math.round(v * atlas.height)));
      const off = (py * atlas.width + px) * 4;
      const key = `${data[off]},${data[off + 1]},${data[off + 2]}`;
      areaByColor.set(key, (areaByColor.get(key) ?? 0) + area);
    }
  });
  const sat: Array<{ c: RGB; area: number }> = [];
  for (const [key, area] of areaByColor) {
    const rgb = key.split(',').map(Number) as RGB;
    if (Math.max(...rgb) - Math.min(...rgb) < 28) continue; // grays stay
    if (lumOf(rgb) > 235) continue; // window sparkle whites stay
    sat.push({ c: rgb, area });
  }
  sat.sort((x, y) => y.area - x.area);
  if (!sat.length) return null;
  const mainHue = hueOf(sat[0].c);
  let lumSum = 0;
  let areaSum = 0;
  for (const s of sat) {
    const dh = Math.abs(hueOf(s.c) - mainHue);
    if (Math.min(dh, 360 - dh) < 45) {
      lumSum += lumOf(s.c) * s.area;
      areaSum += s.area;
    }
  }
  return { hue: mainHue, meanLum: areaSum > 0 ? lumSum / areaSum : 128 };
}

function retintAtlas(
  atlas: HTMLCanvasElement,
  band: { hue: number; meanLum: number },
  to: RGB, // sRGB bytes — NOT THREE.Color, which converts hex to linear space
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = atlas.width;
  c.height = atlas.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(atlas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const [tr, tg, tb] = to;
  let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const rgb: RGB = [d[i], d[i + 1], d[i + 2]];
    if (Math.max(...rgb) - Math.min(...rgb) < 28) continue;
    const l = lumOf(rgb);
    if (l > 235) continue;
    const dh = Math.abs(hueOf(rgb) - band.hue);
    if (Math.min(dh, 360 - dh) >= 45) continue;
    // keep the sheet's shading gradient, but compressed so the paint stays
    // bright and candy-like under ACES tone mapping
    const k = 1 + (l / band.meanLum - 1) * 0.45;
    d[i] = Math.min(255, tr * k);
    d[i + 1] = Math.min(255, tg * k);
    d[i + 2] = Math.min(255, tb * k);
    changed++;
  }
  void changed;
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export async function loadAssets(specs: CarSpec[]): Promise<LoadedAssets> {
  const loader = new GLTFLoader();
  const cars = new Map<string, THREE.Group>();
  const props = new Map<PropName, THREE.Group>();

  await Promise.all([
    ...specs.map(async (spec) => {
      const file = CAR_FILES[spec.id] ?? 'sedan.glb';
      try {
        const gltf = await loader.loadAsync(DIR + file);
        const root = gltf.scene;
        // grab the shared atlas
        let atlas: HTMLCanvasElement | null = null;
        root.traverse((o) => {
          if (!atlas && o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshStandardMaterial;
            if (m.map) atlas = textureToCanvas(m.map);
          }
        });
        let tex: THREE.Texture | null = null;
        if (atlas) {
          const band = paintFamily(root, atlas);
          console.info(`[retint] ${spec.id}: hue=${band ? Math.round(band.hue) : '-'} lum=${band ? Math.round(band.meanLum) : '-'} -> ${spec.body}`);
          if (band) {
            const hex = parseInt(spec.body.slice(1), 16);
            tex = retintAtlas(atlas, band, [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
          }
        }
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = false;
            o.material = upgradeMaterial(o.material as THREE.Material, tex);
          }
        });
        cars.set(spec.id, root);
      } catch (e) {
        console.warn(`car model ${file} failed, using placeholder`, e);
        cars.set(spec.id, placeholderCar(spec));
      }
    }),
    ...PROP_FILES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${DIR}${name}.glb`);
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.material = upgradeMaterial(o.material as THREE.Material, null);
          }
        });
        props.set(name, gltf.scene);
      } catch {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshStandardMaterial({ color: 0x888888 }),
        ));
        props.set(name, g);
      }
    }),
  ]);

  return {
    cars,
    prop: (name) => {
      const src = props.get(name)!;
      return src.clone(true);
    },
  };
}

function countVerts(m: THREE.Mesh): number {
  const p = m.geometry.getAttribute('position');
  return p ? p.count : 0;
}

function placeholderCar(spec: CarSpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.9, 3.0),
    new THREE.MeshStandardMaterial({ color: spec.body }),
  );
  body.position.y = 0.55;
  body.name = 'body';
  g.add(body);
  return g;
}
