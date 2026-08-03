# こねこね！パンの森 — モジュール契約仕様書 (SPEC v1)

対象: 4歳女児向けタッチ料理ゲーム。iPhone/iPad の Safari で動く静的Webアプリ。
**ビルド無し・純粋な ES Modules + Canvas 2D + Web Audio API。外部ライブラリ禁止。画像/音声アセットファイル禁止（全てコードで描画・合成）。**

このファイルは並列実装の**契約**である。`export` するシンボル名・シグネチャ・イベント形式は**厳守**すること。モジュール内部の実装は裁量に任せる。

## ファイル構成と所有権

```
index.html            ← Agent F
css/style.css         ← Agent F
js/main.js            ← Agent F
js/ui/hud.js          ← Agent F
js/dough/model.js     ← Agent A
js/dough/presets.js   ← Agent A
js/dough/render.js    ← Agent B
js/input/gestures.js  ← Agent C
js/game/stages.js     ← Agent D
js/audio/sound.js     ← Agent D
js/game/breads.js     ← Agent E
js/game/forest.js     ← Agent E
```

自分の所有ファイル以外を**作成・編集してはならない**。git commit してはならない。

## 全体設計

- 単一ページ。起動直後に生地が中央に大きく表示され、即座に触れる。
- `<canvas id="game">` 全画面（devicePixelRatio 対応、CSSピクセル座標で統一。ctx は `setTransform(dpr,0,0,dpr,0,0)` 済みで渡される）。
- HUD は DOM 要素（canvas の上のボタン群）。canvas への pointer イベントはボタンに吸われない位置のみ届く。
- ゲームループ: main.js が rAF で `dt`（秒、最大 0.033 にクランプ）を各モジュールへ配る。
- 状態: `mode: 'play' | 'forest'`、`stage: 'shape' | 'ferment' | 'cook' | 'done'`。
- 失敗・ゲームオーバー・×表示は存在しない。どんな形でも完成品になる。
- 色調: クリーム色 #FFF6E3、淡ピンク #FFD9E0, 水色 #CDEDF6, 淡緑 #D5EFD0 を基調。
- 文字は最小限、ひらがなのみ。

## 座標系

- CSS ピクセル。生地中心は main.js が `dough.center = {x, y}` で設定（画面中央やや上、`y = H*0.45`）。
- 生地基本半径 `R0 = min(W,H) * 0.26`。

---

## Agent A: `js/dough/model.js` + `js/dough/presets.js`

### presets.js

```js
export const DOUGH_PRESETS = { ... };
```

キー（9種、この名前を厳守）:
`soft_yeast`(柔らかい発酵パン生地), `shokupan`(少し重い食パン生地), `melon_topping`(表面が割れやすいメロンパン上生地), `croissant`(層を作れる生地), `donut`(油で膨らむ生地), `bagel_pizza`(弾力の強い生地), `steamed`(蒸気で膨らむ生地), `cookie`(ほろほろ崩れる生地), `liquid`(液体に近い生地)

各プリセットは以下を含むオブジェクト:

```js
{
  name: 'しょくぱん',            // ひらがな表示名
  baseColor: '#F7E8C9',         // 生地の生の色 (生地ごとに微妙に変える)
  bakedColor: '#C68A4B',        // 焼き上がりの色
  props: {   // DoughModel.p の初期値 (全て 0..1 正規化、thickness と layers を除く)
    hydration, softness, stickiness, elasticity, stretchiness,
    shrinkage, surfaceTension, air, ferment, temperature,
    bakeColor, crustHardness, crumbSoftness,
    thickness,   // 1.0 が標準
    layers,      // 整数, 初期 1
  },
  behavior: {
    reboundRate,      // 指を離した後に形が戻る速さ 0..1 (bagel_pizza 高, liquid ほぼ0)
    stretchLimit,     // どこまで伸ばせるか係数 (croissant/pizza 高, cookie 低)
    crackTendency,    // 変形時に表面が割れる傾向 (melon_topping/cookie 高)
    flowiness,        // 放置で自重により流れる/だれる傾向 (liquid 高)
    crumbleTendency,  // ほろほろ崩れ (cookie 高)
    fermentPower,     // 発酵での膨らみ量 (soft_yeast 高, cookie/liquid 0〜微小)
    springiness,      // こねた時の弾力の付きやすさ (bagel_pizza 高)
  }
}
```

### model.js

