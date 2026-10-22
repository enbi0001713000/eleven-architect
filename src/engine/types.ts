// ゲーム全体で使うデータの形。要件定義書「選手データ」「戦術と観戦」の章に対応する。

export type Position = 'GK' | 'CB' | 'SB' | 'WB' | 'DM' | 'CM' | 'AM' | 'WM' | 'W' | 'FW';

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

export type FormationName = '4-4-2' | '4-3-3' | '4-2-3-1' | '4-1-4-1' | '3-4-2-1' | '3-5-2';

/** 選手の役割（ポジションごとに選べるものは roles.ts の ROLE_OPTIONS） */
export type Role =
  | 'goalkeeper' | 'sweeperKeeper'
  | 'stopper' | 'coverDefender' | 'ballPlayingDefender'
  | 'defensiveFullback' | 'attackingFullback' | 'invertedFullback' | 'wingBack'
  | 'anchor' | 'volante' | 'playmaker' | 'boxToBox' | 'mezzala'
  | 'advancedPlaymaker' | 'shadowStriker'
  | 'wideMidfielder' | 'winger' | 'insideForward'
  | 'poacher' | 'targetMan' | 'runner' | 'falseNine';

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
  /** フォーメーションの枠ごとの役割。省略した枠はポジションの初期値になる。 */
  roles?: Role[];
  captainId?: string;
  /** セットプレーのキッカー。省略するか、ピッチにいなければ自動で選ぶ。 */
  setPieces?: { penalty?: string; freeKick?: string; corner?: string };
}

/** 試合前の選手の状態（フェーズ2）。省略した選手は万全として扱う。 */
export interface MatchReadiness {
  /** コンディション（短期の体力、0〜100）。試合開始時のスタミナになる */
  condition: number;
  /** 蓄積疲労（0〜100）。高いと能力が下がり、ケガをしやすい */
  fatigue: number;
  /** モラル（0〜100、60が普通） */
  morale: number;
  /** 戦術の熟成度（0〜1）。低いと判断力とポジショニングが下がる */
  familiarity: number;
  /** ケガが完治していないのに出場させている（再発しやすい） */
  carryingInjury?: boolean;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  /** 選手ごとの試合前の状態 */
  readiness?: Record<string, MatchReadiness>;
  /** 先発11人の選手ID。フォーメーションの枠の順に並べる（先頭はGK）。 */
  lineup: string[];
  /** 控えの選手ID（最大9人） */
  bench?: string[];
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
  | 'substitution' | 'tactics' | 'injury' | 'teamTalk'
  | 'buildUp';

/**
 * ピッチ上の位置。ピッチを縦6×横5のマスに分けたときの座標で、マスの中心は 0.5 刻み。
 * x はホームのゴール側が0、アウェイのゴール側が6。y はホームから見て右側が0、左側が5。
 */
export interface PitchPoint {
  x: number;
  y: number;
}

/**
 * 出来事の中身（実況の文章とは別に持つ）。将来、ピッチを上から見た2Dの表示や、試合の分析に使う。
 * どの出来事にどの項目が入るかは、試合エンジンの say() の呼び出しを見る。
 */
export interface MatchEventDetail {
  /** プレーした選手（パスの出し手、シューター、タックルやファウルをした選手、交代で下がる選手など） */
  playerId?: string;
  /** 相手役の選手（パスの受け手、GK、ファウルを受けた選手、交代で入る選手、アシストした選手など） */
  otherId?: string;
  /** ボールがあった位置と、動いた先 */
  from?: PitchPoint;
  to?: PitchPoint;
  /** シュートのxG（決定機の大きさ） */
  xg?: number;
}

export interface MatchEvent extends MatchEventDetail {
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
  role: Role;
  stats: PlayerMatchStats;
  /** 先発したか */
  started: boolean;
  /** 途中出場した分（先発なら null） */
  minuteOn: number | null;
  /** 途中交代した分（最後まで出ていたら null） */
  minuteOff: number | null;
  /** 試合中にケガをした */
  injured: boolean;
  /** 試合終了時（または交代時）のスタミナ */
  staminaEnd: number;
}

export interface MatchResult {
  seed: number;
  teams: [Team, Team];
  score: [number, number];
  stats: [TeamStats, TeamStats];
  players: MatchPlayerLine[];
  events: MatchEvent[];
}
