import * as THREE from 'three';
import { PALETTE, makeStandard, makeGlowTexture } from './materials.js';
import { BEAR } from '../core/layout.js';

/**
 * くまのぬいぐるみ。原点＝足元の中心。顔は +z を向く。
 * setExpression / update(時間) / squash() を持つ。
 */
export function buildBear() {
  const group = new THREE.Group();
  const inner = new THREE.Group(); // アニメ用（伸び縮み）
  group.add(inner);

  const fur = makeStandard(PALETTE.bearFur, { roughness: 0.97 });
  const muzzleMat = makeStandard(PALETTE.bearMuzzle, { roughness: 0.97 });
  const earMat = makeStandard(PALETTE.bearEar, { roughness: 0.97 });
  const dark = makeStandard(0x4a3428, { roughness: 0.6 });

  const H = BEAR.height;

  // 体
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 18), fur);
  body.scale.set(1, 1.12, 0.92);
  body.position.y = H * 0.34;
  body.castShadow = true;
  inner.add(body);

  // おなか
  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 14), muzzleMat);
  tummy.scale.set(1, 1.15, 0.6);
  tummy.position.set(0, H * 0.33, 0.075);
  inner.add(tummy);

  // 頭
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), fur);
  head.position.y = H * 0.72;
  head.castShadow = true;
  inner.add(head);

  // 耳
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), fur);
    ear.position.set(side * 0.082, H * 0.72 + 0.095, -0.01);
    ear.castShadow = true;
    inner.add(ear);
    const earIn = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), earMat);
    earIn.position.set(side * 0.08, H * 0.72 + 0.093, 0.022);
    inner.add(earIn);
  }

  // 鼻先
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), muzzleMat);
  muzzle.scale.set(1.15, 0.85, 0.8);
  muzzle.position.set(0, H * 0.69, 0.095);
  inner.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), dark);
  nose.scale.set(1.3, 0.9, 0.8);
  nose.position.set(0, H * 0.715, 0.14);
  inner.add(nose);

  // 目（まばたき・びっくりで大きさが変わる）
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), dark);
    eye.position.set(side * 0.048, H * 0.755, 0.1);
    inner.add(eye);
    eyes.push(eye);
  }

  // ほっぺ
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(
      new THREE.CircleGeometry(0.02, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9db6, transparent: true, opacity: 0.6 }),
    );
    cheek.position.set(side * 0.075, H * 0.7, 0.098);
    cheek.lookAt(cheek.position.clone().add(new THREE.Vector3(side * 0.4, 0.1, 1)));
    inner.add(cheek);
  }

  // びっくりした口（普段は隠れている）
  const mouthO = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), dark);
  mouthO.scale.set(1, 1.25, 0.4);
  mouthO.position.set(0, H * 0.665, 0.128);
  mouthO.visible = false;
  inner.add(mouthO);

  // 腕
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), fur);
    arm.scale.set(0.85, 1.5, 0.85);
    arm.position.set(side * 0.135, H * 0.42, 0.02);
    arm.rotation.z = side * -0.5;
    arm.castShadow = true;
    inner.add(arm);
    arms.push(arm);
  }

  // 脚
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), fur);
    leg.scale.set(0.9, 1.15, 1.15);
    leg.position.set(side * 0.075, 0.062, 0.035);
    leg.castShadow = true;
    inner.add(leg);
    const sole = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), muzzleMat);
    sole.scale.set(1, 0.55, 1);
    sole.position.set(side * 0.075, 0.055, 0.1);
    inner.add(sole);
  }

  // しっぽ
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), muzzleMat);
  tail.position.set(0, H * 0.3, -0.125);
  inner.add(tail);

  // やわらかい丸影
  const shadowBlob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(90,60,40,0.35)', 'rgba(90,60,40,0)'),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.y = 0.015;
  group.add(shadowBlob);

  // 「さわれるよ」の光の輪
  const pickRing = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.27, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  pickRing.rotation.x = -Math.PI / 2;
  pickRing.position.y = 0.02;
  group.add(pickRing);

  // ドラッグ判定用の見えない球（大きな当たり判定）
  const hitProxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitProxy.position.y = H * 0.5;
  group.add(hitProxy);

  let expression = 'happy';
  let squashT = -1;
  let armsUpT = -1;

  const api = {
    group,
    inner,
    hitProxy,
    pickRing,
    shadowBlob,
    get expression() {
      return expression;
    },
    setExpression(e) {
      expression = e;
      const surprised = e === 'surprised';
      mouthO.visible = surprised;
      for (const eye of eyes) {
        eye.scale.setScalar(surprised ? 1.8 : 1);
      }
      if (surprised) armsUpT = 0;
    },
    squash() {
      squashT = 0;
    },
    /** 毎フレーム呼ぶ。t=経過秒 */
    update(t, dt) {
      // ふんわり呼吸
      const breathe = 1 + Math.sin(t * 2.4) * 0.012;
      let sy = breathe;
      let sxz = 1 / Math.sqrt(breathe);

      // 置いたときのぷにっ
      if (squashT >= 0) {
        squashT += dt;
        const k = squashT / 0.38;
        if (k >= 1) squashT = -1;
        else {
          const w = Math.sin(k * Math.PI) * (1 - k) * 0.35;
          sy *= 1 - w;
          sxz *= 1 + w * 0.6;
        }
      }
      inner.scale.set(sxz, sy, sxz);

      // びっくりで両手を上げる
      if (armsUpT >= 0 && expression === 'surprised') {
        armsUpT = Math.min(1, armsUpT + dt * 6);
      } else if (expression !== 'surprised' && armsUpT > 0) {
        armsUpT = Math.max(0, armsUpT - dt * 4);
      }
      for (let i = 0; i < arms.length; i++) {
        const side = i === 0 ? -1 : 1;
        arms[i].rotation.z = side * (-0.5 - armsUpT * 1.6);
        arms[i].position.y = 0.46 * 0.42 + armsUpT * 0.04;
      }

      // まばたき
      const blink = Math.max(0, Math.sin(t * 0.7) > 0.995 ? 0.15 : 1);
      if (expression !== 'surprised') {
        for (const eye of eyes) eye.scale.y = blink;
      }

      // 「さわれるよ」リングの明滅
      pickRing.material.opacity = pickRing.visible ? 0.45 + Math.sin(t * 3.2) * 0.3 : 0;
      pickRing.rotation.z = t * 0.6;
    },
  };
  return api;
}

/** ゴースト（半透明のくまの輪郭）を作る */
export function buildBearGhost() {
  const bear = buildBear();
  // depthWrite を有効にして、重なった球がひとつの「くまのシルエット」に見えるようにする
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xa9ccf7,
    transparent: true,
    opacity: 0.5,
    depthWrite: true,
  });
  bear.group.traverse((o) => {
    if (o.isMesh) {
      o.material = ghostMat;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  bear.pickRing.visible = false;
  bear.shadowBlob.visible = false;
  bear.hitProxy.visible = false;
  // 足元の破線リングで「まえの ばしょ」を示す
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.19, 0.24, 40),
    new THREE.MeshBasicMaterial({
      color: 0x6db3ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.018;
  bear.group.add(ring);
  return bear.group;
}
