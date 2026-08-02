import type { Game } from './game';
import {
  rr, vgrad, glow, starPath, chevron, softShadow, clamp, lerp,
  easeInOutCubic, easeOutCubic, easeOutBack, TAU, type Ctx,
} from './gfx';
import {
  drawCarSide, drawCrackOnBody, drawUnderBase, hexNut, densify, crackLocalPts,
  type CrackDraw, type CarPose,
} from './car';
import { drawRobotLying, drawRobotStanding, drawMaskShape } from './mechanic';
import {
  layoutGarage, layoutUnder, layoutWeld, layoutChoice, underToScreen, PART,
  type GarageLayout, type UnderLayout,
} from './layout';
import { CARS } from './car';
import { CRACK_N } from './game';

export function render(g: Game, ctx: Ctx): void {
  ctx.save();
  if (g.shake > 0) {
    ctx.translate((Math.random() - 0.5) * g.shakeAmp * g.shake * 2, (Math.random() - 0.5) * g.shakeAmp * g.shake * 2);
  }

  switch (g.phase) {
    case 'title':
      drawGarageScene(g, ctx);
      drawTitle(g, ctx);
      break;
    case 'arrive':
    case 'garage':
    case 'shield':
    case 'lower':
      drawGarageScene(g, ctx);
      break;
    case 'slideIn':
    case 'slideOut': {
      const q = g.creeperProg;
      drawGarageScene(g, ctx);
      if (q > 0.55) {
        ctx.save();
        ctx.globalAlpha = clamp((q - 0.55) / 0.4, 0, 1);
        drawUnderScene(g, ctx);
        ctx.restore();
      }
      break;
    }
    case 'under':
      drawUnderScene(g, ctx);
      break;
    case 'weld':
    case 'weldDone':
      drawWeldScene(g, ctx);
      break;
    case 'freeweld':
      drawFreeWeld(g, ctx);
      break;
    case 'test':
      drawTestScene(g, ctx);
      break;
    case 'choice':
      drawGarageScene(g, ctx);
      drawChoice(g, ctx);
      break;
  }

  g.parts.draw(ctx);

  // safety-lock flash
  if (g.lockFlash > 0) {
    ctx.save();
    ctx.globalAlpha = g.lockFlash * 0.35;
    ctx.fillStyle = '#fff8e0';
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.restore();
  }

  // scene fade curtain
  if (g.fade) {
    const f = g.fade;
    const half = f.dur / 2;
    const a = f.t < half ? f.t / half : 1 - (f.t - half) / half;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = '#232733';
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.restore();
  }
  ctx.restore();
}

// ================================================================ garage

function drawGarageScene(g: Game, ctx: Ctx): void {
  const l = layoutGarage(g.W, g.H);
  const { W, H } = g;

  // zoom-in camera while sliding under
  const q = (g.phase === 'slideIn' || g.phase === 'slideOut') ? g.creeperProg : 0;
  ctx.save();
  if (q > 0) {
    const z = 1 + easeInOutCubic(clamp(q / 0.8, 0, 1)) * 0.45;
    const ax = l.carX;
    const ay = l.groundY - l.liftMax * g.liftT * 0.4;
    ctx.translate(ax, ay);
    ctx.scale(z, z);
    ctx.translate(-ax, -ay);
  }

  drawGarageBackdrop(g, ctx, l);
  drawLift(g, ctx, l);
  drawGarageDoor(g, ctx, l);

  // car position (arrive / drive out)
  let carX = l.carX;
  if (g.phase === 'arrive') carX = lerp(-l.carW * 0.6, l.carX, easeOutCubic(g.arriveT));
  if (g.phase === 'lower' && g.arriveT > 1) carX = l.carX + (g.arriveT - 1) * (W - l.carX + l.carW);

  const hasFault = g.faultsRemaining() > 0;
  const idleWob = hasFault && g.liftT < 0.5 && (g.phase === 'arrive' || g.phase === 'garage')
    ? Math.sin(g.time * 25) * l.carW * 0.006 : 0;
  const bounce = Math.sin(g.time * 16) * g.settleBounce * 0.35 + idleWob;

  const crack = g.cracks[0];
  const crackDraw: CrackDraw | undefined = crack
    ? { kind: crack.kind, welded: crack.welded, beadShine: crack.shine }
    : undefined;

  const pose: CarPose = {
    x: carX, groundY: l.groundY, w: l.carW,
    lift: g.liftT * l.liftMax,
    bounce,
    wheelDrop: g.liftT * l.carW * 0.035,
    wheelSpin: g.wheelSpin,
    eyeBlink: g.blink,
  };
  softShadow(ctx, carX, l.groundY + 6, l.carW * (1 - g.liftT * 0.25), l.carW * 0.09, 0.25 + g.liftT * 0.1);
  drawCarSide(ctx, g.spec, pose, crackDraw);

  // exhaust smoke while a broken car idles
  if (hasFault && g.liftT < 0.3 && g.phase !== 'lower' && Math.random() < 0.1) {
    g.parts.dust(carX - l.carW * 0.52, l.groundY - l.carW * 0.1, 1, -0.6);
  }

  drawLever(g, ctx, l);
  drawMechanicInGarage(g, ctx, l);
  if (g.freePlay && g.phase === 'garage') drawFreeExtras(g, ctx, l);
  drawMaskItem(g, ctx, l);
  drawGarageHints(g, ctx, l);

  ctx.restore();

  // dark vignette rush while sliding
  if (q > 0.25) {
    ctx.save();
    ctx.globalAlpha = clamp((q - 0.25) / 0.5, 0, 1) * 0.5;
    const vg = ctx.createRadialGradient(W / 2, H * 0.6, Math.min(W, H) * 0.2, W / 2, H * 0.6, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,12,20,1)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function drawGarageBackdrop(g: Game, ctx: Ctx, l: GarageLayout): void {
  const { W, H } = g;
  // wall
  ctx.fillStyle = vgrad(ctx, 0, l.groundY, [[0, '#f6e8d4'], [0.7, '#efdcc2'], [1, '#e4ccab']]);
  ctx.fillRect(0, 0, W, l.groundY);
  // floor
  ctx.fillStyle = vgrad(ctx, l.groundY, H, [[0, '#b9bcc4'], [0.25, '#a8abb5'], [1, '#8f929c']]);
  ctx.fillRect(0, l.groundY, W, H - l.groundY);
  // floor lane stripe
  ctx.fillStyle = 'rgba(255,209,102,0.35)';
  ctx.fillRect(0, l.groundY + (H - l.groundY) * 0.42, W, Math.max(6, l.carW * 0.03));
  // baseboard
  ctx.fillStyle = '#c9b090';
  ctx.fillRect(0, l.groundY - 8, W, 8);
  // subtle old oil stains
  for (const [fx, fy, fr] of [[0.22, 0.5, 0.06], [0.62, 0.8, 0.05]] as Array<[number, number, number]>) {
    ctx.fillStyle = 'rgba(60,62,72,0.08)';
    ctx.beginPath();
    ctx.ellipse(W * fx, l.groundY + (H - l.groundY) * fy, W * fr, W * fr * 0.3, 0, 0, TAU);
    ctx.fill();
  }
  // window with sky
  const winW = Math.min(W * 0.30, 260);
  const winX = l.portrait ? W * 0.06 : W * 0.05;
  const winY = H * 0.055;
  const winH = winW * 0.62;
  rr(ctx, winX - 8, winY - 8, winW + 16, winH + 16, 18);
  ctx.fillStyle = '#d9c3a3';
  ctx.fill();
  rr(ctx, winX, winY, winW, winH, 12);
  ctx.fillStyle = vgrad(ctx, winY, winY + winH, [[0, '#8fd0f0'], [1, '#c8ecf8']]);
  ctx.fill();
  // sun + cloud
  glow(ctx, winX + winW * 0.78, winY + winH * 0.3, winW * 0.16, 'rgba(255,235,160,0.9)');
  ctx.fillStyle = '#fff4c9';
  ctx.beginPath();
  ctx.arc(winX + winW * 0.78, winY + winH * 0.3, winW * 0.09, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [cx, cy, cr] of [[0.3, 0.42, 0.10], [0.42, 0.40, 0.13], [0.54, 0.44, 0.09]] as Array<[number, number, number]>) {
    ctx.beginPath();
    ctx.arc(winX + winW * cx, winY + winH * cy, winW * cr, 0, TAU);
    ctx.fill();
  }
  // window frame bars
  ctx.strokeStyle = '#d9c3a3';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(winX + winW / 2, winY);
  ctx.lineTo(winX + winW / 2, winY + winH);
  ctx.moveTo(winX, winY + winH / 2);
  ctx.lineTo(winX + winW, winY + winH / 2);
  ctx.stroke();

  // tool board on the wall (right side)
  if (!l.portrait || W > 500) {
    const tbW = Math.min(W * 0.20, 190);
    // keep the board clear of the lift column / lever on narrow screens
    const tbX = l.portrait || W > 1000 ? W * 0.66 : W * 0.40;
    const tbY = H * 0.07;
    rr(ctx, tbX, tbY, tbW, tbW * 0.8, 14);
    ctx.fillStyle = '#e0b98a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();
    drawToolSilhouettes(ctx, tbX, tbY, tbW);
  }

  // tool cart at the left
  const cartW = l.carW * 0.34;
  const cartX = clamp(l.carX - l.carW * 0.98, -cartW * 0.5, W);
  const cartH = cartW * 0.9;
  const cartY = l.groundY - cartH;
  rr(ctx, cartX, cartY, cartW, cartH, cartW * 0.09);
  ctx.fillStyle = vgrad(ctx, cartY, cartY + cartH, [[0, '#e5604a'], [1, '#bf3f2d']]);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    rr(ctx, cartX + cartW * 0.1, cartY + cartH * (0.12 + i * 0.27), cartW * 0.8, cartH * 0.18, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.fillStyle = '#f7d9a0';
    rr(ctx, cartX + cartW * 0.42, cartY + cartH * (0.17 + i * 0.27), cartW * 0.16, cartH * 0.05, 4);
    ctx.fill();
  }
  for (const wx of [0.2, 0.8]) {
    ctx.fillStyle = '#3a3e46';
    ctx.beginPath();
    ctx.arc(cartX + cartW * wx, l.groundY, cartW * 0.07, 0, TAU);
    ctx.fill();
  }
}

function drawToolSilhouettes(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(110,80,50,0.55)';
  ctx.fillStyle = 'rgba(110,80,50,0.55)';
  ctx.lineWidth = w * 0.045;
  ctx.lineCap = 'round';
  // wrench
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + w * 0.18);
  ctx.lineTo(x + w * 0.2, y + w * 0.52);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w * 0.2, y + w * 0.15, w * 0.075, 0.6, TAU - 0.6);
  ctx.stroke();
  // hammer
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + w * 0.2);
  ctx.lineTo(x + w * 0.5, y + w * 0.55);
  ctx.stroke();
  rr(ctx, x + w * 0.41, y + w * 0.1, w * 0.18, w * 0.1, w * 0.03);
  ctx.fill();
  // screwdriver
  ctx.beginPath();
  ctx.moveTo(x + w * 0.78, y + w * 0.28);
  ctx.lineTo(x + w * 0.78, y + w * 0.55);
  ctx.stroke();
  rr(ctx, x + w * 0.74, y + w * 0.1, w * 0.08, w * 0.16, w * 0.035);
  ctx.fill();
  ctx.restore();
}

