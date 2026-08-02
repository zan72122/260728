import * as THREE from 'three';
import { createQuakeScript } from '../core/quake.js';
import { simulateQuake, findDangerEvents, RECORD_EVERY } from '../core/simulate.js';
import { BEAR, shieldAt, platformAt, inZone } from '../core/layout.js';
import { buildBearGhost } from '../scene/bear.js';

/**
 * ゲーム全体のフェーズ制御。
 *
 * placeA → playA → resultA → rewind → placeB → playB → compare → (again)
 *
 * 「ぐらぐら」を押した瞬間に地震の全過程を事前計算し（simulateQuake）、
 * 画面はその記録を再生する。A と B は同じ記録を使うため、
 * 揺れ・タイミング・落下軌道は厳密に一致する。
 *
 * 記録は（部屋・シード・強さ・金具）の組でキャッシュされる。
 * B配置中に金具だけを切り替えて「同じ揺れ・違う備え」の比較もできる。
 */

// 遊びやすい揺れになるよう確認済みのシード（サイコロで順に切り替え）
export const CURATED_SEEDS = [13, 3, 2, 5, 17, 12];

export class Game {
  constructor({ worldGroup, bear, effects, hud, sounds, drag }) {
    this.worldGroup = worldGroup;
    this.bear = bear;
    this.effects = effects;
    this.hud = hud;
    this.sounds = sounds;
    this.drag = drag;

    this.phase = 'placeA';
    this.seedIndex = 0;
    this.seed = CURATED_SEEDS[0];
    this.strength = 1;
    this.anchorsByRoom = new Map(); // roomId -> Set<id>
    this.recordingCache = new Map();
    this.recording = null;
    this.quakeScript = null;

    this.room = null;
    this.dynamicMeshes = new Map();
    this.sceneHandles = {};

    this.playFrame = 0;
    this.playSpeed = 1;
    this.slowmoWindows = [];
    this.dangerEvents = [];
    this.firedImpacts = new Set();
    this.firedDanger = new Set();
    this.firedTips = new Set();
    this.landingShown = new Set();
    this.resultA = null;
    this.resultB = null;
    this.bearPosA = null;
    this.ghost = null;
    this.futonT = 0;
  }

  /** 現在の部屋の金具セット */
  get anchors() {
    if (!this.anchorsByRoom.has(this.room?.id)) this.anchorsByRoom.set(this.room?.id, new Set());
    return this.anchorsByRoom.get(this.room?.id);
  }

  /**
   * 部屋を切り替える（RoomManager から呼ばれる）。
   * sceneHandles: { dynamicMeshes, tippables: Map<id,{group,belt}>, futon?, futonHome? }
   */
  setRoom(room, sceneHandles) {
    this.room = room;
    this.sceneHandles = sceneHandles;
    this.dynamicMeshes = sceneHandles.dynamicMeshes;
    this.drag.setRoom(room);
    this.recording = null;
    this.resultA = null;
    this.resultB = null;
    this.bearPosA = null;
    if (this.ghost) {
      this.worldGroup.remove(this.ghost);
      this.ghost = null;
    }
    this.effects.clearAll();
    this.hud.hideBadge();
    this.hud.hideCompare();
    this.phase = 'placeA';
    this.hud.setMainMode('quake');
    this.hud.setArrowsVisible(true);
    this.hud.setStrengthVisible(true);
    this.hud.setStrengthLocked(false);
    this.drag.enabled = true;
    this.bear.pickRing.visible = true;
    this.bear.setExpression('happy');
    this.resetDynamicMeshes();
    this.applyAnchorsVisual();
    this.worldGroup.position.set(0, 0, 0);
  }

  cacheKey() {
    return `${this.room.id}|${this.seed}|${this.strength}|${[...this.anchors].sort().join(',')}`;
  }

  ensureRecording() {
    const key = this.cacheKey();
    let rec = this.recordingCache.get(key);
    if (!rec) {
      this.quakeScript = createQuakeScript(this.seed, this.strength);
      rec = simulateQuake(this.room, this.quakeScript, this.anchors);
      this.recordingCache.set(key, rec);
      if (this.recordingCache.size > 12) {
        // 古いものから捨てる（Mapは挿入順）
        this.recordingCache.delete(this.recordingCache.keys().next().value);
      }
    } else {
      this.quakeScript = createQuakeScript(this.seed, this.strength);
    }
    this.recording = rec;
  }

