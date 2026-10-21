// フェーズ2の進行で使う数値（練習、疲労、ケガ、成長、モラル）。調整するときはここを変える。
// 要件定義書「フェーズ2：進行、コンディション、成長」に対応する。

import type { AttributeKey } from '../engine/types';
import type { InjuryKind, SquadRole, TrainingFocus, TrainingIntensity } from './types';

export const PHYSICAL_KEYS: readonly AttributeKey[] = ['pace', 'acceleration', 'stamina', 'strength', 'jumping'];
export const TECHNICAL_KEYS: readonly AttributeKey[] = ['shooting', 'passing', 'dribbling', 'crossing', 'firstTouch', 'tackling', 'heading'];
export const MENTAL_KEYS: readonly AttributeKey[] = ['decisions', 'vision', 'positioning', 'offTheBall', 'concentration', 'workRate', 'composure'];
export const GOALKEEPING_KEYS: readonly AttributeKey[] = ['reflexes', 'handling', 'oneOnOne', 'rushingOut'];

export interface FocusProfile {
  label: string;
  description: string;
  /** 伸びやすい能力（GKはGKの能力も伸びやすい） */
  boosted: readonly AttributeKey[];
  /** 全体の伸び方の倍率 */
  growth: number;
  /** 疲労のたまり方の倍率 */
  load: number;
  /** ケガのしやすさの倍率 */
  injury: number;
  /** 戦術の熟成度の上がり方の倍率 */
  familiarity: number;
  /** コンディションの回復の倍率 */
  recovery: number;
}

export const TRAINING_FOCUS: Record<TrainingFocus, FocusProfile> = {
  balanced: {
    label: 'バランス', description: 'すべてを少しずつ。迷ったらこれ',
    boosted: [], growth: 1, load: 1, injury: 1, familiarity: 1, recovery: 1,
  },
  physical: {
    label: 'フィジカル', description: 'スピード、スタミナ、筋力などが伸びやすい。疲れやすく、ケガも増える',
    boosted: PHYSICAL_KEYS, growth: 1, load: 1.35, injury: 1.3, familiarity: 0.5, recovery: 0.9,
  },
  technical: {
    label: '技術', description: 'シュート、パス、ドリブルなどが伸びやすい（GKはGKの技術）',
    boosted: [...TECHNICAL_KEYS, ...GOALKEEPING_KEYS], growth: 1, load: 1, injury: 1, familiarity: 0.5, recovery: 1,
  },
  tactical: {
    label: '戦術', description: '判断力やポジショニングが伸び、戦術の熟成度が早く上がる。疲れにくい',
    boosted: MENTAL_KEYS, growth: 0.9, load: 0.8, injury: 0.8, familiarity: 2.2, recovery: 1.05,
  },
  recovery: {
    label: '回復', description: '疲れを抜く。ほとんど伸びないが、コンディションが早く戻る',
    boosted: [], growth: 0.3, load: 0.3, injury: 0.4, familiarity: 0.3, recovery: 1.35,
  },
};

export const TRAINING_INTENSITY: Record<TrainingIntensity, { label: string; growth: number; load: number; injury: number; condition: number }> = {
  light: { label: '軽め', growth: 0.7, load: 0.55, injury: 0.6, condition: 0 },
  normal: { label: '普通', growth: 1, load: 1, injury: 1, condition: -1 },
  hard: { label: 'ハード', growth: 1.3, load: 1.55, injury: 1.7, condition: -3 },
};

export const BALANCE = {
  /** 1日の練習でたまる疲労（普通・バランス） */
  trainingLoad: 1.0,
  /** 90分の試合でたまる疲労 */
  matchLoad: 14,
  /** 疲労が1日で抜ける割合（29歳まで）。30歳から1歳ごとに少しずつ抜けにくくなる */
  fatigueDecay: 0.05,
  fatigueDecayPerAgeOver29: 0.003,
  /** コンディションが1日で戻る割合 */
  conditionRecovery: 0.25,
  /** 練習中のケガの、1日あたりの基準の確率 */
  trainingInjury: 0.0011,
  /** 復帰してから再発しやすい期間（日） */
  recurrenceDays: [30, 60] as [number, number],
  recurrenceMultiplier: 2,
  /** 残り日数がこれ以下なら、完治前でも試合に出せる（再発しやすい） */
  playableInjuryDays: 3,
  /** 1週間あたりの能力の伸びの基準（1項目） */
  weeklyGrowth: 0.022,
  /** フィジカルの衰え（30歳から、1歳ごと・1週間あたり） */
  physicalDecline: 0.01,
  /** 技術の衰え（32歳から、1歳ごと・1週間あたり） */
  technicalDecline: 0.005,
  /** 戦術の熟成度：1日の練習での上がり方、試合での上がり方、使わない形の下がり方 */
  familiarityGain: 1.2,
  familiarityMatchGain: 2.5,
  familiarityDecay: 0.15,
  familiarityFloor: 30,
  /** チーム指示を1段階変えるごとに下がる熟成度 */
  instructionChangePenalty: 7,
  /** 新しく入った選手の、戦術への慣れ */
  newcomerIntegration: 30,
  /** モラルが普通（60）に戻る速さ（1日あたり） */
  moraleDrift: 0.02,
  /** 出場の割合の目安（約束した役割ごと） */
  expectedPlayingTime: { key: 0.7, rotation: 0.4, backup: 0.15, youth: 0.1 } satisfies Record<SquadRole, number>,
  /** 個人面談、チームミーティングの間隔（日） */
  talkCooldown: 14,
  meetingCooldown: 21,
  /** 1クラブの人数（新人で埋める） */
  squadTarget: 28,
} as const;

export interface InjuryType {
  label: string;
  parts: readonly string[];
  days: [number, number];
  /** 接触プレー（試合）と練習での起こりやすさ */
  contactWeight: number;
  trainingWeight: number;
}

export const INJURY_TYPES: Record<InjuryKind, InjuryType> = {
  bruise: { label: '打撲', parts: ['太もも', 'すね', '足首', '肩', '腰'], days: [3, 14], contactWeight: 18, trainingWeight: 6 },
  sprain: { label: '捻挫', parts: ['足首', '膝'], days: [10, 42], contactWeight: 20, trainingWeight: 16 },
  strain: { label: '肉離れ', parts: ['太もも裏', '太もも前', 'ふくらはぎ', '内転筋'], days: [18, 56], contactWeight: 14, trainingWeight: 32 },
  backPain: { label: '腰痛', parts: ['腰'], days: [7, 28], contactWeight: 3, trainingWeight: 14 },
  fracture: { label: '骨折', parts: ['足の甲', 'すね', '鎖骨', '肋骨'], days: [42, 100], contactWeight: 5, trainingWeight: 1.5 },
  ligament: { label: '靭帯損傷', parts: ['膝', '足首'], days: [30, 75], contactWeight: 5, trainingWeight: 3 },
  acl: { label: '前十字靭帯断裂', parts: ['膝'], days: [180, 270], contactWeight: 1, trainingWeight: 0.5 },
};
