// js/gl/glrenderer.js — Agent K
// GLDoughRenderer: WebGL1 で生地を「リアル寄りのおいしそうな質感」で描く。
// SPEC-GL.md の Agent K セクション厳守。攻略ポイントは1点:
//   このファイルのフラグメントシェーダが「単色のゼリー玉」を「パンに見える」に変える。
//
// 依存: Agent J の js/gl/mesh.js が生成する DoughMesh の配列レイアウトのみ
//   (positions vec3 / normals vec3 / extras vec4[rho,toppingMask,grooveDepth,edgeAO] / Uint16 indices)。
// このファイルは DoughMesh を import しない（契約は配列形状のみ、実装に依存しない）。
//
// マテリアル設計の要点 (最終報告にも記載):
//   - ラップ拡散 (柔らかい回り込み) + 擬似SSS (生地ほど暖色が影側に透ける)
//   - リムライト (縁の淡いクリーム色ハイライト)
//   - Blinn-Phong スペキュラ (焼けるほど強く鋭く、ノイズでムラ)
//   - 3段焼き色ランプ (base → golden → 焦げ縁) を「曲率(法線の横向き度)」と
//     「ρ(縁からの距離)」の両方で駆動 = 焼きムラ
//   - fBm(ハッシュ値ノイズ3オクターブ、シェーダ内で定数長ループ)で粉肌の明度ムラ
//   - 気泡ポア: 高周波ハッシュのしきい値、air に比例した密度
//   - 溝(grooveDepth)で陰影+リム、亀裂ノイズで暗線
//   - topping ゾーンはマット(スペキュラ弱)+粒子感
//   - fillings は uniform 配列でガウス減衰の透け色 (チーズ/バターは照り増し)
//   - inOven/frying/steaming の状態表現
//   - 接地影は K が GL 側で別パスとして描く(下記「接地影」参照)
//
// 性能: 描画は「接地影 1 draw call」+「生地本体 1 draw call」の計2回。
//   シェーダ内ループは fBm(3反復固定)と fillings(最大12反復・早期break)のみで、
//   すべて定数長。動的分岐や可変長ループは無い。ノイズはハッシュベース(テクスチャ不要)。

/* ===================== シェーダソース ===================== */

const VERT_SRC = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aExtra;

uniform vec2 uResolution;   // CSS px
uniform vec2 uCenter;       // CSS px
uniform float uZLift;       // 高さ→画面上方向への疑似リフト量

varying vec3 vNormal;
varying vec4 vExtra;
varying vec2 vLocalPos;
varying float vHeight;

void main() {
  vec2 screenPx = uCenter + aPosition.xy;
  screenPx.y -= aPosition.z * uZLift;
  vec2 clip = (screenPx / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  vNormal = aNormal;
  vExtra = aExtra;
  vLocalPos = aPosition.xy;
  vHeight = aPosition.z;
}
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec3 uLightDir;
uniform float uTime;
uniform float uBake;
uniform float uFerment;
uniform float uAir;
uniform float uCrack;
uniform float uToppingCrack;
uniform vec3 uBaseColor;
uniform vec3 uBakedColor;
uniform float uSSS;
uniform float uGloss;
uniform vec2 uFillings[12];
uniform vec3 uFillingColor[12];
uniform float uFillingAmount[12];
uniform float uFillingGloss[12];
uniform int uFillingCount;
uniform vec3 uOpts; // inOven, frying, steaming (0/1)
uniform float uHoleR; // ドーナツの穴半径(CSS px)。0なら穴なし。

varying vec3 vNormal;
varying vec4 vExtra;
varying vec2 vLocalPos;
varying float vHeight;

// ---- ハッシュベース value noise (テクスチャ不要、定数長ループのみ) ----
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
// 3オクターブ fBm。反復数は定数(3) — 動的長ループではない。
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// Worley風の点特徴ノイズ。セル内のランダム1点までの距離を返す(3x3固定9反復)。
// 軸に揃った value-noise のセルがそのまま四角い斑点に見える問題(Round4指摘)を、
// 「セル内特徴点からの丸い距離場」に変えることで解消する。
float pointField(vec2 p) {
  vec2 base = floor(p);
  float minD = 4.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec2 fp = cell + vec2(hash(cell + 13.1), hash(cell + 71.7));
      minD = min(minD, distance(p, fp));
    }
  }
  return minD;
}

