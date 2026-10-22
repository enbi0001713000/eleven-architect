// 何シーズンも続けて回して、進行の数値（ケガ、疲労、成長と衰え、引退と新人）、クラブのお金、オーナーの評価が釣り合っているかを確かめる。
// 自分のクラブ（最初のクラブ）は自動でメンバーを選ぶ。解任されたら、新しい監督が来たことにして続ける。
//   npm run seasons                       … 1つの世界で3シーズン
//   npm run seasons -- --years=8          … シーズン数を変える
//   npm run seasons -- --worlds=4 --quiet … 違うシードの世界をいくつも回して、最後に比べる（--quiet で途中の表示を省く）

import { simulateMatch } from '../engine/match';
import { overallRating } from '../engine/ratings';
import type { MatchResult } from '../engine/types';
import { CONTRACT } from '../game/contractBalance';
import { deservedRole, expiringPlayers, isDelegated, marketValue, maxYears, neededSalary, offerContract, type ContractOffer } from '../game/contracts';
import { debtOf, netResult, payrollOf, totalIncome } from '../game/finance';
import { acceptIncoming, OVERSEAS } from '../game/transfers';
import { createRng } from '../engine/rng';
import { totalMembers } from '../game/fanClub';
import { goalLabel, initialOwner, isDismissed, verdictLabel } from '../game/owner';
import { prospectPlayers } from '../game/prospects';
import { advanceDay, todaysFixture } from '../game/progress';
import { applyMatchday, isSeasonOver, prepareMatchday } from '../game/season';
import { autoSelect } from '../game/selection';
import { standingsOf } from '../game/standings';
import { answerRequest } from '../game/talks';
import type { ClubSize, GameState, PlayerRecord, SeasonEvaluation } from '../game/types';
import { createWorld, startNewGame } from '../game/world';
import { numberArg, readArgs } from './args';

const args = readArgs(process.argv.slice(2));
const years = numberArg(args, 'years', 3);
const firstSeed = numberArg(args, 'seed', 7);
const worlds = numberArg(args, 'worlds', 1);
const quiet = args.has('quiet');
const log = (text: string) => {
  if (!quiet) console.log(text);
};

const leaguePlayers = (s: GameState): PlayerRecord[] => Object.values(s.players).filter((p) => p.clubId !== null);
const avg = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/** クラブの上位18人の平均総合力 */
function clubStrength(s: GameState, clubId: string): number {
  const ratings = (s.clubs[clubId]?.playerIds ?? []).map((id) => s.players[id]).filter((p): p is PlayerRecord => !!p)
    .map(overallRating).sort((a, b) => b - a).slice(0, 18);
  return avg(ratings);
}

/** フェーズ4の完成条件の表で見る数字（世界の初めと終わり） */
interface Checks {
  /** 規模ごとの、上位18人の平均総合力 */
  bySize: Record<ClubSize, number>;
  /** 23歳以下と32歳以上の割合 */
  young: number;
  old: number;
  /** GKが2人より少ないクラブ、ポジションの人数が最低を下回るクラブ */
  thinGk: number;
  thinClubs: number;
  /** リーグの年俸の合計、市場価値の平均と最高 */
  payroll: number;
  valueAvg: number;
  valueMax: number;
}

const MIN_AT: Record<string, number> = { GK: 2, CB: 3, SB: 2, DM: 1, CM: 2, AM: 1, WM: 1, W: 2, FW: 2 };

function checks(s: GameState): Checks {
  const players = leaguePlayers(s);
  const bySize = Object.fromEntries(SIZES.map((size) => [size, avg(Object.values(s.clubs).filter((c) => c.size === size).map((c) => clubStrength(s, c.id)))])) as Record<ClubSize, number>;
  let thinGk = 0;
  let thinClubs = 0;
  for (const club of Object.values(s.clubs)) {
    const counts = new Map<string, number>();
    for (const id of club.playerIds) {
      const p = s.players[id];
      if (p) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    }
    if ((counts.get('GK') ?? 0) < 2) thinGk++;
    if (Object.entries(MIN_AT).some(([pos, n]) => (counts.get(pos) ?? 0) < n)) thinClubs++;
  }
  const values = players.map((p) => marketValue(p, s.season.year));
  return {
    bySize, young: players.filter((p) => p.age <= 23).length / players.length, old: players.filter((p) => p.age >= 32).length / players.length,
    thinGk, thinClubs, payroll: Object.keys(s.clubs).reduce((n, id) => n + payrollOf(s, id), 0), valueAvg: avg(values), valueMax: Math.max(...values),
  };
}

