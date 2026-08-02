import { Sfx } from './audio';
import { Particles } from './particles';
import { CARS, crackLocalPts, densify, type CarSpec, type FaultKind } from './car';
import {
  layoutGarage, layoutUnder, layoutWeld, layoutChoice,
  underToScreen, screenToUnder, PART,
} from './layout';
import { clamp, dist, easeInOutCubic, easeOutCubic, lerp } from './gfx';

export const CRACK_N = 26;

export type Phase =
  | 'title' | 'arrive' | 'garage' | 'slideIn' | 'under' | 'slideOut'
  | 'shield' | 'weld' | 'weldDone' | 'lower' | 'test' | 'choice' | 'freeweld';

export interface FaultState {
  kind: FaultKind;
  fixed: boolean;
  taps: number;
  wrenchT: number;
  boltSpin: number;
  drag: { x: number; y: number } | null;
  held: boolean;
  lift01: number;
  timer: number;
  wob: number;
  snapT: number;
}

export interface CrackState {
  kind: 'door' | 'fender';
  welded: boolean[];
  done: boolean;
  shine: number;
}

interface PointerState {
  down: boolean;
  x: number; y: number;
  sx: number; sy: number;
  st: number;
  moved: boolean;
  dragKind: null | 'lever' | 'fault';
  dragFault: number;
}

export class Game {
  W = 800; H = 600;
  time = 0;
  phase: Phase = 'title';
  tPhase = 0;

  sfx = new Sfx();
  parts = new Particles();

  carIdx = 0;
  spec: CarSpec = CARS[0];
  freePlay = false;
  playCount = 0;

  liftT = 0;
  locked = false;
  liftAnim: { to: number; speed: number } | null = null;
  lockFlash = 0;
  hitstop = 0;
  leverPull = 0; // -1..1 visual knob offset while dragging

  creeperProg = 0;
  slideAnim: { from: number; to: number; t: number; dur: number } | null = null;
  slideSpeed = 1;
  slideCount = 0;

  faults: FaultState[] = [];
  cracks: CrackState[] = [];
  weldIdx = 0;

  maskT = 0;
  arcOn = false;
  arcX = 0; arcY = 0;
  arcFlicker = 1;

  doodle: Array<{ x: number; y: number }> = [];

  test = { t: 0, course: 0, dur: 8.2 };
  doorT = 0;
  arriveT = 0;
  settleBounce = 0;
  coolantFlow = 0;

  hintT = 0;
  hintGhost = 0;

  shake = 0;
  shakeAmp = 0;

  fade: { t: number; dur: number; mid: () => void; fired: boolean } | null = null;

  blink = 0;
  private blinkTimer = 2;
  wheelSpin = 0;
  private carRattleTimer = 0.4;

  pointer: PointerState = {
    down: false, x: 0, y: 0, sx: 0, sy: 0, st: 0, moved: false, dragKind: null, dragFault: -1,
  };
  private swallowUp = false;

  // ---------------------------------------------------------------- setup

  resetCar(idx: number, free: boolean): void {
    this.carIdx = idx;
    this.spec = CARS[idx];
    this.freePlay = free;
    this.liftT = 0;
    this.locked = false;
    this.liftAnim = null;
    this.creeperProg = 0;
    this.slideAnim = null;
    this.maskT = 0;
    this.arcOn = false;
    this.weldIdx = 0;
    this.doorT = 0;
    this.coolantFlow = 0;
    this.settleBounce = 0;
    this.faults = free ? [] : this.spec.faults.map((kind) => ({
      kind, fixed: false, taps: 0, wrenchT: 0, boltSpin: 0,
      drag: null, held: false, lift01: 0, timer: 0.5 + Math.random(), wob: Math.random() * 6, snapT: 0,
    }));
    this.cracks = free ? [] : [{
      kind: this.spec.crack,
      welded: new Array<boolean>(CRACK_N).fill(false),
      done: false, shine: 0,
    }];
    this.parts.list.length = 0;
    this.sfx.stopAllLoops();
  }

  faultsRemaining(): number {
    return this.faults.filter((f) => !f.fixed).length;
  }

  cracksRemaining(): number {
    return this.cracks.filter((c) => !c.done).length;
  }

  allRepaired(): boolean {
    return this.faultsRemaining() === 0 && this.cracksRemaining() === 0;
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.tPhase = 0;
    this.hintT = 0;
    this.pointer.dragKind = null;
    this.pointer.dragFault = -1;
  }

