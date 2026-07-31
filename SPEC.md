# AQUA VELOCITY — 実装契約書 (SPEC v1)

**これは全エージェント共通の唯一の真実源。ここに書かれた API シグネチャは絶対に変更しないこと。**
自分の担当ファイル以外は絶対に作成・編集しない。他モジュールは「この仕様通りに存在する」前提でコードを書く。

## 0. プロジェクト概要

ブラウザで動く 3D ウォータースライダー・ゲーム。**1ステージのみ**。
目標品質: **PS2 を大きく超える現代的な描画**（PBR + HDR + ポストプロセス）。
N64 的なローポリ・フラットシェーディングは厳禁。

体験の核: **リアルな臨場感** と **軽快に滑る爽快感**。

## 1. 技術スタック（確定・変更禁止）

- `three@0.180.0`（`node_modules` に導入済み）, `vite@6`
- ES Modules。`import * as THREE from 'three'` / `import { X } from 'three/addons/...'`
  （`vite.config.js` に `three/addons/` → `three/examples/jsm/` の alias 済み）
- **外部アセット（画像・音声・モデルファイル）の読み込みは一切禁止。**
  ネットワークもファイルもゼロ。テクスチャは全て **プロシージャル生成**
  （`CanvasTexture` / `DataTexture` / シェーダ）。音は **WebAudio で合成**。
- WebGL2 前提。`renderer.outputColorSpace = SRGBColorSpace`,
  `toneMapping = ACESFilmicToneMapping`。
- 単位は **メートル / 秒**。Y-up、右手系。

## 2. ファイル所有権（厳守 / 他人のファイルに触るな）

| 担当 | ファイル |
|---|---|
| A1 CORE | `index.html`, `vite.config.js`, `package.json`, `src/main.js`, `src/core/Engine.js`, `src/core/Loop.js`, `src/core/Input.js`, `src/core/GameState.js` |
| A2 TRACK | `src/track/SplineTrack.js`, `src/track/TrackDesign.js`, `src/track/TrackMaterial.js` |
| A3 PHYS | `src/player/RiderPhysics.js`, `src/player/RiderModel.js`, `src/player/ChaseCamera.js` |
| A4 WATER | `src/render/WaterMaterial.js`, `src/render/Sky.js`, `src/render/Lighting.js` |
| A5 ENV | `src/render/Environment.js`, `src/render/Props.js`, `src/render/TextureLab.js` |
| A6 FX | `src/fx/SprayParticles.js`, `src/fx/LensDroplets.js`, `src/render/PostFX.js` |
| A7 UX | `src/audio/AudioEngine.js`, `src/ui/Hud.js`, `src/ui/Screens.js`, `src/ui/hud.css` |

## 3. 共有座標・規約

- コース中心線は 3D スプライン。位置は **弧長 `s`（メートル、0 → `track.length`）** で表す。
- 断面は **U 字（ハーフパイプ）**。横方向は **`lateral ∈ [-1, +1]`**
  （-1 = 左壁の縁, 0 = 溝の底, +1 = 右壁の縁）。
- 断面形状: 半径 `r` の円弧の下半分＋外側に立ち上がる壁。`lateral` は円弧に沿った正規化パラメータ。
- 進行方向 = `tangent`。`up` は遠心力を含んだ「見かけの上」ではなく **幾何学的な法線**（溝の底から外向き）。

## 4. モジュール API 契約

### 4.1 `src/track/SplineTrack.js` (A2)

