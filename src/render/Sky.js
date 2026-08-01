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
// V1 ラウンド3 の検証結果: turbidity を 3→5.5、mieCoefficient を
// 0.0045→0.0015 まで大きく振っても、タイトル画面の虹の帯は形も色も
// ほぼ変化しなかった。addons/Lensflare は既に完全撤去済み、PostFX の
// 色収差/ブラーも V3 の実機テストで寄与ゼロと確認済み — つまりこの帯は
// Sky.js の物理パラメータにはほぼ非依存で、太陽の生 HDR 出力量が主因では
// なさそうだと判断した。turbidity を上げるほど空が白く霞んで「青空」が
// 失われる副作用の方が大きかったため、ここでは実害の無い範囲まで戻す。
// (虹の帯の残る原因は他ファイル — おそらく PostFX.js のブルーム閾値か
// TrackMaterial/WaterMaterial 側の反射 — の可能性が高く、最終報告に記載)
const TURBIDITY = 3.2;
const RAYLEIGH = 2.2;
const MIE_COEFFICIENT = 0.003;
const MIE_DIRECTIONAL_G = 0.72;

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
// 最終アートディレクション修正: 0.0018 はこのコース (全長 613m) には
// 強すぎた。three の FogExp2 は距離の2乗で効く
// (fogFactor = 1-exp(-(density*dist)^2)) ため、0.0018 だと ~300m 先で
// 既に約25%、600m 先で約70%も白く霞み、山・海・椰子が判別できなくなって
// いた (実機スクリーンショットで確認)。0.0004 だと 300m で ~2%, 600m で
// ~9%, 1000m で ~22% と、近景はクリアなまま遠景だけが自然に霞む。
const FOG_DENSITY = 0.0004;

// 最終アートディレクション修正 (確定原因・実機で切り分け済み):
// three/addons/objects/Sky.js の Preetham シェーダは太陽強度に固定定数
// EE=1000 を使い、ACES 圧縮前提の生 linear HDR (青空部分でもピーク値が
// 数十〜100+ 相当) を返す。この HDR 値は (a) 見える空ドーム自体と
// (b) 下の PMREMGenerator が焼く envMap (=全 PBR マテリアルの IBL) の
// 両方に使われる。実機で個々の要因を onBeforeCompile 経由の隔離テストで
// 切り分けた結果 (詳細はタスクノート参照):
//   - fog / toneMappingExposure 単体では白飛びは解消しない
//     (envMap を実際に切ると即座に大幅改善し、envMap を戻すと即再現)
//   - scene.environment だけを null にしても material.envMap が生きて
//     いれば無意味 (three.js は material.envMap を優先するため) — これが
//     前々回のラウンドで「envMap は無関係」と誤判定された原因
//   - material.envMapIntensity を 1.0 のスケール k で走査し、
//     k≈0.1〜0.15 + exposure 0.85〜1.0 の組で初めて「白飛びなし・
//     樋の色が見える・立体感がある」絵になった
// つまり前任者 (V1) の SKY_BRIGHTNESS=0.13 は数値としてはほぼ正しかったが、
// 露出を上げ直さなかった (0.22 のまま) ためシーン全体が暗く沈み、
// 「envMap を握り潰した」と誤って結論づけられた。ここでは同程度のスケール
// を空メッシュ側にだけ適用しつつ、Engine.js の toneMappingExposure を
// 0.22→0.95 の常識的な範囲に戻すことで、白飛びと沈みの両方を回避する。
const SKY_BRIGHTNESS = 0.12;

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

  // 空メッシュ自体の出力を SKY_BRIGHTNESS でスケールする。onBeforeCompile は
  // Material の標準フック (ShaderMaterial にも効く) — PMREMGenerator.fromScene()
  // が呼ばれる「前」にセットしておくことで、可視の空ドームと、そこから焼く
  // envMap (IBL) の両方に同じスケールが一貫してかかる。前任者の "0.13" との
  // 違いは Engine.js の toneMappingExposure を 0.22 の暗いままにせず
  // 0.95 まで戻すこと (このファイル冒頭のコメント参照)。
  sky.material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyBrightness = { value: SKY_BRIGHTNESS };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'uniform float mieDirectionalG;',
        'uniform float mieDirectionalG;\nuniform float uSkyBrightness;'
      )
      .replace(
        'gl_FragColor = vec4( retColor, 1.0 );',
        'gl_FragColor = vec4( retColor * uSkyBrightness, 1.0 );'
      );
  };
  sky.material.customProgramCacheKey = () => `aquaSky_${SKY_BRIGHTNESS}`;

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
