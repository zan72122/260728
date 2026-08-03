// js/ui/hud.js — Agent F
// HUD は DOM 要素のみを扱う。canvas やゲーム状態には触れず、main.js とは
// コンストラクタで渡される callbacks / 公開メソッドだけを通じてやり取りする。
//
// 契約 (SPEC.md Agent F / hud.js) で定められたメソッド:
//   setBreads(breads), setStage(stage), setTool(tool), showHint(text),
//   setPipingFilling(type), celebrate(), coverOn(), coverOff(), getOvenZone()
// callbacks: onSelectBread, onSelectTool, onCover, onToForest, onBackToPlay, onNewDough
//
// 以下は main.js からのみ呼ばれる自前の拡張メソッド（他エージェントは関知しない）:
//   setCurrentBread(breadId), setToppingReady(bool), setMode('play'|'forest')
// callbacks の拡張: onTopping(), onPlaceToForest()

const FILLING_EMOJI = {
  cream: '🍦', anko: '🫘', jam: '🍓', choco: '🍫',
  cheese: '🧀', raisin: '🍇', butter: '🧈', cinnamon: '🌀',
};

const TEMPLATE = `
  <div class="hud-face-wrap">
    <button type="button" class="hud-btn hud-face" data-role="face" aria-label="パンをえらぶ">
      <span class="hud-emoji" data-role="face-emoji">🍞</span>
    </button>
  </div>

  <div class="hud-tools" data-role="tools">
    <button type="button" class="hud-btn hud-tool" data-role="tool-hand" data-tool="hand">
      <span class="hud-emoji">✋</span><span class="hud-label">て</span>
    </button>
    <button type="button" class="hud-btn hud-tool" data-role="tool-piping" data-tool="piping" hidden>
      <span class="hud-emoji" data-role="piping-emoji">🧁</span><span class="hud-label">しぼる</span>
    </button>
    <button type="button" class="hud-btn hud-tool" data-role="tool-pattern" data-tool="pattern" hidden>
      <span class="hud-emoji">🖊️</span><span class="hud-label">もよう</span>
    </button>
    <button type="button" class="hud-btn hud-topping" data-role="topping" hidden>
      <span class="hud-emoji">🍈</span><span class="hud-label">うわがけ</span>
    </button>
    <button type="button" class="hud-btn hud-cover" data-role="cover">
      <span class="hud-emoji">🧺</span><span class="hud-label">ぬの</span>
    </button>
  </div>

  <div class="hud-oven-wrap" data-role="oven-wrap">
    <div class="hud-oven" data-role="oven">
      <span data-role="oven-emoji">🔥</span>
    </div>
  </div>

  <div class="hud-bottom-left" data-role="bottom-left">
    <button type="button" class="hud-btn hud-forest" data-role="to-forest">
      <span class="hud-emoji">🌲</span><span class="hud-label">もりへ</span>
    </button>
  </div>

  <div class="hud-hint" data-role="hint"></div>

  <div class="hud-cloth" data-role="cloth" hidden></div>

  <div class="hud-done-panel" data-role="done-panel" hidden>
    <button type="button" class="hud-btn hud-place-btn" data-role="place-btn">
      <span class="hud-emoji">🌲✨</span><span class="hud-label">もりにおく</span>
    </button>
    <button type="button" class="hud-btn hud-newdough-btn" data-role="newdough-btn">
      <span class="hud-emoji">🔄</span><span class="hud-label">おかわり</span>
    </button>
  </div>

  <div class="hud-forest-panel" data-role="forest-panel" hidden>
    <button type="button" class="hud-btn hud-back-btn" data-role="back-btn">
      <span class="hud-emoji">↩️</span><span class="hud-label">もどる</span>
    </button>
  </div>

  <div class="hud-bread-overlay" data-role="bread-overlay" hidden>
    <div class="hud-bread-grid" data-role="bread-grid"></div>
  </div>

  <div class="hud-sparkles" data-role="sparkles"></div>
`;

export class HUD {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks || {};
    this.breads = [];
    this.currentBreadId = null;
    this.stage = 'shape';
    this.tool = 'hand';
    this.hasToppingReady = false;
    this._fillings = [];
    this._hintTimer = null;

