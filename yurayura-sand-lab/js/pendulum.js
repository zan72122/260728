// 吊られたカップの物理。減衰する2次元振り子として動く。
// 離すたびにモードをランダム化して、リング・花・リサージュ風の
// 軌跡が生まれるようにする(子どもには見えない裏側)。
import { rand, lerp, pickOne } from './utils.js';

const SUBSTEPS = 4;

export class Pendulum {
  /**
   * @param {{x:number,y:number}} home 静止位置
   * @param {{rx:number,ry:number}} limits 可動範囲の楕円半径
   */
  constructor(home, limits) {
    this.home = home;
    this.rx = limits.rx;
    this.ry = limits.ry;
    // home からの変位と速度
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.grabbed = false;
    this.targetX = 0;
    this.targetY = 0;
    this.settleNotified = true;
    this.settleAmp = 14;
    this.settleSpeed = 26;
    this.randomizeMode();
  }

  /** 画面リサイズ時に座標系を更新(相対位置は維持) */
  applyLayout(home, limits, scale) {
    const fracX = this.rx > 0 ? this.x / this.rx : 0;
    const fracY = this.ry > 0 ? this.y / this.ry : 0;
    this.home = home;
    this.rx = limits.rx;
    this.ry = limits.ry;
    this.x = fracX * limits.rx;
    this.y = fracY * limits.ry;
    this.settleAmp = 14 * scale;
    this.settleSpeed = 26 * scale;
  }

  /** 離すたびに揺れの個性を変える(毎回少し違う模様の源) */
  randomizeMode() {
    const base = rand(2.0, 2.9); // 基本角振動数 [rad/s]
    const roll = Math.random();
    if (roll < 0.4) {
      // 歳差するリング・うずまき
      this.wx = base;
      this.wy = base * rand(0.995, 1.005);
      this.spin = rand(0.15, 0.6) * (Math.random() < 0.5 ? -1 : 1);
    } else if (roll < 0.75) {
      // わずかな周波数差で花びらのような模様
      this.wx = base;
      this.wy = base * rand(1.02, 1.09);
      this.spin = rand(-0.15, 0.15);
    } else {
      // リサージュ比(2:3, 1:2, 3:4)+微妙なズレ
      const ratio = pickOne([1.5, 2.0, 4 / 3]);
      this.wx = base * rand(0.99, 1.01);
      this.wy = base * ratio * rand(0.99, 1.01);
      this.spin = 0;
    }
    this.damping = rand(0.05, 0.11); // 減衰率 [1/s]
  }

  /** 画面上の絶対位置 */
  get pos() {
    return { x: this.home.x + this.x, y: this.home.y + this.y };
  }

  speed() {
    return Math.hypot(this.vx, this.vy);
  }

  amplitude() {
    return Math.hypot(this.x, this.y);
  }

  /** カップをつかむ(物理は一時停止し、指を追いかける) */
  grab(px, py) {
    this.grabbed = true;
    this.grabTo(px, py);
  }

  grabTo(px, py) {
    this.targetX = px - this.home.x;
    this.targetY = py - this.home.y;
  }

  /** 指を離す。フリック速度を初速にして揺れを開始する。 */
  release(vx, vy) {
    if (!this.grabbed) return;
    this.grabbed = false;
    const speed = Math.hypot(vx, vy);
    const capped = Math.min(speed, 1200);
    const scale = speed > 0 ? capped / speed : 0;
    this.vx = vx * scale;
    this.vy = vy * scale;
    this.randomizeMode();
    this.settleNotified = false;
  }

  /** そっと押す。タップ位置から離れる向きに小さな力を加える。 */
  push(px, py, impulse, maxSpeed) {
    if (this.grabbed) return;
    const pos = this.pos;
    let dx = pos.x - px;
    let dy = pos.y - py;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      // 真上を押されたときはランダム方向へ
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx /= d;
      dy /= d;
    }
    this.vx += dx * impulse;
    this.vy += dy * impulse;
    const s = this.speed();
    if (s > maxSpeed) {
      this.vx *= maxSpeed / s;
      this.vy *= maxSpeed / s;
    }
    this.settleNotified = false;
  }

  update(dt) {
    if (this.grabbed) {
      // 指へなめらかに追従(ばね感を出すゆるいラープ)
      const follow = 1 - Math.pow(0.0001, dt); // dt 非依存の追従率
      const nx = lerp(this.x, this.targetX, follow);
      const ny = lerp(this.y, this.targetY, follow);
      this.vx = (nx - this.x) / Math.max(dt, 1e-4);
      this.vy = (ny - this.y) / Math.max(dt, 1e-4);
      this.x = nx;
      this.y = ny;
      this.clampToEllipse();
      return;
    }
    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      // 復元力 + 減衰 + 歳差(速度に直交する弱い力)
      const ax = -this.wx * this.wx * this.x - 2 * this.damping * this.vx + this.spin * this.vy;
      const ay = -this.wy * this.wy * this.y - 2 * this.damping * this.vy - this.spin * this.vx;
      this.vx += ax * h;
      this.vy += ay * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
    }
    this.clampToEllipse();
  }

  /** かみの外へ出ないよう、楕円の内側にやわらかく閉じ込める */
  clampToEllipse() {
    const ex = this.x / this.rx;
    const ey = this.y / this.ry;
    const e = ex * ex + ey * ey;
    if (e <= 1) return;
    const scale = 1 / Math.sqrt(e);
    this.x *= scale;
    this.y *= scale;
    // 外向き速度成分を減衰させて、壁で跳ねすぎないようにする
    const nx = this.x / (this.rx * this.rx);
    const ny = this.y / (this.ry * this.ry);
    const nLen = Math.hypot(nx, ny) || 1;
    const outward = (this.vx * nx + this.vy * ny) / nLen;
    if (outward > 0) {
      this.vx -= (nx / nLen) * outward * 1.4;
      this.vy -= (ny / nLen) * outward * 1.4;
    }
  }

  /** 揺れがほぼ止まったか(「できあがり」の合図用) */
  isSettled() {
    return !this.grabbed && this.amplitude() < this.settleAmp && this.speed() < this.settleSpeed;
  }
}
