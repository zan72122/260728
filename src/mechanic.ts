import { rr, vgrad, glow, starPath, clamp, TAU, type Ctx } from './gfx';

// The friendly robot mechanic "レンチちゃん" and the creeper board.
// Sizes are driven by `s` = head radius in px.

export const SUIT = '#ff8a5c';
export const SUIT_DARK = '#e06a3e';
export const CREAM = '#f7f3ea';
export const CREEPER_PINK = '#f291b1';
export const CREEPER_DARK = '#d66e91';

export interface Eye {
  x: number; // -1..1
  y: number;
  blink?: number; // 0..1
}

export function drawFace(ctx: Ctx, r: number, eye: Eye, mouth: 'smile' | 'oh' | 'focus' = 'smile'): void {
  // face plate
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.15);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e3ddd0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,70,0.25)';
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.stroke();

  const blink = eye.blink ?? 0;
  const ex = clamp(eye.x, -1, 1) * r * 0.16;
  const ey = clamp(eye.y, -1, 1) * r * 0.14;
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#3b4250';
    ctx.beginPath();
    ctx.ellipse(side * r * 0.34 + ex, -r * 0.08 + ey, r * 0.15, r * 0.21 * (1 - blink * 0.9), 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(side * r * 0.34 + ex + r * 0.05, -r * 0.14 + ey, r * 0.055, 0, TAU);
    ctx.fill();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255,150,140,0.5)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * r * 0.58, r * 0.18, r * 0.12, 0, TAU);
    ctx.fill();
  }
  // mouth
  ctx.strokeStyle = '#7a6f63';
  ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mouth === 'smile') {
    ctx.arc(0, r * 0.22, r * 0.24, 0.25, Math.PI - 0.25);
  } else if (mouth === 'oh') {
    ctx.arc(0, r * 0.32, r * 0.12, 0, TAU);
  } else {
    ctx.moveTo(-r * 0.16, r * 0.34);
    ctx.lineTo(r * 0.16, r * 0.34);
  }
  ctx.stroke();
}

function antenna(ctx: Ctx, r: number, lampPulse: number): void {
  ctx.strokeStyle = '#9aa1ae';
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.95);
  ctx.lineTo(0, -r * 1.35);
  ctx.stroke();
  const lit = lampPulse > 0;
  if (lit) glow(ctx, 0, -r * 1.5, r * (0.7 + lampPulse * 0.5), 'rgba(255,220,120,0.75)', lampPulse);
  ctx.fillStyle = lit ? '#ffd166' : '#c8cdd6';
  ctx.beginPath();
  ctx.arc(0, -r * 1.5, r * 0.17, 0, TAU);
  ctx.fill();
}

function helmet(ctx: Ctx, r: number): void {
  // rounded cap behind face
  ctx.fillStyle = vgrad(ctx, -r * 1.15, r * 0.6, [[0, '#fefcf7'], [1, '#d9d2c2']]);
  ctx.beginPath();
  ctx.arc(0, -r * 0.05, r * 1.14, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,70,0.2)';
  ctx.lineWidth = r * 0.06;
  ctx.stroke();
}

