// 監督のキャリア（フェーズ3-C）。要件定義書「解任と転職」に対応する。
//
// 監督の評判（1〜100）：シーズンの評価（1月1日）と優勝で上下し、解任や辞任で下がる。無職の間は少しずつ下がる
// AIクラブの監督：成績が悪いと解任され（シーズン中は毎月1日、シーズンの終わりは12月12日）、2〜3週間で次の監督が決まる
// オファー：監督が空いたクラブのうち、評判が届くところから届く。在任中は12月だけで、受けると1月1日に移る
// 無職：日を進めながら、空いたクラブに応募したり、オファーを待ったりする。長く続くと、評判の低いクラブから話が来る

import { GIVEN_NAMES, SURNAMES } from '../data/names';
import { createRng, type Rng } from '../engine/rng';
import { BACKGROUNDS, backgroundOf, CAREER, DIFFICULTIES } from './careerBalance';
import { addDays, daySeed, monthDay, yearOf } from './dates';
import { addMessage } from './inbox';
import { goalLabel, initialOwner, isDismissed, positionGoalFor, startOwner, verdictLabel } from './owner';
import { OWNER } from './ownerBalance';
import { LEAGUE_RULES } from './rules';
import { autoSelect } from './selection';
import { standingsOf } from './standings';
import type { CareerStint, Club, Difficulty, GameState, JobOffer, ManagerBackground, ManagerState, StintEnd } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const NEWS = 'リーグの知らせ';
/** 画面からの操作（オファーを受ける、応募、辞任）で使う乱数 */
const dayRng = (state: GameState, salt: string): Rng => createRng(daySeed(state.seed, state.date, salt));

export const isUnemployed = (state: GameState): boolean => state.manager.clubId === '';

export function reputationLabel(reputation: number): string {
  if (reputation >= 85) return '世界に知られている';
  if (reputation >= 70) return '全国に知られている';
  if (reputation >= 55) return 'リーグで知られている';
  if (reputation >= 40) return '少し知られている';
  return 'まだ無名';
}

/** 新しいゲームの監督 */
export function newManager(name: string, club: Club, background: ManagerBackground, difficulty: Difficulty, date: string): ManagerState {
  const reputation = BACKGROUNDS[background].reputation;
  return {
    name, clubId: club.id, background, difficulty, reputation,
    reputationHistory: [{ date, value: reputation }],
    career: [{ clubId: club.id, clubName: club.name, from: date, to: null, end: null, seasons: [] }],
    offers: [], applications: [], unemployedSince: null, pendingMove: null, lastOfferDate: null, nextOfferNumber: 1,
  };
}

/** オーナーの最初の信頼度。クラブの評判が監督の評判より高すぎると、低くなる */
export function startTrustFor(clubReputation: number, managerReputation: number): number {
  const gap = clubReputation - managerReputation - CAREER.trustGap;
  return clamp(OWNER.startTrust - Math.max(0, gap), CAREER.minStartTrust, OWNER.startTrust);
}

const currentStint = (state: GameState): CareerStint | undefined => {
  const last = state.manager.career.at(-1);
  return last && last.to === null ? last : undefined;
};

function setReputation(state: GameState, value: number): void {
  const m = state.manager;
  m.reputation = round1(clamp(value, 1, 100));
  m.reputationHistory.push({ date: state.date, value: m.reputation });
  if (m.reputationHistory.length > 200) m.reputationHistory.shift();
}

/** 評判を上下させる。上がるときは経歴の得意（伸びしろ）の分だけ大きい */
function changeReputation(state: GameState, delta: number): void {
  if (delta === 0) return;
  setReputation(state, state.manager.reputation + (delta > 0 ? delta * backgroundOf(state).reputationGain : delta));
}

// ---- AIクラブの監督 ----

function aiManagerName(rng: Rng): string {
  return `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`;
}

function hireAiManager(state: GameState, club: Club, rng: Rng): void {
  club.vacancy = null;
  club.managerName = aiManagerName(rng);
  club.managerReputation = clamp(club.reputation + rng.int(-12, 5), 20, 90);
  club.managerSince = state.date;
  club.selection = null;
  addMessage(state, {
    category: 'league', from: NEWS, important: false,
    subject: `${club.name}の新しい監督に${club.managerName}氏`,
    body: `${club.name}は、${club.managerName}氏が新しい監督に就任したと発表しました。`,
  });
}

