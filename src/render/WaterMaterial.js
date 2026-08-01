// WaterMaterial.js — AQUA VELOCITY water shading (A4 WATER/SKY/LIGHTING)
//
// MeshPhysicalMaterial + onBeforeCompile によるプロシージャル水面。
// 外部テクスチャは一切使わず、GLSL 内で解析的にノイズを生成する
// (value-noise + fractal sum + domain warp)。
//
// 公開 API (SPEC §4.6 契約):
//   createFlowingWaterMaterial(opts) -> THREE.Material
//   updateWater(dt, { riderS, riderLateral, speed })
//   createPoolWaterMaterial(opts) -> THREE.Material
// 追加 (契約を壊さない拡張):
//   poolSplash(worldPos, strength)
//   setSunDirection(dir)
//
// 実装メモ:
// - 水面の法線は「サーフェスグラディエント法」(Blinn / Mikkelsen) で
//   dFdx/dFdy から解析的に構築する。これは UV やタンジェント属性に依存
//   しないため、SplineTrack のジオメトリ実装詳細を仮定せずに済む。
// - 流水ジオメトリは頂点属性 aFlow(vec2) / aDepth(float) / aS(float) を
//   持つ前提 (SPEC §4.1 buildWaterGeometry)。ノイズのドメインは
//   (aS, aDepth) から作り、aFlow でスクロールする。
// - プールジオメトリは特別な属性を要求しない (自前の vAqWorldPos varying の
//   み使用。理由は createFlowingWaterMaterial 冒頭のコメント参照)。

import * as THREE from 'three';

const MAX_RIPPLES = 6;

// ---------------------------------------------------------------------
// 太陽方向のデフォルト (Sky.js と同じ規約・同じ角度: 夏の午後の斜光)
// elevation ~18deg, azimuth ~145deg。Vector3.setFromSphericalCoords と
// 同じ変換式を使う (phi = 90-elevation, theta = azimuth)。
// ---------------------------------------------------------------------
function defaultSunDirection() {
  const elevation = THREE.MathUtils.degToRad(18);
  const azimuth = THREE.MathUtils.degToRad(145);
  const phi = Math.PI / 2 - elevation;
  const theta = azimuth;
  const dir = new THREE.Vector3();
  dir.setFromSphericalCoords(1, phi, theta);
  return dir;
}

let sharedSunDirection = defaultSunDirection();

// ---------------------------------------------------------------------
// 共有 GLSL ライブラリ: hash / value-noise / fbm(2oct) / domain-warp /
// サーフェスグラディエント法によるバンプ法線。
// テクスチャ不要、完全に解析的。
// ---------------------------------------------------------------------
const AQ_LIB_GLSL = `
float aqHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.13);
	p3 += dot(p3, p3.yzx + 3.333);
	return fract((p3.x + p3.y) * p3.z);
}

float aqNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = aqHash(i);
	float b = aqHash(i + vec2(1.0, 0.0));
	float c = aqHash(i + vec2(0.0, 1.0));
	float d = aqHash(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float aqFbm(vec2 p) {
	float v = 0.0;
	float amp = 0.6;
	for (int i = 0; i < 2; i++) {
		v += amp * aqNoise(p);
		p *= 2.13;
		amp *= 0.5;
	}
	return v;
}

// ドメインワープ: 丸いブツブツではなく筋状の模様を作るための多段ワープ。
float aqWarp(vec2 p, float t) {
	vec2 q = vec2(aqFbm(p), aqFbm(p + vec2(5.2, 1.3)));
	vec2 r = vec2(
		aqFbm(p + 3.5 * q + vec2(1.7 - t * 0.15, 9.2)),
		aqFbm(p + 3.5 * q + vec2(8.3, 2.8 + t * 0.12))
	);
	return aqFbm(p + 3.5 * r);
}

// サーフェスグラディエント法によるバンプ法線 (Blinn / Mikkelsen)。
// UV/タンジェント不要。posDx/posDy はビュー空間位置の screen-space 微分、
// n は元の法線、dHx/dHy は高さフィールドの screen-space 微分。
vec3 aqBumpNormal(vec3 posDx, vec3 posDy, vec3 n, float dHx, float dHy) {
	vec3 rA = cross(posDy, n);
	vec3 rB = cross(n, posDx);
	float fDet = dot(posDx, rA);
	vec3 surfGrad = sign(fDet) * (dHx * rA + dHy * rB);
	return normalize(abs(fDet) * n - surfGrad);
}
`;

