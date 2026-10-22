// ファンクラブ（要件定義書 フェーズ3.5「ファンクラブ」「ファンクラブのイベント」）。
//
// 1年の流れ
//   11月1日：ファンクラブ担当から、ファン感謝デーの提案が届く（自分のクラブ）
//   12月1日：次の年の入会と更新の受付を始める。成績、ファンの雰囲気、会費の高さで会員数が決まる
//   12月1日、1月1日、2月1日：会費が3回に分けて入る（3割、4割、3割）
//   1月1日：新しい年の会員になる
//   毎月1日：前の月の成績が良ければ、シーズン中にも入会がある
// イベント（サイン会、公開練習、地域の活動）は、クラブ画面から自分で開く。

import { overallRating } from '../engine/ratings';
import { addDays, monthDay, yearOf } from './dates';
import { addMonths, earn, reputationRanks, spend, yenText } from './finance';
import { EVENT_LABEL, FAN_CLUB, FAN_CLUB_RANKS, FAN_EVENTS, RANK_LABEL, THANKS_DAY } from './fanClubBalance';
import { addMessage } from './inbox';
import { standingsOf } from './standings';
import type {
  Club, FanClub, FanClubRank, FanClubRenewal, FanEventKind, FanEventRecord, GameState, PlayerRecord, ThanksDayScale,
} from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const FROM = 'ファンクラブ担当';

export const totalMembers = (members: Record<FanClubRank, number>): number =>
  FAN_CLUB_RANKS.reduce((n, r) => n + members[r], 0);

/** 会員が払う会費の合計 */
export const feeRevenue = (members: Record<FanClubRank, number>, fees: Record<FanClubRank, number>): number =>
  FAN_CLUB_RANKS.reduce((n, r) => n + members[r] * fees[r], 0);

const byRank = (f: (rank: FanClubRank) => number): Record<FanClubRank, number> =>
  Object.fromEntries(FAN_CLUB_RANKS.map((r) => [r, f(r)])) as Record<FanClubRank, number>;

/** 会費を、決められる範囲と刻みに収める */
export function clampFee(rank: FanClubRank, fee: number): number {
  const [lo, hi] = FAN_CLUB.feeRange[rank];
  const step = FAN_CLUB.feeStep[rank];
  return clamp(Math.round(fee / step) * step, lo, hi);
}

/** 会費の高さによる、会員数の倍率（初期の会費で1） */
function priceFactor(rank: FanClubRank, fee: number): number {
  return (fee / FAN_CLUB.defaultFee[rank]) ** -FAN_CLUB.elasticity[rank];
}

/** 成績（期待された順位との差）とファンの雰囲気による倍率 */
export function performanceFactor(state: GameState, club: Club): number {
  const row = standingsOf(state).find((r) => r.clubId === club.id);
  const expected = reputationRanks(state).get(club.id) ?? 9;
  const place = row && row.played >= 5 ? clamp(1 + 0.015 * (expected - row.position), 0.85, 1.2) : 1;
  const mood = club.id === state.manager.clubId ? state.fanMood : 50;
  return place * (0.9 + 0.2 * mood / 100);
}

/** その会費と成績で、入りたい人の数 */
export function targetMembers(club: Club, fees: Record<FanClubRank, number>, perf = 1, boost = 0): Record<FanClubRank, number> {
  return byRank((r) => Math.round(club.fans * FAN_CLUB.baseRate * FAN_CLUB.split[r] * priceFactor(r, fees[r]) * perf * (1 + boost)));
}

/** 中身が空のファンクラブ（クラブを作るときの仮の値。createFanClub で決め直す） */
export function emptyFanClub(): FanClub {
  const fees = { ...FAN_CLUB.defaultFee };
  return { members: byRank(() => 0), activeFees: { ...fees }, fees, renewal: null, thanksDay: null, openTrainingDate: null, history: [], events: [] };
}

/** 新しいゲーム（と古いセーブの変換）のファンクラブ */
export function createFanClub(club: Club): FanClub {
  const fees = { ...FAN_CLUB.defaultFee };
  return {
    members: targetMembers(club, fees),
    activeFees: { ...fees },
    fees,
    renewal: null,
    thanksDay: null,
    openTrainingDate: null,
    history: [],
    events: [],
  };
}