```js
import { DOUGH_PRESETS } from './presets.js';
export class DoughModel {
  constructor(presetId)   // DOUGH_PRESETS のキー
}
```

**公開プロパティ**（他モジュールが読む。名前厳守）:

- `presetId` (string), `preset`（プリセット参照）
- `center = {x, y}`（main.js が設定）
- `p` — props の現在値オブジェクト（presets の `props` と同キー）
- `points` — 半径方向の制御点配列 **N=48**。各要素は毎フレーム `update()` 後に
  `{ angle, restR, r, vr, x, y, th }` を持つ。`x,y` はワールド(CSS px)絶対座標、`th` はその点の相対的厚み(1.0標準)。
- `fillings` — `[{type, x, y, amount}]`。type ∈ `'cream'|'anko'|'jam'|'choco'|'cheese'|'raisin'|'butter'|'cinnamon'`。x,y は**中心からの相対** CSS px。amount 0..1。
- `patterns` — 模様ストローク配列 `[[{x,y},...], ...]`（中心相対座標）。
- `topping` — `null` または `{ presetId: 'melon_topping', crack: 0..1 }`（メロンパンの上掛け生地）。
- `crackAmount` — 0..1 表面の割れ具合。
- `bubbles` — 揚げ/蒸し中の泡演出用に stages が読み書きしてよい配列（初期 `[]`）。
- `wobble` — 発酵の呼吸用位相などに使う内部値だが、renderer が読める数値 (0..1 の膨張脈動係数)。

**公開メソッド**（シグネチャ厳守。座標は全てワールド CSS px）:

```js
update(dt)                        // ばね物理・弾性復帰・発酵成長・だれ(flow)・呼吸
poke(x, y, strength)              // 押す: 局所的にへこみ+周囲が広がる。strength 0..1
grabStart(x, y)                   // ドラッグ開始（掴み点を記録。生地外なら最寄り端）
grabMove(x, y, dx, dy)            // ゆっくり引く: 掴んだ部分が局所的に伸びて追従
grabEnd()                         // 離す: 弾力(reboundRate)で少し戻る
knead(x, y, intensity)            // こね: 弾力↑ 空気↓ 表面が滑らかに。squish感の局所変形も
fold(angleRad)                    // 折り畳み: layers+1, その方向の輪郭が重なるように変形
roundUp(quality)                  // 丸め: surfaceTension↑, 輪郭が円に近づく (quality 0..1)
elongate(angleRad, amount)        // 細長く: その軸方向に伸び直交方向が縮む
twist(deltaRad)                   // ねじり: 表面パターンが渦を巻く + 輪郭が僅かに螺旋変形
addPattern(strokePoints)          // [{x,y}]ワールド座標 → 中心相対に変換して patterns へ
addFilling(type, x, y, amount)    // 注入。局所的に膨らむ(該当方向の restR/th 微増)
applyTopping()                    // メロンパン上生地を被せる（topping 設定 + 色変化）
pokeHole(x, y)                    // ドーナツ穴あけ: 中心付近を強く押すと穴フラグ
holeR                             // 0 なら穴なし、>0 なら穴半径(CSS px)
setScale(s)                       // 全体スケール（森配置プレビュー等に使用）
snapshot()                        // ↓ 契約参照
reset(presetId)                   // 新しい生地に置き換え
```

**挙動の要点**:
- ばねモデル: 各点 `r` は `restR` へ戻ろうとし、隣接点と平滑化される。弾性は `p.elasticity` と `behavior.reboundRate` に依存。
- こね (`knead`) を重ねると `elasticity`/`springiness` が増し、`air` が減り、表面が滑らかに（`surfaceTension`↑）。**こねすぎのペナルティは無い**（よく伸びる個性になるだけ）。
- 発酵: `p.ferment` が stages により増加。`update()` 内で `ferment * fermentPower` に応じ `restR` がゆっくり成長し、`wobble` で呼吸のような脈動（周期 ~2.4s、振幅は air に比例）。
- `liquid` はほぼ形を保持せず、変形がゆっくり流れて均される。`cookie` は変形で `crackAmount` が増えやすく、戻りが無い。
- 過剰変形で生地が消えたり破綻したりしない。半径には下限 (0.15*R0) と上限 (2.6*R0) を設ける。
- **メモリ**: update 内で毎フレーム新規配列/オブジェクトを割り当てない（points は使い回す）。

**snapshot() の返り値**（Agent E の森が保存し、Agent B の renderSnapshot が描く。厳守）:

```js
{
  presetId, baseColor, bakedColor,
  outline: [{x, y, th}],       // 中心相対 48点
  holeR, thickness, layers,
  bakeColor,                   // 0..1
  crackAmount,
  topping,                     // null or {crack}
  patterns,                    // 中心相対ストローク配列 (deep copy)
  fillings,                    // deep copy
  air, ferment,
  size,                        // 平均半径 / R0
}
```

---

## Agent B: `js/dough/render.js`

```js
export function renderDough(ctx, dough, t, opts = {})
export function renderSnapshot(ctx, snap, x, y, scale, t)
export const R0_REF = 150;   // snapshot の outline はこの基準半径スケールで解釈しない。実寸で保存されるので scale だけで縮小
```

- `renderDough`: DoughModel を描画。`t` は経過秒。`opts = { frying:bool, steaming:bool, inOven:bool }`。
- 輪郭は `dough.points` を通る閉じた滑らかスプライン（Catmull-Rom または二次ベジェ平滑化）。
- 立体感: ベースをラジアルグラデーション（上左が明るい）。`p.bakeColor` で `baseColor → bakedColor` へ補間。焼き色は**縁ほど濃く**。
- 内側の柔らかさ: `crumbSoftness`/`air` が高いほどハイライトがふんわり大きい。
- `topping` があれば一回り小さいドーム状の上掛けを描き、`patterns` は上掛け上の溝として描く。溝の幅は `ferment` と `bakeColor` で**開く**（太く割れる）。topping.crack / crackAmount でひび割れ線を追加。
- `layers >= 3`（croissant）: 輪郭の縁に沿って薄い層線を弧状に重ね、`bakeColor` が上がると層線のコントラストが増して「層が開く」。
- `twist` された patterns は保存座標のまま描けば渦に見える（model 側で座標が回る）。
- `fillings`: 生地表面にうっすら色が透ける（cream=淡黄, anko=小豆色, jam=赤, choco=茶, cheese=黄, cinnamon=茶橙, raisin=粒々, butter=光沢）。位置は filling の x,y。膨らみ自体は model が担うので色表現のみ。
- `holeR > 0`: 中央に穴（背景が見える。`ctx.globalCompositeOperation='destination-out'` は使わず、穴内部を背景色系で塗る簡易表現で良い→ ただし森スナップショットでも成立する描き方にする。推奨: パスの evenodd で穴を抜く）。
- `dough.bubbles`: `{x,y,r,life}` の配列を油泡/蒸気泡として描く（frying: 白い泡が輪郭周囲、steaming: 湯気の白い曲線が上へ）。
- `wobble` を輪郭半径に乗せて呼吸を見せる。
- `renderSnapshot`: snapshot を `(x,y)` 中心・`scale` 倍で描く簡略版（グラデ+輪郭+模様+層+穴+topping）。森で多数描かれるため軽量に。
- **性能**: シャドウブラー(shadowBlur)乱用禁止（1描画1回まで）。フレーム毎の gradient 生成は生地1個なら可。

---

## Agent C: `js/input/gestures.js`

```js
export class GestureController {
  constructor(canvas, handler)   // handler: (evt) => void
  setEnabled(bool)
  destroy()
}
```

Pointer Events を使用（touch/マウス両対応、`preventDefault` でスクロール抑止。`{passive:false}`）。**一本指のみ**（2本目以降は無視）。

`handler(evt)` へ発火するイベント（`evt.type` と追加フィールド。名前厳守）:

| type | フィールド | 発火条件 |
|---|---|---|
| `press` | x,y | pointerdown 直後 |
| `pressHold` | x,y,duration | 静止押し続け(移動<10px)を 250ms 毎に継続発火 |
| `move` | x,y,dx,dy,speed | **全ての pointermove で必ず発火**（生ドラッグ。分類とは独立） |
| `stretch` | x,y,dx,dy | ゆっくりドラッグ（speed < 900 px/s）中、連続発火 |
| `knead` | x,y,intensity | 往復運動: 直近 1.2s に方向反転 ≥3 回。intensity は反転頻度から 0..1 |
| `fold` | angle | 長いストローク(>R0*0.8)後に逆方向へ戻した時 1回 |
| `round` | cx,cy,quality | 円軌道を描いている間、連続発火。quality 0..1（円らしさ、緩くて良い） |
| `elongate` | angle,length | ほぼ直線の長いストローク(>R0*1.1)を離した時 1回 |
| `twist` | delta | 開始点が中心から R0*0.6 以遠 かつ 中心周りの角速度が持続する間、連続発火（delta=角度変化 rad） |
| `stroke` | points | 指を離した時、そのストローク全点列 `[{x,y}]` を必ず1回 |
| `release` | x,y | pointerup/cancel |