function snapshot(s: GameState, label: string): { age: number; strength: number } {
  const players = leaguePlayers(s);
  const strengths = Object.keys(s.clubs).map((id) => clubStrength(s, id));
  const ages = players.map((p) => p.age);
  log(`${label}: 選手${players.length}人  平均年齢 ${avg(ages).toFixed(1)}  上位18人の平均総合力 ${avg(strengths).toFixed(2)}（最高 ${Math.max(...strengths).toFixed(2)} 最低 ${Math.min(...strengths).toFixed(2)}）`);
  return { age: avg(ages), strength: avg(strengths) };
}

/** 自分のクラブの更新の交渉（11月15日）：序列18番目までの選手に、代理人の希望どおりの条件を出す */
function autoRenew(s: GameState): void {
  const myId = s.manager.clubId;
  expiringPlayers(s).forEach((p, rank) => {
    if (p.leaving || isDelegated(s, p) || rank >= 18) return;
    const offer: ContractOffer = {
      salary: 0, role: deservedRole(s, p, myId), years: Math.min(maxYears(p), CONTRACT.preferredYears(p.age)),
      clauseMultiple: CONTRACT.defaultClause, bonus: { appearance: 0, goal: 0 },
    };
    const ask = neededSalary(s, p, myId, 'renewal', offer);
    if (!ask.refuse) offerContract(s, p.id, { ...offer, salary: ask.salary });
  });
}

/** 所属が変わった選手を数える：4月1日（冬の移籍期間のあと）の所属を、前の年と比べる（契約満了、移籍、レンタルを含む） */
interface MoveStats { last: Map<string, string> | null; moves: number[]; unsigned: number[]; squadMin: number; squadMax: number }

function dayHook(s: GameState, stats: MoveStats): void {
  if (s.date.endsWith('-11-15')) autoRenew(s);
  // 海外からの申し込みは受ける（ほかの申し込みは返事をせず、断ったことになる）
  for (const bid of s.bids.filter((b) => b.sellerId === s.manager.clubId && b.buyerId === OVERSEAS && b.status === 'waiting')) {
    acceptIncoming(s, bid.id, createRng(1));
  }
  if (s.date.endsWith('-03-28')) {
    const note = s.inbox.find((m) => m.date === s.date && m.subject === '冬の移籍期間が終わりました');
    stats.unsigned.push(Number(note?.body.match(/(\d+)人/)?.[1] ?? 0));
  }
  if (!s.date.endsWith('-04-01')) return;
  const now = new Map(leaguePlayers(s).map((p) => [p.id, p.clubId as string]));
  if (stats.last) stats.moves.push([...now].filter(([id, club]) => stats.last?.has(id) && stats.last.get(id) !== club).length);
  stats.last = now;
  for (const c of Object.values(s.clubs)) {
    stats.squadMin = Math.min(stats.squadMin, c.playerIds.length);
    stats.squadMax = Math.max(stats.squadMax, c.playerIds.length);
  }
}

const oku = (yen: number): string => (yen / 1e8).toFixed(1);
const SIZES: ClubSize[] = ['large', 'medium', 'small'];
const SIZE_NAME: Record<ClubSize, string> = { large: '大', medium: '中', small: '小' };

