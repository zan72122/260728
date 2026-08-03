# 真アイソメ投影 移行仕様 (ISO_SPEC)

「みずみちラボ」の描画を、現行の縦オブリーク投影から **真アイソメ(ひし形グリッド、2:1)** に移行する。
シムシティ/箱庭ゲーム定番の視点で、各セルの上面がひし形、高さは「上面+2つの側面(壁)」で表現される。
アート方向(パステル・ジオラマ・かわいい・怖くない)は現状を維持する。既存のパレット `PAL` を使うこと。

## 1. 座標系と定数

- グリッドは **GW=34, GH=34**(config.js で変更する。担当: C)
- グリッド格子点 (gx, gy) と高さ h(単位: 高さユニット)のスクリーン投影:

```
px = view.ox + (gx - gy) * view.tw / 2
py = view.oy + (gx + gy) * view.th / 2 - h * view.eh
```

- `tw` = ひし形タイルの横幅px、`th = tw / 2`(2:1)、`eh = tw * 0.30`(高さ1ユニットの壁px)
- `view.cs = tw / 2` を便宜値として持つ(既存コードのスプライト寸法 `cs` の代替。木・建物・パーティクルの大きさはこれを使うと従来と近いサイズになる)
- セル (x, y) の上面ひし形の4隅(すべて同じ h で描く。現行と同じくセル内はフラット):
  - N = project(x,   y,   h) … 上
  - E = project(x+1, y,   h) … 右
  - S = project(x+1, y+1, h) … 下
  - W = project(x,   y+1, h) … 左
- セル中心 = project(x+0.5, y+0.5, h)
- **方角の意味**: グリッドの (0,0) が画面奥(上の頂点)、(GW,GH) が画面手前(下の頂点)。
  +x は画面右下方向、+y は画面左下方向。

## 2. 描画順と面

- 対角線 `s = x + y` の **昇順** に描く(奥→手前)。同一対角線内の順序は任意。
- 各セルで描く面:
  - **上面**: 上記ひし形。明度 1.0(現行同様、周囲勾配による軽い陰影と等高線しま模様を掛けてよい)
  - **右面**(+x側の壁): 上面の E–S 辺から、隣 (x+1, y) の高さ hR まで垂直に下ろした四角形。
    `drop = h - hR > 0.02` のとき描く。グリッド外は hR = 0。明度 **0.72**
  - **左面**(+y側の壁): 上面の W–S 辺から、隣 (x, y+1) の高さ hL まで。明度 **0.86**
- 光は左上から。上面が最も明るく、左面 > 右面。
- 小さい段差 (drop < 0.5) の壁は土色ではなく **上面色を暗くした色**(現行 render.js の `wk` ブレンドと同じ手法)。大きい段差だけ土/石/堤防の壁色。
- 隣接セルとの辺の共有関係(みくらべ輪郭線などに使う):
  - 隣 (x, y-1) と共有 = N–E 辺 / 隣 (x-1, y) = N–W 辺 / 隣 (x+1, y) = E–S 辺 / 隣 (x, y+1) = W–S 辺

## 3. Iso API (js/iso.js、新規。担当: A)

```js
const Iso = {
  EH_RATIO: 0.30,
  // ステージ寸法から view を計算。マップ全体(高さ MAX_H の壁ぶん含む)+ pad が収まる tw を選び、中央配置
  fitView(stageW, stageH, pad) -> {ox, oy, tw, th, eh, cs, w, h},
  project(view, gx, gy, h) -> {px, py},
  // セル上面ひし形の4隅 [N, E, S, W](各 {px, py})
  cellCorners(view, x, y, h) -> [N, E, S, W],
  // ctx にセル上面のパスを begin する(fill は呼び出し側)
  diamondPath(ctx, view, x, y, h),
  // スクリーン→グリッド。World.h + Water.w を考慮し s 降順(手前→奥)に上面ひし形の内外判定。
  // ヒットしたらその面の高さで逆変換した小数グリッド座標 {x, y} を返す。
  // 全ヒットなしなら h=0 の平面逆変換 (gx=(dy+dx)/2, gy=(dy-dx)/2, dx=(sx-ox)/(tw/2), dy=(sy-oy)/(th/2))
  // を [0, GW), [0, GH) に clamp して返す。マップから大きく外れたら null
  pick(view, sx, sy) -> {x, y} | null,
}
```

