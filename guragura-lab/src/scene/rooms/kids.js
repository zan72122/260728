import * as THREE from 'three';
import { buildDesk, buildShelf, buildCushion } from '../furniture.js';

/** こども部屋の家具（机・本棚・クッション） */
export function buildKidsFurniture() {
  const group = new THREE.Group();
  group.add(buildDesk());
  group.add(buildShelf());
  group.add(buildCushion());
  return { group, handles: {} };
}