```js
export class SplineTrack {
  constructor(design)              // design = TRACK_DESIGN（4.2）
  readonly length: number          // 総弧長 [m]
  readonly curve: THREE.Curve      // 中心線

  /** 弧長 s の断面フレーム。s は自動で [0,length] にクランプ。 */
  frameAt(s): {
    position: THREE.Vector3,       // 溝の底（中心線）のワールド座標
    tangent:  THREE.Vector3,       // 正規化・進行方向
    normal:   THREE.Vector3,       // 溝の底の面法線（上向き）
    binormal: THREE.Vector3,       // 右方向 = tangent × normal
    curvature: number,             // 1/m（符号付き: +で左カーブ）
    radius: number,                // その地点の U 字半径 [m]
    bank: number,                  // 追加バンク角 [rad]
    slope: number,                 // 進行方向の傾斜 sin（下り正）
    tunnel: boolean,               // 閉管（チューブ）区間か
    widthScale: number             // 断面スケール倍率
  }

  /** 断面上の点。lateral∈[-1,1]。lift は面からの法線方向オフセット[m]。 */
  surfaceAt(s, lateral, lift = 0): THREE.Vector3
  /** 断面上の面法線（内向き = ライダー側）。 */
  surfaceNormalAt(s, lateral): THREE.Vector3

  /** 樋(chute)本体のジオメトリ。UV: u = (lateral+1)/2, v = s / 2m (タイリング用). */
  buildChuteGeometry(): THREE.BufferGeometry
  /** 樋の外殻（裏面・支持リブ用の押し出し）。 */
  buildShellGeometry(): THREE.BufferGeometry
  /** 水面ジオメトリ（樋の内側、底から少し浮かせた面）。属性に aFlow(vec2), aDepth(float), aS(float) を含める。 */
  buildWaterGeometry(): THREE.BufferGeometry
  /** 支柱・支持構造のメッシュ群（Group を返す）。 */
  buildSupports(): THREE.Group
}
```

**重要: 分割数** — 縦方向 `s` は **0.5m 以下**の刻み、横方向は **32 分割以上**。
総三角形数は 15 万以内に収めること（滑らかさ優先、カクカク厳禁）。

### 4.2 `src/track/TrackDesign.js` (A2)

```js
export const TRACK_DESIGN = {
  start:  THREE.Vector3,   // スタート地点
  nodes:  [ {pos:[x,y,z], radius, bank, tunnel, widthScale}, ... ],
  finishS: number,         // ゴール判定の弧長（= track.length 付近）
  poolCenter: [x,y,z],     // 着水プールの中心
  poolRadius: number,
}
```

**ステージ設計要件（爽快感の核 / A2 は必ず全部入れる）**:
1. 全長 **550〜750m**、標高差 **60〜80m**。所要 **60〜90秒**。
2. 区間構成（この順で）:
   - **A. ローンチ**: 短い水平助走 → 急降下（drop）で一気に加速
   - **B. 高速ヘリックス**: 大径の螺旋を 1.5〜2 周、強バンク（bank 0.5〜0.9rad）
   - **C. ダークトンネル**: `tunnel:true` の閉管区間 80〜120m（光の筋が差し込む演出用）
   - **D. ボウル / ウェーブ**: 左右に大きく振られる S 字連続（横 G を感じさせる）
   - **E. エアタイム**: 短い上り → 途切れ（ジャンプ）→ 着地。物理側で滞空する
   - **F. ラストドロップ**: ほぼ垂直に近い急降下 → プールへ着水
3. 高さは常に単調減少（登り返しは E のみ、微小に）。自己交差しないこと。
4. カーブ半径は最小 12m（急すぎるとカメラが破綻する）。

### 4.3 `src/player/RiderPhysics.js` (A3)

```js
export class RiderPhysics {
  constructor(track: SplineTrack, opts?)
  reset()

  /** input: { steer: -1..1, tuck: 0..1, brake: 0..1 } */
  update(dt: number, input): void

  readonly state: {
    s: number,             // 弧長 [m]
    speed: number,         // 進行方向速度 [m/s]
    lateral: number,       // -1..1
    lateralVel: number,
    airborne: boolean,
    airTime: number,       // 現在の滞空時間 [s]
    gForce: number,        // 体感 G（1 = 静止）
    lean: number,          // 見た目の傾き -1..1
    finished: boolean,
    splashRate: number,    // 0..1 水しぶきの強さ
    contactPoint: THREE.Vector3,
    up: THREE.Vector3,     // ライダーの上方向
    forward: THREE.Vector3,
    position: THREE.Vector3, // ライダー重心のワールド座標
    quaternion: THREE.Quaternion
  }
}
```

**物理要件**: 重力 9.81、斜面加速、水の粘性抵抗（速度の2乗 + 線形）、
`tuck` で抵抗減・加速増、`brake` で減速、`steer` で横方向に力。
横方向は **重力 + 遠心力** が U 字断面で釣り合う位置に自然に落ち着くこと
（速い＝壁を駆け上がる、遅い＝底に沈む）。壁の縁（|lateral| > 0.97）では
飛び出さずに強い反発でクランプ。**速度域 8〜30 m/s** を目安に。
ジャンプ区間では放物線飛行 → 樋に再接触したら復帰。