  bearPos() {
    return { x: this.bear.group.position.x, z: this.bear.group.position.z };
  }

  setStrength(i) {
    if (this.phase !== 'placeA') return; // 比較中は同じ揺れで固定
    this.strength = i;
    this.hud.setStrength(i);
    this.sounds.unlock();
    this.sounds.click();
  }

  /** 金具の切り替え（転倒家具をタップ） */
  toggleAnchor(id) {
    if (this.phase !== 'placeA' && this.phase !== 'placeB') return false;
    const t = (this.room.tippables ?? []).find((x) => x.id === id && x.anchorable);
    if (!t) return false;
    if (this.anchors.has(id)) this.anchors.delete(id);
    else this.anchors.add(id);
    this.applyAnchorsVisual();
    this.sounds.unlock();
    this.sounds.click();
    const h = this.sceneHandles.tippables?.get(id);
    if (h) {
      const p = h.group.position;
      this.effects.burst(new THREE.Vector3(p.x, this.anchors.has(id) ? t.size.y + 0.1 : 0.6, p.z), {
        count: 6,
        kind: this.anchors.has(id) ? 'star' : 'pink',
        speed: 0.7,
        up: 1.0,
        size: 0.1,
      });
    }
    return true;
  }

  applyAnchorsVisual() {
    for (const [id, h] of this.sceneHandles.tippables ?? []) {
      if (h.belt) h.belt.visible = this.anchors.has(id);
    }
  }

  onMainButton() {
    this.sounds.unlock();
    this.sounds.click();
    if (this.phase === 'placeA' || this.phase === 'placeB') this.startPlay();
    else if (this.phase === 'resultA') this.startRewind();
    else if (this.phase === 'compare') this.restart(false);
  }

  startPlay() {
    this.ensureRecording();
    const isA = this.phase === 'placeA';
    const pos = this.bearPos();
    if (isA) this.bearPosA = pos;

    this.dangerEvents = findDangerEvents(
      this.room,
      this.recording,
      pos,
      BEAR.radius + 0.05,
      BEAR.height + 0.06,
    );
    this.shield = shieldAt(this.room, pos.x, pos.z);

    // スローモーションの窓：最初の危険イベント／転倒の瞬間／（守られていれば）最初の受け止め
    this.slowmoWindows = [];
    if (this.dangerEvents.length > 0) {
      const f = this.dangerEvents[0].frame;
      this.slowmoWindows.push({ start: f - 10, end: f + 8 });
    }
    for (const tip of this.recording.tipEvents) {
      this.slowmoWindows.push({ start: tip.startFrame - 4, end: tip.startFrame + 14 });
    }
    if (this.dangerEvents.length === 0 && this.shield) {
      const surfaceId = this.shield.badge === 'futon' ? 'bed' : this.shieldSurfaceId();
      const hit = this.recording.impacts.find((i) => i.surface === surfaceId && i.speed > 1.6);
      if (hit) {
        const f = Math.floor(hit.step / RECORD_EVERY);
        this.slowmoWindows.push({ start: f - 6, end: f + 10 });
      }
    }

    this.playFrame = 0;
    this.playSpeed = 1;
    this.firedImpacts = new Set();
    this.firedDanger = new Set();
    this.firedTips = new Set();
    this.landingShown = new Set();
    this.effects.clearDangerMarkers();
    this.effects.hideSafeGlow();
    this.hud.hideBadge();
    this.hud.hideCompare();
    this.hud.hideHint();
    this.hud.setMainMode('hidden');
    this.hud.setArrowsVisible(false);
    this.hud.setStrengthVisible(false);
    this.drag.enabled = false;
    this.bear.pickRing.visible = false;
    this.bear.setExpression('happy');
    this.phase = isA ? 'playA' : 'playB';
    this.sounds.rumbleStart();
  }

  /** 机・テーブルなど「boing」対象の静的家具id */
  shieldSurfaceId() {
    for (const s of this.room.statics) {
      if (s.boing) return s.id;
    }
    return 'desk';
  }

  startRewind() {
    this.phase = 'rewind';
    this.hud.setMainMode('hidden');
    this.hud.hideBadge();
    this.hud.veil(true);
    this.sounds.whoosh();
    this.makeGhostFromA();
  }

