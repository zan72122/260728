# SPEC-GUIDE v1 — 4歳児向けガイド/介助システムの契約書

背景: ユーザーテストで「こね段階から先へ進めない」ことが判明。文字が読めない4歳児でも迷わず「こねる→ねかせる→やく→もりへ」の流れを進められる介助を実装する。docs/SPEC.md / SPEC-GL.md の追補。

方針: **軽い条件付き進行**。少し触れば次へ進める（詰まりゼロ）が、「ちゃんとこねた感」も残す。ガイドは操作した瞬間に引っ込み、自由遊びを邪魔しない。

## ファイル所有権

```
js/ui/guide.js      ← Agent P（新規: 進行バー+光る誘導+音声）
js/ui/ghosthand.js  ← Agent Q（新規: お手本ゴーストハンド）
js/main.js          ← Agent R（統合。P/Q完了後に着手）
css/style.css       ← Agent P（ガイド関連の追記のみ。既存を壊さない）
js/ui/hud.js        ← Agent R（軽微な結線のみ）
```

git commit 禁止。所有外ファイル編集禁止。

## Agent P: `js/ui/guide.js` — 進行バー・誘導・音声

```js
export class GuideBar {
  constructor(root, callbacks)
  // callbacks: { onStepTap(stepId) }   // stepId: 'knead'|'rest'|'cook'|'forest'
  setMethod(method)           // 'bake'|'fry'|'steam' → cook アイコンを 🔥/🍳/♨️ に
  setCurrent(stepId)          // 現在段階を光らせる
  setReady(stepId, ready)     // 次段階の解禁状態。ready=true でアイコンが脈動+色づく
  wiggle(stepId)              // 未解禁アイコンをタップされた時のぷるぷる拒否アニメ
  highlightRect(stepId)       // そのステップアイコンの画面上の {x,y,w,h}（ゴーストハンドのタップ実演先）
  destroy()
}
export const Voice = {
  say(text, opts = {})        // Web Speech API ja-JP。rate 0.95, pitch 1.15。非対応/失敗は黙って無視
  cancel()
  setMuted(bool), muted       // Sound.muted と連動は main.js 側で行う
}
```

- 進行バー: 画面上部中央、4つの丸アイコン（👐 こねる / 🧺 ねかせる / 🔥 やく / 🌲 もりへ）を線でつないだステップ表示。DOM 要素（#hud 内ではなく root 直下に自前 div）。各アイコン直径 52px 以上、間の線は現在までがクリーム色に塗られる。
- 状態表現: 現在=柔らかく光る(箱glow)、解禁済み次step=ゆっくり脈動(scale 1→1.12)+彩色、未解禁=グレー半透明。
- タップ: 全アイコンでタップ→ `onStepTap(stepId)`。解禁判定は main.js 側が行い、未解禁なら main.js が `wiggle()` を呼ぶ。
- CSS は style.css に追記（クラス接頭辞 `.gd-` で衝突回避）。パステル基調、safe-area 上部を考慮。
- Voice: `speechSynthesis` 使用。`ja-JP` ボイスを選択（無ければデフォルト）。同時発話は cancel してから話す。呼び出し過多を防ぐため同一文の 5 秒以内の再発話は無視。

## Agent Q: `js/ui/ghosthand.js` — お手本ゴーストハンド

```js
export class GhostHand {
  constructor()
  play(script)      // script: 下記。再生中に再度呼ばれたら置き換え
  stop()            // ユーザーが画面に触れたら main.js が呼ぶ（即座に消える）
  get active()
  update(dt)
  render(ctx)       // #fx の 2D ctx。パーティクルより上に描く
}
```

script 形式:
```js
{ type: 'knead',  x, y, r }                  // (x,y)中心に往復こねこねを実演（左右に往復+押し込み縮み）
{ type: 'tap',    x, y }                     // その位置をトントンと2回タップ実演
{ type: 'drag',   fromX, fromY, toX, toY }   // つまんで運ぶ軌跡をスーッと実演（弧を描く）
{ type: 'circle', x, y, r }                  // 円を描く丸め実演
{ type: 'stretch', fromX, fromY, toX, toY }  // ゆっくり引っ張る実演
```