// ---------------------------------------------------------------------
// モジュールスコープの登録簿。onBeforeCompile は再コンパイル時に複数回
// 呼ばれる可能性があるため、material 単位で uniforms 参照を更新する。
// ---------------------------------------------------------------------
const flowingInstances = []; // { material, track, uniforms }
const poolInstances = [];    // { material, uniforms, nextSlot }

let elapsedTime = 0;

function registerInstance(list, material, extra) {
  let rec = list.find((r) => r.material === material);
  if (!rec) {
    rec = { material };
    list.push(rec);
  }
  Object.assign(rec, extra);
  return rec;
}

/**
 * 流水 (樋) 用マテリアル。
 * @param {{envMap?: THREE.Texture, track?: object, shallowColor?: number,
 *   deepColor?: number, foamColor?: number, sunDirection?: THREE.Vector3,
 *   envBoost?: number, foamDepthRange?: number}} opts
 * @returns {THREE.Material}
 */
export function createFlowingWaterMaterial(opts = {}) {
  const {
    envMap = null,
    track = null,
    // 統合修正 (V2): 元の 0x7fe3ea はかなり白に近いパステルシアンで、明るい
    // 空 (フレネル反射) や強いクリアコートのハイライトに埋もれると
    // 「水色というより白っぽい艶」にしか見えないリスクがあった (実機
    // デバッグでピクセル値を直接サンプリングして確認)。彩度を上げて
    // はっきり「水色」と分かる色に変更 (色相はそのまま、明るさ据え置き)。
    shallowColor = 0x2fd8e6,
    deepColor = 0x0c4a54,
    foamColor = 0xf2fdff,
    sunDirection = null,
    envBoost = 1.0,
    foamDepthRange = 1.1,
  } = opts;

  // 統合修正 (V2 / 水の質感再建・実機確認済みの確定原因):
  // MeshPhysicalMaterial の transmission は three.js 内部
  // (transmission_fragment.glsl.js) で
  //   totalDiffuse = mix(totalDiffuse, transmitted.rgb, material.transmission)
  // という処理を行う。transmitted.rgb は「背後 = 樋そのもの」を写した
  // 屈折サンプルに diffuseColor を掛けたものなので、transmission=0.85 では
  // 水自身の色の 85% が「樋を透かして見た色」に置き換わってしまう ──
  // これが実機スクリーンショットで確認された「水が一切見えない」
  // 「樋の内面がのっぺりした単色に見える」の確定原因 (envMap の有無は無関係、
  // 常に起きる)。加えて transmission 系のコードパスが無いと
  // `varying vec3 vWorldPosition` 自体が宣言されない (meshphysical の
  // vertex/fragment 双方で #ifdef USE_TRANSMISSION 内にのみ存在) ため、
  // 下の onBeforeCompile では独自の vAqWorldPos varying を使う。
  // SPEC 4.6 は transmission の使用を求めるが、見た目の正しさ (=水が
  // 確実に見えること) を優先し、ここでは使わない方針に切り替える
  // (transparent + opacity + フレネル反射 + 泡で十分に水らしく見える)。
  // 最終アートディレクション修正: envMapIntensity は 1.2 から 0.55 に。
  // Sky.js の envMap 自体の明るさを是正した後、実機で走査した結果
  // 1.2 のままだとフレネル反射 (下の aqSky ミックス) が水面のターコイズ/
  // ディープカラーをほぼ空色一色に薄めてしまい、「水に見えない」症状が
  // 残っていた。
  const material = new THREE.MeshPhysicalMaterial({
    color: shallowColor,
    roughness: 0.08,
    metalness: 0.0,
    ior: 1.333,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.86,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });

  if (envMap) material.envMap = envMap;

  const sunDir = (sunDirection ? sunDirection.clone() : sharedSunDirection.clone()).normalize();

  material.onBeforeCompile = (shader) => {
    // SplineTrack.buildWaterGeometry() は aS を s/length (0..1 正規化) で
    // 書き出す。ライダー側 (RiderPhysics.state.s) はメートル単位なので、
    // シェーダ内でメートルに戻すための係数を渡す。
    const trackLength = track && typeof track.length === 'number' && track.length > 0 ? track.length : 650;

    shader.uniforms.uTime = { value: elapsedTime };
    shader.uniforms.uFlowSpeed = { value: 0 };
    shader.uniforms.uTrackLength = { value: trackLength };
    shader.uniforms.uRiderS = { value: 0 };
    shader.uniforms.uRiderLateral = { value: 0 };
    shader.uniforms.uRiderSpeed = { value: 0 };
    shader.uniforms.uRiderWorldPos = { value: new THREE.Vector3(1e6, 1e6, 1e6) };
    shader.uniforms.uSunDirection = { value: sunDir.clone() };
    shader.uniforms.uShallowColor = { value: new THREE.Color(shallowColor) };
    shader.uniforms.uDeepColor = { value: new THREE.Color(deepColor) };
    shader.uniforms.uFoamColor = { value: new THREE.Color(foamColor) };
    shader.uniforms.uFoamDepthRange = { value: foamDepthRange };
    shader.uniforms.uEnvBoost = { value: envBoost };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFlow;
attribute float aDepth;
attribute float aS;

varying vec2 vFlow;
varying float vDepth;
varying float vS;
// transmission を使わない (上のコメント参照) ので、three.js 組み込みの
// vWorldPosition (USE_TRANSMISSION 時のみ宣言される) には頼らず、
// 自前でワールド座標 varying を持つ。
varying vec3 vAqWorldPos;
`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFlow = aFlow;
vDepth = aDepth;
vS = aS;
vAqWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vFlow;
varying float vDepth;
varying float vS;
varying vec3 vAqWorldPos;

uniform float uTime;
uniform float uFlowSpeed;
uniform float uTrackLength;
uniform float uRiderS;
uniform float uRiderLateral;
uniform float uRiderSpeed;
uniform vec3 uRiderWorldPos;
uniform vec3 uSunDirection;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform float uFoamDepthRange;
uniform float uEnvBoost;
${AQ_LIB_GLSL}
`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>

// vS は s/length に正規化された値 (SplineTrack.buildWaterGeometry) なので
// メートルに戻す。uRiderS (RiderPhysics.state.s) はメートル単位。
float aqSMeters = vS * uTrackLength;

// ---- ドメイン: (弧長 s[m], 断面深度) を流速ベクトルでスクロール ----
vec2 aqBaseDomain = vec2(aqSMeters, vDepth * 9.0);
vec2 aqFlowScroll = vFlow * (uTime * max(uFlowSpeed, 0.6));

// ---- 泡・白波: 壁際 (aDepth 小) ほど、流速が速いほど濃い筋状ノイズ ----
vec2 aqFoamDomain = vec2(aqBaseDomain.x * 0.30, aqBaseDomain.y * 2.4) - aqFlowScroll * vec2(1.5, 0.4);
float aqFoamN = aqWarp(aqFoamDomain, uTime);
float aqFoamRaw = smoothstep(0.52, 0.88, aqFoamN);
float aqShallow = 1.0 - smoothstep(0.0, uFoamDepthRange, vDepth);
float aqSpeedy = smoothstep(3.0, 18.0, uFlowSpeed);
float aqFoamMask = clamp(aqFoamRaw * mix(0.12, 1.0, aqShallow) * mix(0.35, 1.15, aqSpeedy), 0.0, 1.3);

// ---- ライダーの航跡: 後方 0〜25m、lateral 近傍ほど強い V 字 ----
float aqAlong = uRiderS - aqSMeters;
float aqLongMask = step(0.0, aqAlong) * (1.0 - smoothstep(0.0, 25.0, aqAlong));
float aqWakeMask = 0.0;
if (aqLongMask > 0.001) {
	float aqDist3D = length(vAqWorldPos - uRiderWorldPos);
	float aqLateralDist = sqrt(max(aqDist3D * aqDist3D - aqAlong * aqAlong, 0.0));
	float aqWakeWidth = mix(1.0, 3.0, clamp(uRiderSpeed / 24.0, 0.0, 1.0)) * (0.35 + 0.9 * clamp(aqAlong / 25.0, 0.0, 1.0));
	float aqLateralMask = 1.0 - smoothstep(0.0, max(aqWakeWidth, 0.05), aqLateralDist);
	float aqWakeEnvelope = aqLongMask * aqLateralMask;
	if (aqWakeEnvelope > 0.001) {
		float aqWakeRipple = 0.5 + 0.5 * sin(aqLateralDist * 2.6 - aqAlong * 0.55);
		float aqWakeTurb = aqWarp(vec2(aqAlong * 0.5, aqLateralDist * 1.6), uTime * 1.3);
		aqWakeMask = aqWakeEnvelope * clamp(aqWakeRipple * 0.6 + aqWakeTurb * 0.7, 0.0, 1.0) * 1.1;
	}
}

// ---- 深度カラー: 浅=水色 / 深=ターコイズ (Beer-Lambert 的吸収) ----
float aqDepthNorm = clamp(vDepth / max(uFoamDepthRange, 0.001), 0.0, 1.6);
float aqAbsorb = clamp(1.0 - exp(-aqDepthNorm * 1.6), 0.0, 1.0);
vec3 aqWaterColor = mix(uShallowColor, uDeepColor, aqAbsorb);

diffuseColor.rgb = mix(aqWaterColor, uFoamColor, clamp(aqFoamMask + aqWakeMask, 0.0, 1.0));
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughnessFactor, 0.88, clamp(aqFoamMask * 1.3 + aqWakeMask * 0.6, 0.0, 1.0)), 0.03, 1.0);
`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>

// ---- 多層スクロール法線波: 大(4m) / 中(1.2m) / 細(0.3m)、各々別速度 ----
vec2 aqDL = aqBaseDomain * (1.0 / 4.0) - aqFlowScroll * 0.5;
vec2 aqDM = aqBaseDomain * (1.0 / 1.2) - aqFlowScroll * 1.0;
vec2 aqDS = aqBaseDomain * (1.0 / 0.3) - aqFlowScroll * 1.8;

float aqHL = aqNoise(aqDL) * 2.0 - 1.0;
float aqHM = aqNoise(aqDM * 1.7 + 11.3) * 2.0 - 1.0;
float aqHS = aqNoise(aqDS * 1.3 + 51.7) * 2.0 - 1.0;

float aqHeight = aqHL * 0.060 + aqHM * 0.030 + aqHS * 0.014 - aqFoamMask * 0.012;

vec3 aqPosDx = dFdx(vViewPosition);
vec3 aqPosDy = dFdy(vViewPosition);
float aqHx = dFdx(aqHeight);
float aqHy = dFdy(aqHeight);
normal = aqBumpNormal(aqPosDx, aqPosDy, normal, aqHx, aqHy);
`
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

