// ============================================================
// みずみちラボ - モード (あそぶ / おだい / みくらべ)
// ============================================================
"use strict";

const QUESTS = [
  {
    id: "c1", icons: "🏠🛡️💦",
    text: "おうちを ぬらさないように してみよう!",
    voice: "おおきな なみが くるよ。おうちを ぬらさないように してみよう!",
    marker: "buildings",
    event: "wave", wavePower: 1.35,
    judge() {  // すべての建物が いちども ぬれなければ成功
      return World.buildings.every(b => !b.everWet);
    },
  },
  {
    id: "c2", icons: "⛰️🙂💦",
    text: "たかだいに みずが こないように!",
    voice: "たかだいに みずが こないように できるかな?",
    marker: "plateau",
    event: "wave", wavePower: 1.7,
    judge() {
      // たかだいの上に みずが きた形跡があれば失敗 (wet はゆっくりしか消えない)
      const N = CFG.GW * CFG.GH;
      for (let i = 0; i < N; i++) {
        if (World.type[i] === T_PLAT && (Water.w[i] > 0.12 || Water.wet[i] > 0.3)) return false;
      }
      return World.buildings.every(b => !b.everWet);
    },
  },
  {
    id: "c3", icons: "💧➡️🌊",
    text: "かわの みずを うみまで とどけよう!",
    voice: "かわが とちゅうで きれているよ。みぞを ほって、みずを うみまで とどけよう!",
    marker: "spring",
    event: "spring", duration: 18,
    judge() {  // 湧き水から海まで、水がつながったら成功
      const GW = CFG.GW, GH = CFG.GH;
      const s = World.springs[0];
      if (!s) return false;
      const start = idx(Math.round(s.x), Math.round(s.y));
      const seen = new Uint8Array(GW * GH);
      const q = [start]; seen[start] = 1;
      while (q.length) {
        const i = q.pop();
        if (World.seaMask[i]) return true;
        const x = i % GW, y = (i / GW) | 0;
        const nb = [];
        if (x > 0) nb.push(i - 1);
        if (x < GW - 1) nb.push(i + 1);
        if (y > 0) nb.push(i - GW);
        if (y < GH - 1) nb.push(i + GW);
        for (const j of nb) {
          if (!seen[j] && (Water.w[j] > 0.015 || World.seaMask[j])) { seen[j] = 1; q.push(j); }
        }
      }
      return false;
    },
  },
];