/** 新しいゲームの始まり：今年の会費のうち、1月と2月の分（7割）はもう入っている */
export function bookOpeningFees(club: Club): void {
  const fc = club.fanClub;
  const revenue = feeRevenue(fc.members, fc.activeFees) * (FAN_CLUB.payments['01-01']! + FAN_CLUB.payments['02-01']!);
  earn(club.finance, 'fanClub', revenue);
  spend(club.finance, 'fanClubCost', revenue * FAN_CLUB.costRate);
}

/** 会員を足し、その会費を受け取る（シーズン中の入会とイベントでの入会） */
function addMembers(club: Club, count: number): number {
  if (count <= 0) return 0;
  const fc = club.fanClub;
  // ランクの内訳は、会費の高さで決まる
  const weights = byRank((r) => FAN_CLUB.split[r] * priceFactor(r, fc.activeFees[r]));
  const sum = FAN_CLUB_RANKS.reduce((n, r) => n + weights[r], 0);
  let added = 0;
  for (const r of FAN_CLUB_RANKS) {
    const n = Math.round(count * weights[r] / sum);
    fc.members[r] += n;
    added += n;
    earn(club.finance, 'fanClub', n * fc.activeFees[r]);
    spend(club.finance, 'fanClubCost', n * fc.activeFees[r] * FAN_CLUB.costRate);
  }
  return added;
}

// ---- 入会と更新の期間 ----

/** 12月1日：次の年の会員の見込みを決める */
function openRenewal(state: GameState, club: Club, year: number): FanClubRenewal {
  const fc = club.fanClub;
  const mine = club.id === state.manager.clubId;
  let boost = mine ? 0 : FAN_CLUB.aiThanksDayBoost;
  const plan = mine && fc.thanksDay?.year === year - 1 ? fc.thanksDay.scale : null;
  if (plan) boost += holdThanksDay(state, club, plan);
  const perf = performanceFactor(state, club);
  const members = targetMembers(club, fc.fees, perf, boost);
  const total = totalMembers(members);
  const renewed = Math.min(total, Math.round(totalMembers(fc.members) * clamp(FAN_CLUB.renewRate * perf * (1 + boost), 0.5, 0.95)));
  fc.renewal = { year, members, renewed, joined: total - renewed, fees: { ...fc.fees }, paid: 0 };
  if (mine) {
    addMessage(state, {
      category: 'club', from: FROM, important: false,
      subject: `${year}年のファンクラブの受付を始めました`,
      body: [
        `${year}年の入会と更新の受付を、今日から2月末まで行います。`,
        `会員の見込み：${total.toLocaleString('ja-JP')}人（更新 ${renewed.toLocaleString('ja-JP')}人、新しく入る人 ${(total - renewed).toLocaleString('ja-JP')}人）`,
        FAN_CLUB_RANKS.map((r) => `${RANK_LABEL[r]} ${members[r].toLocaleString('ja-JP')}人`).join('　'),
        `会費の見込み：${yenText(feeRevenue(members, fc.fees))}（12月に3割、1月に4割、2月に3割が入ります）`,
        '今年の成績とファンの雰囲気、会費の高さで、会員の数が決まりました。',
      ].join('\n'),
    });
  }
  return fc.renewal;
}

/** 会費の入金（12月1日、1月1日、2月1日） */
function collectFees(club: Club, share: number): void {
  const renewal = club.fanClub.renewal;
  if (!renewal || renewal.paid >= 1) return;
  const part = Math.min(share, 1 - renewal.paid);
  const revenue = feeRevenue(renewal.members, renewal.fees) * part;
  earn(club.finance, 'fanClub', revenue);
  spend(club.finance, 'fanClubCost', revenue * FAN_CLUB.costRate);
  renewal.paid += part;
}