### 4.4 `src/player/ChaseCamera.js` (A3)

```js
export class ChaseCamera {
  constructor(camera: THREE.PerspectiveCamera, track, physics)
  setMode(mode: 'chase' | 'pov'): void
  update(dt: number): void   // 位置/回転/FOV/シェイクを毎フレーム適用
}
```
FOV は速度に応じて 68° → 92° に伸びる（爽快感の要）。ロール追従、ラグ、
高 G 時のシェイク、着水時のキック。**カメラが樋に埋まらないこと。**

### 4.5 `src/player/RiderModel.js` (A3)

```js
export class RiderModel {
  constructor()
  readonly object3D: THREE.Object3D   // 浮き輪＋ライダー
  update(dt, state): void             // state = physics.state
  setVisible(v: boolean): void
}
```
プロシージャルな浮き輪（トーラス、PBR、濡れた光沢）＋簡易人体（カプセル群、
スキントーン、水着）。手を水面に入れる、体を傾ける等のアニメ。

### 4.6 `src/render/WaterMaterial.js` (A4)

```js
/** 樋を流れる水のマテリアル。onBeforeCompile で MeshPhysicalMaterial を拡張。 */
export function createFlowingWaterMaterial(opts: {
  envMap?: THREE.Texture, track?: SplineTrack
}): THREE.Material
/** 毎フレーム呼ぶ。 */
export function updateWater(dt: number, params: { riderS: number, riderLateral: number, speed: number }): void
/** 着水プールの水面マテリアル。 */
export function createPoolWaterMaterial(opts): THREE.Material
```
要求: 進行方向へ流れる法線波（2〜3スケール重ね）、透過 + 屈折 + 泡（速度に応じた白い筋）、
ライダー後方の航跡、フレネル反射、深度に応じた色（浅=水色、深=青緑）。
**`MeshPhysicalMaterial` の transmission/roughness/clearcoat を使い、実写的に。**

### 4.7 `src/render/Sky.js` + `Lighting.js` (A4)

```js
export function createSky(scene, renderer): {
  sky: THREE.Object3D, sunDirection: THREE.Vector3,
  envMap: THREE.Texture,          // PMREM 生成の環境マップ（全 PBR で共有）
  update(dt): void
}
export function createLighting(scene, sunDirection): {
  sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight,
  update(dt, focusPos: THREE.Vector3): void   // シャドウカメラをライダー追従
}
```
時刻は**夏の午後の斜光**（暖色、長い影）。`Sky`(addons) + PMREM。
シャドウ: PCFSoft, 2048、カスケード不要だが focus 追従で解像度を稼ぐ。

### 4.8 `src/render/Environment.js` + `Props.js` + `TextureLab.js` (A5)

```js
export function createEnvironment(scene, track: SplineTrack, envMap): {
  group: THREE.Object3D, update(dt, riderPos): void
}
export function createProps(track, envMap): THREE.Group
// TextureLab: プロシージャルテクスチャ工房
export function noiseTexture(size, opts): THREE.DataTexture
export function fiberglassTextures(color): { map, normalMap, roughnessMap }
export function concreteTextures(): { map, normalMap, roughnessMap }
export function foliageTexture(): THREE.CanvasTexture
export function tileTextures(): { map, normalMap, roughnessMap }
```
南国リゾートのウォーターパーク: 起伏のある地形、椰子の木（InstancedMesh、風で揺れる）、
プール（タイル）、デッキ、パラソル、監視塔、遠景の山と海、雲。
**全て PBR マテリアル。フラットな単色禁止。** ドローコールは 150 以内、
遠景は Instancing / LOD。`update` で椰子の揺れとカメラ相対の遠景移動。

### 4.9 `src/fx/*` + `src/render/PostFX.js` (A6)