  startFade(mid: () => void, dur = 0.7): void {
    if (this.fade) {
      // a tap during the fade-in half replaces the fade (so quick taps never get lost);
      // during the fade-out half (mid not fired yet) the previous fade wins
      if (!this.fade.fired) return;
      const half = this.fade.dur / 2;
      const darkness = clamp(1 - (this.fade.t - half) / half, 0, 1);
      this.fade = { t: darkness * (dur / 2), dur, mid, fired: false };
      return;
    }
    this.fade = { t: 0, dur, mid, fired: false };
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.time += dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.lockFlash = Math.max(0, this.lockFlash - dt * 1.2);
      return;
    }
    this.tPhase += dt;
    this.hintT += dt;
    this.hintGhost = (this.hintGhost + dt / 2.4) % 1;
    this.parts.update(dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.lockFlash = Math.max(0, this.lockFlash - dt * 2.2);
    this.settleBounce *= Math.exp(-dt * 4);
    this.leverPull *= Math.exp(-dt * 8);

    this.blinkTimer -= dt;
    if (this.blinkTimer < 0) {
      this.blinkTimer = 2.4 + Math.random() * 2.5;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);

    if (this.fade) {
      this.fade.t += dt;
      if (!this.fade.fired && this.fade.t >= this.fade.dur / 2) {
        this.fade.fired = true;
        this.fade.mid();
      }
      if (this.fade.t >= this.fade.dur) this.fade = null;
    }

    for (const f of this.faults) {
      f.wob += dt * (f.fixed ? 1 : 5);
      f.wrenchT = Math.max(0, f.wrenchT - dt);
      f.snapT = Math.max(0, f.snapT - dt * 1.6);
      f.boltSpin *= Math.exp(-dt * 6);
    }
    for (const c of this.cracks) c.shine = Math.max(0, c.shine - dt * 0.9);

    switch (this.phase) {
      case 'title': break;
      case 'arrive': this.updateArrive(dt); break;
      case 'garage': this.updateGarage(dt); break;
      case 'slideIn': case 'slideOut': this.updateSlide(dt); break;
      case 'under': this.updateUnder(dt); break;
      case 'shield': {
        this.maskT = Math.min(1, this.tPhase / 0.55);
        if (this.tPhase > 0.8) {
          this.sfx.click(0.6);
          this.setPhase('weld');
        }
        break;
      }
      case 'weld': this.updateWeld(dt); break;
      case 'weldDone': {
        this.maskT = Math.max(0, 1 - this.tPhase / 0.5);
        if (this.tPhase > 1.3) {
          this.parts.list.length = 0;
          this.setPhase('garage');
          this.sfx.happyBeep();
        }
        break;
      }
      case 'lower': this.updateLower(dt); break;
      case 'test': this.updateTest(dt); break;
      case 'choice': {
        if (Math.random() < dt * 1.2) {
          this.parts.sparkleBurst(Math.random() * this.W, Math.random() * this.H * 0.4, 1, '#ffe9a8', 0.4);
        }
        break;
      }
      case 'freeweld': {
        this.arcFlicker = 0.75 + Math.random() * 0.5;
        break;
      }
    }
  }

  private updateArrive(dt: number): void {
    const dur = 2.3;
    this.arriveT = clamp(this.tPhase / dur, 0, 1);
    this.wheelSpin += dt * (1 - this.arriveT) * 14;
    if (!this.freePlay) {
      this.carRattleTimer -= dt;
      if (this.carRattleTimer < 0 && this.arriveT < 0.96) {
        this.carRattleTimer = 0.12 + Math.random() * 0.2;
        this.sfx.rattleTick(0.9);
      }
      if (Math.random() < dt * 6 && this.arriveT < 0.9) {
        const l = layoutGarage(this.W, this.H);
        const carScreenX = lerp(-l.carW, l.carX, easeOutCubic(this.arriveT));
        this.parts.dust(carScreenX - l.carW * 0.5, l.groundY - 8, 1, -0.5);
      }
    }
    if (this.tPhase >= dur + 0.4) {
      if (!this.freePlay) this.sfx.robotTalk();
      this.setPhase('garage');
    }
  }