/** 1月1日：新しい年の会員になる */
function startMembership(state: GameState, club: Club): void {
  const fc = club.fanClub;
  const renewal = fc.renewal;
  if (!renewal) return;
  fc.members = { ...renewal.members };
  fc.activeFees = { ...renewal.fees };
  if (club.id === state.manager.clubId) {
    addMessage(state, {
      category: 'club', from: FROM, important: false,
      subject: `${renewal.year}年のファンクラブ会員：${totalMembers(fc.members).toLocaleString('ja-JP')}人`,
      body: [
        `${renewal.year}年の会員が決まりました。シーズン中も、勝ちが続くと入会があります。`,
        FAN_CLUB_RANKS.map((r) => `${RANK_LABEL[r]} ${fc.members[r].toLocaleString('ja-JP')}人（年会費 ${fc.activeFees[r].toLocaleString('ja-JP')}円）`).join('\n'),
        `更新した人 ${renewal.renewed.toLocaleString('ja-JP')}人、新しく入った人 ${renewal.joined.toLocaleString('ja-JP')}人`,
      ].join('\n'),
    });
  }
}

/** 毎月1日：前の月の成績が良ければ、シーズン中にも入会がある */
function monthlyJoins(state: GameState, club: Club, month: string): void {
  const played = state.fixtures.filter((f) => f.result && f.date.startsWith(month) && (f.homeId === club.id || f.awayId === club.id));
  if (played.length === 0) return;
  const points = played.reduce((n, f) => {
    const r = f.result!;
    const [mine, theirs] = f.homeId === club.id ? [r.homeGoals, r.awayGoals] : [r.awayGoals, r.homeGoals];
    return n + (mine > theirs ? 3 : mine === theirs ? 1 : 0);
  }, 0);
  const extra = Math.max(0, points / played.length - 1);
  addMembers(club, Math.round(club.fans * FAN_CLUB.inSeasonJoinRate * extra));
}

// ---- ファン感謝デー ----

/** 11月1日：ファン感謝デーの提案（自分のクラブ） */
function proposeThanksDay(state: GameState, club: Club, year: number): void {
  club.fanClub.thanksDay = { year, scale: null };
  const cost = (scale: ThanksDayScale) => yenText(THANKS_DAY[scale].cost[club.size]);
  addMessage(state, {
    category: 'club', from: FROM, important: true, action: { kind: 'fanThanksDay', year }, topic: 'fanThanksDay',
    subject: 'ファン感謝デーのご相談',
    body: [
      `12月の頭に、今年のファン感謝デーを開きたいと考えています。選手全員に出てもらいます。`,
      `小さく開く：費用 ${cost('small')}。更新と入会が少し増え、ファンの雰囲気が上がります。`,
      `大きく開く：費用 ${cost('large')}。更新と入会がもっと増え、雰囲気も大きく上がります。`,
      '開かないこともできます。返事がなければ、今年は開きません。',
    ].join('\n'),
    lines: [
      '監督、ファンクラブの担当です。今年もファン感謝デーの季節になりました。',
      '12月の頭に、選手全員でファンにお礼をする日を作りたいのですが、どうしましょう？',
      `小さく開くなら費用は${cost('small')}、大きく開くなら${cost('large')}です。大きいほど、来年の会員が増えます。`,
    ],
  });
}

/** ファン感謝デーの規模を決める（null で開かない） */
export function decideThanksDay(state: GameState, scale: ThanksDayScale | null): void {
  const fc = state.clubs[state.manager.clubId]?.fanClub;
  if (!fc?.thanksDay) return;
  fc.thanksDay.scale = scale;
  for (const m of state.inbox) if (m.action?.kind === 'fanThanksDay') m.resolved = true;
}

/** 12月1日：ファン感謝デーを開く。更新と入会への上乗せを返す */
function holdThanksDay(state: GameState, club: Club, scale: ThanksDayScale): number {
  const t = THANKS_DAY[scale];
  const cost = t.cost[club.size];
  spend(club.finance, 'fanClubCost', cost);
  state.fanMood = clamp(state.fanMood + t.mood, 0, 100);
  const record: FanEventRecord = { date: state.date, kind: 'thanksDay', playerIds: [], gained: 0, mood: t.mood, cost };
  club.fanClub.events.push(record);
  addMessage(state, {
    category: 'club', from: FROM, important: false,
    subject: `ファン感謝デーを開きました（${scale === 'large' ? '大きく' : '小さく'}）`,
    body: `選手全員でファンにお礼をしました。ファンの雰囲気が上がり、来年の入会と更新が増えそうです。\n費用：${yenText(cost)}`,
  });
  return t.boost;
}

// ---- 自分で開くイベント ----

