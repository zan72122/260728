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
  // 最終アートディレクション修正 (確定原因、実機の隔離テストで切り分け済み
  // — 詳細は render/Sky.js 冒頭のコメント):
  // 白飛びの主因は toneMappingExposure ではなく、Sky.js の envMap (IBL) が
  // 生 HDR のまま焼かれていたことだった (material.envMapIntensity を
  // 0〜1 でスキャンして初めて特定できた — scene.environment だけを null に
  // しても material.envMap が生きていれば無意味なので要注意)。
  // SKY_BRIGHTNESS でその発生源を直接落ち着かせたので、露出はここで
  // 常識的な範囲に戻す。0.22 のままだと今度は陰影が沈みすぎる
  // (実機確認済み: sun=0 相当まで暗くなる)。
  renderer.toneMappingExposure = 0.95;
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
