// Lighting.js — AQUA VELOCITY 太陽光・環境光 (A4 WATER/SKY/LIGHTING)
//
// DirectionalLight (太陽, PCFSoft シャドウ) + HemisphereLight (空/地面の
// 環境光)。envMap (Sky.js の PMREM) があるため AmbientLight は使わない。
//
// シャドウカメラはライダー位置に追従させて実効解像度を稼ぐ。ちらつきを
// 防ぐため、追従先の座標は「光方向に直交する安定した基底」に投影した上で
// テクセル単位にスナップしてから適用する (ワールド XYZ に対してスナップ
// すると、斜めの太陽方向では基底がずれて意味が薄れるため)。

import * as THREE from 'three';

const SUN_DISTANCE = 80;
const SHADOW_HALF_SIZE = 45; // 正射影 ±45m 程度
const SHADOW_MAP_SIZE = 2048;
const SHADOW_FAR = 320;

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} sunDirection 太陽方向 (正規化済み、シーンから太陽へ向かう向き)
 * @returns {{sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, update(dt:number, focusPos:THREE.Vector3):void}}
 */
export function createLighting(scene, sunDirection) {
  const lightDir = (sunDirection ? sunDirection.clone() : new THREE.Vector3(0.35, 0.85, 0.35)).normalize();

  // ---- 太陽 (DirectionalLight) ----
  // V1 修正: Sky.js の SKY_BRIGHTNESS=0.13 ハックを撤去して IBL を正しい
  // 明るさに戻したのに合わせ、主光源としての存在感 (はっきりした陰影・
  // ハイライト) を確保するため 3.0 → 3.4 に (SPEC 6 の「DirectionalLight
  // は 2〜4 程度が適正」の範囲内)。
  const sun = new THREE.DirectionalLight(0xfff0dd, 3.4);
  sun.position.copy(lightDir).multiplyScalar(SUN_DISTANCE);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);

  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  const shadowCam = sun.shadow.camera;
  shadowCam.left = -SHADOW_HALF_SIZE;
  shadowCam.right = SHADOW_HALF_SIZE;
  shadowCam.top = SHADOW_HALF_SIZE;
  shadowCam.bottom = -SHADOW_HALF_SIZE;
  shadowCam.near = 0.5;
  shadowCam.far = SHADOW_FAR;
  shadowCam.updateProjectionMatrix();

  scene.add(sun);

  // ---- 環境光 (空色→地面色) ----
  const hemi = new THREE.HemisphereLight(0x9fc9e8, 0x4a3d2a, 0.4);
  scene.add(hemi);

  // ---- シャドウ追従用の安定基底 (光方向は不変なので一度だけ計算) ----
  const worldUpRef = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const shadowRight = new THREE.Vector3().crossVectors(lightDir, worldUpRef).normalize();
  const shadowUp = new THREE.Vector3().crossVectors(shadowRight, lightDir).normalize();

  const texelSize = (SHADOW_HALF_SIZE * 2) / SHADOW_MAP_SIZE;

  const snappedFocus = new THREE.Vector3();
  const lightPos = new THREE.Vector3();

  /**
   * @param {number} dt
   * @param {THREE.Vector3} focusPos シャドウの解像度を集中させたい注視点 (ライダー位置)
   */
  function update(dt, focusPos) {
    if (!focusPos) return;

    // 光方向に直交する基底へ投影してからテクセル単位にスナップする
    // (ちらつき防止: ワールド軸ではなくシャドウカメラ自身の軸で丸める)
    const rightDist = focusPos.dot(shadowRight);
    const upDist = focusPos.dot(shadowUp);
    const alongDist = focusPos.dot(lightDir);

    const sRight = Math.round(rightDist / texelSize) * texelSize;
    const sUp = Math.round(upDist / texelSize) * texelSize;
    const sAlong = Math.round(alongDist / texelSize) * texelSize;

    snappedFocus
      .set(0, 0, 0)
      .addScaledVector(shadowRight, sRight)
      .addScaledVector(shadowUp, sUp)
      .addScaledVector(lightDir, sAlong);

    lightPos.copy(lightDir).multiplyScalar(SUN_DISTANCE).add(snappedFocus);

    sun.position.copy(lightPos);
    sun.target.position.copy(snappedFocus);
    sun.target.updateMatrixWorld();

    sun.shadow.camera.position.copy(lightPos);
    sun.shadow.camera.lookAt(snappedFocus);
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.camera.updateMatrixWorld();
  }

  return { sun, hemi, update };
}