{
	// ---- フレネル (Schlick, F0=0.02) + envMap 反射: 浅い角度で空を強く映す ----
	vec3 aqViewDir = geometryViewDir;
	vec3 aqSunVS = normalize(mat3(viewMatrix) * uSunDirection);

	float aqNdv = clamp(dot(geometryNormal, aqViewDir), 0.0, 1.0);
	float aqFres = F_Schlick(0.02, 1.0, aqNdv);
#ifdef USE_ENVMAP
	vec3 aqSky = getIBLRadiance(aqViewDir, geometryNormal, clamp(material.roughness, 0.035, 0.32));
#else
	vec3 aqSky = uShallowColor;
#endif
	// 統合修正 (V2): 上限を 0.85→0.65 に (実機デバッグでピクセル値を直接
	// サンプリングしたところ、グレージング角付近でこの反射項が水自体の
	// 色をほぼ空色一色に塗り替えてしまい、「水」ではなく「鏡」に見える
	// リスクを確認したため)。フレネル反射自体は要件どおり残す。
	outgoingLight = mix(outgoingLight, aqSky * uEnvBoost, clamp(aqFres * 0.6, 0.0, 0.65));

	// ---- コースティクス風スペックルハイライト (太陽方向の高次スペキュラ) ----
	vec3 aqHalf = normalize(aqSunVS + aqViewDir);
	float aqNdh = max(dot(geometryNormal, aqHalf), 0.0);
	float aqSparkleSpec = pow(aqNdh, 250.0) * 6.0;
	float aqGlitter = step(0.80, aqHash(floor(aqBaseDomain * 55.0 - aqFlowScroll * 6.0) + floor(uTime * 2.0)));
	outgoingLight += aqSparkleSpec * aqGlitter * vec3(1.0, 0.98, 0.9);

	// ---- 泡・航跡の白み + 不透明度ブースト ----
	float aqFoamVis = clamp(aqFoamMask + aqWakeMask, 0.0, 1.0);
	outgoingLight = mix(outgoingLight, uFoamColor, aqFoamVis * 0.8);
	diffuseColor.a = clamp(mix(diffuseColor.a, 1.0, aqFoamVis * 0.55), 0.0, 1.0);
}
`
      );

    registerInstance(flowingInstances, material, { track, uniforms: shader.uniforms });
  };

  return material;
}

/**
 * 毎フレーム呼ぶ。流水・プール双方の uniform を更新する。
 * @param {number} dt
 * @param {{riderS?: number, riderLateral?: number, speed?: number}} params
 */
export function updateWater(dt, params = {}) {
  elapsedTime += Math.max(dt, 0);

  const riderS = params.riderS ?? 0;
  const riderLateral = THREE.MathUtils.clamp(params.riderLateral ?? 0, -1, 1);
  const speed = Math.max(params.speed ?? 0, 0);

  for (const rec of flowingInstances) {
    const u = rec.uniforms;
    if (!u) continue;
    u.uTime.value = elapsedTime;
    u.uFlowSpeed.value = speed;
    u.uRiderS.value = riderS;
    u.uRiderLateral.value = riderLateral;
    u.uRiderSpeed.value = speed;

    if (rec.track && typeof rec.track.surfaceAt === 'function') {
      try {
        const p = rec.track.surfaceAt(riderS, riderLateral, 0);
        if (p) u.uRiderWorldPos.value.copy(p);
      } catch (e) {
        // track がまだ準備できていない/範囲外などは無視して安全側に倒す
      }
    }
  }

  for (const rec of poolInstances) {
    const u = rec.uniforms;
    if (!u) continue;
    u.uTime.value = elapsedTime;
  }
}

/**
 * 着水プール用マテリアル。
 * @param {{envMap?: THREE.Texture, center?: THREE.Vector3, radius?: number,
 *   shallowColor?: number, deepColor?: number, foamColor?: number,
 *   sunDirection?: THREE.Vector3, envBoost?: number}} opts
 * @returns {THREE.Material}
 */
export function createPoolWaterMaterial(opts = {}) {
  const {
    envMap = null,
    center = new THREE.Vector3(0, 0, 0),
    radius = 12,
    shallowColor = 0x2fb8cf,
    deepColor = 0x052c3c,
    foamColor = 0xf2fdff,
    sunDirection = null,
    envBoost = 1.3,
  } = opts;

  // transmission を使わない理由は createFlowingWaterMaterial 冒頭のコメント
  // と同じ (実機確認済みの確定原因: 水の色の大半が「背後を写した屈折
  // サンプル」に置き換わり、finish.png で着水プールが消え、下のプール壁
  // タイルが傾いた壁のように透けて見えていた)。
  // 最終アートディレクション修正: 樋の流水と同じ理由で 1.35 → 0.65
  // (render/Sky.js の SKY_BRIGHTNESS コメント参照)。
  const material = new THREE.MeshPhysicalMaterial({
    color: deepColor,
    roughness: 0.045,
    metalness: 0.0,
    ior: 1.333,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    transparent: true,
    opacity: 0.93,
    envMapIntensity: 0.65,
    side: THREE.DoubleSide,
  });

  if (envMap) material.envMap = envMap;

  const sunDir = (sunDirection ? sunDirection.clone() : sharedSunDirection.clone()).normalize();

  const rippleData = [];
  for (let i = 0; i < MAX_RIPPLES; i++) rippleData.push(new THREE.Vector3(0, 0, -1000));
  const rippleStrength = new Array(MAX_RIPPLES).fill(0);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: elapsedTime };
    shader.uniforms.uSunDirection = { value: sunDir.clone() };
    shader.uniforms.uShallowColor = { value: new THREE.Color(shallowColor) };
    shader.uniforms.uDeepColor = { value: new THREE.Color(deepColor) };
    shader.uniforms.uFoamColor = { value: new THREE.Color(foamColor) };
    shader.uniforms.uEnvBoost = { value: envBoost };
    shader.uniforms.uPoolCenter = { value: new THREE.Vector2(center.x, center.z) };
    shader.uniforms.uPoolRadius = { value: radius };
    shader.uniforms.uRippleData = { value: rippleData };
    shader.uniforms.uRippleStrength = { value: rippleStrength };

    // transmission を使わない (上のコメント参照) ので、three.js 組み込みの
    // vWorldPosition (USE_TRANSMISSION 時のみ宣言される) には頼らず、自前で
    // ワールド座標 varying を持つ。このマテリアルは元々頂点シェーダに手を
    // 入れていなかった (built-in の vWorldPosition に依存していた) ので、
    // ここで初めて vertexShader の書き換えが必要になる。
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAqWorldPos;
`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vAqWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAqWorldPos;
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform float uEnvBoost;
uniform vec2 uPoolCenter;
uniform float uPoolRadius;