/** 人気（0〜1.2くらい）：総合力、出場、ゴール */
export function popularity(player: PlayerRecord): number {
  return clamp((overallRating(player) - 10) / 8, 0, 1) * 0.6
    + Math.min(1, player.season.appearances / 15) * 0.25
    + Math.min(1, player.season.goals / 10) * 0.15;
}

/** イベントに呼べる選手（ケガをしていない）。人気の高い順 */
export function eventCandidates(state: GameState): PlayerRecord[] {
  const club = state.clubs[state.manager.clubId];
  if (!club) return [];
  return club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined && p.status.injury === null)
    .sort((a, b) => popularity(b) - popularity(a));
}

const hasMatch = (state: GameState, date: string): boolean => {
  const myId = state.manager.clubId;
  return state.fixtures.some((f) => f.date === date && (f.homeId === myId || f.awayId === myId));
};

function inSeason(state: GameState, date: string): boolean {
  const myId = state.manager.clubId;
  const dates = state.fixtures.filter((f) => f.homeId === myId || f.awayId === myId).map((f) => f.date).sort();
  return dates.length > 0 && date >= (dates[0] ?? '') && date <= (dates.at(-1) ?? '');
}

export type HeldEventKind = Exclude<FanEventKind, 'thanksDay'>;

export interface EventCheck {
  ok: boolean;
  reason?: string;
  /** 次に開ける日（60日先まで探す） */
  nextDate?: string;
}

function checkOn(state: GameState, kind: HeldEventKind, date: string): string | null {
  const fc = state.clubs[state.manager.clubId]?.fanClub;
  if (!fc) return 'クラブがありません';
  const month = date.slice(0, 7);
  const count = fc.events.filter((e) => e.kind === kind && e.date.startsWith(month)).length;
  if (count >= FAN_EVENTS[kind].perMonth) return `${EVENT_LABEL[kind]}は月に${FAN_EVENTS[kind].perMonth}回までです`;
  if (kind === 'openTraining') {
    // 公開するのは次の日の練習。その日が試合の日か前日なら開けない
    const day = addDays(date, 1);
    if (!inSeason(state, day)) return '公開練習はシーズン中だけです';
    if (fc.openTrainingDate !== null) return 'もう公開練習の予定があります';
    if (hasMatch(state, day) || hasMatch(state, addDays(day, 1))) return '明日は試合の日か、試合の前日です';
    return null;
  }
  if (kind === 'signing' && !inSeason(state, date)) return 'サイン会・トークショーはシーズン中だけです';
  if (hasMatch(state, date) || hasMatch(state, addDays(date, 1))) return '今日か明日に試合があります';
  return null;
}

/** 今日そのイベントを開けるか */
export function canHoldEvent(state: GameState, kind: HeldEventKind): EventCheck {
  const reason = checkOn(state, kind, state.date);
  if (!reason) return { ok: true };
  let nextDate: string | undefined;
  for (let i = 1; i <= 60 && !nextDate; i++) {
    const date = addDays(state.date, i);
    if (!checkOn(state, kind, date)) nextDate = date;
  }
  return { ok: false, reason, nextDate };
}

/** イベントの効果の見込み（会話で見せる） */
export function eventPreview(state: GameState, kind: HeldEventKind, players: readonly PlayerRecord[]): { gain: number; mood: number; cost: number } {
  const club = state.clubs[state.manager.clubId] as Club;
  const pop = clamp(players.reduce((n, p) => n + popularity(p), 0) / 1.5, 0, 1);
  if (kind === 'signing') {
    const e = FAN_EVENTS.signing;
    return { gain: Math.round(club.fans * e.joinRate * (0.5 + pop)), mood: e.mood[0] + (e.mood[1] - e.mood[0]) * pop, cost: e.cost[club.size] };
  }
  if (kind === 'openTraining') {
    const e = FAN_EVENTS.openTraining;
    return { gain: Math.round(club.fans * e.joinRate), mood: e.mood, cost: e.cost[club.size] };
  }
  const e = FAN_EVENTS.community;
  return { gain: Math.round(club.fans * (e.fanGrowth[0] + (e.fanGrowth[1] - e.fanGrowth[0]) * pop)), mood: 0, cost: e.cost[club.size] };
}

