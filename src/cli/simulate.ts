// たくさんの試合を回して、結果の分布が要件定義書の目標に入っているかを確かめる。
//   npm run simulate              … 1,000試合
//   npm run simulate -- --n=5000  … 試合数を変える

import { generateTeam, withAttributes, withRoles, withTactics } from '../data/generate';
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

// 4. 戦術の相性：同じ相手でも、組み合わせによって結果が変わるか（要件定義書「検証と性能」）
const m = Math.max(300, Math.floor(n / 2));
const pairRng = createRng(4242);
const teamA = generateTeam(pairRng, { id: 'A', name: 'A', level: 12, formation: '4-4-2' });
const teamB = generateTeam(pairRng, { id: 'B', name: 'B', level: 12, formation: '4-3-3' });
interface Line { gf: number; ga: number; win: number; highRecoveries: number }
const play = (home: Team, away: Team, ai: [boolean, boolean] = [true, true]): Line => {
  const line: Line = { gf: 0, ga: 0, win: 0, highRecoveries: 0 };
  for (let i = 0; i < m; i++) {
    const r = simulateMatch(home, away, { seed: 9000 + i, detailedCommentary: false, aiControl: ai });
    line.gf += r.score[0] / m;
    line.ga += r.score[1] / m;
    line.win += (r.score[0] > r.score[1] ? 1 : 0) / m;
    line.highRecoveries += r.stats[0].highRecoveries / m;
  }
  return line;
};
const show = (label: string, l: Line) =>
  console.log(`    ${padDisplay(label, 34)}得点 ${l.gf.toFixed(2)}  失点 ${l.ga.toFixed(2)}  勝率 ${percent(l.win)}`);
console.log(`\n■ 戦術の相性（各${m}試合。Aのチーム指示や役割だけを変えて、同じBと対戦）`);

console.log('  ハイライン × 足の速いFW（背後のスペース）');
const fastB = withRoles(withAttributes(teamB, ['FW', 'W'], { pace: 18, acceleration: 18 }), ['FW'], 'runner');
const slowB = withRoles(withAttributes(teamB, ['FW', 'W'], { pace: 8, acceleration: 8 }), ['FW'], 'runner');
const lines = [-2, 2].map((defensiveLine) => {
  const a = withTactics(teamA, undefined, { defensiveLine });
  const fast = play(a, fastB);
  const slow = play(a, slowB);
  show(`ライン${defensiveLine > 0 ? '高い' : '低い'} 対 速いFW`, fast);
  show(`ライン${defensiveLine > 0 ? '高い' : '低い'} 対 遅いFW`, slow);
  return fast.ga - slow.ga;
});
check('速いFWで増える失点の差（高い−低い）', (lines[1] ?? 0) - (lines[0] ?? 0), 0.15, 10, (v) => v.toFixed(2));

// 相性の差は1組だけだと試合の運に埋もれやすいので、フォーメーションの違う4組の平均で見る
console.log('  ポゼッション × カウンター（4組。Aの勝率：ポゼッション/普通 が、Bを普通→カウンターにするとどう変わるか）');
const possession = { passingLength: -2, tempo: -1, mentality: 1, defensiveLine: 1 } as const;
const counter = { mentality: -1, tempo: 2, passingLength: 1, defensiveLine: -1, pressing: -1 } as const;
const counterPairs: [Team, Team][] = [[teamA, teamB], ...([[11, '4-3-3', '4-4-2'], [77, '4-2-3-1', '4-2-3-1'], [5, '4-4-2', '4-4-2']] as const)
  .map(([seed, fa, fb]): [Team, Team] => {
    const r = createRng(seed);
    return [generateTeam(r, { id: 'A', name: 'A', level: 12, formation: fa }), generateTeam(r, { id: 'B', name: 'B', level: 12, formation: fb })];
  })];
let counterGap = 0;
const nn = play(teamA, teamB);
for (const [a, b] of counterPairs) {
  const possessionA = withTactics(a, undefined, possession);
  const counterB = withTactics(b, undefined, counter);
  const pn = play(possessionA, b);
  const pc = play(possessionA, counterB);
  const base = a === teamA ? nn : play(a, b);
  const nc = play(a, counterB);
  const gap = (pn.win - pc.win) - (base.win - nc.win);
  counterGap += gap / counterPairs.length;
  console.log(`    ${padDisplay(`${a.tactics.formation} 対 ${b.tactics.formation}`, 20)}ポゼッション ${percent(pn.win)} → ${percent(pc.win)}　普通 ${percent(base.win)} → ${percent(nc.win)}　差 ${percent(gap)}`);
}
check('カウンターで下がる勝率の差（ポゼ−普通）', counterGap, 0.01, 1, percent);

console.log('  疲れ（コンディション70%で試合に入る）');
const tiredA: Team = { ...teamA, readiness: Object.fromEntries(teamA.players.map((p) => [p.id, { condition: 70, fatigue: 50, morale: 60, familiarity: 1 }])) };
const tired = play(tiredA, teamB);
show('万全', nn);
show('疲れている', tired);
check('疲れで下がる得失点差', (nn.gf - nn.ga) - (tired.gf - tired.ga), 0.1, 10, (v) => v.toFixed(2));
const noSubs = play(teamA, teamB, [false, true]);
console.log(`    参考：交代も試合中の戦術の変更もしない場合　得点 ${noSubs.gf.toFixed(2)}  失点 ${noSubs.ga.toFixed(2)}  勝率 ${percent(noSubs.win)}`);

console.log('  参考：プレス（敵陣で奪う回数は増えるが、背後が空き、疲れる）');
const press0 = play(teamA, teamB);
const press2 = play(withTactics(teamA, undefined, { pressing: 2 }), teamB);
console.log(`    プレス普通：敵陣で奪取 ${press0.highRecoveries.toFixed(1)}  得点 ${press0.gf.toFixed(2)}  失点 ${press0.ga.toFixed(2)}`);
console.log(`    プレス最大：敵陣で奪取 ${press2.highRecoveries.toFixed(1)}  得点 ${press2.gf.toFixed(2)}  失点 ${press2.ga.toFixed(2)}`);
console.log('  参考：SBの役割（相手はカウンターと縦に突破するウイング）');
const wingersB = withTactics(withRoles(withAttributes(teamB, ['W'], { pace: 16, dribbling: 15 }), ['W'], 'winger'), undefined,
  { mentality: -1, tempo: 2, passingLength: 1, defensiveLine: -1, pressing: -1 });
show('攻撃参加のSB', play(withRoles(teamA, ['SB'], 'attackingFullback'), wingersB));
show('守備重視のSB', play(withRoles(teamA, ['SB'], 'defensiveFullback'), wingersB));
