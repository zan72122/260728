// DOM まわり（ゲージ・ほし・メッセージ・ゆびアイコン）
export class UI {
  constructor() {
    this.moodFill = document.getElementById('mood-fill');
    this.moodFace = document.getElementById('mood-face');
    this.starCount = document.getElementById('star-count');
    this.caption = document.getElementById('caption');
    this.wipeProgress = document.getElementById('wipe-progress');
    this.wipeDots = [...document.querySelectorAll('.wipe-dot')];
    this.diaperButton = document.getElementById('diaper-button');
    this.muteButton = document.getElementById('mute-button');
    this.captionTimer = null;

    // ゆさぶって誘導する 3D 追従のゆびアイコン
    this.pointer = document.createElement('div');
    this.pointer.textContent = '👆';
    Object.assign(this.pointer.style, {
      position: 'absolute',
      zIndex: 15,
      fontSize: 'clamp(40px, 10vw, 64px)',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-30%, 8px)',
      filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.25))',
      animation: 'pulse 0.8s ease-in-out infinite',
    });
    document.getElementById('app').appendChild(this.pointer);
  }

  showHUD() {
    document.getElementById('hud-top').classList.remove('hidden');
    document.getElementById('hud-bottom').classList.remove('hidden');
  }

  setMood(v) {
    this.moodFill.style.width = `${Math.round(v * 100)}%`;
    this.moodFace.textContent = v > 0.65 ? '😊' : v > 0.35 ? '😐' : '😢';
    this.moodFill.style.background = v > 0.35
      ? 'linear-gradient(90deg, #ff9ec6, #ff5f9e)'
      : 'linear-gradient(90deg, #ffb45f, #f28a2a)';
  }

  setStars(n) { this.starCount.textContent = n; }

  say(text, duration = 0) {
    clearTimeout(this.captionTimer);
    this.caption.textContent = text;
    this.caption.classList.remove('hidden');
    // アニメーションをリスタートさせる
    this.caption.style.animation = 'none';
    void this.caption.offsetWidth;
    this.caption.style.animation = '';
    if (duration > 0) {
      this.captionTimer = setTimeout(() => this.hideCaption(), duration * 1000);
    }
  }

  hideCaption() { this.caption.classList.add('hidden'); }

  setWipeProgress(n) {
    if (n < 0) {
      this.wipeProgress.classList.add('hidden');
      return;
    }
    this.wipeProgress.classList.remove('hidden');
    this.wipeDots.forEach((d, i) => d.classList.toggle('done', i < n));
  }

  setDiaperButton({ visible = true, attention = false, enabled = true } = {}) {
    this.diaperButton.style.visibility = visible ? 'visible' : 'hidden';
    this.diaperButton.classList.toggle('attention', attention);
    this.diaperButton.disabled = !enabled;
  }

  setMuteIcon(muted) { this.muteButton.textContent = muted ? '🔇' : '🔊'; }

  showPointer(x, y) {
    this.pointer.style.display = 'block';
    this.pointer.style.left = `${x}px`;
    this.pointer.style.top = `${y}px`;
  }

  hidePointer() { this.pointer.style.display = 'none'; }
}
