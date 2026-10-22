// ファンクラブの数字（要件定義書 フェーズ3.5「ファンクラブ」「ファンクラブのイベント」）。どれも仮の値で、遊びながら調整する。

import type { ClubSize, FanClubRank, FanEventKind, ThanksDayScale } from './types';

export const FAN_CLUB_RANKS: FanClubRank[] = ['regular', 'gold', 'platinum'];

export const RANK_LABEL: Record<FanClubRank, string> = { regular: 'レギュラー', gold: 'ゴールド', platinum: 'プラチナ' };

export const RANK_BENEFITS: Record<FanClubRank, string> = {
  regular: 'チケットの先行販売、会報',
  gold: 'レギュラーの特典、チケットとグッズの10%引き、限定グッズ',
  platinum: 'ゴールドの特典、選手との交流イベントへの招待、良い席の優先',
};

export const EVENT_LABEL: Record<FanEventKind, string> = {
  thanksDay: 'ファン感謝デー', signing: 'サイン会・トークショー', openTraining: '公開練習', community: '地域の活動',
};

export const FAN_CLUB = {
  defaultFee: { regular: 3000, gold: 10000, platinum: 30000 } as Record<FanClubRank, number>,
  feeRange: { regular: [1000, 6000], gold: [5000, 20000], platinum: [15000, 60000] } as Record<FanClubRank, [number, number]>,
  feeStep: { regular: 500, gold: 1000, platinum: 5000 } as Record<FanClubRank, number>,
  /** 初期の会費で、ふつうの成績のときの、ファンの数に対する会員の割合 */
  baseRate: 0.07,
  /** ランクの内訳（初期の会費のとき） */
  split: { regular: 0.75, gold: 0.2, platinum: 0.05 } as Record<FanClubRank, number>,
  /** 会費を上げたときの会員の減りやすさ（会員数は 会費の倍率^-この値 になる） */
  elasticity: { regular: 1.3, gold: 1.1, platinum: 0.9 } as Record<FanClubRank, number>,
  /** ふつうの成績のときに、前の年の会員が更新する割合 */
  renewRate: 0.8,
  /** 会費が入る割合（12月1日、1月1日、2月1日） */
  payments: { '12-01': 0.3, '01-01': 0.4, '02-01': 0.3 } as Record<string, number>,
  /** 会報、限定グッズ、招待にかかる費用（会費に対する割合） */
  costRate: 0.3,
  /** シーズン中の入会：前の月の1試合あたりの勝ち点が1.0を超えた分 × この割合 × ファンの数 */
  inSeasonJoinRate: 0.0012,
  /** 会員の割合が基準（7%）より1ポイント高いと、観客とグッズがこの割合だけ増える */
  attendancePerPoint: 0.015,
  merchPerPoint: 0.015,
  /** ゴールド以上の会員のチケットとグッズの割引 */
  premiumDiscount: 0.1,
  /** ゴールド以上の会員が、ホームゲームに来る割合 */
  premiumAttendance: 0.6,
  /** AIのクラブのファン感謝デーの効果（平均） */
  aiThanksDayBoost: 0.03,
};

export const THANKS_DAY: Record<ThanksDayScale, { label: string; boost: number; mood: number; cost: Record<ClubSize, number> }> = {
  small: { label: '小さく開く', boost: 0.03, mood: 3, cost: { large: 1.5e7, medium: 1e7, small: 6e6 } },
  large: { label: '大きく開く', boost: 0.06, mood: 6, cost: { large: 4e7, medium: 2.5e7, small: 1.5e7 } },
};

export const FAN_EVENTS = {
  signing: { perMonth: 1, joinRate: 0.001, mood: [2, 4] as [number, number], condition: -5, cost: { large: 2e6, medium: 1.5e6, small: 1e6 } as Record<ClubSize, number> },
  openTraining: { perMonth: 2, joinRate: 0.0004, mood: 1.5, trainingFactor: 0.8, cost: { large: 5e5, medium: 4e5, small: 3e5 } as Record<ClubSize, number> },
  community: { perMonth: 1, fanGrowth: [0.002, 0.005] as [number, number], condition: -3, cost: { large: 1e6, medium: 8e5, small: 5e5 } as Record<ClubSize, number> },
};
