const KEY = 'baby-care-game/v1';

export const CARE_KINDS = ['diaper', 'milk', 'sleep', 'bath'];

// 1秒あたりの たまり方。おむつがいちばん早く、おふろはゆっくり。
const RATES = { diaper: 0.011, milk: 0.013, sleep: 0.008, bath: 0.006 };

// これを こえると「〜してほしい」と知らせる
export const WANT_THRESHOLD = 0.62;

/**
 * 失敗のないゲームなので、欲求は「たまる」だけで減点はしない。
 * たまりきっても ぐずるところまでで、泣きっぱなしにはしない。
 */
export class GameState {
  constructor() {
    this.needs = { diaper: 0.45, milk: 0.3, sleep: 0.05, bath: 0.15 };
    this.stars = 0;
    this.muted = false;
    this._saveTimer = 0;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.needs) for (const k of CARE_KINDS) {
        if (typeof data.needs[k] === 'number') this.needs[k] = Math.min(1, Math.max(0, data.needs[k]));
      }
      if (typeof data.stars === 'number') this.stars = data.stars;
      if (typeof data.muted === 'boolean') this.muted = data.muted;
    } catch (e) {
      // こわれたセーブデータは、はじめから遊べばよいので無視する
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ needs: this.needs, stars: this.stars, muted: this.muted }));
    } catch (e) { /* プライベートモードなどでは保存しない */ }
  }

  update(dt) {
    for (const k of CARE_KINDS) {
      this.needs[k] = Math.min(1, this.needs[k] + RATES[k] * dt);
    }
    this._saveTimer += dt;
    if (this._saveTimer > 5) {
      this._saveTimer = 0;
      this.save();
    }
  }

  satisfy(kind) {
    this.needs[kind] = 0;
    this.stars += 1;
    this.save();
  }

  wants(kind) {
    return this.needs[kind] >= WANT_THRESHOLD;
  }

  /** いちばん こまっていること。なければ null。 */
  mostUrgent() {
    let best = null;
    let value = WANT_THRESHOLD;
    for (const k of CARE_KINDS) {
      if (this.needs[k] > value) {
        value = this.needs[k];
        best = k;
      }
    }
    return best;
  }

  /** ごきげん度（0〜1）。表情に使う。 */
  mood() {
    const worst = Math.max(...CARE_KINDS.map((k) => this.needs[k]));
    return 1 - worst;
  }
}
