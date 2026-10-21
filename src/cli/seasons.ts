// 何シーズンも続けて回して、進行の数値（ケガ、疲労、成長と衰え、引退と新人）が釣り合っているかを確かめる。
//   npm run seasons                       … 1つの世界で3シーズン
//   npm run seasons -- --years=8          … シーズン数を変える
//   npm run seasons -- --worlds=4 --quiet … 違うシードの世界をいくつも回して、最後に比べる（--quiet で途中の表示を省く）

import { simulateMatch } from '../engine/match';
import { overallRating } from '../engine/ratings';
import type { MatchResult } from '../engine/types';
import { advanceDay, todaysFixture } from '../game/progress';
import { applyMatchday, isSeasonOver, prepareMatchday } from '../game/season';
import { autoSelect } from '../game/selection';
import { standingsOf } from '../game/standings';
import { answerRequest } from '../game/talks';
import type { GameState, PlayerRecord } from '../game/types';
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

interface WorldSummary {
  seed: number;
  goals: number[];
  champions: string[];
  championPoints: number[];
  start: { age: number; strength: number };
  end: { age: number; strength: number };
}

function runWorld(seed: number): WorldSummary {
const world = createWorld(seed);
const myId = Object.keys(world.clubs)[0] as string;
const state: GameState = startNewGame(world, 'テスト', myId);
const summary: WorldSummary = { seed, goals: [], champions: [], championPoints: [], start: snapshot(state, `世界${seed} 開始時`), end: { age: 0, strength: 0 } };
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

  while (!isSeasonOver(state)) {
    while (!todaysFixture(state)) {
      advanceDay(state);
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
  summary.end = snapshot(state, `  ${state.season.year}年の開幕前`);
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
  }
  console.log(`  全体のゴール ${avg(summaries.flatMap((w) => w.goals)).toFixed(2)}（目標 2.6〜2.9）`);
}
console.log(`\n1シーズンの計算時間 ${((performance.now() - started) / (years * worlds) / 1000).toFixed(1)}秒`);