  makeGhostFromA() {
    if (this.ghost) this.worldGroup.remove(this.ghost);
    this.ghost = buildBearGhost();
    this.ghost.position.set(this.bearPosA.x, 0, this.bearPosA.z);
    // くまがまだ同じ場所にいる間は隠しておく（重なってちらつくため）。
    // くまを動かした瞬間に「まえに いた ばしょ」として現れる。
    this.ghost.visible = false;
    this.worldGroup.add(this.ghost);

    this.effects.clearDangerMarkers();
    this.effects.clearGhostMarkers();
    for (const [id, l] of this.recording.landings) {
      const spec = this.recording.specs.find((s) => s.id === id);
      if (spec?.dangerous && !spec.tippable) this.effects.addGhostMarker(l.x, l.z, 0.26);
    }
    for (const tip of this.recording.tipEvents) {
      this.effects.addGhostMarker(tip.restX, tip.restZ, 0.4);
    }
  }

  restart(newSeed) {
    if (newSeed) {
      this.seedIndex = (this.seedIndex + 1) % CURATED_SEEDS.length;
      this.seed = CURATED_SEEDS[this.seedIndex];
    }
    // 再生や巻き戻しの途中で呼ばれても安全に戻れるように
    this.sounds.rumbleStop();
    this.hud.veil(false);
    this.worldGroup.position.set(0, 0, 0);
    this.phase = 'placeA';
    this.resultA = null;
    this.resultB = null;
    this.bearPosA = null;
    if (this.ghost) {
      this.worldGroup.remove(this.ghost);
      this.ghost = null;
    }
    this.effects.clearAll();
    this.hud.hideBadge();
    this.hud.hideCompare();
    this.hud.setMainMode('quake');
    this.hud.setArrowsVisible(true);
    this.hud.setStrengthVisible(true);
    this.hud.setStrengthLocked(false);
    this.drag.enabled = true;
    this.bear.pickRing.visible = true;
    this.bear.setExpression('happy');
    this.resetDynamicMeshes();
  }

  /** 全ての動的メッシュを初期姿勢に戻す（記録なしで部屋データから） */
  resetDynamicMeshes() {
    for (const spec of this.room.dynamics) {
      const mesh = this.dynamicMeshes.get(spec.id);
      if (!mesh) continue;
      mesh.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
      mesh.rotation.set(spec.leanX || 0, spec.rotY || 0, spec.leanZ || 0);
    }
    for (const t of this.room.tippables ?? []) {
      const h = this.sceneHandles.tippables?.get(t.id);
      if (!h) continue;
      h.group.position.set(t.pos.x, t.size.y / 2 + 0.002, t.pos.z);
      h.group.rotation.set(0, t.rotY || 0, 0);
    }
  }

  /** 記録フレームをメッシュに適用（フレーム間は補間） */
  applyFrame(frame) {
    const rec = this.recording;
    const f0 = Math.min(rec.frameCount - 1, Math.floor(frame));
    const f1 = Math.min(rec.frameCount - 1, f0 + 1);
    const t = frame - f0;
    for (const spec of rec.specs) {
      const mesh = this.dynamicMeshes.get(spec.id);
      if (!mesh) continue;
      const arr = rec.frames.get(spec.id);
      const o0 = f0 * 7;
      const o1 = f1 * 7;
      mesh.position.set(
        arr[o0] + (arr[o1] - arr[o0]) * t,
        arr[o0 + 1] + (arr[o1 + 1] - arr[o0 + 1]) * t,
        arr[o0 + 2] + (arr[o1 + 2] - arr[o0 + 2]) * t,
      );
      _qa.set(arr[o0 + 3], arr[o0 + 4], arr[o0 + 5], arr[o0 + 6]);
      _qb.set(arr[o1 + 3], arr[o1 + 4], arr[o1 + 5], arr[o1 + 6]);
      mesh.quaternion.slerpQuaternions(_qa, _qb, t);
    }
  }

  /** 部屋の見た目の揺れ（物理には無関係・カメラとUIは揺れない） */
  applyShake(frame) {
    const script = this.quakeScript;
    if (!script) return;
    const step = Math.min(script.steps - 1, Math.round(frame * RECORD_EVERY));
    this.worldGroup.position.x = script.dispX[step] ?? 0;
    this.worldGroup.position.z = script.dispZ[step] ?? 0;
    this.curEnvelope = script.envelope[step] ?? 0;
  }

