// 1試合を動かして、実況・スタッツ・評価点を表示する。
//   npm run match                 … シード1で試合
//   npm run match -- --seed=42    … シードを変える
//   npm run match -- --all        … 細かい実況もすべて表示
//   npm run match -- --home-pressing=2 --away-mentality=-1  … チーム指示を変える

import { generateTeam, withTactics } from '../data/generate';
import { simulateMatch } from '../engine/match';
import { createRng } from '../engine/rng';
import type { MatchResult, TeamInstructions } from '../engine/types';
import { numberArg, padDisplay, percent, readArgs } from './args';

const INSTRUCTION_KEYS: readonly (keyof TeamInstructions)[] = [
  'mentality', 'defensiveLine', 'pressing', 'width', 'passingLength', 'tempo',
];

function instructionsFromArgs(args: Map<string, string>, prefix: 'home' | 'away'): Partial<TeamInstructions> {
  const result: Partial<TeamInstructions> = {};
  for (const key of INSTRUCTION_KEYS) {
    const flag = `${prefix}-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (args.has(flag)) result[key] = Math.max(-2, Math.min(2, numberArg(args, flag, 0)));
  }
  return result;
}

function printStats(result: MatchResult): void {
  const [h, a] = result.stats;
  const total = h.possessionSeconds + a.possessionSeconds;
  const rows: [string, string, string][] = [
    ['ボール支配率', percent(h.possessionSeconds / total), percent(a.possessionSeconds / total)],
    ['シュート', `${h.shots}`, `${a.shots}`],
    ['枠内シュート', `${h.shotsOnTarget}`, `${a.shotsOnTarget}`],
    ['xG（ゴール期待値）', h.xg.toFixed(2), a.xg.toFixed(2)],
    ['パス（成功/試行）', `${h.passesCompleted}/${h.passes}`, `${a.passesCompleted}/${a.passes}`],
    ['パス成功率', percent(h.passesCompleted / Math.max(1, h.passes)), percent(a.passesCompleted / Math.max(1, a.passes))],
    ['タックル', `${h.tackles}`, `${a.tackles}`],
    ['パスカット', `${h.interceptions}`, `${a.interceptions}`],
    ['相手陣内での奪取', `${h.highRecoveries}`, `${a.highRecoveries}`],
    ['ファウル', `${h.fouls}`, `${a.fouls}`],
    ['コーナーキック', `${h.corners}`, `${a.corners}`],
    ['オフサイド', `${h.offsides}`, `${a.offsides}`],
    ['イエローカード', `${h.yellowCards}`, `${a.yellowCards}`],
    ['レッドカード', `${h.redCards}`, `${a.redCards}`],
    ['終了時のスタミナ', h.staminaAtEnd.toFixed(0), a.staminaAtEnd.toFixed(0)],
  ];
  console.log(`\n${padDisplay('', 22)}${padDisplay(result.teams[0].name, 18, 'right')}${padDisplay(result.teams[1].name, 18, 'right')}`);
  for (const [label, home, away] of rows) {
    console.log(`${padDisplay(label, 22)}${padDisplay(home, 18, 'right')}${padDisplay(away, 18, 'right')}`);
  }
}

function printRatings(result: MatchResult): void {
  for (const side of [0, 1] as const) {
    console.log(`\n【${result.teams[side].name}】`);
    for (const line of result.players.filter((l) => l.side === side)) {
      const s = line.stats;
      const notes = [
        s.goals ? `${s.goals}ゴール` : '', s.assists ? `${s.assists}アシスト` : '',
        s.saves ? `${s.saves}セーブ` : '', s.yellowCards ? 'イエロー' : '', s.redCards ? '退場' : '',
      ].filter(Boolean).join(' ');
      console.log(`  ${padDisplay(line.position, 4)}${padDisplay(line.player.name, 22)}${s.rating.toFixed(1)}  ${notes}`);
    }
  }
}

const args = readArgs(process.argv.slice(2));
const seed = numberArg(args, 'seed', 1);
const showAll = args.has('all');

// チームは固定のシードで作り、試合のシードだけを変えられるようにする
const teamRng = createRng(2026);
const homeBase = generateTeam(teamRng, { id: 'hokuto', name: '北都FC', level: 12, formation: '4-2-3-1' });
const awayBase = generateTeam(teamRng, { id: 'minatogawa', name: '湊川ユナイテッド', level: 12, formation: '4-4-2' });
const home = withTactics(homeBase, undefined, instructionsFromArgs(args, 'home'));
const away = withTactics(awayBase, undefined, instructionsFromArgs(args, 'away'));

const result = simulateMatch(home, away, { seed });

console.log(`${home.name}（${home.tactics.formation}） vs ${away.name}（${away.tactics.formation}）  シード: ${seed}\n`);
for (const event of result.events) {
  if (!showAll && event.importance < 2) continue;
  const team = event.side === null ? '' : `［${result.teams[event.side].name}］`;
  console.log(`${padDisplay(event.minute, 7, 'right')}  ${team}${event.text}`);
}
console.log(`\n${home.name} ${result.score[0]} - ${result.score[1]} ${away.name}`);
printStats(result);
printRatings(result);
