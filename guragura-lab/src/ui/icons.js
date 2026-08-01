/**
 * 文字を使わないSVGアイコン集。
 * 4歳児にも意味が伝わる絵アイコンだけで構成する。
 */

/** ぐらぐらボタン：ゆれるおうち＋波線 */
export const quakeIcon = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-6 32 30)">
    <path d="M14 30 L32 14 L50 30" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <rect x="19" y="29" width="26" height="18" rx="3" fill="#fff"/>
    <rect x="28" y="36" width="8" height="11" rx="2" fill="#f6538e"/>
  </g>
  <path d="M10 54 q4 -5 8 0 t8 0 t8 0 t8 0 t8 0" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`;

/** 巻き戻し：時計まわりの逆矢印 */
export const rewindIcon = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M45 18 A19 19 0 1 0 51 32" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none"/>
  <path d="M45 6 L45 20 L31 20" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="32" cy="32" r="4" fill="#fff"/>
</svg>`;

/** もう一回：ぐるっと一周の矢印＋星 */
export const againIcon = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 34 a16 16 0 1 1 6 12" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none"/>
  <path d="M12 48 L22 46 L18 36" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M32 24 l2.6 5.3 5.9 .8 -4.3 4.1 1 5.8 -5.2 -2.7 -5.2 2.7 1 -5.8 -4.3 -4.1 5.9 -.8 z" fill="#fff"/>
</svg>`;

/** 音あり */
export const soundOnIcon = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 26 h8 l10 -9 v30 l-10 -9 h-8 z" fill="#e58bb0"/>
  <path d="M40 24 q6 8 0 16" stroke="#e58bb0" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M46 18 q10 14 0 28" stroke="#e58bb0" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>`;

/** 音なし */
export const soundOffIcon = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 26 h8 l10 -9 v30 l-10 -9 h-8 z" fill="#c9b6c2"/>
  <path d="M40 24 L52 40 M52 24 L40 40" stroke="#c9b6c2" stroke-width="5" stroke-linecap="round"/>
</svg>`;

/** メニュー（3つの丸） */
export const menuIcon = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="14" r="6" fill="#e58bb0"/>
  <circle cx="32" cy="32" r="6" fill="#e58bb0"/>
  <circle cx="32" cy="50" r="6" fill="#e58bb0"/>
</svg>`;

/** べつのゆれ（サイコロ） */
export const diceIcon = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="44" height="44" rx="10" fill="#9b6ef3"/>
  <circle cx="22" cy="22" r="4.5" fill="#fff"/>
  <circle cx="42" cy="22" r="4.5" fill="#fff"/>
  <circle cx="32" cy="32" r="4.5" fill="#fff"/>
  <circle cx="22" cy="42" r="4.5" fill="#fff"/>
  <circle cx="42" cy="42" r="4.5" fill="#fff"/>
</svg>`;

/** はじめから（おうち） */
export const homeIcon = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 30 L32 12 L54 30" stroke="#53b7f6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="17" y="29" width="30" height="22" rx="4" fill="#53b7f6"/>
  <rect x="27" y="37" width="10" height="14" rx="3" fill="#fff"/>
</svg>`;

/** 安全バッジ：にこにこ太陽 */
export const badgeSafe = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="24" fill="#ffe08a"/>
  <circle cx="32" cy="32" r="18" fill="#ffd34d"/>
  <circle cx="25" cy="29" r="2.6" fill="#7a5a20"/>
  <circle cx="39" cy="29" r="2.6" fill="#7a5a20"/>
  <path d="M24 36 q8 8 16 0" stroke="#7a5a20" stroke-width="3.4" stroke-linecap="round" fill="none"/>
  <g stroke="#ffd34d" stroke-width="4" stroke-linecap="round">
    <path d="M32 3 v6"/><path d="M32 55 v6"/><path d="M3 32 h6"/><path d="M55 32 h6"/>
    <path d="M11 11 l4.5 4.5"/><path d="M48.5 48.5 l4.5 4.5"/><path d="M53 11 l-4.5 4.5"/><path d="M15.5 48.5 L11 53"/>
  </g>
</svg>`;

/** 注意バッジ：オレンジの雲＋！（やわらかい注意） */
export const badgeDanger = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g fill="#ffb36b">
    <circle cx="20" cy="34" r="12"/>
    <circle cx="32" cy="27" r="14"/>
    <circle cx="45" cy="35" r="11"/>
    <rect x="12" y="34" width="41" height="12" rx="6"/>
  </g>
  <rect x="29" y="20" width="6" height="16" rx="3" fill="#fff"/>
  <circle cx="32" cy="42" r="3.4" fill="#fff"/>
</svg>`;

/** 机の下で守られたバッジ：机＋ハート */
export const badgeShield = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="20" width="48" height="9" rx="4.5" fill="#e9b077"/>
  <rect x="12" y="29" width="7" height="22" rx="3" fill="#df9f63"/>
  <rect x="45" y="29" width="7" height="22" rx="3" fill="#df9f63"/>
  <path d="M32 48 C26 42 22 39 22 34.5 C22 31 24.8 29 27.5 29 C29.5 29 31.2 30.2 32 31.8 C32.8 30.2 34.5 29 36.5 29 C39.2 29 42 31 42 34.5 C42 39 38 42 32 48 Z" fill="#ff8fab"/>
</svg>`;

/** くまの顔（比較パネル用） */
export function bearFace(ghost = false) {
  const fur = ghost ? 'none' : '#cf9057';
  const stroke = ghost ? '#6db3ff' : 'none';
  const sw = ghost ? 3.5 : 0;
  const dash = ghost ? 'stroke-dasharray="7 5"' : '';
  const face = ghost ? '#6db3ff' : '#4a3428';
  return `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="17" cy="16" r="8" fill="${fur}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>
  <circle cx="47" cy="16" r="8" fill="${fur}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>
  <circle cx="32" cy="34" r="22" fill="${fur}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>
  ${ghost ? '' : '<ellipse cx="32" cy="42" rx="10" ry="8" fill="#f3ddb9"/>'}
  <circle cx="24" cy="30" r="3" fill="${face}"/>
  <circle cx="40" cy="30" r="3" fill="${face}"/>
  <ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill="${face}"/>
</svg>`;
}

/** ドラッグを教える手 */
export const handIcon = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g filter="none">
  <path d="M30 12 c0 -4 6 -4 6 0 v16 l3 -6 c2 -4 7 -2 6 2 l-2 7 3 -3 c3 -3 7 1 4 4 l-6 8 c-3 5 -8 8 -14 8 c-8 0 -13 -6 -13 -14 v-9 c0 -4 6 -4 6 0 v3 l0 -12 c0 -4 7 -4 7 0 z" fill="#fff" stroke="#e58bb0" stroke-width="2.5"/>
  <circle cx="24" cy="52" r="3" fill="#e58bb0" opacity="0.7"/>
  </g>
</svg>`;
