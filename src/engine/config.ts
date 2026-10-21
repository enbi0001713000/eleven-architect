// 試合エンジンの調整用の数値。結果の分布（平均ゴール数やホーム勝率など）は、ここを変えて合わせる。
// 要件定義書「非機能要件」の「調整しやすさ」に対応する。

export const ENGINE_CONFIG = {
  /** ホームの選手の能力にかける倍率 */
  homeAdvantage: 1.04,
  /** 試合の計算では、能力値の平均（attributeCenter）からの差を attributeSpread 倍に縮めて使う */
  attributeCenter: 12,
  attributeSpread: 0.85,

  /** 選手がどれだけ離れたマスまで影響するか（マス単位） */
  influenceRadius: 1.5,
  /** マスの強さを1前後に揃えるための割り算の値 */
  zoneStrengthScale: 18,
  /** プレス：相手陣内でボールに寄せることで加わる圧力 */
  pressing: {
    /** プレス最大（+2）のときに加わる圧力。-2 では 0、0 ではこの半分 */
    boost: 0.7,
    /** 相手陣内でも、センターライン寄りの列では弱くなる */
    midfieldReach: 0.6,
  },

  /** 1回のプレーにかかる秒数の基準 */
  secondsPerAction: 4.2,

  /** 行動の選ばれやすさ */
  weights: {
    pass: 3.0,
    dribble: 0.25,
    shotInBox: 0.42,
    shotInBoxWide: 0.15,
    shotOutsideBox: 0.22,
    shotOutsideBoxWide: 0.04,
    cross: 0.95,
    earlyCross: 0.3,
    clear: 0.6,
  },

  pass: {
    base: 1.0,
    distancePenalty: 0.04,
    distanceDecay: 0.55,
    forwardPenalty: 0.02,
    /** 出し手が受けている圧力によるパス成功率の低下 */
    pressurePenalty: 0.08,
    /** 圧力を受けながらの長いパスほど失敗しやすい */
    pressureDistancePenalty: 0.025,
    /** ペナルティエリアへのパスは通りにくい */
    boxEntryPenalty: 0.22,
    /** 失敗したパスのうち、相手のパスカットとして記録する割合 */
    interceptedShare: 0.3,
    /** ペナルティエリアの中にいる味方へのパスの選ばれやすさ */
    boxTargetWeight: 0.6,
  },

  /** ボールを持った選手が、プレーする前に相手に奪われる確率の基準（圧力1あたり） */
  dispossession: {
    base: 0.04,
    boxMultiplier: 2.5,
  },

  dribble: {
    base: 0.52,
    boxEntryPenalty: 0.15,
  },

  /** ゴールの期待値（xG）。攻める向きで見た [行][中央からの列の距離] */
  xg: [
    [0.004, 0.003, 0.002],
    [0.006, 0.004, 0.003],
    [0.01, 0.008, 0.005],
    [0.02, 0.015, 0.01],
    [0.05, 0.035, 0.018],
    [0.16, 0.1, 0.045],
  ] as number[][],
  headerXg: 0.09,
  cornerHeaderXg: 0.075,
  freeKickXg: 0.055,
  penaltyXg: 0.76,

  cross: {
    base: 0.15,
    /** クロスが跳ね返されたとき、コーナーキックになる割合 */
    cornerOnClearance: 0.2,
  },
  cornerShotChance: 0.25,

  fouls: {
    onDribble: 0.3,
    onPassPerPressure: 0.025,
    /** ペナルティエリア内ではファウルが起きにくい（守備側が慎重になる） */
    inBoxMultiplier: 0.08,
    yellow: 0.08,
    yellowOnCounter: 0.11,
    /** すでにイエローを持つ選手は慎重になる */
    cautionedMultiplier: 0.5,
    straightRed: 0.002,
  },

  offside: {
    base: 0.02,
    perLineStep: 0.03,
  },

  /** 1分あたりのスタミナの減り方の基準 */
  staminaDrainPerMinute: 0.42,
} as const;
