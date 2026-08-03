// js/ui/ghosthand.js — Agent Q
// GhostHand: 4歳児向け「お手本」実演。半透明の白く光る手(👆)が、こねる/タップする/
// つまんで運ぶ/丸める/伸ばす、の動きをループ実演する。SPEC-GUIDE.md の
// 「Agent Q: js/ui/ghosthand.js」セクション厳守。
//
// 方針:
//  - update(dt) は数値計算のみ(ctx 非依存)。node から直接呼んでテストできる。
//  - render(ctx) は #fx の 2D コンテキストのみに依存し、DOM には一切触れない。
//  - update/render はどちらも新規オブジェクト(配列・クロージャ等)を割り当てない。
//    script の値は再生開始時(play())にプレーンな数値プロパティへコピーし、
//    以後は使い回す。光の輪はグラデーションではなく重ね円で表現する
//    (js/fx/particles.js と同じ理由: createRadialGradient を毎フレーム作らない)。
//  - どの実演も等速直線は使わず、必ずイージング(加減速)を通す。

const FADE_DUR = 0.2;        // stop() 後にフェードアウトしきるまでの秒数
const BASE_ALPHA = 0.85;     // 基本の不透明度
const EMOJI_SIZE = 48;       // 👆 の描画サイズ(px 相当)
const HAND_EMOJI = '👆'; // 👆

// 各 script の1周期の長さ(秒)。仕様: 1.5〜2.5秒程度。
const PERIOD = {
  knead: 2.0,
  tap: 1.6,
  drag: 2.2,
  circle: 2.4,
  stretch: 2.2,
};

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
// sin ベースの滑らかな加減速。update/render は等速直線を使わないための基本イージング。
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
// 戻り動作にわずかなバネのオーバーシュートを与える(伸ばす実演の「戻る」に使用)。
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

export class GhostHand {
  constructor() {
    this.active = false;

    // --- 再生中の script を展開した数値プロパティ(play() 時のみ書き込む) ---
    this._type = '';
    this._x = 0;
    this._y = 0;
    this._r = 40;
    this._fromX = 0;
    this._fromY = 0;
    this._toX = 0;
    this._toY = 0;
    this._period = 2.0;

    // --- 進行状態 ---
    this._t = 0;            // 現在ループ内の経過秒(0..period)
    this._playing = false;  // true=ループ再生中, false=フェードアウト中/停止済
    this._fade = 0;         // 0..1 フェードアウト係数(1=フル表示)

    // --- render() が毎フレーム参照する出力スロット(使い回し、新規オブジェクトなし) ---
    this._cx = 0;
    this._cy = 0;
    this._scaleX = 1;
    this._scaleY = 1;
    this._fadeMul = 1;      // 型ごとの追加の薄め係数(drag の戻りなど)
    this._ripple1Age = -1;  // tap の波紋1: 押し込みピークからの経過秒。負なら非表示
    this._ripple2Age = -1;  // tap の波紋2
  }

  // 実演を(再)生成する。再生中に呼ばれたら即座に置き換わる。
  play(script) {
    this._type = script.type;
    this._x = script.x || 0;
    this._y = script.y || 0;
    this._r = script.r || 40;
    this._fromX = script.fromX || 0;
    this._fromY = script.fromY || 0;
    this._toX = script.toX || 0;
    this._toY = script.toY || 0;
    this._period = PERIOD[this._type] || 2.0;

    this._t = 0;
    this._playing = true;
    this._fade = 1;
    this.active = true;

    this._computePose(); // 最初の update() 前に render() されても正しい姿勢にする
  }

  // ユーザーが画面に触れた瞬間などに main.js から呼ばれる。即座に消えず 0.2s でフェードアウト。
  stop() {
    if (!this.active) return;
    this._playing = false;
  }

  update(dt) {
    if (!this.active) return;
    if (!(dt > 0)) dt = 0; // NaN/負値を弾く
    if (dt > 0.25) dt = 0.25; // タブ復帰などの巨大 dt でワープしないための保険

    this._t += dt;
    if (this._period > 0 && this._t >= this._period) {
      this._t -= this._period * Math.floor(this._t / this._period);
    }

    if (!this._playing) {
      this._fade -= dt / FADE_DUR;
      if (this._fade <= 0) {
        this._fade = 0;
        this.active = false;
      }
    }

    this._computePose();
  }