export function drawCreeper(ctx: Ctx, len: number, wheelSpin = 0): void {
  const h = len * 0.09;
  // casters
  for (const u of [-0.36, -0.12, 0.12, 0.36]) {
    ctx.save();
    ctx.translate(u * len, h * 1.55);
    ctx.fillStyle = '#3a3e46';
    ctx.beginPath();
    ctx.arc(0, 0, len * 0.045, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.rotate(wheelSpin);
    ctx.fillStyle = '#b9bec8';
    ctx.beginPath();
    ctx.arc(len * 0.018, 0, len * 0.014, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  // board
  rr(ctx, -len / 2, -h / 2, len, h * 1.7, h * 0.8);
  ctx.fillStyle = vgrad(ctx, -h / 2, h * 1.2, [[0, CREEPER_PINK], [1, CREEPER_DARK]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,40,0.25)';
  ctx.lineWidth = Math.max(1.5, len * 0.008);
  ctx.stroke();
  // cushion
  rr(ctx, -len * 0.46, -h * 0.62, len * 0.34, h * 0.9, h * 0.45);
  ctx.fillStyle = '#fbd0de';
  ctx.fill();
  // star sticker
  ctx.fillStyle = '#fff3b0';
  starPath(ctx, len * 0.28, h * 0.35, h * 0.55, 5, 0.5);
  ctx.fill();
}

export interface LyingOpts {
  s: number;              // head radius
  dir: 1 | -1;            // 1 = head to the left, feet to the right
  eye: Eye;
  reach: number;          // 0..1 arms reaching up (under the car)
  lampOn: number;         // 0..1 chest lamp brightness
  lampAim: number;        // x offset (-1..1) the lamp/eyes aim at
  wheelSpin: number;
  mouth?: 'smile' | 'oh' | 'focus';
}

// origin: center of the creeper board top; robot lies with head at -dir side
export function drawRobotLying(ctx: Ctx, o: LyingOpts): void {
  const s = o.s;
  ctx.save();

  drawCreeper(ctx, s * 6.4, o.wheelSpin);

  ctx.save();
  ctx.scale(-o.dir, 1); // normalize: head on the left

  // legs (bent up knees)
  ctx.strokeStyle = SUIT_DARK;
  ctx.lineWidth = s * 0.62;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 1.1, -s * 0.42);
  ctx.quadraticCurveTo(s * 1.9, -s * 1.15, s * 2.55, -s * 0.62);
  ctx.stroke();
  // boots
  ctx.fillStyle = '#5b4a3f';
  rr(ctx, s * 2.3, -s * 0.95, s * 0.85, s * 0.6, s * 0.28);
  ctx.fill();

  // torso
  rr(ctx, -s * 1.05, -s * 1.06, s * 2.6, s * 1.15, s * 0.55);
  ctx.fillStyle = vgrad(ctx, -s * 1.06, s * 0.1, [[0, SUIT], [1, SUIT_DARK]]);
  ctx.fill();
  // chest lamp
  const lampX = -s * 0.15;
  const lampY = -s * 1.0;
  if (o.lampOn > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aim = clamp(o.lampAim, -1, 1);
    const bx = lampX + aim * s * 4;
    const g = ctx.createRadialGradient(lampX, lampY, s * 0.1, bx, lampY - s * 4.4, s * 4.6);
    g.addColorStop(0, `rgba(255,238,180,${0.5 * o.lampOn})`);
    g.addColorStop(1, 'rgba(255,238,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lampX - s * 0.35, lampY);
    ctx.lineTo(bx - s * 2.4, lampY - s * 5.2);
    ctx.lineTo(bx + s * 2.4, lampY - s * 5.2);
    ctx.lineTo(lampX + s * 0.35, lampY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = o.lampOn > 0 ? '#ffe9a8' : '#cfd4dc';
  ctx.beginPath();
  ctx.arc(lampX, lampY, s * 0.22, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.4)';
  ctx.lineWidth = s * 0.07;
  ctx.stroke();

  // arms
  const reach = o.reach;
  ctx.strokeStyle = SUIT;
  ctx.lineWidth = s * 0.5;
  ctx.lineCap = 'round';
  for (const side of [-0.4, 0.55]) {
    const ax = side * s;
    const ay = -s * 0.75;
    const hx = ax + s * (0.5 - reach * 0.4) * (side < 0 ? -1 : 1);
    const hy = ay - s * (0.25 + reach * 1.7);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + (side < 0 ? -s * 0.5 : s * 0.5), ay - s * 0.8 * (0.4 + reach), hx, hy);
    ctx.stroke();
    // glove
    ctx.fillStyle = '#fff1d6';
    ctx.beginPath();
    ctx.arc(hx, hy, s * 0.34, 0, TAU);
    ctx.fill();
  }

  // head (lying back)
  ctx.save();
  ctx.translate(-s * 1.55, -s * 1.05);
  ctx.rotate(-0.42);
  helmet(ctx, s);
  drawFace(ctx, s, o.eye, o.mouth ?? 'smile');
  antenna(ctx, s, 0);
  ctx.restore();

  ctx.restore();
  ctx.restore();
}

export interface StandOpts {
  s: number;
  dir: 1 | -1;              // facing direction (1 = facing right)
  eye: Eye;
  maskDown: number;         // 0..1 welding mask over the face
  torchTo: { x: number; y: number } | null; // local coords target for torch tip
  lampPulse: number;        // antenna hint blink
  walk: number;             // leg swing phase
  mouth?: 'smile' | 'oh' | 'focus';
}

// origin: between the feet on the floor
export function drawRobotStanding(ctx: Ctx, o: StandOpts): void {
  const s = o.s;
  ctx.save();
  ctx.scale(o.dir, 1);

  // legs
  ctx.strokeStyle = SUIT_DARK;
  ctx.lineWidth = s * 0.58;
  ctx.lineCap = 'round';
  const sw = Math.sin(o.walk) * s * 0.25;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.42, -s * 1.7);
    ctx.lineTo(side * s * 0.48 + (side > 0 ? sw : -sw) * 0.4, -s * 0.3);
    ctx.stroke();
    ctx.fillStyle = '#5b4a3f';
    rr(ctx, side * s * 0.48 - s * 0.42 + (side > 0 ? sw : -sw) * 0.4, -s * 0.42, s * 0.95, s * 0.46, s * 0.2);
    ctx.fill();
  }

  // torso
  rr(ctx, -s * 0.95, -s * 3.1, s * 1.9, s * 1.75, s * 0.6);
  ctx.fillStyle = vgrad(ctx, -s * 3.1, -s * 1.3, [[0, SUIT], [1, SUIT_DARK]]);
  ctx.fill();
  // pocket + star badge
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  rr(ctx, -s * 0.55, -s * 2.1, s * 1.1, s * 0.5, s * 0.18);
  ctx.fill();
  ctx.fillStyle = '#fff3b0';
  starPath(ctx, -s * 0.5, -s * 2.75, s * 0.22, 5, 0.5);
  ctx.fill();

  // arms
  ctx.strokeStyle = SUIT;
  ctx.lineWidth = s * 0.48;
  ctx.lineCap = 'round';
  // back arm rests
  ctx.beginPath();
  ctx.moveTo(-s * 0.8, -s * 2.75);
  ctx.quadraticCurveTo(-s * 1.35, -s * 2.2, -s * 1.1, -s * 1.55);
  ctx.stroke();
  ctx.fillStyle = '#fff1d6';
  ctx.beginPath();
  ctx.arc(-s * 1.1, -s * 1.5, s * 0.3, 0, TAU);
  ctx.fill();

  // front arm: torch or rest
  if (o.torchTo) {
    const tx = o.torchTo.x * o.dir;
    const ty = o.torchTo.y;
    const sx = s * 0.8;
    const sy = -s * 2.75;
    const mx = (sx + tx) / 2 + s * 0.3;
    const my = (sy + ty) / 2 - s * 0.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    ctx.fillStyle = '#fff1d6';
    ctx.beginPath();
    ctx.arc(tx, ty, s * 0.3, 0, TAU);
    ctx.fill();
    // torch body
    const ang = Math.atan2(ty - my, tx - mx);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(ang);
    ctx.fillStyle = '#4a5163';
    rr(ctx, -s * 0.1, -s * 0.16, s * 0.85, s * 0.32, s * 0.14);
    ctx.fill();
    ctx.fillStyle = '#c9834e';
    rr(ctx, s * 0.65, -s * 0.09, s * 0.4, s * 0.18, s * 0.08);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(s * 0.8, -s * 2.75);
    ctx.quadraticCurveTo(s * 1.35, -s * 2.2, s * 1.1, -s * 1.55);
    ctx.stroke();
    ctx.fillStyle = '#fff1d6';
    ctx.beginPath();
    ctx.arc(s * 1.1, -s * 1.5, s * 0.3, 0, TAU);
    ctx.fill();
  }

  // head
  ctx.save();
  ctx.translate(0, -s * 3.6);
  helmet(ctx, s);
  drawFace(ctx, s, o.eye, o.mouth ?? 'smile');
  antenna(ctx, s, o.lampPulse);

  // welding mask flips down over the face
  if (o.maskDown > 0) {
    const t = o.maskDown;
    ctx.save();
    ctx.translate(0, -s * 0.9);
    ctx.rotate((-1 + t) * 1.9);
    ctx.translate(0, s * 0.9);
    drawMaskShape(ctx, s);
    ctx.restore();
  }
  ctx.restore();

  ctx.restore();
}

export function drawMaskShape(ctx: Ctx, s: number): void {
  // teal mask with star sticker and dark window
  rr(ctx, -s * 1.02, -s * 1.05, s * 2.04, s * 2.1, s * 0.62);
  ctx.fillStyle = vgrad(ctx, -s, s, [[0, '#59b8b0'], [1, '#3a8f88']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,50,48,0.45)';
  ctx.lineWidth = s * 0.08;
  ctx.stroke();
  rr(ctx, -s * 0.68, -s * 0.42, s * 1.36, s * 0.72, s * 0.24);
  ctx.fillStyle = '#232936';
  ctx.fill();
  // reflection line
  ctx.strokeStyle = 'rgba(150,220,255,0.5)';
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.moveTo(-s * 0.45, -s * 0.28);
  ctx.lineTo(s * 0.1, -s * 0.1);
  ctx.stroke();
  ctx.fillStyle = '#fff3b0';
  starPath(ctx, s * 0.55, s * 0.62, s * 0.2, 5, 0.5);
  ctx.fill();
}