/** イベントを開く（サイン会と地域の活動は選手を1〜2人選ぶ） */
export function holdEvent(state: GameState, kind: HeldEventKind, playerIds: readonly string[] = []): FanEventRecord | null {
  const club = state.clubs[state.manager.clubId];
  if (!club || !canHoldEvent(state, kind).ok) return null;
  const players = playerIds.slice(0, 2).map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined && p.clubId === club.id);
  if (kind !== 'openTraining' && players.length === 0) return null;
  const preview = eventPreview(state, kind, players);
  spend(club.finance, 'fanClubCost', preview.cost);
  state.fanMood = clamp(state.fanMood + preview.mood, 0, 100);
  let gained = preview.gain;
  const date = kind === 'openTraining' ? addDays(state.date, 1) : state.date;
  if (kind === 'community') {
    club.fans += gained;
  } else {
    gained = addMembers(club, gained);
  }
  const condition = kind === 'signing' ? FAN_EVENTS.signing.condition : kind === 'community' ? FAN_EVENTS.community.condition : 0;
  for (const p of players) p.status.condition = clamp(p.status.condition + condition, 0, 100);
  if (kind === 'openTraining') club.fanClub.openTrainingDate = date;
  const record: FanEventRecord = { date, kind, playerIds: players.map((p) => p.id), gained, mood: Math.round(preview.mood * 10) / 10, cost: preview.cost };
  club.fanClub.events.push(record);
  if (club.fanClub.events.length > 60) club.fanClub.events.shift();
  const names = players.map((p) => p.name).join('、');
  addMessage(state, {
    category: 'club', from: FROM, important: false,
    subject: `${EVENT_LABEL[kind]}を${kind === 'openTraining' ? '明日開きます' : '開きました'}`,
    body: [
      kind === 'openTraining' ? '明日の練習を、ファンクラブの会員に公開します。練習の効果は少し下がります。' : `${names}に出てもらいました。`,
      kind === 'community' ? `ファンの数が約${gained.toLocaleString('ja-JP')}人増えました。` : `ファンクラブに${gained.toLocaleString('ja-JP')}人が入会しました。`,
      preview.mood > 0 ? 'ファンの雰囲気が良くなりました。' : '',
      condition < 0 ? `出た選手は少し疲れました（コンディション${condition}）。` : '',
      `費用：${yenText(preview.cost)}`,
    ].filter((l) => l !== '').join('\n'),
  });
  return record;
}

/** 会費を変える（次の受付期間から使う） */
export function setFee(state: GameState, rank: FanClubRank, fee: number): void {
  const fc = state.clubs[state.manager.clubId]?.fanClub;
  if (fc) fc.fees[rank] = clampFee(rank, fee);
}

/** 今の会費のまま、ふつうの成績で次の期間に入る人の見込み */
export function feePreview(state: GameState, fees: Record<FanClubRank, number>): { members: Record<FanClubRank, number>; revenue: number } {
  const club = state.clubs[state.manager.clubId] as Club;
  const members = targetMembers(club, fees, performanceFactor(state, club));
  return { members, revenue: feeRevenue(members, fees) };
}

// ---- 日付が変わったとき ----

/** advanceDay が、お金の月の締めの後に呼ぶ */
export function fanClubEvents(state: GameState): void {
  const day = monthDay(state.date);
  const year = yearOf(state.date);
  const myId = state.manager.clubId;
  for (const club of Object.values(state.clubs)) {
    const fc = club.fanClub;
    if (fc.openTrainingDate !== null && fc.openTrainingDate < state.date) fc.openTrainingDate = null;
    if (!state.date.endsWith('-01')) continue;
    const previous = addMonths(state.date.slice(0, 7), -1);
    fc.history.push({ month: previous, total: totalMembers(fc.members) });
    if (fc.history.length > 72) fc.history.shift();
    // 受付の期間（12月〜2月）は、シーズン中の入会を数えない
    if (!(day in FAN_CLUB.payments)) monthlyJoins(state, club, previous);
    if (day === '11-01' && club.id === myId) proposeThanksDay(state, club, year);
    if (day === '12-01') openRenewal(state, club, year + 1);
    if (day === '01-01') startMembership(state, club);
    const share = FAN_CLUB.payments[day];
    if (share) collectFees(club, share);
    if (day === '02-01' && fc.renewal?.paid !== undefined && fc.renewal.paid >= 0.999) fc.renewal = null;
  }
}