/** 監督を空ける（代理の監督が率いる）。fillOn に新しい監督が決まる */
function openVacancy(state: GameState, club: Club, rng: Rng, why: string): void {
  const before = club.managerName;
  club.vacancy = { since: state.date, fillOn: addDays(state.date, rng.int(...CAREER.vacancyDays)) };
  club.managerName = `${rng.pick(SURNAMES)}（代理）`;
  club.selection = null;
  if (why !== '') {
    addMessage(state, {
      category: 'league', from: NEWS, important: false,
      subject: `${club.name}が${before}監督を解任`,
      body: `${club.name}は、${why}${before}監督を解任しました。次の監督が決まるまでは、コーチが代理で指揮をとります。`,
    });
  }
}

/** 成績の悪いAIクラブの監督を解任する（シーズン中は毎月、終わりは12月12日） */
function aiSackings(state: GameState, rng: Rng, seasonEnd: boolean): Club[] {
  const s = CAREER.aiSack;
  const sacked: Club[] = [];
  for (const row of standingsOf(state)) {
    const club = state.clubs[row.clubId];
    if (!club || club.id === state.manager.clubId || club.vacancy || state.manager.pendingMove?.clubId === club.id) continue;
    if (daysBetween(club.managerSince, state.date) < s.graceDays) continue;
    const behind = row.position - positionGoalFor(state, club.id);
    const bad = seasonEnd ? behind >= s.seasonBehind : behind >= s.behind && row.position >= s.zone;
    if (bad && rng.chance(seasonEnd ? s.seasonChance : s.chance)) {
      openVacancy(state, club, rng, seasonEnd ? `シーズンを${row.position}位で終えた責任を取らせ、` : `${row.position}位と低迷していることから、`);
      sacked.push(club);
    }
  }
  return sacked;
}

// ---- オファーと応募 ----

/** そのクラブが、監督に声をかけてくれるか（評判が届き、最近やめたクラブではない） */
function reachable(state: GameState, club: Club): boolean {
  const m = state.manager;
  if (club.id === m.clubId || club.reputation > m.reputation + CAREER.reach) return false;
  return !m.career.some((c) => c.clubId === club.id && c.to !== null && c.end !== 'moved' && daysBetween(c.to, state.date) < CAREER.noReturnDays);
}

function makeOffer(state: GameState, club: Club, start: JobOffer['start'], applied: boolean): JobOffer {
  const m = state.manager;
  const offer: JobOffer = {
    id: `o${m.nextOfferNumber++}`, clubId: club.id, date: state.date, expires: addDays(state.date, CAREER.offerDays), start, applied,
  };
  m.offers.push(offer);
  m.lastOfferDate = state.date;
  // 返事を待つ間は、そのクラブは次の監督を決めない
  if (club.vacancy && club.vacancy.fillOn < offer.expires) club.vacancy.fillOn = addDays(offer.expires, 1);
  const goal = goalLabel(positionGoalFor(state, club.id));
  const when = start === 'now' ? '明日からでも、指揮をとっていただきたい。' : '来シーズン（1月1日）から、指揮をとっていただきたい。';
  const lines = [
    `${m.name}さん、はじめまして。${club.name}のオーナーです。`,
    applied ? '応募していただき、ありがとうございます。話し合った結果、ぜひお願いしたいと考えています。' : 'あなたの仕事ぶりは、よく存じ上げています。',
    `${club.name}の監督を、引き受けていただけませんか。${when}`,
    `クラブとしては、まず${goal}を目指してほしいと考えています。`,
    `返事は${CAREER.offerDays}日以内にお願いします。`,
  ];
  addMessage(state, {
    category: 'club', from: `${club.name}のオーナー`, important: true, topic: 'jobOffer', action: { kind: 'jobOffer', offerId: offer.id },
    subject: `${club.name}から監督のオファー`,
    lines,
    body: [
      ...lines,
      '',
      `クラブの評判：${club.reputation}　規模：${club.size === 'large' ? '大' : club.size === 'medium' ? '中' : '小'}　スタジアム：${club.stadium.capacity.toLocaleString('ja-JP')}人`,
      start === 'nextSeason' ? '受けると、今シーズンが終わったあと（1月1日）に移ります。' : '受けると、次の日からこのクラブの監督になります。',
    ].join('\n'),
  });
  return offer;
}

