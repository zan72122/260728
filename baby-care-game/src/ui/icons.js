// 文字をつかわない絵アイコン。すべて SVG のかたちで描く。

const wrap = (inner, extra = '') => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" ${extra}>${inner}</svg>`;

export const ICONS = {
  // おむつ
  diaper: wrap(`
    <path d="M8 16h48c0 0 2 20-6 30-6 7-13 10-18 10s-12-3-18-10C6 36 8 16 8 16z" fill="#ffffff" stroke="#c9b8a4" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M8 16h48v8H8z" fill="#8fd0f0" stroke="#5fa8cd" stroke-width="2" stroke-linejoin="round"/>
    <path d="M32 30l3 6.2 6.8 1-5 4.8 1.2 6.8L32 45.6 26 48.8l1.2-6.8-5-4.8 6.8-1z" fill="#f7c8d6"/>
  `),

  // ミルク（ほにゅうびん）
  bottle: wrap(`
    <path d="M26 6h12v6h-12z" fill="#f6d9a8" stroke="#c9a878" stroke-width="2" stroke-linejoin="round"/>
    <rect x="22" y="12" width="20" height="7" rx="2" fill="#bfe6d5" stroke="#79b8a0" stroke-width="2"/>
    <path d="M22 20h20v30a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z" fill="#ffffff" stroke="#c9b8a4" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M23 34h18v16a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6z" fill="#fdf3e0"/>
    <path d="M23 34h18v16a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6z" fill="#fbe6c0"/>
    <path d="M36 24v6M36 24h-2" stroke="#d8cbb8" stroke-width="2" stroke-linecap="round"/>
  `),

  // ねんね（つきとほし）
  moon: wrap(`
    <path d="M40 8a24 24 0 1 0 16 42A26 26 0 0 1 40 8z" fill="#ffd166" stroke="#e0a93c" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M18 12l2.4 5.1L26 19l-5.6 1.9L18 26l-2.4-5.1L10 19l5.6-1.9z" fill="#c7b6f0"/>
    <path d="M50 16l1.6 3.4L55 21l-3.4 1.3L50 26l-1.6-3.7L45 21l3.4-1.6z" fill="#f7b8c8"/>
  `),

  // おふろ
  bath: wrap(`
    <circle cx="18" cy="14" r="6" fill="#ffffff" stroke="#a8d8ef" stroke-width="2"/>
    <circle cx="30" cy="9" r="4" fill="#ffffff" stroke="#a8d8ef" stroke-width="2"/>
    <circle cx="42" cy="15" r="5" fill="#ffffff" stroke="#a8d8ef" stroke-width="2"/>
    <path d="M6 28h52v10a14 14 0 0 1-14 14H20A14 14 0 0 1 6 38z" fill="#9ed3f0" stroke="#5fa8cd" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M6 28h52v6H6z" fill="#cceaf9" stroke="#5fa8cd" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M14 52v5M50 52v5" stroke="#5fa8cd" stroke-width="4" stroke-linecap="round"/>
  `),

  // おと あり／なし
  soundOn: wrap(`
    <path d="M12 26h10l12-10v32L22 38H12z" fill="#ffd166" stroke="#c99a3c" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M42 22a14 14 0 0 1 0 20M48 16a22 22 0 0 1 0 32" stroke="#7fb8a0" stroke-width="4" stroke-linecap="round" fill="none"/>
  `),
  soundOff: wrap(`
    <path d="M12 26h10l12-10v32L22 38H12z" fill="#d8cec2" stroke="#a89684" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M42 24l16 16M58 24L42 40" stroke="#e08a7a" stroke-width="5" stroke-linecap="round"/>
  `),

  // もどる
  back: wrap(`
    <path d="M38 12L18 32l20 20" fill="none" stroke="#8fb8a0" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  `),

  // ゆびのお手本
  hand: wrap(`
    <path d="M26 8c3 0 5 2 5 5v18h2V20c0-3 2-5 5-5s5 2 5 5v11h2V24c0-3 2-5 5-5s5 2 5 5v20c0 9-7 16-16 16h-6c-9 0-15-6-15-15V22c0-3 2-5 5-5s5 2 5 5v9h2V13c0-3 2-5 5-5z" fill="#fbdbc2" stroke="#c99a78" stroke-width="2.5" stroke-linejoin="round"/>
  `),

  // ごほうびの ほし
  star: wrap(`
    <path d="M32 4l8.4 17.6L60 24.4 45.6 38.2 49 58 32 48.4 15 58l3.4-19.8L4 24.4l19.6-2.8z" fill="#ffd166" stroke="#e0a93c" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="25" cy="30" r="2.6" fill="#7a6242"/>
    <circle cx="39" cy="30" r="2.6" fill="#7a6242"/>
    <path d="M26 38a7 7 0 0 0 12 0" fill="none" stroke="#7a6242" stroke-width="3" stroke-linecap="round"/>
    <circle cx="19" cy="36" r="3" fill="#f7b8c8"/>
    <circle cx="45" cy="36" r="3" fill="#f7b8c8"/>
  `),
};

/** お世話ボタンの並び順（左からこの順に置く）。 */
export const CARE_ICONS = {
  diaper: ICONS.diaper,
  milk: ICONS.bottle,
  sleep: ICONS.moon,
  bath: ICONS.bath,
};
