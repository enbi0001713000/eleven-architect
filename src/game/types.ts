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
  /** 監督の評判（AIの監督。プレイヤーが監督のときは使わない。フェーズ3-C） */
  managerReputation: number;
  /** 今の監督が就任した日 */
  managerSince: string;
  /** 監督が空いている（代理の監督が率いている）。fillOn に新しい監督が決まる */
  vacancy: { since: string; fillOn: string } | null;
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
  /** ファンクラブ（フェーズ3.5） */
  fanClub: FanClub;
}

// ---- フェーズ3：財務 ----

export type IncomeKind = 'tickets' | 'broadcast' | 'sponsor' | 'merchandise' | 'fanClub' | 'prize' | 'transfers';
export type ExpenseKind = 'wages' | 'operations' | 'matchday' | 'merchandiseCost' | 'fanClubCost' | 'interest' | 'transfers' | 'agentFees';

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

/** 出来高ボーナス（出場1試合ごと、ゴール1点ごとの円。フェーズ4-A） */
export interface ContractBonus {
  appearance: number;
  goal: number;
}

/** 契約。年俸（円）、契約が終わる年、約束した役割、違約金、出来高ボーナス */
export interface Contract {
  salary: number;
  endYear: number;
  role: SquadRole;
  /** 違約金（円）。この額を払えば、他クラブはクラブ間の交渉なしで選手と話せる。null は違約金なし（フェーズ4-A） */
  releaseClause: number | null;
  bonus: ContractBonus | null;
}