  private updateGarage(dt: number): void {
    if (this.liftAnim) {
      const a = this.liftAnim;
      const dir = Math.sign(a.to - this.liftT);
      this.liftT += dir * a.speed * dt;
      if ((dir > 0 && this.liftT >= a.to) || (dir < 0 && this.liftT <= a.to)) {
        this.liftT = a.to;
        this.liftAnim = null;
        this.sfx.hydraulicStop();
        if (a.to >= 1) {
          this.locked = true;
          this.lockFlash = 1;
          this.hitstop = 0.1;
          this.shake = 0.4; this.shakeAmp = 3;
          this.sfx.latch();
        } else {
          this.settleBounce = 10;
          this.sfx.clunk();
          const l = layoutGarage(this.W, this.H);
          this.parts.dust(l.carX - l.carW * 0.3, l.groundY, 4, -1);
          this.parts.dust(l.carX + l.carW * 0.3, l.groundY, 4, 1);
        }
      }
    }
    // unrepaired symptoms while the car sits in the garage
    if (!this.freePlay && this.faultsRemaining() > 0 && this.liftT < 0.5) {
      this.carRattleTimer -= dt;
      if (this.carRattleTimer < 0) {
        this.carRattleTimer = 0.5 + Math.random() * 0.5;
        this.sfx.rattleTick(0.5);
      }
    }
  }

