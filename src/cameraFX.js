// Camera & post-impact camera choreography. See docs/CONTRACTS.md
// (section "src/cameraFX.js + src/audio.js — I"). No orbit controls, no
// child input — the camera is entirely automatic.
import * as THREE from 'three';

// ---- small math helpers (no allocation) --------------------------------
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
function easeOutCubic(t) {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}
function easeInOutCubic(t) {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

// Impact timeline constants (seconds / timeScale units).
const HITSTOP_DUR = 0.07;
const HITSTOP_SCALE = 0.02;
const SLOWMO_SCALE = 0.22;
const SLOWMO_BASE_DUR = 1.1;
const SLOWMO_ENERGY_BONUS = 0.3;
const RECOVER_DUR = 0.5;
const DIP_WINDOW = 0.6;
const DIP_RAMP = 0.15;

export class CameraFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);

    // main reads this every frame to scale dt for every other module.
    this.timeScale = 1;
    // exposed for main to optionally read; the underwater tint is fully
    // owned & rendered by this class regardless.
    this.underwaterAmount = 0;

    // ---- pre-allocated vectors reused every frame (no per-frame alloc) --
    this._basePos = new THREE.Vector3();
    this._baseLookAt = new THREE.Vector3();
    this._focusPoint = new THREE.Vector3();
    this._focusSmoothed = new THREE.Vector3();
    this._swayVec = new THREE.Vector3();
    this._composedPos = new THREE.Vector3();
    this._composedLookAt = new THREE.Vector3();
    this._dollyPos = new THREE.Vector3();
    this._dipCamPos = new THREE.Vector3();
    this._dipLookAt = new THREE.Vector3();
    this._finalPos = new THREE.Vector3();
    this._finalLookAt = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();
    this._impactPoint = new THREE.Vector3();

    this._focusInitialized = false;
    this._portraitAmount = 0;

    // impact timeline state
    this._phase = 'idle'; // 'idle' | 'hitstop' | 'slowmo' | 'recover'
    this._phaseTimer = 0;
    this._slowmoDur = SLOWMO_BASE_DUR;
    this._underwaterEligible = false;
    this._dollyAmount = 0;
    this._dipAmount = 0;

    // shake state
    this._shakeTimer = 999;
    this._shakeDuration = 0.22;
    this._shakeMag = 0;
    this._shakeDirX = 1;
    this._shakeDirY = 1;

    // Underwater tint: a fullscreen DOM overlay this module owns entirely.
    this._tintEl = null;
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.background =
        'linear-gradient(rgba(30,90,190,0.9), rgba(10,50,140,0.95))';
      el.style.opacity = '0';
      el.style.zIndex = '40';
      el.style.mixBlendMode = 'normal';
      document.body.appendChild(el);
      this._tintEl = el;
    }

    // Initialize framing from current renderer size.
    let w = 1280;
    let h = 720;
    if (renderer && renderer.domElement) {
      w = renderer.domElement.clientWidth || renderer.domElement.width || w;
      h = renderer.domElement.clientHeight || renderer.domElement.height || h;
    }
    this.handleResize(w, h);
  }

  // -------------------------------------------------------------------
  handleResize(w, h) {
    const aspect = h > 0 ? w / h : 16 / 9;
    this.camera.aspect = aspect;

    // Continuous portrait<->landscape blend (no hard branch = no pop).
    const landscapeEdge = 1.5;
    const portraitEdge = 0.6;
    const t = clamp01((landscapeEdge - aspect) / (landscapeEdge - portraitEdge));
    const a = smoothstep(t);
    this._portraitAmount = a;

    // Landscape: closer, cinematic, slight 3/4 angle from +X.
    const lp = { x: 9.0, y: 3.8, z: 3.0, fov: 44, lx: -1.0, ly: 1.6, lz: 0 };
    // Portrait: pulled back & higher/steeper so tower + pool both fit and
    // the water surface fills the lower ~2/3 of the frame.
    const pp = { x: 10.5, y: 7.6, z: 1.8, fov: 60, lx: -1.3, ly: 0.4, lz: 0 };

    this._basePos.set(lerp(lp.x, pp.x, a), lerp(lp.y, pp.y, a), lerp(lp.z, pp.z, a));
    this._baseLookAt.set(lerp(lp.lx, pp.lx, a), lerp(lp.ly, pp.ly, a), lerp(lp.lz, pp.lz, a));
    this.camera.fov = lerp(lp.fov, pp.fov, a);
    this.camera.updateProjectionMatrix();

    if (!this._focusInitialized) {
      this._focusPoint.copy(this._baseLookAt);
      this._focusSmoothed.copy(this._baseLookAt);
      this._focusInitialized = true;
    }
  }

  // -------------------------------------------------------------------
  // Smooth spring-follow aim point (held/flying toy). Called every frame
  // by main; never fast, never nauseating.
  setFocus(point) {
    if (!point) return;
    this._focusPoint.set(point.x, point.y, point.z);
  }

  // -------------------------------------------------------------------
  onImpact(spec) {
    try {
      if (!spec || !spec.point) return;
      this._impactPoint.set(spec.point.x, spec.point.y, spec.point.z);
      const energy = clamp01(spec.energy || 0);
      this._underwaterEligible = energy > 0.45;
      this._slowmoDur = SLOWMO_BASE_DUR + (energy > 0.7 ? SLOWMO_ENERGY_BONUS : 0);
      this._phase = 'hitstop';
      this._phaseTimer = 0;

      if (energy > 0.6) {
        this._shakeTimer = 0;
        this._shakeMag = lerp(0.018, 0.032, clamp01((energy - 0.6) / 0.4));
        this._shakeDirX = Math.random() < 0.5 ? -1 : 1;
        this._shakeDirY = Math.random() < 0.5 ? -1 : 1;
      }
    } catch (e) {
      // camera choreography must never crash the game
    }
  }

  // -------------------------------------------------------------------
  _advanceTimeline(dtReal) {
    if (this._phase === 'idle') {
      this.timeScale = 1;
      this._dollyAmount = 0;
      this._dipAmount = 0;
      this.underwaterAmount = 0;
      return;
    }

    this._phaseTimer += dtReal;

    if (this._phase === 'hitstop') {
      this.timeScale = HITSTOP_SCALE;
      this._dollyAmount = smoothstep(this._phaseTimer / HITSTOP_DUR);
      this._dipAmount = 0;
      if (this._phaseTimer >= HITSTOP_DUR) {
        this._phase = 'slowmo';
        this._phaseTimer = 0;
      }
    } else if (this._phase === 'slowmo') {
      this.timeScale = SLOWMO_SCALE;
      this._dollyAmount = 1;
      this._dipAmount = this._underwaterEligible
        ? this._computeDipEnvelope(this._phaseTimer, this._slowmoDur)
        : 0;
      if (this._phaseTimer >= this._slowmoDur) {
        this._phase = 'recover';
        this._phaseTimer = 0;
      }
    } else if (this._phase === 'recover') {
      const t = clamp01(this._phaseTimer / RECOVER_DUR);
      this.timeScale = lerp(SLOWMO_SCALE, 1, easeOutCubic(t));
      this._dollyAmount = 1 - easeInOutCubic(t);
      this._dipAmount = 0;
      if (this._phaseTimer >= RECOVER_DUR) {
        this._phase = 'idle';
        this._phaseTimer = 0;
        this.timeScale = 1;
        this._dollyAmount = 0;
      }
    }

    this.underwaterAmount = this._dipAmount;
  }

  // Dip envelope: ramps in, holds, ramps out across the middle ~0.6s of
  // the slow-mo window — a quick, smooth "dive" through the surface.
  _computeDipEnvelope(t, slowmoDur) {
    const dipWindow = Math.min(DIP_WINDOW, slowmoDur * 0.5);
    const dipStart = Math.max(0, (slowmoDur - dipWindow) / 2);
    const dipEnd = dipStart + dipWindow;
    if (t < dipStart) return 0;
    if (t < dipStart + DIP_RAMP) return smoothstep((t - dipStart) / DIP_RAMP);
    if (t < dipEnd - DIP_RAMP) return 1;
    if (t < dipEnd) return 1 - smoothstep((t - (dipEnd - DIP_RAMP)) / DIP_RAMP);
    return 0;
  }

  _updateShake(dtReal) {
    if (this._shakeTimer >= this._shakeDuration) {
      this._shakeOffset.set(0, 0, 0);
      return;
    }
    this._shakeTimer += dtReal;
    const t = this._shakeTimer / this._shakeDuration;
    const decay = 1 - t;
    const wobble = Math.sin(this._shakeTimer * 42) * this._shakeMag * decay;
    this._shakeOffset.set(wobble * this._shakeDirX, wobble * this._shakeDirY * 0.6, 0);
  }

  // -------------------------------------------------------------------
  update(dtReal, time) {
    this._advanceTimeline(dtReal);

    // Spring-follow the focus point (gentle, framerate independent).
    const focusAlpha = 1 - Math.exp(-2.2 * dtReal);
    this._focusSmoothed.lerp(this._focusPoint, focusAlpha);

    // Subtle position sway toward the action.
    this._swayVec.set(
      (this._focusSmoothed.x - this._baseLookAt.x) * 0.12,
      (this._focusSmoothed.y - this._baseLookAt.y) * 0.05,
      (this._focusSmoothed.z - this._baseLookAt.z) * 0.12
    );

    // Dolly target: ~25% of the way toward the impact point.
    this._dollyPos.set(
      lerp(this._basePos.x, this._impactPoint.x, 0.25),
      lerp(this._basePos.y, Math.max(this._impactPoint.y, 0.6), 0.12),
      lerp(this._basePos.z, this._impactPoint.z, 0.25)
    );

    this._composedPos.set(
      this._basePos.x + this._swayVec.x,
      this._basePos.y + this._swayVec.y,
      this._basePos.z + this._swayVec.z
    );
    this._composedPos.lerp(this._dollyPos, this._dollyAmount);

    // Underwater dip: quick, smooth dive to look into the cavity.
    const amt = this._dipAmount;
    this._dipCamPos.set(this._impactPoint.x + 0.9, -0.5, this._impactPoint.z + 0.9);
    this._dipLookAt.set(this._impactPoint.x, -0.9, this._impactPoint.z);

    this._finalPos.copy(this._composedPos).lerp(this._dipCamPos, amt);

    this._updateShake(dtReal);
    this._finalPos.x += this._shakeOffset.x;
    this._finalPos.y += this._shakeOffset.y;

    this.camera.position.copy(this._finalPos);

    this._composedLookAt.copy(this._baseLookAt).lerp(this._focusSmoothed, 0.5);
    this._finalLookAt.copy(this._composedLookAt).lerp(this._dipLookAt, amt);
    this.camera.lookAt(this._finalLookAt);

    if (this._tintEl) {
      this._tintEl.style.opacity = String(amt * 0.38);
    }
  }
}