export interface PlayerRecord extends Player {
  clubId: string | null;
  squadNumber: number | null;
  contract: Contract | null;
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
  /** 契約満了でクラブを離れる（12月1日に決まる） */
  leaving?: boolean;
  /** 契約満了のあと、1月1日に加入するクラブと契約（12月に仮の契約をした。フェーズ4-A） */
  joining?: { clubId: string; contract: Contract; date: string } | null;
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

export type InboxCategory = 'match' | 'medical' | 'discipline' | 'player' | 'media' | 'training' | 'league' | 'club' | 'finance' | 'transfer';

export type InboxAction =
  | { kind: 'playerRequest'; requestId: string }
  | { kind: 'press'; fixtureId: string }
  | { kind: 'sponsorOffer' }
  | { kind: 'fanThanksDay'; year: number }
  | { kind: 'jobOffer'; offerId: string };

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

/** 会話画面で開く知らせの種類（オーナーの予算と目標、お金が足りない、スポンサーの提案、オーナーの警告、解任） */
export type MessageTopic = 'budget' | 'shortfall' | 'sponsorOffer' | 'ownerWarning' | 'dismissal' | 'fanThanksDay' | 'jobOffer';

// ---- フェーズ3.5：ファンクラブ ----

export type FanClubRank = 'regular' | 'gold' | 'platinum';
export type FanEventKind = 'thanksDay' | 'signing' | 'openTraining' | 'community';
export type ThanksDayScale = 'small' | 'large';

/** 12月1日に決める、次の年の会員の見込み（会費は12月、1月、2月に分けて入る） */
export interface FanClubRenewal {
  year: number;
  members: Record<FanClubRank, number>;
  /** 前の年から更新した人 */
  renewed: number;
  /** 新しく入った人 */
  joined: number;
  /** この期間の年会費 */
  fees: Record<FanClubRank, number>;
  /** 入った会費の割合（0〜1） */
  paid: number;
}

export interface FanEventRecord {
  date: string;
  kind: FanEventKind;
  playerIds: string[];
  /** 入会した人（地域の活動では、増えたファンの数） */
  gained: number;
  mood: number;
  cost: number;
}

export interface FanClub {
  /** 今の会員数 */
  members: Record<FanClubRank, number>;
  /** 今の会員が払った年会費 */
  activeFees: Record<FanClubRank, number>;
  /** 次の入会と更新の期間に使う年会費（11月末まで変えられる） */
  fees: Record<FanClubRank, number>;
  renewal: FanClubRenewal | null;
  /** ファン感謝デーの予定（11月に決める） */
  thanksDay: { year: number; scale: ThanksDayScale | null } | null;
  /** 公開練習をする日 */
  openTrainingDate: string | null;
  /** 月末の会員数 */
  history: { month: string; total: number }[];
  events: FanEventRecord[];
}

// ---- フェーズ4-A：契約 ----

export type AgentStyle = 'calm' | 'normal' | 'tough';

/** 代理人。選手ごとに決まっていて、契約の交渉の相手になる */
export interface Agent {
  id: string;
  name: string;
  style: AgentStyle;
}

/** 自分のクラブが選手（の代理人）と話している様子 */
export interface ContractTalk {
  /** 今の話し合いで提示した回数 */
  rounds: number;
  /** 決裂して、この日まで話せない */
  closedUntil: string | null;
  /** 代理人が最後に返した希望の年俸 */
  lastAsk: number | null;
}

// ---- フェーズ3-C：監督のキャリア ----

export type ManagerBackground = 'national' | 'pro' | 'coach' | 'none';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type StintEnd = 'dismissed' | 'resigned' | 'moved';

/** 1つのクラブで監督をした期間 */
export interface CareerStint {
  clubId: string;
  clubName: string;
  from: string;
  to: string | null;
  end: StintEnd | null;
  /** そのクラブで終えたシーズン（途中で離れたシーズンは partial） */
  seasons: { year: number; position: number; goal: number | null; verdict: SeasonVerdict | null; partial?: boolean }[];
}

export interface JobOffer {
  id: string;
  clubId: string;
  date: string;
  /** この日を過ぎると取り下げられる */
  expires: string;
  /** now：すぐ就任（無職のとき）、nextSeason：1月1日に移る（在任中のとき） */
  start: 'now' | 'nextSeason';
  /** 応募への返事として届いた */
  applied: boolean;
}

export interface ManagerState {
  name: string;
  /** 監督をしているクラブ。'' のときは無職 */
  clubId: string;
  background: ManagerBackground;
  difficulty: Difficulty;
  /** 監督の評判（1〜100） */
  reputation: number;
  reputationHistory: { date: string; value: number }[];
  career: CareerStint[];
  offers: JobOffer[];
  /** 応募したクラブと、返事が来る日 */
  applications: { clubId: string; date: string; answerOn: string }[];
  unemployedSince: string | null;
  /** 在任中に受けたオファー。1月1日に移る */
  pendingMove: { clubId: string; date: string } | null;
  /** 最後にオファーが届いた日（無職が長いときの話に使う） */
  lastOfferDate: string | null;
  nextOfferNumber: number;
}

// ---- フェーズ3-B：オーナーの評価 ----

export type OwnerStrictness = 'lenient' | 'normal' | 'strict';
export type FinanceGoalKind = 'noDeficit' | 'wagesWithinBudget' | 'reduceDebt';

export interface SeasonGoals {
  year: number;
  /** 順位の目標（この順位以内） */
  position: number;
  /** オーナーが最初に示した順位の目標 */
  basePosition: number;
  finance: FinanceGoalKind;
  /** 目標を話し合った（1シーズンに1回まで） */
  negotiated: boolean;
  /** 年の初めの借り入れの残り（借り入れを減らす目標に使う） */
  debtAtStart: number;
}

export type SeasonVerdict = 'exceeded' | 'met' | 'near' | 'missed' | 'farMissed';

export interface SeasonEvaluation {
  year: number;
  goal: number;
  position: number;
  verdict: SeasonVerdict;
  finance: FinanceGoalKind;
  financeMet: boolean;
  trustBefore: number;
  trustAfter: number;
}

export interface OwnerState {
  /** 信頼度（0〜100） */
  trust: number;
  strictness: OwnerStrictness;
  goals: SeasonGoals;
  /** 信頼度の推移（月末と、シーズンの評価のとき） */
  trustHistory: { date: string; trust: number }[];
  /** このシーズンに出した警告の段階（0〜2） */
  warned: number;
  evaluations: SeasonEvaluation[];
  dismissed: { date: string; reason: string } | null;
}

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
  manager: ManagerState;
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
  // ---- フェーズ3-B ----
  owner: OwnerState;
  // ---- フェーズ4-A ----
  agents: Agent[];
  /** 所属のない選手（契約満了で決まらなかった。冬の移籍期間の終わりまで獲れる） */
  freeAgents: string[];
  /** 自分のクラブが話している選手（選手ID → 様子） */
  contractTalks: Record<string, ContractTalk>;
  /** 契約の更新を強化部に任せるか（選手ID → 任せる）。ない選手は、控えと若手なら任せる */
  contractDelegation: Record<string, boolean>;
}