/** 監督が空いたクラブが、声をかけるかどうか */
function considerOffer(state: GameState, club: Club, rng: Rng): void {
  const m = state.manager;
  if (!reachable(state, club) || m.offers.some((o) => o.clubId === club.id)) return;
  if (isUnemployed(state)) {
    const chance = clamp(0.35 + (m.reputation + CAREER.reach - club.reputation) / 40, 0.2, 0.85);
    if (rng.chance(chance)) makeOffer(state, club, 'now', false);
    return;
  }
  // 在任中は、今より格上のクラブからだけ。シーズンの終わり（12月）に
  const mine = state.clubs[m.clubId];
  if (mine && club.reputation >= mine.reputation + CAREER.stepUp && !m.pendingMove && rng.chance(0.6)) makeOffer(state, club, 'nextSeason', false);
}

function resolveOfferMessage(state: GameState, offerId: string): void {
  for (const msg of state.inbox) if (msg.action?.kind === 'jobOffer' && msg.action.offerId === offerId) msg.resolved = true;
}

/** オファーを受ける。無職ならすぐ就任し、在任中なら1月1日に移る */
export function acceptOffer(state: GameState, offerId: string): boolean {
  const m = state.manager;
  const offer = m.offers.find((o) => o.id === offerId);
  const club = offer ? state.clubs[offer.clubId] : undefined;
  if (!offer || !club || offer.expires < state.date) return false;
  m.offers = m.offers.filter((o) => o.id !== offerId);
  resolveOfferMessage(state, offerId);
  if (offer.start === 'now' && isUnemployed(state)) {
    takeOver(state, club, 'now', dayRng(state, `offer-${offerId}`));
    return true;
  }
  m.pendingMove = { clubId: club.id, date: state.date };
  // ほかのオファーは断ったことにする
  for (const o of m.offers) resolveOfferMessage(state, o.id);
  m.offers = [];
  addMessage(state, {
    category: 'club', from: `${club.name}のオーナー`, important: false,
    subject: `来シーズンから${club.name}の監督に`,
    body: `${club.name}のオファーを受けました。今シーズンが終わったあと（1月1日）から、${club.name}の監督になります。\nそれまでは、今のクラブで最後まで指揮をとってください。`,
  });
  return true;
}

export function declineOffer(state: GameState, offerId: string): void {
  const m = state.manager;
  const offer = m.offers.find((o) => o.id === offerId);
  if (!offer) return;
  m.offers = m.offers.filter((o) => o.id !== offerId);
  resolveOfferMessage(state, offerId);
  const club = state.clubs[offer.clubId];
  // 断られたクラブは、すぐに別の監督を探し始める
  if (club?.vacancy) club.vacancy.fillOn = addDays(state.date, 3);
}

/** 監督が空いているクラブ（自分のクラブと、移ることが決まったクラブを除く） */
export function vacancies(state: GameState): Club[] {
  return Object.values(state.clubs).filter((c) => c.vacancy && c.id !== state.manager.clubId && c.id !== state.manager.pendingMove?.clubId)
    .sort((a, b) => b.reputation - a.reputation);
}

/** 応募できるか（無職のときだけ。返事は数日後に届く） */
export function canApply(state: GameState, clubId: string): { ok: boolean; reason?: string } {
  const club = state.clubs[clubId];
  const m = state.manager;
  if (!club?.vacancy) return { ok: false, reason: '監督は空いていません' };
  if (!isUnemployed(state)) return { ok: false, reason: '応募できるのは、無職のときだけです' };
  if (m.applications.some((a) => a.clubId === clubId)) return { ok: false, reason: '応募して、返事を待っています' };
  if (m.offers.some((o) => o.clubId === clubId)) return { ok: false, reason: 'もうオファーが届いています' };
  if (m.career.some((c) => c.clubId === clubId && c.to !== null && c.end !== 'moved' && daysBetween(c.to, state.date) < CAREER.noReturnDays)) {
    return { ok: false, reason: '最近までいたクラブには、まだ戻れません' };
  }
  return { ok: true };
}

