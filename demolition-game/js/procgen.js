/* procgen.js — 建築モード「🎲 AIおまかせ建築」
 * オフライン・ルールベースの手続き生成。外部API・外部データは一切使わない。
 * おしろ/タワー/おうち/ロケット/まちなみ の5テンプレートをランダムに組み立てて
 * window.GameBuild.setCellAt() 経由で配置する。
 */
(function () {
  'use strict';

  const build = window.GameBuild;
  const ui = window.GameUI;
  const audio = window.GameAudio;

  const COLS = build.COLS, ROWS = build.ROWS, LAYERS = build.LAYERS;
  const CENTER = Math.floor(COLS / 2);

  /* そざい/いろ ブラシ番号（levels.js の BRUSHES と対応）
   * 0..4 = いろ(コーラル/レモン/ミント/そら/ライラック), 5=いし, 6=き, 7=ゴム, 8=ガラス */
  const COLORS = [0, 1, 2, 3, 4];
  const STONE = 5, WOOD = 6, RUBBER = 7, GLASS = 8;

  function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function otherColor(c) { let n = choice(COLORS); if (n === c) n = (n + 1) % COLORS.length; return n; }

  /* 範囲外は静かにスキップ（true=継続可）。上限到達など本当の失敗のみ false を返す。
   * ループはすべて有限のfor文なので無限ループの心配はないが、
   * 上限到達後の余計な配置は早期returnで打ち切る。 */
  function place(c, r, layer, p, s) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS || layer < 0 || layer >= LAYERS) return true;
    const ok = build.setCellAt(c, r, layer, { p: p, s: s });
    if (!ok) {
      const cur = build.getCell(c, r, layer);
      if (!cur || cur.p !== p || cur.s !== s) return false; /* 上限到達など本当の失敗 */
    }
    return true;
  }

  function rectFill(c0, c1, r0, r1, layer, p, s) {
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        if (!place(c, r, layer, p, s)) return false;
      }
    }
    return true;
  }

  /* ---------- おしろ 🏰 ---------- */
  function buildTowerAt(c0, w, layer, wallColor, roofColor, h) {
    if (!rectFill(c0, c0 + w - 1, 0, h - 1, layer, wallColor, 'sq')) return;
    for (let c = c0; c < c0 + w; c++) place(c, h, layer, roofColor, 'tri');
    if (w >= 3) place(c0 + Math.floor(w / 2), h + 1, layer, roofColor, 'tri');
  }

  function buildCastle() {
    const layer = 1;
    const roofColor = choice(COLORS);
    const trimColor = otherColor(roofColor);
    const keepW = randInt(11, 15);
    const keepH = randInt(6, 8);
    const left = CENTER - Math.floor(keepW / 2);
    const right = left + keepW - 1;

    if (!rectFill(left, right, 0, keepH - 1, layer, STONE, 'sq')) return;

    /* 色の帯（トリム） */
    if (keepH >= 4) {
      for (let c = left; c <= right; c++) place(c, keepH - 2, layer, trimColor, 'sq');
    }
    /* 城壁の凹凸（そとひ） */
    for (let c = left; c <= right; c += 2) place(c, keepH, layer, STONE, 'sq');

    /* もん */
    const gc0 = CENTER - 1, gc1 = CENTER;
    for (let c = gc0; c <= gc1; c++) {
      place(c, 0, layer, WOOD, 'sq');
      place(c, 1, layer, WOOD, 'sq');
    }

    /* まど（格子状） */
    for (let r = 3; r <= keepH - 3; r += 2) {
      for (let c = left + 1; c <= right - 1; c += 2) {
        place(c, r, layer, GLASS, 'sq');
      }
    }

    /* 塔（かならず両角、大きい城には中塔も） */
    const towerH = keepH + randInt(3, 6);
    buildTowerAt(left - 3, 3, layer, STONE, roofColor, towerH);
    buildTowerAt(right + 1, 3, layer, STONE, roofColor, towerH);
    if (keepW >= 14) {
      const midH = keepH + randInt(1, 3);
      buildTowerAt(left + 2, 3, layer, STONE, roofColor, midH);
      buildTowerAt(right - 4, 3, layer, STONE, roofColor, midH);
    }
  }

  /* ---------- タワー 🗼 ---------- */
  function towerSeg(centerCol, w, r0, h, layer, color) {
    const left = centerCol - Math.floor((w - 1) / 2);
    const right = left + w - 1;
    rectFill(left, right, r0, r0 + h - 1, layer, color, 'sq');
    const bandR = r0 + Math.floor(h / 2);
    if (right > left) {
      for (let c = left + 1; c <= right - 1; c++) place(c, bandR, layer, GLASS, 'sq');
    } else {
      place(left, bandR, layer, GLASS, 'sq');
    }
    return r0 + h;
  }

  function buildTower() {
    const layer = 1;
    const bodyColor = choice(COLORS);
    const roofColor = otherColor(bodyColor);
    const totalH = randInt(14, 18);
    let baseW = randInt(5, 7);
    if (baseW % 2 === 0) baseW++;
    const w2 = Math.max(3, baseW - 2);
    const w3 = Math.max(1, baseW - 4);

    const seg1H = Math.max(4, Math.floor(totalH * 0.42));
    const seg2H = Math.max(3, Math.floor(totalH * 0.34));
    const seg3H = Math.max(3, totalH - seg1H - seg2H);

    let r = 0;
    r = towerSeg(CENTER, baseW, r, seg1H, layer, bodyColor);
    r = towerSeg(CENTER, w2, r, seg2H, layer, bodyColor);
    r = towerSeg(CENTER, w3, r, seg3H, layer, bodyColor);

    /* とがった屋根（はば全部→さらに中心だけ、で先細りのスパイアに） */
    const left3 = CENTER - Math.floor((w3 - 1) / 2);
    for (let c = left3; c < left3 + w3; c++) place(c, r, layer, roofColor, 'tri');
    if (w3 >= 3) place(CENTER, r + 1, layer, roofColor, 'tri');
  }

  /* ---------- おうち 🏠 ---------- */
  function buildHouses() {
    const layer = 1, frontLayer = 2;
    const houseCount = randInt(2, 3);
    const gap = 1;
    const widths = [];
    for (let i = 0; i < houseCount; i++) widths.push(randInt(5, 7));
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (houseCount - 1);
    let c0 = CENTER - Math.floor(totalW / 2);

    for (let i = 0; i < houseCount; i++) {
      const w = widths[i];
      const h = randInt(4, 6);
      const wallColor = choice([WOOD, 0, 1, 2, 3, 4]);
      const roofColor = otherColor(wallColor === WOOD ? choice(COLORS) : wallColor);

      if (!rectFill(c0, c0 + w - 1, 0, h - 1, layer, wallColor, 'sq')) { c0 += w + gap; continue; }

      /* とびら */
      const doorC = c0 + Math.floor(w / 2);
      place(doorC, 0, layer, WOOD, 'sq');
      if (h >= 2) place(doorC, 1, layer, WOOD, 'sq');

      /* まど */
      if (h >= 4) {
        place(c0 + 1, h - 2, layer, GLASS, 'sq');
        place(c0 + w - 2, h - 2, layer, GLASS, 'sq');
      }

      /* さんかく屋根 */
      for (let c = c0; c < c0 + w; c++) place(c, h, layer, roofColor, 'tri');
      if (w >= 6) {
        for (let c = c0 + 1; c < c0 + w - 1; c++) place(c, h + 1, layer, roofColor, 'tri');
      }

      /* ひくい塀（まえレイヤー） */
      for (let c = c0 - 1; c <= c0 + w; c++) place(c, 0, frontLayer, choice(COLORS), 'sq');

      c0 += w + gap;
    }
  }

  /* ---------- ロケット 🚀 ---------- */
  function buildRocket() {
    const layer = 1;
    const bodyColor = choice(COLORS);
    const finColor = otherColor(bodyColor);
    let bodyW = randInt(4, 6);
    if (bodyW % 2 === 0) bodyW++;
    if (bodyW > 7) bodyW = 7;
    const bodyH = randInt(11, 14);
    const left = CENTER - Math.floor(bodyW / 2);
    const right = left + bodyW - 1;

    /* はっしゃだい */
    const padW = bodyW + 4;
    const padLeft = CENTER - Math.floor(padW / 2);
    rectFill(padLeft, padLeft + padW - 1, 0, 1, layer, STONE, 'sq');

    /* どうたい */
    const bodyR0 = 2;
    if (!rectFill(left, right, bodyR0, bodyR0 + bodyH - 1, layer, bodyColor, 'sq')) return;

    /* いろの帯 */
    const stripeR = bodyR0 + Math.floor(bodyH * 0.28);
    for (let c = left; c <= right; c++) place(c, stripeR, layer, STONE, 'sq');

    /* まど（丸） */
    const midR = bodyR0 + Math.floor(bodyH * 0.6);
    place(CENTER, midR, layer, GLASS, 'cir');

    /* フィン */
    for (let dr = 0; dr < 3; dr++) {
      place(left - 1, bodyR0 + dr, layer, finColor, 'tri');
      place(right + 1, bodyR0 + dr, layer, finColor, 'tri');
    }

    /* せんたん */
    const topR = bodyR0 + bodyH;
    if (bodyW >= 5) {
      for (let c = left + 1; c <= right - 1; c++) place(c, topR, layer, bodyColor, 'tri');
    } else {
      for (let c = left; c <= right; c++) place(c, topR, layer, bodyColor, 'tri');
    }
    place(CENTER, topR + 1, layer, bodyColor, 'cir');
  }

  /* ---------- まちなみ 🏙️ ---------- */
  function buildCity() {
    const backLayer = 0, midLayer = 1, frontLayer = 2;

    /* おく：高いビル群 */
    let c = randInt(2, 5);
    const backCount = randInt(3, 4);
    for (let i = 0; i < backCount && c < COLS - 5; i++) {
      const w = randInt(4, 6);
      const h = randInt(10, 15);
      const color = choice([STONE, GLASS, 0, 1, 2, 3, 4]);
      if (!rectFill(c, c + w - 1, 0, h - 1, backLayer, color, 'sq')) break;
      if (color !== GLASS) {
        for (let r = 2; r <= h - 2; r += 2) {
          for (let cc = c + 1; cc <= c + w - 2; cc += 2) place(cc, r, backLayer, GLASS, 'sq');
        }
      }
      c += w + randInt(1, 3);
    }

    /* なか：中層ビル */
    let mc = randInt(1, 4);
    const midCount = randInt(3, 4);
    for (let i = 0; i < midCount && mc < COLS - 5; i++) {
      const w = randInt(4, 6);
      const h = randInt(6, 9);
      const color = choice([0, 1, 2, 3, 4, WOOD]);
      if (!rectFill(mc, mc + w - 1, 0, h - 1, midLayer, color, 'sq')) break;
      if (color !== WOOD) {
        for (let r = 2; r <= h - 2; r += 2) {
          for (let cc = mc + 1; cc <= mc + w - 2; cc += 2) place(cc, r, midLayer, GLASS, 'sq');
        }
      }
      mc += w + randInt(1, 3);
    }

    /* まえ：ひくい家々 */
    let fc = randInt(0, 3);
    const frontCount = randInt(3, 5);
    for (let i = 0; i < frontCount && fc < COLS - 4; i++) {
      const w = randInt(3, 5);
      const h = randInt(3, 5);
      const wallColor = choice([WOOD, 0, 1, 2, 3, 4]);
      const roofColor = otherColor(wallColor === WOOD ? choice(COLORS) : wallColor);
      if (!rectFill(fc, fc + w - 1, 0, h - 1, frontLayer, wallColor, 'sq')) break;
      for (let c2 = fc; c2 < fc + w; c2++) place(c2, h, frontLayer, roofColor, 'tri');
      const doorC = fc + Math.floor(w / 2);
      place(doorC, 0, frontLayer, WOOD, 'sq');
      fc += w + randInt(1, 2);
    }
  }

  /* ---------- テンプレート一覧 ---------- */
  const TEMPLATES = {
    castle: { label: 'おしろ', fn: buildCastle },
    tower: { label: 'タワー', fn: buildTower },
    house: { label: 'おうち', fn: buildHouses },
    rocket: { label: 'ロケット', fn: buildRocket },
    city: { label: 'まちなみ', fn: buildCity },
  };
  const NAMES = Object.keys(TEMPLATES);

  function clearLayout() {
    const keys = Array.from(build.layout.keys());
    for (let i = 0; i < keys.length; i++) {
      const parts = keys[i].split(',');
      build.setCellAt(Number(parts[0]), Number(parts[1]), Number(parts[2]), null);
    }
  }

  function generate(name) {
    const key = (name && TEMPLATES[name]) ? name : choice(NAMES);
    build.saveUndo();
    clearLayout();
    TEMPLATES[key].fn();
    audio.play('pop');
    ui.message('「' + TEMPLATES[key].label + '」を たてたよ！', 2000);
    return key;
  }

  /* ---------- ボタン注入（起動時に一度だけ） ---------- */
  function injectButton() {
    const bar = document.getElementById('build-btns');
    if (!bar || document.getElementById('btn-procgen')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-procgen';
    btn.className = 'big-btn alt sm-btn';
    btn.textContent = '🎲 おまかせ';
    btn.setAttribute('aria-label', 'AIおまかせ建築');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      audio.unlock();
      audio.play('tap');
      generate();
    });
    bar.insertBefore(btn, bar.firstChild);
  }
  injectButton();

  window.GameProcgen = { generate: generate, templates: NAMES };
})();
