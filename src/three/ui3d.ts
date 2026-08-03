import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as M from './materials';
import { starGeo } from './mechanic3d';
import { CARS } from '../car';

// In-world tactile buttons: chunky pucks with painted icon faces, placed by
// unprojecting the 2D layout positions so hit-testing stays in screen space.

export interface PuckSpec {
  id: string;
  color: number;
  icon: (ctx: CanvasRenderingContext2D, s: number) => void;
  label?: string;
}

export class Puck {
  group = new THREE.Group();
  private face: THREE.Mesh;

  constructor(spec: PuckSpec) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.3, 36), M.paint(spec.color));
    body.rotation.x = Math.PI / 2;
    body.castShadow = false;
    this.group.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 10, 36), M.plastic(0xffffff, 0.35));
    this.group.add(rim);
    // dark outer ring keeps the puck readable on bright scenes
    const outline = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.05, 10, 36), M.plastic(0x394050, 0.5));
    this.group.add(outline);
    const tex = M.canvasTexture(256, 256, (ctx, w) => {
      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.translate(w / 2, w / 2);
      spec.icon(ctx, w / 2);
      ctx.restore();
    });
    this.face = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 36),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 }),
    );
    this.face.position.z = 0.17;
    this.group.add(this.face);
    if (spec.label) {
      const ltex = M.canvasTexture(512, 96, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(30,32,42,0.55)';
        M.roundRectPath(ctx, w * 0.12, 6, w * 0.76, h - 12, (h - 12) / 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 52px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.fillText(spec.label!, w / 2, h / 2 + 2);
      });
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 0.45),
        new THREE.MeshBasicMaterial({ map: ltex, transparent: true }),
      );
      label.position.set(0, -1.42, 0.05);
      this.group.add(label);
    }
  }
}

export function drawPlayIcon(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-s * 0.28, -s * 0.42);
  ctx.lineTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.28, s * 0.42);
  ctx.closePath();
  ctx.fill();
}

function miniCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  M.roundRectPath(ctx, -w / 2, -w * 0.24, w, w * 0.24, w * 0.1);
  ctx.fill();
  M.roundRectPath(ctx, -w * 0.28, -w * 0.42, w * 0.5, w * 0.22, w * 0.09);
  ctx.fill();
  ctx.fillStyle = '#dff3fb';
  M.roundRectPath(ctx, -w * 0.2, -w * 0.38, w * 0.34, w * 0.14, w * 0.06);
  ctx.fill();
  for (const wx of [-0.26, 0.26]) {
    ctx.fillStyle = '#33363e';
    ctx.beginPath();
    ctx.arc(wx * w, 0, w * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e6e0';
    ctx.beginPath();
    ctx.arc(wx * w, 0, w * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function makeChoicePucks(carIdx: number): Puck[] {
  const spec = CARS[carIdx];
  const next = CARS[(carIdx + 1) % CARS.length];
  return [
    new Puck({
      id: 'again', color: 0x5ecfbf, label: 'もういっかい',
      icon: (ctx, s) => {
        miniCar(ctx, 0, s * 0.12, s * 0.9, spec.body);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s * 0.09;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.62, -2.2, 0.6);
        ctx.stroke();
        const hx = Math.cos(0.6) * s * 0.62;
        const hy = Math.sin(0.6) * s * 0.62;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(hx + s * 0.14, hy + s * 0.02);
        ctx.lineTo(hx - s * 0.12, hy + s * 0.16);
        ctx.lineTo(hx - s * 0.05, hy - s * 0.16);
        ctx.closePath();
        ctx.fill();
      },
    }),
    new Puck({
      id: 'next', color: 0xffb45e, label: 'つぎのくるま',
      icon: (ctx, s) => {
        miniCar(ctx, -s * 0.3, s * 0.3, s * 0.55, spec.body);
        miniCar(ctx, s * 0.14, -s * 0.16, s * 0.8, next.body);
        // big forward arrow so it can't be confused with "again"
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s * 0.11;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, s * 0.62);
        ctx.lineTo(s * 0.34, s * 0.62);
        ctx.moveTo(s * 0.12, s * 0.42);
        ctx.lineTo(s * 0.38, s * 0.62);
        ctx.lineTo(s * 0.12, s * 0.82);
        ctx.stroke();
      },
    }),
    new Puck({
      id: 'free', color: 0xf291b1, label: 'じゆうにあそぶ',
      icon: (ctx, s) => {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s * 0.12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-s * 0.3, s * 0.34);
        ctx.lineTo(s * 0.12, -s * 0.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s * 0.24, -s * 0.22, s * 0.17, 0.8, Math.PI * 2 - 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.45, -s * 0.05);
        ctx.quadraticCurveTo(-s * 0.2, -s * 0.5, 0, -s * 0.42);
        ctx.stroke();
      },
    }),
  ];
}

// floating welding-mask pickup item
export function buildMaskItem(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.56, 0.3, 4, 0.12), M.plastic(0x4aa8a0, 0.45));
  g.add(shell);
  const win = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.18, 0.06, 2, 0.03), M.plastic(0x232936, 0.2));
  win.position.set(0, 0.05, 0.15);
  g.add(win);
  const star = new THREE.Mesh(starGeo(0.05), M.emissive(0xfff3b0, 0.5));
  star.position.set(0.13, -0.17, 0.15);
  g.add(star);
  return g;
}
