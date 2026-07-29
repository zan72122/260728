import * as THREE from 'three';
import { DiaperAction } from './diaper.js';
import { MilkAction } from './milk.js';
import { SleepAction } from './sleep.js';
import { BathAction } from './bath.js';

const ACTIONS = {
  diaper: DiaperAction,
  milk: MilkAction,
  sleep: SleepAction,
  bath: BathAction,
};

/**
 * お世話ぜんたいの進行役。
 * 「はこぶ → お世話する → ごほうび → もどる」を順番に世話する。
 */
export class CareController {
  constructor(ctx) {
    this.ctx = ctx;
    this.action = null;
    this.kind = null;
    this.phase = 'idle';       // idle / moving / play / reward / returning
    this._timers = [];
    this._hintPos = new THREE.Vector3();
    this._hintVisible = false;
  }

  get active() { return this.action !== null; }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== id);
      fn();
    }, ms);
    this._timers.push(id);
  }

  _clearTimers() {
    this._timers.forEach(clearTimeout);
    this._timers.length = 0;
  }

  start(kind) {
    if (this.active || !ACTIONS[kind]) return;
    const { baby, rig, hud, sfx } = this.ctx;

    this.kind = kind;
    this.phase = 'moving';
    sfx.tap();
    hud.setBusy(true);
    hud.hideBubble();
    rig.userControl = false;

    const action = new ACTIONS[kind]({ ...this.ctx, onComplete: () => this._onComplete() });
    this.action = action;

    rig.setPreset(action.cameraPreset);
    baby.moveTo(action.station, () => {
      if (this.action !== action) return;      // 途中でやめられていたら何もしない
      action.enter();
      this.phase = 'play';
      this._showHint();
    });
  }

  _showHint() {
    if (!this.action) return;
    this._hintVisible = true;
    const p = this._project(this.action.hintAnchor());
    this.ctx.hud.showHint(this.action.hintMotion, p.x, p.y);
  }

  _project(worldPos) {
    const { camera, screen } = this.ctx;
    this._hintPos.copy(worldPos).project(camera);
    return {
      x: (this._hintPos.x * 0.5 + 0.5) * screen.width,
      y: (-this._hintPos.y * 0.5 + 0.5) * screen.height,
    };
  }

  _onComplete() {
    const { state, stickerBoard, hud, sfx, baby, particles } = this.ctx;
    if (this.phase === 'reward') return;
    this.phase = 'reward';
    this._hideHint();

    state.satisfy(this.kind);
    stickerBoard.addStar();
    hud.showReward();
    sfx.star();
    baby.giggle();

    const at = baby.getHeadWorldPosition(new THREE.Vector3());
    particles.burst('sparkle', at, 16, { speed: 1.8, spread: 0.5 });
    particles.burst('heart', at, 5, { speed: 1.2, spread: 0.4, scale: 0.8 });

    this._later(() => this._returnHome(), 1500);
  }

  _hideHint() {
    if (!this._hintVisible) return;
    this._hintVisible = false;
    this.ctx.hud.hideHint();
  }

  /** ごほうびのあと、まんなかのラグへ もどる。 */
  _returnHome() {
    const { baby, rig, hud } = this.ctx;
    this.phase = 'returning';
    this.action?.exit();
    this.action = null;
    this.kind = null;
    this._hideHint();

    rig.setPreset('overview');
    baby.moveTo('rug', () => {
      this.phase = 'idle';
      hud.setBusy(false);
      rig.userControl = true;
    });
  }

  /** もどるボタン：ごほうびなしで やめる。 */
  cancel() {
    if (!this.active) return;
    this._clearTimers();
    this.ctx.sfx.tap();
    this.ctx.baby.setExpression('neutral');
    this._returnHome();
  }

  update(dt, time) {
    // ごほうび中も、あひるが浮かぶなどの演出は動かしつづける
    if (this.phase === 'play' || this.phase === 'reward') this.action?.update(dt, time);

    if (this._hintVisible && this.action) {
      const p = this._project(this.action.hintAnchor());
      this.ctx.hud.moveHint(p.x, p.y);
    }
  }

  pointerDown(p) {
    if (this.phase !== 'play') return;
    this._hideHint();
    this.action.pointerDown(p);
  }

  pointerMove(p) {
    if (this.phase !== 'play') return;
    this.action.pointerMove(p);
  }

  pointerUp(p) {
    if (this.phase !== 'play') return;
    this.action.pointerUp(p);
  }
}