  fireEvents(prevFrame, frame) {
    const rec = this.recording;
    // 衝突音
    for (let i = 0; i < rec.impacts.length; i++) {
      const imp = rec.impacts[i];
      const f = imp.step / RECORD_EVERY;
      if (f > prevFrame && f <= frame && !this.firedImpacts.has(i)) {
        this.firedImpacts.add(i);
        const boingId = this.shieldSurfaceId();
        if ((imp.surface === boingId || imp.surface === 'bed') && imp.speed > 1.5) {
          this.sounds.boing();
          this.effects.burst(new THREE.Vector3(imp.x, imp.y + 0.06, imp.z), {
            count: 6,
            kind: imp.surface === 'bed' ? 'heart' : 'star',
            speed: 0.8,
            up: 1.2,
            size: 0.1,
          });
        } else if (imp.speed > 1.2) {
          this.sounds.thud(Math.min(1, imp.speed / 5));
        }
      }
    }
    // 床への着地 → 危険の影（着地の少し前から「ここに落ちるよ」と予告する）
    for (const [id, l] of rec.landings) {
      const f = l.step / RECORD_EVERY - 18;
      if (f > prevFrame && f <= frame && !this.landingShown.has(id)) {
        this.landingShown.add(id);
        const spec = rec.specs.find((s) => s.id === id);
        if (spec?.dangerous && !spec.tippable) this.effects.addDangerMarker(l.x, l.z, 0.32);
      }
    }
    // 家具の転倒 → 倒れ先に帯状の危険の影＋ぽふん
    for (const tip of rec.tipEvents) {
      if (tip.startFrame > prevFrame && tip.startFrame <= frame && !this.firedTips.has(tip.id)) {
        this.firedTips.add(tip.id);
        const t = (this.room.tippables ?? []).find((x) => x.id === tip.id);
        const spec = rec.specs.find((s) => s.id === tip.id);
        const size = spec?.size ?? t?.size ?? { x: 0.5, y: 1.2, z: 0.4 };
        const ox = tip.restX - (t?.pos.x ?? tip.restX);
        const oz = tip.restZ - (t?.pos.z ?? tip.restZ);
        const rotZ = -Math.atan2(ox, oz);
        this.effects.addDangerMarker(
          (tip.restX + (t?.pos.x ?? tip.restX)) / 2,
          (tip.restZ + (t?.pos.z ?? tip.restZ)) / 2,
          0.42,
          { sx: (size.x + 0.3) / 0.84, sz: (size.y + 0.4) / 0.84, rotZ },
        );
      }
      const fallF = tip.fallenFrame;
      if (fallF > prevFrame && fallF <= frame && this.firedTips.has(tip.id)) {
        if (!this.firedTips.has(tip.id + ':sound')) {
          this.firedTips.add(tip.id + ':sound');
          this.sounds.pofun();
          this.effects.burst(new THREE.Vector3(tip.restX, 0.25, tip.restZ), {
            count: 10,
            kind: 'pink',
            speed: 1.6,
            up: 1.4,
            size: 0.12,
          });
        }
      }
    }
    // 危険イベント（くまの近くに落下・転倒）
    for (const ev of this.dangerEvents) {
      if (ev.frame > prevFrame && ev.frame <= frame && !this.firedDanger.has(ev.id)) {
        this.firedDanger.add(ev.id);
        this.bear.setExpression('surprised');
        this.sounds.uhoh();
        const p = this.bear.group.position;
        this.effects.addDangerMarker(p.x, p.z, 0.42);
      }
    }
  }

