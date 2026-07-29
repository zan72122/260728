import * as THREE from 'three';

const OUTLINE_COLOR = 0x9c8570;

/**
 * 背面ポリゴンをすこし膨らませて描く、いちばん軽い輪郭線。
 * 主役（赤ちゃん）まわりだけに使い、部屋には使わない。
 */
export function addOutline(mesh, scale = 1.05) {
  const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  const outline = new THREE.Mesh(mesh.geometry, mat);
  outline.scale.setScalar(scale);
  outline.renderOrder = -1;
  outline.userData.isOutline = true;
  outline.raycast = () => {}; // 輪郭線はタッチ判定に入れない
  mesh.add(outline);
  return outline;
}

/** グループ以下のメッシュすべてに輪郭線を付ける。 */
export function outlineAll(group, scale = 1.05) {
  const targets = [];
  group.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline) targets.push(o);
  });
  targets.forEach((m) => addOutline(m, scale));
}
