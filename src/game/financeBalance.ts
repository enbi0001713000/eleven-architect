// フェーズ3-A の財務で使う数値（収入、支出、チケット、予算、借り入れ）。調整するときはここを変える。
// 要件定義書「フェーズ3：財務とオーナー」と「金額の目安」に対応する。金額はすべて円。

import type { ClubSize, ExpenseKind, IncomeKind, SeatKind, SponsorDealKind, SponsorSlot } from './types';

export const INCOME_LABEL: Record<IncomeKind, string> = {
  tickets: '入場料', broadcast: '放映権（リーグからの配分）', sponsor: 'スポンサー', merchandise: 'グッズ販売',
  fanClub: 'ファンクラブ会費', prize: '賞金', transfers: '移籍金',
};

export const EXPENSE_LABEL: Record<ExpenseKind, string> = {
  wages: '選手の年俸', operations: 'クラブの運営費', matchday: '試合の運営費', merchandiseCost: 'グッズの仕入れ',
  fanClubCost: 'ファンクラブの運営費', interest: '借り入れの利息', transfers: '移籍金', agentFees: '代理人の手数料',
};

export interface SeatProfile {
  label: string;
  /** 収容人数のうち、この席の割合 */
  share: number;
  /** 中規模クラブの定価 */
  price: number;
  /** 値段への敏感さ。大きいほど、値上げで観客が減る */
  sensitivity: number;
}

export const SEATS: Record<SeatKind, SeatProfile> = {
  goal: { label: 'ゴール裏', share: 0.34, price: 3000, sensitivity: 0.9 },
  back: { label: 'バックスタンド', share: 0.32, price: 4500, sensitivity: 1.1 },
  main: { label: 'メインスタンド', share: 0.3, price: 6000, sensitivity: 1.15 },
  vip: { label: 'VIP', share: 0.04, price: 15000, sensitivity: 1.3 },
};

export const SEAT_KINDS: readonly SeatKind[] = ['goal', 'back', 'main', 'vip'];

export const FINANCE = {
  /** 規模ごとの、チケットの定価の倍率 */
  listPriceFactor: { large: 1.1, medium: 1, small: 0.9 } satisfies Record<ClubSize, number>,
  /** プレイヤーが決められるチケットの値段（定価に対する倍率） */
  priceRange: [0.5, 2] as [number, number],
  /** 年間チケットの割引や招待券があるので、実際の収入は定価の合計のこの割合になる */
  ticketYield: 0.6,
  /** 観客の見込み：係数 × ファンの数 ^ 指数（ファンが多いほど、増え方はゆるやかになる） */
  attendanceScale: 15.9,
  attendanceExponent: 0.58,
  /** 平日の試合、開幕戦、ダービーの観客の倍率 */
  weekdayFactor: 0.8,
  openingFactor: 1.1,
  derbyFactor: 1.25,
  /** 試合の運営費：1試合の固定分と、観客1人あたり */
  matchdayFixed: 1000e4,
  matchdayPerSpectator: 350,
  /** グッズ：試合の日の観客1人あたり、ファン1人あたり（1か月）、仕入れの割合、人気選手1人あたりの増え方 */
  merchPerSpectator: 600,
  merchPerFanMonthly: 110,
  merchCostRate: 0.5,
  merchStarBonus: 0.04,
  /** 人気選手とみなす総合力 */
  starOverall: 15,
  /** スポンサー：全部の枠の合計の年額 ＝ 係数 × 評判 ^ 2。地元企業の力（クラブごと）で上下する */
  sponsorScale: 1.0e6,
  /** 成績連動の契約のボーナスがもらえる順位 */
  sponsorBonusPosition: 3,
  /** リーグからの配分（年額）：全クラブ均等の分と、前年の順位に応じた分 */
  broadcastBase: 1.2e8,
  broadcastTop: 7.8e8,
  broadcastCurve: 3,
  /** 賞金（最終順位） */
  prize: [3e8, 1.2e8, 6000e4] as readonly number[],
  /** 運営費を決めるときの、規模ごとの年俸の割合の目安と、残す利益の割合 */
  targetWageRatio: { large: 0.28, medium: 0.27, small: 0.24 } satisfies Record<ClubSize, number>,
  targetMargin: 0.03,
  /** 最初に持っているお金 */
  startingBalance: { large: [15e8, 30e8], medium: [6e8, 15e8], small: [2e8, 6e8] } satisfies Record<ClubSize, [number, number]>,
  /** 借り入れ：上限、年利、期間（月） */
  loanLimit: { large: 30e8, medium: 15e8, small: 7e8 } satisfies Record<ClubSize, number>,
  loanRate: { large: 0.015, medium: 0.02, small: 0.025 } satisfies Record<ClubSize, number>,
  loanTerms: [12, 24, 36] as readonly number[],
  /** お金が足りなくなったときの、緊急の借り入れの上乗せ金利と期間 */
  emergencyExtraRate: 0.015,
  emergencyTerm: 24,
  /** オーナーの予算：手元のお金のうち、余裕の分をこの割合だけ予算に回す。余裕の目安は、月の支出のこの月数 */
  reserveMonths: 2,
  reserveRelease: 0.3,
  /** 年俸予算の初期値（今の年俸の合計に対する倍率） */
  wageBudgetHeadroom: 1.05,
  /** オーナーに頼むと、手元のお金の余裕のうち、この割合までを1年の予算に足してくれる */
  budgetIncreaseShare: 0.5,
  /** 契約の更新で、年俸予算に収まらないときに、相場から年俸を下げる幅（予算に余裕があっても相場より上げない） */
  renewalFactorRange: [0.8, 1] as [number, number],
  /** 値上げ・値下げによるファンの雰囲気の変化（ホームゲーム1試合ごと） */
  priceMoodUp: 10,
  priceMoodDown: 4,
  /** 評判の変化：期待された順位との差1つあたり、優勝のボーナス、規模の目安に戻る割合 */
  reputationPerRank: 0.4,
  reputationChampion: 3,
  reputationReversion: 0.1,
} as const;