  // --- 姿勢計算: this._cx/_cy/_scaleX/_scaleY/_fadeMul/_ripple*Age を更新する ---
  _computePose() {
    this._fadeMul = 1;
    this._ripple1Age = -1;
    this._ripple2Age = -1;

    switch (this._type) {
      case 'knead':
        this._poseKnead();
        break;
      case 'tap':
        this._poseTap();
        break;
      case 'drag':
        this._poseDrag();
        break;
      case 'circle':
        this._poseCircle();
        break;
      case 'stretch':
        this._poseStretch();
        break;
      default:
        this._cx = this._x;
        this._cy = this._y;
        this._scaleX = 1;
        this._scaleY = 1;
    }
  }

  // こねる: 左右に往復(1周期に2往復)しながら、端に着いた瞬間だけぎゅっと押し込む(squash)。
  _poseKnead() {
    const phase = this._t / this._period; // 0..1
    const angle = phase * Math.PI * 4;     // 2 サイクル分の往復
    const s = Math.sin(angle);
    const pulse = Math.pow(Math.abs(s), 6); // 端付近だけ鋭く立ち上がる押し込みパルス

    this._cx = this._x + s * this._r;
    this._cy = this._y + pulse * 5; // 押し込む瞬間わずかに沈む
    this._scaleY = 1 - 0.30 * pulse;
    this._scaleX = 1 + 0.22 * pulse;
  }

  // タップ: トントンと2回。押す瞬間だけ squash、離れている間はふわっとホバー。
  _poseTap() {
    const dur = 0.34;   // 1回のタップの長さ
    const gap = 0.22;   // タップ間の間隔
    const hover = 26;   // ホバー中の浮き上がり量(px)
    const p1Start = 0;
    const p2Start = dur + gap;

    const local1 = this._t - p1Start;
    const b1 = (local1 >= 0 && local1 <= dur) ? Math.sin(Math.PI * (local1 / dur)) : 0;
    const local2 = this._t - p2Start;
    const b2 = (local2 >= 0 && local2 <= dur) ? Math.sin(Math.PI * (local2 / dur)) : 0;
    const press = b1 > b2 ? b1 : b2;

    this._cx = this._x;
    this._cy = this._y - hover * (1 - press);
    this._scaleY = 1 - 0.26 * press;
    this._scaleX = 1 + 0.18 * press;

    // 波紋: それぞれのタップの押し込みピークからの経過秒(0.6秒でフェード)
    const peak1 = p1Start + dur / 2;
    const peak2 = p2Start + dur / 2;
    const age1 = this._t - peak1;
    const age2 = this._t - peak2;
    this._ripple1Age = (age1 >= 0 && age1 <= 0.6) ? age1 : -1;
    this._ripple2Age = (age2 >= 0 && age2 <= 0.6) ? age2 : -1;
  }

  // つまんで運ぶ: 弧を描いてスーッと移動 → 少し置いて落ち着く → 薄くなりながら元へ戻る。
  _poseDrag() {
    const goDur = 0.55 * this._period;
    const holdDur = 0.12 * this._period;
    const backDur = Math.max(0.0001, this._period - goDur - holdDur);
    const t = this._t;

    const dist = Math.hypot(this._toX - this._fromX, this._toY - this._fromY);
    const arcH = Math.min(90, Math.max(18, dist * 0.28));

    if (t < goDur) {
      const u = easeInOutSine(clamp01(t / goDur));
      this._cx = lerp(this._fromX, this._toX, u);
      this._cy = lerp(this._fromY, this._toY, u) - Math.sin(u * Math.PI) * arcH;
      const grab = u < 0.15 ? 1 - u / 0.15 : 0; // つまむ瞬間の軽い squash
      this._scaleY = 1 - 0.12 * grab;
      this._scaleX = 1 + 0.10 * grab;
    } else if (t < goDur + holdDur) {
      const u = clamp01((t - goDur) / holdDur);
      const settle = 1 - u; // 置いた瞬間の軽い squash からニュートラルへ
      this._cx = this._toX;
      this._cy = this._toY;
      this._scaleY = 1 - 0.22 * settle;
      this._scaleX = 1 + 0.16 * settle;
    } else {
      const u = easeInOutSine(clamp01((t - goDur - holdDur) / backDur));
      this._cx = lerp(this._toX, this._fromX, u);
      this._cy = lerp(this._toY, this._fromY, u);
      this._scaleY = 1;
      this._scaleX = 1;
      this._fadeMul = 0.35 + 0.65 * (1 - u); // 戻りは薄く見せ「実演の合間」を表す
    }
  }