- マップ全体の外接: 幅 `(GW+GH)*tw/2`、高さ `(GW+GH)*th/2 + MAX_H*eh`(上に MAX_H*eh の余白が要る)
- 点 P のひし形内外判定: 中心 c に対し `|dx|/(tw/2) + |dy|/(th/2) <= 1`

## 4. 水の描画 (js/water_render.js、新規。担当: D)

```js
const IsoWater = {
  // 対角線 s 上の全セルの水を描く。render.js が地形の s を描いた直後に呼ぶ
  drawDiagonal(ctx, view, s, now),
}
```

- 水面 = h + w の高さのひし形。深さで色 (PAL.waterShallow/Deep, seaShallow/Deep) と alpha(0.5〜0.9)を変える。海はゆらぐ模様、なぎさに泡(現行 render.js の drawWaterRow 相当を移植・ひし形化)
- 露出した辺(隣に水がない側)は角を丸めて「ぷるん」とした輪郭に。奥側の露出辺には白いハイライト
- 段差を落ちる水: 右面/左面に、水色の壁+白い筋(現行の滝表現をひし形の2面に)
- きらきら・泡パーティクルの発生(現行 drawWaterRow 内のロジック)もここが担当
- Water.flowGlow / Water.wet の参照は現行どおり

## 5. ファイル所有権(絶対に他人のファイルを編集しない)

| 担当 | ファイル | 内容 |
|---|---|---|
| A | js/iso.js (新規), index.html | Iso API 実装。index.html は script タグ追加のみ(iso.js と water_render.js を particles.js の後・render.js の前に) |
| B | js/render.js | 全面書き換え: テーブル/トレイ(ひし形の盤に)、地形の上面+2面、階段/堤防/川の小石/ぬれ表現、対角線ループ、IsoWater.drawDiagonal 呼び出し、対角線ごとの建物/木/花/湧き水描画、海の生きもの(ふね・さかな: 位置は seaMask から動的に選ぶ)、みくらべ輪郭線(ひし形辺)、カーソル(2:1楕円)。pick は Iso.pick に委譲(`Render.pick(sx,sy)` の外部インターフェースは維持) |
| C | js/config.js, js/terrain.js | GW=GH=34 化。genMap を対角線構図に書き換え: **d = x+y** を「奥行き」とし、d 小=山なみ(奥の頂点)、d 大=海(手前の頂点)、間に高原→草地→浜→なぎさ。海岸線は d ≈ 46 を横断座標 u = x−y の sin で波打たせる。川は山から海へ蛇行(c3 は途中で途切れる)、たかだい・建物・木・花・湧き水も新構図で配置。c1(家が海の近く)/ c2(低いたかだいが海の近く)/ c3 の意図を維持。編集ツール群は原則そのまま(coastY など旧構図前提の関数は整理) |
| D | js/water_render.js (新規), js/particles.js | IsoWater 実装。particles.js の draw を Iso.project 使用に変更(大きさは view.cs 基準のまま) |
| E | js/entities.js, js/icons.js, js/modes.js | entities: 影をアイソメ楕円(2:1)に、サイズを view.cs 基準で微調整(描画関数の引数 cs は据え置き)。icons: やま/たかだい/ていぼう/たてもの等をひし形ブロックのミニチュア風に描き直し(水/なみ/けす等はそのままで可)。modes.js は drawQuestMarkers の投影を Iso.project + 2:1楕円に直すのみ(判定ロジックは触らない) |

- 依存はすべてこの仕様書のAPIに対して書く。他の担当の完成を待たない。
- water.js / input.js / main.js / audio.js / mascot.js / css は変更禁止(必要と思ったら報告のみ)。
- git 操作(add/commit/push)は行わない。
- 変更したファイルは `node --check <file>` で構文確認する。
- コメントは既存コードにならい日本語で簡潔に。"use strict"、グローバル名前空間方式を維持。

## 6. 参考

- 現行の見た目: docs/screenshot-town.png / docs/screenshot-levee.png(この雰囲気を維持)
- 高さの最大 CFG.MAX_H = 7、海面 CFG.SEA_LEVEL = 1.0 は不変
- CFG.ROW / CFG.EH は旧投影の遺物。互換のため残すが新コードでは使わない(view.tw/th/eh を使う)