**寛容さの原則**: 正確さを要求しない。閾値は緩く、複数解釈が可能なら同時に複数イベントを出して良い（例: 往復こね中も move/stretch は出る。受け手が状況で選ぶ）。判定不能なドラッグは stretch として扱われるだけで、無反応にならないこと。

R0 は `min(innerWidth, innerHeight) * 0.26` を内部で計算して使用。iOS Safari のダブルタップズーム・長押し選択が起きないよう canvas 側の抑止も実装（`touch-action: none` は CSS 側でも設定されるが、JS 側でも preventDefault）。

---

## Agent D: `js/game/stages.js` + `js/audio/sound.js`

### sound.js — 全て Web Audio 合成。アセット禁止。

```js
export const Sound = {
  init(),                 // 最初のユーザー操作で呼ばれる (AudioContext 生成/resume)
  sfx(name, opts = {}),   // 単発音。opts: {gain, rate, pan}
  loop(name), stopLoop(name),
  setMuted(bool), muted,
}
```

name（厳守）: `squish`(こねる/押す), `stretchy`(伸びる、ピッチが伸び量で変わるよう opts.rate 活用), `airout`(空気が抜けるプシュ), `pop`(小さな泡ポン), `bubble`(発酵の小さなこぽこぽ・ループ可), `sizzle`(揚げ油・ループ), `steamloop`(蒸気・ループ), `ding`(焼き上がりチャイム、明るい2音), `place`(森に置くぽふっ), `tap`(UIタップ), `sparkle`(完成キラキラ)

- 音色は柔らかく（正弦波/三角波+ローパス+短いエンベロープ。ノイズは filtered white noise バッファ）。音量は控えめ、耳に痛い高域を出さない。
- 連打時の多重発音は最大同時 6 声に制限。

### stages.js — 加工工程シミュレーション

```js
export class FermentStage {
  constructor(dough)
  update(dt)     // dough.p.ferment を約20秒で 0→1 へ。 途中で終了可
  get progress() // 0..1
  finish()
}
export class CookStage {
  constructor(dough, method)   // method: 'bake' | 'fry' | 'steam'
  update(dt)     // 約12秒で完了
  get progress()
  get done()
}
```

- **FermentStage**: `p.ferment` 増加 + `p.air` 増加。時々 `Sound.sfx('pop')`/`bubble`。生地は model の update が膨らみを表現。
- **CookStage 'bake'**: 前半にオーブンスプリング（`p.ferment` に応じ restR 追加成長を model の p.temperature 経由で誘発 → 実装は `dough.p.temperature` を上げ、`bakeColor` を 0→1 に。`crustHardness`↑ `softness`↓）。`elasticity` を上げて形を固定。メロンパン topping.crack を進行。croissant は bakeColor に応じ「層が開く」(renderer が表現)。cheese filling は溶けハイライト（renderer）。
- **'fry'** (donut, liquid): `dough.bubbles` へ泡を生成し（輪郭周囲）、`bakeColor` を進め、少し膨らませる。`Sound.loop('sizzle')`。
- **'steam'** (steamed): 表面が盛り上がる（restR 上方向偏重の成長は model.p 経由で近似: air↑ ferment↑）、`steamloop`。表面が割れて花が開くように `crackAmount` を少し進める。
- 完了時 `Sound.sfx('ding')`。CookStage 完了後、生地はそれ以上変形で崩れにくくなる（elasticity 高値）が、触ると**ぷにぷに揺れる**のは維持。

---

## Agent E: `js/game/breads.js` + `js/game/forest.js`

### breads.js

```js
export const BREADS = [ ... ];   // 18品、以下の id 順
export function getBread(id)
```

各要素:

```js
{
  id: 'shokupan',
  name: 'しょくぱん',
  emoji: '🍞',            // 選択ボタン用（絵文字で良い）
  presetId: 'shokupan',    // DOUGH_PRESETS のキー
  method: 'bake',          // 'bake' | 'fry' | 'steam'
  fillings: [],            // このパンで絞り器に入る材料 ['cream'] 等。空なら絞り器非表示
  toppingable: false,      // メロンパンのみ true
  hint: 'こねて はっこう して やこう',  // ひらがな1行
  forest: { kind: 'house', ... }        // 森での役割 (forest.js が解釈)
}
```

