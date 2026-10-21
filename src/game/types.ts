// ゲーム全体の状態（セーブデータの中身）。要件定義書「リーグと日程」の章に対応する。

import type { AttributeKey, FormationName, MatchEvent, Player, Tactics, TeamInstructions, TeamStats } from '../engine/types';

export type ClubSize = 'large' | 'medium' | 'small';

export interface EmblemSpec {
  shape: 'shield' | 'round' | 'crest' | 'diamond';
  pattern: 'plain' | 'stripes' | 'halves' | 'band' | 'chevron' | 'hoops';
  symbol: 'star' | 'ball' | 'wave' | 'mountain' | 'bird' | 'flame';
  primary: string;
  secondary: string;
  accent: string;
  /** エンブレムに入れる英字（2〜3文字） */
  initials: string;
}

export interface Club {
  id: string;
  name: string;
  /** 順位表などで使う短い名前 */
  shortName: string;
  hometown: string;
  founded: number;
  size: ClubSize;
  /** 選手の能力の水準（1〜20） */
  level: number;
  /** クラブの評判（1〜100） */
  reputation: number;
  stadium: { name: string; capacity: number };
  fans: number;
  /** 年間の売上（円）。最初は規模から決めた目安、2年目からは前年の実績 */
  revenue: number;
  colors: { primary: string; secondary: string };
  emblem: EmblemSpec;
  rivalId: string | null;
  managerName: string;
  playerIds: string[];
  tactics: Tactics;
  /** プレイヤーが選んだ先発と控え。AIのクラブは試合ごとに自動で選ぶので null。 */
  selection: { lineup: string[]; bench: string[] } | null;
  /** 練習の方針と強度（フェーズ2） */
  training: { focus: TrainingFocus; intensity: TrainingIntensity };
  /** 戦術の熟成度（0〜100）。instructionsRef は熟成度が対象にしているチーム指示 */
  familiarity: {
    formations: Partial<Record<FormationName, number>>;
    instructions: number;
    instructionsRef: TeamInstructions;
  };
  /** お金（フェーズ3） */
  finance: ClubFinance;
}

// ---- フェーズ3：財務 ----

export type IncomeKind = 'tickets' | 'broadcast' | 'sponsor' | 'merchandise' | 'prize' | 'transfers';
export type ExpenseKind = 'wages' | 'operations' | 'matchday' | 'merchandiseCost' | 'interest' | 'transfers' | 'agentFees';

/** 収支の集計。income と expense が損益で、financing は借り入れなどお金の出入りだけのもの */
export interface Ledger {
  income: Record<IncomeKind, number>;
  expense: Record<ExpenseKind, number>;
  financing: {
    /** 借りたお金 */
    borrowed: number;
    /** 返した元金 */
    repaid: number;
    /** オーナーが入れたお金 */
    owner: number;
  };
}

/** スタジアムの席の種類 */
export type SeatKind = 'goal' | 'back' | 'main' | 'vip';

/** スポンサーの枠（ユニフォームの胸、背中、袖、パンツ、スタジアムの命名権、オフィシャルパートナー） */
export type SponsorSlot = 'shirt' | 'back' | 'sleeve' | 'shorts' | 'stadium' | 'partners';
/** スポンサー契約の種類（長期、標準、1年の高額、成績連動） */
export type SponsorDealKind = 'long' | 'standard' | 'short' | 'performance';

export interface SponsorDeal {
  slot: SponsorSlot;
  company: string;
  kind: SponsorDealKind;
  /** 年額 */
  annual: number;
  /** この年の12月まで */
  endYear: number;
  /** 成績連動の契約：3位以内に入った年に、別にもらえる額 */
  bonus: number;
  /** 次の年から始まる、もう結んだ契約 */
  next?: SponsorDeal;
}

/** 契約が切れる枠に届いた提案（自分のクラブだけ） */
export interface SponsorOffer {
  id: string;
  slot: SponsorSlot;
  company: string;
  kind: SponsorDealKind;
  annual: number;
  years: number;
  bonus: number;
}

export interface Loan {
  id: string;
  /** 借りた額と、残り */
  amount: number;
  remaining: number;
  /** 年利 */
  rate: number;
  /** 毎月返す元金 */
  monthly: number;
  /** 借りた月と、最後に返す月（'YYYY-MM'） */
  startMonth: string;
  endMonth: string;
  /** お金が足りなくなって、自動で借りたもの */
  emergency: boolean;
}