  private updateSlide(dt: number): void {
    const a = this.slideAnim;
    if (!a) return;
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1);
    this.creeperProg = lerp(a.from, a.to, easeInOutCubic(k));
    this.wheelSpin += dt * 30 * this.slideSpeed;
    if (k >= 1) {
      this.slideAnim = null;
      this.sfx.slideStop();
      this.shake = 0.3; this.shakeAmp = 2.5;
      if (this.phase === 'slideIn') {
        this.creeperProg = 1;
        this.parts.list.length = 0;
        this.setPhase('under');
        this.slideCount++;
        this.sfx.robotTalk();
      } else {
        this.creeperProg = 0;
        this.parts.list.length = 0;
        this.setPhase('garage');
        if (!this.freePlay && this.faultsRemaining() === 0 && this.cracksRemaining() > 0 && this.slideCount <= 1) {
          this.sfx.happyBeep();
        }
      }
    }
  }

  private updateUnder(dt: number): void {
    const l = layoutUnder(this.W, this.H);
    for (const f of this.faults) {
      if (f.fixed) continue;
      f.timer -= dt;
      if (f.timer < 0) {
        switch (f.kind) {
          case 'bolt': {
            f.timer = 2.0 + Math.random();
            this.sfx.drip(0.7);
            const p = underToScreen(l, PART.boltPos.x, PART.boltPos.y);
            this.parts.drop(p.x, p.y + 8, '#6b5432', l.floorY);
            break;
          }
          case 'hose': {
            f.timer = 1.4 + Math.random() * 0.8;
            this.sfx.drip(1.15);
            const end = f.drag ?? PART.hoseLoose;
            const p = underToScreen(l, end.x, end.y);
            this.parts.drop(p.x, p.y + 6, '#57c8f0', l.floorY);
            break;
          }
          case 'clip': {
            f.timer = 1.7 + Math.random() * 0.6;
            this.sfx.clatter();
            break;
          }
          case 'exhaust': {
            f.timer = 0.45 + Math.random() * 0.3;
            if (!f.held) this.sfx.rattleTick(0.8);
            break;
          }
        }
      }
    }
    if (this.coolantFlow > 0) this.coolantFlow += dt;
  }

  private updateWeld(dt: number): void {
    this.arcFlicker = 0.75 + Math.random() * 0.5;
    const c = this.cracks[this.weldIdx];
    if (!c) { this.setPhase('weldDone'); return; }
    if (this.arcOn && Math.random() < dt * 40) {
      this.parts.sparks(this.arcX, this.arcY, 2, 0.8);
    }
    void dt;
  }

  private updateLower(dt: number): void {
    // timeline: unlock -> descend -> settle -> door opens -> drive out
    if (this.tPhase < 1.3) {
      this.liftT = Math.max(0, 1 - this.tPhase / 1.2);
      if (this.liftT === 0 && this.settleBounce === 0 && this.tPhase < 1.25) {
        this.settleBounce = 12;
        this.sfx.clunk();
        const l = layoutGarage(this.W, this.H);
        this.parts.dust(l.carX - l.carW * 0.3, l.groundY, 5, -1);
        this.parts.dust(l.carX + l.carW * 0.3, l.groundY, 5, 1);
      }
    } else if (this.tPhase < 1.9) {
      if (this.doorT === 0) this.sfx.whoosh(0.7, 0.6);
      this.doorT = clamp((this.tPhase - 1.3) / 0.55, 0, 1);
    } else if (this.tPhase < 3.4) {
      if (this.tPhase - dt < 1.9) this.sfx.engineStart(0);
      const k = (this.tPhase - 1.9) / 1.5;
      this.arriveT = 1 + easeInOutCubic(k) * 1.2; // reuse as drive-out progress
      this.wheelSpin += dt * 18 * k;
      this.sfx.engineSet(0, k * 0.8);
    } else {
      this.sfx.engineStop();
      this.test.t = 0;
      this.test.course = this.carIdx % 2;
      this.parts.list.length = 0;
      this.setPhase('test');
      this.sfx.engineStart(0);
    }
  }

  private updateTest(dt: number): void {
    this.test.t += dt;
    const k = clamp(this.test.t / this.test.dur, 0, 1);
    const speed = k < 0.12 ? k / 0.12 : k > 0.9 ? (1 - k) / 0.1 : 1;
    this.wheelSpin += dt * 22 * speed;
    this.sfx.engineSet(0, speed);
    if (Math.random() < dt * 6 && speed > 0.4) {
      this.parts.streak(this.W * 0.30 - 30, this.H * 0.72 - 14 - Math.random() * 30, -240, 'rgba(255,235,170,0.7)');
    }
    if (this.test.t >= this.test.dur + 0.5) {
      this.sfx.engineStop();
      this.sfx.jingle();
      this.startFade(() => {
        this.parts.list.length = 0;
        if (this.freePlay) {
          this.doorT = 0;
          this.setPhase('garage');
        } else {
          this.playCount++;
          this.setPhase('choice');
        }
      }, 0.9);
    }
  }

  // ---------------------------------------------------------------- input

  pointerDown(x: number, y: number): void {
    this.sfx.unlock();
    this.hintT = 0;
    const p = this.pointer;
    p.down = true; p.x = x; p.y = y; p.sx = x; p.sy = y;
    p.st = this.time; p.moved = false; p.dragKind = null; p.dragFault = -1;
    this.swallowUp = false;

    switch (this.phase) {
      case 'title': {
        this.sfx.tap();
        this.swallowUp = true;
        this.startFade(() => {
          this.resetCar(this.carIdx, false);
          this.setPhase('arrive');
        }, 0.6);
        break;
      }
      case 'garage': this.garageDown(x, y); break;
      case 'under': this.underDown(x, y); break;
      case 'weld': {
        this.arcOn = true;
        this.moveArc(x, y);
        this.sfx.weldStart();
        break;
      }
      case 'freeweld': {
        if (dist(x, y, 46, 46) < 56) {
          this.sfx.tap();
          this.swallowUp = true;
          this.freeWeldBack();
          return;
        }
        this.doodleBreak = true;
        this.arcOn = true;
        this.moveArc(x, y);
        this.sfx.weldStart();
        break;
      }
      case 'choice': {
        const cl = layoutChoice(this.W, this.H);
        for (const b of cl.btns) {
          if (dist(x, y, b.x, b.y) < b.r * 1.35) {
            this.sfx.tap();
            this.swallowUp = true;
            this.startFade(() => {
              if (b.id === 'again') this.resetCar(this.carIdx, false);
              else if (b.id === 'next') this.resetCar((this.carIdx + 1) % CARS.length, false);
              else this.resetCar(this.carIdx, true);
              this.setPhase('arrive');
            }, 0.6);
            return;
          }
        }
        break;
      }
      case 'test': {
        this.sfx.horn();
        this.parts.sparkleBurst(this.W * 0.30, this.H * 0.60, 8, '#ffe9a8');
        break;
      }
      default: break;
    }
  }

  private garageDown(x: number, y: number): void {
    const l = layoutGarage(this.W, this.H);
    // the mask (when present) wins over the generous lever grab zone
    const mask = this.maskScreenPos(l);
    if (mask && dist(x, y, mask.x, mask.y) < Math.max(80, l.carW * 0.26)) return;
    const grabR = Math.max(90, l.carW * 0.30);
    if (dist(x, y, l.leverX, l.leverY) < grabR && !this.liftAnim) {
      this.pointer.dragKind = 'lever';
      this.sfx.click(0.9);
    }
  }

  private underDown(x: number, y: number): void {
    const l = layoutUnder(this.W, this.H);
    for (let i = 0; i < this.faults.length; i++) {
      const f = this.faults[i];
      if (f.fixed) continue;
      const pos = this.faultGrabPos(f);
      const sp = underToScreen(l, pos.x, pos.y);
      if (dist(x, y, sp.x, sp.y) < l.grabR) {
        if (f.kind === 'bolt') {
          this.tapBolt(f, sp.x, sp.y);
        } else {
          this.pointer.dragKind = 'fault';
          this.pointer.dragFault = i;
          f.held = true;
          if (f.kind !== 'exhaust' && !f.drag) {
            const start = f.kind === 'clip' ? PART.clipLoose : PART.hoseLoose;
            f.drag = { x: start.x, y: start.y };
          }
          this.sfx.tap();
        }
        return;
      }
    }
    // playful sparkle when everything is already fixed
    if (this.faultsRemaining() === 0) {
      this.parts.sparkleBurst(x, y, 5, '#bfe6ff', 0.7);
      this.sfx.tap();
    }
  }

  faultGrabPos(f: FaultState): { x: number; y: number } {
    switch (f.kind) {
      case 'bolt': return PART.boltPos;
      case 'clip': return f.drag ?? PART.clipLoose;
      case 'hose': return f.drag ?? PART.hoseLoose;
      case 'exhaust': return { x: PART.exhaustGrab.x, y: PART.exhaustGrab.y - f.lift01 * 40 };
    }
  }

  private tapBolt(f: FaultState, sx: number, sy: number): void {
    f.taps++;
    f.wrenchT = 0.55;
    f.boltSpin = 2.2;
    this.sfx.ratchet(f.taps);
    this.parts.sparks(sx, sy, 3, 0.5);
    if (f.taps >= 3) {
      f.fixed = true;
      f.snapT = 1;
      this.sfx.boltDone();
      this.parts.sparkleBurst(sx, sy, 10, '#ffe9a8');
      this.afterFix();
    }
  }

  private afterFix(): void {
    if (this.faultsRemaining() === 0) {
      window.setTimeout(() => this.sfx.happyBeep(), 350);
    }
  }

  pointerMove(x: number, y: number): void {
    const p = this.pointer;
    if (!p.down) return;
    p.x = x; p.y = y;
    if (dist(x, y, p.sx, p.sy) > 12) p.moved = true;

    if (this.phase === 'garage' && p.dragKind === 'lever') {
      const dy = y - p.sy;
      this.leverPull = clamp(-dy / 80, -1, 1);
      if (dy < -46 && this.liftT === 0 && !this.liftAnim) this.raiseLift();
      else if (dy > 46 && this.liftT === 1 && !this.liftAnim) this.tryLower();
    } else if (this.phase === 'under' && p.dragKind === 'fault') {
      const f = this.faults[p.dragFault];
      if (f && !f.fixed) this.dragFaultTo(f, x, y);
    } else if ((this.phase === 'weld' || this.phase === 'freeweld') && this.arcOn) {
      this.moveArc(x, y);
    }
  }

  private dragFaultTo(f: FaultState, x: number, y: number): void {
    const l = layoutUnder(this.W, this.H);
    const u = screenToUnder(l, x, y);
    if (f.kind === 'exhaust') {
      // project the drag onto the "toward home" direction so the gesture
      // works the same in portrait (rotated) and landscape views
      const base = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y);
      const top = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y - 55);
      const dx = top.x - base.x;
      const dy = top.y - base.y;
      const len2 = dx * dx + dy * dy;
      f.lift01 = clamp(((x - base.x) * dx + (y - base.y) * dy) / len2, 0, 1);
      return;
    }
    if (f.drag) {
      f.drag.x = clamp(u.x, 40, 960);
      f.drag.y = clamp(u.y, 40, 460);
      // magnet: snap onto the target when close
      const target = f.kind === 'clip' ? PART.clipSlot : PART.hoseFit;
      const d = dist(f.drag.x, f.drag.y, target.x, target.y);
      if (d < 55) {
        f.drag.x = lerp(f.drag.x, target.x, 0.55);
        f.drag.y = lerp(f.drag.y, target.y, 0.55);
      }
      if (d < 34) this.fixDragFault(f);
    }
  }

  private fixDragFault(f: FaultState): void {
    if (f.fixed) return;
    f.fixed = true;
    f.held = false;
    f.snapT = 1;
    f.drag = null;
    // keep pointer.dragKind as-is: the rest of this gesture must not be
    // re-interpreted as an exit swipe on pointer-up
    this.sfx.snapIn();
    const l = layoutUnder(this.W, this.H);
    const target = f.kind === 'clip' ? PART.clipSlot : PART.hoseFit;
    const sp = underToScreen(l, target.x, target.y);
    this.parts.sparkleBurst(sp.x, sp.y, 10, '#c5f6d0');
    if (f.kind === 'hose') this.coolantFlow = 0.001;
    this.afterFix();
  }

  pointerUp(x: number, y: number): void {
    const p = this.pointer;
    if (!p.down) return;
    p.down = false;
    if (this.swallowUp) {
      // the down-press already consumed this tap (and switched phase)
      this.swallowUp = false;
      p.dragKind = null;
      p.dragFault = -1;
      return;
    }
    const dx = x - p.sx;
    const dy = y - p.sy;
    const dt = Math.max(0.06, this.time - p.st);
    const vx = dx / dt;

    switch (this.phase) {
      case 'garage': this.garageUp(x, y, dx, dy, vx, p.moved); break;
      case 'under': this.underUp(dx, dy); break;
      case 'weld': case 'freeweld': {
        this.arcOn = false;
        this.sfx.weldStop();
        break;
      }
      default: break;
    }
    p.dragKind = null;
    p.dragFault = -1;
  }

  private garageUp(x: number, y: number, dx: number, dy: number, vx: number, moved: boolean): void {
    const l = layoutGarage(this.W, this.H);
    if (this.pointer.dragKind === 'lever') {
      // release without crossing the threshold: also accept a decent fling
      if (dy < -30 && this.liftT === 0 && !this.liftAnim) this.raiseLift();
      else if (dy > 30 && this.liftT === 1 && !this.liftAnim) this.tryLower();
      return;
    }
    if (this.liftAnim) return;

    const upReady = this.liftT >= 1 && this.locked;

    // swipe toward the car => creeper slide-in (the signature move)
    if (upReady && dx < -50 && Math.abs(dx) > Math.abs(dy) * 0.75) {
      this.startSlide(true, Math.abs(vx));
      return;
    }
    // vertical swipe near the lever column (very generous)
    if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) && Math.abs(x - l.leverX) < l.W * 0.3) {
      if (dy < 0 && this.liftT === 0) { this.raiseLift(); return; }
      if (dy > 0 && this.liftT === 1) { this.tryLower(); return; }
    }

    if (!moved) {
      // taps on things — the mask has priority over everything nearby
      const mask = this.maskScreenPos(l);
      if (mask && dist(x, y, mask.x, mask.y) < Math.max(80, l.carW * 0.26)) {
        this.setPhase('shield');
        this.sfx.clunk();
        this.sfx.robotTalk();
        return;
      }
      const mech = this.mechScreenPos(l);
      if (upReady && dist(x, y, mech.x, mech.y) < Math.max(90, l.carW * 0.3)) {
        this.startSlide(true, 500);
        return;
      }
      if (this.freePlay) {
        if (dist(x, y, l.homeX, l.homeY) < l.homeR * 2) {
          this.startFade(() => {
            this.resetCar(this.carIdx, false);
            this.freePlay = false;
            this.setPhase('title');
          }, 0.6);
          return;
        }
        if (this.liftT === 0 && dist(x, y, l.plateX, l.plateY) < l.plateR * 1.6) {
          this.sfx.clunk();
          this.maskT = 1;
          this.setPhase('freeweld');
          return;
        }
      }
      // tap on the car: friendly honk + bounce
      const carCY = l.groundY - this.liftT * l.liftMax - l.carW * 0.2;
      if (dist(x, y, l.carX, carCY) < l.carW * 0.5) {
        this.sfx.horn();
        this.settleBounce = 8;
        this.blink = 1;
        this.parts.sparkleBurst(x, y, 6, '#ffe9a8', 0.8);
        return;
      }
      // tap near the crack while it still needs welding: point to the mask
      if (this.faultsRemaining() === 0 && this.cracksRemaining() > 0) {
        this.sfx.robotTalk();
        this.hintT = 10; // trigger the hint immediately
      }
    }
  }

  private underUp(dx: number, dy: number): void {
    const p = this.pointer;
    if (p.dragKind === 'fault') {
      const f = this.faults[p.dragFault];
      if (f && !f.fixed) {
        f.held = false;
        if (f.kind === 'exhaust') {
          if (f.lift01 > 0.55) {
            f.fixed = true;
            f.snapT = 1;
            f.lift01 = 1;
            this.sfx.clunk();
            window.setTimeout(() => this.sfx.snapIn(), 150);
            const l = layoutUnder(this.W, this.H);
            const sp = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y - 40);
            this.parts.sparkleBurst(sp.x, sp.y, 10, '#c5f6d0');
            this.afterFix();
          } else if (f.lift01 > 0.1) {
            f.lift01 = 0;
            this.sfx.clatter();
          }
        }
        // clip/hose simply stay where they were dropped — no penalty
      }
      return;
    }
    // swipe out from under the car (either direction works)
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 0.75) {
      this.startSlide(false, Math.abs(dx) * 4);
    }
  }

  private mechScreenPos(l: ReturnType<typeof layoutGarage>): { x: number; y: number } {
    return { x: l.mechHomeX, y: l.mechY };
  }

  maskScreenPos(l: ReturnType<typeof layoutGarage>): { x: number; y: number } | null {
    if (this.freePlay) return null;
    if (this.faultsRemaining() > 0 || this.cracksRemaining() === 0) return null;
    if (this.liftT < 1) return null;
    return { x: clamp(l.mechHomeX - l.carW * 0.30, 60, l.W - 60), y: l.mechY - l.carW * 0.42 };
  }

  raiseLift(): void {
    this.pointer.dragKind = null;
    this.liftAnim = { to: 1, speed: 1 / 1.35 };
    this.sfx.hydraulic(true, 1.35);
  }

  tryLower(): void {
    this.pointer.dragKind = null;
    if (!this.freePlay && !this.allRepaired()) {
      // gentle "not yet" — wiggle and show what still needs doing
      this.sfx.robotTalk();
      this.shake = 0.25; this.shakeAmp = 2;
      this.hintT = 10;
      return;
    }
    this.locked = false;
    this.sfx.latch();
    this.sfx.hydraulic(false, 1.2);
    this.setPhase('lower');
  }

  startSlide(goIn: boolean, velocity: number): void {
    if (this.slideAnim) return;
    const speed = clamp(velocity / 600, 0.8, 1.7);
    this.slideSpeed = speed;
    this.slideAnim = { from: this.creeperProg, to: goIn ? 1 : 0, t: 0, dur: 0.95 / speed };
    this.setPhase(goIn ? 'slideIn' : 'slideOut');
    this.sfx.whoosh(speed, 0.55 / speed);
    const l = layoutGarage(this.W, this.H);
    this.parts.dust(l.mechHomeX, l.mechY + 10, 5, goIn ? -1 : 1);
  }

  // ---------------------------------------------------------------- weld

  crackScreenPts(): Array<{ x: number; y: number }> {
    const c = this.cracks[this.weldIdx];
    if (!c) return [];
    const local = densify(crackLocalPts(c.kind), CRACK_N);
    const cu = local.reduce((s, p) => s + p[0], 0) / local.length;
    const cv = local.reduce((s, p) => s + p[1], 0) / local.length;
    // crackLocalPts are [u, v] with v as height; drawCarSide uses y = -v*w
    const center = { u: cu, v: cv };
    const wl = layoutWeld(this.W, this.H, { u: center.u, v: -(-center.v) });
    return local.map(([u, v]) => ({
      x: wl.carX + u * wl.bigW,
      y: wl.carGroundY - v * wl.bigW,
    }));
  }

  private moveArc(x: number, y: number): void {
    let ax = x;
    let ay = y - Math.max(30, Math.min(this.W, this.H) * 0.055); // arc sits above the finger
    if (this.phase === 'weld') {
      const pts = this.crackScreenPts();
      let best = -1; let bestD = 1e9;
      for (let i = 0; i < pts.length; i++) {
        const d = dist(ax, ay, pts[i].x, pts[i].y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD < 110) {
        ax = lerp(ax, pts[best].x, 0.6);
        ay = lerp(ay, pts[best].y, 0.6);
      }
      this.arcX = ax; this.arcY = ay;
      this.weldAt(ax, ay, pts);
    } else {
      this.arcX = ax; this.arcY = ay;
      this.doodleAt(ax, ay);
    }
  }

  private weldAt(ax: number, ay: number, pts: Array<{ x: number; y: number }>): void {
    const c = this.cracks[this.weldIdx];
    if (!c || c.done) return;
    const R = Math.max(36, Math.min(this.W, this.H) * 0.06);
    let newly = 0;
    for (let i = 0; i < pts.length; i++) {
      if (!c.welded[i] && dist(ax, ay, pts[i].x, pts[i].y) < R) {
        c.welded[i] = true;
        newly++;
      }
    }
    if (newly > 0) this.parts.sparks(ax, ay, 2 + newly, 1);
    const doneCount = c.welded.filter(Boolean).length;
    if (doneCount >= Math.ceil(CRACK_N * 0.93)) {
      c.welded.fill(true);
      c.done = true;
      c.shine = 1.4;
      this.arcOn = false;
      this.sfx.weldStop();
      this.sfx.shineSweep();
      window.setTimeout(() => this.sfx.chime(), 250);
      this.parts.sparkleBurst(ax, ay, 16, '#fff6c8', 1.3);
      if (this.weldIdx < this.cracks.length - 1) {
        this.weldIdx++;
        this.tPhase = 0;
      } else {
        this.setPhase('weldDone');
      }
    }
  }

  private doodleBreak = true;

  private doodleAt(x: number, y: number): void {
    const last = this.doodle[this.doodle.length - 1];
    if (last && !this.doodleBreak) {
      const lx = last.x * this.W;
      const ly = last.y * this.H;
      const d = dist(x, y, lx, ly);
      if (d < 8) return;
      // fill the gap so fast strokes still leave a continuous bead
      const steps = Math.min(24, Math.floor(d / 8));
      for (let i = 1; i <= steps; i++) {
        this.doodle.push({ x: lerp(lx, x, i / steps) / this.W, y: lerp(ly, y, i / steps) / this.H });
      }
    } else {
      this.doodle.push({ x: x / this.W, y: y / this.H });
    }
    this.doodleBreak = false;
    if (this.doodle.length > 2400) this.doodle.splice(0, 200);
    this.parts.sparks(x, y, 2, 0.8);
  }

  freeWeldBack(): void {
    this.arcOn = false;
    this.sfx.weldStop();
    this.maskT = 0;
    this.setPhase('garage');
  }

  // ---------------------------------------------------------------- debug hooks for E2E

  debug(): Record<string, unknown> {
    const targets: Record<string, { x: number; y: number }> = {};
    const l = layoutGarage(this.W, this.H);
    if (this.phase === 'title') {
      targets.start = { x: this.W / 2, y: this.H * 0.78 };
    }
    if (this.phase === 'garage') {
      targets.lever = { x: l.leverX, y: l.leverY };
      targets.mech = this.mechScreenPos(l);
      const mask = this.maskScreenPos(l);
      if (mask) targets.mask = mask;
      if (this.freePlay) {
        targets.home = { x: l.homeX, y: l.homeY };
        targets.plate = { x: l.plateX, y: l.plateY };
      }
      targets.car = { x: l.carX, y: l.groundY - this.liftT * l.liftMax - l.carW * 0.2 };
    }
    if (this.phase === 'under') {
      const ul = layoutUnder(this.W, this.H);
      this.faults.forEach((f, i) => {
        const g = this.faultGrabPos(f);
        targets[`fault${i}_from`] = underToScreen(ul, g.x, g.y);
        const to = f.kind === 'clip' ? PART.clipSlot : f.kind === 'hose' ? PART.hoseFit
          : f.kind === 'exhaust' ? { x: PART.exhaustGrab.x, y: PART.exhaustGrab.y - 80 } : g;
        targets[`fault${i}_to`] = underToScreen(ul, to.x, to.y);
      });
      targets.exit = { x: this.W * 0.5, y: this.H * 0.6 };
    }
    if (this.phase === 'choice') {
      for (const b of layoutChoice(this.W, this.H).btns) targets[b.id] = { x: b.x, y: b.y };
    }
    if (this.phase === 'freeweld') {
      targets.back = { x: 46, y: 46 };
    }
    return {
      phase: this.phase,
      carIdx: this.carIdx,
      freePlay: this.freePlay,
      liftT: this.liftT,
      locked: this.locked,
      creeperProg: this.creeperProg,
      faults: this.faults.map((f) => ({ kind: f.kind, fixed: f.fixed, taps: f.taps })),
      faultsRemaining: this.faultsRemaining(),
      cracksRemaining: this.cracksRemaining(),
      crackPts: this.phase === 'weld' ? this.crackScreenPts() : [],
      targets,
    };
  }
}
