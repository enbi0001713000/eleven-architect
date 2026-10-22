// 契約と市場価値の数字（要件定義書 フェーズ4「選手の市場価値」「代理人」「契約の条件」「契約の更新」、フェーズ4-A）

import type { AgentStyle, SquadRole } from './types';

export interface AgentProfile {
  label: string;
  /** 手数料（新しい契約の年俸1年分に対する割合） */
  feeRate: number;
  /** 年俸の希望の倍率 */
  demand: number;
  /** 提示できる回数（これを超えると決裂） */
  patience: number;
  /** 代理人の数の割合 */
  share: number;
}

export const AGENT_STYLES: Record<AgentStyle, AgentProfile> = {
  calm: { label: '穏やか', feeRate: 0.03, demand: 1, patience: 3, share: 0.3 },
  normal: { label: 'ふつう', feeRate: 0.05, demand: 1.06, patience: 3, share: 0.45 },
  tough: { label: '強気', feeRate: 0.08, demand: 1.14, patience: 2, share: 0.25 },
};

/** 違約金の選び方（市場価値の何倍か。null は違約金なし） */
export const RELEASE_CLAUSE_OPTIONS: (number | null)[] = [1, 1.5, 2, 3, null];

export const CONTRACT = {
  agents: 30,
  /** 市場価値：年齢ごとの「年俸の相場の何年分か」（この年齢以下なら） */
  ageMultiple: [[21, 4], [24, 3], [27, 2], [29, 1.5], [31, 1], [99, 0.5]] as [number, number][],
  /** 市場価値：23歳以下で、潜在能力が総合力より高いと、差1につきこの割合だけ上乗せ（最大 growthMax 倍） */
  growthAge: 23,
  growthPerPoint: 0.25,
  growthMax: 2,
  /** 市場価値：契約の残り（今年で切れる、残り2年） */
  expiringFactor: 0.6,
  twoYearsFactor: 0.9,
  /** 市場価値：今季の活躍（この試合数以上出ていれば、平均評価点で上下する） */
  formApps: 8,
  formHigh: [6.8, 1.2] as [number, number],
  formLow: [6.2, 0.85] as [number, number],
  /** 違約金の初期値（市場価値の倍率） */
  defaultClause: 1.5,
  /** 違約金の高さによる、年俸の希望の倍率（null は違約金なし） */
  clauseDemand: new Map<number | null, number>([[1, 0.96], [1.5, 1], [2, 1.03], [3, 1.06], [null, 1.08]]),
  minSalary: 480e4,
  maxYears: 5,
  /** 33歳以上は2年まで */
  veteranMaxYears: 2,
  veteranAge: 33,
  /** 希望の年数（30歳以上は短め）と、ずれ1年あたりの年俸の希望の増え方 */
  preferredYears: (age: number): number => (age >= 30 ? 2 : 3),
  yearsPenalty: 0.04,
  /** 30歳以上が長い契約をもらえると、1年あたりこれだけ年俸を下げてもよい */
  veteranLongDiscount: 0.03,
  /** 約束する役割が、ふさわしい役割より1段下だと年俸の希望が上がり、2段下なら断る */
  roleOneDown: 1.15,
  roleUp: 0.95,
  /** 更新のとき：年俸を今より下げるなら、ここまで（30歳以上は veteranCut まで） */
  renewalFloor: 0.95,
  veteranCut: 0.85,
  /** 忠誠心（1〜20）が10から1違うごとに、今のクラブへの年俸の希望がこれだけ下がる */
  loyaltyPerPoint: 0.01,
  /** モラルが低いと更新の希望が上がる */
  lowMorale: [40, 1.08] as [number, number],
  /** 選手が自分にふさわしいと思うクラブの評判：30 + (総合力 - 10) × 9 */
  wantedReputation: (overall: number): number => Math.max(20, Math.min(95, 30 + (overall - 10) * 9)),
  /** 評判が足りない1につき、野心（1〜20）/10 × この割合だけ年俸の希望が上がる。足りない分が refuseGap を超え、野心が refuseAmbition 以上なら断る */
  reputationPerPoint: 0.01,
  refuseGap: 25,
  refuseAmbition: 14,
  /** 合意する幅（希望より少しだけ低くても合意する） */
  tolerance: 0.03,
  /** 希望のこの割合より低い提示は、2回分と数える */
  lowball: 0.8,
  /** 決裂したら、この日数は話せない */
  breakOffDays: 14,
  /** 出来高ボーナス：選手は見込み額のこの割合を年俸と同じように数える */
  bonusShare: 0.7,
  /** 1年の出場数の見込み（約束する役割ごと） */
  expectedApps: { key: 30, rotation: 20, backup: 8, youth: 5 } satisfies Record<SquadRole, number>,
  /** 1試合あたりのゴールの見込み（ポジションごと） */
  goalRate: { GK: 0, CB: 0.05, SB: 0.03, WB: 0.05, DM: 0.04, CM: 0.1, WM: 0.12, AM: 0.22, W: 0.25, FW: 0.4 } as Record<string, number>,
  /** 出来高ボーナスの選び方（円） */
  appearanceBonusOptions: [0, 10e4, 30e4, 50e4, 100e4],
  goalBonusOptions: [0, 30e4, 50e4, 100e4, 200e4],
  /** 更新の交渉ができる期間（今年で契約が切れる選手と）と、締め切りの日 */
  renewalOpens: '07-01',
  renewalCloses: '11-30',
  deadline: '12-01',
  /** 所属なしの選手を獲れる最後の日（冬の移籍期間の終わり）。次の日に去る */
  freeAgencyEnds: '03-27',
  /** 契約が切れる選手の知らせ（7月1日）と、念押し（11月1日） */
  reminder: '11-01',
  /** AIクラブが契約満了の選手を獲る日（12月は仮の契約、1〜3月はすぐ加入） */
  aiSigningDays: ['12-03', '12-10', '12-17', '12-24', '01-03', '01-12', '01-24', '02-07', '02-21', '03-07', '03-21'],
  /** AIクラブが獲るのをやめる人数（新人が入る1月10日までは少なめにしておく） */
  aiSquadBeforeNewcomers: 26,
  aiSquadAfterNewcomers: 28,
  /** AIクラブの誘いに選手が応じる確率（断る条件に当たらなければ） */
  aiAcceptChance: 0.7,
  /** AIクラブ（と強化部に任せた選手）で、選手が更新を断って出ていく確率（約束した役割ごと）。出場機会や新しい挑戦を求める */
  declineChance: { key: 0.1, rotation: 0.25, backup: 0.35, youth: 0.2 } satisfies Record<SquadRole, number>,
  /** 新人は毎年この人数（登録がこの人数より少なければ、そこまで埋める） */
  newcomers: [2, 3] as [number, number],
  newcomerMinSquad: 24,
  /** AIクラブが獲る年齢（規模ごと） */
  aiAgeRange: { large: [22, 31], medium: [20, 31], small: [17, 33] } as Record<string, [number, number]>,
  /** AIクラブが獲る最低の総合力（クラブの水準からの差） */
  aiMinBelowLevel: 2.5,
  /** 足りないポジションでなくても、今の2番手よりこれだけ強ければ獲る */
  aiUpgrade: 0.5,
};

/** 役割の高さ（大きいほど上） */
export const ROLE_RANK: Record<SquadRole, number> = { key: 3, rotation: 2, backup: 1, youth: 1 };
