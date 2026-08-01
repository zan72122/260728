import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM, WINDOW, RUG } from '../core/layout.js';
import {
  PALETTE,
  makeStandard,
  makeRugTexture,
  makeSkyTexture,
  makePictureTexture,
} from './materials.js';

/**
 * ドールハウス風の子ども部屋（床・壁2面・窓・カーテン・ラグ・飾り）。
 * 手前と右が開いていて、中をのぞき込む視点で遊ぶ。
 */
export function buildRoom() {
  const group = new THREE.Group();
  const W = ROOM.width;
  const D = ROOM.depth;
  const H = ROOM.wallHeight;
  const T = ROOM.wallThickness;

  // 展示台（ドールハウスの土台）
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(W + 0.9, 0.34, D + 0.9, 4, 0.14),
    makeStandard(PALETTE.base),
  );
  base.position.y = -0.21;
  base.receiveShadow = true;
  group.add(base);

  // 床
  const floor = new THREE.Mesh(
    new RoundedBoxGeometry(W + 0.24, 0.12, D + 0.24, 2, 0.05),
    makeStandard(PALETTE.floor),
  );
  floor.position.y = -0.052;
  floor.receiveShadow = true;
  group.add(floor);

  // 床板のライン（うすい細板を並べる）
  const plankMat = makeStandard(PALETTE.floorEdge, { roughness: 0.95 });
  for (let i = 1; i < 7; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, D), plankMat);
    line.position.set(-W / 2 + (W / 7) * i, 0.004, 0);
    line.receiveShadow = true;
    group.add(line);
  }

  // ---- 壁 ----
  const wallMat = makeStandard(PALETTE.wall);
  const wainscotMat = makeStandard(PALETTE.wainscot);

  // 背面の壁：窓の開口部を残して4分割で作る
  const winL = WINDOW.x - WINDOW.width / 2;
  const winR = WINDOW.x + WINDOW.width / 2;
  const winB = WINDOW.y - WINDOW.height / 2;
  const winT = WINDOW.y + WINDOW.height / 2;
  const zBack = -D / 2 - T / 2;

  const addBackSeg = (x0, x1, y0, y1) => {
    const wSeg = x1 - x0;
    const hSeg = y1 - y0;
    if (wSeg <= 0.01 || hSeg <= 0.01) return;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(wSeg, hSeg, T), wallMat);
    seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, zBack);
    seg.receiveShadow = true;
    group.add(seg);
  };
  addBackSeg(-W / 2, winL, 0, H);
  addBackSeg(winR, W / 2, 0, H);
  addBackSeg(winL, winR, 0, winB);
  addBackSeg(winL, winR, winT, H);

  // 左の壁
  const left = new THREE.Mesh(new THREE.BoxGeometry(T, H, D), wallMat);
  left.position.set(-W / 2 - T / 2, H / 2, 0);
  left.receiveShadow = true;
  group.add(left);

  // 腰壁（ピンクのアクセント）
  const wainH = 0.5;
  const wainBack = new THREE.Mesh(new THREE.BoxGeometry(W, wainH, 0.02), wainscotMat);
  wainBack.position.set(0, wainH / 2, -D / 2 + 0.011);
  group.add(wainBack);
  const wainLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, wainH, D), wainscotMat);
  wainLeft.position.set(-W / 2 + 0.011, wainH / 2, 0);
  group.add(wainLeft);

  // ---- 窓 ----
  const frameMat = makeStandard(PALETTE.windowFrame, { roughness: 0.7 });
  const fw = 0.07;
  const frame = new THREE.Group();
  const mkBar = (w, h, x, y) => {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, T + 0.05, 2, 0.02), frameMat);
    bar.position.set(x, y, 0);
    frame.add(bar);
  };
  mkBar(WINDOW.width + fw * 2, fw, 0, WINDOW.height / 2 + fw / 2);
  mkBar(WINDOW.width + fw * 2, fw, 0, -WINDOW.height / 2 - fw / 2);
  mkBar(fw, WINDOW.height, -WINDOW.width / 2 - fw / 2, 0);
  mkBar(fw, WINDOW.height, WINDOW.width / 2 + fw / 2, 0);
  mkBar(fw * 0.7, WINDOW.height, 0, 0); // 中桟
  mkBar(WINDOW.width, fw * 0.7, 0, 0);
  frame.position.set(WINDOW.x, WINDOW.y, zBack);
  group.add(frame);

  // ガラス（割れない・ただの光）
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.width, WINDOW.height),
    new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.35 }),
  );
  glass.position.set(WINDOW.x, WINDOW.y, zBack + T / 2 + 0.001);
  group.add(glass);

  // 窓の外の空
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.width + 1.6, WINDOW.height + 1.6),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture() }),
  );
  sky.position.set(WINDOW.x, WINDOW.y, zBack - 0.45);
  group.add(sky);

  // カーテン（左右・やわらかい筒形）
  const curtains = [];
  const curtMat = makeStandard(PALETTE.curtain, { roughness: 0.98 });
  for (const side of [-1, 1]) {
    const curt = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const r = 0.055 - i * 0.008;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r + 0.02, WINDOW.height + 0.35, 10),
        curtMat,
      );
      tube.position.x = i * 0.075 * side;
      tube.castShadow = true;
      curt.add(tube);
    }
    curt.position.set(
      WINDOW.x + side * (WINDOW.width / 2 + 0.16),
      WINDOW.y + 0.06,
      zBack + T / 2 + 0.09,
    );
    group.add(curt);
    curtains.push(curt);
  }
  // カーテンレール
  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, WINDOW.width + 0.75, 8),
    frameMat,
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.set(WINDOW.x, winT + 0.22, zBack + T / 2 + 0.09);
  group.add(rail);

  // ---- ラグ ----
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(RUG.radius, 48),
    new THREE.MeshStandardMaterial({ map: makeRugTexture(), roughness: 0.98 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(RUG.pos.x, 0.012, RUG.pos.z);
  rug.receiveShadow = true;
  group.add(rug);

  // ---- 左の壁の絵（にじ） ----
  const pic = new THREE.Group();
  const picFrame = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.62, 0.62, 2, 0.02), frameMat);
  pic.add(picFrame);
  const picArt = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.52),
    new THREE.MeshBasicMaterial({ map: makePictureTexture() }),
  );
  picArt.rotation.y = Math.PI / 2;
  picArt.position.x = 0.035;
  pic.add(picArt);
  pic.position.set(-W / 2 + 0.02, 1.55, 0.7);
  group.add(pic);

  return { group, curtains };
}
