// 監督のキャリアの数字（要件定義書「新しいゲームの始め方」「難易度」「解任と転職」、フェーズ3-C）

import type { Difficulty, GameState, ManagerBackground, OwnerStrictness, SeasonVerdict } from './types';

export interface BackgroundProfile {
  label: string;
  /** 最初の監督の評判 */
  reputation: number;
  perk: string;
  /** 声かけ・面談・チームミーティングで、モラルが上がるときの倍率 */
  talk: number;
  /** 練習でのケガの倍率 */
  trainingInjury: number;
  /** 戦術の熟成の速さの倍率 */
  familiarity: number;
  /** 練習での成長の倍率 */
  growth: number;
  /** 評判が上がるときの倍率 */
  reputationGain: number;
}

const neutral = { talk: 1, trainingInjury: 1, familiarity: 1, growth: 1, reputationGain: 1 };

export const BACKGROUNDS: Record<ManagerBackground, BackgroundProfile> = {
  national: { ...neutral, label: '元日本代表', reputation: 70, perk: '声かけ・面談・チームミーティングの効果が2割大きい', talk: 1.2 },
  pro: { ...neutral, label: '元プロ選手', reputation: 55, perk: '声かけ・面談・チームミーティングの効果が1割大きい。練習でのケガが1割少ない', talk: 1.1, trainingInjury: 0.9 },
  coach: { ...neutral, label: '指導者の経験あり', reputation: 45, perk: '戦術の熟成が15%早い。練習での成長が5%大きい', familiarity: 1.15, growth: 1.05 },
  none: { ...neutral, label: '経験なし', reputation: 30, perk: '評判の上がり方が3割大きい（伸びしろ）', reputationGain: 1.3 },
};

export const BACKGROUND_ORDER: ManagerBackground[] = ['national', 'pro', 'coach', 'none'];

export interface DifficultyProfile {
  label: string;
  description: string;
  strictness: OwnerStrictness;
  /** 最初の年の予算の倍率 */
  budget: number;
  /** AIクラブの移籍の賢さ（フェーズ4で使う） */
  aiTransfers: 'low' | 'normal' | 'high';
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  easy: { label: 'やさしい', description: 'オーナーが寛容（解任されにくい）。最初の年の予算が1割多い', strictness: 'lenient', budget: 1.1, aiTransfers: 'low' },
  normal: { label: 'ふつう', description: 'オーナーの厳しさも予算もふつう', strictness: 'normal', budget: 1, aiTransfers: 'normal' },
  hard: { label: 'むずかしい', description: 'オーナーが厳しい（解任されやすい）。最初の年の予算が1割少ない', strictness: 'strict', budget: 0.9, aiTransfers: 'high' },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];

export const CAREER = {
  /** シーズンの評価による評判の変化 */
  verdictReputation: { exceeded: 6, met: 3, near: 0, missed: -3, farMissed: -6 } satisfies Record<SeasonVerdict, number>,
  championBonus: 6,
  dismissalPenalty: -5,
  resignPenalty: -2,
  /** 無職の間、毎月下がる評判 */
  unemployedMonthly: -0.5,
  /** クラブの評判が監督の評判よりこれだけ高いと、オーナーの最初の信頼度が下がり始める */
  trustGap: 15,
  minStartTrust: 40,
  /** 監督の評判＋この値までの評判のクラブから、オファーが届く */
  reach: 10,
  /** 在任中のオファーは、今のクラブより評判がこれだけ高いクラブから */
  stepUp: 5,
  offerDays: 14,
  applicationDays: [3, 7] as [number, number],
  /** 無職がこの日数続いてオファーがなければ、評判の低いクラブから話が来る */
  fallbackDays: 90,
  /** 監督が空いてから、新しい監督が決まるまでの日数 */
  vacancyDays: [14, 21] as [number, number],
  /** 解任したクラブには、この日数のあいだ戻れない */
  noReturnDays: 730,
  /** AIクラブの監督の解任 */
  aiSack: {
    /** シーズン中：この節より後、目標の順位よりこれだけ下で、降格圏にいると、毎月この確率で */
    fromRound: 10, behind: 6, zone: 16, chance: 0.35,
    /** シーズンの終わり：目標よりこれだけ下だと、この確率で */
    seasonBehind: 5, seasonChance: 0.7,
    /** 就任してこの日数は解任しない */
    graceDays: 90,
  },
};

/** 経歴による得意（今の監督の） */
export const backgroundOf = (state: GameState): BackgroundProfile => BACKGROUNDS[state.manager?.background ?? 'coach'];

/** 声かけ・面談・ミーティングでモラルが上がるときは、経歴の得意の分だけ大きくする */
export const talkGain = (state: GameState, delta: number): number => (delta > 0 ? delta * backgroundOf(state).talk : delta);
