// フィールド = 「じわっと広がる領域」の計算と低解像度描画。
//
// 仕組み（加法的重み付きボロノイ）:
//   各セルについて score_i = 距離(セル, 種i) - 種iの半径 + ゆらぎ を計算し、
//   score が最小の種がそのセルの持ち主。best < 0 のセルだけ色が塗られるので、
//   半径が育つと領域が「じわっ」と広がり、隣とぶつかった所が境目になる。
//   ゆらぎは種ごとに違うノイズを使うので、境目は硬い直線でなく にじんだ曲線になる。

import { COLORS, FIELD, BG } from './config.js';
import { fbm2 } from './noise.js';

const CONTACT_COOLDOWN_FRAMES = 100; // 一度鳴った境目がもう一度光るまでの間隔

export class Field {
  constructor() {
    this.gw = 0;
    this.gh = 0;
    this.cell = FIELD.CELL;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.frame = 0;
    this.pairLastSeen = new Map(); // 種ペア -> 最後に接していたフレーム
    this.contactEvents = [];       // このフレームで新しく生まれた境目
  }

  resize(width, height) {
    this.gw = Math.max(8, Math.ceil(width / this.cell));
    this.gh = Math.max(8, Math.ceil(height / this.cell));
    const n = this.gw * this.gh;

    this.canvas.width = this.gw;
    this.canvas.height = this.gh;
    this.img = this.ctx.createImageData(this.gw, this.gh);

    this.owner = new Int16Array(n).fill(-1);
    this.best = new Float32Array(n);
    this.second = new Float32Array(n);
    this.secondOwner = new Int16Array(n);
    this.noise = new Float32Array(n);   // 静的な にじみノイズ
    this.phase = new Float32Array(n);   // ぷるぷる用の位相
    this.boundaryCells = new Int32Array(n);
    this.boundaryCount = 0;

    for (let gy = 0; gy < this.gh; gy++) {
      for (let gx = 0; gx < this.gw; gx++) {
        const i = gy * this.gw + gx;
        this.noise[i] = fbm2(gx * 0.16, gy * 0.16);
        this.phase[i] = fbm2(gx * 0.05 + 99, gy * 0.05 + 47) * Math.PI * 2;
      }
    }
  }

  // seeds: {id, x, y, r, colorIdx, jiggle} の配列（x, y は CSS ピクセル）
  compute(seeds, t, globalJiggle) {
    this.frame++;
    this.contactEvents.length = 0;
    this.boundaryCount = 0;

    const { gw, gh, cell, owner, best, second, secondOwner, noise, phase } = this;
    const nSeeds = seeds.length;
    const jigAmps = [];
    const sx = [], sy = [], sr = [], ox = [], oy = [];
    for (let s = 0; s < nSeeds; s++) {
      const seed = seeds[s];
      sx.push(seed.x / cell - 0.5);
      sy.push(seed.y / cell - 0.5);
      sr.push(seed.r / cell);
      // 種ごとに違う場所のノイズを参照するためのオフセット
      ox.push((seed.id * 37) % gw);
      oy.push((seed.id * 73) % gh);
      const amount = Math.min(1, seed.jiggle + globalJiggle);
      jigAmps.push((FIELD.JIGGLE_BASE + (FIELD.JIGGLE_MAX - FIELD.JIGGLE_BASE) * amount) / cell);
    }
    const noiseAmp = FIELD.NOISE_AMP / cell;
    const wobT = t * 2.7;

    for (let gy = 0; gy < gh; gy++) {
      const rowBase = gy * gw;
      for (let gx = 0; gx < gw; gx++) {
        const i = rowBase + gx;
        let b1 = 1e9, b2 = 1e9, o1 = -1, o2 = -1;
        const sv = Math.sin(wobT + phase[i]); // このセルの ぷるぷる位相
        for (let s = 0; s < nSeeds; s++) {
          const dx = gx - sx[s];
          const dy = gy - sy[s];
          const ni = ((gx + ox[s]) % gw) + ((gy + oy[s]) % gh) * gw;
          const wob = noise[ni] * (noiseAmp + sv * jigAmps[s]);
          const score = Math.sqrt(dx * dx + dy * dy) - sr[s] + wob;
          if (score < b1) {
            b2 = b1; o2 = o1;
            b1 = score; o1 = s;
          } else if (score < b2) {
            b2 = score; o2 = s;
          }
        }
        best[i] = b1;
        second[i] = b2;
        owner[i] = b1 < 0 ? o1 : -1;
        secondOwner[i] = o2;
      }
    }

    this.detectBoundaries(seeds);
    this.paint(seeds, t);
  }

