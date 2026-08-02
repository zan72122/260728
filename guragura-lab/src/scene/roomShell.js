import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  PALETTE,
  makeStandard,
  makeRugTexture,
  makeSkyTexture,
  makePictureTexture,
} from './materials.js';

/**
 * 部屋の外殻（床・壁2面・窓・カーテン・ラグ・壁の絵）を shell 設定から生成する。
 * すべての部屋で共通のドールハウス視点（手前と右が開いている）。
 */
export function buildShell(shell) {
  const group = new THREE.Group();
  const W = shell.width;
  const D = shell.depth;
  const H = shell.wallHeight;
  const T = shell.wallThickness;

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

  const plankMat = makeStandard(PALETTE.floorEdge, { roughness: 0.95 });
  for (let i = 1; i < 7; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, D), plankMat);
    line.position.set(-W / 2 + (W / 7) * i, 0.004, 0);
    line.receiveShadow = true;
    group.add(line);
  }

  // ---- 壁 ----
  const wallMat = makeStandard(PALETTE.wall);
  const wainscotMat = makeStandard(shell.wainscot ?? PALETTE.wainscot);
  const win = shell.window;
  const zBack = -D / 2 - T / 2;

  if (win) {
    const winL = win.x - win.width / 2;
    const winR = win.x + win.width / 2;
    const winB = win.y - win.height / 2;
    const winT = win.y + win.height / 2;
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
  } else {
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), wallMat);
    back.position.set(0, H / 2, zBack);
    back.receiveShadow = true;
    group.add(back);
  }

  const left = new THREE.Mesh(new THREE.BoxGeometry(T, H, D), wallMat);
  left.position.set(-W / 2 - T / 2, H / 2, 0);
  left.receiveShadow = true;
  group.add(left);

  // 腰壁（部屋ごとのアクセント色）
  const wainH = 0.5;
  const wainBack = new THREE.Mesh(new THREE.BoxGeometry(W, wainH, 0.02), wainscotMat);
  wainBack.position.set(0, wainH / 2, -D / 2 + 0.011);
  group.add(wainBack);
  const wainLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, wainH, D), wainscotMat);
  wainLeft.position.set(-W / 2 + 0.011, wainH / 2, 0);
  group.add(wainLeft);

  // ---- 窓・カーテン ----
  const curtains = [];
  if (win) {
    const frameMat = makeStandard(PALETTE.windowFrame, { roughness: 0.7 });
    const fw = 0.07;
    const frame = new THREE.Group();
    const mkBar = (w, h, x, y) => {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, T + 0.05, 2, 0.02), frameMat);
      bar.position.set(x, y, 0);
      frame.add(bar);
    };
    mkBar(win.width + fw * 2, fw, 0, win.height / 2 + fw / 2);
    mkBar(win.width + fw * 2, fw, 0, -win.height / 2 - fw / 2);
    mkBar(fw, win.height, -win.width / 2 - fw / 2, 0);
    mkBar(fw, win.height, win.width / 2 + fw / 2, 0);
    mkBar(fw * 0.7, win.height, 0, 0);
    mkBar(win.width, fw * 0.7, 0, 0);
    frame.position.set(win.x, win.y, zBack);
    group.add(frame);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(win.width, win.height),
      new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.35 }),
    );
    glass.position.set(win.x, win.y, zBack + T / 2 + 0.001);
    group.add(glass);

    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(win.width + 1.6, win.height + 1.6),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture() }),
    );
    sky.position.set(win.x, win.y, zBack - 0.45);
    group.add(sky);

    const curtMat = makeStandard(shell.curtain ?? shell.wainscot ?? PALETTE.curtain, {
      roughness: 0.98,
    });
    for (const side of [-1, 1]) {
      const curt = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const r = 0.055 - i * 0.008;
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r + 0.02, win.height + 0.35, 10),
          curtMat,
        );
        tube.position.x = i * 0.075 * side;
        tube.castShadow = true;
        curt.add(tube);
      }
      curt.position.set(win.x + side * (win.width / 2 + 0.16), win.y + 0.06, zBack + T / 2 + 0.09);
      group.add(curt);
      curtains.push(curt);
    }
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, win.width + 0.75, 8),
      frameMat,
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(win.x, win.y + win.height / 2 + 0.22, zBack + T / 2 + 0.09);
    group.add(rail);
  }

  // ---- ラグ ----
  if (shell.rug) {
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(shell.rug.radius, 48),
      new THREE.MeshStandardMaterial({ map: makeRugTexture(shell.rug.style), roughness: 0.98 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(shell.rug.x, 0.012, shell.rug.z);
    rug.receiveShadow = true;
    group.add(rug);
  }

  // ---- 左の壁の絵 ----
  if (shell.picture) {
    const frameMat = makeStandard(PALETTE.windowFrame, { roughness: 0.7 });
    const pic = new THREE.Group();
    const picFrame = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.62, 0.62, 2, 0.02), frameMat);
    pic.add(picFrame);
    const picArt = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.52),
      new THREE.MeshBasicMaterial({ map: makePictureTexture(shell.picture) }),
    );
    picArt.rotation.y = Math.PI / 2;
    picArt.position.x = 0.035;
    pic.add(picArt);
    pic.position.set(-W / 2 + 0.02, shell.pictureAt?.y ?? 1.55, shell.pictureAt?.z ?? 0.7);
    group.add(pic);
  }

  return { group, curtains };
}