export interface FinanceMonth {
  /** 'YYYY-MM' */
  month: string;
  ledger: Ledger;
  /** 月末の手元のお金と、借り入れの残り */
  balance: number;
  debt: number;
}

export interface FinanceYear {
  year: number;
  ledger: Ledger;
  balance: number;
  debt: number;
  /** その年のリーグの順位 */
  position: number | null;
  averageAttendance: number | null;
  /** 月末の手元のお金（締めた月の順） */
  balances: { month: string; balance: number }[];
}

export interface Budget {
  year: number;
  /** オーナーが決めた総予算（年俸と移籍に使える額） */
  total: number;
  /** 年俸予算（1年分の年俸の合計の上限） */
  wages: number;
  /** 移籍予算（この年に移籍金に使える額） */
  transfers: number;
  /** 移籍予算のうち使った額（フェーズ4） */
  transfersSpent: number;
  /** オーナーに頼んで、手元のお金から増やしてもらった額 */
  extra: number;
}

export interface ClubFinance {
  /** 手元のお金 */
  balance: number;
  /** 今月の収支（月が変わると months に移る） */
  current: Ledger;
  /** 今年の、締めた月の収支 */
  months: FinanceMonth[];
  /** 過去の年度（1月〜12月）の決算 */
  history: FinanceYear[];
  /** スポンサー契約（枠ごとに1社） */
  sponsors: SponsorDeal[];
  /** 契約が切れる枠への提案（自分のクラブだけ。12月1日に届き、選ぶと消える） */
  sponsorOffers: SponsorOffer[];
  /** 地元企業の力（0.85〜1.15）。スポンサー収入に効く */
  localStrength: number;
  /** 今年のリーグからの配分（年額） */
  broadcast: number;
  /** クラブの運営費（年額）。スタッフ、育成、遠征、事務など、試合と年俸以外の費用 */
  operations: number;
  /** 見込みの収入に対する運営費の割合（クラブごとに、最初に決める） */
  operationsRate: number;
  /** チケットの値段（席の種類ごと） */
  ticketPrices: Record<SeatKind, number>;
  budget: Budget;
  loans: Loan[];
  /** これまでに借りた回数（借り入れの番号に使う） */
  loanCount: number;
}

export type TrainingFocus = 'balanced' | 'physical' | 'technical' | 'tactical' | 'recovery';
export type TrainingIntensity = 'light' | 'normal' | 'hard';

/** 契約で約束した役割 */
export type SquadRole = 'key' | 'rotation' | 'backup' | 'youth';

export type InjuryKind = 'bruise' | 'sprain' | 'strain' | 'backPain' | 'fracture' | 'ligament' | 'acl';

export interface Injury {
  kind: InjuryKind;
  /** 部位（表示用） */
  part: string;
  /** ケガをした日 */
  date: string;
  /** 全治の見込み（日） */
  days: number;
  /** 復帰までの残り日数 */
  daysLeft: number;
}

/** 選手の状態（フェーズ2）。要件定義書「選手データ」の「状態と契約」 */
export interface PlayerStatus {
  /** コンディション（短期の体力、0〜100） */
  condition: number;
  /** 蓄積疲労（0〜100） */
  fatigue: number;
  /** モラル（0〜100、60が普通） */
  morale: number;
  injury: Injury | null;
  /** 復帰してしばらくは、同じ部位を痛めやすい */
  recurrence: { kind: InjuryKind; part: string; daysLeft: number } | null;
  /** 最近の出場の割合（0〜1）。約束した役割と比べて不満が出る */
  playingTime: number;
  /** クラブの戦術への慣れ（0〜100）。新しく入った選手は低い */
  integration: number;
  /** 直近の評価点（新しいものが先頭、最大5試合） */
  recentRatings: number[];
  /** 最近の出場時間（成長の計算に使う。毎週少しずつ減る） */
  recentMinutes: number;
}

export interface CareerSeason {
  year: number;
  clubId: string | null;
  appearances: number;
  goals: number;
  assists: number;
  averageRating: number | null;
}

export interface SeasonStats {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  ratingTotal: number;
  ratingCount: number;
}

