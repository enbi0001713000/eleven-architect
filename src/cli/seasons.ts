// 何シーズンも続けて回して、進行の数値（ケガ、疲労、成長と衰え、引退と新人）、クラブのお金、オーナーの評価が釣り合っているかを確かめる。
// 自分のクラブ（最初のクラブ）は自動でメンバーを選ぶ。解任されたら、新しい監督が来たことにして続ける。
//   npm run seasons                       … 1つの世界で3シーズン
//   npm run seasons -- --years=8          … シーズン数を変える
//   npm run seasons -- --worlds=4 --quiet … 違うシードの世界をいくつも回して、最後に比べる（--quiet で途中の表示を省く）

import { simulateMatch } from '../engine/match';
import { overallRating } from '../engine/ratings';
import type { MatchResult } from '../engine/types';
import { debtOf, netResult, payrollOf, totalIncome } from '../game/finance';
import { totalMembers } from '../game/fanClub';
import { goalLabel, initialOwner, isDismissed, verdictLabel } from '../game/owner';
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

function snapshot(s: GameState, label: string): { age: number; strength: number } {
  const players = leaguePlayers(s);
  const strengths = Object.keys(s.clubs).map((id) => clubStrength(s, id));
  const ages = players.map((p) => p.age);
  log(`${label}: 選手${players.length}人  平均年齢 ${avg(ages).toFixed(1)}  上位18人の平均総合力 ${avg(strengths).toFixed(2)}（最高 ${Math.max(...strengths).toFixed(2)} 最低 ${Math.min(...strengths).toFixed(2)}）`);
  return { age: avg(ages), strength: avg(strengths) };
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
  championPoints: number[];
  start: { age: number; strength: number };
  end: { age: number; strength: number };
  deficits: number[];
  ownerFunded: number;
  /** オーナーの評価：シーズンごとの結果、警告の回数、解任（シーズン中、シーズンの評価で） */
  verdicts: string[];
  warnings: number;
  dismissals: { midSeason: number; seasonEnd: number };
  trust: number[];
  /** 規模ごとの手元のお金と借り入れ（最初と最後） */
  money: Record<ClubSize, { start: number; end: number; debt: number; payrollStart: number; payrollEnd: number }>;
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
  seed, goals: [], champions: [], championPoints: [], start: snapshot(state, `世界${seed} 開始時`), end: { age: 0, strength: 0 },
  deficits: [], ownerFunded: 0, verdicts: [], warnings: 0, dismissals: { midSeason: 0, seasonEnd: 0 }, trust: [],
  money: Object.fromEntries(SIZES.map((size) => [size, { start: startMoney[size].balance, end: 0, debt: 0, payrollStart: startMoney[size].payroll, payrollEnd: 0 }])) as WorldSummary['money'],
};
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
    state.owner = initialOwner(state);
  };

  while (!isSeasonOver(state)) {
    while (!todaysFixture(state)) {
      advanceDay(state);
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
    if (isDismissed(state)) replaceManager(state.date.endsWith('-01-01') ? 'seasonEnd' : 'midSeason');
    for (const r of [...state.requests]) answerRequest(state, r.id, 'compete');
    if (state.date.endsWith('-12-31')) {
      retiring = leaguePlayers(state).filter((p) => p.retiring).length;
      leaving = leaguePlayers(state).filter((p) => p.leaving).length;
    }
  }
  const joined = leaguePlayers(state).filter((p) => !idsBefore.has(p.id)).length;
  summary.goals.push(goals / matches);
  summary.champions.push(state.clubs[table[0]?.clubId ?? '']?.name ?? '');
  summary.championPoints.push(table[0]?.points ?? 0);
  log(`\n■ ${seasonYear}年（${startDate}〜）`);
  log(`  ゴール ${(goals / matches).toFixed(2)}  ホーム勝ち ${(homeWins / matches * 100).toFixed(1)}%  引き分け ${(draws / matches * 100).toFixed(1)}%`);
  log(`  優勝 ${state.clubs[table[0]?.clubId ?? '']?.name}（${table[0]?.points}）  最下位 ${table[17]?.points}`);
  log(`  ケガ：1クラブあたり ${(injuries / 18).toFixed(1)}件、平均 ${(injuryDays / Math.max(1, injuries)).toFixed(0)}日。試合の時点で離脱中 平均 ${avg(injuredAtKickoff).toFixed(1)}人`);
  log(`  先発の状態：コンディション ${avg(conditionAtKickoff).toFixed(1)}  疲労 ${avg(fatigueAtKickoff).toFixed(1)}（70以上 ${(fatigueAtKickoff.filter((f) => f >= 70).length / fatigueAtKickoff.length * 100).toFixed(1)}%）`);
  log(`  モラル 平均 ${avg(morale).toFixed(1)}（35未満 ${(morale.filter((m) => m < 35).length / morale.length * 100).toFixed(1)}%）  申し出 ${requests}件`);
  log(`  オフ：引退 ${retiring}人、契約満了で退団 ${leaving}人、新人 ${joined}人 → ${leaguePlayers(state).length}人`);
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
const endMoney = moneyBySize(state);
for (const size of SIZES) {
  summary.money[size].end = endMoney[size].balance;
  summary.money[size].debt = endMoney[size].debt;
  summary.money[size].payrollEnd = endMoney[size].payroll;
}
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
    console.log(`  世界${w.seed}：ゴール ${avg(w.goals).toFixed(2)}（${Math.min(...w.goals).toFixed(2)}〜${Math.max(...w.goals).toFixed(2)}）  優勝 ${counts.size}クラブ（最多${most}回、勝ち点 ${Math.min(...w.championPoints)}〜${Math.max(...w.championPoints)}）`
      + `  平均年齢 ${w.start.age.toFixed(1)}→${w.end.age.toFixed(1)}  強さ ${w.start.strength.toFixed(2)}→${w.end.strength.toFixed(2)}`);
    const verdicts = new Map<string, number>();
    for (const v of w.verdicts) verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
    console.log(`    オーナー：${[...verdicts].map(([v, n]) => `${v === 'dismissed' ? 'シーズン中に解任' : v === 'none' ? '評価なし' : verdictLabel(v as 'met')} ${n}`).join('、')}`
      + `  警告 ${w.warnings}回  解任 シーズン中${w.dismissals.midSeason}・評価で${w.dismissals.seasonEnd}  信頼度（年の初め） ${w.trust.join(' ')}`);
    console.log(`    お金：赤字のクラブ（1年あたり）${avg(w.deficits).toFixed(1)}  オーナーの穴埋め ${w.ownerFunded}回  `
      + SIZES.map((size) => {
        const m = w.money[size];
        return `${SIZE_NAME[size]} 手元${oku(m.start)}→${oku(m.end)}億 借入${oku(m.debt)}億 年俸${oku(m.payrollStart)}→${oku(m.payrollEnd)}億`;
      }).join('  '));
  }
  console.log(`  全体のゴール ${avg(summaries.flatMap((w) => w.goals)).toFixed(2)}（目標 2.6〜2.9）`);
}
console.log(`\n1シーズンの計算時間 ${((performance.now() - started) / (years * worlds) / 1000).toFixed(1)}秒`);
