// 移籍の数字（要件定義書 フェーズ4「移籍交渉」「AIクラブの移籍」「海外への移籍」「レンタル移籍」、フェーズ4-B）

import type { ClubSize, SquadRole } from './types';

export interface SizePolicy {
  /** 獲る選手の年齢 */
  age: [number, number];
  /** 獲る選手の総合力の下限（クラブの水準からの差） */
  minBelowLevel: number;
  /** 移籍予算のうち、使ってよい割合 */
  spendShare: number;
  /** 主力を売る額（市場価値の倍率） */
  sellKey: number;
  /** 買うときに出してよい額の上限（市場価値の倍率） */
  buyerMax: number;
  /** 1年に移籍金を払って獲る人数の上限 */
  maxBuys: number;
}

export const TRANSFER = {
  /** 移籍期間（'MM-DD'） */
  windows: [['01-05', '03-27'], ['07-15', '08-15']] as [string, string][],
  policy: {
    large: { age: [24, 30], minBelowLevel: 0, spendShare: 0.8, sellKey: 1.6, buyerMax: 1.4, maxBuys: 3 },
    medium: { age: [22, 29], minBelowLevel: 1, spendShare: 0.6, sellKey: 1.3, buyerMax: 1.2, maxBuys: 2 },
    small: { age: [18, 26], minBelowLevel: 1.5, spendShare: 0.4, sellKey: 1.1, buyerMax: 1.05, maxBuys: 2 },
  } satisfies Record<ClubSize, SizePolicy>,
  /** 主力以外を売る額（市場価値の倍率）。移籍リストに載せた選手は listed */
  sellRole: { key: 0, rotation: 1, backup: 0.8, youth: 0.9 } satisfies Record<SquadRole, number>,
  listed: 0.6,
  /** 夏に優勝争い（この順位以内）をしているクラブは、さらにこれだけ上でないと売らない */
  titleRace: 3,
  titleRacePremium: 0.3,
  /** 売る側の返事：希望の額のこの割合以上なら、希望の額を返す（2回まで） */
  counterFloor: 0.75,
  maxRounds: 2,
  /** 返事が来るまでの日数、返事を待つ日数、合意してから契約を結ぶまでの日数 */
  answerDays: [2, 4] as [number, number],
  decideDays: 5,
  contractDays: 14,
  overseasDecideDays: 7,
  /** AIクラブが買いに出る確率（移籍期間の決まった日ごと） */
  aiBuyChance: 0.5,
  /** AIクラブの買う日と、貸す日（移籍期間の中） */
  aiDays: ['01-08', '01-18', '01-28', '02-10', '02-25', '03-10', '03-24', '07-16', '07-23', '07-30', '08-06', '08-13'],
  /** AIクラブが最初に出す移籍金（市場価値の倍率） */
  aiOpening: [0.8, 1.1] as [number, number],
  /** 選手が移籍に応じる確率（断る条件に当たらず、移籍先の評判が大きく下でなければ） */
  aiPlayerAccept: 0.8,
  /** 海外の選手プールの選手の移籍金（市場価値の倍率）。外国籍は1クラブ5人まで */
  poolFee: 0.9,
  foreignMax: 5,
  /** 足りないポジションでなくても、今の2番手よりこれだけ強ければ買う */
  upgrade: 0.3,
  /** 上位18人の平均がリーグ平均よりこれだけ上のクラブは、足りないポジションを埋めるだけにする（強いクラブに選手が集まりすぎないように） */
  saturation: 1.5,
  /** AIクラブが移籍予算から年俸予算に回せるのは、1年に年俸予算のこの割合まで */
  maxShift: 0.1,
  /** 海外への移籍：リーグ平均より強いクラブの選手ほど声がかかりやすい（差1につき） */
  overseasStrongClub: 0.5,
  /** 移籍リストに載せる：序列がこの番目より下で、この年齢以上の主力以外 */
  listRank: 22,
  listAge: 24,
  /** レンタルに出す：この年齢以下で、序列がこの番目より下、潜在能力がクラブの水準以上 */
  loanAge: 21,
  loanRank: 20,
  loanChance: 0.5,
  /** レンタルの終わり（この日の次の日に戻る。12月1日の契約の締め切りの前） */
  loanEnds: '11-30',
  /** 海外への移籍：時期と、対象（25歳以下で総合力 young 以上、または総合力 star 以上） */
  overseasDays: ['06-20', '12-10'],
  overseasYoungAge: 25,
  overseasYoung: 14,
  overseasStar: 16,
  overseasPerDate: [2, 4] as [number, number],
  overseasFee: [1, 1.5] as [number, number],
  /** 行きたがる確率：0.3 + 野心×0.035 + 断られた回数×0.2 */
  overseasWant: (ambition: number, refused: number): number => Math.min(0.95, 0.3 + ambition * 0.035 + refused * 0.2),
  /** 行きたがっている選手の海外移籍を断ると、モラルがこれだけ下がる */
  overseasRefuseMorale: 20,
  /** 終わった交渉を残す数 */
  keepBids: 60,
  keepHistory: 400,
};