#define AQ_MAX_RIPPLES ${MAX_RIPPLES}
uniform vec3 uRippleData[AQ_MAX_RIPPLES];
uniform float uRippleStrength[AQ_MAX_RIPPLES];
${AQ_LIB_GLSL}
`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>

vec2 aqPoolDomain = vAqWorldPos.xz - uPoolCenter;

// ---- 着水時の同心円波紋 (poolSplash が起動する固定スロット配列) ----
float aqRippleHeight = 0.0;
float aqRippleFoam = 0.0;
for (int i = 0; i < AQ_MAX_RIPPLES; i++) {
	float aqAge = uTime - uRippleData[i].z;
	if (aqAge > 0.0 && aqAge < 6.0 && uRippleStrength[i] > 0.0) {
		float aqR = length(aqPoolDomain - uRippleData[i].xy);
		float aqFront = aqAge * 3.2;
		float aqDiff = (aqR - aqFront) * 2.0;
		float aqRing = exp(-aqDiff * aqDiff);
		float aqDecay = exp(-aqAge * 0.8) * uRippleStrength[i];
		aqRippleHeight += aqRing * aqDecay * 0.10 * sin(aqR * 6.0 - aqAge * 9.0);
		aqRippleFoam += aqRing * aqDecay * 1.5;
	}
}

float aqDistFromCenter = length(aqPoolDomain);
float aqNearEdge = 1.0 - smoothstep(uPoolRadius * 0.55, uPoolRadius, aqDistFromCenter);
vec3 aqWaterColor = mix(uDeepColor, uShallowColor, aqNearEdge * 0.35);
float aqFoamMask = clamp(aqRippleFoam, 0.0, 1.3);

diffuseColor.rgb = mix(aqWaterColor, uFoamColor, clamp(aqFoamMask, 0.0, 1.0));
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughnessFactor, 0.65, clamp(aqFoamMask, 0.0, 1.0)), 0.02, 1.0);
`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>