void main() {
  // ドーナツの穴: メッシュ側(indices skip + annulus remap)だけでは
  // 完全な透過にできない(このプログラムは常に alpha=1.0 で描いていたため)。
  // 中心距離が穴半径未満のフラグメントは discard し、縁はごく薄い帯で
  // アンチエイリアスする(=本当に背景が透けて見える穴になる)。
  float distFromCenter = length(vLocalPos);
  float holeAlpha = 1.0;
  if (uHoleR > 0.0) {
    holeAlpha = smoothstep(uHoleR * 0.80, uHoleR * 1.04, distFromCenter);
    if (holeAlpha <= 0.001) discard;
  }

  float rho = clamp(vExtra.x, 0.0, 1.0);
  float toppingMask = clamp(vExtra.y, 0.0, 1.0);
  float grooveDepth = clamp(vExtra.z, 0.0, 1.0);
  float edgeAO = clamp(vExtra.w, 0.0, 1.0);

  // ρ<0.25(メッシュの極/中心付近)では、リッジ・ノイズ由来の法線の高周波成分を
  // より緩やかに消し、ドームの大局法線(真上向き)だけへブレンドする。
  // Round5審査: Round4のρ<0.15/急な smoothstepでは中心の放射状シワがまだ見えると
  // 指摘されたため範囲を拡げ、下方でAO/groove陰影にも同じフェードを効かせる
  // (centerFade として使い回す。中心は「つるんと滑らかな頂上」にする)。
  vec3 Nraw = normalize(vNormal);
  float centerFade = smoothstep(0.0, 0.25, rho);
  vec3 N = normalize(mix(vec3(0.0, 0.0, 1.0), Nraw, centerFade));
  vec3 L = normalize(uLightDir);
  vec3 V = vec3(0.0, 0.0, 1.0);

  // ---------- 曲率・縁依存の焼きムラファクタ ----------
  // 「法線が横向き(horiz)」かつ「ρ大」ほど焼きが進む。中心は常に uBake より控えめ
  // (=黄金色を残す)、縁だけが最大 uBake*1.15 まで焦げる、という非対称カーブにして
  // 「中心は明るい黄金色→縁はこんがり焦げ」のコントラストを作る。
  float horiz = 1.0 - abs(N.z);
  float edgeRaw = clamp(horiz * 0.50 + rho * rho * 0.42, 0.0, 1.0);
  float edgeBoost = pow(edgeRaw, 1.35);
  float lowFreq = fbm(vLocalPos * 0.012 + 11.0); // まだら焼き(低周波、位相をずらす)
  // Round5: 中心が「中間ブラウン/じゃがいも」寄りに見えた → 中心は焼きランプの
  // 第1区間(golden)にできるだけ留まるよう centerT を大きく下げ、縁とのコントラストを強める。
  float centerT = uBake * 0.36;
  float edgeT = clamp(uBake * 1.18, 0.0, 1.0);
  float bakeLocal = mix(centerT, edgeT, edgeBoost);
  bakeLocal = clamp(bakeLocal + (lowFreq - 0.5) * 0.22 * uBake, 0.0, 1.0);

  // ---------- 3段焼き色ランプ: base -> golden -> mid -> 焦げ縁 ----------
  // Round4指摘: 黄土色/オリーブに寄って冷たく見える → 緑成分を出さない暖色(橙寄り)の
  // 固定アンカー色 (#EDB96B / #C9803C / #8F5423) へ強めにブレンドして色相を担保する。
  // Round5: 中心をもう半段明るい黄金(#E2A85E 付近)にするため、アンカー自体を
  // 明るく(#F0C077 相当へ)し、プリセット色への依存もさらに下げてブレンド比を上げる。
  vec3 goldAnchorA = vec3(0.965, 0.780, 0.475); // 明るい黄金 (#F0C077 相当)
  vec3 goldAnchorB = vec3(0.788, 0.502, 0.235); // #C9803C (中間のこんがり橙)
  vec3 goldAnchorC = vec3(0.561, 0.329, 0.137); // #8F5423 (焦げ縁)
  vec3 goldenA = mix(mix(uBaseColor, uBakedColor, 0.4), goldAnchorA, 0.82);
  vec3 goldenB = mix(uBakedColor, goldAnchorB, 0.72);
  vec3 crustColor = mix(uBakedColor, goldAnchorC, 0.78);
  vec3 albedo;
  if (bakeLocal < 0.34) {
    albedo = mix(uBaseColor, goldenA, bakeLocal / 0.34);
  } else if (bakeLocal < 0.67) {
    albedo = mix(goldenA, goldenB, (bakeLocal - 0.34) / 0.33);
  } else {
    albedo = mix(goldenB, crustColor, (bakeLocal - 0.67) / 0.33);
  }

  // ---------- fBm 粉肌 (明度ムラ、やや広めのブロッチで粉っぽさを出す) ----------
  float flour = fbm(vLocalPos * 0.10 + 3.0);
  albedo *= (0.97 + flour * 0.06);

  // ---------- 気泡ポア: セル内特徴点からの丸い距離場で小さな円形ポアに ----------
  // Round4指摘: 軸に沿った矩形ドット(=汚れ/カビに見える)を、Worley風の丸い距離場に
  // 置き換え。コントラストを半分・サイズも小さく・焼けた面(uBake高)では目立たせない。
  float poreD = pointField(vLocalPos * 0.55);
  float poreRadius = mix(0.10, 0.16, clamp(uAir, 0.0, 1.0)); // air が多いほど僅かに大きく
  float poreMask = 1.0 - smoothstep(0.0, poreRadius, poreD);
  float poreDark = poreMask * mix(0.07, 0.10, uBake) * (1.0 - toppingMask);
  albedo *= (1.0 - poreDark);

  // ---------- topping ゾーン: 淡いクリーム黄 + 粒子感 (緑味を出さない) ----------
  // Round5指摘: まだ灰色がかった砂岩/サンドペーパーに見える。
  //   (a) ベースをもっと明度高く暖かいクリーム黄(#F5E6BC)へ。
  //   (b) 粒子コントラストを半分以下に(明暗2色を強く切り替えるmixではなく、
  //       1本の色を±小さく明度だけ揺らす方式に変更=「砂粒」感を消す)。
  //   (c) 焼けた格子の峰は #EAC57E 程度の明るい淡黄金に(暗く/灰色くしない)。
  vec3 toppingBase = vec3(0.961, 0.902, 0.737); // #F5E6BC
  vec3 toppingBaked = vec3(0.918, 0.773, 0.494); // #EAC57E
  float toppingGrain = fbm(vLocalPos * 0.24 + 50.0);
  float toppingBakeMix = clamp(uBake * (0.35 + edgeBoost * 0.5), 0.0, 0.68);
  vec3 toppingFlat = mix(toppingBase, toppingBaked, toppingBakeMix);
  vec3 toppingAlbedo = toppingFlat * (0.95 + toppingGrain * 0.10); // 明度だけ僅かに揺らす(粒子感は控えめ)
  albedo = mix(albedo, toppingAlbedo, toppingMask);

  // ---------- 溝(grooveDepth): 溝底を暗く、縁にハイライト ----------
  // Round5: 中心近傍(centerFade)では groove 由来の陰影も無効化し、
  // 「つるんと滑らかな頂上」を保証する(中心のシワ痕の残存要因を断つ)。
  // また、実際の高さ場(法線傾き)+ albedo darken + edgeAO darken の3つが同じ溝に
  // 重ねて掛かると濃く濁って「砂/汚れ」に見えるため(Round5 melon topping指摘)、
  // albedo側の減光は topping では大きく弱める(実陰影は法線/edgeAOに任せる)。
  float grooveEff = grooveDepth * centerFade;
  float grooveFloor = mix(0.72, 0.94, toppingMask);
  albedo *= mix(1.0, grooveFloor, grooveEff);
  float grooveRim = smoothstep(0.08, 0.26, grooveEff) * (1.0 - smoothstep(0.26, 0.62, grooveEff));
  albedo += grooveRim * 0.16;

  // ---------- 亀裂ノイズ (crackAmount / topping.crack) ----------
  float crackField = fbm(vLocalPos * 0.9 + 90.0);
  float crackAmt = clamp(uCrack + uToppingCrack * toppingMask, 0.0, 1.0);
  float crackLine = smoothstep(0.05, 0.0, abs(crackField - 0.5)) * crackAmt;
  albedo *= (1.0 - crackLine * 0.55);

  // ---------- fillings: 内部からのほんのり透け色 (ガウス減衰) ----------
  vec3 fillGlow = vec3(0.0);
  float fillGlossBoost = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uFillingCount) break;
    vec2 fp = uFillings[i];
    float amt = uFillingAmount[i];
    float d = distance(vLocalPos, fp);
    float rad = 22.0 + amt * 70.0;
    float g = exp(-(d * d) / (2.0 * rad * rad)) * amt;
    fillGlow += uFillingColor[i] * g * 0.42;
    fillGlossBoost += g * uFillingGloss[i];
  }
  albedo += fillGlow;
  albedo = clamp(albedo, 0.0, 1.0);

  // ================= ライティング =================
  // Round5: golden中心の明るさ不足・melon toppingの陰影が濃すぎて灰色に見える問題に
  // 対応するため、ラップ係数を少し柔らかく(w↑)し、アンビエント床を底上げする。
  // topping はマットなクッキー生地なので、影側でも極端に暗くならないよう
  // さらに高いアンビエント床を与える(=均一に明るいクリーム色を保つ)。
  float w = 0.62;
  float ndl = dot(N, L);
  float wrap = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
  wrap = max(wrap, mix(0.28, 0.58, toppingMask)); // 完全な黒潰れを避けるアンビエント床

  // 擬似SSS: 生地ほど影側へ暖色の透過を足す(「もちっと」感の要なので少し強めに)
  float sssAmt = (1.0 - uBake) * clamp(uSSS, 0.0, 1.0);
  vec3 sssColor = vec3(1.0, 0.89, 0.72);
  float sssTerm = (1.0 - clamp(ndl, -1.0, 1.0) * 0.5 - 0.5) * sssAmt * 0.85;
  sssTerm = clamp(sssTerm, 0.0, 1.0);

  // リムライト: 輪郭際にごく淡い暖白色。狭く絞る(Round4: ハイライトは狭く暖白に)
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
  vec3 rimColor = vec3(1.0, 0.96, 0.88) * fres * 0.22 * (0.35 + rho * 0.65);

  // スペキュラ: Blinn-Phong。
  // Round4指摘: 「真鍮/ブロンズの塊」に見える = 強すぎ・シャープすぎ・全面に均一すぎ。
  //   - 強度を従来の約1/3へ
  //   - 低周波ノイズ(shinePatch)で「照りが乗る場所/乗らない場所」を大きくムラにする
  //     (パン表面の艶は局所的なものであり、金属反射のように全面一様ではない)
  //   - ハイライト自体は絞る(shininess を上げてスポットを狭く)ことで、弱く・小さく・
  //     暖白色の「艶の点」として見えるようにする
  vec3 Hh = normalize(L + V);
  float shininess = mix(14.0, 64.0, uBake);
  float specStrength = mix(0.015, 0.14, uBake) * (1.0 - toppingMask * 0.8) + uGloss * 0.018 * (1.0 - uBake);
  float shinePatch = fbm(vLocalPos * 0.045 + 400.0);
  float shineMask = mix(0.12, 1.0, smoothstep(0.42, 0.72, shinePatch));
  float glossNoise = 0.5 + 0.5 * fbm(vLocalPos * 0.5 + 200.0);
  float spec = pow(max(dot(N, Hh), 0.0), shininess) * specStrength * shineMask * glossNoise;
  spec += fillGlossBoost * 0.3 * uBake;

  // frying: 下半分に油の照り(控えめ)
  float fryBoost = uOpts.y * clamp(vLocalPos.y * 0.01 + 0.3, 0.0, 1.0);
  spec += fryBoost * 0.09;

  vec3 lit = albedo * wrap + sssColor * sssTerm + rimColor;
  lit += vec3(1.0, 0.96, 0.85) * spec;

  // 縁・溝の接地陰影 (edgeAO)。中心近傍(centerFade)では無効化して滑らかな頂上を保つ。
  // topping(マットなクッキー生地)は albedo 側の減光と重ねて濁らないよう床を高くする。
  float edgeAOEff = mix(1.0, edgeAO, centerFade);
  float aoFloor = mix(0.72, 0.94, toppingMask);
  lit *= mix(aoFloor, 1.0, edgeAOEff);

  // 中心付近の追加ブライトニング(Round5: golden の中心をもう半段明るく)。
  // ドーム頂上(N がほぼ真上向き)かつ中心に近いほど、光源直下に近い扱いでほんのり底上げする。
  float topGlow = pow(clamp(N.z, 0.0, 1.0), 2.0) * (1.0 - rho) * 0.14;
  lit += albedo * topGlow;

  // inOven: ほんのり暖色
  lit = mix(lit, lit * vec3(1.08, 0.93, 0.76) + vec3(0.025, 0.008, 0.0), uOpts.x * 0.5);
  // steaming: 彩度を僅かに落として湿った質感 + ほんのり明るく
  float lum = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(lit, vec3(lum) * 1.02, uOpts.z * 0.22);

  // premultipliedAlpha:true のコンテキスト向けに rgb をアルファで乗算して出力
  gl_FragColor = vec4(clamp(lit, 0.0, 1.0) * holeAlpha, holeAlpha);
}
`;

const SHADOW_VERT_SRC = `
attribute vec2 aUnit; // -1..1 quad
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uShadowRadius; // rx, ry (CSS px)
uniform float uShadowOffsetY;
varying vec2 vUnit;
void main() {
  vec2 screenPx = uCenter + vec2(0.0, uShadowOffsetY) + aUnit * uShadowRadius;
  vec2 clip = (screenPx / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  vUnit = aUnit;
}
`;

const SHADOW_FRAG_SRC = `
precision mediump float;
uniform float uOpacity;
varying vec2 vUnit;
void main() {
  float d = length(vUnit);
  float a = smoothstep(1.0, 0.0, d);
  a = pow(a, 1.4) * uOpacity;
  vec3 tint = vec3(0.30, 0.19, 0.09);
  gl_FragColor = vec4(tint * a, a); // premultiplied
}
`;

/* ===================== ユーティリティ ===================== */

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('GLDoughRenderer: シェーダコンパイル失敗: ' + log);
  }
  return sh;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('GLDoughRenderer: プログラムリンク失敗: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function hexToFloatRgb(hex, out) {
  out = out || [0.9, 0.82, 0.65];
  if (typeof hex === 'string' && hex[0] === '#') {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const num = parseInt(h, 16);
    if (!isNaN(num)) {
      out[0] = ((num >> 16) & 255) / 255;
      out[1] = ((num >> 8) & 255) / 255;
      out[2] = (num & 255) / 255;
    }
  }
  return out;
}

function clamp01(v) {
  if (v == null || isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const MAX_FILLINGS = 12;

// render.js (Agent B) と揃えたフォールバックパレット (fillings に色情報が無い契約のため自前で持つ)
const FILLING_COLORS = {
  cream: [1.0, 0.953, 0.69],
  anko: [0.482, 0.29, 0.18],
  jam: [0.82, 0.259, 0.357],
  choco: [0.357, 0.229, 0.161],
  cheese: [0.965, 0.843, 0.435],
  raisin: [0.227, 0.141, 0.086],
  butter: [1.0, 0.914, 0.659],
  cinnamon: [0.71, 0.396, 0.114],
};
const GLOSSY_FILLING = { cheese: 1, butter: 1 };

/* ===================== 本体クラス ===================== */

export class GLDoughRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('GLDoughRenderer: WebGL コンテキストを取得できません');
    this.gl = gl;

    this.prog = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.shadowProg = createProgram(gl, SHADOW_VERT_SRC, SHADOW_FRAG_SRC);

    // attribute locations
    this.aPosition = gl.getAttribLocation(this.prog, 'aPosition');
    this.aNormal = gl.getAttribLocation(this.prog, 'aNormal');
    this.aExtra = gl.getAttribLocation(this.prog, 'aExtra');
    this.shadowAUnit = gl.getAttribLocation(this.shadowProg, 'aUnit');

    // uniform locations
    this.u = {};
    const names = [
      'uResolution', 'uCenter', 'uZLift', 'uLightDir', 'uTime', 'uBake', 'uFerment',
      'uAir', 'uCrack', 'uToppingCrack', 'uBaseColor', 'uBakedColor', 'uSSS', 'uGloss',
      'uFillingCount', 'uOpts', 'uHoleR',
    ];
    for (const n of names) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.u.uFillings = [];
    this.u.uFillingColor = [];
    this.u.uFillingAmount = [];
    this.u.uFillingGloss = [];
    for (let i = 0; i < MAX_FILLINGS; i++) {
      this.u.uFillings.push(gl.getUniformLocation(this.prog, `uFillings[${i}]`));
      this.u.uFillingColor.push(gl.getUniformLocation(this.prog, `uFillingColor[${i}]`));
      this.u.uFillingAmount.push(gl.getUniformLocation(this.prog, `uFillingAmount[${i}]`));
      this.u.uFillingGloss.push(gl.getUniformLocation(this.prog, `uFillingGloss[${i}]`));
    }

    this.us = {
      uResolution: gl.getUniformLocation(this.shadowProg, 'uResolution'),
      uCenter: gl.getUniformLocation(this.shadowProg, 'uCenter'),
      uShadowRadius: gl.getUniformLocation(this.shadowProg, 'uShadowRadius'),
      uShadowOffsetY: gl.getUniformLocation(this.shadowProg, 'uShadowOffsetY'),
      uOpacity: gl.getUniformLocation(this.shadowProg, 'uOpacity'),
    };

    // GPU バッファ (毎フレーム bufferSubData。確保は初回 render 時にサイズ確定)
    this.posBuf = gl.createBuffer();
    this.nrmBuf = gl.createBuffer();
    this.extBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
    this._bufVertCap = 0;
    this._bufIdxCap = 0;
    this._idxCount = 0;
    this._lastMesh = null;

    // 接地影用の静的クアッド (-1..1)
    this.shadowBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.w = canvas.width || 1;
    this.h = canvas.height || 1;
    this.dpr = 1;
    this.cssW = this.w;
    this.cssH = this.h;

    // 使い回しスクラッチ (fillings uniform 転送用、毎フレーム新規配列を作らない)
    this._fillPos = new Float32Array(2);
    this._fillCol = new Float32Array(3);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha 前提
  }

  resize(w, h, dpr) {
    const gl = this.gl;
    dpr = dpr || 1;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.w = pw;
    this.h = ph;
    gl.viewport(0, 0, pw, ph);
  }

  _ensureBuffers(mesh) {
    const gl = this.gl;
    const vc = mesh.vertexCount != null ? mesh.vertexCount : (mesh.positions.length / 3) | 0;
    const ic = mesh.indexCount != null ? mesh.indexCount : mesh.indices.length;

    if (this._bufVertCap < vc || this._lastMesh !== mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions.byteLength ? mesh.positions : new Float32Array(vc * 3), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals.byteLength ? mesh.normals : new Float32Array(vc * 3), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.extBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.extras.byteLength ? mesh.extras : new Float32Array(vc * 4), gl.DYNAMIC_DRAW);
      this._bufVertCap = vc;
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.positions.subarray ? mesh.positions.subarray(0, vc * 3) : mesh.positions);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.normals.subarray ? mesh.normals.subarray(0, vc * 3) : mesh.normals);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.extBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.extras.subarray ? mesh.extras.subarray(0, vc * 4) : mesh.extras);
    }

    if (this._bufIdxCap < ic || this._lastMesh !== mesh) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      this._bufIdxCap = ic;
    }
    this._idxCount = ic;
    this._lastMesh = mesh;
  }

  render(dough, mesh, t, opts) {
    const gl = this.gl;
    opts = opts || {};
    if (!dough || !mesh || !mesh.positions || !mesh.indices || !mesh.indexCount) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const preset = dough.preset || {};
    const p = dough.p || {};
    const cx = (dough.center && dough.center.x) || 0;
    const cy = (dough.center && dough.center.y) || 0;

    // 生地の概算半径 (接地影サイズ用。points から算出、48点ループのみでシェーダ内ではない)
    let avgR = 60;
    const pts = dough.points;
    if (pts && pts.length) {
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const dx = (pt.x != null ? pt.x : cx) - cx;
        const dy = (pt.y != null ? pt.y : cy) - cy;
        sum += Math.sqrt(dx * dx + dy * dy);
      }
      avgR = Math.max(8, sum / pts.length);
    }

    // ---------- 接地影パス (生地より先に描く) ----------
    this._renderShadow(cx, cy, avgR, opts);

    // ---------- 生地本体パス ----------
    gl.useProgram(this.prog);
    this._ensureBuffers(mesh);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.enableVertexAttribArray(this.aNormal);
    gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.extBuf);
    gl.enableVertexAttribArray(this.aExtra);
    gl.vertexAttribPointer(this.aExtra, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);

    gl.uniform2f(this.u.uResolution, this.cssW || 1, this.cssH || 1);
    gl.uniform2f(this.u.uCenter, cx, cy);
    gl.uniform1f(this.u.uZLift, 0.5);
    gl.uniform3f(this.u.uLightDir, -0.45, -0.6, 0.66);
    gl.uniform1f(this.u.uTime, t || 0);
    gl.uniform1f(this.u.uBake, clamp01(p.bakeColor));
    gl.uniform1f(this.u.uFerment, clamp01(p.ferment));
    gl.uniform1f(this.u.uAir, clamp01(p.air));
    gl.uniform1f(this.u.uCrack, clamp01(dough.crackAmount));
    gl.uniform1f(this.u.uToppingCrack, dough.topping ? clamp01(dough.topping.crack) : 0);
    gl.uniform3fv(this.u.uBaseColor, hexToFloatRgb(preset.baseColor, [0.96, 0.9, 0.78]));
    gl.uniform3fv(this.u.uBakedColor, hexToFloatRgb(preset.bakedColor, [0.77, 0.54, 0.29]));
    gl.uniform1f(this.u.uSSS, clamp01(p.crumbSoftness));
    gl.uniform1f(this.u.uGloss, clamp01(p.hydration != null ? p.hydration : 0.5));
    gl.uniform3f(this.u.uOpts, opts.inOven ? 1 : 0, opts.frying ? 1 : 0, opts.steaming ? 1 : 0);
    gl.uniform1f(this.u.uHoleR, dough.holeR > 0 ? dough.holeR : 0);

    const fillings = dough.fillings;
    const fcount = fillings ? Math.min(fillings.length, MAX_FILLINGS) : 0;
    gl.uniform1i(this.u.uFillingCount, fcount);
    for (let i = 0; i < MAX_FILLINGS; i++) {
      if (i < fcount) {
        const f = fillings[i];
        const col = FILLING_COLORS[f.type] || [0.85, 0.72, 0.5];
        this._fillPos[0] = f.x || 0;
        this._fillPos[1] = f.y || 0;
        gl.uniform2fv(this.u.uFillings[i], this._fillPos);
        this._fillCol[0] = col[0]; this._fillCol[1] = col[1]; this._fillCol[2] = col[2];
        gl.uniform3fv(this.u.uFillingColor[i], this._fillCol);
        gl.uniform1f(this.u.uFillingAmount[i], clamp01(f.amount));
        gl.uniform1f(this.u.uFillingGloss[i], GLOSSY_FILLING[f.type] ? 1 : 0);
      } else {
        gl.uniform1f(this.u.uFillingAmount[i], 0);
      }
    }

    gl.drawElements(gl.TRIANGLES, this._idxCount, gl.UNSIGNED_SHORT, 0);
  }

  _renderShadow(cx, cy, avgR, opts) {
    const gl = this.gl;
    gl.useProgram(this.shadowProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuf);
    gl.enableVertexAttribArray(this.shadowAUnit);
    gl.vertexAttribPointer(this.shadowAUnit, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this.us.uResolution, this.cssW || 1, this.cssH || 1);
    gl.uniform2f(this.us.uCenter, cx, cy);
    const rx = avgR * 0.85;
    const ry = avgR * 0.28;
    gl.uniform2f(this.us.uShadowRadius, rx, ry);
    gl.uniform1f(this.us.uShadowOffsetY, avgR * 0.62);
    let opacity = 0.24;
    if (opts && opts.inOven) opacity *= 0.6;
    gl.uniform1f(this.us.uOpacity, opacity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  captureRegion(cx, cy, w, h) {
    const gl = this.gl;
    const dpr = this.dpr || 1;
    const sx = Math.max(0, Math.round((cx - w / 2) * dpr));
    const sy = Math.max(0, Math.round((cy - h / 2) * dpr));
    const sw = Math.max(1, Math.min(this.w - sx, Math.round(w * dpr)));
    const sh = Math.max(1, Math.min(this.h - sy, Math.round(h * dpr)));

    const maxSide = 192;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const out = document.createElement('canvas');
    out.width = dw;
    out.height = dh;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, dw, dh);
    return { url: out.toDataURL('image/png'), w: dw, h: dh };
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    try {
      gl.deleteBuffer(this.posBuf);
      gl.deleteBuffer(this.nrmBuf);
      gl.deleteBuffer(this.extBuf);
      gl.deleteBuffer(this.idxBuf);
      gl.deleteBuffer(this.shadowBuf);
      gl.deleteProgram(this.prog);
      gl.deleteProgram(this.shadowProg);
    } catch (e) {
      // dispose 中の例外でアプリを落とさない
    }
    this.gl = null;
  }
}