18品と割当て:

| id | name | preset | method | fillings | forest kind |
|---|---|---|---|---|---|
| shokupan | しょくぱん | shokupan | bake | [] | house(柔らかい家) |
| yamashoku | やまがたしょくぱん | shokupan | bake | [] | mountain(小さな山) |
| rollpan | ロールパン | soft_yeast | bake | [] | hill(丘) |
| butterroll | バターロール | soft_yeast | bake | ['butter'] | hill |
| milkpan | ミルクパン | soft_yeast | bake | [] | cloud(雲) |
| creampan | クリームパン | soft_yeast | bake | ['cream'] | flower(花) |
| anpan | あんパン | soft_yeast | bake | ['anko'] | stone(まるい石) |
| jampan | ジャムパン | soft_yeast | bake | ['jam'] | berry(木の実) |
| chocopan | チョコパン | soft_yeast | bake | ['choco'] | stump(切り株) |
| cheesepan | チーズパン | soft_yeast | bake | ['cheese'] | lantern(あかり) |
| raisinpan | レーズンパン | soft_yeast | bake | ['raisin'] | pebbles(石畳) |
| animalpan | どうぶつパン | soft_yeast | bake | ['choco'] | friend(森の友だち) |
| melonpan | メロンパン | soft_yeast | bake | [] toppingable:true | path(格子の小道) |
| croissant | クロワッサン | croissant | bake | [] | moon(月) |
| cinnamonroll | シナモンロール | croissant | bake | ['cinnamon'] | swirl(渦の看板) |
| donut | ドーナツ | donut | fry | ['choco'] | pond(池の輪) |
| pizza | ピザ | bagel_pizza | bake | ['cheese'] | sun(太陽) |
| mushipan | むしパン | steamed | steam | [] | mushroom(きのこ) |

### forest.js

```js
export class Forest {
  constructor()
  place(breadId, snapshot)        // 完成パンを森に配置（同じ breadId は最大5個まで蓄積、古いのから置換ではなく並べる）
  render(ctx, W, H, t)            // 森のパノラマ全画面描画（play へ戻るまで）
  renderBackdrop(ctx, W, H, t)    // play 画面の背景としての遠景（薄い森、軽量）
  count()
  save() / load()                 // localStorage 'panforest-v1' に snapshot ごと保存/復元
}
```

- 森は歩き回れない**一枚のパノラマ**。淡い色の丘・木・小川・空。夜昼は無し（常にやさしい昼）。
- 配置は kind ごとの定位置ゾーン（家の場所、丘の場所、池…）。同じパンでも snapshot の形/焼き色/模様がそのまま `renderSnapshot`（Agent B）で描かれるため、毎回姿が違う。kind に応じた装飾を最小限追加（house なら窓とドア、pond なら水輪、moon なら空に配置など）。
- 配置時に `Sound.sfx('place')` と小さなキラキラ。**配置後すぐ play へ戻れる**（Forest は描画のみ担当、遷移は main.js）。
- renderBackdrop はぼかした丘のシルエット程度に軽く（毎フレーム呼ばれる）。オフスクリーンcanvasにキャッシュし、リサイズ時のみ再描画。

---

## Agent F: `index.html` + `css/style.css` + `js/main.js` + `js/ui/hud.js`

