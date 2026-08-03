// ============================================================
// みずみちラボ - タッチ入力
// ============================================================
"use strict";

const Input = {
  tool: "water",
  buildingKind: "house",
  down: false,
  cursor: null,          // {x, y} ワールド座標 (セル単位)
  pointerId: null,
  dragBuilding: null,    // つかんで動かしている建物
  strokeDidUndoPush: false,

  init(canvas) {
    canvas.addEventListener("pointerdown", (e) => this.onDown(e), { passive: false });
    canvas.addEventListener("pointermove", (e) => this.onMove(e), { passive: false });
    window.addEventListener("pointerup", (e) => this.onUp(e), { passive: false });
    window.addEventListener("pointercancel", (e) => this.onUp(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  },

  setTool(name) {
    this.tool = name;
    document.querySelectorAll("#toolbar .tool").forEach(b => {
      b.classList.toggle("active", b.dataset.tool === name);
    });
    document.getElementById("subPalette").classList.toggle("hidden", name !== "building");
    Sound.tap();
  },

  worldPos(e) {
    const rect = Render.canvas.getBoundingClientRect();
    return Render.pick(e.clientX - rect.left, e.clientY - rect.top);
  },

  onDown(e) {
    e.preventDefault();
    if (this.pointerId !== null) return;   // 1本目の指だけ
    const p = this.worldPos(e);
    if (!p) return;
    this.pointerId = e.pointerId;
    this.down = true;
    this.cursor = p;
    Sound.unlock();

    const t = this.tool;
    if (t === "wave") {
      // どこを触っても なみ (ボタンがわりの全画面ツール)
      if (Water.surgeT < 0) {
        pushUndo();  // 念のため
        World.undoStack.pop();
        startWave(1.2);
        Particles.ring(p.x, p.y, World.h[idx(clamp(Math.floor(p.x), 0, CFG.GW - 1), clamp(Math.floor(p.y), 0, CFG.GH - 1))]);
      }
      return;
    }
    if (t === "building") {
      const b = buildingAt(p.x, p.y);
      pushUndo();
      this.strokeDidUndoPush = true;
      if (b) {
        this.dragBuilding = b;   // 既存をつかむ
        Sound.boing();
      } else {
        this.dragBuilding = null;
      }
      return;
    }
    if (t === "water") {
      Sound.pourStart();
      Particles.ring(p.x, p.y, World.h[idx(clamp(Math.floor(p.x), 0, CFG.GW - 1), clamp(Math.floor(p.y), 0, CFG.GH - 1))]);
      return;
    }
    // 地形ツール: ストロークのはじめに undo を積む
    pushUndo();
    this.strokeDidUndoPush = true;
    this.applyTool(p, 1 / 60);
    if (t === "mountain" || t === "plateau") Sound.pop();
    else if (t === "ditch" || t === "river") Sound.dig();
    else if (t === "levee") Sound.pop();
  },

  onMove(e) {
    if (e.pointerId !== this.pointerId && this.pointerId !== null) return;
    const p = this.worldPos(e);
    if (!p) return;
    this.cursor = p;
    if (!this.down) return;
    e.preventDefault();
    if (this.tool === "building" && this.dragBuilding) {
      this.dragBuilding.x = clamp(Math.round(p.x - 1), 1, CFG.GW - 3);
      this.dragBuilding.y = clamp(Math.round(p.y - 1), 1, CFG.GH - 3);
      return;
    }
    if (this.tool !== "water" && this.tool !== "wave" && this.tool !== "building") {
      this.applyTool(p, 1 / 60);
    }
  },

  onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    const p = this.cursor;
    if (this.tool === "building" && this.down) {
      if (this.dragBuilding) {
        flattenUnder(this.dragBuilding.x, this.dragBuilding.y);
        Sound.pop();
      } else if (p) {
        // 新しく置く (海はダメ)
        const gx = clamp(Math.round(p.x - 1), 1, CFG.GW - 3);
        const gy = clamp(Math.round(p.y - 1), 1, CFG.GH - 3);
        if (!World.seaMask[idx(gx, gy)] && !World.seaMask[idx(gx + 1, gy + 1)]) {
          addBuilding(this.buildingKind, gx, gy);
          Particles.poof(gx + 1, gy + 1, World.h[idx(gx, gy)]);
          Sound.pop();
          Mascot.react("happy");
        } else {
          Sound.tap();
          if (this.strokeDidUndoPush) World.undoStack.pop();
        }
      }
      this.dragBuilding = null;
    }
    if (this.tool === "water") Sound.pourStop();
    this.down = false;
    this.pointerId = null;
    this.strokeDidUndoPush = false;
  },

  // フレームごとの連続適用 (押しっぱなし)
  step(dt) {
    if (!this.down || !this.cursor) return;
    const p = this.cursor;
    const t = this.tool;
    if (t === "water") {
      const x = clamp(Math.floor(p.x), 0, CFG.GW - 1);
      const y = clamp(Math.floor(p.y), 0, CFG.GH - 1);
      const i = idx(x, y);
      Water.w[i] += CFG.POUR_RATE;
      if (inGrid(x + 1, y)) Water.w[idx(x + 1, y)] += CFG.POUR_RATE * 0.4;
      if (inGrid(x, y + 1)) Water.w[idx(x, y + 1)] += CFG.POUR_RATE * 0.4;
      if (Math.random() < 0.5) Particles.splash(p.x, p.y, World.h[i] + Water.w[i]);
    } else if (t === "mountain" || t === "plateau") {
      this.applyTool(p, dt);   // おしている間そだつ
    }
  },

  applyTool(p, dt) {
    switch (this.tool) {
      case "mountain": toolMountain(p.x, p.y, dt); break;
      case "ditch": toolDitch(p.x, p.y); break;
      case "river": toolRiver(p.x, p.y); break;
      case "levee": toolLevee(p.x, p.y); break;
      case "plateau": toolPlateau(p.x, p.y, dt); break;
      case "eraser": toolEraser(p.x, p.y); break;
    }
  },
};
