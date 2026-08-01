// Input.js — unifies keyboard, gamepad and touch into one polled state.
//
// `value` = { steer: -1..1, tuck: 0..1, brake: 0..1 } is a single stable
// object that is mutated in place every frame (an internal rAF loop keeps it
// current even between the caller's own updates, which matters for the
// gamepad axis/trigger polling that has no native "change" event).
//
// `justPressed(code)` uses KeyboardEvent.code strings (e.g. 'ArrowLeft',
// 'KeyA', 'KeyD', 'ShiftLeft', 'Space', 'KeyC', 'KeyR', 'KeyM') and follows a
// consume-on-read model: the first call after a key-down edge returns true
// and clears the flag, so it naturally reads as "true for one frame" as long
// as the caller polls once per game frame (which main.js does).
//
// Touch: keyboard/pointer listeners are bound to `window` rather than only
// `target` — this is deliberate. The HUD/Screens overlay (owned by another
// module, mounted in #ui-root on top of the canvas) may or may not mark
// itself `pointer-events: none`, and binding only to `target` would silently
// break steering if it doesn't. Listening on `window` means we still see the
// touch events as they bubble, regardless of which element was actually hit.
// `target` is still used for a couple of scoped niceties (context menu
// suppression) and kept for future use / API parity with the SPEC.

const GAMEPAD_DEADZONE = 0.15;

const SCHEME_CODES = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyC', 'KeyR', 'KeyM',
  'ShiftLeft', 'ShiftRight', 'Space',
]);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function isTouchCapable() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

export class Input {
  constructor(target = (typeof window !== 'undefined' ? window : null)) {
    this.target = target;

    /** @type {{steer:number, tuck:number, brake:number}} live, mutated in place */
    this.value = { steer: 0, tuck: 0, brake: 0 };

    this._keysDown = new Set();
    this._justPressed = new Set();

    // gamepad-derived contributions
    this._gpSteer = 0;
    this._gpTuck = 0;
    this._gpBrake = 0;

    // touch-derived contributions
    this._touchSteer = 0;
    this._touchTuck = 0;
    this._steerTouchId = null;
    this._tuckTouchId = null;
    this._tuckButton = null;

    this._disposed = false;

    // --- bind handlers -----------------------------------------------
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._tick = this._tick.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    window.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this._onTouchEnd, { passive: false });

    if (this.target && typeof this.target.addEventListener === 'function') {
      this.target.addEventListener('contextmenu', this._onContextMenu);
    }

    if (isTouchCapable()) {
      this._createTuckButton();
    }