  // 丸める: 円軌道を1周半。角速度に緩やかな揺らぎを足し、等速回転の機械的な
  // 印象を避ける(ループの継ぎ目では揺らぎがちょうど0に戻るので途切れない)。
  _poseCircle() {
    const phase = this._t / this._period;
    const wobble = 0.05 * Math.sin(phase * Math.PI * 6); // phase=0/1 で 0 に戻る
    const angle = -Math.PI / 2 + (phase * 1.5 + wobble) * Math.PI * 2; // 上から時計回りに1周半
    this._cx = this._x + Math.cos(angle) * this._r;
    this._cy = this._y + Math.sin(angle) * this._r;

    const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 8);
    this._scaleY = 1 - 0.10 * pulse;
    this._scaleX = 1 + 0.08 * pulse;
  }

  // 伸ばす: ゆっくり引っぱって少し保持し、バネのように戻る。
  _poseStretch() {
    const outDur = 0.42 * this._period;
    const holdDur = 0.14 * this._period;
    const backDur = Math.max(0.0001, this._period - outDur - holdDur);
    const t = this._t;
    let u; // 0=from, 1=to 相当の位置係数

    if (t < outDur) {
      u = easeInOutSine(clamp01(t / outDur));
    } else if (t < outDur + holdDur) {
      u = 1 + Math.sin(((t - outDur) / holdDur) * Math.PI) * 0.015; // 保持中の微かな震え
    } else {
      const bu = clamp01((t - outDur - holdDur) / backDur);
      u = 1 - easeOutBack(bu); // 少しバネのように戻る
    }

    this._cx = lerp(this._fromX, this._toX, u);
    this._cy = lerp(this._fromY, this._toY, u);
    const stretchAmt = clamp01(u);
    this._scaleX = 1 + 0.16 * stretchAmt;
    this._scaleY = 1 - 0.10 * stretchAmt;
  }

  render(ctx) {
    if (!this.active) return;
    const alpha = BASE_ALPHA * this._fade * this._fadeMul;
    if (alpha <= 0.003) return;

    const x = this._cx;
    const y = this._cy;
    const sx = this._scaleX;
    const sy = this._scaleY;

    this._renderRipple(ctx, this._ripple1Age, x, y, alpha);
    this._renderRipple(ctx, this._ripple2Age, x, y, alpha);

    // 柔らかい影
    ctx.fillStyle = `rgba(60,40,20,${(alpha * 0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y + EMOJI_SIZE * 0.42, EMOJI_SIZE * 0.30 * sx, EMOJI_SIZE * 0.12 * sx, 0, 0, Math.PI * 2);
    ctx.fill();

    // 白い丸グロー(グラデーションを毎フレーム生成しないよう、重ね円で表現)
    const glowR = EMOJI_SIZE * 0.62;
    ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.20).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, glowR * 1.35 * sx, glowR * 1.35 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.32).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, glowR * 0.95 * sx, glowR * 0.95 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, glowR * 0.60 * sx, glowR * 0.60 * sy, 0, 0, Math.PI * 2);
    ctx.fill();

    // 手の絵文字(squash 表現のためだけに scale を使う。この GhostHand は単一エンティティなので
    // save/restore のコストは無視できる)
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${EMOJI_SIZE}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.fillText(HAND_EMOJI, 0, 0);
    ctx.restore();
  }

  // タップの波紋を1つ描く。age<0 なら非表示。
  _renderRipple(ctx, age, x, y, baseAlpha) {
    if (age < 0) return;
    const u = clamp01(age / 0.6);
    const r = EMOJI_SIZE * 0.36 + u * 70;
    const a = baseAlpha * 0.5 * (1 - u);
    if (a <= 0.003) return;
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.lineWidth = 3 * (1 - u * 0.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