function drawLift(g: Game, ctx: Ctx, l: GarageLayout): void {
  const armY = l.groundY - g.liftT * l.liftMax - l.carW * 0.065;
  for (const colX of [l.colXL, l.colX]) {
    const colW = Math.max(18, l.carW * 0.075);
    // column
    rr(ctx, colX - colW / 2, l.groundY - l.carW * 0.72, colW, l.carW * 0.72, colW * 0.3);
    ctx.fillStyle = vgrad(ctx, l.groundY - l.carW * 0.72, l.groundY, [[0, '#ffb45e'], [0.5, '#f09a3c'], [1, '#d97f28']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,20,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // base
    rr(ctx, colX - colW * 1.3, l.groundY - 8, colW * 2.6, 12, 5);
    ctx.fillStyle = '#8a6a3c';
    ctx.fill();
    // carriage + arm toward the car
    const toCar = colX < l.carX ? 1 : -1;
    rr(ctx, colX - colW * 0.7, armY - colW * 0.4, colW * 1.4, colW * 0.9, colW * 0.25);
    ctx.fillStyle = '#5a5f6b';
    ctx.fill();
    ctx.strokeStyle = '#454a55';
    ctx.lineWidth = Math.max(5, colW * 0.28);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(colX + toCar * colW * 0.6, armY);
    ctx.lineTo(colX + toCar * l.carW * 0.30, armY + colW * 0.15);
    ctx.stroke();
    // rubber pad
    ctx.fillStyle = '#33363e';
    rr(ctx, colX + toCar * l.carW * 0.30 - colW * 0.4, armY - colW * 0.15 + colW * 0.15, colW * 0.8, colW * 0.3, colW * 0.12);
    ctx.fill();
  }
  // safety latch on the right column
  const latchY = l.groundY - l.carW * 0.66;
  const lw = Math.max(14, l.carW * 0.06);
  rr(ctx, l.colX - lw, latchY - lw * 0.5, lw * 2, lw, lw * 0.3);
  ctx.fillStyle = '#454a55';
  ctx.fill();
  // latch tongue snaps in when locked
  const tongue = g.locked ? 1 : 0;
  rr(ctx, l.colX - lw * 0.75 + (1 - tongue) * lw * 0.7, latchY - lw * 0.18, lw * 1.1, lw * 0.36, lw * 0.15);
  ctx.fillStyle = g.locked ? '#7ddf8f' : '#c8cdd6';
  ctx.fill();
  if (g.lockFlash > 0) {
    glow(ctx, l.colX, latchY, lw * 4 * g.lockFlash, 'rgba(150,255,170,0.8)', g.lockFlash);
  }
}

function drawGarageDoor(g: Game, ctx: Ctx, l: GarageLayout): void {
  const { H } = g;
  // door frame on the right edge; the door itself rolls up (doorT)
  const doorW = Math.max(26, l.carW * 0.10);
  const x = l.doorX;
  ctx.fillStyle = '#d9c3a3';
  ctx.fillRect(x - doorW * 0.4, 0, doorW, l.groundY);
  const doorH = l.groundY * (1 - g.doorT);
  ctx.fillStyle = vgrad(ctx, 0, l.groundY, [[0, '#9fb4be'], [1, '#7d939e']]);
  ctx.fillRect(x - doorW * 0.25, 0, doorW * 0.7, doorH);
  ctx.strokeStyle = 'rgba(60,80,90,0.4)';
  ctx.lineWidth = 2;
  for (let yy = doorH * 0.2; yy < doorH; yy += Math.max(14, l.groundY * 0.08)) {
    ctx.beginPath();
    ctx.moveTo(x - doorW * 0.25, yy);
    ctx.lineTo(x + doorW * 0.45, yy);
    ctx.stroke();
  }
  if (g.doorT > 0) {
    // warm light spilling in
    ctx.save();
    ctx.globalAlpha = g.doorT * 0.5;
    const lg = ctx.createLinearGradient(x, 0, x - l.carW * 0.8, 0);
    lg.addColorStop(0, 'rgba(255,240,190,0.8)');
    lg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x - l.carW * 0.8, doorH, l.carW * 0.8, H - doorH);
    ctx.restore();
  }
}

function drawLever(g: Game, ctx: Ctx, l: GarageLayout): void {
  const knobR = Math.max(17, l.carW * 0.062);
  const travel = l.leverTravel;
  const baseY = l.leverY;
  const knobY = baseY + travel * (0.5 - g.liftT) - g.leverPull * travel * 0.35;
  // plate
  rr(ctx, l.leverX - knobR * 1.15, baseY - travel * 0.72, knobR * 2.3, travel * 1.44, knobR * 0.7);
  ctx.fillStyle = '#576070';
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,25,35,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // slot
  rr(ctx, l.leverX - knobR * 0.22, baseY - travel * 0.55, knobR * 0.44, travel * 1.1, knobR * 0.22);
  ctx.fillStyle = '#2e333d';
  ctx.fill();
  // up/down decals
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  chevron(ctx, l.leverX, baseY - travel * 0.62, knobR * 0.55, 0, '#ffffff', 0.55);
  chevron(ctx, l.leverX, baseY + travel * 0.62, knobR * 0.55, Math.PI, '#ffffff', 0.55);
  // stick + knob
  ctx.strokeStyle = '#aab0bd';
  ctx.lineWidth = knobR * 0.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(l.leverX, baseY);
  ctx.lineTo(l.leverX, knobY);
  ctx.stroke();
  const kg = ctx.createRadialGradient(l.leverX - knobR * 0.3, knobY - knobR * 0.35, knobR * 0.2, l.leverX, knobY, knobR * 1.2);
  kg.addColorStop(0, '#ff8f7a');
  kg.addColorStop(0.55, '#e5604a');
  kg.addColorStop(1, '#b23c2c');
  ctx.fillStyle = kg;
  ctx.beginPath();
  ctx.arc(l.leverX, knobY, knobR, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(l.leverX - knobR * 0.3, knobY - knobR * 0.35, knobR * 0.24, 0, TAU);
  ctx.fill();
}

function drawMechanicInGarage(g: Game, ctx: Ctx, l: GarageLayout): void {
  const s = l.mechS;
  const eye = { x: 0, y: 0, blink: g.blink };
  // where is the creeper?
  const prog = g.creeperProg;
  const cx = lerp(l.mechHomeX, l.carX, easeInOutCubic(prog));
  const wobble = g.phase === 'slideIn' || g.phase === 'slideOut' ? Math.sin(g.time * 40) * 1.2 : 0;

  const standing = !g.freePlay && g.faultsRemaining() === 0 && prog === 0
    && (((g.phase === 'garage' || g.phase === 'shield') && g.liftT >= 1)
      || g.phase === 'lower' || g.phase === 'choice');

  if (g.phase === 'title') {
    // waving next to the start button, on the near floor in front of the car
    const bx = l.W * 0.5 - Math.min(l.W, l.H) * 0.24;
    const by = Math.min(l.H * 0.78 + Math.min(l.W, l.H) * 0.11, l.H - 10);
    softShadow(ctx, bx, by + 4, s * 5, s * 1.1);
    ctx.save();
    ctx.translate(bx, by + Math.sin(g.time * 2.4) * 2);
    drawRobotStanding(ctx, {
      s: s * 1.25, dir: 1, eye: { x: 0, y: -0.2, blink: g.blink },
      maskDown: 0, torchTo: null, lampPulse: (Math.sin(g.time * 3) + 1) / 2, walk: g.time * 4,
    });
    ctx.restore();
    return;
  }

  if (standing) {
    const sx = l.mechHomeX;
    softShadow(ctx, sx, l.groundY + 4, s * 5, s * 1.1);
    // mask flying to the face during 'shield'
    const maskOn = g.phase === 'shield' ? g.maskT : (g.phase === 'lower' || g.cracksRemaining() > 0 ? 0 : 0);
    ctx.save();
    ctx.translate(sx, l.groundY);
    drawRobotStanding(ctx, {
      s, dir: -1, eye, maskDown: maskOn, torchTo: null,
      lampPulse: 0, walk: 0,
    });
    ctx.restore();
    return;
  }

  // lying on the creeper (ready to slide!)
  softShadow(ctx, cx, l.mechY + s * 1.6, s * 6.5, s * 1.2, 0.2);
  ctx.save();
  ctx.translate(cx, l.mechY + wobble);
  const under = prog > 0.5;
  drawRobotLying(ctx, {
    s, dir: 1, eye: { x: under ? 0 : -0.6, y: -0.4, blink: g.blink },
    reach: 0,
    lampOn: under ? 1 : 0,
    lampAim: 0,
    wheelSpin: g.wheelSpin,
    mouth: 'smile',
  });
  ctx.restore();
  // speed streaks while sliding
  if (g.phase === 'slideIn' || g.phase === 'slideOut') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const yy = l.mechY - s + i * s * 0.8;
      const off = (g.time * 900 + i * 60) % 160;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + s * 4 + off, yy);
      ctx.lineTo(cx + s * 5.4 + off, yy);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMaskItem(g: Game, ctx: Ctx, l: GarageLayout): void {
  const mp = g.maskScreenPos(l);
  if (!mp || g.phase !== 'garage') return;
  const s = l.mechS * 1.7;
  const bob = Math.sin(g.time * 2.2) * s * 0.18;
  glow(ctx, mp.x, mp.y + bob, s * 3.2, 'rgba(120,220,210,0.35)', 0.7 + Math.sin(g.time * 3) * 0.3);
  ctx.save();
  ctx.translate(mp.x, mp.y + bob);
  ctx.rotate(Math.sin(g.time * 1.8) * 0.08);
  drawMaskShape(ctx, s);
  ctx.restore();
}

function drawFreeExtras(g: Game, ctx: Ctx, l: GarageLayout): void {
  // practice welding plate on an easel
  const r = l.plateR;
  ctx.save();
  ctx.translate(l.plateX, l.plateY);
  // easel legs
  ctx.strokeStyle = '#8a6a3c';
  ctx.lineWidth = r * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, r * 0.6);
  ctx.lineTo(-r * 0.9, l.groundY - l.plateY);
  ctx.moveTo(r * 0.7, r * 0.6);
  ctx.lineTo(r * 0.9, l.groundY - l.plateY);
  ctx.stroke();
  rr(ctx, -r, -r * 0.75, r * 2, r * 1.5, r * 0.16);
  ctx.fillStyle = vgrad(ctx, -r * 0.75, r * 0.75, [[0, '#b9bfc9'], [1, '#8b919d']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,35,45,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // little bead doodle preview
  ctx.fillStyle = '#e8eaee';
  for (let i = 0; i < Math.min(40, g.doodle.length); i += 4) {
    const d = g.doodle[i];
    ctx.beginPath();
    ctx.arc((d.x - 0.5) * r * 1.6, (d.y - 0.45) * r * 1.1, r * 0.05, 0, TAU);
    ctx.fill();
  }
  glow(ctx, 0, 0, r * 1.4, 'rgba(150,220,255,0.25)', 0.6 + Math.sin(g.time * 2.5) * 0.4);
  ctx.restore();

  // home button
  drawRoundIcon(ctx, l.homeX, l.homeY, l.homeR, '#576070', (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -l.homeR * 0.45);
    c.lineTo(l.homeR * 0.5, 0);
    c.lineTo(l.homeR * 0.32, 0);
    c.lineTo(l.homeR * 0.32, l.homeR * 0.45);
    c.lineTo(-l.homeR * 0.32, l.homeR * 0.45);
    c.lineTo(-l.homeR * 0.32, 0);
    c.lineTo(-l.homeR * 0.5, 0);
    c.closePath();
    c.fill();
  });
}

function drawGarageHints(g: Game, ctx: Ctx, l: GarageLayout): void {
  if (g.phase !== 'garage' || g.liftAnim || g.fade) return;
  const active = g.hintT > 4;
  const pulse = (Math.sin(g.time * 5) + 1) / 2;
  if (!active) return;

  const upReady = g.liftT >= 1 && g.locked;
  if (!upReady && g.liftT === 0) {
    // hint: pull the lever up
    glow(ctx, l.leverX, l.leverY, l.carW * 0.22, 'rgba(255,209,102,0.5)', 0.5 + pulse * 0.5);
    for (let i = 0; i < 3; i++) {
      const yy = l.leverY - l.carW * 0.1 - ((g.time * 60 + i * 26) % 78);
      chevron(ctx, l.leverX, yy, l.carW * 0.055, 0, '#ffd166', 0.9 - i * 0.25);
    }
  } else if (upReady && (g.freePlay || g.faultsRemaining() > 0)) {
    // hint: swipe the creeper toward the car
    const y = l.mechY - l.mechS;
    for (let i = 0; i < 3; i++) {
      const xx = l.mechHomeX - l.carW * 0.1 - ((g.time * 70 + i * 30) % 90);
      chevron(ctx, xx, y, l.carW * 0.055, -Math.PI / 2, '#ffd166', 0.9 - i * 0.25);
    }
    glow(ctx, l.mechHomeX, l.mechY, l.carW * 0.2, 'rgba(255,209,102,0.35)', 0.4 + pulse * 0.4);
  } else if (upReady && g.faultsRemaining() === 0 && g.cracksRemaining() > 0) {
    const mp = g.maskScreenPos(l);
    if (mp) glow(ctx, mp.x, mp.y, l.carW * 0.3, 'rgba(120,220,210,0.5)', 0.4 + pulse * 0.6);
  } else if (g.allRepaired() && g.liftT >= 1) {
    glow(ctx, l.leverX, l.leverY, l.carW * 0.22, 'rgba(255,209,102,0.5)', 0.5 + pulse * 0.5);
    for (let i = 0; i < 3; i++) {
      const yy = l.leverY + l.carW * 0.1 + ((g.time * 60 + i * 26) % 78);
      chevron(ctx, l.leverX, yy, l.carW * 0.055, Math.PI, '#ffd166', 0.9 - i * 0.25);
    }
  }
}

// ================================================================ under the car

function drawUnderScene(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  const l = layoutUnder(W, H);

  // dark cosy background
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#23262f'], [0.6, '#2b2d38'], [1, '#3a3d47']]);
  ctx.fillRect(0, 0, W, H);
  // concrete floor band where the mechanic lies
  ctx.fillStyle = vgrad(ctx, l.floorY - 14, H, [[0, '#565a66'], [1, '#43464f']]);
  ctx.fillRect(0, l.floorY - 14, W, H - l.floorY + 14);

  // warm work light pool
  const plateCenter = underToScreen(l, 500, 210);
  glow(ctx, plateCenter.x, plateCenter.y, Math.max(W, H) * 0.55, 'rgba(255,222,160,0.14)');

  // the underbody (rotated 90° in portrait so it fills the screen)
  ctx.save();
  if (l.rot) {
    ctx.translate(l.ox, l.oy + l.scale * 1000);
    ctx.scale(l.scale, l.scale);
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.translate(l.ox, l.oy);
    ctx.scale(l.scale, l.scale);
  }
  drawUnderBase(ctx, g.spec, g.time);
  drawUnderFaults(g, ctx);
  ctx.restore();

  drawUnderMechanic(g, ctx, l);
  drawUnderHints(g, ctx, l);

  // entrance light sweep
  if (g.phase === 'under' && g.tPhase < 0.6) {
    const k = g.tPhase / 0.6;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.5;
    const sw = ctx.createLinearGradient(W * (k * 1.6 - 0.3), 0, W * (k * 1.6 - 0.1), 0);
    sw.addColorStop(0, 'rgba(255,244,200,0)');
    sw.addColorStop(0.5, 'rgba(255,244,200,0.8)');
    sw.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = sw;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.4, W / 2, H * 0.5, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8,10,16,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawUnderFaults(g: Game, ctx: Ctx): void {
  // draw all four part stations; healthy versions when not part of this car's faults
  const has = (k: string): ReturnType<Game['faults']['find']> => g.faults.find((f) => f.kind === k);

  drawOilPanStation(g, ctx, has('bolt'));
  drawClipStation(g, ctx, has('clip'));
  drawHoseStation(g, ctx, has('hose'));
  drawExhaustStation(g, ctx, has('exhaust'));
}

type FS = NonNullable<ReturnType<Game['faults']['find']>>;

function drawOilPanStation(g: Game, ctx: Ctx, f: FS | undefined): void {
  const p = PART.oilPan;
  // oil pan
  rr(ctx, p.x - 90, p.y - 40, 180, 86, 26);
  ctx.fillStyle = vgrad(ctx, p.y - 40, p.y + 46, [[0, '#b9bfc9'], [0.5, '#98a0ad'], [1, '#767d8a']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,28,36,0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  rr(ctx, p.x - 66, p.y - 26, 132, 20, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();

  const broken = f && !f.fixed;
  const wob = broken ? Math.sin(f.wob * 4.2) * 2.5 : 0;
  const b = PART.boltPos;
  // oil sheen under a loose bolt
  if (broken) {
    ctx.fillStyle = 'rgba(80,62,30,0.55)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 14, 22, 7, 0, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(wob, 0);
  const spin = f ? f.taps * 2.1 + f.boltSpin : 0.4;
  hexNut(ctx, b.x, b.y, broken ? 21 : 17, spin + (broken ? wob * 0.05 : 0));
  ctx.restore();
  // wrench animation on tap
  if (f && f.wrenchT > 0) {
    const k = 1 - f.wrenchT / 0.55;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(-0.8 + easeOutCubic(Math.min(1, k * 1.4)) * 1.15);
    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(86, 26);
    ctx.stroke();
    ctx.fillStyle = '#d7dbe2';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0.7, TAU - 0.7);
    ctx.fill();
    ctx.restore();
  }
  if (f && f.snapT > 0) glow(ctx, b.x, b.y, 60 * f.snapT, 'rgba(255,233,168,0.8)', f.snapT);
}

function drawClipStation(g: Game, ctx: Ctx, f: FS | undefined): void {
  const cover = PART.coverPos;
  const slot = PART.clipSlot;
  const broken = f && !f.fixed;

  // cover plate hangs open when the clip is missing
  ctx.save();
  ctx.translate(cover.x - 60, cover.y);
  const swing = broken ? 0.35 + Math.sin(f.wob * 3.1) * 0.1 : 0;
  ctx.rotate(swing);
  rr(ctx, 0, -18, 128, 36, 14);
  ctx.fillStyle = vgrad(ctx, -18, 18, [[0, '#8f96a4'], [1, '#6c7381']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,28,36,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // clip slot (dashed highlight while broken)
  if (broken) {
    const pulse = (Math.sin(g.time * 4) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = `rgba(197,246,208,${0.4 + pulse * 0.5})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.arc(slot.x, slot.y, 26, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  // slot hole
  ctx.fillStyle = '#2c303a';
  ctx.beginPath();
  ctx.arc(slot.x, slot.y, 12, 0, TAU);
  ctx.fill();

  // the clip itself
  const cp = f ? (f.fixed ? slot : (f.drag ?? PART.clipLoose)) : slot;
  drawClip(ctx, cp.x, cp.y, f?.held ? 1.15 : 1, broken ? Math.sin((f?.wob ?? 0) * 2) * 0.15 : 0);
  if (f && f.snapT > 0) glow(ctx, slot.x, slot.y, 60 * f.snapT, 'rgba(197,246,208,0.8)', f.snapT);
}

function drawClip(ctx: Ctx, x: number, y: number, scale: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,100,20,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  rr(ctx, -6, -26, 12, 18, 5);
  ctx.fillStyle = '#ffdf8d';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,100,20,0.4)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(-5, -5, 4.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawHoseStation(g: Game, ctx: Ctx, f: FS | undefined): void {
  const a = PART.hoseFixed;
  const fit = PART.hoseFit;
  const broken = f && !f.fixed;
  const end = f ? (f.fixed ? fit : (f.drag ?? PART.hoseLoose)) : fit;

  // fitting flange
  ctx.fillStyle = '#767d8a';
  ctx.beginPath();
  ctx.arc(fit.x, fit.y, 17, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2c303a';
  ctx.beginPath();
  ctx.arc(fit.x, fit.y, 9, 0, TAU);
  ctx.fill();
  if (broken) {
    const pulse = (Math.sin(g.time * 4) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = `rgba(150,220,255,${0.4 + pulse * 0.5})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.arc(fit.x, fit.y, 28, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // the hose: translucent tube from a to end
  const midx = (a.x + end.x) / 2 + (broken ? Math.sin(g.time * 2.2) * 8 : 0);
  const midy = Math.max(a.y, end.y) + 55;
  const hosePath = (): void => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(midx, midy, end.x, end.y);
  };
  ctx.save();
  ctx.lineCap = 'round';
  hosePath();
  ctx.strokeStyle = 'rgba(230,244,250,0.5)';
  ctx.lineWidth = 20;
  ctx.stroke();
  // coolant inside
  if (f?.fixed) {
    const flow = g.coolantFlow * 90;
    hosePath();
    ctx.strokeStyle = '#57c8f0';
    ctx.lineWidth = 12;
    ctx.setLineDash([26, 18]);
    ctx.lineDashOffset = -flow;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    hosePath();
    ctx.strokeStyle = 'rgba(87,200,240,0.25)';
    ctx.lineWidth = 12;
    ctx.stroke();
  }
  // tube highlight
  hosePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // hose end connector
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.fillStyle = '#ffb45e';
  rr(ctx, -13, -13, 26, 26, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,90,20,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  // anchored end
  ctx.fillStyle = '#767d8a';
  ctx.beginPath();
  ctx.arc(a.x, a.y, 14, 0, TAU);
  ctx.fill();

  if (f && f.snapT > 0) glow(ctx, fit.x, fit.y, 60 * f.snapT, 'rgba(150,220,255,0.8)', f.snapT);
}

function drawExhaustStation(g: Game, ctx: Ctx, f: FS | undefined): void {
  const broken = f && !f.fixed;
  const lift01 = f ? (f.fixed ? 1 : f.lift01) : 1;
  const pivot = PART.exhaustPivot;
  const drop = (1 - lift01) * 0.16;
  const jitter = broken && !f.held ? Math.sin(f.wob * 8) * 0.012 : 0;

  // front pipe (fixed section)
  ctx.strokeStyle = '#9aa1ae';
  ctx.lineCap = 'round';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(700, 322);
  ctx.lineTo(pivot.x, pivot.y);
  ctx.stroke();

  // hanging rear section with the muffler
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(drop + jitter);
  ctx.strokeStyle = '#9aa1ae';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-200, 12);
  ctx.stroke();
  // muffler
  rr(ctx, -330, -16, 150, 52, 26);
  ctx.fillStyle = vgrad(ctx, -16, 36, [[0, '#c3c9d3'], [0.5, '#9aa1ae'], [1, '#7a8290']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,28,36,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#9aa1ae';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(-330, 12);
  ctx.lineTo(-395, 16);
  ctx.stroke();
  ctx.restore();

  // strap brackets
  for (const bx of [300, 480]) {
    const open = broken && bx === 300 ? (1 - lift01) : 0;
    ctx.save();
    ctx.translate(bx, 306);
    ctx.strokeStyle = broken && bx === 300 ? '#ffd166' : '#767d8a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 14, 20, Math.PI * (1.15 + open * 0.5), Math.PI * (2.15 - 0.25 + open * 0.2));
    ctx.stroke();
    ctx.restore();
  }
  if (broken) {
    const pulse = (Math.sin(g.time * 4) + 1) / 2;
    glow(ctx, PART.exhaustGrab.x, PART.exhaustGrab.y + 8, 46 + pulse * 12, 'rgba(255,209,102,0.35)', 0.5 + pulse * 0.4);
  }
  if (f && f.snapT > 0) glow(ctx, PART.exhaustGrab.x, PART.exhaustGrab.y - 20, 70 * f.snapT, 'rgba(197,246,208,0.8)', f.snapT);
}

function drawUnderMechanic(g: Game, ctx: Ctx, l: UnderLayout): void {
  const { W } = g;
  const s = l.mechS;
  // entering / exiting with overshoot
  let enter = 1;
  if (g.phase === 'slideIn' || g.phase === 'slideOut') {
    enter = clamp((g.creeperProg - 0.45) / 0.55, 0, 1);
  }
  const mx = lerp(W + s * 8, l.mechX, easeOutBack(enter));

  // which fault should the lamp aim at?
  const first = g.faults.find((f) => !f.fixed);
  let aim = 0.4; // default: glance toward the exit
  if (first) {
    const fp = g.faultGrabPos(first);
    const sp = underToScreen(l, fp.x, fp.y);
    aim = clamp((sp.x - mx) / (W * 0.5), -1, 1);
  }
  const reaching = g.pointer.down && g.phase === 'under' ? 1 : 0.25;

  softShadow(ctx, mx, l.mechY + s * 1.7, s * 7, s * 1.2, 0.3);
  ctx.save();
  ctx.translate(mx, l.mechY);
  drawRobotLying(ctx, {
    s, dir: 1,
    eye: { x: aim * 0.8, y: -0.5, blink: g.blink },
    reach: reaching,
    lampOn: 1,
    lampAim: aim,
    wheelSpin: g.wheelSpin,
    mouth: first ? 'focus' : 'smile',
  });
  ctx.restore();
}

function drawUnderHints(g: Game, ctx: Ctx, l: UnderLayout): void {
  if (g.phase !== 'under') return;
  const pulse = (Math.sin(g.time * 5) + 1) / 2;
  const first = g.faults.find((f) => !f.fixed);
  if (first) {
    if (g.hintT > 4) {
      const fp = g.faultGrabPos(first);
      const sp = underToScreen(l, fp.x, fp.y);
      glow(ctx, sp.x, sp.y, l.grabR * (1.1 + pulse * 0.3), 'rgba(255,233,168,0.4)', 0.5 + pulse * 0.5);
      if (first.kind === 'exhaust') {
        // chevron points along the actual "push it home" direction on screen
        const base = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y);
        const top = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y - 55);
        const ang = Math.atan2(top.y - base.y, top.x - base.x) + Math.PI / 2;
        const k = 1.2 + pulse * 0.5;
        chevron(ctx, base.x + (top.x - base.x) * k, base.y + (top.y - base.y) * k, l.grabR * 0.4, ang, '#ffd166', 0.9);
      } else if (first.kind === 'clip' || first.kind === 'hose') {
        const to = first.kind === 'clip' ? PART.clipSlot : PART.hoseFit;
        const tp = underToScreen(l, to.x, to.y);
        // dotted path from piece to its home
        ctx.save();
        ctx.strokeStyle = 'rgba(255,233,168,0.7)';
        ctx.lineWidth = 4;
        ctx.setLineDash([2, 14]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.restore();
      }
    }
  } else {
    // all fixed: point the way out (either side works, show right)
    const y = l.mechY - l.mechS * 2;
    for (let i = 0; i < 3; i++) {
      const xx = g.W * 0.62 + ((g.time * 70 + i * 30) % 90);
      chevron(ctx, xx, y, l.mechS * 1.1, Math.PI / 2, '#c5f6d0', 0.9 - i * 0.25);
    }
  }
}

// ================================================================ welding

function drawWeldScene(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  const c = g.cracks[Math.min(g.weldIdx, g.cracks.length - 1)];
  if (!c) return;
  const local = densify(crackLocalPts(c.kind), CRACK_N);
  const cu = local.reduce((s, p) => s + p[0], 0) / local.length;
  const cv = local.reduce((s, p) => s + p[1], 0) / local.length;
  const wl = layoutWeld(W, H, { u: cu, v: cv });

  // dark shield-tinted backdrop
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#1b2029'], [0.6, '#232936'], [1, '#1a1e28']]);
  ctx.fillRect(0, 0, W, H);

  const pose: CarPose = {
    x: wl.carX, groundY: wl.carGroundY, w: wl.bigW,
    lift: 0, bounce: 0, wheelDrop: 0, wheelSpin: 0,
  };
  const crackDraw: CrackDraw = { kind: c.kind, welded: c.welded, beadShine: c.shine };
  drawCarSide(ctx, g.spec, pose, undefined);

  // dim the body so the arc pops (the mask view)
  ctx.fillStyle = 'rgba(12,16,26,0.5)';
  ctx.fillRect(0, 0, W, H);

  // crack drawn bright on top
  ctx.save();
  ctx.translate(wl.carX, wl.carGroundY);
  drawCrackOnBody(ctx, wl.bigW, crackDraw);
  ctx.restore();

  // ghost finger hint: a soft dot slides along the crack
  if (g.phase === 'weld' && g.hintT > 4 && !g.arcOn && !c.done) {
    const pts = g.crackScreenPts();
    if (pts.length > 1) {
      const idx = Math.floor(g.hintGhost * (pts.length - 1));
      const p = pts[idx];
      glow(ctx, p.x, p.y, 44, 'rgba(255,255,255,0.55)', 0.8);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, TAU);
      ctx.fill();
    }
  }

  // the arc light
  if (g.arcOn) {
    drawArc(g, ctx, g.arcX, g.arcY);
  }

  // mechanic with the torch
  const s = wl.mechS;
  ctx.save();
  ctx.translate(wl.mechX, wl.mechY);
  const torch = g.arcOn
    ? { x: g.arcX - wl.mechX, y: g.arcY - wl.mechY + s * 0.4 }
    : { x: s * 1.6, y: -s * 2.2 };
  drawRobotStanding(ctx, {
    s, dir: 1, eye: { x: 0, y: -0.6, blink: 0 },
    maskDown: g.phase === 'weldDone' ? g.maskT : 1,
    torchTo: torch, lampPulse: 0, walk: 0,
  });
  ctx.restore();

  // completion shine sweep
  if (c.done && c.shine > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(c.shine, 0, 1) * 0.7;
    const k = 1 - clamp(c.shine / 1.4, 0, 1);
    const sx = lerp(-W * 0.2, W * 1.2, k);
    const sw = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
    sw.addColorStop(0, 'rgba(255,255,255,0)');
    sw.addColorStop(0.5, 'rgba(255,255,240,0.8)');
    sw.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sw;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(5,8,14,0.65)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawArc(g: Game, ctx: Ctx, x: number, y: number): void {
  const f = g.arcFlicker;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, x, y, 150 * f, 'rgba(120,180,255,0.5)');
  glow(ctx, x, y, 60 * f, 'rgba(190,230,255,0.9)');
  ctx.fillStyle = '#ffffff';
  starPath(ctx, x, y, 16 * f, 4, 0.32, g.time * 6);
  ctx.fill();
  starPath(ctx, x, y, 10 * f, 4, 0.4, -g.time * 8);
  ctx.fill();
  ctx.restore();
}

function drawFreeWeld(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#1b2029'], [0.6, '#232936'], [1, '#1a1e28']]);
  ctx.fillRect(0, 0, W, H);

  // big practice plate
  const px = W * 0.06;
  const py = H * 0.14;
  const pw = W * 0.88;
  const ph = H * 0.68;
  rr(ctx, px, py, pw, ph, 26);
  ctx.fillStyle = vgrad(ctx, py, py + ph, [[0, '#9aa1ae'], [0.5, '#848b99'], [1, '#6e7481']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,24,32,0.5)';
  ctx.lineWidth = 5;
  ctx.stroke();
  // rivets
  for (const [rx, ry] of [[0.06, 0.08], [0.94, 0.08], [0.06, 0.92], [0.94, 0.92]] as Array<[number, number]>) {
    hexNut(ctx, px + pw * rx, py + ph * ry, 9, 0.3);
  }

  // bead doodle
  for (const d of g.doodle) {
    const bx = d.x * W;
    const by = d.y * H;
    const r = Math.max(7, Math.min(W, H) * 0.014);
    const gr = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.35, r * 0.1, bx, by, r);
    gr.addColorStop(0, '#fdfdfd');
    gr.addColorStop(0.5, '#c9ccd4');
    gr.addColorStop(1, '#8d93a0');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, TAU);
    ctx.fill();
  }

  if (g.arcOn) drawArc(g, ctx, g.arcX, g.arcY);

  // masked mechanic peeking from the bottom corner
  const s = Math.max(16, Math.min(W, H) * 0.05);
  ctx.save();
  ctx.translate(W * 0.85, H * 1.02);
  drawRobotStanding(ctx, {
    s, dir: -1, eye: { x: 0, y: -0.6 }, maskDown: 1,
    torchTo: g.arcOn ? { x: (g.arcX - W * 0.85) * -1, y: g.arcY - H * 1.02 + s } : null,
    lampPulse: 0, walk: 0,
  });
  ctx.restore();

  // back button
  drawRoundIcon(ctx, 46, 46, 26, '#576070', (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-8, 0);
    c.moveTo(-1, -9);
    c.lineTo(-10, 0);
    c.lineTo(-1, 9);
    c.stroke();
  });
}

// ================================================================ test drive

function courseGround(course: number, wx: number): number {
  if (course === 0) {
    // rolling hills course: repeated soft bumps
    const m = ((wx % 1500) + 1500) % 1500;
    const bump = (cx: number, h: number, w: number): number => {
      const d = (m - cx) / w;
      return h * Math.exp(-d * d);
    };
    return bump(520, 30, 120) + bump(980, 24, 100);
  }
  // bridge & tunnel course: gentle bridge humps
  const m = ((wx % 1900) + 1900) % 1900;
  const d = (m - 700) / 260;
  return 34 * Math.exp(-d * d);
}

function drawTestScene(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  const course = g.test.course;
  const roadY = H * 0.74;
  const sPos = g.test.t * 360;
  const carSX = W * 0.30;

  // sky
  if (course === 0) {
    ctx.fillStyle = vgrad(ctx, 0, roadY, [[0, '#7fd0f2'], [0.7, '#c2ecfa'], [1, '#e8f8ff']]);
  } else {
    ctx.fillStyle = vgrad(ctx, 0, roadY, [[0, '#3d4d86'], [0.55, '#8a6aa8'], [1, '#f2b48a']]);
  }
  ctx.fillRect(0, 0, W, roadY);

  if (course === 0) {
    glow(ctx, W * 0.82, H * 0.14, Math.min(W, H) * 0.2, 'rgba(255,240,170,0.9)');
    ctx.fillStyle = '#fff4c9';
    ctx.beginPath();
    ctx.arc(W * 0.82, H * 0.14, Math.min(W, H) * 0.07, 0, TAU);
    ctx.fill();
  } else {
    // stars
    for (let i = 0; i < 24; i++) {
      const sx = ((i * 173 + 40) % W);
      const sy = ((i * 89 + 20) % Math.floor(H * 0.4));
      ctx.fillStyle = `rgba(255,250,220,${0.4 + (i % 3) * 0.2})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6 + (i % 2), 0, TAU);
      ctx.fill();
    }
  }

  // parallax hills
  for (const [depth, color] of (course === 0
    ? [[0.25, '#a5dcA5'], [0.5, '#7cc98b']]
    : [[0.25, '#4a3f6e'], [0.5, '#38508a']]) as Array<[number, string]>) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    for (let x = 0; x <= W; x += 24) {
      const wx = x + sPos * depth;
      const hgt = 40 + 34 * Math.sin(wx * 0.004 + depth * 9) + 20 * Math.sin(wx * 0.01);
      ctx.lineTo(x, roadY - 26 - hgt * (0.6 + depth));
    }
    ctx.lineTo(W, roadY);
    ctx.closePath();
    ctx.fill();
  }

  // ground below, then a road band that follows the bumps
  ctx.fillStyle = course === 0 ? '#8fce7d' : '#3f4a63';
  ctx.fillRect(0, roadY - 4, W, H - roadY + 4);
  const bandH = Math.max(54, H * 0.15);
  ctx.beginPath();
  ctx.moveTo(0, roadY - courseGround(course, sPos));
  for (let x = 0; x <= W; x += 12) {
    ctx.lineTo(x, roadY - courseGround(course, x + sPos));
  }
  for (let x = W; x >= 0; x -= 12) {
    ctx.lineTo(x, roadY - courseGround(course, x + sPos) + bandH);
  }
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, roadY - 60, roadY + bandH, [[0, '#6a6f7c'], [1, '#4d515c']]);
  ctx.fill();
  // center dashes
  ctx.strokeStyle = 'rgba(255,235,160,0.8)';
  ctx.lineWidth = 6;
  ctx.setLineDash([34, 40]);
  ctx.lineDashOffset = -sPos;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 12) {
    const y = roadY - courseGround(course, x + sPos) + 26;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // course décor
  if (course === 0) {
    for (let i = 0; i < 8; i++) {
      const wx = i * 420;
      const x = ((wx - sPos) % 3360 + 3360) % 3360 - 200;
      if (x < -50 || x > W + 50) continue;
      const y = roadY - courseGround(course, x + sPos) + Math.max(54, H * 0.15) + 22;
      // flower
      ctx.fillStyle = '#ff9fb6';
      for (let pth = 0; pth < 5; pth++) {
        const a = (pth / 5) * TAU;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 5, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fill();
    }
  } else {
    // string lights across the top
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = H * 0.10 + Math.sin((x + sPos * 0.6) * 0.012) * H * 0.03;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let x = 0; x <= W; x += 46) {
      const y = H * 0.10 + Math.sin((x + sPos * 0.6) * 0.012) * H * 0.03 + 8;
      const hue = ['#ffd166', '#ff9fb6', '#8fd0f0', '#c5f6d0'][Math.floor((x + sPos * 0.6) / 46) % 4];
      glow(ctx, x, y, 12, hue, 0.8);
      ctx.fillStyle = hue;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.fill();
    }
  }

  // the car with soft suspension over bumps
  const frontG = courseGround(course, carSX + sPos + 60);
  const rearG = courseGround(course, carSX + sPos - 60);
  const gy = roadY - (frontG + rearG) / 2;
  const tilt = Math.atan2(rearG - frontG, 120) * 0.7;
  const carW = clamp(Math.min(W, H) * 0.42, 200, 330);
  softShadow(ctx, carSX, gy + 8, carW * 0.95, carW * 0.09, 0.28);
  ctx.save();
  ctx.translate(carSX, gy);
  ctx.rotate(tilt);
  const crack = g.cracks[0];
  drawCarSide(ctx, g.spec, {
    x: 0, groundY: 0, w: carW,
    lift: 0, bounce: Math.sin(g.time * 9) * 1.2,
    wheelDrop: 0, wheelSpin: g.wheelSpin,
    headlightOn: course === 1,
    eyeBlink: g.blink,
  }, crack ? { kind: crack.kind, welded: crack.welded, beadShine: 0 } : undefined);
  ctx.restore();

  // tunnel overlay for course 1
  if (course === 1) {
    const m = ((sPos % 1900) + 1900) % 1900;
    if (m > 1150 && m < 1750) {
      const k = Math.sin(((m - 1150) / 600) * Math.PI);
      ctx.save();
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = '#141824';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = k * 0.9;
      for (let i = 0; i < 5; i++) {
        const x = ((i * 220 - sPos * 1.4) % (W + 200) + (W + 200)) % (W + 200) - 100;
        glow(ctx, x, H * 0.16, 30, '#ffd166', 0.9);
      }
      ctx.restore();
    }
  }
}

// ================================================================ title & choice

function drawTitle(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  ctx.fillStyle = 'rgba(35,39,51,0.25)';
  ctx.fillRect(0, 0, W, H);

  // hanging wooden sign
  const sw = Math.min(W * 0.82, 560);
  const sh = Math.min(H * 0.30, sw * 0.5);
  const sx = W / 2;
  const sy = H * 0.06 + sh / 2 + Math.sin(g.time * 1.4) * 4;
  ctx.strokeStyle = '#8a6a3c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(sx - sw * 0.3, 0);
  ctx.lineTo(sx - sw * 0.3, sy - sh * 0.5);
  ctx.moveTo(sx + sw * 0.3, 0);
  ctx.lineTo(sx + sw * 0.3, sy - sh * 0.5);
  ctx.stroke();
  rr(ctx, sx - sw / 2, sy - sh / 2, sw, sh, 24);
  ctx.fillStyle = vgrad(ctx, sy - sh / 2, sy + sh / 2, [[0, '#e8b878'], [1, '#c98f4e']]);
  ctx.fill();
  ctx.strokeStyle = '#8a6a3c';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#5a3d1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const f1 = Math.min(sw * 0.105, sh * 0.30);
  ctx.font = `bold ${f1}px "Hiragino Maru Gothic ProN", "BIZ UDGothic", "Yu Gothic", sans-serif`;
  ctx.fillText('スルッ！ピカッ！', sx, sy - sh * 0.18);
  const f2 = Math.min(sw * 0.09, sh * 0.26);
  ctx.font = `bold ${f2}px "Hiragino Maru Gothic ProN", "BIZ UDGothic", "Yu Gothic", sans-serif`;
  ctx.fillText('おなかのガレージ', sx, sy + sh * 0.16);
  // decorative stars
  ctx.fillStyle = '#fff3b0';
  starPath(ctx, sx - sw * 0.42, sy - sh * 0.3, sh * 0.09, 5, 0.5, g.time);
  ctx.fill();
  starPath(ctx, sx + sw * 0.42, sy + sh * 0.28, sh * 0.07, 5, 0.5, -g.time);
  ctx.fill();

  // big start button
  const br = Math.min(W, H) * 0.11;
  const bx = W / 2;
  const by = H * 0.78;
  const pulse = 1 + Math.sin(g.time * 3) * 0.04;
  glow(ctx, bx, by, br * 2.6, 'rgba(255,180,120,0.35)', 0.8);
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(pulse, pulse);
  const bg = ctx.createRadialGradient(-br * 0.3, -br * 0.4, br * 0.2, 0, 0, br * 1.3);
  bg.addColorStop(0, '#ff9a6e');
  bg.addColorStop(1, '#e5604a');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(0, 0, br, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = br * 0.08;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-br * 0.25, -br * 0.4);
  ctx.lineTo(br * 0.48, 0);
  ctx.lineTo(-br * 0.25, br * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // expanding ring
  const ringT = (g.time % 1.6) / 1.6;
  ctx.save();
  ctx.globalAlpha = (1 - ringT) * 0.5;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(bx, by, br * (1.1 + ringT * 0.8), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawChoice(g: Game, ctx: Ctx): void {
  const { W, H } = g;
  ctx.fillStyle = 'rgba(35,39,51,0.45)';
  ctx.fillRect(0, 0, W, H);
  const cl = layoutChoice(W, H);
  const labels: Record<string, string> = { again: 'もういっかい', next: 'つぎのくるま', free: 'じゆうにあそぶ' };
  const colors: Record<string, string> = { again: '#5ecfbf', next: '#ffb45e', free: '#f291b1' };

  for (let i = 0; i < cl.btns.length; i++) {
    const b = cl.btns[i];
    const wob = Math.sin(g.time * 2.2 + i * 1.8) * 0.03;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(wob);
    glow(ctx, 0, 0, b.r * 1.9, 'rgba(255,255,255,0.15)', 1);
    const bg = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.4, b.r * 0.2, 0, 0, b.r * 1.25);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.16, '#ffffff');
    bg.addColorStop(0.17, colors[b.id]);
    bg.addColorStop(1, colors[b.id]);
    ctx.fillStyle = colors[b.id];
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = b.r * 0.07;
    ctx.stroke();

    if (b.id === 'again') {
      drawMiniCar(ctx, 0, b.r * 0.12, b.r * 0.9, g.spec.body);
      // circular arrow
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.r * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.62, -2.2, 0.6);
      ctx.stroke();
      const a = 0.6;
      const hx = Math.cos(a) * b.r * 0.62;
      const hy = Math.sin(a) * b.r * 0.62;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(hx + b.r * 0.14, hy + b.r * 0.02);
      ctx.lineTo(hx - b.r * 0.12, hy + b.r * 0.16);
      ctx.lineTo(hx - b.r * 0.05, hy - b.r * 0.16);
      ctx.closePath();
      ctx.fill();
    } else if (b.id === 'next') {
      const nextSpec = CARS[(g.carIdx + 1) % CARS.length];
      drawMiniCar(ctx, -b.r * 0.22, b.r * 0.20, b.r * 0.62, g.spec.body);
      drawMiniCar(ctx, b.r * 0.18, -b.r * 0.12, b.r * 0.82, nextSpec.body);
      ctx.fillStyle = '#ffffff';
      starPath(ctx, b.r * 0.52, -b.r * 0.5, b.r * 0.14, 4, 0.4);
      ctx.fill();
    } else {
      // wrench + crayon doodle
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.r * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-b.r * 0.3, b.r * 0.34);
      ctx.lineTo(b.r * 0.12, -b.r * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.r * 0.24, -b.r * 0.22, b.r * 0.17, 0.8, TAU - 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-b.r * 0.45, -b.r * 0.05);
      ctx.quadraticCurveTo(-b.r * 0.2, -b.r * 0.5, b.r * 0.0, -b.r * 0.42);
      ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      starPath(ctx, -b.r * 0.42, -b.r * 0.42, b.r * 0.16, 5, 0.5, g.time * 1.5);
      ctx.fill();
    }
    ctx.restore();

    // tiny caption for grown-ups
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(12, b.r * 0.2)}px "Hiragino Maru Gothic ProN", sans-serif`;
    ctx.fillText(labels[b.id], b.x, b.y + b.r * 1.12);
  }
}

function drawMiniCar(ctx: Ctx, x: number, y: number, w: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  rr(ctx, -w / 2, -w * 0.24, w, w * 0.24, w * 0.1);
  ctx.fillStyle = color;
  ctx.fill();
  rr(ctx, -w * 0.28, -w * 0.42, w * 0.5, w * 0.22, w * 0.09);
  ctx.fill();
  ctx.fillStyle = '#dff3fb';
  rr(ctx, -w * 0.2, -w * 0.38, w * 0.34, w * 0.14, w * 0.06);
  ctx.fill();
  ctx.fillStyle = '#33363e';
  for (const wx of [-0.26, 0.26]) {
    ctx.beginPath();
    ctx.arc(wx * w, 0, w * 0.11, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#e8e6e0';
  for (const wx of [-0.26, 0.26]) {
    ctx.beginPath();
    ctx.arc(wx * w, 0, w * 0.05, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawRoundIcon(ctx: Ctx, x: number, y: number, r: number, bg: string, icon: (c: Ctx) => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  icon(ctx);
  ctx.restore();
}
