// Car roster + crack path data (shared by game logic and the 3D renderer).

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

// Crack polylines in body-local units: u along length (-0.5..0.5, +u = front),
// v height above ground as a fraction of body length.
export function crackLocalPts(kind: CrackKind): Array<[number, number]> {
  if (kind === 'door') {
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

// resample a polyline into n evenly spaced points
export function densify(pts: Array<[number, number]>, n: number): Array<[number, number]> {
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
    const t = segLens[i] === 0 ? 0 : Math.min(1, Math.max(0, d / segLens[i]));
    out.push([
      pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
    ]);
  }
  return out;
}
