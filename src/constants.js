// Shared world constants — see docs/CONTRACTS.md. Owned by the architect;
// do not edit from module tasks.
export const G = 12.5;

export const POOL = {
  RADIUS: 5.5,        // outer basin radius
  WATER_RADIUS: 5.2,  // water surface radius
  DEPTH: 3.2,         // water depth below y=0
};

export const PLATFORMS = [
  { id: 'low',  height: 2.2, tip: { x: -3.4, y: 2.2, z: 0 } },
  { id: 'mid',  height: 4.4, tip: { x: -3.4, y: 4.4, z: 0 } },
  { id: 'high', height: 7.2, tip: { x: -3.4, y: 7.2, z: 0 } },
];

export const SKY = { id: 'sky', height: 26.0, drop: { x: -1.2, y: 26.0, z: 0 } };
