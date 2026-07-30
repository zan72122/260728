// 全チューニング値を一箇所に集約する。
// 座標系: 床 y=0、部屋中心が原点。ドアは z=-depth/2 の壁。

export const ROOM = {
  width: 4.5, // x
  depth: 3.6, // z
  height: 2.4, // y
  wallThickness: 0.12,
}

export const DOOR = {
  width: 0.85,
  height: 2.0,
  thickness: 0.06,
  mass: 38,
  // ヒンジ位置(前壁 z=-depth/2 上)。閉状態でドア板は hingeX → hingeX+width。
  hingeX: -0.75,
  maxAngle: (110 * Math.PI) / 180,
  sealAngle: (2.5 * Math.PI) / 180, // これ未満は枠が密閉しているとみなす
  knobRadius: 0.32, // ノブのタッチ判定半径(見た目より大きく)
  // 手の力: 目標角速度追従トルクの上限 [N·m]
  handMaxTorque: 260,
  handStiffness: 900, // (targetOmega - omega) → トルク係数
  maxHandOmega: 5.0, // スワイプで出せる最大角速度 [rad/s]
  rotDrag: 90, // 水中的な回転減衰 [N·m·s/rad]
  // 水圧トルク: 実物理では巨大すぎるため体験用にスケール
  pressureTorqueScale: 0.028,
  // シール解放の立ち上がり(この角度を超えると水圧が一気にかかる)
  pressureRampStart: (4 * Math.PI) / 180,
  pressureRampEnd: (14 * Math.PI) / 180,
}

export const WATER = {
  rho: 1000,
  g: 9.81,
  Cd: 0.6, // オリフィス流量係数
  headEff: 2.6, // 屋外有効水頭 [m](演出ペーシング用に飽和)
  ceilingGap: 0.15, // 天井直下に残る空気層の厚さ
  airCompressStart: 0.5, // 天井からこの距離で流入が漸減し始める
  // 見た目
  surfaceColor: 0x5c6b4a,
  deepColor: 0x2e4030,
  underwaterFog: 0.4,
}

export const CHAR = {
  radius: 0.22,
  height: 1.7, // 全身
  walkSpeed: 1.45,
  wadeMinFactor: 0.32, // 最深徒渉時の速度係数
  swimSpeed: 1.1,
  wadeDepth: 0.4, // これ以上で WADE
  swimDepth: 1.25, // これ以上で SWIM(胸〜首)
  eyeHeight: 1.55,
  mass: 65,
}

export const CAMERA = {
  minDist: 1.4,
  maxDist: 5.6,
  initDist: 3.4,
  initYaw: 0.25,
  initPitch: 0.3,
  minPitch: -0.15,
  maxPitch: 1.35,
  /** 固定する水平FOV [rad](縦画面では垂直FOVを逆算して拡大) */
  targetHFov: 1.08,
  maxVFov: 1.35,
}

export const FLOOR_AREA = ROOM.width * ROOM.depth

export const DT = 1 / 60
