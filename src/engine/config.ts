// 試合エンジンの調整用の数値。結果の分布（平均ゴール数やホーム勝率など）は、ここを変えて合わせる。
// 要件定義書「非機能要件」の「調整しやすさ」に対応する。

export const ENGINE_CONFIG = {
  /** ホームの選手の能力にかける倍率 */
  homeAdvantage: 1.04,
  /** 試合の計算では、能力値の平均（attributeCenter）からの差を attributeSpread 倍に縮めて使う */
  attributeCenter: 12,
  attributeSpread: 0.8,

  /** 選手がどれだけ離れたマスまで影響するか（マス単位） */
  influenceRadius: 1.5,
  /** マスの強さを1前後に揃えるための割り算の値 */
  zoneStrengthScale: 18,
  /** プレス：相手陣内でボールに寄せることで加わる圧力 */
  pressing: {
    /** プレス最大（+2）のときに加わる圧力。-2 では 0、0 ではこの半分 */
    boost: 1.2,
    /** プレスを1段階強めるごとの、スタミナの減り方の増え方 */
    staminaCost: 0.12,
    /** 相手陣内でも、センターライン寄りの列では弱くなる */
    midfieldReach: 0.6,
  },

  /** 1回のプレーにかかる秒数の基準 */
  secondsPerAction: 4.2,

  /** 行動の選ばれやすさ */
  weights: {
    pass: 3.0,
    dribble: 0.25,
    shotInBox: 0.4,
    shotInBoxWide: 0.15,
    shotOutsideBox: 0.16,
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
    boxEntryPenalty: 0.36,
    /** 失敗したパスのうち、相手のパスカットとして記録する割合 */
    interceptedShare: 0.3,
    /** 長いボール（3マス以上）では、出し手への寄せの影響をこの倍率にする */
    longBallPressureRelief: 0.35,
    /** ペナルティエリアの中にいる味方へのパスの選ばれやすさ */
    boxTargetWeight: 0.6,
  },

  /** ボールを持った選手が、プレーする前に相手に奪われる確率の基準（圧力1あたり） */
  dispossession: {
    base: 0.04,
    boxMultiplier: 2.5,
    /** 長いボールとテンポの速さ1段階ごとに、奪われる確率を減らす割合 */
    directRelief: 0.1,
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
    cornerOnClearance: 0.15,
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
  /** スタミナが0のときの能力の倍率（100で1倍）。低いほど、疲れた選手の交代が効く */
  staminaFloor: 0.62,

  /** ボールを失った直後に守備の形が整うまでの秒数と、そのあいだ攻撃時の位置から守る割合（直後の値） */
  transition: {
    seconds: 9,
    blend: 0.45,
  },

  /** 最終ラインの裏へのボール */
  behind: {
    /** 守備ラインが1段階高いごとに、パスの成功率に足す */
    line: 0.02,
    /** プレス1段階を、守備ラインの高さに換算した値 */
    pressingShare: 0.5,
    /** 受け手が守備陣より速いときに足す（速さの差8で、ラインが普通のとき） */
    pace: 0.035,
    /** 裏へのボールが通ったとき、抜け出してGKと1対1になる確率（速さの差とラインの高さに比例。上限あり） */
    breakawayRate: 0.5,
    breakawayMax: 0.4,
    /** 抜け出したあと、すぐにシュートを打つ確率と、そのxGの倍率 */
    breakawayShoot: 0.75,
    breakawayXg: 1.4,
  },

  /** GKの飛び出し：裏へのボール（パスの成功率から引く）とクロス（届く確率から引く）。keeperSweep が+1のときの大きさ */
  keeper: {
    sweepOnThroughBall: 0.06,
    claimCross: 0.04,
  },

  /** 試合中のケガ（フェーズ2） */
  injury: {
    /** ファウルを受けたときにケガをする確率 */
    onFoul: 0.01,
    /** タックルを受けたときにケガをする確率 */
    onTackle: 0.0015,
    /** 接触のないケガ（肉離れなど）の、1分あたりの確率 */
    nonContactPerMinute: 0.00004,
    /** ケガをしたまま出ている選手の能力の倍率 */
    playingHurt: 0.75,
    /** 完治前に出場させたときのケガのしやすさの倍率 */
    carryingMultiplier: 3,
  },
  /** モラル1ポイントあたりの、その日の出来への影響（60が基準） */
  moralePerPoint: 0.001,
  /** 蓄積疲労がこの値を超えると能力が下がり始める */
  fatigueThreshold: 35,
  /** 蓄積疲労が100のときの能力の低下 */
  fatigueMaxPenalty: 0.1,
  /** 戦術の熟成度が0のときの、判断力とポジショニングの低下 */
  familiarityWeight: 0.12,
} as const;