/** 締めた年度のお金を、規模ごとにまとめて表示する */
function financeReport(s: GameState, year: number): { deficits: number; ownerFunded: number; minBalance: number } {
  let deficits = 0;
  let ownerFunded = 0;
  let minBalance = Infinity;
  for (const size of SIZES) {
    const clubs = Object.values(s.clubs).filter((c) => c.size === size);
    const years = clubs.map((c) => c.finance.history.find((h) => h.year === year)).filter((h) => h !== undefined);
    if (years.length === 0) continue;
    const mean = (f: (h: (typeof years)[number]) => number) => avg(years.map(f));
    const income = mean((h) => totalIncome(h.ledger));
    const share = (k: keyof (typeof years)[number]['ledger']['income']) => `${Math.round(mean((h) => h.ledger.income[k]) / income * 100)}%`;
    const nets = years.map((h) => netResult(h.ledger));
    deficits += nets.filter((n) => n < 0).length;
    ownerFunded += years.filter((h) => h.ledger.financing.owner > 0).length;
    minBalance = Math.min(minBalance, ...years.map((h) => h.balance));
    log(`  お金（${SIZE_NAME[size]}）：収入 ${oku(income)}億（入場料${share('tickets')} スポンサー${share('sponsor')} グッズ${share('merchandise')} 配分${share('broadcast')} 賞金${share('prize')}）`
      + `  年俸 ${oku(mean((h) => h.ledger.expense.wages))}億  差し引き ${oku(avg(nets))}億（${oku(Math.min(...nets))}〜${oku(Math.max(...nets))}）`
      + `  手元 ${oku(mean((h) => h.balance))}億  借り入れ ${oku(mean((h) => h.debt))}億  観客 ${Math.round(mean((h) => h.averageAttendance ?? 0)).toLocaleString('ja-JP')}人`);
    const members = avg(clubs.map((c) => totalMembers(c.fanClub.members)));
    const fans = avg(clubs.map((c) => c.fans));
    log(`    ファンクラブ（${SIZE_NAME[size]}）：会員 ${Math.round(members).toLocaleString('ja-JP')}人（ファンの${(members / fans * 100).toFixed(1)}%）`
      + `  会費 ${oku(mean((h) => h.ledger.income.fanClub ?? 0))}億（収入の${share('fanClub')}）  運営費 ${oku(mean((h) => h.ledger.expense.fanClubCost ?? 0))}億`);
  }
  log(`  赤字のクラブ ${deficits}  オーナーが穴埋めしたクラブ ${ownerFunded}  手元のお金の最低 ${oku(minBalance)}億`);
  return { deficits, ownerFunded, minBalance };
}

interface WorldSummary {
  seed: number;
  goals: number[];
  champions: string[];
  /** いちばん多く優勝したクラブの説明（規模と、自分のクラブかどうか） */
  topChampion: string;
  championPoints: number[];
  start: { age: number; strength: number };
  end: { age: number; strength: number };
  deficits: number[];
  ownerFunded: number;
  /** オーナーの評価：シーズンごとの結果、警告の回数、解任（シーズン中、シーズンの評価で） */
  verdicts: string[];
  warnings: number;
  dismissals: { midSeason: number; seasonEnd: number };
  /** シーズンごとの、AIクラブの監督の解任（フェーズ3-C） */
  aiSackings: number[];
  trust: number[];
  /** 規模ごとの手元のお金と借り入れ（最初と最後） */
  money: Record<ClubSize, { start: number; end: number; debt: number; payrollStart: number; payrollEnd: number }>;
  /** 所属が変わった選手（フェーズ4-A） */
  contracts: MoveStats;
  /** 移籍（フェーズ4-B）：年ごとの、移籍金での移籍、海外から、海外へ、レンタル、契約満了、移籍金の合計 */
  transfers: { transfer: number; fromAbroad: number; abroad: number; loan: number; free: number; fees: number }[];
  /** 完成条件の表（フェーズ4-C） */
  checksStart: Checks;
  checksEnd: Checks | null;
  top3: string[][];
  bottom3: string[][];
  /** 開始時に21歳以下だった選手の、終わりの総合力と潜在能力 */
  growth: { reached: number; total: number; gains: number[] };
  /** 内定で決まった新人の候補（年ごと） */
  prospectsSigned: number[];
}