    this._rafId = requestAnimationFrame(this._tick);
  }

  // ---------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------

  justPressed(code) {
    if (this._justPressed.has(code)) {
      this._justPressed.delete(code);
      return true;
    }
    return false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._rafId !== null) cancelAnimationFrame(this._rafId);

    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);

    window.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('touchcancel', this._onTouchEnd);

    if (this.target && typeof this.target.removeEventListener === 'function') {
      this.target.removeEventListener('contextmenu', this._onContextMenu);
    }

    if (this._tuckButton && this._tuckButton.parentNode) {
      this._tuckButton.parentNode.removeChild(this._tuckButton);
    }
    this._tuckButton = null;

    this._keysDown.clear();
    this._justPressed.clear();
  }

  // ---------------------------------------------------------------------
  // internal per-frame tick (gamepad polling has no event API, so this
  // module keeps its own rAF loop rather than depending on Loop.js)
  // ---------------------------------------------------------------------

  _tick() {
    this._pollGamepad();
    this._recompute();
    this._rafId = requestAnimationFrame(this._tick);
  }

  _recompute() {
    let kbSteer = 0;
    if (this._keysDown.has('ArrowLeft') || this._keysDown.has('KeyA')) kbSteer -= 1;
    if (this._keysDown.has('ArrowRight') || this._keysDown.has('KeyD')) kbSteer += 1;

    const kbTuck = (this._keysDown.has('ShiftLeft') || this._keysDown.has('ShiftRight')) ? 1 : 0;
    const kbBrake = this._keysDown.has('Space') ? 1 : 0;

    this.value.steer = clamp(kbSteer + this._touchSteer + this._gpSteer, -1, 1);
    this.value.tuck = clamp(Math.max(kbTuck, this._touchTuck, this._gpTuck), 0, 1);
    this.value.brake = clamp(Math.max(kbBrake, this._gpBrake), 0, 1);
  }

  // ---------------------------------------------------------------------
  // keyboard
  // ---------------------------------------------------------------------

  _onKeyDown(e) {
    // Let Ctrl/Cmd/Alt combos (reload, devtools, browser shortcuts, ...)
    // through untouched — only plain key presses are game input. Shift is
    // deliberately excluded from this check since ShiftLeft/Right *is* one
    // of our own control keys (tuck).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const code = e.code;
    if (SCHEME_CODES.has(code)) e.preventDefault();
    if (!this._keysDown.has(code)) {
      this._keysDown.add(code);
      this._justPressed.add(code);
    }
  }

  _onKeyUp(e) {
    this._keysDown.delete(e.code);
  }

  _onBlur() {
    // A key held during alt-tab / window blur never gets its keyup — drop
    // all held keys so movement doesn't get stuck.
    this._keysDown.clear();
  }

  _onContextMenu(e) {
    e.preventDefault();
  }

  // ---------------------------------------------------------------------
  // gamepad (polled — axes/trigger analog values have no change events)
  // ---------------------------------------------------------------------

  _pollGamepad() {
    const getPads = navigator.getGamepads && navigator.getGamepads.bind(navigator);
    const pads = getPads ? getPads() : null;
    let pad = null;
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) { pad = pads[i]; break; }
      }
    }

    if (!pad) {
      this._gpSteer = 0;
      this._gpTuck = 0;
      this._gpBrake = 0;
      return;
    }

    const axis = (pad.axes && pad.axes.length > 0) ? pad.axes[0] : 0;
    this._gpSteer = Math.abs(axis) > GAMEPAD_DEADZONE ? clamp(axis, -1, 1) : 0;

    // Standard mapping: buttons[7] = RT/R2 (accelerate/tuck), buttons[6] = LT/L2 (brake).
    this._gpTuck = this._buttonValue(pad, 7);
    this._gpBrake = this._buttonValue(pad, 6);
  }

  _buttonValue(pad, index) {
    const btn = pad.buttons && pad.buttons[index];
    if (!btn) return 0;
    if (typeof btn.value === 'number' && btn.value > 0) return clamp(btn.value, 0, 1);
    return btn.pressed ? 1 : 0;
  }

  // ---------------------------------------------------------------------
  // touch: left/right half drag-or-tap steers, bottom-right button tucks
  // ---------------------------------------------------------------------

  _steerFromClientX(x) {
    const w = window.innerWidth || 1;
    return clamp((x / w) * 2 - 1, -1, 1);
  }

  _onTouchStart(e) {
    for (const touch of e.changedTouches) {
      const onTuckButton = this._tuckButton && (
        touch.target === this._tuckButton || this._tuckButton.contains(touch.target)
      );

      if (onTuckButton) {
        if (this._tuckTouchId === null) {
          this._tuckTouchId = touch.identifier;
          this._touchTuck = 1;
          this._setTuckPressed(true);
        }
      } else if (this._steerTouchId === null) {
        this._steerTouchId = touch.identifier;
        this._touchSteer = this._steerFromClientX(touch.clientX);
      }
    }
    e.preventDefault();
  }

  _onTouchMove(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._steerTouchId) {
        this._touchSteer = this._steerFromClientX(touch.clientX);
      }
    }
    e.preventDefault();
  }

  _onTouchEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._steerTouchId) {
        this._steerTouchId = null;
        this._touchSteer = 0;
      }
      if (touch.identifier === this._tuckTouchId) {
        this._tuckTouchId = null;
        this._touchTuck = 0;
        this._setTuckPressed(false);
      }
    }
  }

  _createTuckButton() {
    const btn = document.createElement('div');
    btn.setAttribute('aria-hidden', 'true');
    btn.style.cssText = [
      'position:fixed',
      'right:max(18px, env(safe-area-inset-right, 0px))',
      'bottom:max(18px, env(safe-area-inset-bottom, 0px))',
      'width:min(24vw, 96px)',
      'height:min(24vw, 96px)',
      'border-radius:50%',
      'background:rgba(120,210,255,0.14)',
      'border:2px solid rgba(190,235,255,0.55)',
      'color:#eaf6ff',
      'font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif',
      'font-size:13px',
      'font-weight:600',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'text-align:center',
      'line-height:1.3',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
      'z-index:9999',
      'transition:background 0.1s ease, transform 0.1s ease',
    ].join(';');
    btn.innerHTML = 'しゃがむ<br><span style="opacity:.65;font-size:.78em">TUCK</span>';
    document.body.appendChild(btn);
    this._tuckButton = btn;
  }

  _setTuckPressed(pressed) {
    if (!this._tuckButton) return;
    this._tuckButton.style.background = pressed ? 'rgba(120,210,255,0.34)' : 'rgba(120,210,255,0.14)';
    this._tuckButton.style.transform = pressed ? 'scale(0.94)' : 'scale(1)';
  }
}