/** 規模ごとの評判の目安（年ごとに少しずつ、ここへ戻る） */
export const REPUTATION_BASE: Record<ClubSize, number> = { large: 80, medium: 63, small: 46 };

/** スポンサーの枠と、スポンサー収入の合計に占める割合 */
export const SPONSOR_SLOTS: Record<SponsorSlot, { label: string; share: number }> = {
  shirt: { label: 'ユニフォームの胸', share: 0.4 },
  back: { label: 'ユニフォームの背中', share: 0.15 },
  sleeve: { label: 'ユニフォームの袖', share: 0.1 },
  shorts: { label: 'パンツ', share: 0.05 },
  stadium: { label: 'スタジアムの命名権', share: 0.1 },
  partners: { label: 'オフィシャルパートナー（数十社をまとめて）', share: 0.2 },
};

export const SPONSOR_SLOT_ORDER: readonly SponsorSlot[] = ['shirt', 'back', 'sleeve', 'shorts', 'stadium', 'partners'];

/** 契約の種類。factor は相場に対する年額、bonus は3位以内に入った年に別にもらえる額（年額に対する割合） */
export const SPONSOR_DEALS: Record<SponsorDealKind, { label: string; description: string; years: number; factor: number; bonus: number }> = {
  long: { label: '長期の安定契約', description: '3年。年額は相場より少し低いが、評判が下がっても3年間は変わらない', years: 3, factor: 0.95, bonus: 0 },
  standard: { label: '標準の契約', description: '2年。相場どおりの年額', years: 2, factor: 1, bonus: 0 },
  short: { label: '1年の高額契約', description: '1年。年額は高いが、来年また結び直す', years: 1, factor: 1.08, bonus: 0 },
  performance: { label: '成績連動の契約', description: '2年。年額は低いが、3位以内に入った年は年額の4割を上乗せ', years: 2, factor: 0.85, bonus: 0.4 },
};

export const SPONSOR_PREFIXES = [
  '東和', '大洋', '日進', '光明', '北辰', '共栄', '三協', '富士見', '青葉', '昭栄', '明星', '旭', '丸和', '新星', '瑞穂', '常盤',
] as const;

export const SPONSOR_SUFFIXES = ['電機', '銀行', 'ホールディングス', '製薬', '自動車', '食品', 'ガス', '鉄道', '建設', '通信', '住宅', '保険'] as const;
