import { rr, vgrad, gloss, clamp, TAU, type Ctx } from './gfx';

export type FaultKind = 'bolt' | 'clip' | 'hose' | 'exhaust';
export type CrackKind = 'door' | 'fender';
export type CarShape = 'hatch' | 'van' | 'pickup';

export interface CarSpec {
  id: string;
  shape: CarShape;
  body: string;      // main paint
  bodyDark: string;
  bodyLight: string;
  accent: string;
  hub: string;
  faults: FaultKind[];
  crack: CrackKind;
}

export const CARS: CarSpec[] = [
  {
    id: 'poko', shape: 'hatch',
    body: '#5ecfbf', bodyDark: '#3aa396', bodyLight: '#a8ece2', accent: '#ffd166', hub: '#ffd166',
    faults: ['bolt', 'hose'], crack: 'door',
  },
  {
    id: 'bunbun', shape: 'van',
    body: '#ffc94d', bodyDark: '#e09f22', bodyLight: '#ffe9ad', accent: '#4fa3d9', hub: '#4fa3d9',
    faults: ['clip', 'exhaust'], crack: 'fender',
  },
  {
    id: 'tomato', shape: 'pickup',
    body: '#ef6a5a', bodyDark: '#c34435', bodyLight: '#ffb3a6', accent: '#69c9d9', hub: '#f2f2f2',
    faults: ['hose', 'clip'], crack: 'door',
  },
];

// body heights as fraction of body length
export function bodyH(shape: CarShape): number {
  return shape === 'van' ? 0.52 : shape === 'pickup' ? 0.46 : 0.44;
}

// Crack polylines in body-local units: u along length (-0.5..0.5, +u = front/right),
// v height above ground as fraction of body length.
export function crackLocalPts(kind: CrackKind): Array<[number, number]> {
  if (kind === 'door') {
    // jagged, roughly horizontal seam on the door panel
    return [
      [-0.16, 0.205], [-0.115, 0.225], [-0.065, 0.195], [-0.01, 0.225],
      [0.04, 0.20], [0.095, 0.225], [0.145, 0.205],
    ];
  }
  // curved crack above the rear wheel arch (kept below the window line)
  return [
    [-0.42, 0.135], [-0.395, 0.18], [-0.355, 0.215], [-0.30, 0.235],
    [-0.245, 0.24], [-0.19, 0.228], [-0.15, 0.205],
  ];
}

export interface CarPose {
  x: number;         // body center x (px)
  groundY: number;   // where wheels touch when not lifted (px)
  w: number;         // body length (px)
  lift: number;      // px the body is raised by the lift
  bounce: number;    // extra body offset (suspension), +down
  wheelDrop: number; // px the wheels hang below their normal spot (on the lift)
  wheelSpin: number;
  headlightOn?: boolean;
  eyeBlink?: number; // 0..1 (1 = closed)
}

