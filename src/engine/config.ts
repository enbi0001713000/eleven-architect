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
    boxEntryPenalty: 0.4,
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
  staminaDrainPerMinute: 0.6,
  /**
   * スタミナによる能力の倍率。スタミナが knee（割合）までは少しずつ下がり（slopeAbove）、それを切ると急に下がる（slopeBelow）。
   * 試合の終盤に疲れが効き、交代で元気な選手を入れる意味が出る。min より下には下がらない
   */
  tiredness: { knee: 0.65, slopeAbove: 0.2, slopeBelow: 0.9, min: 0.5 },
  /** 試合の前のコンディションが、試合開始時のスタミナにどれだけ響くか（1なら、コンディション70%でスタミナ70から始まる。0.4なら88から） */
  conditionWeight: 0.4,

  /** ボールを失った直後に守備の形が整うまでの秒数と、そのあいだ攻撃時の位置から守る割合（直後の値） */
  transition: {
    seconds: 9,
    blend: 0.45,
  },

  /**
   * カウンター：ボールを奪った直後、相手の形が整う前に縦へ速く攻める。
   * 前がかりのチーム（攻撃の姿勢と守備ラインが高い）ほど、ボールを失った直後に崩れている。
   * 縦に速いチーム（テンポが速く、長いボールを使う）ほど、その隙を前へのパスと裏へのボールで突く
   */
  counter: {
    /** 前がかり（攻撃の姿勢と守備ラインの高さの平均）1段階ごとに、ボールを失った直後の崩れ方を増やす割合 */
    exposure: 0.6,
    /** 縦への速さが最大のとき、相手が崩れている間に前へのパスを選ぶ倍率の増え方 */
    forward: 1.0,
    /** 同じく、裏へのボールが通りやすくなる量 */
    behind: 0.08,
    /** 同じく、裏へのボールが通ったときに抜け出してGKと1対1になる確率に足す量 */
    breakaway: 0.2,
    /** 同じく、1回のプレーにかかる秒数を縮める量 */
    speedUp: 1.2,
    /** 相手の形が整う前は、ペナルティエリアへのパスの難しさをこの割合まで減らす（ボールを失った直後の値） */
    boxEntryRelief: 0.5,
    /** 引いて守る相手（守備ラインと攻撃の姿勢の平均が−1）に、短いパス（−2）でつなぐと、ペナルティエリアへのパスの成功率がこの割合だけ下がる */
    lowBlock: 0.25,
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