export function applyFor(state: GameState, clubId: string): boolean {
  if (!canApply(state, clubId).ok) return false;
  const club = state.clubs[clubId] as Club;
  const rng = dayRng(state, `apply-${clubId}`);
  const answerOn = addDays(state.date, rng.int(...CAREER.applicationDays));
  state.manager.applications.push({ clubId, date: state.date, answerOn });
  if (club.vacancy && club.vacancy.fillOn <= answerOn) club.vacancy.fillOn = addDays(answerOn, 1);
  addMessage(state, {
    category: 'club', from: `${club.name}のオーナー`, important: false,
    subject: `${club.name}に応募しました`,
    body: `${club.name}の監督に応募しました。数日のうちに返事が届きます。`,
  });
  return true;
}

/** 応募への返事 */
function answerApplications(state: GameState, rng: Rng): void {
  const m = state.manager;
  const due = m.applications.filter((a) => a.answerOn <= state.date);
  m.applications = m.applications.filter((a) => a.answerOn > state.date);
  for (const a of due) {
    const club = state.clubs[a.clubId];
    if (!club) continue;
    const gap = m.reputation + CAREER.reach - club.reputation;
    const yes = club.vacancy !== null && isUnemployed(state) && gap > -10 && rng.chance(clamp(0.5 + gap / 30, 0.1, 0.95));
    if (yes) {
      makeOffer(state, club, 'now', true);
    } else {
      addMessage(state, {
        category: 'club', from: `${club.name}のオーナー`, important: false,
        subject: `${club.name}からの返事`,
        body: club.vacancy === null
          ? `応募ありがとうございました。残念ながら、すでに新しい監督が決まりました。`
          : `応募ありがとうございました。話し合った結果、今回は別の方にお願いすることにしました。\n（監督の評判が上がると、評判の高いクラブにも選ばれやすくなります）`,
      });
    }
  }
}

/** 無職が長く続いたら、評判の低いクラブから話が来る */
function fallbackOffer(state: GameState, rng: Rng): void {
  const m = state.manager;
  if (!m.unemployedSince || m.offers.length > 0 || m.applications.length > 0) return;
  if (daysBetween(m.unemployedSince, state.date) < CAREER.fallbackDays) return;
  if (m.lastOfferDate && daysBetween(m.lastOfferDate, state.date) < 30) return;
  const table = standingsOf(state);
  const candidates = Object.values(state.clubs)
    .filter((c) => !m.career.some((s) => s.clubId === c.id && s.to !== null && s.end !== 'moved' && daysBetween(s.to, state.date) < CAREER.noReturnDays))
    .sort((a, b) => a.reputation - b.reputation);
  const club = candidates.find((c) => c.vacancy) ?? candidates[0];
  if (!club) return;
  if (!club.vacancy) {
    const row = table.find((r) => r.clubId === club.id);
    openVacancy(state, club, rng, row && row.played > 0 ? `${row.position}位と結果が出ないことから、` : 'チームを立て直すため、');
  }
  makeOffer(state, club, 'now', false);
}

// ---- クラブを移る、やめる ----

/** 今のシーズンの途中の成績を、経歴に残す */
function recordPartialSeason(state: GameState, stint: CareerStint): void {
  const row = standingsOf(state).find((r) => r.clubId === stint.clubId);
  if (!row || row.played === 0 || stint.seasons.some((s) => s.year === state.season.year)) return;
  stint.seasons.push({ year: state.season.year, position: row.position, goal: state.owner?.goals.position ?? null, verdict: null, partial: true });
}