```js
export class SprayParticles {
  constructor(scene, opts)             // GPU パーティクル（Points + custom shader）
  readonly object3D: THREE.Object3D
  emit(position, direction, amount, speed): void
  update(dt, camera): void
}
export class LensDroplets {
  constructor()
  readonly pass: /* postprocessing Pass 互換 or uniforms 更新関数 */
  update(dt, params: { speed, splashRate }): void
}
export function createPostFX(renderer, scene, camera): {
  composer: EffectComposer,
  setSize(w, h): void,
  update(dt, params: { speed, gForce, airborne, tunnel, splashRate }): void,
  render(dt): void
}
```
ポスト: `RenderPass` → `UnrealBloom`(控えめ) → 速度連動 **ラジアルブラー**
→ **色収差**（速度で増加）→ ビネット → **レンズ水滴** → `OutputPass`(ACES)。
FXAA か SMAA を最後に。**速度が上がるほど周辺が流れる**のが爽快感の要。
GPU 負荷は 60fps を守れる範囲で。

### 4.10 `src/audio/AudioEngine.js` (A7)

```js
export class AudioEngine {
  constructor()
  async start(): Promise<void>     // ユーザー操作後に resume
  update(dt, params: { speed, splashRate, airborne, tunnel, gForce }): void
  playSplash(intensity): void
  playWhoosh(): void
  playFinish(): void
  setMuted(m: boolean): void
}
```
**全て WebAudio 合成**（ファイル禁止）: 水流 = フィルタードノイズ（速度で
カットオフ・ゲイン上昇）、風切り音、トンネルの残響（ConvolverNode に
合成インパルス）、着水スプラッシュ、ゴールのチャイム。

### 4.11 `src/ui/Hud.js` + `Screens.js` (A7)

```js
export class Hud {
  constructor(root: HTMLElement)
  update(state, extra: { timeMs, bestMs }): void
  setVisible(v): void
}
export class Screens {
  constructor(root: HTMLElement, callbacks: { onStart(), onRestart() })
  showTitle(): void
  showLoading(pct): void
  showResult(result: { timeMs, topSpeed, maxAir, bestMs, isNewBest }): void
  hideAll(): void
}
```
デザイン: 半透明ガラス風、速度メーター（円弧ゲージ + 数値 km/h）、タイム、
G フォース、エアタイム、進行度バー。日本語 UI。フォントは system font のみ。
起動時に操作説明（← → / A D で左右、Shift でタック、Space でブレーキ、
C で視点切替、R でリスタート）。

### 4.12 `src/core/*` + `src/main.js` (A1)

```js
// Engine.js
export function createEngine(container): {
  renderer, scene, camera, clock, resize(), dispose()
}
// Loop.js
export function createLoop(step: (dt, elapsed) => void): { start(), stop() }
// Input.js
export class Input {
  constructor(target)
  readonly value: { steer, tuck, brake }
  readonly justPressed: (code) => boolean   // 1フレームのみ true
  dispose()
}
// GameState.js
export const PHASE = { LOADING:'loading', TITLE:'title', RIDE:'ride', FINISH:'finish' }
export class GameState { phase; timeMs; topSpeed; maxAir; bestMs; ... }
```

`main.js` は全部を組み立てる。**固定タイムステップ 1/120s で物理、描画は可変**。
キーボード + タッチ（画面左右タップで steer）+ ゲームパッド対応。
起動フロー: ローディング → タイトル（コースのシネマティック・フライスルー）→
Space/クリックでスタート → ライド → ゴール（プール着水 + スローモーション）→ リザルト。

## 5. 品質チェックリスト（全員が自分の担当分で満たす）

- [ ] `npm run build` がエラーなく通る
- [ ] コンソールエラー・警告ゼロ
- [ ] ローポリに見えない（曲面は必ず十分な分割 / smooth normals）
- [ ] 単色ベタ塗りのマテリアルが一つも無い（必ず map/normal/roughness を持つ）
- [ ] 60fps を目標（1920x1080, 中位 GPU 想定）
- [ ] 未定義参照・存在しない three API を使わない（r180 準拠）
- [ ] 自分の担当ファイルは単体で import してもエラーにならない

## 6. r180 での注意点

- `outputEncoding` は廃止 → `outputColorSpace`
- `sRGBEncoding` → `THREE.SRGBColorSpace`
- `physicallyCorrectLights` は廃止（デフォルト有効）→ `useLegacyLights` も無し
- ライト強度は物理単位（DirectionalLight は 2〜4 程度が適正）
- `Geometry` は無い。`BufferGeometry` のみ
- `THREE.sRGBEncoding` などの旧定数を書かない
