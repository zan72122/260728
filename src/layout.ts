import { clamp } from './gfx';
import { UW, UH } from './car';

// All layout is recomputed from the current canvas size every frame,
// so device rotation never loses state — positions are derived, not stored.

export interface GarageLayout {
  portrait: boolean;
  W: number; H: number;
  carW: number;
  carX: number;
  groundY: number;
  liftMax: number;         // px the car rises
  colX: number;            // lift column (right)
  colXL: number;           // lift column (left)
  leverX: number; leverY: number; leverTravel: number;
  mechHomeX: number;       // where the creeper waits (right of car)
  mechY: number;           // floor line for the creeper
  mechS: number;           // robot head radius
  plateX: number; plateY: number; plateR: number; // practice plate (free play)
  homeX: number; homeY: number; homeR: number;
  doorX: number;
  signY: number;
}

export function layoutGarage(W: number, H: number): GarageLayout {
  const portrait = H > W;
  const carW = portrait ? clamp(W * 0.72, 220, 430) : clamp(W * 0.46, 260, 460);
  const carX = portrait ? W * 0.45 : W * 0.40;
  const groundY = portrait ? H * 0.64 : H * 0.76;
  const liftMax = clamp(carW * 0.52, 120, portrait ? H * 0.24 : H * 0.30);
  const colX = carX + carW * 0.575;
  const colXL = carX - carW * 0.575;
  const leverX = clamp(colX + carW * 0.10, 60, W - 46);
  const leverY = groundY - carW * 0.52;
  const mechS = clamp(carW * 0.062, 13, 24);
  const mechHomeX = portrait ? clamp(carX + carW * 0.62, 0, W - mechS * 3.4) : clamp(carX + carW * 0.82, 0, W - mechS * 4);
  const mechY = portrait ? Math.min(groundY + carW * 0.30, H - mechS * 4.2) : groundY + carW * 0.13;
  return {
    portrait, W, H, carW, carX, groundY, liftMax, colX, colXL,
    leverX, leverY, leverTravel: clamp(carW * 0.22, 60, 110),
    mechHomeX, mechY, mechS,
    plateX: portrait ? W * 0.13 : W * 0.09,
    plateY: groundY - carW * 0.30,
    plateR: clamp(carW * 0.17, 46, 86),
    homeX: 44, homeY: 44, homeR: 26,
    doorX: W * 0.985,
    signY: portrait ? H * 0.16 : H * 0.16,
  };
}

export interface UnderLayout {
  portrait: boolean;
  rot: boolean;             // portrait rotates the chassis 90° so it fills the screen
  W: number; H: number;
  scale: number;
  ox: number; oy: number;   // top-left of the underbody plate in screen px
  mechX: number; mechY: number; mechS: number;
  floorY: number;           // where drips land
  grabR: number;            // generous touch radius for parts
}

export function layoutUnder(W: number, H: number): UnderLayout {
  const portrait = H > W;
  if (portrait) {
    // rotated: plate is UH wide x UW tall on screen, car front at the top
    const scale = Math.min((W * 0.94) / UH, (H * 0.70) / UW);
    const ox = (W - UH * scale) / 2;
    const oy = H * 0.04;
    const mechY = Math.min(oy + UW * scale + H * 0.13, H * 0.91);
    return {
      portrait, rot: true, W, H, scale, ox, oy,
      mechX: W * 0.5, mechY,
      mechS: clamp(Math.min(W, H) * 0.05, 14, 26),
      floorY: mechY + 10,
      grabR: clamp(Math.min(W, H) * 0.12, 46, 84),
    };
  }
  const scale = Math.min((W * 0.86) / UW, (H * 0.62) / UH);
  const ox = (W - UW * scale) / 2;
  const oy = H * 0.06;
  const mechY = H * 0.84;
  return {
    portrait, rot: false, W, H, scale, ox, oy,
    mechX: W * 0.5, mechY,
    mechS: clamp(Math.min(W, H) * 0.045, 14, 26),
    floorY: mechY + 10,
    grabR: clamp(Math.min(W, H) * 0.11, 44, 80),
  };
}

export function underToScreen(l: UnderLayout, ux: number, uy: number): { x: number; y: number } {
  if (l.rot) return { x: l.ox + uy * l.scale, y: l.oy + (UW - ux) * l.scale };
  return { x: l.ox + ux * l.scale, y: l.oy + uy * l.scale };
}

export function screenToUnder(l: UnderLayout, x: number, y: number): { x: number; y: number } {
  if (l.rot) return { x: UW - (y - l.oy) / l.scale, y: (x - l.ox) / l.scale };
  return { x: (x - l.ox) / l.scale, y: (y - l.oy) / l.scale };
}

export interface WeldLayout {
  W: number; H: number;
  bigW: number;         // car body length in px for the zoomed view
  carX: number; carGroundY: number;
  mechX: number; mechY: number; mechS: number;
}

// place the crack's local center at a comfortable screen point
export function layoutWeld(
  W: number, H: number,
  crackCenter: { u: number; v: number },
): WeldLayout {
  const portrait = H > W;
  const bigW = portrait ? W * 2.1 : Math.min(W * 1.35, H * 2.2);
  const cx = W * 0.5;
  const cy = portrait ? H * 0.36 : H * 0.40;
  const carX = cx - crackCenter.u * bigW;
  const carGroundY = cy + crackCenter.v * bigW;
  return {
    W, H, bigW, carX, carGroundY,
    mechX: portrait ? W * 0.5 : W * 0.30,
    mechY: H * 0.97,
    mechS: clamp(Math.min(W, H) * 0.055, 16, 30),
  };
}

export interface ChoiceLayout {
  btns: Array<{ id: 'again' | 'next' | 'free'; x: number; y: number; r: number }>;
}

export function layoutChoice(W: number, H: number): ChoiceLayout {
  const portrait = H > W;
  const r = clamp(Math.min(W, H) * 0.135, 52, 96);
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

// under-local coordinates of the four repairable parts
export const PART = {
  boltPos: { x: 640, y: 268 },
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
