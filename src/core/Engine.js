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
    stencil: false,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const initialWidth = container.clientWidth || window.innerWidth || 1;
  const initialHeight = container.clientHeight || window.innerHeight || 1;
  renderer.setSize(initialWidth, initialHeight);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
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
