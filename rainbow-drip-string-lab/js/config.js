// ゲーム全体で共有する調整用定数。
// 「マジックナンバー」をコードに散らさないため、ここに集約する。

export const CONFIG = {
  // --- 物理 ---
  GRAVITY: 1400,            // px/s^2 落下加速度
  STRING_GRAVITY: 900,      // 紐の上を滑るときの実効重力
  STRING_FRICTION: 1.6,     // 紐上の速度減衰(1/s)
  DROP_AIR_DRAG: 0.12,      // 空中のしずくの空気抵抗

  // --- 紐(たわみ) ---
  SAG_FACTOR: 0.22,         // 水平距離に対するたわみ率
  SAG_LOAD_FACTOR: 2.2,     // しずく荷重によるたわみ加算(px/vol)
  SAG_MAX: 180,             // たわみの上限(px)
  STRING_WIDTH: 9,          // 紐の描画太さ
  STRING_SAMPLES: 26,       // 曲線サンプル数(当たり判定・弧長用)
  STRING_HIT_DIST: 16,      // しずくが紐に付着する距離
  MIN_PIN_DIST: 34,         // ピン同士の最短距離(重なり防止)

  // --- しずく ---
  DROP_BASE_VOL: 1.0,       // 生成時の体積
  DROP_MAX_VOL_ON_STRING: 6.0, // これを超えると低い所から滴下
  DROP_RADIUS_K: 5.2,       // 半径 = K * vol^(1/3)
  DROP_MERGE_DIST: 1.15,    // 半径和×この係数以内で合体
  MAX_DROPLETS: 150,        // 同時しずく上限(性能維持)
  DRIP_INTERVAL: 0.16,      // 長押し時の滴下間隔(秒)

  // --- 反応オブジェクト ---
  CUP_CAPACITY: 16,         // カップが満杯になる体積
  SPONGE_CAPACITY: 14,      // スポンジ飽和体積
  FLOWER_BLOOM_STEP: 3,     // 花が1段階育つのに必要な体積
  FLOWER_MAX_STAGE: 5,      // 花の最大成長段階
  PUDDLE_MAX_COUNT: 8,      // 水たまりの最大数(超えたら結合)
  PUDDLE_SHINE_VOL: 20,     // これ以上でツヤ反射が出る

  // --- 見た目 ---
  MAX_PARTICLES: 220,       // 飛沫・キラキラの上限
  STAIN_FADE_INTERVAL: 4.0, // シミをうっすら退色させる周期(秒)
  STAIN_FADE_ALPHA: 0.012,  // 1回の退色量

  // --- レイアウト(画面比率) ---
  CLOUD_Y_RATIO: 0.16,      // 雲の縦位置(高さ比)
  GROUND_PAD: 10,           // 床ラインの下端からの余白
  UNDO_LIMIT: 24,           // アンドゥ履歴数
};
