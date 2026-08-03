# 全画面ジオラマ化 仕様 (FULLSCREEN_SPEC)

菱形の輪郭と固定バーを廃止し、**画面の四隅まで地形が詰まった全画面ジオラマ**にする。
アイソメ投影(ISO_SPEC.md の投影式・3面ブロック・描画順)は不変。ワールドの輪郭のほうを画面に合わせる。
決定事項: 長方形マップ再設計 / 固定カメラ(パン・ズームなし) / フローティング最小UI / 机・トレイ廃止+外周に薄い内側の影。

## 1. カバー型ビュー (js/iso.js)

- グリッドは **GW=52, GH=52**(config.js)。ワールド菱形が画面矩形を완전に覆うよう tw を決める:

```
tw = 1.08 * (2*sw + 4*sh) / (GW + GH)     // sw, sh = ステージCSSピクセル
th = tw / 2, eh = tw * 0.30, cs = tw / 2
ox = sw / 2 - (GW - GH) * tw / 4          // 正方形グリッドなら sw/2
oy = sh / 2 - (GW + GH) * tw / 8          // ワールド菱形の中心 = 画面中心
```

- 導出: ワールド菱形の半幅 A=(GW+GH)tw/4、半高 B=(GW+GH)tw/8。内接条件 (sw/2)/A+(sh/2)/B≤1 を8%マージンで満たす。
- **アクティブ領域**: 画面に映る(+余白)セルだけを描画・シミュレーション・タッチ対象にする。

```
Iso.computeActive(view) -> Uint8Array(GW*GH)   // 結果は Iso.active にも保持
  セル中心 project(view, x+0.5, y+0.5, 0) が
  -2*tw ≤ px ≤ sw+2*tw かつ -(MAX_H*eh + tw) ≤ py ≤ sh + 1.5*tw なら 1
Iso.isActive(i) -> bool                        // Iso.active 未計算なら true 扱い
```

  (上方向の余白が大きいのは、山の上面が h*eh ぶん持ち上がって画面内に入るため)
- fitView(stageW, stageH, pad) は上記カバー式に置き換え(pad 引数は互換のため残すが未使用可)。fitView 内で computeActive も実行して Iso.active を更新する。
- 逆変換ヘルパー(地形生成・配置に使う):

```
Iso.gridAtScreen(view, sx, sy) -> {x, y}   // h=0 平面の逆変換。clampしない
Iso.gridDiagAtY(view, sy) -> d             // 画面 y に対応する対角線値 (sy - oy) / (th/2)
```

- Iso.pick: 走査対象を Iso.active のセルに限定。フォールバックの平面逆変換もアクティブ領域内に clamp。

## 2. ワールド構図 (js/terrain.js + js/config.js)

- 52×52 の**全セル**を生成する(アクティブ領域は描画・シミュ側の絞り込みであり、生成は全域。画面回転で見える範囲が変わっても地形が存在するように)。
- genMap(variant) は **Render.view を読む**(グローバル。boot 順は main.js が保証: Render.init → genMap)。構図はスクリーン空間で決める:
  - d0 = Iso.gridDiagAtY(view, 0)、d1 = Iso.gridDiagAtY(view, view.h) とし、
    **海岸線: 画面の高さ72%の位置** d_c(u) = Iso.gridDiagAtY(view, view.h * 0.72) + 波うち(u = x - y の sin、振幅±1.5セル程度)
  - 海: d > d_c(u)。画面下端の全幅に海の帯。沖(d大)ほど深い
  - 山なみ: 画面上端の帯 d < d0 + (d1 - d0) * 0.20 に、こんもりした山を3〜5個(u 方向に分散)。岩 T_ROCK は h > 4.6、雪は峰の先だけ
  - 川: 山の帯から海岸へ。u ≈ +Δ(画面右寄り1/3あたり)を sin で蛇行。既存 carveRiver 使用、川床は単調減少
  - たかだい: 画面左寄り中段(例: Iso.gridAtScreen(view, sw*0.30, sh*0.52) 付近)
  - 建物・木・花: 配置は Iso.gridAtScreen(view, sw*fx, sh*fy) で「画面のどのへんか」から決める。free は家2・おみせ1・ほいくえん1 を町の中段に、木〜20本・花〜30個
  - バリアント: c1 = 家2軒を海岸近く(画面高さ60〜65%)/ c2 = 低いたかだい(h≈2.6)+ほいくえんを海岸近く / c3 = 川が中段で途切れる(意図は従来どおり)