### index.html
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`
- `apple-mobile-web-app-capable`、テーマカラー。タイトル「こねこね！パンの森」。
- `<canvas id="game">` + HUD 用 `<div id="hud">`。`<script type="module" src="js/main.js">`。

### style.css
- 全画面固定、スクロール禁止、`touch-action: none`、`-webkit-user-select: none`、`overscroll-behavior: none`。
- HUD ボタン: 直径 64px 以上の丸ボタン、パステル色、押下で squish するCSSアニメ。フォントは system の丸ゴシック系 (`-apple-system` フォールバック)。

### hud.js

```js
export class HUD {
  constructor(root, callbacks)
  // callbacks: {
  //   onSelectBread(breadId), onSelectTool(tool),  // tool: 'hand'|'piping'|'pattern'
  //   onCover(),        // 布(発酵)ボタン
  //   onToForest(), onBackToPlay(),
  //   onNewDough(),     // おかわりボタン(同じパンをもう一回)
  // }
  setBreads(breads)               // 実装済みリストだけ渡される
  setStage(stage)                 // 'shape'|'ferment'|'cook'|'done' に応じボタン表示切替
  setTool(tool)
  showHint(text)                  // ひらがな1行を数秒ふわっと表示
  setPipingFilling(type)          // 絞り器の中身表示
  celebrate()                     // 完成のキラキラ演出 (DOM/CSS)
}
```

- 左上: 現在のパンの顔ボタン → タップでパン選択オーバーレイ（絵文字+ひらがな名の大きなグリッド、1タップで選択即閉じ）。
- 右側縦列: 手 / 絞り器(そのパンに fillings がある時のみ) / 模様スティック(メロンパン等) / 布（ふわっとかける）。
- 右下: オーブン/揚げ鍋/蒸し器の口（パンの method に応じた見た目のドロップゾーン。DOM要素。生地をここへドラッグ＝main.js が座標判定するため、この要素は `pointer-events: none` にして位置だけ提供 `getOvenZone() → {x,y,w,h}`）。
- 左下: もりへボタン（森ビュー）。
- 発酵中: 布がふわっと生地に掛かる演出（半透明DOMまたはcanvas上表現は main.js と協調。HUD は布オーバーレイ要素を持ち `coverOn()/coverOff()`）→ **これも callbacks に含めず HUD メソッドとして公開**: `coverOn(), coverOff(), getOvenZone()`。

### main.js — 全体結線（状態機械とゲームループ）

1. 起動: canvas/dpr 設定 → `Forest.load()` → デフォルトパン `creampan` ではなく **`soft_yeast` の自由生地（breadId: 'rollpan'）** …ではなく、**初回は 'shokupan'** を選択済み状態で即遊べる。タイトル画面無し（初回タップで `Sound.init()`）。
2. ジェスチャ結線（stage が shape の間）:
   - `press` → `dough.poke` + `Sound.sfx('squish')`（音は連打制限）
   - `move` はオーブンゾーンへのドラッグ判定にも使用（生地中心付近から掴んでゾーンへ→ CookStage 開始）
   - `stretch` → `grabStart/grabMove`、`release` → `grabEnd` + `stretchy`音
   - `knead` → `dough.knead` + squish 音
   - `fold` → `dough.fold`
   - `round` → `dough.roundUp`
   - `elongate` → `dough.elongate`
   - `twist` → `dough.twist`
   - `stroke` → tool が 'pattern'、または topping 有りの melonpan なら `dough.addPattern`
   - tool 'piping' 中の `pressHold` → `dough.addFilling(currentFilling, x, y, +Δ)` + ぷくっと音
3. 布ボタン → `hud.coverOn()` → FermentStage 開始 → 生地が膨らむのが**布の下からも見える**よう布は半透明。もう一度タップ or 20秒で `coverOff()`。発酵は途中でやめても良い（ferment はそのまま活きる）。
4. オーブンへドラッグ → CookStage(method)。進行中も生地は画面内（オーブン窓の中で膨らむ表現: 生地を右下ゾーン中央へ補間移動し、ほんのり暖色ビネット）。完了 → `ding` → stage 'done'。
5. done: 触るとぷるぷる。`hud.celebrate()`。「もりにおく」大ボタン表示 → タップで `forest.place(breadId, dough.snapshot())` → 森ビューを 2.5 秒見せる（置いた場所へふわり落ちる）→ 自動で play に戻り**同じ breadId の新しい生地**が現れる。
6. 森ビュー（もりへボタン）: `forest.render` 全画面、タップで戻る。
7. リサイズ/回転対応。`visibilitychange` でループ停止/再開。
8. **メロンパン**: 生地を丸めた後、HUD に「うわがけ」ボタン（toppingable のパンのみ）→ `dough.applyTopping()` → stroke で模様。
9. **ドーナツ**: 中央を強く押す(`press`が中心近く+pressHold) → `dough.pokeHole`。
10. エラー時も無反応で固まらないこと（try/catch でループ継続）。

---

## 受け入れ基準（全 Agent 共通）

- `python3 -m http.server` で配信して Chromium で開いた時、コンソールエラー 0。
- 起動から 1 秒以内に生地が表示され、即タッチ反応。
- 60fps 目標（最低 30fps）。update+render で 8ms/frame 以内（デスクトップ基準）。
- 構文チェック: `cp file.js /tmp/x.mjs && node --check /tmp/x.mjs` を通すこと。
- コード内コメント・文字列は日本語可。UI 文言はひらがな。