/** 無職になる（解任か辞任） */
function becomeUnemployed(state: GameState, end: Extract<StintEnd, 'dismissed' | 'resigned'>, rng: Rng): void {
  const m = state.manager;
  const club = state.clubs[m.clubId];
  const stint = currentStint(state);
  if (stint) {
    recordPartialSeason(state, stint);
    stint.to = state.date;
    stint.end = end;
  }
  changeReputation(state, end === 'dismissed' ? CAREER.dismissalPenalty : CAREER.resignPenalty);
  if (club) openVacancy(state, club, rng, '');
  m.clubId = '';
  m.unemployedSince = state.date;
  m.pendingMove = null;
  for (const o of m.offers) resolveOfferMessage(state, o.id);
  m.offers = [];
  // 選手との約束や申し出は、前のクラブのもの
  state.requests = [];
  state.promises = [];
  state.fanMood = 50;
  state.lastTeamMeeting = null;
  addMessage(state, {
    category: 'club', from: 'あなたの代理人', important: false,
    subject: end === 'dismissed' ? '次のクラブを探しましょう' : '辞任しました。次のクラブを探しましょう',
    body: [
      `${club?.name ?? 'クラブ'}を${end === 'dismissed' ? '離れることになりました' : '辞めました'}。監督の評判は${Math.round(m.reputation)}（${reputationLabel(m.reputation)}）です。`,
      '日を進めながら、監督が空いたクラブに応募したり、オファーを待ったりしましょう。',
      '監督の画面で、空いているクラブと届いているオファーが見られます。',
    ].join('\n'),
  });
  // すでに監督が空いているクラブからも、声がかかることがある
  for (const c of vacancies(state)) considerOffer(state, c, rng);
}

/** 自分から辞める（評判が少し下がる） */
export function resign(state: GameState): boolean {
  if (isUnemployed(state)) return false;
  const rng = dayRng(state, 'resign');
  const club = state.clubs[state.manager.clubId];
  addMessage(state, {
    category: 'club', from: 'オーナー', important: false,
    subject: '監督を辞任しました',
    body: `${club?.name ?? 'クラブ'}の監督を辞任しました。これまでありがとうございました。`,
  });
  becomeUnemployed(state, 'resigned', rng);
  return true;
}

/** クラブの監督になる。now：今日から（オーナーの話もすぐ）、nextSeason：1月1日（オーナーの話は新しい年度の予算と一緒に） */
function takeOver(state: GameState, club: Club, when: 'now' | 'nextSeason', rng: Rng): void {
  const m = state.manager;
  const previous = state.clubs[m.clubId];
  const stint = currentStint(state);
  if (previous && stint) {
    stint.to = state.date;
    stint.end = 'moved';
  }
  // 前のクラブには、すぐに次の監督が来る（移ることは前から決まっていた）
  if (previous) hireAiManager(state, previous, rng);
  club.vacancy = null;
  club.managerName = m.name;
  club.managerSince = state.date;
  club.selection = autoSelect(state, club.id, club.tactics.formation);
  m.clubId = club.id;
  m.career.push({ clubId: club.id, clubName: club.name, from: state.date, to: null, end: null, seasons: [] });
  m.unemployedSince = null;
  m.pendingMove = null;
  for (const o of m.offers) resolveOfferMessage(state, o.id);
  m.offers = [];
  m.applications = [];
  state.requests = [];
  state.promises = [];
  state.fanMood = 50;
  state.lastTeamMeeting = null;
  const strictness = DIFFICULTIES[m.difficulty].strictness;
  const trust = startTrustFor(club.reputation, m.reputation);
  if (when === 'now') startOwner(state, strictness, trust);
  else state.owner = initialOwner(state, strictness, trust);
  addMessage(state, {
    category: 'club', from: `${club.name}のオーナー`, important: false,
    subject: `${club.name}の監督に就任しました`,
    body: `${m.name}監督、${club.name}へようこそ。${previous ? `${previous.name}での経験を、ここでも生かしてください。` : ''}\n`
      + '選手の顔ぶれと戦術を確かめて、チームをまとめてください。',
  });
  addMessage(state, {
    category: 'league', from: NEWS, important: false,
    subject: `${club.name}の新しい監督に${m.name}氏`,
    body: `${club.name}は、${m.name}氏が新しい監督に就任したと発表しました。`,
  });
}

// ---- シーズンの終わり ----