- 見た目: 白い丸グローの上に「👆」絵文字（48px 相当）を描画。柔らかい影。半透明 (α0.85)。動きはイージング付きで、押す瞬間は少し縮む（squash）。タッチ点にはタップ波紋。
- ループ再生（scriptを繰り返す）。`stop()` でフェードアウト 0.2s。
- 割り当てを抑える（状態は数値のみ、render で ctx 描画）。DOM 非依存（ctx のみ）で node で update がテスト可能。

## Agent R: `js/main.js` 統合（P/Q 完了後）

### 進行条件（軽い条件付き）
- `interactionScore`: shape 中のジェスチャ回数を数える（press/knead/stretch 等 1 回 = 1 点、knead は 2 点）。
- rest(ねかせる) 解禁: `interactionScore >= 4` または shape 開始から 20 秒。
- cook(やく) 解禁: 発酵を 4 秒以上経験、**または** rest 解禁済みかつ shape でさらに 2 回以上触った（発酵スキップ可。ただし完全ノータッチでは焼けない）。
- forest(もりへ) 解禁: stage done。
- 未解禁タップ: `guide.wiggle(step)` + Voice「もうすこし こねこね してみよう」等の段階別ひとこと + 生地がぷるんと震える。

### タップ代替経路（詰まりゼロ）
- 🧺 タップ（解禁済み）→ 布がかかり発酵開始（従来の布ボタンと同じ。布ボタンは残す）。
- 🔥/🍳/♨️ タップ（解禁済み）→ **生地がふわりとオーブンゾーンへ自動で飛んで焼成開始**（0.6s のイージング移動 → CookStage）。従来のドラッグ経路も残す。
- 🌲 タップ（done 時）→「もりにおく」と同じ動作。
- GuideBar.setCurrent を状態機械の遷移と同期（shape→'knead', ferment→'rest', cook→'cook', done→'forest'）。

### 光る誘導と音声
- 解禁の瞬間: `guide.setReady(step, true)` + Voice の短い声かけ（例: rest 解禁「こねこね じょうず！ つぎは ぬのを かけて ねかせよう」/ cook 解禁「ふっくら してきた！ オーブンで やいてみよう」/ done「やきたて できあがり！ もりに おいてあげよう」）。
- Voice は各解禁につき 1 回だけ。連続発話しない。ミュートは Sound.setMuted と連動（HUD に既存のミュートが無ければ独立フラグで良い）。

### ゴーストハンド（無操作検出）
- 最後のタッチから 8 秒無操作で、現在段階に応じた実演を再生:
  - shape 序盤(interactionScore<4): `knead` 実演（生地中心）
  - rest 解禁済みで未実行: `tap` 実演（GuideBar の 🧺 アイコン位置 = highlightRect）
  - ferment 中: なし（見てるだけで楽しい）
  - cook 解禁済み: `drag` 実演（生地中心 → オーブンゾーン中心）
  - done: `tap` 実演（もりにおくボタン位置）
- ユーザーが画面に触れた瞬間 `ghost.stop()`。実演は 2 回ループしたら 15 秒休む（うるさくしない）。

### 初回チュートリアル
- localStorage `panmori-tut-v1` が無い初回のみ: 起動 3 秒後に knead 実演を先行再生 + Voice「ゆびで こねこね してみよう」。以後の解禁時ゴースト実演も初回は無操作を待たず即再生。完了（初めて森に置いた）で `panmori-tut-v1=done`。2 回目以降は無操作 8 秒ルールのみ。
- localStorage 不可環境でも例外を出さない。

### その他
- `__game.guide` フック追加（GuideBar と ghost への参照、テスト用）。
- 発酵の 20 秒待ちは長いので、**発酵開始 6 秒後から cook を解禁**し、GuideBar の 🔥 が脈動（発酵を最後まで見るのも、途中で焼くのも自由）。
- 既存 HUD・ジェスチャ・GL 描画・フォールバックを壊さない。回帰: scratchpad/itest/full8.js が通り続けること（タップ代替経路が増えても、既存のドラッグ経路テストは不変のはず）。

## 受け入れ基準
- 起動後、一切の予備知識なしで「光る/脈動するものを順にタップするだけ」で 食パン完成→森配置まで到達できる。
- こね→焼き上がりまでの最短所要が 40 秒以内（発酵 6 秒スキップ経路使用時）。
- ガイドは操作中に画面を覆わない。ゴーストハンドはユーザーのタッチで即消える。
- コンソールエラー 0。full8.js 回帰 PASS。
