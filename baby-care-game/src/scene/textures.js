import * as THREE from 'three';

// 画像ファイルを持たずに済むよう、模様はすべて canvas で描いて作る。

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** 木目のゆか。板の継ぎ目とやわらかい木目線。 */
export function makeWoodTexture() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  const planks = 7;
  const ph = c.height / planks;
  const tones = ['#e6c69c', '#dfbc90', '#e9cda6', '#dcb789', '#e4c399', '#e9cba2', '#ddb98d'];

  for (let i = 0; i < planks; i++) {
    g.fillStyle = tones[i % tones.length];
    g.fillRect(0, i * ph, c.width, ph);

    // 木目
    g.strokeStyle = 'rgba(150, 112, 70, 0.20)';
    g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      const y = i * ph + ph * (0.15 + 0.18 * k);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 32) {
        g.lineTo(x, y + Math.sin((x + i * 90 + k * 40) * 0.02) * 3.2);
      }
      g.stroke();
    }

    // 板の継ぎ目
    g.fillStyle = 'rgba(140, 100, 62, 0.32)';
    g.fillRect(0, i * ph, c.width, 2.5);
  }
  return finish(c, 4, 4);
}

/** お城の石積み。角を丸めた淡いブロックで、やさしい印象にする。 */
export function makeStoneTexture() {
  const c = canvas(512, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#efe6d6';
  g.fillRect(0, 0, c.width, c.height);

  const rows = 5;
  const bh = c.height / rows;
  const bw = 96;
  const tones = ['#f7f0e4', '#f2e9da', '#faf4ea', '#efe5d3'];

  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < c.width + bw; x += bw) {
      const px = x + offset + 3;
      const py = r * bh + 3;
      const w = bw - 6;
      const h = bh - 6;
      g.fillStyle = tones[(r * 3 + Math.round(x / bw)) % tones.length];
      g.beginPath();
      g.roundRect(px, py, w, h, 10);
      g.fill();
    }
  }
  return finish(c, 3, 1.4);
}

/** ラグ。パステルの同心円。 */
export function makeRugTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const rings = ['#f9c9d6', '#fdf6ea', '#bfe6d5', '#fdf6ea', '#c7e3f7'];
  for (let i = 0; i < rings.length; i++) {
    g.fillStyle = rings[i];
    g.beginPath();
    g.arc(128, 128, 128 - i * 24, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** 窓の外に見える空。 */
export function makeSkyTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#bfe0f7');
  grad.addColorStop(1, '#eaf6ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  g.fillStyle = 'rgba(255,255,255,0.95)';
  const puff = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  puff(80, 96, 30); puff(112, 86, 38); puff(148, 100, 26);
  puff(170, 170, 22); puff(196, 164, 28);
  return finish(c);
}
