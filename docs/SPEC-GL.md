# SPEC-GL v1 — WebGL「2.5Dハイトフィールド生地」描画刷新の契約書

docs/SPEC.md の追補。目的: 生地の**質感（小麦の粉肌・気泡・焼きムラ・つや）**と**立体感（ふっくらした厚み・柔らかい陰影）**を、リアル寄りの「おいしそう」品質へ全面刷新する。ゲームロジック（DoughModel 物理・ジェスチャ・工程・HUD）は維持。描画のみ WebGL 化し、非対応環境では既存 Canvas 2D (renderDough) へフォールバック。

**対象:** iPhone/iPad Safari で 60fps。WebGL1 を基準とする（WebGL2 拡張は任意、必須にしない）。

## 新ファイル構成と所有権

```
js/gl/mesh.js        ← Agent J（純JS、DOM非依存。nodeでテスト可能に）
js/gl/glrenderer.js  ← Agent K（シェーダ文字列も本ファイルまたは js/gl/shaders.js に。shaders.js を作る場合も K の所有）
js/fx/particles.js   ← Agent M（新規、2Dパーティクル）
js/dough/model.js    ← Agent L が「dents 追加」のみ外科的編集
js/main.js           ← Agent L（統合改修）
index.html           ← Agent L（canvas 3枚構成へ）
css/style.css        ← Agent L（canvas 重ね順のみ追記。既存スタイルは壊さない）
js/game/forest.js    ← Agent L（snapshot.image 対応の外科的編集）
```

所有外ファイルの編集禁止。git commit 禁止。既存の export（renderDough / renderSnapshot 等）は削除禁止（フォールバックで使う）。

## Canvas 3枚構成（Agent L）

```
<canvas id="bg">   … 2D: 森の遠景 backdrop、オーブン暖色ビネット、森ビュー全画面
<canvas id="game"> … WebGL: 生地のみ（透明クリア。alpha:true, premultipliedAlpha:true）
<canvas id="fx">   … 2D: パーティクル(粉・湯気・油泡)、最前面
```

- 3枚とも全画面・同サイズ・dpr対応で絶対配置スタック。`#fx` が最前面で **GestureController は #fx に接続**（pointer はここに落ちる）。
- GL 初期化失敗時（例外）: `#game` を 2D に切替え、旧パイプライン（renderDough + 単一canvas相当の描画順）で全て動くこと。**フォールバック動作はテスト必須。**
- 森ビュー: bg に forest.render。GL canvas はクリア（生地非表示）。

## Agent J: `js/gl/mesh.js` — メッシュ/高さ場生成（純JS）

```js
export class DoughMesh {
  constructor(rings = 26, sectors = 64)
  update(dough, t)      // DoughModel の公開プロパティのみ読み、下記配列を全て更新
  positions;            // Float32Array (N*3): x,y = dough.center からの相対 CSS px、z = 高さ px（画面手前が +z）
  normals;              // Float32Array (N*3): 単位法線（z+ が手前）
  extras;               // Float32Array (N*4): [rho, toppingMask, grooveDepth, edgeAO]
  indices;              // Uint16Array（三角形リスト。ジオメトリ不変、初期化時に一度だけ生成）
  vertexCount; indexCount;
}
```

頂点グリッド: 中心1点 + rings×sectors の極座標グリッド。角度 θ ごとに `dough.points` の 48 点輪郭半径 r(θ) を線形補間し、頂点半径 = ρ·r(θ)（ρ∈(0..1]）。

**高さ場 h(ρ, θ):**
- 基本ドーム: `h = Hmax * pow(1 - pow(ρ, 2.3), 0.65)`。`Hmax ≈ 平均半径 * 0.42 * p.thickness * (1 + 0.30*p.air + 0.25*ferment効果)`、点ごとの `th` を角度補間して乗算（厚さの偏り）。
- **wobble 呼吸**を h と半径にごく僅かに乗せる。
- **dents**: `dough.dents`（後述、L が model に追加）各 `{x,y,r,depth,age}` を高さから減算（ガウス減衰、age で薄れる）。指のへこみの主表現。
- **holeR > 0**: 環状（トーラス断面）へ。ρ を穴内→外の annulus に再マップし、穴縁は滑らかに落ちる。穴内部の頂点は h=0 かつ完全透明にするため extras.edgeAO=0 & 縮退（または indices で穴内をスキップ。方法は裁量、見た目が破綻しないこと）。
- **patterns（溝）**: 各ストローク（中心相対座標）を ≤24 点へ間引き、頂点との距離で溝深さを彫る。溝幅・深さは `ferment*0.5 + bakeColor*0.8` で開く（メロンパンの割れ目）。彫った量を extras.grooveDepth (0..1) に記録（K が陰影強調に使用）。
- **layers ≥ 3（クロワッサン）**: 縁近傍（ρ > 0.55）に角度方向のさざ波 `sin` リッジを h と法線に付加。振幅は `min(layers,12)` と bakeColor で増える（焼くと層が開く）。
- **toppingMask**: topping があれば ρ < 0.86 の頂点を 1.0（メロン上掛けゾーン。境界は 0.80..0.92 で滑らかに 0→1）。
- **edgeAO**: 輪郭際 (ρ→1) と溝内で 1→0.55 程度に落とす接地陰影係数。
- 法線: グリッド有限差分（隣接頂点の外積）。**穴・縁でも NaN を出さない。**
- **性能**: update は毎フレーム呼ばれる。全配列はコンストラクタで確保し使い回す。臨時割り当てゼロ。目標 2ms 以下/frame。
- node で数値テスト可能にする（DOM/GL 非依存）。