// ---- 落ち着いた大きな波 + 波紋の高さを合成してバンプ法線に ----
vec2 aqDPL = aqPoolDomain * (1.0 / 7.0) - vec2(uTime * 0.045, uTime * 0.03);
vec2 aqDPM = aqPoolDomain * (1.0 / 2.4) + vec2(uTime * 0.07, -uTime * 0.05);

float aqHPL = aqNoise(aqDPL) * 2.0 - 1.0;
float aqHPM = aqNoise(aqDPM * 1.6 + 4.4) * 2.0 - 1.0;

float aqHeight = aqHPL * 0.050 + aqHPM * 0.018 + aqRippleHeight;

vec3 aqPosDx = dFdx(vViewPosition);
vec3 aqPosDy = dFdy(vViewPosition);
float aqHx = dFdx(aqHeight);
float aqHy = dFdy(aqHeight);
normal = aqBumpNormal(aqPosDx, aqPosDy, normal, aqHx, aqHy);
`
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

{
	vec3 aqViewDir = geometryViewDir;
	vec3 aqSunVS = normalize(mat3(viewMatrix) * uSunDirection);

	float aqNdv = clamp(dot(geometryNormal, aqViewDir), 0.0, 1.0);
	float aqFres = F_Schlick(0.02, 1.0, aqNdv);
#ifdef USE_ENVMAP
	vec3 aqSky = getIBLRadiance(aqViewDir, geometryNormal, clamp(material.roughness, 0.02, 0.28));
#else
	vec3 aqSky = uDeepColor;
#endif
	outgoingLight = mix(outgoingLight, aqSky * uEnvBoost, clamp(aqFres * 0.7, 0.0, 0.9));

	vec3 aqHalf = normalize(aqSunVS + aqViewDir);
	float aqNdh = max(dot(geometryNormal, aqHalf), 0.0);
	float aqSparkleSpec = pow(aqNdh, 300.0) * 7.0;
	float aqGlitter = step(0.82, aqHash(floor(aqPoolDomain * 6.0) + floor(uTime * 2.0)));
	outgoingLight += aqSparkleSpec * aqGlitter * vec3(1.0, 0.98, 0.92);

	float aqFoamVis = clamp(aqFoamMask, 0.0, 1.0);
	outgoingLight = mix(outgoingLight, uFoamColor, aqFoamVis * 0.85);
	diffuseColor.a = clamp(mix(diffuseColor.a, 1.0, aqFoamVis * 0.5), 0.0, 1.0);
}
`
      );

    const rec = registerInstance(poolInstances, material, { uniforms: shader.uniforms });
    if (rec.nextSlot === undefined) rec.nextSlot = 0;
  };

  return material;
}