- 画面外セル(アクティブ外)も同じ式の延長で生成されるので特別扱い不要。
- 編集ツール群は変更不要(建物保護・3x3床は維持)。

## 3. シミュレーションのアクティブ制限 (js/water.js)

- 流れの計算で、**自セルか相手セルが Iso.isActive でないペアは流さない**(画面外は存在しない扱い。境界は画面外なので見えない)。
- 湧き水・海面固定・蒸発・ぬれ判定はアクティブセルのみ処理(海面固定は全海セルでも害はないが、ループを active で早期 continue して負荷を抑える)。

## 4. 描画 (js/render.js)

- **drawTable / drawTray を削除**。最初に画面全体を PAL.tray 系の淡い色で塗るだけ(通常は地形で全て覆われる保険)。
- セルループ・IsoWater 呼び出し・オブジェクト描画で **Iso.isActive(i) でないセルはスキップ**。
- アクティブ境界の外向き壁(隣がインアクティブ)は描かなくてよい(画面外)。
- ふね・さかなの位置選び: seaMask かつ Iso.isActive のセルから選ぶ。ふねは画面下部の深い海。
- ビネット(外周の薄い影)は CSS 側(#vignette)が担当するので canvas では描かない。

## 5. フローティングUI (index.html + css/style.css + js/main.js)

- `#topbar` と `#toolbar` の**バー領域(flex行)を廃止**し、`#stage`(=canvas)を画面いっぱいに。
- オーバーレイ構成(すべて #stage 内の absolute、**コンテナは pointer-events:none、ボタンだけ auto**):
  - 左上: ぷるちゃん(小さめ 48px)+ モード3ボタン(あそぶ/おだい/みくらべ)
  - 右上: もどす・リセット
  - 下辺中央: ツール9ボタンの浮きボタン列(背景バーなし。白丸+影の現行デザイン。狭い画面は横スクロール、44px以上維持)
  - サブパレット・GO・みくらべボタン・questChip は現行の絶対配置を踏襲(重なりだけ調整)
  - safe-area inset を考慮
- `#vignette`: 全画面の pointer-events:none な div。`box-shadow: inset 0 0 12vmin rgba(90,60,20,.18)` 程度のごく薄い内側の影+角をわずかに暗く。「箱庭を覗く」額縁の名残り。
- **main.js の boot 順を変更**: Render.init(canvas) → genMap("free") → waterInit() → 残り(genMap が Render.view を読むため)。resize / orientationchange では Render.resize()(fitView が Iso.active を再計算)するだけで、ワールドは再生成しない(cover 再フィットで端の見える範囲だけ変わる)。
- タイトル画面・カード類は変更不要。

## 6. ファイル所有権

| 担当 | ファイル |
|---|---|
| A | js/iso.js |
| B | js/config.js, js/terrain.js, js/water.js |
| C | js/render.js |
| D | index.html, css/style.css, js/main.js |
| E | js/water_render.js(アクティブ制限・画面端の見た目確認) |

- 共通制約: 他担当のファイル編集禁止 / git 操作禁止 / `node --check` 実施 / "use strict"・日本語コメント・既存スタイル維持 / ISO_SPEC.md の投影仕様は不変。
- おだいの難易度(波の強さ・湧き水量)は B が新マップで再調整してよい(c1: 無対策なら家が濡れ、堤防で守れる強さ。c3: みぞでつなぐと20秒以内に海へ届く)。
