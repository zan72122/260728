import { clamp } from './gfx';
import { view } from './three/scene3d';

// Screen-space layout adapter over the 3D scene: every value here is a live
// projection of a world-space anchor, so game logic, hints and the E2E hooks
// keep working in plain screen pixels while the renderer is fully 3D.
// Rotation safety is free: layouts are re-projected every query.

export interface GarageLayout {
  portrait: boolean;
  W: number; H: number;
  carW: number;
  carX: number;
  groundY: number;
  liftMax: number;
  leverX: number; leverY: number;
  mechHomeX: number; mechY: number;
  mechS: number;
  plateX: number; plateY: number; plateR: number;
  homeX: number; homeY: number; homeR: number;
}

export function layoutGarage(W: number, H: number): GarageLayout {
  const gi = view.garageInfo();
  return {
    portrait: H > W,
    W, H,
    carW: gi.carW,
    carX: gi.carX,
    groundY: gi.groundY,
    liftMax: gi.liftMax,
    leverX: gi.leverX, leverY: gi.leverY,
    mechHomeX: gi.mechX, mechY: gi.mechY,
    mechS: clamp(gi.carW * 0.055, 12, 26),
    plateX: gi.plateX, plateY: gi.plateY, plateR: Math.max(46, gi.plateR),
    homeX: 44, homeY: 44, homeR: 26,
  };
}

export interface UnderLayout {
  portrait: boolean;
  rot: boolean;
  W: number; H: number;
  grabR: number;
  floorY: number;
  mechS: number;
}

export function layoutUnder(W: number, H: number): UnderLayout {
  const ui = view.underInfo();
  return {
    portrait: H > W,
    rot: H > W,
    W, H,
    grabR: ui.grabR,
    floorY: ui.floorY,
    mechS: clamp(Math.min(W, H) * 0.05, 14, 26),
  };
}

export function underToScreen(_l: UnderLayout, ux: number, uy: number): { x: number; y: number } {
  return view.underToScreenPart(ux, uy);
}

export function screenToUnder(_l: UnderLayout, x: number, y: number): { x: number; y: number } {
  return view.screenToUnderPart(x, y);
}

export interface WeldLayout {
  W: number; H: number;
  bigW: number;
  carX: number; carGroundY: number;
}

export function layoutWeld(W: number, H: number, _crackCenter: { u: number; v: number }): WeldLayout {
  const wf = view.weldFrame();
  return { W, H, bigW: wf.bigW, carX: wf.carX, carGroundY: wf.carGroundY };
}

export interface ChoiceLayout {
  btns: Array<{ id: 'again' | 'next' | 'free'; x: number; y: number; r: number }>;
}

export function layoutChoice(W: number, H: number): ChoiceLayout {
  const portrait = H > W;
  const base = clamp(Math.min(W, H) * 0.135, 46, 96);
  const r = portrait ? Math.min(base, H * 0.068) : base;
  if (portrait) {
    const cx = W / 2;
    const y0 = H * 0.40;
    const gap = Math.min(r * 2.75, H * 0.185);
    return {
      btns: [
        { id: 'again', x: cx, y: y0, r },
        { id: 'next', x: cx, y: y0 + gap, r },
        { id: 'free', x: cx, y: y0 + gap * 2, r },
      ],
    };
  }
  const cy = H * 0.52;
  const gap = Math.min(r * 3.0, W * 0.26);
  return {
    btns: [
      { id: 'again', x: W / 2 - gap, y: cy, r },
      { id: 'next', x: W / 2, y: cy, r },
      { id: 'free', x: W / 2 + gap, y: cy, r },
    ],
  };
}

// under-body part positions in PART coordinates (1000 x 420, front = +x)
export const PART = {
  boltPos: { x: 640, y: 296 },
  oilPan: { x: 640, y: 210 },
  clipSlot: { x: 462, y: 196 },
  clipLoose: { x: 505, y: 330 },
  coverPos: { x: 400, y: 196 },
  hoseFixed: { x: 700, y: 132 },
  hoseFit: { x: 800, y: 218 },
  hoseLoose: { x: 720, y: 320 },
  exhaustGrab: { x: 300, y: 330 },
  exhaustPivot: { x: 560, y: 318 },
} as const;