  finishPlay() {
    this.sounds.rumbleStop();
    this.worldGroup.position.set(0, 0, 0);
    const danger = this.dangerEvents.length > 0;
    const kind = danger ? 'danger' : this.shield ? this.shield.badge : 'safe';
    const p = this.bear.group.position;

    if (!danger) {
      this.bear.setExpression('happy');
      this.effects.showSafeGlow(p.x, p.z);
      this.effects.burst(new THREE.Vector3(p.x, p.y + 0.5, p.z), {
        count: 14,
        kind: this.shield ? 'heart' : 'star',
        speed: 1.2,
        up: 2,
      });
      this.sounds.fanfare();
    } else {
      this.sounds.uhoh();
    }

    if (this.phase === 'playA') {
      this.resultA = kind;
      this.phase = 'resultA';
      this.hud.showBadge(kind);
      this.hud.setMainMode('rewind');
    } else {
      this.resultB = kind;
      this.phase = 'compare';
      this.hud.showCompare(this.resultA, this.resultB);
      this.hud.setMainMode('again');
      if (!danger) this.sounds.sparkle();
    }
  }

  update(dt, time) {
    const rec = this.recording;

    if (this.phase === 'playA' || this.phase === 'playB') {
      let inSlow = false;
      for (const w of this.slowmoWindows) {
        if (this.playFrame >= w.start && this.playFrame <= w.end) inSlow = true;
      }
      this.playSpeed += ((inSlow ? 0.18 : 1) - this.playSpeed) * Math.min(1, dt * 10);

      const prev = this.playFrame;
      this.playFrame = Math.min(rec.frameCount - 1, this.playFrame + dt * 60 * this.playSpeed);
      this.applyFrame(this.playFrame);
      this.applyShake(this.playFrame);
      this.fireEvents(prev, this.playFrame);
      this.sounds.rumbleLevel(this.curEnvelope ?? 0);

      // 落下中の危険物に光の軌跡
      if (Math.floor(prev * 2) !== Math.floor(this.playFrame * 2)) {
        for (const spec of rec.specs) {
          if (!spec.dangerous || spec.tippable) continue;
          const mesh = this.dynamicMeshes.get(spec.id);
          const arr = rec.frames.get(spec.id);
          const f0 = Math.max(0, Math.floor(this.playFrame) - 2) * 7;
          const vy = (mesh.position.y - arr[f0 + 1]) / (2 * rec.dt);
          if (vy < -0.6 && mesh.position.y > 0.1) {
            this.effects.emitTrail(mesh.position, 0.15);
          }
        }
      }

      if (this.playFrame >= rec.frameCount - 1) this.finishPlay();
    } else if (this.phase === 'rewind') {
      this.playFrame = Math.max(0, this.playFrame - dt * 60 * 5);
      this.applyFrame(this.playFrame);
      if (this.playFrame <= 0) {
        // 完全に初期姿勢へ（記録フレーム0は物理1ステップ後なので、スペック姿勢に揃える）
        this.resetDynamicMeshes();
        this.hud.veil(false);
        this.phase = 'placeB';
        this.hud.setMainMode('quake');
        this.hud.setStrengthVisible(true);
        this.hud.setStrengthLocked(true); // 同じ揺れで比較する
        this.drag.enabled = true;
        this.bear.pickRing.visible = true;
        this.bear.setExpression('happy');
      }
    }

    // 配置Bで、くまが元の場所から離れたらゴーストを見せる
    if (this.phase === 'placeB' && this.ghost && !this.ghost.visible && this.bearPosA) {
      const dx = this.bear.group.position.x - this.bearPosA.x;
      const dz = this.bear.group.position.z - this.bearPosA.z;
      if (dx * dx + dz * dz > 0.12 * 0.12) this.ghost.visible = true;
    }

    // 布団：くまがベッドの上にいるとき、ふわっとかかる
    this.updateFuton(dt);

    this.bear.update(time, dt);
    this.effects.update(dt);
  }

  updateFuton(dt) {
    const futon = this.sceneHandles.futon;
    if (!futon) return;
    const p = this.bear.group.position;
    const platform = platformAt(this.room, p.x, p.z);
    const onBed = !!platform?.futon && !this.drag.dragging;
    this.futonT += ((onBed ? 1 : 0) - this.futonT) * Math.min(1, dt * 6);
    const t = this.futonT;
    const home = this.sceneHandles.futonHome;
    // たたまれた位置 → くまの上へ
    const targetX = home.x + (p.x - home.x) * t;
    const targetZ = home.z + (p.z + 0.05 - home.z) * t;
    const targetY = home.y + (p.y + BEAR.height * 0.42 - home.y) * t;
    futon.position.set(targetX, targetY, targetZ);
    futon.scale.set(1, 0.55 + t * 0.35, 0.62 + t * 0.5);
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export { inZone };