/** 1月1日：終わったシーズンを経歴に残し、評判を変える。AIの監督の評判も変える */
function closeCareerSeason(state: GameState, year: number): void {
  const m = state.manager;
  const stint = currentStint(state);
  const evaluation = state.owner?.evaluations.find((e) => e.year === year);
  const champion = state.history.find((h) => h.year === year)?.championId;
  if (stint && evaluation && !stint.seasons.some((s) => s.year === year)) {
    stint.seasons.push({ year, position: evaluation.position, goal: evaluation.goal, verdict: evaluation.verdict });
    const club = state.clubs[stint.clubId];
    // 評判の高いクラブでの結果ほど大きく効く
    const weight = club ? 1 + clamp((club.reputation - m.reputation) / 50, -0.3, 0.3) : 1;
    const delta = CAREER.verdictReputation[evaluation.verdict] * weight + (champion === stint.clubId ? CAREER.championBonus : 0);
    changeReputation(state, delta);
    addMessage(state, {
      category: 'club', from: 'あなたの代理人', important: false,
      subject: `監督の評判：${Math.round(m.reputation)}（${reputationLabel(m.reputation)}）`,
      body: `${year}年の結果（${evaluation.position}位、${verdictLabel(evaluation.verdict)}${champion === stint.clubId ? '、優勝' : ''}）で、監督の評判が${delta >= 0 ? '上がりました' : '下がりました'}。`
        + '\n評判が上がると、評判の高いクラブからオファーが届きやすくなります。',
    });
  }
  const last = state.history.find((h) => h.year === year);
  for (const club of Object.values(state.clubs)) {
    if (club.id === m.clubId || club.vacancy) continue;
    const row = last?.table.find((r) => r.clubId === club.id);
    if (row) club.managerReputation = round1(clamp(club.managerReputation + clamp((positionGoalFor(state, club.id) - row.position) * 0.5, -5, 5), 1, 100));
  }
}

// ---- 日付が変わったとき ----

/** advanceDay が、シーズンの出来事の後、新しい年度の予算の前に呼ぶ */
export function careerEvents(state: GameState, rng: Rng): void {
  const m = state.manager;
  // 解任されたら無職になる
  if (!isUnemployed(state) && isDismissed(state) && !m.pendingMove) becomeUnemployed(state, 'dismissed', rng);

  // 期限が過ぎたオファー
  for (const o of m.offers.filter((x) => x.expires < state.date)) {
    resolveOfferMessage(state, o.id);
    const club = state.clubs[o.clubId];
    if (club?.vacancy) club.vacancy.fillOn = addDays(state.date, 2);
  }
  m.offers = m.offers.filter((o) => o.expires >= state.date);
  answerApplications(state, rng);

  const day = monthDay(state.date);
  if (day === '01-01') {
    closeCareerSeason(state, yearOf(state.date) - 1);
    const move = m.pendingMove;
    const target = move ? state.clubs[move.clubId] : undefined;
    if (target) takeOver(state, target, 'nextSeason', rng);
  }
  // 新しい監督が決まる
  for (const club of Object.values(state.clubs)) {
    if (!club.vacancy || club.vacancy.fillOn > state.date || club.id === m.pendingMove?.clubId) continue;
    if (m.offers.some((o) => o.clubId === club.id) || m.applications.some((a) => a.clubId === club.id)) continue;
    hireAiManager(state, club, rng);
  }
  // AIクラブの監督の解任
  let sacked: Club[] = [];
  const playing = state.season.round <= LEAGUE_RULES.rounds;
  if (state.date.endsWith('-01') && playing && state.season.round > CAREER.aiSack.fromRound) sacked = aiSackings(state, rng, false);
  if (day === '12-12' && !playing && yearOf(state.date) === state.season.year) sacked = aiSackings(state, rng, true);
  for (const club of sacked) {
    // 在任中のオファーは、シーズンの終わりだけ
    if (isUnemployed(state) || !playing) considerOffer(state, club, rng);
  }
  if (isUnemployed(state)) {
    if (state.date.endsWith('-01')) changeReputation(state, CAREER.unemployedMonthly);
    fallbackOffer(state, rng);
  }
}