export interface PlayerRecord extends Player {
  clubId: string | null;
  squadNumber: number | null;
  /** 年俸（円）、契約が終わる年、約束した役割 */
  contract: { salary: number; endYear: number; role: SquadRole } | null;
  season: SeasonStats;
  status: PlayerStatus;
  /** 個人の練習で重点的に伸ばす能力（なければ null） */
  trainingFocus: AttributeKey | null;
  injuryHistory: { kind: InjuryKind; part: string; date: string; days: number }[];
  /** 過去のシーズンの記録 */
  career: CareerSeason[];
  /** 個人面談をした最後の日 */
  lastTalk: string | null;
  /** シーズン終了時に引退を発表した */
  retiring?: boolean;
  /** 契約満了でクラブを離れる（シーズン終了時に発表） */
  leaving?: boolean;
  /** 引退した（どのクラブにも属さない） */
  retired?: boolean;
  discipline: {
    /** 出場停止につながる警告の累積 */
    yellowAccumulation: number;
    /** 残りの出場停止試合数 */
    suspendedMatches: number;
  };
}

export interface FixtureResult {
  homeGoals: number;
  awayGoals: number;
  /** 重要度2以上の出来事（ゴール、カード、交代など） */
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  /** 出場した選手の評価点 */
  ratings: Record<string, number>;
  /** 先発の選手ID */
  lineups: [string[], string[]];
  /** 観客数（フェーズ3。それより前の試合にはない） */
  attendance?: number;
}

export interface Fixture {
  id: string;
  round: number;
  /** 'YYYY-MM-DD' */
  date: string;
  homeId: string;
  awayId: string;
  result: FixtureResult | null;
}

export type InboxCategory = 'match' | 'medical' | 'discipline' | 'player' | 'media' | 'training' | 'league' | 'club' | 'finance';

export type InboxAction =
  | { kind: 'playerRequest'; requestId: string }
  | { kind: 'press'; fixtureId: string }
  | { kind: 'sponsorOffer' };

/** 受信箱の知らせ（要件定義書「時間の進め方」） */
export interface InboxMessage {
  id: string;
  date: string;
  category: InboxCategory;
  /** 差出人 */
  from: string;
  subject: string;
  body: string;
  read: boolean;
  /** 大事な知らせ。「次の出来事まで進める」はここで止まる */
  important: boolean;
  playerId?: string;
  fixtureId?: string;
  /** 返事が必要な知らせ */
  action?: InboxAction;
  /** 返事をした（または期限が過ぎた） */
  resolved?: boolean;
  /** 会話画面で、差出人が話すセリフ（なければ本文を1行ずつ話す） */
  lines?: string[];
  /** 会話画面で、話のあとに出す返事の種類 */
  topic?: MessageTopic;
}

/** 会話画面で開く知らせの種類（オーナーの予算、お金が足りない、スポンサーの提案） */
export type MessageTopic = 'budget' | 'shortfall' | 'sponsorOffer';

/** 選手からの申し出（フェーズ2は出場機会への不満。契約と移籍の希望はフェーズ4） */
export interface PlayerRequest {
  id: string;
  playerId: string;
  kind: 'playingTime';
  date: string;
}

/** 選手との約束。破るとモラルが大きく下がる */
export interface PlayerPromise {
  id: string;
  playerId: string;
  kind: 'playingTime';
  madeOn: string;
  year: number;
  /** この節までに */
  untilRound: number;
  /** 先発の回数 */
  target: number;
  /** 約束したときの先発の回数 */
  startsAtPromise: number;
}

/** 終わったシーズンの記録 */
export interface SeasonHistory {
  year: number;
  table: { clubId: string; position: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }[];
  championId: string;
  topScorer: { playerId: string; name: string; clubId: string | null; goals: number } | null;
  bestPlayer: { playerId: string; name: string; clubId: string | null; rating: number } | null;
  manager: { clubId: string; position: number };
}

export interface GameState {
  version: number;
  seed: number;
  createdAt: string;
  manager: { name: string; clubId: string };
  season: {
    year: number;
    /** 次に行う節（1〜34）。全節が終わると 35 */
    round: number;
  };
  /** ゲーム内の今日の日付 'YYYY-MM-DD' */
  date: string;
  clubs: Record<string, Club>;
  players: Record<string, PlayerRecord>;
  /** 海外の選手プール（試合はしない。外国籍選手の獲得元。フェーズ4で使う） */
  overseasPool: string[];
  fixtures: Fixture[];
  nextPlayerNumber: number;
  // ---- フェーズ2 ----
  inbox: InboxMessage[];
  nextMessageNumber: number;
  requests: PlayerRequest[];
  promises: PlayerPromise[];
  history: SeasonHistory[];
  /** ファンの雰囲気（0〜100、50が普通） */
  fanMood: number;
  /** 他クラブの監督との関係（-100〜100） */
  managerRelations: Record<string, number>;
  /** 最後にチームミーティングをした日 */
  lastTeamMeeting: string | null;
}