const Modes = {
  current: "free",           // free | quest | compare
  quest: null,               // 進行中のおだい
  questState: "edit",        // edit | running | done
  questTimer: 0,
  questClear: {},            // クリアずみ id
  compareMask: null,         // みくらべ: おぼえた みずの跡
  freeSnapshot: null,        // おだいから戻るとき用

  // ---------- モード切替 ----------
  switchTo(mode) {
    if (mode === this.current && mode !== "quest") return;
    Sound.tap();
    if (mode === "quest") {
      this.showQuestPicker();
      return;
    }
    // おだい → あそぶ/みくらべ : 自由マップを復元
    if (this.current === "quest") this.restoreFree();
    this.current = mode;
    this.compareMask = null;
    this.updateHud();
    if (mode === "compare") {
      Sound.speak("かえるまえと かえたあとを みくらべて みよう!");
    }
  },

  updateHud() {
    document.getElementById("modeFree").classList.toggle("active", this.current === "free");
    document.getElementById("modeQuest").classList.toggle("active", this.current === "quest");
    document.getElementById("modeCompare").classList.toggle("active", this.current === "compare");
    document.getElementById("questHud").classList.toggle("hidden", this.current !== "quest");
    document.getElementById("compareHud").classList.toggle("hidden", this.current !== "compare");
    document.getElementById("btnSnapClear").classList.toggle("hidden", !this.compareMask);
    const chip = document.getElementById("questChip");
    if (this.quest) chip.textContent = this.quest.icons;
  },

  saveFree() {
    this.freeSnapshot = {
      h: World.h.slice(), type: World.type.slice(),
      baseH: World.baseH.slice(), baseType: World.baseType.slice(),
      seaMask: World.seaMask.slice(), stairs: World.stairs.slice(),
      buildings: World.buildings.map(b => ({ ...b })),
      trees: World.trees.map(t => ({ ...t })),
      flowers: World.flowers.map(f => ({ ...f })),
      springs: World.springs.map(s => ({ ...s })),
    };
  },
  restoreFree() {
    const s = this.freeSnapshot;
    if (!s) { genMap("free"); waterInit(); return; }
    World.h = s.h; World.type = s.type;
    World.baseH = s.baseH; World.baseType = s.baseType;
    World.seaMask = s.seaMask; World.stairs = s.stairs;
    World.buildings = s.buildings; World.trees = s.trees;
    World.flowers = s.flowers; World.springs = s.springs;
    World.variant = "free";
    World.undoStack = [];
    waterInit();
  },

  // ---------- おだい ----------
  showQuestPicker() {
    const card = document.getElementById("card");
    card.innerHTML = "";
    const body = document.createElement("div");
    body.className = "cardBody";
    const title = document.createElement("div");
    title.className = "cardIcons";
    title.textContent = "⭐ おだい ⭐";
    title.style.fontSize = "30px";
    body.appendChild(title);
    QUESTS.forEach((q, i) => {
      const btn = document.createElement("button");
      btn.className = "questPick" + (this.questClear[q.id] ? " done" : "");
      btn.innerHTML = '<span class="qicon">' + (this.questClear[q.id] ? "🌸" : q.icons.slice(0, 2)) + '</span><span class="qtext">' + q.text + "</span>";
      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        Sound.pop();
        card.classList.add("hidden");
        this.startQuest(i);
      });
      body.appendChild(btn);
    });
    const close = document.createElement("button");
    close.className = "cardBtn";
    close.innerHTML = "もどる";
    close.addEventListener("pointerdown", () => {
      Sound.tap();
      card.classList.add("hidden");
      this.updateHud();
    });
    body.appendChild(close);
    card.appendChild(body);
    card.classList.remove("hidden");
  },

  startQuest(i) {
    const q = QUESTS[i];
    if (this.current !== "quest") this.saveFree();
    this.current = "quest";
    this.quest = q;
    this.questState = "edit";
    genMap(q.id);
    waterInit();
    this.compareMask = null;
    this.updateHud();
    // おだいカード
    const card = document.getElementById("card");
    card.innerHTML = "";
    const body = document.createElement("div");
    body.className = "cardBody";
    body.innerHTML = '<div class="cardIcons">' + q.icons + '</div><div class="cardText">' + q.text + "</div>";
    const ok = document.createElement("button");
    ok.className = "cardBtn";
    ok.innerHTML = '<span class="big">▶</span>はじめる';
    ok.addEventListener("pointerdown", () => {
      Sound.pop();
      card.classList.add("hidden");
    });
    body.appendChild(ok);
    card.appendChild(body);
    card.classList.remove("hidden");
    Sound.speak(q.voice);
    Mascot.react("wow");
  },

  pressGo() {
    if (!this.quest || this.questState === "running") return;
    this.questState = "running";
    this.questTimer = 0;
    document.getElementById("btnGo").classList.add("busy");
    clearLandWater();
    for (const b of World.buildings) { b.wet = 0; b.happy = 0; b.everWet = false; }
    if (this.quest.event === "wave") {
      Sound.speak("なみが くるよ〜!");
      setTimeout(() => startWave(this.quest.wavePower), 900);
    } else {
      Sound.speak("みずが ながれるよ〜!");
    }
  },

  stepQuest(dt) {
    if (!this.quest || this.questState !== "running") return;
    this.questTimer += dt;
    const q = this.quest;
    if (q.event === "spring") {
      // とちゅうで成功したら すぐにおいわい
      if (this.questTimer > 2 && this.questTimer % 0.5 < dt && q.judge()) {
        this.finishQuest(true); return;
      }
      if (this.questTimer > q.duration) this.finishQuest(q.judge());
    } else {
      const total = 0.9 + 8.4 + 2.2;  // 波がおわって しばらくしてから判定
      if (this.questTimer > total) this.finishQuest(q.judge());
    }
  },

  finishQuest(success) {
    this.questState = "done";
    document.getElementById("btnGo").classList.remove("busy");
    const q = this.quest;
    const res = document.getElementById("result");
    res.innerHTML = "";
    const body = document.createElement("div");
    body.className = "cardBody";
    if (success) {
      this.questClear[q.id] = true;
      body.innerHTML = '<div class="cardIcons">🌸😊✨</div><div class="cardText">できたね! すごい!</div>';
      Sound.chimeSuccess();
      Sound.speak("できたね! すごい!");
      Mascot.react("happy");
      // おいわいエフェクト
      for (const b of World.buildings) b.happy = 1;
      const cx = CFG.GW / 2, cy = CFG.GH / 2;
      let n = 0;
      const iv = setInterval(() => {
        const x = cx + (Math.random() - 0.5) * CFG.GW * 0.7;
        const y = cy + (Math.random() - 0.5) * CFG.GH * 0.6;
        const i = idx(clamp(Math.round(x), 0, CFG.GW - 1), clamp(Math.round(y), 0, CFG.GH - 1));
        Particles.bloom(x, y, World.h[i]);
        if (++n > 14) clearInterval(iv);
      }, 120);
    } else {
      body.innerHTML = '<div class="cardIcons">☁️💧</div><div class="cardText">おしい! もういちど やってみよう</div>';
      Sound.chimeRetry();
      Sound.speak("おしい! もういちど やってみよう");
    }
    const row = document.createElement("div");
    row.className = "cardRow";
    const retry = document.createElement("button");
    retry.className = "cardBtn blue";
    retry.innerHTML = '<span class="big">↻</span>もういちど';
    retry.addEventListener("pointerdown", () => {
      Sound.tap();
      res.classList.add("hidden");
      clearLandWater();
      for (const b of World.buildings) { b.wet = 0; b.happy = 0; b.everWet = false; }
      this.questState = "edit";
    });
    row.appendChild(retry);
    if (success) {
      const next = document.createElement("button");
      next.className = "cardBtn pink";
      next.innerHTML = '<span class="big">⭐</span>つぎへ';
      next.addEventListener("pointerdown", () => {
        Sound.tap();
        res.classList.add("hidden");
        const i = QUESTS.indexOf(q);
        if (i < QUESTS.length - 1) this.startQuest(i + 1);
        else this.showQuestPicker();
      });
      row.appendChild(next);
    }
    body.appendChild(row);
    res.appendChild(body);
    res.classList.remove("hidden");
  },

  // ---------- おだいのマーカー (まもる場所を やさしく示す) ----------
  drawQuestMarkers(ctx, view, now) {
    if (!this.quest || this.questState !== "edit") return;
    const { ox, oy, cs, rs, eh } = view;
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.004);
    ctx.save();
    if (this.quest.marker === "buildings") {
      for (const b of World.buildings) {
        const i = idx(b.x, b.y);
        const px = ox + (b.x + 1) * cs;
        const py = oy + (b.y + 1) * rs - World.h[i] * eh;
        ctx.strokeStyle = "rgba(255,200,60," + (0.5 + pulse * 0.4) + ")";
        ctx.lineWidth = Math.max(2, cs * 0.14);
        ctx.setLineDash([cs * 0.35, cs * 0.28]);
        ctx.lineDashOffset = -now * 0.008;
        ctx.beginPath();
        ctx.ellipse(px, py - rs * 0.4, cs * 1.9, cs * 1.5, 0, 0, 7);
        ctx.stroke();
      }
    } else if (this.quest.marker === "plateau") {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < CFG.GH; y++) for (let x = 0; x < CFG.GW; x++) {
        if (World.type[idx(x, y)] === T_PLAT) { sx += x; sy += y; n++; }
      }
      if (n) {
        const cx2 = sx / n + 0.5, cy2 = sy / n + 0.5;
        const i = idx(Math.round(cx2), Math.round(cy2));
        const px = ox + cx2 * cs, py = oy + cy2 * rs - World.h[i] * eh;
        ctx.strokeStyle = "rgba(255,200,60," + (0.5 + pulse * 0.4) + ")";
        ctx.lineWidth = Math.max(2, cs * 0.14);
        ctx.setLineDash([cs * 0.35, cs * 0.28]);
        ctx.lineDashOffset = -now * 0.008;
        ctx.beginPath();
        ctx.ellipse(px, py, cs * 3.4, cs * 2.4, 0, 0, 7);
        ctx.stroke();
      }
    } else if (this.quest.marker === "spring") {
      const s = World.springs[0];
      if (s) {
        const i = idx(Math.round(s.x), Math.round(s.y));
        const px = ox + (s.x + 0.5) * cs, py = oy + (s.y + 0.5) * rs - World.h[i] * eh;
        ctx.strokeStyle = "rgba(110,205,240," + (0.5 + pulse * 0.4) + ")";
        ctx.lineWidth = Math.max(2, cs * 0.14);
        ctx.beginPath();
        ctx.ellipse(px, py, cs * 1.6 * (1 + pulse * 0.2), cs * 1.1 * (1 + pulse * 0.2), 0, 0, 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // ---------- みくらべ ----------
  snapCompare() {
    // いまの「ぬれた + みずがある」範囲をおぼえる
    const N = CFG.GW * CFG.GH;
    const m = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) {
      if (World.seaMask[i]) continue;
      if (Water.w[i] > CFG.WET_DEPTH || Water.wet[i] > 0.25) { m[i] = 1; any = true; }
    }
    if (!any) { Sound.tap(); Sound.speak("まず みずを ながしてみてね"); return; }
    this.compareMask = m;
    clearLandWater();
    Sound.pop();
    Sound.sparkle();
    Sound.speak("おぼえたよ! まちを かえて、もういちど ながしてみよう");
    Mascot.react("happy");
    this.updateHud();
  },
  clearCompare() {
    this.compareMask = null;
    Sound.poof();
    this.updateHud();
  },
};
