/* ═══════════════════════════════════════════════════════════
   words.js — ほしのこ と ことばの世界

   勉強の感じを一切出さずに、英単語のスペルを暗記させる仕掛け。

   1. ほしのこ: リムの隅で眠って光っている。存在自体がかわいい
   2. 子ども発: つつくと起きて「ことば花火」を1発
      （文字が1文字ずつ鏡の中で咲く → 声 → えもじの雨）
      直後に「いたずらもじ さがし」——正しい綴りの宝石が輪になって回り、
      1個だけ化けている。鏡の多数決が教師役
   3. 世界発: 数分あそぶと自分で目を覚まして「おねがい」
      （えもじ＋声 → 綴り違いのキャンディーから本物を選ぶ）
      無視されたら あくびして寝る。無視が続けば頻度が下がる
   4. 習熟の階段: 裏の Leitner 箱に従って、おねがいの中身が
      鍵えらび(2択→3択) → 文字ビーズ組み立て(影付き→影なし) へ進化

   文字・えもじは既存のステッカー化パイプラインで宝石になり、
   祝祭では実物理の粒として筒に降りそそぐ。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Words = (() => {

  /* ── ことば（CEFR A1 中心・えもじで意味が立つもの） ── */
  const WORDS = [
    ["dog", "🐶"], ["cat", "🐱"], ["fish", "🐟"], ["bird", "🐦"],
    ["bear", "🐻"], ["pig", "🐷"], ["cow", "🐮"], ["duck", "🦆"],
    ["frog", "🐸"], ["bee", "🐝"], ["fox", "🦊"], ["lion", "🦁"],
    ["egg", "🥚"], ["milk", "🥛"], ["cake", "🍰"], ["apple", "🍎"],
    ["banana", "🍌"], ["bread", "🍞"], ["candy", "🍬"], ["rice", "🍚"],
    ["sun", "☀️"], ["moon", "🌙"], ["star", "⭐"], ["tree", "🌳"],
    ["flower", "🌸"], ["sea", "🌊"], ["cloud", "☁️"], ["fire", "🔥"],
    ["leaf", "🍃"], ["snow", "⛄"],
    ["car", "🚗"], ["bus", "🚌"], ["ship", "🚢"], ["train", "🚂"],
    ["book", "📖"], ["ball", "⚽"], ["hat", "🎩"], ["shoe", "👟"],
    ["bag", "👜"], ["key", "🔑"], ["door", "🚪"], ["bed", "🛏️"],
    ["box", "📦"], ["clock", "⏰"], ["cup", "🥤"], ["umbrella", "☂️"],
    ["hand", "✋"], ["ear", "👂"], ["nose", "👃"], ["mouth", "👄"],
    ["red", "🔴"], ["blue", "🔵"], ["green", "🟢"], ["yellow", "🟡"],
    ["rainbow", "🌈"], ["butterfly", "🦋"],
  ];
  const WORD_MAP = new Map(WORDS);
  const SPECIAL_WORD = "kaleidoscope";   // とびきりの演出専用（A2-C2枠）

  const LETTER_COLORS = [
    ["#ffb7cf", "#ff6f9e", "#c74076"],
    ["#ffe3a1", "#ffcf3e", "#c8922a"],
    ["#a8ecd8", "#4ec290", "#2e8f66"],
    ["#b3ddff", "#4aa8e0", "#2a6a9e"],
    ["#ddccff", "#9b6fe8", "#6a48b0"],
    ["#ffc4ad", "#ff9440", "#c9642a"],
  ];

  /* ── まちがい綴りの自動生成 ── */
  const VOWELS = "aeiou";
  const MIRROR = { b: "d", d: "b", p: "q", q: "p", n: "u", u: "n", m: "w", w: "m" };

  function misspell(word, hard) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const chars = word.split("");
      let out = null;
      const mode = hard ? (Math.random() < 0.5 ? "mirror" : "swap") : "vowel";
      if (mode === "vowel") {
        const idxs = chars.map((c, i) => VOWELS.includes(c) ? i : -1).filter(i => i >= 0);
        if (idxs.length) {
          const i = idxs[(Math.random() * idxs.length) | 0];
          const others = VOWELS.replace(chars[i], "");
          chars[i] = others[(Math.random() * others.length) | 0];
          out = chars.join("");
        }
      } else if (mode === "mirror") {
        const idxs = chars.map((c, i) => MIRROR[c] ? i : -1).filter(i => i >= 0);
        if (idxs.length) {
          const i = idxs[(Math.random() * idxs.length) | 0];
          chars[i] = MIRROR[chars[i]];
          out = chars.join("");
        }
      }
      if (!out && word.length >= 3) {   // となり同士を入れ替え
        const i = 1 + ((Math.random() * (word.length - 2)) | 0);
        [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
        out = chars.join("");
      }
      if (out && out !== word && !WORD_MAP.has(out)) return out;
    }
    return word.slice(0, -1) + (word.endsWith("o") ? "a" : "o");
  }

  /* ── 文字・ことば・えもじ の宝石づくり（ステッカー化資産を再利用） ── */
  const FONT = "900 %spx 'Arial Rounded MT Bold', 'Hiragino Maru Gothic ProN', system-ui, sans-serif";
  const stickerCache = new Map();

  function letterCanvas(ch, colorIdx, size = 150) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const [hi, mid, lo] = LETTER_COLORS[colorIdx % LETTER_COLORS.length];
    g.font = FONT.replace("%s", Math.round(size * 0.72));
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.strokeStyle = lo;
    g.lineWidth = size * 0.09;
    g.strokeText(ch, size / 2, size * 0.56);
    const grad = g.createLinearGradient(0, size * 0.12, 0, size * 0.9);
    grad.addColorStop(0, hi);
    grad.addColorStop(0.55, mid);
    grad.addColorStop(1, lo);
    g.fillStyle = grad;
    g.fillText(ch, size / 2, size * 0.56);
    g.fillStyle = "rgba(255,255,255,.55)";
    g.font = FONT.replace("%s", Math.round(size * 0.72));
    g.fillText(ch, size / 2 - size * 0.02, size * 0.53);
    g.fillStyle = grad;
    g.globalAlpha = 0.9;
    g.fillText(ch, size / 2, size * 0.56);
    g.globalAlpha = 1;
    return c;
  }

  function letterSticker(ch, colorIdx) {
    const key = "L:" + ch + ":" + colorIdx;
    if (!stickerCache.has(key)) {
      stickerCache.set(key,
        KKM.Stampify.stickerize(letterCanvas(ch, colorIdx), 160, { border: 160 * 0.05 }));
    }
    return stickerCache.get(key);
  }

  /* ことばの宝石（ぜんぶの文字が1枚に）。tiltIndex の文字だけ傾けて焼く */
  function wordSticker(word, { tiltIndex = -1 } = {}) {
    const size = 120;
    const w = Math.round(size * 0.62) * word.length + 60;
    const c = document.createElement("canvas");
    c.width = w; c.height = size + 30;
    const g = c.getContext("2d");
    for (let i = 0; i < word.length; i++) {
      const lc = letterCanvas(word[i], i, size);
      const x = 30 + i * size * 0.62;
      if (i === tiltIndex) {
        g.save();
        g.translate(x + size / 2, (c.height) / 2);
        g.rotate(-0.22);
        g.drawImage(lc, -size / 2, -size / 2);
        g.restore();
      } else {
        g.drawImage(lc, x, 15);
      }
    }
    return KKM.Stampify.stickerize(c, 340, { border: 340 * 0.028 });
  }

  function emojiSticker(emoji) {
    const key = "E:" + emoji;
    if (!stickerCache.has(key)) {
      const c = document.createElement("canvas");
      c.width = c.height = 170;
      const g = c.getContext("2d");
      g.font = "130px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(emoji, 85, 95);
      stickerCache.set(key, KKM.Stampify.stickerize(c, 180, { border: 180 * 0.045 }));
    }
    return stickerCache.get(key);
  }

  /* ── こえ（Web Speech / なければチャイム） ── */
  let enVoice = null;
  function pickVoice() {
    try {
      const vs = speechSynthesis.getVoices();
      enVoice = vs.find(v => /^en(-|_)?(US)?/i.test(v.lang) && /female|samantha|karen|zira/i.test(v.name))
             || vs.find(v => /^en/i.test(v.lang)) || null;
    } catch (e) {}
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    try {
      if (!window.speechSynthesis) throw 0;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (enVoice) u.voice = enVoice;
      u.lang = "en-US";
      u.rate = 0.85;
      u.pitch = 1.15;
      speechSynthesis.speak(u);
    } catch (e) {
      KKM.Sound.uiSelect();
    }
  }

  /* ── Leitner 箱（裏で静かに） ── */
  const SAVE_KEY = "kkm-words-v1";
  const BOX_MINUTES = [3, 10, 30, 120, 1440];
  const prog = { words: {}, ignoreStreak: 0, tapCount: 0 };
  let progDirty = false;

  function loadProg() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(prog, JSON.parse(raw));
    } catch (e) {}
  }
  function saveProg() {
    if (!progDirty) return;
    progDirty = false;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(prog)); } catch (e) {}
  }
  function wordState(word) {
    if (!prog.words[word]) prog.words[word] = { box: -1, due: 0, seen: 0 };
    return prog.words[word];
  }
  function introduceNext() {
    // まだ見ぬことば → いちばん昔に会ったことば の順
    const unseen = WORDS.filter(([w]) => wordState(w).seen === 0);
    if (unseen.length) return unseen[(Math.random() * Math.min(4, unseen.length)) | 0][0];
    const seen = WORDS.map(([w]) => w).sort((a, b) => wordState(a).due - wordState(b).due);
    return seen[(Math.random() * Math.min(5, seen.length)) | 0];
  }
  function dueWish() {
    const now = Date.now();
    const cands = WORDS.map(([w]) => w)
      .filter(w => wordState(w).seen > 0 && wordState(w).due <= now)
      .sort((a, b) => wordState(a).box - wordState(b).box);
    return cands.length ? cands[0] : null;
  }
  function schedule(word, correct) {
    const st = wordState(word);
    st.box = correct ? Math.min(4, (st.box < 0 ? 0 : st.box) + 1)
                     : Math.max(0, st.box - 1);
    st.due = Date.now() + BOX_MINUTES[st.box] * 60000;
    progDirty = true;
  }

  /* ── 状態 ── */
  let chamber = null;
  let els = {};
  let phase = "idle";      // idle | firework | impostor | wish | assembly
  let playSeconds = 0;     // 世界であそんだ時間
  let nextWishAt = 150;    // 最初のおねがいまで（秒）
  let phaseTimer = 0;
  let currentWord = null;
  let wrongCount = 0;

  const $ = id => document.getElementById(id);
  const Sound = () => KKM.Sound;

  /* ── ほしのこ ── */
  function setStar(state) {
    const el = els.star;
    el.classList.remove("st-sleep", "st-awake", "st-happy", "st-yawn");
    el.classList.add("st-" + state);
  }

  function bubble(html) {
    if (html === null) {
      els.bubble.classList.add("hidden");
      els.bubble.innerHTML = "";
    } else {
      els.bubble.innerHTML = html;
      els.bubble.classList.remove("hidden");
    }
  }

  /* 祝祭のために、筒にすこし空きをつくる */
  function makeRoom(n) {
    let removed = 0;
    for (let i = 0; i < chamber.particles.length && removed < n; ) {
      const p = chamber.particles[i];
      if (!p.drop) { chamber.particles.splice(i, 1); removed++; }
      else i++;
    }
  }

  function spawnSticker(canvas, kind, baseR, copies) {
    const id = KKM.Stampify.Store.add(canvas, "w_" + kind);
    if (chamber.isFull()) makeRoom(copies.length + 2);
    chamber.addStamps(id, baseR, copies);
  }

  /* ═══════════ 1+2. ことば花火 → いたずらもじ ═══════════ */

  function startFirework(word) {
    phase = "firework";
    currentWord = word;
    wrongCount = 0;
    setStar("happy");
    bubble(`<span class="wb-emoji">${WORD_MAP.get(word) || "✨"}</span>`);
    Sound().reveal();
    // 文字が1文字ずつ、鏡の中で咲く（実物理の粒として）
    const letters = word.split("");
    letters.forEach((ch, i) => {
      setTimeout(() => {
        spawnSticker(letterSticker(ch, i), "l",
          Math.max(11, 19 - letters.length), [1]);
        Sound().ping(523 * Math.pow(2, (i % 8) / 8), 0, 0.22, 0.8);
      }, 350 + i * 380);
    });
    const tSpeak = 350 + letters.length * 380 + 200;
    setTimeout(() => speak(word), tSpeak);
    // えもじの雨
    setTimeout(() => {
      const em = emojiSticker(WORD_MAP.get(word) || "⭐");
      spawnSticker(em, "e", 15, [1, 0.8, 0.65]);
      Sound().pour("beads");
    }, tSpeak + 600);
    // つづいて いたずらもじ さがし
    setTimeout(() => {
      if (phase === "firework") startImpostor(word);
    }, tSpeak + 1800);
    const st = wordState(word);
    st.seen++;
    if (st.box < 0) { st.box = 0; st.due = Date.now() + BOX_MINUTES[0] * 60000; }
    progDirty = true;
  }

  /* とびきりの演出: kaleidoscope（A2-C2 特別枠） */
  function startKaleidoscopeShow() {
    phase = "firework";
    currentWord = null;
    setStar("happy");
    bubble(`<span class="wb-emoji">🌈</span>`);
    Sound().reveal();
    const prevLight = KKM.state.light;
    KKM.state.light = "niji";
    SPECIAL_WORD.split("").forEach((ch, i) => {
      setTimeout(() => {
        spawnSticker(letterSticker(ch, i), "l", 10, [1]);
        Sound().ping(700 + i * 90, 0, 0.16, 0.6);
      }, 250 + i * 210);
    });
    setTimeout(() => speak(SPECIAL_WORD), 250 + SPECIAL_WORD.length * 210 + 300);
    setTimeout(() => {
      KKM.state.light = prevLight;
      endEvent();
    }, 250 + SPECIAL_WORD.length * 210 + 4200);
  }

  function startImpostor(word) {
    phase = "impostor";
    phaseTimer = 0;
    const st = wordState(word);
    const hard = st.box >= 2;
    const wrong = misspell(word, hard);
    // 化けた文字の位置（傾け焼きは易しいときだけ）
    let tiltIndex = -1;
    if (!hard) {
      for (let i = 0; i < Math.max(word.length, wrong.length); i++) {
        if (word[i] !== wrong[i]) { tiltIndex = i; break; }
      }
    }
    const good = wordSticker(word);
    const bad = wordSticker(wrong, { tiltIndex });
    const N = 6;
    const impostorIdx = (Math.random() * N) | 0;
    const ring = els.ring;
    ring.innerHTML = "";
    ring.classList.remove("hidden");
    for (let i = 0; i < N; i++) {
      const holder = document.createElement("div");
      holder.className = "gem-holder";
      holder.style.setProperty("--gi", i);
      holder.style.setProperty("--gn", N);
      const b = document.createElement("button");
      b.className = "word-gem" + (i === impostorIdx ? " gem-impostor" : "");
      const img = document.createElement("img");
      img.src = (i === impostorIdx ? bad : good).toDataURL();
      img.alt = "";
      b.appendChild(img);
      b.addEventListener("pointerdown", e => {
        e.stopPropagation();
        if (phase !== "impostor") return;
        if (i === impostorIdx) resolveImpostor(b, word, good);
        else {
          // 正しい宝石: くすぐったいだけ（罰なし）
          b.classList.remove("gem-giggle");
          void b.offsetWidth;
          b.classList.add("gem-giggle");
          Sound().uiTap();
        }
      });
      holder.appendChild(b);
      ring.appendChild(holder);
    }
  }

  function resolveImpostor(btn, word, goodSticker) {
    phase = "celebrate";
    Sound().snap();
    btn.classList.add("gem-caught");
    const img = btn.querySelector("img");
    setTimeout(() => { img.src = goodSticker.toDataURL(); Sound().uiSelect(); }, 350);
    setTimeout(() => {
      els.ring.classList.add("ring-burst");
      Sound().tada();
      speak(word);
      const em = emojiSticker(WORD_MAP.get(word) || "⭐");
      spawnSticker(em, "e", 16, [1, 0.8]);
      schedule(word, true);
    }, 900);
    setTimeout(() => {
      els.ring.classList.add("hidden");
      els.ring.classList.remove("ring-burst");
      els.ring.innerHTML = "";
      endEvent();
    }, 2100);
  }

  function impostorTimeout() {
    // 見つからなくても、いたずらもじが自分から「ばれた〜」する（失敗なし）
    const imp = els.ring.querySelector(".gem-impostor");
    if (imp && currentWord) {
      resolveImpostor(imp, currentWord, wordSticker(currentWord));
    } else {
      els.ring.classList.add("hidden");
      endEvent();
    }
  }

  /* ═══════════ 3+4. おねがい（鍵えらび／文字ビーズ組み立て） ═══════════ */

  function startWish() {
    const word = dueWish();
    if (!word) return false;
    currentWord = word;
    wrongCount = 0;
    phaseTimer = 0;
    setStar("awake");
    Sound().ping(880, 0, 0.25, 1.0);
    bubble(`<span class="wb-emoji">${WORD_MAP.get(word)}</span>`);
    speak(word);
    const st = wordState(word);
    if (st.box >= 3) startAssembly(word, st.box >= 4);
    else startKeys(word, st.box >= 2 ? 3 : 2);
    return true;
  }

  function startKeys(word, nChoices) {
    phase = "wish";
    const hard = wordState(word).box >= 2;
    const choices = [{ text: word, ok: true }];
    while (choices.length < nChoices) {
      const wrong = misspell(word, hard);
      if (!choices.some(c => c.text === wrong)) choices.push({ text: wrong, ok: false });
    }
    choices.sort(() => Math.random() - 0.5);
    const tray = els.tray;
    tray.innerHTML = "";
    tray.classList.remove("hidden");
    for (const ch of choices) {
      const b = document.createElement("button");
      b.className = "word-key";
      const img = document.createElement("img");
      img.src = wordSticker(ch.text).toDataURL();
      img.alt = "";
      b.appendChild(img);
      b.addEventListener("pointerdown", e => {
        e.stopPropagation();
        if (phase !== "wish") return;
        if (ch.ok) {
          phase = "celebrate";
          b.classList.add("key-win");
          Sound().snap();
          setTimeout(() => {
            Sound().tada();
            speak(word);
            spawnSticker(emojiSticker(WORD_MAP.get(word)), "e", 16, [1, 0.8, 0.65]);
            schedule(word, wrongCount === 0);
            prog.ignoreStreak = 0;
            progDirty = true;
          }, 350);
          setTimeout(() => { tray.classList.add("hidden"); tray.innerHTML = ""; endEvent(); }, 1900);
        } else {
          // にせもの: ぷにゃりと溶ける（罰なし・おかしみ）
          wrongCount++;
          b.classList.add("key-melt");
          b.disabled = true;
          Sound().pour("water");
          phaseTimer = 0;
          if (wrongCount >= 2) {
            const win = [...tray.children].find(x => !x.disabled && x !== b);
            // のこった本物をそっと光らせて、必ず成功で終われるように
            for (const x of tray.querySelectorAll(".word-key:not(.key-melt)")) {
              if (choices.find(c => c.ok && x.querySelector("img"))) x.classList.add("key-hint");
            }
          }
        }
      });
      tray.appendChild(b);
    }
  }

  /* 文字ビーズ組み立て（影付き→影なし） */
  function startAssembly(word, noGhost) {
    phase = "assembly";
    const board = els.board;
    board.innerHTML = "";
    board.classList.remove("hidden");
    const slotsRow = document.createElement("div");
    slotsRow.className = "asm-slots";
    const beadsRow = document.createElement("div");
    beadsRow.className = "asm-beads";
    board.appendChild(slotsRow);
    board.appendChild(beadsRow);

    const letters = word.split("");
    const slots = letters.map((ch, i) => {
      const s = document.createElement("div");
      s.className = "asm-slot";
      if (!noGhost) s.textContent = ch;
      s.dataset.ch = ch;
      s.dataset.i = i;
      slotsRow.appendChild(s);
      return s;
    });
    let placed = 0;
    const shuffled = letters.map((ch, i) => ({ ch, i }))
      .sort(() => Math.random() - 0.5);
    for (const { ch, i } of shuffled) {
      const bead = document.createElement("div");
      bead.className = "asm-bead";
      const img = document.createElement("img");
      img.src = letterSticker(ch, i).toDataURL();
      img.alt = "";
      img.draggable = false;
      bead.appendChild(img);
      beadsRow.appendChild(bead);
      // ドラッグ
      bead.addEventListener("pointerdown", e => {
        if (phase !== "assembly" || bead.classList.contains("bead-locked")) return;
        e.preventDefault();
        e.stopPropagation();
        try { bead.setPointerCapture(e.pointerId); } catch (err) {}
        const rect = bead.getBoundingClientRect();
        bead.classList.add("bead-drag");
        const ox = e.clientX - rect.left - rect.width / 2;
        const oy = e.clientY - rect.top - rect.height / 2;
        const move = ev => {
          bead.style.transform =
            `translate(${ev.clientX - rect.left - rect.width / 2 - ox}px, ${ev.clientY - rect.top - rect.height / 2 - oy}px) scale(1.15)`;
        };
        const up = ev => {
          bead.removeEventListener("pointermove", move);
          bead.removeEventListener("pointerup", up);
          bead.removeEventListener("pointercancel", up);
          bead.classList.remove("bead-drag");
          // いちばん近い席
          const bc = bead.getBoundingClientRect();
          const bx = bc.left + bc.width / 2, by = bc.top + bc.height / 2;
          let best = null, bestD = 1e9;
          for (const s of slots) {
            if (s.classList.contains("slot-done")) continue;
            const sc = s.getBoundingClientRect();
            const d = Math.hypot(sc.left + sc.width / 2 - bx, sc.top + sc.height / 2 - by);
            if (d < bestD) { bestD = d; best = s; }
          }
          const near = best && bestD < Math.max(70, bead.offsetWidth * 1.2);
          if (near && best.dataset.ch === ch) {
            // カチッと吸い付く
            best.classList.add("slot-done");
            best.textContent = "";
            best.appendChild(img);
            bead.remove();
            Sound().snap();
            phaseTimer = 0;
            placed++;
            if (placed === letters.length) finishAssembly(word);
          } else {
            if (near) {  // ちがう席: ぷるぷる
              best.classList.remove("slot-no");
              void best.offsetWidth;
              best.classList.add("slot-no");
              Sound().uiTap();
              wrongCount++;
            }
            bead.style.transform = "";
          }
        };
        bead.addEventListener("pointermove", move);
        bead.addEventListener("pointerup", up);
        bead.addEventListener("pointercancel", up);
      });
    }
  }

  function finishAssembly(word) {
    phase = "celebrate";
    setStar("happy");
    setTimeout(() => {
      Sound().tada();
      speak(word);
      spawnSticker(emojiSticker(WORD_MAP.get(word)), "e", 17, [1, 0.85, 0.7]);
      schedule(word, wrongCount === 0);
      prog.ignoreStreak = 0;
      progDirty = true;
    }, 300);
    setTimeout(() => {
      els.board.classList.add("hidden");
      els.board.innerHTML = "";
      endEvent();
    }, 2100);
  }

  /* ── おねがいの無視 → あくびして寝る ── */
  function wishIgnored() {
    setStar("yawn");
    Sound().ping(392, 0, 0.14, 1.2);
    els.tray.classList.add("hidden");
    els.tray.innerHTML = "";
    els.board.classList.add("hidden");
    els.board.innerHTML = "";
    prog.ignoreStreak = Math.min(5, prog.ignoreStreak + 1);
    progDirty = true;
    setTimeout(() => endEvent(), 900);
  }

  function endEvent() {
    phase = "idle";
    currentWord = null;
    bubble(null);
    setStar("sleep");
    // つぎのおねがい: 無視されるほど遠慮する
    nextWishAt = playSeconds + (210 * Math.pow(2, prog.ignoreStreak) > 1200
      ? 1200 : 210 * Math.pow(2, prog.ignoreStreak));
    saveProg();
  }

  /* ── ほしのこ タップ（子ども発ルート） ── */
  function onStarTap() {
    KKM.Sound.ensure();
    if (phase !== "idle") return;
    prog.tapCount++;
    progDirty = true;
    // とびきりの夜: 8語であったあと、ときどき kaleidoscope
    const seenCount = WORDS.filter(([w]) => wordState(w).seen > 0).length;
    if (seenCount >= 8 && prog.tapCount % 9 === 0) {
      startKaleidoscopeShow();
    } else {
      startFirework(introduceNext());
    }
  }

  /* ── 毎フレーム ── */
  function update(dt) {
    if (KKM.state.screen !== "peek") return;
    const busyUI = document.body.classList.contains("dock-open") ||
      !document.getElementById("paint-modal").classList.contains("hidden") ||
      !document.getElementById("photo-machine").classList.contains("hidden") ||
      !document.getElementById("photo-modal").classList.contains("hidden");
    if (phase === "idle") {
      if (busyUI) return;
      playSeconds += dt;
      if (playSeconds >= nextWishAt) {
        if (!startWish()) nextWishAt = playSeconds + 120;
      }
      return;
    }
    phaseTimer += dt;
    if (phase === "impostor" && phaseTimer > 18) impostorTimeout();
    else if (phase === "wish" && phaseTimer > 12) wishIgnored();
    else if (phase === "assembly" && phaseTimer > 25) wishIgnored();
  }

  /* ── 初期化 ── */
  function init(ch) {
    chamber = ch;
    loadProg();
    els.star = $("hoshinoko");
    els.bubble = $("hoshi-bubble");
    els.ring = $("word-ring");
    els.tray = $("word-tray");
    els.board = $("asm-board");
    setStar("sleep");
    els.star.addEventListener("pointerdown", e => {
      e.stopPropagation();
      onStarTap();
    });
    setInterval(saveProg, 5000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { progDirty = true; saveProg(); }
    });
  }

  return {
    init, update,
    /* テスト用フック */
    _debug: {
      forceWish(word) {
        if (word) { const st = wordState(word); if (st.seen === 0) st.seen = 1; st.due = 0; }
        endEvent(); phase = "idle"; return startWish();
      },
      setBox(word, box) {
        const st = wordState(word); st.box = box; st.seen = Math.max(1, st.seen); st.due = 0;
        progDirty = true;
      },
      fire(word) { if (phase === "idle") startFirework(word || introduceNext()); },
      special() { if (phase === "idle") startKaleidoscopeShow(); },
      phase: () => phase,
    },
  };
})();
