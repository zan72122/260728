import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TV_STAND, SOFA } from '../../core/rooms/living.js';
import { PALETTE, makeStandard } from '../materials.js';

/** リビングの家具（テレビ台・ソファ）。飾り棚は転倒家具として別で作られる。 */
export function buildLivingFurniture() {
  const group = new THREE.Group();

  // ---- テレビ台 ----
  const stand = new THREE.Group();
  const woodMat = makeStandard(PALETTE.deskWood, { roughness: 0.8 });
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(TV_STAND.size.x, TV_STAND.size.y, TV_STAND.size.z, 2, 0.035),
    woodMat,
  );
  body.position.y = TV_STAND.size.y / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  stand.add(body);
  // 引き出し風の前面
  for (const side of [-1, 1]) {
    const front = new THREE.Mesh(
      new RoundedBoxGeometry(TV_STAND.size.x * 0.42, TV_STAND.size.y * 0.55, 0.025, 1, 0.012),
      makeStandard(0xfdf6ec, { roughness: 0.9 }),
    );
    front.position.set(side * TV_STAND.size.x * 0.23, TV_STAND.size.y * 0.45, TV_STAND.size.z / 2 + 0.005);
    stand.add(front);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 10, 8),
      makeStandard(0x53b7f6, { roughness: 0.6 }),
    );
    knob.position.set(side * TV_STAND.size.x * 0.23, TV_STAND.size.y * 0.45, TV_STAND.size.z / 2 + 0.03);
    stand.add(knob);
  }
  stand.position.set(TV_STAND.pos.x, 0, TV_STAND.pos.z);
  group.add(stand);

  // ---- ソファ ----
  const sofa = new THREE.Group();
  const sofaMat = makeStandard(0xa8e6cf, { roughness: 0.97 });
  const cushMat = makeStandard(0xbff0dd, { roughness: 0.98 });

  const base = new THREE.Mesh(
    new RoundedBoxGeometry(SOFA.width, SOFA.seatY, SOFA.depth, 2, 0.07),
    sofaMat,
  );
  base.position.y = SOFA.seatY / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  sofa.add(base);

  // 座面クッション2枚
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(
      new RoundedBoxGeometry(SOFA.width - 0.16, 0.12, SOFA.depth / 2 - 0.18, 2, 0.05),
      cushMat,
    );
    seat.position.set(-0.04, SOFA.seatY + 0.02, side * (SOFA.depth / 4 - 0.05));
    seat.receiveShadow = true;
    sofa.add(seat);
  }

  const back = new THREE.Mesh(
    new RoundedBoxGeometry(0.26, 0.72, SOFA.depth, 2, 0.09),
    sofaMat,
  );
  back.position.set(SOFA.width / 2 - 0.11, SOFA.seatY + 0.18, 0);
  back.castShadow = true;
  sofa.add(back);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new RoundedBoxGeometry(SOFA.width, 0.24, 0.22, 2, 0.09),
      sofaMat,
    );
    arm.position.set(0, SOFA.seatY + 0.09, side * (SOFA.depth / 2 - 0.09));
    arm.castShadow = true;
    sofa.add(arm);
  }
  sofa.position.set(SOFA.pos.x, 0, SOFA.pos.z);
  group.add(sofa);

  return { group, handles: {} };
}
