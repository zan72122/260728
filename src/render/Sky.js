// Sky.js — AQUA VELOCITY 大気・空・環境マップ (A4 WATER/SKY/LIGHTING)
//
// three/addons/objects/Sky.js (Preetham 大気散乱モデル) + PMREMGenerator で
// 物理的なスカイドームと IBL 環境マップを生成する。r180 は WebGLRenderer
// (SPEC/Engine.js 準拠) なので addons/objects/SkyMesh.js (WebGPU 専用の
// TSL 版) ではなく addons/objects/Sky.js を使う。
//
// 外部画像は一切使わない: Sky 自体がプロシージャルなシェーダ。
//
// V1 修正: 太陽のレンズフレア (CanvasTexture のリング数枚を addons/Lensflare
// で重ねる演出) は、タイトル画面で画面を斜めに横切るピンク/緑の巨大な虹色の
// 帯として破綻していたため撤去した。SPEC も「控えめに」としか要求しておらず、
// 演出上の必須要素ではない。ブルームは PostFX.js 側で別途かかる。

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// 夏の午後、日差しが十分に高く回った時間帯 (SPEC 4.7: 「夏の午後の斜光」)。
// V1 修正: 18° は低すぎて地平線減衰項が支配的になり、シーン全体が暗く
// 赤黒く沈む原因の一つだった。35〜45°のレンジ中央付近まで太陽を上げる。
const ELEVATION_DEG = 38;
const AZIMUTH_DEG = 145;
// V1 ラウンド2: 実機スクリーンショットで確認したところ turbidity=3/
// rayleigh=2/mie 大きめの組み合わせは、露出を絞ってもなお太陽周辺の Mie
// ハローが広く強すぎ、PostFX のブルーム+色収差と組み合わさって画面を
// 斜めに横切る虹色の帯として残った (Sky.js 自身に addons/Lensflare は
// もう存在しないので、これは Preetham シェーダ自身の太陽面/Mie 項が
// そのまま HDR で明るすぎることが原因と特定)。turbidity をやや上げて
// 大気減衰 (Fex) を強め、mie 系を絞ってハロー自体を小さく暗くする。
const TURBIDITY = 4.5;
const RAYLEIGH = 1.6;
const MIE_COEFFICIENT = 0.0025;
const MIE_DIRECTIONAL_G = 0.68;

// 前任者の修正撤廃 (V1): three/addons/objects/Sky.js は太陽強度に固定の内部
// 定数 EE=1000 (+太陽面項の *19000) を使い、Preetham モデルの物理量を
// ほぼ生の linear HDR で出力する。これは意図的な設計で、
// ACESFilmicToneMapping で最終的に圧縮される前提の値であり、
// `renderer.toneMappingExposure` で調整するのが正攻法。
// 前任者はここに `SKY_BRIGHTNESS = 0.13` という一律 87% カットのシェーダ
// パッチ (onBeforeCompile) を入れていたが、これは空の見た目だけでなく
// 下の PMREMGenerator が焼く envMap (= 全 PBR マテリアルの IBL) まで
// 一緒に握り潰してしまい、シーン全体が暗く陰影の死んだ絵になっていた
// 主因だった。物理パラメータ (turbidity/rayleigh/mie) と
// Engine.js の toneMappingExposure だけで露出を作る方針に戻す。

// V1 修正: 前は暖色 (砂色) すぎて、露出を上げると画面全体が黄土色〜ベージュに
// 転んでしまい「青空」に見えなかった。晴天の遠景ヘイズらしい、ごく淡い
// 空色寄りの白に変更 (水平線が白っぽく霞むのは残しつつ、色相を青側に)。
const FOG_COLOR = 0xcfe1ea;
const FOG_DENSITY = 0.0018;

function computeSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - ELEVATION_DEG);
  const theta = THREE.MathUtils.degToRad(AZIMUTH_DEG);
  const dir = new THREE.Vector3();
  dir.setFromSphericalCoords(1, phi, theta);
  return dir;
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
