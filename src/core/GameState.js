// GameState.js — game phase + run/result bookkeeping.
//
// Units: `timeMs`/`bestMs` are milliseconds. `topSpeed` mirrors
// RiderPhysics#state.speed, i.e. meters/second (SPEC 4.3) — UI modules are
// responsible for converting to km/h for display. `maxAir` is seconds
// (mirrors RiderPhysics#state.airTime).

export const PHASE = Object.freeze({
  LOADING: 'loading',
  TITLE: 'title',
  RIDE: 'ride',
  FINISH: 'finish',
});

const STORAGE_KEY = 'aquaVelocity.bestMs.v1';

function readBestFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  } catch (err) {
    // localStorage unavailable (private mode / disabled) — fail soft.
    return null;
  }
}

function writeBestToStorage(ms) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ms));
  } catch (err) {
    // ignore — best time simply won't persist this session.
  }
}

export class GameState {
  constructor() {
    this.phase = PHASE.LOADING;

    /** @type {number} elapsed ride time in ms, counts up during PHASE.RIDE */
    this.timeMs = 0;
    /** @type {number} top speed reached this run, m/s */
    this.topSpeed = 0;
    /** @type {number} longest single airborne stretch this run, seconds */
    this.maxAir = 0;
    /** @type {number|null} best completed run, ms — null if none yet */
    this.bestMs = readBestFromStorage();
    /** @type {boolean} whether the just-finished run beat bestMs */
    this.isNewBest = false;

    /** @type {'chase'|'pov'} active camera mode, toggled with C */
    this.cameraMode = 'chase';
    /** @type {boolean} audio mute, toggled with M */
    this.muted = false;

    this._airStreak = 0;
  }

  /** Reset per-run counters and switch into RIDE. Call when a run starts. */
  startRide() {
    this.timeMs = 0;
    this.topSpeed = 0;
    this.maxAir = 0;
    this.isNewBest = false;
    this._airStreak = 0;
    this.phase = PHASE.RIDE;
  }

  /**
   * Advance run bookkeeping. Call once per frame while in PHASE.RIDE with
   * the elapsed dt (seconds, real/display time — not the physics fixed
   * step) and the latest `physics.state` (SPEC 4.3).
   */
  update(dt, physicsState) {
    if (this.phase !== PHASE.RIDE) return;

    this.timeMs += dt * 1000;

    if (physicsState) {
      if (physicsState.speed > this.topSpeed) this.topSpeed = physicsState.speed;

      if (physicsState.airborne) {
        this._airStreak = physicsState.airTime || 0;
      } else {
        this._airStreak = 0;
      }
      if (this._airStreak > this.maxAir) this.maxAir = this._airStreak;
    }
  }

  /**
   * Transition into FINISH, settle the best-time record, and return the
   * result payload expected by Screens#showResult (SPEC 4.11).
   */
  finish() {
    this.phase = PHASE.FINISH;

    const timeMs = this.timeMs;
    const isNewBest = this.bestMs === null || timeMs < this.bestMs;
    this.isNewBest = isNewBest;
    if (isNewBest) {
      this.bestMs = timeMs;
      writeBestToStorage(timeMs);
    }

    return {
      timeMs,
      topSpeed: this.topSpeed,
      maxAir: this.maxAir,
      bestMs: this.bestMs,
      isNewBest,
    };
  }

  toggleCameraMode() {
    this.cameraMode = this.cameraMode === 'chase' ? 'pov' : 'chase';
    return this.cameraMode;
  }

  toggleMuted() {
    this.muted = !this.muted;
    return this.muted;
  }
}