  detectBoundaries(seeds) {
    const { gw, gh, best, second, owner, secondOwner } = this;
    const edge = FIELD.EDGE_SOFT / this.cell;
    const n = gw * gh;
    for (let i = 0; i < n; i++) {
      if (owner[i] < 0) continue;
      // 隣の領域も この場所を覆っている（second < 0）なら、ここは領域同士の境目
      if (second[i] < 0 && second[i] - best[i] < edge) {
        this.boundaryCells[this.boundaryCount++] = i;
        const a = seeds[owner[i]], b = seeds[secondOwner[i]];
        if (a && b && a.colorIdx !== undefined) {
          const key = a.id < b.id ? a.id * 4096 + b.id : b.id * 4096 + a.id;
          const last = this.pairLastSeen.get(key);
          if (last === undefined || this.frame - last > CONTACT_COOLDOWN_FRAMES) {
            this.contactEvents.push({
              x: ((i % gw) + 0.5) * this.cell,
              y: (Math.floor(i / gw) + 0.5) * this.cell,
              aColor: a.colorIdx,
              bColor: b.colorIdx,
            });
          }
          this.pairLastSeen.set(key, this.frame);
        }
      }
    }
  }

  paint(seeds, t) {
    const { gw, gh, img, best, second, owner, noise } = this;
    const data = img.data;
    const edge = FIELD.EDGE_SOFT / this.cell;
    const rim = FIELD.RIM_SOFT / this.cell;
    const shimmer = Math.sin(t * 0.8) * 3;

    let p = 0;
    for (let gy = 0; gy < gh; gy++) {
      const yMix = gy / gh;
      for (let gx = 0; gx < gw; gx++, p += 4) {
        const i = gy * gw + gx;
        const o = owner[i];
        let r, g, b;
        if (o < 0) {
          // 浅い水たまりの背景（うっすら波もよう）
          const shade = noise[i] * 4.5 + shimmer * noise[(i + 97) % (gw * gh)];
          r = BG.TOP[0] + (BG.BOTTOM[0] - BG.TOP[0]) * yMix + shade;
          g = BG.TOP[1] + (BG.BOTTOM[1] - BG.TOP[1]) * yMix + shade;
          b = BG.TOP[2] + (BG.BOTTOM[2] - BG.TOP[2]) * yMix + shade;
        } else {
          const col = COLORS[seeds[o].colorIdx].rgb;
          r = col[0]; g = col[1]; b = col[2];

          // 種の近くほど明るい「ゼリーの芯」
          const depth = -best[i];
          const core = Math.max(0, 1 - depth / (seeds[o].r / this.cell + 0.01));
          let light = core * core * 0.22;

          // 成長中の外周は白く光るリム（じわっと広がって見える）
          if (best[i] > -rim) {
            light += (1 + best[i] / rim) * 0.55;
          }
          // 領域同士の境目は光の線
          if (second[i] < 0) {
            const diff = second[i] - best[i];
            if (diff < edge) {
              const k = 1 - diff / edge;
              light += k * k * 0.4 + k * 0.55;
            }
          }
          // ゼリーらしい濃淡
          light += noise[i] * 0.045;

          if (light > 0) {
            r += (255 - r) * Math.min(1, light);
            g += (255 - g) * Math.min(1, light);
            b += (255 - b) * Math.min(1, light);
          } else {
            r *= 1 + light; g *= 1 + light; b *= 1 + light;
          }
        }
        data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  // ---- 参照ヘルパー（CSSピクセル座標で受け取る） ----

  cellIndexAt(x, y) {
    const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cell)));
    const gy = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cell)));
    return gy * this.gw + gx;
  }

  ownerAt(x, y) {
    return this.owner[this.cellIndexAt(x, y)];
  }

  // owner が seedIdx で、領域の内側（深さ minDepth 以上）のセルをランダムに探す
  randomInteriorCell(seedIdx, minDepth, tries = 24) {
    const n = this.gw * this.gh;
    const depth = minDepth / this.cell;
    for (let k = 0; k < tries; k++) {
      const i = (Math.random() * n) | 0;
      if (this.owner[i] === seedIdx && -this.best[i] > depth &&
          this.second[i] - this.best[i] > depth) {
        return {
          x: ((i % this.gw) + 0.5) * this.cell,
          y: (Math.floor(i / this.gw) + 0.5) * this.cell,
        };
      }
    }
    return null;
  }

  randomBoundaryCell() {
    if (this.boundaryCount === 0) return null;
    const i = this.boundaryCells[(Math.random() * this.boundaryCount) | 0];
    return {
      x: ((i % this.gw) + 0.5) * this.cell,
      y: (Math.floor(i / this.gw) + 0.5) * this.cell,
    };
  }
}