    this._buildDOM();
    this._wireEvents();
    this.setTool('hand');
  }

  _buildDOM() {
    this.root.innerHTML = TEMPLATE;
    const q = (role) => this.root.querySelector(`[data-role="${role}"]`);
    this.el = {
      face: q('face'),
      faceEmoji: q('face-emoji'),
      tools: q('tools'),
      handBtn: q('tool-hand'),
      pipingBtn: q('tool-piping'),
      pipingEmoji: q('piping-emoji'),
      patternBtn: q('tool-pattern'),
      toppingBtn: q('topping'),
      coverBtn: q('cover'),
      ovenWrap: q('oven-wrap'),
      oven: q('oven'),
      ovenEmoji: q('oven-emoji'),
      bottomLeft: q('bottom-left'),
      toForestBtn: q('to-forest'),
      hint: q('hint'),
      cloth: q('cloth'),
      donePanel: q('done-panel'),
      placeBtn: q('place-btn'),
      newDoughBtn: q('newdough-btn'),
      forestPanel: q('forest-panel'),
      backBtn: q('back-btn'),
      breadOverlay: q('bread-overlay'),
      breadGrid: q('bread-grid'),
      sparkles: q('sparkles'),
    };
  }

  _bounce(el) {
    if (!el) return;
    el.classList.remove('bounce');
    // 強制リフローで再アニメーションできるようにする
    void el.offsetWidth;
    el.classList.add('bounce');
  }

  _fire(name, ...args) {
    const fn = this.callbacks[name];
    if (typeof fn === 'function') {
      try { fn(...args); } catch (e) { /* ゲームを止めない */ }
    }
  }

  _wireEvents() {
    this.el.face.addEventListener('click', () => {
      this._bounce(this.el.face);
      this._openBreadOverlay();
    });

    [this.el.handBtn, this.el.pipingBtn, this.el.patternBtn].forEach((btn) => {
      btn.addEventListener('click', () => {
        this._bounce(btn);
        this._fire('onSelectTool', btn.dataset.tool);
      });
    });

    this.el.toppingBtn.addEventListener('click', () => {
      this._bounce(this.el.toppingBtn);
      this._fire('onTopping');
    });

    this.el.coverBtn.addEventListener('click', () => {
      this._bounce(this.el.coverBtn);
      this._fire('onCover');
    });

    this.el.toForestBtn.addEventListener('click', () => {
      this._bounce(this.el.toForestBtn);
      this._fire('onToForest');
    });

    this.el.backBtn.addEventListener('click', () => {
      this._bounce(this.el.backBtn);
      this._fire('onBackToPlay');
    });

    this.el.placeBtn.addEventListener('click', () => {
      this._bounce(this.el.placeBtn);
      this._fire('onPlaceToForest');
    });

    this.el.newDoughBtn.addEventListener('click', () => {
      this._bounce(this.el.newDoughBtn);
      this._fire('onNewDough');
    });

    this.el.breadOverlay.addEventListener('click', (ev) => {
      if (ev.target === this.el.breadOverlay) {
        this._closeBreadOverlay();
      }
    });
  }

  _openBreadOverlay() {
    this.el.breadOverlay.hidden = false;
  }

  _closeBreadOverlay() {
    this.el.breadOverlay.hidden = true;
  }

  _renderBreadGrid() {
    const grid = this.el.breadGrid;
    grid.innerHTML = '';
    this.breads.forEach((bread) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-bread-item';
      btn.dataset.id = bread.id;
      btn.innerHTML = `<span class="hud-emoji">${bread.emoji}</span><span class="hud-label">${bread.name}</span>`;
      btn.addEventListener('click', () => {
        this._closeBreadOverlay();
        this.setCurrentBread(bread.id);
        this._fire('onSelectBread', bread.id);
      });
      grid.appendChild(btn);
    });
  }

  // ---- SPEC 必須メソッド -------------------------------------------------

  setBreads(breads) {
    this.breads = Array.isArray(breads) ? breads.slice() : [];
    this._renderBreadGrid();
  }

  setStage(stage) {
    this.stage = stage;
    const shape = stage === 'shape';
    if (this.el.handBtn) this.el.handBtn.hidden = !shape;
    if (this.el.pipingBtn) this.el.pipingBtn.hidden = !(shape && this._fillings.length > 0);
    if (this.el.patternBtn) this.el.patternBtn.hidden = !shape;
    if (this.el.toppingBtn) this.el.toppingBtn.hidden = !(shape && this.hasToppingReady);
    if (this.el.coverBtn) {
      this.el.coverBtn.hidden = !(shape || stage === 'ferment');
      this.el.coverBtn.classList.toggle('is-active', stage === 'ferment');
    }
    if (this.el.donePanel) this.el.donePanel.hidden = stage !== 'done';
  }

  setTool(tool) {
    this.tool = tool;
    [this.el.handBtn, this.el.pipingBtn, this.el.patternBtn].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle('is-active', btn.dataset.tool === tool);
    });
  }

  showHint(text) {
    const el = this.el.hint;
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 3200);
  }

  setPipingFilling(type) {
    if (this.el.pipingEmoji) {
      this.el.pipingEmoji.textContent = FILLING_EMOJI[type] || '🧁';
    }
  }

  celebrate() {
    const container = this.el.sparkles;
    if (!container) return;
    const count = 18;
    const glyphs = ['✨', '⭐', '🌟'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'hud-sparkle';
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = `${8 + Math.random() * 82}%`;
      s.style.top = `${10 + Math.random() * 55}%`;
      s.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
      container.appendChild(s);
      setTimeout(() => { s.remove(); }, 1700);
    }
  }

  coverOn() {
    const el = this.el.cloth;
    if (!el) return;
    el.hidden = false;
    el.classList.remove('leaving');
    void el.offsetWidth;
    el.classList.add('active');
  }

  coverOff() {
    const el = this.el.cloth;
    if (!el) return;
    el.classList.remove('active');
    el.classList.add('leaving');
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove('leaving');
    }, 520);
  }

  getOvenZone() {
    const el = this.el.oven;
    if (!el) return { x: 0, y: 0, w: 0, h: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // 「もりにおく」ボタンの画面上の矩形 (SPEC-GUIDE: ゴーストハンドの done 時タップ実演先)。
  // done パネルが非表示中は w=0 の矩形を返す (呼び出し側は w をチェックして無視する)。
  getPlaceButtonRect() {
    const el = this.el.placeBtn;
    if (!el || (this.el.donePanel && this.el.donePanel.hidden)) return { x: 0, y: 0, w: 0, h: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // ---- main.js 専用の拡張メソッド ---------------------------------------

  setCurrentBread(breadId) {
    this.currentBreadId = breadId;
    const bread = this.breads.find((b) => b.id === breadId);
    if (!bread) return;
    if (this.el.faceEmoji) this.el.faceEmoji.textContent = bread.emoji;
    this._fillings = bread.fillings || [];
    this._toppingable = !!bread.toppingable;
    this.hasToppingReady = false;
    if (this.el.ovenEmoji) {
      this.el.ovenEmoji.textContent = bread.method === 'fry' ? '🍳' : bread.method === 'steam' ? '♨️' : '🔥';
    }
    this.setStage(this.stage);
  }

  setToppingReady(ready) {
    this.hasToppingReady = !!ready && !!this._toppingable;
    this.setStage(this.stage);
  }

  setMode(mode) {
    const isForest = mode === 'forest';
    if (this.el.face) this.el.face.hidden = isForest;
    if (this.el.tools) this.el.tools.hidden = isForest;
    if (this.el.ovenWrap) this.el.ovenWrap.hidden = isForest;
    if (this.el.bottomLeft) this.el.bottomLeft.hidden = isForest;
    if (this.el.donePanel) this.el.donePanel.hidden = isForest || this.stage !== 'done';
    if (this.el.forestPanel) this.el.forestPanel.hidden = !isForest;
    if (this.el.hint) this.el.hint.classList.remove('show');
    if (isForest) this._closeBreadOverlay();
  }
}
