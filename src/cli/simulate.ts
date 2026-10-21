// たくさんの試合を回して、結果の分布が要件定義書の目標に入っているかを確かめる。
//   npm run simulate              … 1,000試合
//   npm run simulate -- --n=5000  … 試合数を変える

import { generateTeam, withTactics } from '../data/generate';
import { simulateMatch } from '../engine/match';
import { createRng } from '../engine/rng';
import { averageTeamStats, summarize } from '../engine/summary';
import type { FormationName, MatchResult, Team } from '../engine/types';
import { numberArg, padDisplay, percent, readArgs } from './args';

const args = readArgs(process.argv.slice(2));
const n = numberArg(args, 'n', 1000);

function check(label: string, value: number, lo: number, hi: number, format: (v: number) => string): void {
  const ok = value >= lo && value <= hi;
  console.log(`  ${ok ? 'OK ' : 'NG '} ${padDisplay(label, 26)}${padDisplay(format(value), 10, 'right')}   目標 ${format(lo)}〜${format(hi)}`);
}

// 1. リーグ全体の分布：水準10〜14の18クラブで総当たりに近い組み合わせを回す
const rng = createRng(2026);
const formations: FormationName[] = ['4-4-2', '4-3-3', '4-2-3-1'];
const league: Team[] = Array.from({ length: 18 }, (_, i) =>
  generateTeam(rng, { id: `club${i}`, name: `クラブ${i + 1}`, level: 10 + (4 * (i % 6)) / 5, formation: formations[i % 3] }));

const started = performance.now();
const results: MatchResult[] = [];
for (let i = 0; i < n; i++) {
  const h = i % 18;
  const a = (h + 1 + (Math.floor(i / 18) % 17)) % 18;
  results.push(simulateMatch(league[h]!, league[a]!, { seed: 100000 + i, detailedCommentary: false }));
}
const msPerMatch = (performance.now() - started) / n;
const s = summarize(results);

console.log(`■ リーグ全体（${n}試合）`);
check('1試合の平均ゴール', s.goalsPerMatch, 2.6, 2.9, (v) => v.toFixed(2));
check('ホームの勝率', s.homeWinRate, 0.4, 0.5, percent);
check('引き分けの割合', s.drawRate, 0.2, 0.3, percent);
check('1試合の計算時間（ミリ秒）', msPerMatch, 0, 50, (v) => v.toFixed(1));
console.log('  参考（1チーム1試合あたり）');
console.log(`    シュート ${s.shots.toFixed(1)}（枠内 ${s.shotsOnTarget.toFixed(1)}）  xG ${s.xg.toFixed(2)}  パス ${s.passes.toFixed(0)}（成功率 ${percent(s.passAccuracy)}）`);
console.log(`    ファウル ${s.fouls.toFixed(1)}  イエロー ${s.yellowCards.toFixed(2)}  コーナー ${s.corners.toFixed(1)}  オフサイド ${s.offsides.toFixed(1)}`);
console.log(`    1試合あたり：レッドカード ${s.redCardsPerMatch.toFixed(2)}  PK ${s.penaltiesPerMatch.toFixed(2)}`);

// 2. 力の差：水準14と水準10のチーム
const strongWeak = createRng(77);
const strong = generateTeam(strongWeak, { id: 'strong', name: '強いチーム', level: 14 });
const weak = generateTeam(strongWeak, { id: 'weak', name: '弱いチーム', level: 10 });
const duel = (home: Team, away: Team, count: number, seedBase: number): MatchResult[] =>
  Array.from({ length: count }, (_, i) => simulateMatch(home, away, { seed: seedBase + i, detailedCommentary: false }));
const strongHome = summarize(duel(strong, weak, Math.floor(n / 2), 200000));
const strongAway = summarize(duel(weak, strong, Math.floor(n / 2), 300000));
console.log(`\n■ 力の差（水準14 対 水準10、${Math.floor(n / 2) * 2}試合）`);
console.log(`  強いチームがホーム：勝ち ${percent(strongHome.homeWinRate)}  引き分け ${percent(strongHome.drawRate)}  負け ${percent(strongHome.awayWinRate)}`);
console.log(`  強いチームがアウェイ：勝ち ${percent(strongAway.awayWinRate)}  引き分け ${percent(strongAway.drawRate)}  負け ${percent(strongAway.homeWinRate)}`);

// 3. 戦術：プレスの強さだけを変えて、同じ相手と戦う
const tacticsRng = createRng(3);
const base = generateTeam(tacticsRng, { id: 'press', name: 'プレスを変えるチーム', level: 12 });
const opponent = generateTeam(tacticsRng, { id: 'opp', name: '相手', level: 12 });
console.log(`\n■ プレスの強さを変えた場合（各${n}試合、同じ相手とホームで対戦）`);
console.log(`  ${padDisplay('プレス', 8)}${['勝ち点', '支配率', '敵陣で奪取', 'ファウル', '相手パス成功率', '終了時スタミナ']
  .map((h) => padDisplay(h, 16, 'right')).join('')}`);
for (const pressing of [-2, 0, 2]) {
  const team = withTactics(base, undefined, { pressing });
  const rs = duel(team, opponent, n, 400000);
  const mine = averageTeamStats(rs, 0);
  const theirs = averageTeamStats(rs, 1);
  const points = rs.reduce((p, r) => p + (r.score[0] > r.score[1] ? 3 : r.score[0] === r.score[1] ? 1 : 0), 0) / rs.length;
  const cells = [
    points.toFixed(2), percent(mine.possession), mine.highRecoveries.toFixed(1), mine.fouls.toFixed(1),
    percent(theirs.passesCompleted / theirs.passes), mine.staminaAtEnd.toFixed(0),
  ];
  console.log(`  ${padDisplay(pressing > 0 ? `+${pressing}` : `${pressing}`, 8)}${cells.map((c) => padDisplay(c, 16, 'right')).join('')}`);
}