function bodyOutline(ctx: Ctx, w: number, shape: CarShape): void {
  // origin: body center x=0, ground y=0, up = -y. coordinates in fractions of w.
  const p = (u: number, v: number): [number, number] => [u * w, -v * w];
  ctx.beginPath();
  if (shape === 'hatch') {
    ctx.moveTo(...p(-0.44, 0.075));
    ctx.quadraticCurveTo(...p(-0.5, 0.09), ...p(-0.492, 0.19));
    ctx.quadraticCurveTo(...p(-0.485, 0.345), ...p(-0.36, 0.405));
    ctx.quadraticCurveTo(...p(-0.2, 0.45), ...p(0.03, 0.435));
    ctx.quadraticCurveTo(...p(0.19, 0.415), ...p(0.27, 0.30));
    ctx.quadraticCurveTo(...p(0.36, 0.27), ...p(0.44, 0.255));
    ctx.quadraticCurveTo(...p(0.5, 0.23), ...p(0.495, 0.14));
    ctx.quadraticCurveTo(...p(0.49, 0.075), ...p(0.42, 0.07));
    ctx.lineTo(...p(-0.44, 0.075));
  } else if (shape === 'van') {
    ctx.moveTo(...p(-0.45, 0.075));
    ctx.quadraticCurveTo(...p(-0.5, 0.09), ...p(-0.495, 0.24));
    ctx.quadraticCurveTo(...p(-0.49, 0.45), ...p(-0.38, 0.495));
    ctx.quadraticCurveTo(...p(-0.15, 0.53), ...p(0.13, 0.505));
    ctx.quadraticCurveTo(...p(0.27, 0.48), ...p(0.345, 0.345));
    ctx.quadraticCurveTo(...p(0.42, 0.30), ...p(0.47, 0.28));
    ctx.quadraticCurveTo(...p(0.505, 0.24), ...p(0.5, 0.14));
    ctx.quadraticCurveTo(...p(0.495, 0.075), ...p(0.43, 0.07));
    ctx.lineTo(...p(-0.45, 0.075));
  } else {
    // pickup: bed at rear, cab forward
    ctx.moveTo(...p(-0.46, 0.075));
    ctx.quadraticCurveTo(...p(-0.505, 0.09), ...p(-0.5, 0.19));
    ctx.quadraticCurveTo(...p(-0.497, 0.28), ...p(-0.44, 0.295));
    ctx.lineTo(...p(-0.04, 0.295));
    ctx.quadraticCurveTo(...p(-0.02, 0.30), ...p(-0.015, 0.33));
    ctx.quadraticCurveTo(...p(0.0, 0.445), ...p(0.09, 0.455));
    ctx.quadraticCurveTo(...p(0.2, 0.455), ...p(0.245, 0.42));
    ctx.quadraticCurveTo(...p(0.31, 0.31), ...p(0.38, 0.285));
    ctx.quadraticCurveTo(...p(0.45, 0.27), ...p(0.495, 0.235));
    ctx.quadraticCurveTo(...p(0.51, 0.17), ...p(0.495, 0.10));
    ctx.quadraticCurveTo(...p(0.487, 0.072), ...p(0.42, 0.07));
    ctx.lineTo(...p(-0.46, 0.075));
  }
  ctx.closePath();
}

function windowPath(ctx: Ctx, w: number, shape: CarShape): void {
  const p = (u: number, v: number): [number, number] => [u * w, -v * w];
  ctx.beginPath();
  if (shape === 'hatch') {
    ctx.moveTo(...p(-0.315, 0.24));
    ctx.quadraticCurveTo(...p(-0.345, 0.36), ...p(-0.28, 0.385));
    ctx.quadraticCurveTo(...p(-0.1, 0.415), ...p(0.05, 0.40));
    ctx.quadraticCurveTo(...p(0.14, 0.39), ...p(0.21, 0.285));
    ctx.quadraticCurveTo(...p(0.215, 0.25), ...p(0.17, 0.245));
    ctx.closePath();
  } else if (shape === 'van') {
    ctx.moveTo(...p(-0.42, 0.27));
    ctx.quadraticCurveTo(...p(-0.435, 0.43), ...p(-0.35, 0.455));
    ctx.quadraticCurveTo(...p(-0.12, 0.485), ...p(0.10, 0.465));
    ctx.quadraticCurveTo(...p(0.21, 0.44), ...p(0.28, 0.325));
    ctx.quadraticCurveTo(...p(0.285, 0.285), ...p(0.23, 0.28));
    ctx.closePath();
  } else {
    ctx.moveTo(...p(0.015, 0.325));
    ctx.quadraticCurveTo(...p(0.02, 0.415), ...p(0.09, 0.42));
    ctx.quadraticCurveTo(...p(0.17, 0.42), ...p(0.21, 0.39));
    ctx.quadraticCurveTo(...p(0.26, 0.325), ...p(0.29, 0.30));
    ctx.quadraticCurveTo(...p(0.26, 0.29), ...p(0.2, 0.29));
    ctx.closePath();
  }
}

