import { mulberry32 } from './rng.js';

/**
 * 地震スクリプト生成。
 *
 * シード付き乱数から「揺れの波形」をステップ単位で事前計算する。
 * 同じシードなら、加速度・変位・タイミングのすべてが毎回完全に一致する。
 *
 * - accelX/accelZ: 各物理ステップで動的剛体に加える地面加速度 [m/s^2]
 *   （部屋固定座標系での慣性擬似力として使う）
 * - dispX/dispZ: 部屋全体の見た目の揺れ変位 [m]（描画のみ・物理には無関係）
 */

export const PHYSICS_DT = 1 / 120; // 固定タイムステップ
export const QUAKE_TIMELINE = {
  calm: 0.6, // 揺れ始めまでの静けさ
  ramp: 0.9, // 立ち上がり
  hold: 2.9, // 本震
  decay: 1.4, // おさまり
  settle: 2.6, // 揺れの後、物が転がり終わるまでの余韻
};

export function totalDuration() {
  const t = QUAKE_TIMELINE;
  return t.calm + t.ramp + t.hold + t.decay + t.settle;
}

export function totalSteps() {
  return Math.round(totalDuration() / PHYSICS_DT);
}

/** 0→1→0 の滑らかな包絡線 */
function envelopeAt(time) {
  const t = QUAKE_TIMELINE;
  const s = time - t.calm;
  if (s < 0) return 0;
  if (s < t.ramp) {
    const u = s / t.ramp;
    return u * u * (3 - 2 * u);
  }
  if (s < t.ramp + t.hold) return 1;
  const d = s - t.ramp - t.hold;
  if (d < t.decay) {
    const u = 1 - d / t.decay;
    return u * u * (3 - 2 * u);
  }
  return 0;
}

export function createQuakeScript(seed) {
  const rand = mulberry32(seed);
  const steps = totalSteps();

  // 数本の正弦波を重ねる。周波数・位相・振幅はシードから決まる。
  const waves = [];
  const waveCount = 4;
  for (let i = 0; i < waveCount; i++) {
    waves.push({
      freqX: 1.3 + rand() * 2.4, // Hz
      freqZ: 1.1 + rand() * 2.0,
      phaseX: rand() * Math.PI * 2,
      phaseZ: rand() * Math.PI * 2,
      amp: 0.55 + rand() * 0.45,
    });
  }
  const peakAccel = 9.0; // 本震のピーク加速度 [m/s^2]

  const accelX = new Float32Array(steps);
  const accelZ = new Float32Array(steps);
  const dispX = new Float32Array(steps);
  const dispZ = new Float32Array(steps);
  const envelope = new Float32Array(steps);

  let ampSum = 0;
  for (const w of waves) ampSum += w.amp;

  for (let i = 0; i < steps; i++) {
    const time = i * PHYSICS_DT;
    const env = envelopeAt(time);
    envelope[i] = env;
    let ax = 0;
    let az = 0;
    let dx = 0;
    let dz = 0;
    for (const w of waves) {
      ax += w.amp * Math.sin(2 * Math.PI * w.freqX * time + w.phaseX);
      az += w.amp * Math.sin(2 * Math.PI * w.freqZ * time + w.phaseZ);
      // 変位は低周波成分を強めに（見た目がゆったり揺れる）
      dx += (w.amp / w.freqX) * Math.sin(2 * Math.PI * w.freqX * time + w.phaseX);
      dz += (w.amp / w.freqZ) * Math.sin(2 * Math.PI * w.freqZ * time + w.phaseZ);
    }
    accelX[i] = (ax / ampSum) * peakAccel * env;
    accelZ[i] = (az / ampSum) * peakAccel * 0.8 * env;
    dispX[i] = (dx / ampSum) * 0.055 * env;
    dispZ[i] = (dz / ampSum) * 0.04 * env;
  }

  return {
    seed,
    dt: PHYSICS_DT,
    steps,
    duration: totalDuration(),
    accelX,
    accelZ,
    dispX,
    dispZ,
    envelope,
  };
}
