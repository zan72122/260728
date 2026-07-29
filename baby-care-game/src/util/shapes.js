import * as THREE from 'three';

/** ほしのかたち（ごほうびシール用）。 */
export function makeStarGeometry(outer = 0.5, inner = 0.22, depth = 0.06) {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  geo.center();
  return geo;
}

/** うえが半円のアーチ（お城の窓・入口）。 */
export function makeArchShape(width, height) {
  const hw = width / 2;
  const straight = height - hw;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(-hw, straight);
  shape.absarc(0, straight, hw, Math.PI, 0, true);
  shape.lineTo(hw, 0);
  shape.closePath();
  return shape;
}

export function makeArchGeometry(width, height, depth = 0.08) {
  const geo = new THREE.ExtrudeGeometry(makeArchShape(width, height), { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** ハート（なでなでの演出用）。 */
export function makeHeartGeometry(size = 0.1) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.6, 0.1, 0.35, 0.72, 0, 0.42);
  s.bezierCurveTo(-0.35, 0.72, -0.6, 0.1, 0, -0.5);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  geo.center();
  geo.scale(size, size, size);
  return geo;
}
