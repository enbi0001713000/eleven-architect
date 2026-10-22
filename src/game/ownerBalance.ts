// フェーズ3-B のオーナーの評価で使う数値（目標、信頼度、警告、解任）。調整するときはここを変える。
// 要件定義書「オーナーの目標」「信頼度と解任」に対応する。

import type { FinanceGoalKind, OwnerStrictness } from './types';

/** 順位の目標の段階（この順位以内）。評判と戦力の順位から決め、話し合いで1段ずつ上げ下げできる */
export const POSITION_GOALS: readonly number[] = [1, 3, 6, 10, 15, 17];

export const POSITION_GOAL_LABEL: Record<number, string> = {
  1: '優勝', 3: '3位以内', 6: '6位以内', 10: '10位以内', 15: '残留（15位以内）', 17: '最下位を避ける（17位以内）',
};

export const FINANCE_GOAL_LABEL: Record<FinanceGoalKind, string> = {
  noDeficit: '今年を黒字にする',
  wagesWithinBudget: '年俸の合計を年俸予算の中に収める',
  reduceDebt: '借り入れを減らす',
};

export const STRICTNESS_LABEL: Record<OwnerStrictness, string> = { lenient: '寛容', normal: '普通', strict: '厳しい' };

export const OWNER = {
  /** 就任したときの信頼度 */
  startTrust: 60,
  /** 厳しさごとの、警告（1回目、2回目）、シーズン中の解任、シーズンの評価での解任のしきい値 */
  thresholds: {
    lenient: { warn: [30, 15], dismiss: 5, seasonDismiss: 30 },
    normal: { warn: [35, 20], dismiss: 10, seasonDismiss: 40 },
    strict: { warn: [40, 28], dismiss: 18, seasonDismiss: 50 },
  } satisfies Record<OwnerStrictness, { warn: [number, number]; dismiss: number; seasonDismiss: number }>,
  /** 信頼度が下がるときの倍率（厳しいオーナーほど大きく下がる） */
  downScale: { lenient: 0.7, normal: 1, strict: 1.3 } satisfies Record<OwnerStrictness, number>,
  /** この節より前は、シーズン中に解任しない */
  dismissFromRound: 8,
  /** 毎月：目標の順位との差1つあたり（目標どおりで0）と、その幅 */
  perPlace: 0.5,
  placeRange: [-4, 2.5] as [number, number],
  /** 毎月：この順位より下（降格圏）にいると、さらに下がる（目標が残留より上のときだけ） */
  dangerPosition: 16,
  dangerPenalty: -1.5,
  /** 毎月：最下位にいると、目標に関係なく下がる */
  bottomPenalty: -1.5,
  /** 毎月：その月の勝ち点（1試合あたり）を、目標の順位なら取れるはずの勝ち点と比べる。その重みと幅 */
  expectedPoints: { 1: 2.2, 3: 2, 6: 1.7, 10: 1.4, 15: 1.1, 17: 0.9 } as Record<number, number>,
  pointsWeight: 2.5,
  pointsRange: [-3.5, 2.5] as [number, number],
  /** 毎月：お金のこと */
  ownerFunding: -10,
  emergencyLoan: -4,
  heavyDebt: -1,
  heavyDebtRatio: 0.6,
  /** シーズンの評価：目標との差（実際の順位 − 目標）ごとの増減。目標が残留より上で降格圏に終わると「大きく下回った」 */
  verdict: { exceeded: 14, met: 8, near: -6, missed: -14, farMissed: -24 },
  financeGoal: { met: 4, missed: -8 },
  /** 目標の話し合い：予算が変わる割合と、下げてもらったときの信頼度 */
  negotiationBudgetShare: 0.1,
  lowerTrust: -3,
  /** 予算の増額を認める度合い（信頼度がこれ以上なら全部、その下は一部、もっと下は認めない） */
  increaseFull: 60,
  increasePartial: 40,
  increasePartialShare: 0.6,
  /** これより低いと、借り入れを認めない */
  loanMinTrust: 30,
} as const;

/** 信頼度に応じて、予算の増額を認める割合 */
export function budgetTrustFactor(trust: number): number {
  if (trust >= OWNER.increaseFull) return 1;
  if (trust >= OWNER.increasePartial) return OWNER.increasePartialShare;
  return 0;
}