function moneyBySize(s: GameState): Record<ClubSize, { balance: number; debt: number; payroll: number }> {
  const out = {} as Record<ClubSize, { balance: number; debt: number; payroll: number }>;
  for (const size of SIZES) {
    const clubs = Object.values(s.clubs).filter((c) => c.size === size);
    out[size] = {
      balance: avg(clubs.map((c) => c.finance.balance)),
      debt: avg(clubs.map((c) => debtOf(c.finance))),
      payroll: avg(clubs.map((c) => payrollOf(s, c.id))),
    };
  }
  return out;
}

function runWorld(seed: number): WorldSummary {
const world = createWorld(seed);
// 世界ごとに、違う規模のクラブを受け持つ
const myId = Object.keys(world.clubs)[(seed * 7) % Object.keys(world.clubs).length] as string;
const state: GameState = startNewGame(world, 'テスト', myId);
const startMoney = moneyBySize(state);
const pastEvaluations: SeasonEvaluation[] = [];
const summary: WorldSummary = {
  seed, goals: [], champions: [], topChampion: '', championPoints: [], start: snapshot(state, `世界${seed} 開始時`), end: { age: 0, strength: 0 },
  deficits: [], ownerFunded: 0, verdicts: [], warnings: 0, dismissals: { midSeason: 0, seasonEnd: 0 }, trust: [], aiSackings: [],
  money: Object.fromEntries(SIZES.map((size) => [size, { start: startMoney[size].balance, end: 0, debt: 0, payrollStart: startMoney[size].payroll, payrollEnd: 0 }])) as WorldSummary['money'],
  contracts: { last: null, moves: [], unsigned: [], squadMin: Infinity, squadMax: 0 },
  transfers: [],
  checksStart: checks(state),
  checksEnd: null,
  top3: [],
  bottom3: [],
  growth: { reached: 0, total: 0, gains: [] },
  prospectsSigned: [],
};
const youngAtStart = new Map(leaguePlayers(state).filter((p) => p.age <= 21).map((p) => [p.id, overallRating(p)]));
for (let year = 0; year < years; year++) {
  let injuries = 0;
  let injuryDays = 0;
  let matches = 0;
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  const fatigueAtKickoff: number[] = [];
  const conditionAtKickoff: number[] = [];
  const morale: number[] = [];
  const injuredAtKickoff: number[] = [];
  const injuryBefore = new Map(Object.values(state.players).map((p) => [p.id, p.injuryHistory.length]));
  let requests = 0;
  const seasonYear = state.season.year;
  const startDate = state.date;
  const trustStart = state.owner.trust;
  const warningsBefore = state.inbox.filter((m) => m.topic === 'ownerWarning').length;
  let dismissedMid = false;
  /** 解任されたら、新しい監督が来たことにして続ける（それまでの評価は残しておく） */
  const replaceManager = (when: 'midSeason' | 'seasonEnd') => {
    summary.dismissals[when]++;
    if (when === 'midSeason') dismissedMid = true;
    log(`  ★ 解任（${when === 'midSeason' ? 'シーズン中' : 'シーズンの評価'}）：${state.date} 信頼度 ${state.owner.trust}`);
    pastEvaluations.push(...state.owner.evaluations);
    // 解任されると無職になる（フェーズ3-C）。ここでは同じクラブに新しい監督が来たことにして、オーナーの評価を見続ける
    const club = state.clubs[myId];
    if (club) {
      club.vacancy = null;
      club.managerName = state.manager.name;
    }
    state.manager.clubId = myId;
    state.manager.unemployedSince = null;
    state.manager.offers = [];
    state.owner = initialOwner(state);
  };

  while (!isSeasonOver(state)) {
    while (!todaysFixture(state)) {
      advanceDay(state);
      dayHook(state, summary.contracts);
      if (isDismissed(state)) replaceManager('midSeason');
      for (const r of [...state.requests]) {
        requests++;
        answerRequest(state, r.id, 'compete');
      }
    }
    const club = state.clubs[myId];
    if (club) club.selection = autoSelect(state, myId, club.tactics.formation);
    const matchday = prepareMatchday(state);
    const results: Record<string, MatchResult> = {};
    for (const m of matchday) {
      for (const team of [m.home, m.away]) {
        for (const id of team.lineup) {
          const r = team.readiness?.[id];
          if (r) {
            fatigueAtKickoff.push(r.fatigue);
            conditionAtKickoff.push(r.condition);
          }
        }
        injuredAtKickoff.push((state.clubs[team.id]?.playerIds ?? []).filter((id) => state.players[id]?.status.injury).length);
      }
      const result = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false, important: m.important });
      results[m.fixture.id] = result;
      matches++;
      goals += result.score[0] + result.score[1];
      if (result.score[0] > result.score[1]) homeWins++;
      else if (result.score[0] === result.score[1]) draws++;
    }
    applyMatchday(state, results);
    for (const p of leaguePlayers(state)) morale.push(p.status.morale);
  }
  for (const p of Object.values(state.players)) {
    const added = p.injuryHistory.length - (injuryBefore.get(p.id) ?? 0);
    if (added > 0 && p.clubId) {
      injuries += added;
      injuryDays += p.injuryHistory.slice(0, added).reduce((n, h) => n + h.days, 0);
    }
  }
  const table = standingsOf(state);
  const idsBefore = new Set(leaguePlayers(state).map((p) => p.id));
  let retiring = 0;
  let leaving = 0;
  // 次のシーズンの開幕の前日まで進める（引退、新しい年、新人）
  while (state.season.year === seasonYear || state.date < `${state.season.year}-02-01`) {
    advanceDay(state);
    dayHook(state, summary.contracts);
    if (isDismissed(state)) replaceManager(state.date.endsWith('-01-01') ? 'seasonEnd' : 'midSeason');
    for (const r of [...state.requests]) answerRequest(state, r.id, 'compete');
    if (state.date.endsWith('-12-31')) {
      retiring = leaguePlayers(state).filter((p) => p.retiring).length;
      leaving = leaguePlayers(state).filter((p) => p.leaving).length;
      summary.prospectsSigned.push(prospectPlayers(state).filter((p) => p.prospect?.signed).length);
    }
  }
  const joined = leaguePlayers(state).filter((p) => !idsBefore.has(p.id)).length;
  summary.goals.push(goals / matches);
  summary.champions.push(table[0]?.clubId ?? '');
  summary.championPoints.push(table[0]?.points ?? 0);
  summary.top3.push(table.slice(0, 3).map((r) => r.clubId));
  summary.bottom3.push(table.slice(-3).map((r) => r.clubId));
  log(`\n■ ${seasonYear}年（${startDate}〜）`);
  log(`  ゴール ${(goals / matches).toFixed(2)}  ホーム勝ち ${(homeWins / matches * 100).toFixed(1)}%  引き分け ${(draws / matches * 100).toFixed(1)}%`);
  log(`  優勝 ${state.clubs[table[0]?.clubId ?? '']?.name}（${table[0]?.points}）  最下位 ${table[17]?.points}`);
  log(`  ケガ：1クラブあたり ${(injuries / 18).toFixed(1)}件、平均 ${(injuryDays / Math.max(1, injuries)).toFixed(0)}日。試合の時点で離脱中 平均 ${avg(injuredAtKickoff).toFixed(1)}人`);
  log(`  先発の状態：コンディション ${avg(conditionAtKickoff).toFixed(1)}  疲労 ${avg(fatigueAtKickoff).toFixed(1)}（70以上 ${(fatigueAtKickoff.filter((f) => f >= 70).length / fatigueAtKickoff.length * 100).toFixed(1)}%）`);
  log(`  モラル 平均 ${avg(morale).toFixed(1)}（35未満 ${(morale.filter((m) => m < 35).length / morale.length * 100).toFixed(1)}%）  申し出 ${requests}件`);
  log(`  オフ：引退 ${retiring}人、契約満了で退団 ${leaving}人、新人 ${joined}人 → ${leaguePlayers(state).length}人`);
  const moves = state.transferHistory.filter((r) => Number(r.date.slice(0, 4)) === seasonYear);
  const t = {
    transfer: moves.filter((r) => r.kind === 'transfer').length, fromAbroad: moves.filter((r) => r.kind === 'fromAbroad').length,
    abroad: moves.filter((r) => r.kind === 'abroad').length, loan: moves.filter((r) => r.kind === 'loan').length,
    free: moves.filter((r) => r.kind === 'free').length, fees: moves.reduce((n, r) => n + r.fee, 0),
  };
  summary.transfers.push(t);
  log(`  移籍：国内 ${t.transfer}件、海外から ${t.fromAbroad}人、海外へ ${t.abroad}人、レンタル ${t.loan}件、契約満了 ${t.free}人、移籍金の合計 ${oku(t.fees)}億`);
  const seasonNews = state.inbox.filter((m) => m.category === 'league' && m.date >= startDate);
  const aiSacked = seasonNews.filter((m) => m.subject.includes('解任')).length;
  const offers = state.inbox.filter((m) => m.topic === 'jobOffer' && m.date >= startDate).length;
  summary.aiSackings.push(aiSacked);
  log(`  監督：AIクラブの解任 ${aiSacked}人、自分へのオファー ${offers}件、評判 ${Math.round(state.manager.reputation)}`);
  const evaluation = [...pastEvaluations, ...state.owner.evaluations].find((e) => e.year === seasonYear);
  const warnings = state.inbox.filter((m) => m.topic === 'ownerWarning').length - warningsBefore;
  summary.warnings += warnings;
  summary.verdicts.push(evaluation ? evaluation.verdict : dismissedMid ? 'dismissed' : 'none');
  summary.trust.push(state.owner.trust);
  log(`  オーナー：${evaluation ? `目標 ${goalLabel(evaluation.goal)} → ${evaluation.position}位（${verdictLabel(evaluation.verdict)}）、財務の目標 ${evaluation.financeMet ? '達成' : '未達'}` : '評価なし（シーズン中に交代）'}`
    + `  信頼度 ${trustStart} → ${state.owner.trust}  警告 ${warnings}回`);
  const money = financeReport(state, seasonYear);
  summary.deficits.push(money.deficits);
  summary.ownerFunded += money.ownerFunded;
  summary.end = snapshot(state, `  ${state.season.year}年の開幕前`);
}
summary.checksEnd = checks(state);
for (const [id, start] of youngAtStart) {
  const p = state.players[id];
  if (!p || !p.clubId) continue;
  summary.growth.total++;
  summary.growth.gains.push(overallRating(p) - start);
  if (overallRating(p) >= p.hidden.potential - 1) summary.growth.reached++;
}
const endMoney = moneyBySize(state);
for (const size of SIZES) {
  summary.money[size].end = endMoney[size].balance;
  summary.money[size].debt = endMoney[size].debt;
  summary.money[size].payrollEnd = endMoney[size].payroll;
}
const wins = new Map<string, number>();
for (const id of summary.champions) wins.set(id, (wins.get(id) ?? 0) + 1);
const [topId] = [...wins].sort((a, b) => b[1] - a[1])[0] ?? [''];
const top = state.clubs[topId];
summary.topChampion = top ? `${top.name}〔${SIZE_NAME[top.size]}${topId === myId ? '・自分のクラブ' : ''}〕` : '';
return summary;
}