function drawWheel(ctx: Ctx, x: number, y: number, r: number, hub: string, spin: number): void {
  ctx.save();
  ctx.translate(x, y);
  // tire
  ctx.fillStyle = '#33363e';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  const tg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  tg.addColorStop(0, 'rgba(255,255,255,0.18)');
  tg.addColorStop(0.6, 'rgba(255,255,255,0)');
  tg.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // rim
  ctx.rotate(spin);
  ctx.fillStyle = '#e8e6e0';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.58, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.46, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.30, Math.sin(a) * r * 0.30, r * 0.075, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#f6f4ee';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export interface CrackDraw {
  kind: CrackKind;
  welded: boolean[]; // per sampled point
  beadShine: number; // 0..1 flash after completion
  emberPulse?: number; // 0..1 warm glow on unwelded parts (weld scene)
}

export function drawCarSide(ctx: Ctx, spec: CarSpec, pose: CarPose, crack?: CrackDraw): void {
  const { w } = pose;
  const wheelR = w * 0.105;
  const bodyLift = pose.lift;
  const cy = pose.groundY - bodyLift + pose.bounce;

  ctx.save();
  ctx.translate(pose.x, cy);

  // under-shadow strip under the body
  ctx.fillStyle = 'rgba(25,28,36,0.85)';
  rr(ctx, -w * 0.42, -w * 0.088, w * 0.84, w * 0.05, w * 0.02);
  ctx.fill();

  // wheels (drop slightly when the car hangs on the lift)
  const wy = -wheelR + pose.wheelDrop;
  drawWheel(ctx, -w * 0.30, wy, wheelR, spec.hub, pose.wheelSpin);
  drawWheel(ctx, w * 0.30, wy, wheelR, spec.hub, pose.wheelSpin);

  // body
  const h = bodyH(spec.shape) * w;
  const g = vgrad(ctx, -h, 0, [
    [0, spec.bodyLight],
    [0.35, spec.body],
    [0.82, spec.body],
    [1, spec.bodyDark],
  ]);
  bodyOutline(ctx, w, spec.shape);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,50,0.18)';
  ctx.lineWidth = Math.max(1.2, w * 0.006);
  ctx.stroke();

  // rocker panel
  ctx.fillStyle = 'rgba(30,34,44,0.35)';
  rr(ctx, -w * 0.40, -w * 0.095, w * 0.80, w * 0.028, w * 0.014);
  ctx.fill();

  // wheel arches shading
  for (const ux of [-0.30, 0.30]) {
    ctx.save();
    ctx.fillStyle = 'rgba(25,28,36,0.55)';
    ctx.beginPath();
    ctx.arc(ux * w, -wheelR * 0.75, wheelR * 1.24, Math.PI, TAU);
    ctx.fill();
    ctx.restore();
  }
  // re-draw wheels in front of arch shading
  drawWheel(ctx, -w * 0.30, wy, wheelR, spec.hub, pose.wheelSpin);
  drawWheel(ctx, w * 0.30, wy, wheelR, spec.hub, pose.wheelSpin);

  // windows
  windowPath(ctx, w, spec.shape);
  const wg = vgrad(ctx, -h, -h * 0.4, [
    [0, '#dff3fb'],
    [1, '#8fc6de'],
  ]);
  ctx.fillStyle = wg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, w * 0.008);
  ctx.stroke();

  // accent stripe (between the wheel arches only)
  ctx.fillStyle = spec.accent;
  rr(ctx, -w * 0.165, -w * 0.15, w * 0.33, w * 0.022, w * 0.011);
  ctx.fill();

  // door line + handle
  ctx.strokeStyle = 'rgba(30,40,50,0.25)';
  ctx.lineWidth = Math.max(1, w * 0.006);
  ctx.beginPath();
  ctx.moveTo(w * 0.02, -w * 0.075);
  ctx.quadraticCurveTo(w * 0.035, -w * 0.22, w * 0.02, -w * (bodyH(spec.shape) - 0.09));
  ctx.stroke();
  ctx.fillStyle = 'rgba(30,40,50,0.35)';
  rr(ctx, -w * 0.045, -w * 0.245, w * 0.05, w * 0.016, w * 0.008);
  ctx.fill();

  // headlight (friendly eye-like glint)
  const hlY = -w * (spec.shape === 'van' ? 0.20 : 0.185);
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.ellipse(w * 0.455, hlY, w * 0.032, w * 0.042 * (1 - (pose.eyeBlink ?? 0) * 0.85), -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3d4553';
  ctx.beginPath();
  ctx.ellipse(w * 0.462, hlY + w * 0.004, w * 0.017, w * 0.024 * (1 - (pose.eyeBlink ?? 0) * 0.85), -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(w * 0.468, hlY - w * 0.008, w * 0.006, 0, TAU);
  ctx.fill();
  if (pose.headlightOn) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(w * 0.46, hlY, 0, w * 0.46, hlY, w * 0.28);
    lg.addColorStop(0, 'rgba(255,244,200,0.55)');
    lg.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(w * 0.46, hlY, w * 0.28, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // tail light
  ctx.fillStyle = '#ff8f7a';
  rr(ctx, -w * 0.495, -w * 0.21, w * 0.028, w * 0.05, w * 0.012);
  ctx.fill();

  // bumpers
  ctx.fillStyle = '#dfe3e8';
  rr(ctx, w * 0.43, -w * 0.115, w * 0.075, w * 0.045, w * 0.02);
  ctx.fill();
  rr(ctx, -w * 0.505, -w * 0.115, w * 0.075, w * 0.045, w * 0.02);
  ctx.fill();

  // mirror
  ctx.fillStyle = spec.bodyDark;
  rr(ctx, w * 0.215, -w * (bodyH(spec.shape) - 0.135), w * 0.035, w * 0.03, w * 0.01);
  ctx.fill();

  // paint gloss
  ctx.save();
  bodyOutline(ctx, w, spec.shape);
  ctx.clip();
  gloss(ctx, -w * 0.1, -h * 0.86, w * 0.62, h * 0.2, 0.22);
  ctx.restore();

  // crack / weld bead
  if (crack) drawCrackOnBody(ctx, w, crack);

  ctx.restore();
}

export function drawCrackOnBody(ctx: Ctx, w: number, crack: CrackDraw): void {
  const pts = crackLocalPts(crack.kind).map(([u, v]) => [u * w, -v * w] as [number, number]);
  const dense = densify(pts, 26);
  const lw = Math.max(4, w * 0.018);

  // unwelded part: warm ember glow (weld scene) + a single crisp dark crack
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ember = crack.emberPulse ?? 0;
  if (ember > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + ember * 0.35;
    ctx.strokeStyle = '#ff9a4d';
    ctx.lineWidth = lw * (2.6 + ember * 1.2);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < dense.length; i++) {
      if (crack.welded[i]) { started = false; continue; }
      if (!started) { ctx.moveTo(dense[i][0], dense[i][1]); started = true; }
      else ctx.lineTo(dense[i][0], dense[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < dense.length - 1; i++) {
    if (crack.welded[i] && crack.welded[i + 1]) continue;
    ctx.strokeStyle = 'rgba(24,20,20,0.9)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(dense[i][0], dense[i][1]);
    ctx.lineTo(dense[i + 1][0], dense[i + 1][1]);
    ctx.stroke();
  }
  ctx.restore();

  // welded part: overlapping silver bead "scales"
  const beadR = lw * 1.05;
  for (let i = 0; i < dense.length; i++) {
    if (!crack.welded[i]) continue;
    const [bx, by] = dense[i];
    const g = ctx.createRadialGradient(bx - beadR * 0.3, by - beadR * 0.35, beadR * 0.1, bx, by, beadR);
    g.addColorStop(0, '#fdfdfd');
    g.addColorStop(0.5, '#c9ccd4');
    g.addColorStop(1, '#8d93a0');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, beadR, 0, TAU);
    ctx.fill();
  }
  if (crack.beadShine > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = crack.beadShine;
    ctx.strokeStyle = 'rgba(255,255,240,0.9)';
    ctx.lineWidth = beadR * 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < dense.length; i++) {
      const [bx, by] = dense[i];
      if (i === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function densify(pts: Array<[number, number]>, n: number): Array<[number, number]> {
  // resample polyline into n evenly spaced points
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.sqrt(dx * dx + dy * dy);
    segLens.push(l);
    total += l;
  }
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    let d = (k / (n - 1)) * total;
    let i = 0;
    while (i < segLens.length - 1 && d > segLens[i]) { d -= segLens[i]; i++; }
    const t = segLens[i] === 0 ? 0 : clamp(d / segLens[i], 0, 1);
    out.push([
      pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
    ]);
  }
  return out;
}

// ---------------- underbody ----------------
// local coordinates: 1000 x 420, car front on the RIGHT.

export const UW = 1000;
export const UH = 420;

export function drawUnderBase(ctx: Ctx, spec: CarSpec, time: number): void {
  // main floor pan
  const g = vgrad(ctx, 0, UH, [
    [0, '#3c414e'],
    [0.5, '#4a505f'],
    [1, '#383d49'],
  ]);
  rr(ctx, 20, 30, UW - 40, UH - 60, 46);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,18,24,0.6)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // frame rails
  for (const y of [92, UH - 122]) {
    rr(ctx, 60, y, UW - 120, 30, 14);
    ctx.fillStyle = vgrad(ctx, y, y + 30, [[0, '#6a7180'], [0.5, '#575e6d'], [1, '#454b58']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,22,28,0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // cross members
  for (const x of [180, 500, 820]) {
    rr(ctx, x - 14, 100, 28, UH - 200, 12);
    ctx.fillStyle = '#4d5362';
    ctx.fill();
  }

  // rear differential + driveshaft
  ctx.fillStyle = '#5b6272';
  rr(ctx, 200, 196, 330, 26, 13);
  ctx.fill();
  const dg = ctx.createRadialGradient(200, 209, 4, 200, 209, 46);
  dg.addColorStop(0, '#8b93a3');
  dg.addColorStop(1, '#565d6c');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(200, 209, 44, 0, TAU);
  ctx.fill();

  // gearbox
  rr(ctx, 520, 178, 96, 66, 20);
  ctx.fillStyle = vgrad(ctx, 178, 244, [[0, '#9aa1b0'], [1, '#6c7382']]);
  ctx.fill();

  // engine block silhouette at front
  rr(ctx, 700, 90, 220, 130, 30);
  ctx.fillStyle = vgrad(ctx, 90, 220, [[0, '#848c9c'], [1, '#5c6373']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,22,28,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // ribs
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 4; i++) {
    rr(ctx, 720 + i * 50, 100, 26, 110, 10);
    ctx.fill();
  }

  // far-side tires peeking at the top
  for (const x of [170, 830]) {
    rr(ctx, x - 70, 8, 140, 52, 24);
    ctx.fillStyle = '#2a2d34';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    rr(ctx, x - 58, 14, 116, 14, 7);
    ctx.fill();
  }
  // near-side tires at the very bottom, mostly cropped
  for (const x of [170, 830]) {
    rr(ctx, x - 74, UH - 34, 148, 40, 18);
    ctx.fillStyle = '#23262c';
    ctx.fill();
  }

  // a couple of tidy bolts (decoration, clearly "already tight")
  ctx.fillStyle = '#aab0bd';
  for (const [bx, by] of [[350, 110], [650, 110], [350, UH - 106], [905, 250]] as Array<[number, number]>) {
    hexNut(ctx, bx, by, 11, 0.4);
  }

  // gentle shimmer line so the metal feels alive
  const sx = (time * 60) % (UW + 400) - 200;
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(sx, 30);
  ctx.lineTo(sx + 90, 30);
  ctx.lineTo(sx - 30, UH - 30);
  ctx.lineTo(sx - 120, UH - 30);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  void spec;
}

export function hexNut(ctx: Ctx, x: number, y: number, r: number, rot = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r * 1.2);
  g.addColorStop(0, '#d7dbe2');
  g.addColorStop(1, '#7c828f');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,22,28,0.5)';
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, TAU);
  ctx.fillStyle = 'rgba(20,22,28,0.28)';
  ctx.fill();
  ctx.restore();
}
