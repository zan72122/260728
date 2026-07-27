/* ═══════════════════════════════════════════════════════════
   photo.js — しゃしん キャンディーマシン

   写真を1枚えらぶと、マシンがガシャンと動いて
   ・メインタイル（丸角＋白ふち。元の写真が必ずわかる）
   ・キャンディーチップ（高彩度スポットから丸/星/ハート打ち抜き）
   を作る。すべて端末内処理・アップロードなし。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Photo = (() => {
  let chamber = null;
  let els = {};
  let pending = null;   // { tile, chips }

  function init(ch) {
    chamber = ch;
    els.input = document.getElementById("photo-input");
    els.modal = document.getElementById("photo-machine");
    els.stage = document.getElementById("machine-stage");
    els.btnAdd = document.getElementById("machine-add");
    els.btnCancel = document.getElementById("machine-cancel");
    els.card = els.modal.querySelector(".machine-card");

    document.getElementById("jar-photo").addEventListener("pointerdown", e => {
      e.preventDefault();
      KKM.Sound.uiTap();
      els.input.value = "";
      els.input.click();
    });
    els.input.addEventListener("change", () => {
      const file = els.input.files && els.input.files[0];
      if (file) process(file);
    });
    els.btnCancel.addEventListener("click", () => { KKM.Sound.uiTap(); close(); });
    els.btnAdd.addEventListener("click", addToChamber);
  }

  function close() {
    els.modal.classList.add("hidden");
    els.stage.innerHTML = "";
    pending = null;
  }

  function process(file) {
    els.modal.classList.remove("hidden");
    els.btnAdd.classList.add("hidden");
    els.stage.innerHTML = `<div class="machine-working"><i class="gear"></i><p>こしらえちゅう…</p></div>`;
    els.card.classList.add("shaking");
    KKM.Sound.machine();

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 演出のためほんの少し待つ（マシンが働いている感）
      setTimeout(() => {
        try {
          pending = KKM.Stampify.fromPhoto(img);
        } catch (e) {
          pending = null;
        }
        els.card.classList.remove("shaking");
        if (!pending || !pending.tile) {
          els.stage.innerHTML = `<p class="machine-error">うまく よみこめなかったよ</p>`;
          return;
        }
        showResult();
      }, 700);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      els.card.classList.remove("shaking");
      els.stage.innerHTML = `<p class="machine-error">うまく よみこめなかったよ</p>`;
    };
    img.src = url;
  }

  function showResult() {
    els.stage.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "machine-result";
    // メインタイル
    const tileImg = document.createElement("img");
    tileImg.className = "machine-tile pop-in";
    tileImg.src = pending.tile.toDataURL();
    wrap.appendChild(tileImg);
    // チップ
    const chipRow = document.createElement("div");
    chipRow.className = "machine-chips";
    pending.chips.forEach((chip, i) => {
      const im = document.createElement("img");
      im.className = "machine-chip pop-in";
      im.style.animationDelay = (0.12 + i * 0.09) + "s";
      im.src = chip.toDataURL();
      chipRow.appendChild(im);
      setTimeout(() => KKM.Sound.ping(900 + i * 180, 0, 0.16, 0.5), 160 + i * 90);
    });
    wrap.appendChild(chipRow);
    els.stage.appendChild(wrap);
    els.btnAdd.classList.remove("hidden");
    KKM.Sound.uiSelect();
  }

  function addToChamber() {
    if (!pending) return;
    const Store = KKM.Stampify.Store;
    const tileId = Store.add(pending.tile, "ptile");
    chamber.addStamps(tileId, KKM.PHOTO_TILE_R, [1, 0.78]);
    for (const chip of pending.chips.slice(0, 3)) {
      const id = Store.add(chip, "pchip");
      chamber.addStamps(id, KKM.PHOTO_CHIP_R, [1]);
    }
    KKM.Sound.tada();
    KKM.Sound.pour("beads");
    close();
    if (KKM.UI.notifyStampAdded) KKM.UI.notifyStampAdded();
  }

  return { init };
})();