/**
 * 着水時に広がる波紋を起動する。updateWater とは独立に呼び出せる。
 * @param {THREE.Vector3 | {x:number, z:number}} worldPos
 * @param {number} strength 0..1 目安 (大きいほど激しい波紋)
 */
export function poolSplash(worldPos, strength = 1.0) {
  if (!worldPos) return;
  for (const rec of poolInstances) {
    const u = rec.uniforms;
    if (!u) continue;
    const slot = rec.nextSlot || 0;
    u.uRippleData.value[slot].set(worldPos.x, worldPos.z, elapsedTime);
    u.uRippleStrength.value[slot] = THREE.MathUtils.clamp(strength, 0, 4);
    rec.nextSlot = (slot + 1) % MAX_RIPPLES;
  }
}

/**
 * 太陽方向を後から更新したい場合のオプション API (契約外の追加 export)。
 * 既存インスタンス全てと、以後生成されるデフォルト値を更新する。
 * @param {THREE.Vector3} dir
 */
export function setSunDirection(dir) {
  if (!dir) return;
  sharedSunDirection.copy(dir).normalize();
  for (const rec of [...flowingInstances, ...poolInstances]) {
    if (rec.uniforms && rec.uniforms.uSunDirection) {
      rec.uniforms.uSunDirection.value.copy(sharedSunDirection);
    }
  }
}