const started = performance.now();
const summaries = Array.from({ length: worlds }, (_, i) => runWorld(firstSeed + i));
if (worlds > 1 || quiet) {
  console.log(`\n■ ${worlds}つの世界 × ${years}シーズンのまとめ`);
  for (const w of summaries) {
    const counts = new Map<string, number>();
    for (const c of w.champions) counts.set(c, (counts.get(c) ?? 0) + 1);
    const most = Math.max(...counts.values());
    console.log(`  世界${w.seed}：ゴール ${avg(w.goals).toFixed(2)}（${Math.min(...w.goals).toFixed(2)}〜${Math.max(...w.goals).toFixed(2)}）  優勝 ${counts.size}クラブ（最多${most}回 ${w.topChampion}、勝ち点 ${Math.min(...w.championPoints)}〜${Math.max(...w.championPoints)}）`
      + `  平均年齢 ${w.start.age.toFixed(1)}→${w.end.age.toFixed(1)}  強さ ${w.start.strength.toFixed(2)}→${w.end.strength.toFixed(2)}`);
    const verdicts = new Map<string, number>();
    for (const v of w.verdicts) verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
    console.log(`    オーナー：${[...verdicts].map(([v, n]) => `${v === 'dismissed' ? 'シーズン中に解任' : v === 'none' ? '評価なし' : verdictLabel(v as 'met')} ${n}`).join('、')}`
      + `  警告 ${w.warnings}回  解任 シーズン中${w.dismissals.midSeason}・評価で${w.dismissals.seasonEnd}  信頼度（年の初め） ${w.trust.join(' ')}`);
    console.log(`    AIクラブの監督の解任（シーズンごと）：${w.aiSackings.join(' ')}`);
    const c = w.contracts;
    console.log(`    移籍（年ごと、国内/海外から/海外へ/レンタル/契約満了、移籍金）：${w.transfers.map((t) => `${t.transfer}/${t.fromAbroad}/${t.abroad}/${t.loan}/${t.free} ${oku(t.fees)}億`).join('  ')}`);
    console.log(`    所属が変わった選手（4月1日で比べる）：${c.moves.join(' ') || '—'}  決まらず去った選手：${c.unsigned.join(' ') || '—'}  登録人数 ${c.squadMin}〜${c.squadMax}人`);
    console.log(`    お金：赤字のクラブ（1年あたり）${avg(w.deficits).toFixed(1)}  オーナーの穴埋め ${w.ownerFunded}回  `
      + SIZES.map((size) => {
        const m = w.money[size];
        return `${SIZE_NAME[size]} 手元${oku(m.start)}→${oku(m.end)}億 借入${oku(m.debt)}億 年俸${oku(m.payrollStart)}→${oku(m.payrollEnd)}億`;
      }).join('  '));
  }
  for (const w of summaries) {
    const a = w.checksStart;
    const b = w.checksEnd ?? a;
    const pct = (n: number): string => `${Math.round(n * 100)}%`;
    const gains = [...w.growth.gains].sort((x, y) => x - y);
    console.log(`  世界${w.seed}の完成条件：規模ごとの強さ ${SIZES.map((size) => `${SIZE_NAME[size]}${a.bySize[size].toFixed(2)}→${b.bySize[size].toFixed(2)}`).join(' ')}`
      + `  23歳以下 ${pct(a.young)}→${pct(b.young)} 32歳以上 ${pct(a.old)}→${pct(b.old)}  GKが2人未満 ${b.thinGk}クラブ ポジションが足りない ${b.thinClubs}クラブ`);
    console.log(`    年俸の合計 ${oku(a.payroll)}→${oku(b.payroll)}億  市場価値 平均${oku(a.valueAvg)}→${oku(b.valueAvg)}億 最高${oku(a.valueMax)}→${oku(b.valueMax)}億`
      + `  上位3に入ったクラブ ${new Set(w.top3.flat()).size}  下位3に入ったクラブ ${new Set(w.bottom3.flat()).size}`
      + `  開始時21歳以下の若手 ${w.growth.total}人：潜在能力-1まで伸びた ${pct(w.growth.reached / Math.max(1, w.growth.total))}（伸び ${gains.length ? `${gains[0]!.toFixed(1)}〜${gains[gains.length - 1]!.toFixed(1)}、真ん中 ${gains[Math.floor(gains.length / 2)]!.toFixed(1)}` : '-'}）`
      + `  内定で決まった候補 ${w.prospectsSigned.join(' ')}`);
  }
  console.log(`  全体のゴール ${avg(summaries.flatMap((w) => w.goals)).toFixed(2)}（目標 2.6〜2.9）`);
}
console.log(`\n1シーズンの計算時間 ${((performance.now() - started) / (years * worlds) / 1000).toFixed(1)}秒`);
