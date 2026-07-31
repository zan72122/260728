// Sky.js — AQUA VELOCITY 大気・空・環境マップ (A4 WATER/SKY/LIGHTING)
//
// three/addons/objects/Sky.js (Preetham 大気散乱モデル) + PMREMGenerator で
// 物理的なスカイドームと IBL 環境マップを生成する。r180 は WebGLRenderer
// (SPEC/Engine.js 準拠) なので addons/objects/SkyMesh.js (WebGPU 専用の
// TSL 版) ではなく addons/objects/Sky.js を使う。
//
// 外部画像は一切使わない: Sky 自体がプロシージャルなシェーダ、
// レンズフレアの模様も CanvasTexture で自前生成する。

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// 夏の午後の斜光
const ELEVATION_DEG = 18;
const AZIMUTH_DEG = 145;
const TURBIDITY = 3;
const RAYLEIGH = 1.4;
const MIE_COEFFICIENT = 0.005;
const MIE_DIRECTIONAL_G = 0.82;

const FOG_COLOR = 0xdccdaa; // 空に近い暖色系のヘイズ
const FOG_DENSITY = 0.0018;

function computeSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - ELEVATION_DEG);
  const theta = THREE.MathUtils.degToRad(AZIMUTH_DEG);
  const dir = new THREE.Vector3();
  dir.setFromSphericalCoords(1, phi, theta);
  return dir;
}

// ---- プロシージャルなレンズフレア用テクスチャ (CanvasTexture) ----
function makeGlowTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.18, 'rgba(255,245,220,0.95)');
  grad.addColorStop(0.45, 'rgba(255,224,170,0.28)');
  grad.addColorStop(1.0, 'rgba(255,220,160,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeRingTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, r * 0.25, r, r, r * 0.5);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.55, 'rgba(210,232,255,0.55)');
  grad.addColorStop(0.8, 'rgba(210,232,255,0.18)');
  grad.addColorStop(1.0, 'rgba(210,232,255,0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function addLensflare(scene, sunDirection) {
  try {
    const lensflare = new Lensflare();
    const glow = makeGlowTexture(256);
    const ring = makeRingTexture(128);

    lensflare.addElement(new LensflareElement(glow, 340, 0.0, new THREE.Color(0xfff4dd)));
    lensflare.addElement(new LensflareElement(ring, 55, 0.32, new THREE.Color(0xbfe0ff)));
    lensflare.addElement(new LensflareElement(ring, 28, 0.58, new THREE.Color(0xffe6c0)));
    lensflare.addElement(new LensflareElement(ring, 85, 0.88, new THREE.Color(0xffffff)));
    lensflare.addElement(new LensflareElement(ring, 18, 1.0, new THREE.Color(0xbfe0ff)));

    const sunDistance = 3500;
    lensflare.position.copy(sunDirection).multiplyScalar(sunDistance);
    scene.add(lensflare);
    return lensflare;
  } catch (e) {
    // レンズフレアは演出上のオプション。失敗しても Sky 全体は成立させる。
    return null;
  }
}

/**
 * 物理ベースの空 + IBL 環境マップを構築する。
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @returns {{sky: THREE.Object3D, sunDirection: THREE.Vector3, envMap: THREE.Texture, update(dt:number):void}}
 */
export function createSky(scene, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  sky.renderOrder = -1000;
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = TURBIDITY;
  skyUniforms['rayleigh'].value = RAYLEIGH;
  skyUniforms['mieCoefficient'].value = MIE_COEFFICIENT;
  skyUniforms['mieDirectionalG'].value = MIE_DIRECTIONAL_G;

  const sunDirection = computeSunDirection();
  skyUniforms['sunPosition'].value.copy(sunDirection);

  // ---- PMREM: 空自体をレンダリングして IBL 環境マップを生成 ----
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envRenderTarget = pmremGenerator.fromScene(sky, 0.035, 0.1, 1000);
  const envMap = envRenderTarget.texture;
  pmremGenerator.dispose();

  scene.environment = envMap;

  // ---- 太陽のレンズフレア (控えめ) ----
  addLensflare(scene, sunDirection);

  // ---- 遠景の大気感: 近景をぼやけさせない程度の薄い FogExp2 ----
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  let elapsed = 0;

  /**
   * 毎フレーム呼ぶ (負荷が気になる場合は省略可能な演出のみ)。
   * ここでは turbidity をごく僅かに揺らして、雲のゆっくりした
   * 変化に近い大気の呼吸感を安価に表現する。
   */
  function update(dt) {
    elapsed += dt;
    const wobble = Math.sin(elapsed * 0.045) * 0.12 + Math.sin(elapsed * 0.011) * 0.08;
    skyUniforms['turbidity'].value = TURBIDITY + wobble;
  }

  return { sky, sunDirection, envMap, update };
}
