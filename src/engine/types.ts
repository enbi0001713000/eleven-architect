// ゲーム全体で使うデータの形。要件定義書「選手データ」「戦術と観戦」の章に対応する。

export type Position = 'GK' | 'CB' | 'SB' | 'DM' | 'CM' | 'AM' | 'WM' | 'W' | 'FW';

/** 能力値（23項目）。画面では1〜20に丸めて表示し、内部では小数で持つ。 */
export interface Attributes {
  // 技術
  shooting: number;
  passing: number;
  dribbling: number;
  crossing: number;
  firstTouch: number;
  tackling: number;
  heading: number;
  // メンタル
  decisions: number;
  vision: number;
  positioning: number;
  offTheBall: number;
  concentration: number;
  workRate: number;
  composure: number;
  // フィジカル
  pace: number;
  acceleration: number;
  stamina: number;
  strength: number;
  jumping: number;
  // GK
  reflexes: number;
  handling: number;
  oneOnOne: number;
  rushingOut: number;
}

export type AttributeKey = keyof Attributes;

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'shooting', 'passing', 'dribbling', 'crossing', 'firstTouch', 'tackling', 'heading',
  'decisions', 'vision', 'positioning', 'offTheBall', 'concentration', 'workRate', 'composure',
  'pace', 'acceleration', 'stamina', 'strength', 'jumping',
  'reflexes', 'handling', 'oneOnOne', 'rushingOut',
];

/** 隠れ能力（9項目、1〜20）。フェーズ0の試合エンジンが使うのは安定感だけ。 */
export interface HiddenAttributes {
  potential: number;
  professionalism: number;
  ambition: number;
  loyalty: number;
  consistency: number;
  bigMatch: number;
  injuryProneness: number;
  pressure: number;
  temperament: number;
}

export interface Player {
  id: string;
  name: string;
  age: number;
  nationality: string;
  foot: 'left' | 'right' | 'both';
  position: Position;
  attributes: Attributes;
  hidden: HiddenAttributes;
}

export type FormationName = '4-4-2' | '4-3-3' | '4-2-3-1';

/** チーム指示。どれも -2（弱い・低い・短い）〜 +2（強い・高い・長い）。 */
export interface TeamInstructions {
  /** 攻撃と守備のバランス（守備的〜攻撃的） */
  mentality: number;
  /** 守備ラインの高さ */
  defensiveLine: number;
  /** プレスの強さ */
  pressing: number;
  /** 攻撃の幅 */
  width: number;
  /** パスの長さ */
  passingLength: number;
  /** 攻めのテンポ */
  tempo: number;
}

export interface Tactics {
  formation: FormationName;
  instructions: TeamInstructions;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  /** 先発11人の選手ID。フォーメーションの枠の順に並べる（先頭はGK）。 */
  lineup: string[];
  tactics: Tactics;
}

export interface PlayerMatchStats {
  rating: number;
  passes: number;
  passesCompleted: number;
  keyPasses: number;
  dribbles: number;
  dribblesWon: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  assists: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  saves: number;
}

export interface TeamStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  possessionSeconds: number;
  passes: number;
  passesCompleted: number;
  tackles: number;
  interceptions: number;
  /** 相手陣内でボールを奪った回数 */
  highRecoveries: number;
  fouls: number;
  corners: number;
  offsides: number;
  yellowCards: number;
  redCards: number;
  /** 試合終了時の、ピッチにいる選手のスタミナの平均（0〜100） */
  staminaAtEnd: number;
}

export type Side = 0 | 1;

export type MatchEventType =
  | 'kickoff' | 'halftime' | 'fulltime'
  | 'goal' | 'penaltyGoal' | 'shotSaved' | 'shotOff' | 'shotBlocked'
  | 'penalty' | 'penaltyMissed' | 'corner' | 'freeKick'
  | 'foul' | 'yellowCard' | 'redCard' | 'offside'
  | 'buildUp';

export interface MatchEvent {
  /** 試合開始からの秒数（後半は45分=2700秒から数える） */
  clock: number;
  /** 表示用の時間（例：「23'」「45+2'」） */
  minute: string;
  side: Side | null;
  type: MatchEventType;
  /** 1 = 細かい流れ、2 = チャンスやカード、3 = ゴールや退場 */
  importance: 1 | 2 | 3;
  text: string;
}

export interface MatchPlayerLine {
  side: Side;
  player: Player;
  position: Position;
  stats: PlayerMatchStats;
}

export interface MatchResult {
  seed: number;
  teams: [Team, Team];
  score: [number, number];
  stats: [TeamStats, TeamStats];
  players: MatchPlayerLine[];
  events: MatchEvent[];
}
