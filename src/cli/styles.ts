// 戦い方どうしの相性を確かめる（要件定義書「画面の作り直し（1.1）」の「戦い方」）。
// 同じ力のチームに、それぞれの戦い方（指示、合うフォーメーション、合う役割）を持たせて総当たりで回し、
// 勝ち点の期待値（勝ち3・分け1）を表にする。どれかが全部に勝つ、どれかが全部に負ける、にならないかを見る。
//   npm run styles              … 組み合わせごとに200試合（ホームとアウェイを入れ替えて半分ずつ）
//   npm run styles -- --n=400

import { generateTeam } from '../data/generate';
import { simulateMatch } from '../engine/match';
import { createRng } from '../engine/rng';
import type { Team } from '../engine/types';
import { STYLES, styleRoles, type PlayStyle } from '../game/styles';
import { numberArg, padDisplay, readArgs } from './args';

const args = readArgs(process.argv.slice(2));
const n = numberArg(args, 'n', 200);

const teamFor = (style: PlayStyle, id: string): Team => {
  const formation = style.formations[0] ?? '4-4-2';
  // 同じ種から作るので、同じフォーメーションなら同じ選手になる
  const team = generateTeam(createRng(77), { id, name: style.name, level: 12, formation });
  const roles = styleRoles(style, formation, { ...team.tactics, formation });
  return { ...team, id, tactics: { ...team.tactics, formation, instructions: style.instructions, roles } };
};

const points: number[][] = STYLES.map(() => STYLES.map(() => 0));
for (let i = 0; i < STYLES.length; i++) {
  for (let j = 0; j < STYLES.length; j++) {
    if (i === j) continue;
    const a = teamFor(STYLES[i]!, 'a');
    const b = teamFor(STYLES[j]!, 'b');
    let total = 0;
    for (let k = 0; k < n; k++) {
      const home = k % 2 === 0;
      const r = simulateMatch(home ? a : b, home ? b : a, { seed: 9000 + k * 13 + i * 101 + j * 7, detailedCommentary: false });
      const mine = home ? r.score[0] : r.score[1];
      const theirs = home ? r.score[1] : r.score[0];
      total += mine > theirs ? 3 : mine === theirs ? 1 : 0;
    }
    points[i]![j] = total / n;
  }
}

console.log(`■ 戦い方どうしの勝ち点の期待値（行の戦い方から見て。1試合あたり、${n}試合ずつ）`);
console.log(padDisplay('', 24) + STYLES.map((s) => padDisplay(s.name.slice(0, 5), 8, 'right')).join(''));
STYLES.forEach((s, i) => {
  const row = points[i]!;
  const avg = row.reduce((x, y) => x + y, 0) / (STYLES.length - 1);
  console.log(padDisplay(s.name, 24) + row.map((v, j) => padDisplay(i === j ? '-' : v.toFixed(2), 8, 'right')).join('') + `   平均 ${avg.toFixed(2)}`);
});
