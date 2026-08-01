import * as THREE from 'three';
import { createQuakeScript } from '../core/quake.js';
import { simulateQuake, findDangerEvents, RECORD_EVERY } from '../core/simulate.js';
import { BEAR, DESK, isUnderDesk } from '../core/layout.js';
import { buildBearGhost } from '../scene/bear.js';

/**
 * ゲーム全体のフェーズ制御。
 *
 * placeA → playA → resultA → rewind → placeB → playB → compare → (again)
 *
 * 「ぐらぐら」を押した瞬間に地震の全過程を事前計算し（simulateQuake）、
 * 画面はその記録を再生する。A と B は同じ記録を使うため、
 * 揺れ・タイミング・落下軌道は厳密に一致する。
 */

// 遊びやすい揺れになるよう確認済みのシード（サイコロで順に切り替え）
export const CURATED_SEEDS = [13, 3, 2, 5, 17, 12];

export class Game {
  constructor({ worldGroup, dynamicMeshes, bear, effects, hud, sounds, drag, quakeButtonExtra }) {
    this.worldGroup = worldGroup;
    this.dynamicMeshes = dynamicMeshes; // Map<id, Group>
    this.bear = bear;
    this.effects = effects;
    this.hud = hud;
    this.sounds = sounds;
    this.drag = drag;
    this.quakeButtonExtra = quakeButtonExtra;

    this.phase = 'placeA';
    this.seedIndex = 0;
    this.seed = CURATED_SEEDS[0];
    this.quakeScript = null;
    this.recording = null;

    this.playFrame = 0; // 再生位置（記録フレーム・小数）
    this.playSpeed = 1;
    this.slowmoWindows = [];
    this.dangerEvents = [];
    this.firedImpacts = new Set();
    this.firedDanger = new Set();
    this.landingShown = new Set();
    this.resultA = null;
    this.resultB = null;
    this.bearPosA = null;
    this.ghost = null;

    this.hud.setMainMode('quake');
    this.drag.enabled = true;
  }

  /** 記録を用意（シードごとにキャッシュ） */
  ensureRecording() {
    if (this.recording && this.recording.seed === this.seed) return;
    this.quakeScript = createQuakeScript(this.seed);
    this.recording = simulateQuake(this.quakeScript);
  }

  bearPos() {
    return { x: this.bear.group.position.x, z: this.bear.group.position.z };
  }

  /** メインボタン */
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

    this.dangerEvents = findDangerEvents(this.recording, pos, BEAR.radius + 0.05, BEAR.height + 0.06);
    this.underDesk = isUnderDesk(pos.x, pos.z);

    // スローモーションの窓：最初の危険イベント／（机の下なら）最初の本の机ヒット
    this.slowmoWindows = [];
    if (this.dangerEvents.length > 0) {
      const f = this.dangerEvents[0].frame;
      this.slowmoWindows.push({ start: f - 10, end: f + 8 });
    } else if (this.underDesk) {
      const hit = this.recording.impacts.find(
        (i) => i.surface === 'desk' && i.id.startsWith('book') && i.speed > 2,
      );
      if (hit) {
        const f = Math.floor(hit.step / RECORD_EVERY);
        this.slowmoWindows.push({ start: f - 6, end: f + 10 });
      }
    }

    this.playFrame = 0;
    this.playSpeed = 1;
    this.firedImpacts = new Set();
    this.firedDanger = new Set();
    this.landingShown = new Set();
    this.effects.clearDangerMarkers();
    this.effects.hideSafeGlow();
    this.hud.hideBadge();
    this.hud.hideCompare();
    this.hud.hideHint();
    this.hud.setMainMode('hidden');
    this.drag.enabled = false;
    this.bear.pickRing.visible = false;
    this.bear.setExpression('happy');
    this.phase = isA ? 'playA' : 'playB';
    this.sounds.rumbleStart();
  }

  startRewind() {
    this.phase = 'rewind';
    this.hud.setMainMode('hidden');
    this.hud.hideBadge();
    this.hud.veil(true);
    this.sounds.whoosh();
    // Aの結果をゴーストとして残す：くまの輪郭＋着地リング
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
      if (spec?.dangerous) this.effects.addGhostMarker(l.x, l.z, 0.26);
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
    this.drag.enabled = true;
    this.bear.pickRing.visible = true;
    this.bear.setExpression('happy');
    this.resetDynamicMeshes();
    this.applyShake(0);
  }

  resetDynamicMeshes() {
    this.ensureRecording();
    this.applyFrame(0);
  }

  /** 記録フレームをメッシュに適用（フレーム間は補間） */
  applyFrame(frame) {
    const rec = this.recording;
    const f0 = Math.min(rec.frameCount - 1, Math.floor(frame));
    const f1 = Math.min(rec.frameCount - 1, f0 + 1);
    const t = frame - f0;
    for (const spec of rec.specs) {
      const mesh = this.dynamicMeshes.get(spec.id);
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

  /** 再生中のイベント（音・演出）を発火 */
  fireEvents(prevFrame, frame) {
    const rec = this.recording;
    // 衝突音
    for (let i = 0; i < rec.impacts.length; i++) {
      const imp = rec.impacts[i];
      const f = imp.step / RECORD_EVERY;
      if (f > prevFrame && f <= frame && !this.firedImpacts.has(i)) {
        this.firedImpacts.add(i);
        if (imp.surface === 'desk' && imp.speed > 1.5) {
          this.sounds.boing();
          this.effects.burst(new THREE.Vector3(imp.x, imp.y + 0.06, imp.z), {
            count: 6,
            kind: 'star',
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
        if (spec?.dangerous) this.effects.addDangerMarker(l.x, l.z, 0.32);
      }
    }
    // 危険イベント（くまの近くに落下）
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
    this.applyShake(0);
    this.worldGroup.position.set(0, 0, 0);
    const danger = this.dangerEvents.length > 0;
    const kind = danger ? 'danger' : this.underDesk ? 'shield' : 'safe';
    const p = this.bear.group.position;

    if (!danger) {
      this.bear.setExpression('happy');
      this.effects.showSafeGlow(p.x, p.z);
      this.effects.burst(new THREE.Vector3(p.x, 0.5, p.z), {
        count: 14,
        kind: this.underDesk ? 'heart' : 'star',
        speed: 1.2,
        up: 2,
      });
      this.sounds.fanfare();
    } else {
      // こわがらせない：少しびっくりした顔のまま、影で場所を示す
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
      // スローモーション判定
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
          if (!spec.dangerous) continue;
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
        this.hud.veil(false);
        this.phase = 'placeB';
        this.hud.setMainMode('quake');
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

    this.bear.update(time, dt);
    this.effects.update(dt);
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
