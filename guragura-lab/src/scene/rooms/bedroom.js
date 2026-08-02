import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BED, WALL_SHELF } from '../../core/rooms/bedroom.js';
import { makeStandard, makeStarTexture } from '../materials.js';

/**
 * 寝室の家具（ベッド・壁棚・モビール）と布団。
 * 布団はくまがベッドに乗ると上にかかる（Game が動かす）。
 */
export function buildBedroomFurniture() {
  const group = new THREE.Group();

  // ---- ベッド ----
  const bed = new THREE.Group();
  const frameMat = makeStandard(0xcdb4f6, { roughness: 0.85 });
  const mattressMat = makeStandard(0xfffdf5, { roughness: 0.95 });

  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(BED.width, BED.frameH, BED.depth, 2, 0.05),
    frameMat,
  );
  frame.position.y = BED.frameH / 2;
  frame.castShadow = true;
  frame.receiveShadow = true;
  bed.add(frame);

  const mattress = new THREE.Mesh(
    new RoundedBoxGeometry(BED.width - 0.06, BED.topY - BED.frameH + 0.06, BED.depth - 0.06, 2, 0.045),
    mattressMat,
  );
  mattress.position.y = (BED.frameH + BED.topY) / 2;
  mattress.receiveShadow = true;
  bed.add(mattress);

  const headboard = new THREE.Mesh(
    new RoundedBoxGeometry(BED.width, 0.7, 0.09, 2, 0.04),
    frameMat,
  );
  headboard.position.set(0, 0.62, -BED.depth / 2 + 0.045);
  headboard.castShadow = true;
  bed.add(headboard);

  const pillow = new THREE.Mesh(
    new RoundedBoxGeometry(0.5, 0.12, 0.32, 2, 0.055),
    makeStandard(0xffe9f2, { roughness: 0.98 }),
  );
  pillow.position.set(0, BED.topY + 0.05, -BED.depth / 2 + 0.32);
  pillow.rotation.y = 0.06;
  bed.add(pillow);

  bed.position.set(BED.pos.x, 0, BED.pos.z);
  group.add(bed);

  // ---- 布団（Game が位置を制御・最初はベッドの足元にたたまれている） ----
  const futon = new THREE.Group();
  const futonMat = makeStandard(0xff9db6, { roughness: 0.98 });
  const blanket = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.24, 0.85, 3, 0.11), futonMat);
  blanket.castShadow = true;
  futon.add(blanket);
  // 白い縁どり
  const hem = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.06, 0.87, 2, 0.03), mattressMat);
  hem.position.y = -0.1;
  futon.add(hem);
  const futonHome = new THREE.Vector3(BED.pos.x, BED.topY + 0.08, BED.pos.z + BED.depth / 2 - 0.5);
  futon.position.copy(futonHome);
  futon.scale.set(1, 0.55, 0.62); // たたまれている
  group.add(futon);

  // ---- 壁棚（少し傾いている） ----
  const shelfMat = makeStandard(0xf3e3d0, { roughness: 0.85 });
  const board = new THREE.Mesh(
    new RoundedBoxGeometry(WALL_SHELF.depth, 0.036, WALL_SHELF.width, 2, 0.015),
    shelfMat,
  );
  board.position.set(WALL_SHELF.pos.x, WALL_SHELF.y, WALL_SHELF.pos.z);
  board.rotation.z = -0.07;
  board.castShadow = true;
  group.add(board);
  for (const side of [-1, 1]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(WALL_SHELF.depth * 0.7, 0.1, 0.03), shelfMat);
    bracket.position.set(
      WALL_SHELF.pos.x - 0.03,
      WALL_SHELF.y - 0.07,
      WALL_SHELF.pos.z + side * WALL_SHELF.width * 0.36,
    );
    group.add(bracket);
  }

  // ---- モビール（吊り飾り・見た目のみ） ----
  const mobile = new THREE.Group();
  const starTex = makeStarTexture('#ffe08a');
  const moonTex = makeStarTexture('#a8d8f0');
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xd9c8f2 });
  for (let i = 0; i < 3; i++) {
    const len = 0.22 + i * 0.11;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 4), stringMat);
    string.position.set((i - 1) * 0.16, -len / 2, 0);
    mobile.add(string);
    const star = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: i === 1 ? moonTex : starTex, transparent: true }),
    );
    star.scale.setScalar(0.14);
    star.position.set((i - 1) * 0.16, -len - 0.05, 0);
    mobile.add(star);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), stringMat);
  bar.rotation.x = Math.PI / 2;
  mobile.add(bar);
  mobile.position.set(BED.pos.x + 0.1, 2.15, BED.pos.z - 0.3);
  group.add(mobile);

  return { group, handles: { futon, futonHome, mobile } };
}
