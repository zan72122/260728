// Engine.js — renderer / scene / camera bootstrap.
//
// r180-only API surface (SPEC section 6): outputColorSpace (not
// outputEncoding), THREE.SRGBColorSpace (not sRGBEncoding), no
// physicallyCorrectLights/useLegacyLights toggle (physically correct
// lighting is always on).

import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';

export function createEngine(container) {
  if (!container) {
    throw new Error('createEngine(container): a mount element is required.');
  }

  if (!WebGL.isWebGL2Available()) {
    const err = new Error('WebGL2 が利用できません。ブラウザまたは端末が対応していません。');
    err.webglMessageElement = WebGL.getWebGL2ErrorMessage();
    throw err;
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const initialWidth = container.clientWidth || window.innerWidth || 1;
  const initialHeight = container.clientHeight || window.innerHeight || 1;
  renderer.setSize(initialWidth, initialHeight);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // V1 修正: render/Sky.js の SKY_BRIGHTNESS=0.13 シェーダハックを撤去した
  // ため (空自体と、そこから PMREM で焼く IBL envMap の両方を一律 87% カット
  // していた乱暴な対処 — 空が暗い青灰色に沈み、全 PBR マテリアルの陰影が
  // 死んで見えていた主因)、露出はここ一箇所だけで正しく作る。
  // addons/objects/Sky.js は太陽強度に固定定数 EE=1000 を使い、ACES で
  // 圧縮される前提の生 linear HDR を返す設計。実機スクリーンショットで
  // 0.4 は依然として白飛び気味 (finish 想定シーンで高輝度パネルが飽和) と
  // 確認したため 0.22 まで下げ、白飛び/沈みの両方が出ない値まで追い込んだ。
  renderer.toneMappingExposure = 0.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.outline = 'none';
  renderer.domElement.setAttribute('tabindex', '0');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    75,
    initialWidth / Math.max(initialHeight, 1),
    0.1,
    4000
  );
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 1, 0);

  const clock = new THREE.Clock();

  function resize() {
    const w = container.clientWidth || window.innerWidth || 1;
    const h = container.clientHeight || window.innerHeight || 1;
    if (w === 0 || h === 0) return;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
  }

  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onWindowResize);

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);
  }

  function dispose() {
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('orientationchange', onWindowResize);
    if (resizeObserver) resizeObserver.disconnect();

    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return { renderer, scene, camera, clock, resize, dispose };
}