## Agent K: `js/gl/glrenderer.js` — GL描画とマテリアル

```js
export class GLDoughRenderer {
  constructor(canvas)          // webgl ctx 取得（alpha:true, premultipliedAlpha:true, preserveDrawingBuffer:true）。不可なら throw
  resize(w, h, dpr)
  render(dough, mesh, t, opts) // opts: {frying, steaming, inOven}
  captureRegion(cx, cy, w, h)  // 直前の render 結果から CSS px 矩形を切り出し → {url, w, h}（PNG dataURL、最大辺 192px に縮小）
  dispose()
}
```

attribute は Agent J の配列レイアウト（positions vec3 / normals vec3 / extras vec4）を gl.DYNAMIC_DRAW で毎フレーム bufferSubData。

**マテリアル（本刷新の心臓。以下は必須要素）:**

1. **ライティング**: 平行光 L = normalize(-0.45, -0.6, 0.66)（左上手前から）。
   - 拡散: ラップライティング `max(0, (dot(N,L)+w)/(1+w))`, w≈0.5 — 柔らかい回り込み。
   - **擬似SSS**: 生の生地ほど光が透ける。`sss = (1-bakeColor) * crumbSoftness` を係数に、影側へ暖色 (#FFE3B8系) の透過項を加算。「もちっと」感の要。
   - リムライト: 輪郭際にごく淡いクリーム色の縁光。
   - スペキュラ: Blinn-Phong。生地は `gloss 低・広い`(粉っぽい)、焼けると `bakeColor` で `つや` が増す（卵液の照り。shininess 8→48、強度 0.05→0.4）。ノイズで照りをムラにする。
2. **アルベド**:
   - ベース: preset の baseColor。焼き進行で 3 段ランプ `baseColor → 黄金色(bakedColorを明るくした色) → bakedColor を暗くした焦げ縁色` を、**高さの稜線・縁（法線が横向き＆ρ大）ほど進む**曲率依存でミックス＝焼きムラ。
   - **fBmノイズ（value noise 3オクターブ、シェーダ内実装）**で粉肌の微細な明度ムラ（±4%）。
   - **気泡ポア**: 高周波ノイズのしきい値で小さな暗点。密度は `p.air` に比例、焼けると気泡が開いて目立つ。
   - まだら焼き: 低周波ノイズで bake ランプの位相をずらし、単調な均一色を避ける。
3. **溝/割れ**: extras.grooveDepth で溝底を暗く+縁にハイライト（メロンパンの格子が立体に割れて見える）。`uCrack`（crackAmount / topping.crack）で高周波亀裂ノイズの暗線を追加。
4. **topping ゾーン** (extras.toppingMask): クッキー生地らしい黄色み・マット（スペキュラ弱）・粒子感強め。境界は滑らかにブレンド。
5. **fillings**: uniform 配列（最大12: vec2 pos(中心相対px), vec3 color, float amount）。生地内部からのほんのり透け色（半径 ∝ amount のガウス）。焼けたチーズ (color判定 or フラグ) は照り強め。
6. **opts**: `inOven` は全体をほんのり暖色へ、`frying` は下半分に油の照り、`steaming` は彩度を僅かに下げ湿った質感。

uniform 例: uLightDir, uTime, uBake, uFerment, uAir, uCrack, uToppingCrack, uBaseColor, uBakedColor, uSSS, uGloss, uFillings[12], uFillingCount, uCenter, uResolution, uOpts。

- **自己検証を必須とする**: モック mesh（自前の簡易ドーム生成でよい）を使ったスタンドアロンHTMLをスクラッチパッドに作り、playwright-core + Chromium（/tmp/claude-0/-home-user-260728/8a425167-6448-5a8a-a316-b82cc6a1e8d8/scratchpad/itest に install 済み、PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers）でスクリーンショットを撮り、**自分の目で「生地/パンに見えるか」を審査して不合格なら作り直す**こと。生生地・半焼け・こんがり・メロン格子・穴あきの5状態のスクショを最終報告に含める（パスを列挙）。
- 描画は 1 draw call（生地本体）+ 必要なら輪郭接地影の 1 パス。60fps を守る。

**接地影**: 生地の下の柔らかい楕円影は K が GL で描くか、L が bg canvas に 2D で描くか、どちらでも良いが必ずどちらかで表現（K が担当する場合は render 内で生地より先に描く）。K の最終報告に方式を明記（L と重複したら統合時に L が bg 側を消す）。

## Agent L: 統合（model dents / main.js / index.html / css / forest）

1. **model.js への外科的追加**（他の挙動は不変）:
   - `dents` 公開配列（最大16、リングバッファ、`{x,y,r,depth,age}`、座標は中心相対）。
   - `poke` → 深いへこみ dent 追加（strength比例）、`knead` → 浅い dent を複数、`grabMove` → 引きずり方向に浅い溝状 dent。
   - `update(dt)` で age 進行・depth 減衰（減衰速度は `p.elasticity` と `behavior.reboundRate` に比例 = 弾力のある生地ほど早く戻る。liquid はゆっくり）。焼成後(bakeColor>0.5)はへこみがほぼ残らない硬さに。
   - 割り当てゼロ原則を維持。
2. **index.html / css**: canvas 3枚構成（上記）。既存 HUD は不変。
3. **main.js**:
   - GL 初期化 `try { new GLDoughRenderer(...) + new DoughMesh() } catch → 2D フォールバック`。
   - ループ: bg(backdrop等 2D) → mesh.update(dough,t) → glr.render(...) → fx.update/render。フォールバック時は従来 renderDough。
   - GestureController を #fx canvas へ接続。
   - **FxSystem 結線**: knead→`emit('flour',…)`（こねるたび粉がふわっ）、steaming→`steam`、frying→`oilbubble`（stages の bubbles と併用可、見た目が良い方を優先し二重にしない）、poke→`poff`（ごく小さな粉けむり）。
   - **snapshot 画像**: 焼成完了（done 遷移）フレームで `glr.render` 直後に `captureRegion`（生地バウンディングボックス+余白20%）→ `snap = dough.snapshot(); snap.image = url; snap.imageW/H = w/h;` → forest.place へ。フォールバック（2D）時は image 無しで従来動作。
4. **forest.js への外科的追加**: `snap.image` があれば Image を decode してキャッシュし（`new Image()` を place/load 時に一度だけ生成）、renderSnapshot の代わりに drawImage（呼吸の微スケールはそのまま適用）。無ければ従来どおり renderSnapshot。localStorage 保存は snapshot ごと image を含めて保存し、**quota 超過(setItem throw)時は最古のパンから間引いて再試行、それでも駄目なら image を捨てて保存**。全体上限 36 個（超えたら最古置換、kind別上限5は廃止して良い）。
5. 既存の Playwright テスト（scratchpad）を壊さない: `window.__game` フックは維持し、`__game.gl`（bool: GL有効か）を追加。

## Agent M: `js/fx/particles.js` — 2Dパーティクル

```js
export class FxSystem {
  constructor()
  emit(name, x, y, opts = {})   // name: 'flour' | 'steam' | 'oilbubble' | 'poff' | 'sparkle'
  update(dt)
  render(ctx)                    // #fx の 2D ctx。加算合成は screen/lighter を控えめに
  clear()
}
```

- `flour`: 小さな白〜クリームの半透明パフが数個ふわっと舞い、ゆっくり落ちて消える（こねの気持ちよさ演出）。
- `steam`: 上へゆらぎながら伸びる白い曲線/楕円、蒸しパンで多用。
- `oilbubble`: 輪郭際から生まれ、少し膨らんで弾ける油泡。ハイライト付きの丸。
- `poff`: 1〜2個の極小粉けむり。
- `sparkle`: 星形キラキラ（完成時に fx でも使えるように。DOM celebrate と併存可）。
- プール制（最大300粒、割り当て使い回し）。溢れたら古い粒を再利用。update+render で 1.5ms 以下目標。
- 純JS+ctx のみ依存。node で update ロジックがテストできる構造に。

## 品質ゲート（統括者による目視審査）

実装完了後、ビジュアルQAエージェントが以下の状態別スクリーンショットを撮影し、**統括者（人間の目の代理）が「パンに見えるか」を審査**する。不合格項目は差し戻し・再実装:

1. 起動直後の生生地（粉肌・ふっくら立体感・SSSの柔らかさ）
2. こね中（指のへこみ dents + 粉パーティクル）
3. 発酵中（膨らみ＋呼吸）
4. 食パン焼成後（黄金〜こんがりの焼きムラ・照り）
5. メロンパン（格子が立体で割れる）
6. クロワッサン（層のリッジが光る）
7. ドーナツ（穴・揚げ色・油泡）
8. 蒸しパン（白いふんわり感・湯気）
9. 森に配置された完成パン（キャプチャ画像）

判定基準: 「単色の丸いゼリー」に見えたら不合格。粉肌／焼きムラ／立体陰影の3点が揃って初めて合格。
