// アシスタントコーチ（要件定義書「画面の作り直し（1.1）」）：クラブごとに名前と顔があり、画面を開いたときに一言話す。
// 話すのは、今の状態の要点、次にやるとよいこと、仕組みの豆知識、相手や他クラブの噂の4種類。
// 画面ごとに候補を出し、大事なものから1つだけ話す。同じこと（同じ key）は繰り返さない（store が覚える）。

import { GIVEN_NAMES, SURNAMES } from '../data/names';
import { overallRating } from '../engine/ratings';
import { createRng } from '../engine/rng';
import { teamFamiliarity } from '../game/condition';
import { yenText, netResult, yearToDate } from '../game/finance';
import { isUnhappyWithPlayingTime } from '../game/morale';
import { weakSpots } from '../game/needs';
import { instructionDistance } from '../game/progress';
import { offersOpen, prospectPlayers, neededPosition } from '../game/prospects';
import { freeScouts, scoutCount } from '../game/scouting';
import { nextFixtureOf } from '../game/season';
import { standingsOf } from '../game/standings';
import { lineupOf, nearestStyle, recommendStyle, styleFit } from '../game/styles';
import { talkCooldownLeft } from '../game/talks';
import { transferBudgetLeft, windowOpen } from '../game/transfers';
import type { GameState, PlayerRecord } from '../game/types';
import { ATTRIBUTE_LABEL, formatDate, POSITION_NAME } from './format';
import type { Screen } from './store';
import { homeTodos, type TodoKind } from './todos';

export type CoachKind = 'state' | 'next' | 'tip' | 'rumor';

export interface CoachLine {
  key: string;
  kind: CoachKind;
  text: string;
  /** 大きいほど先に話す */
  priority: number;
  action?: { label: string; screen: Screen };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** クラブのアシスタントコーチの名前（クラブと世界ごとに決まる） */
export function coachName(game: GameState, clubId: string): string {
  const rng = createRng(hash(`${game.seed}:${clubId}:coach`) || 1);
  return `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`;
}

/** コーチの一言を出す画面と、その画面の呼び名 */
export const COACH_SCREENS = ['home', 'squad', 'tactics', 'training', 'fixtures', 'league', 'transfers', 'scouting', 'management', 'inbox'] as const;
export type CoachScreen = (typeof COACH_SCREENS)[number];

export function coachScreenOf(name: Screen['name']): CoachScreen | null {
  if (name === 'finance' || name === 'myClub') return 'management';
  return (COACH_SCREENS as readonly string[]).includes(name) ? (name as CoachScreen) : null;
}

/** 仕組みの豆知識（画面ごと）。急ぐことがないときに話す */
const TIPS: Record<CoachScreen, string[]> = {
  home: [
    '「今やること」を上から片付けていけば、大事なことを見落としません。',
    '大事な知らせが届くと、「次の出来事まで進める」はそこで止まります。',
  ],
  squad: [
    '表示を「表」に切り替えると、能力やコンディションを並べて比べられます。',
    '出場機会が約束より少ない選手は、不満をためていきます。ときどき面談しましょう。',
  ],
  tactics: [
    'ゲーゲンプレスやトータルフットボールのように走る戦い方は、疲れやすいので交代を早めに。',
    '「役割を選手に合わせる」を押すと、全員を一番向いている役割にできます。',
    '戦い方を大きく変えると熟成度が下がります。少しずつ変えるのも手です。',
  ],
  training: [
    '試合の前日と翌日は、練習が自動で軽めになります。',
    '個人の重点は、伸ばしたい能力を1つ選ぶと、そこが少し伸びやすくなります。',
  ],
  fixtures: ['節を切り替えると、ほかの試合の結果も見られます。'],
  league: ['クラブ名を押すと、そのクラブの戦い方や選手が見られます。'],
  transfers: [
    '移籍リストに載っている選手は、相手のクラブが安く手放してくれます。',
    '違約金を払えば、相手のクラブは移籍を断れません。',
  ],
  scouting: ['同じ選手を何度か調べると、能力の幅が狭まって、本当の力が分かってきます。'],
  management: [
    'お金は毎月1日に締めます。年俸の合計が予算を超えないように気をつけましょう。',
    '観客が少ないときは、チケットを少し安くすると入りが良くなります。',
  ],
  inbox: ['返事が必要な知らせは「返事待ち」のタブにまとまっています。'],
};

/** 噂：自分の主力に興味を持っている他クラブ。外れることもある（スカウトが多いほど当たりやすい） */
function transferRumor(game: GameState): CoachLine | null {
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  if (!club) return null;
  const week = Math.floor(new Date(`${game.date}T00:00:00Z`).getTime() / (7 * 86400000));
  const rng = createRng(hash(`${game.seed}:rumor:${week}`) || 1);
  const stars = club.playerIds.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined)
    .sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 6);
  const player = stars.length > 0 ? rng.pick(stars) : undefined;
  if (!player) return null;
  const others = Object.keys(game.clubs).filter((id) => id !== myId);
  const interested = others.filter((id) => neededPosition(game, id) === player.position);
  const accuracy = Math.min(0.9, 0.5 + 0.1 * scoutCount(game));
  const truthful = interested.length > 0 && rng.chance(accuracy);
  const clubId = truthful ? rng.pick(interested) : rng.pick(others);
  const name = game.clubs[clubId]?.name;
  if (!name) return null;
  return {
    key: `rumor:${week}`, kind: 'rumor', priority: 30,
    text: `噂ですが、${name}が${player.name}に興味を持っているそうです。本当かどうかは分かりませんが、気にしておきましょう。`,
  };
}

function nextMatchLine(game: GameState): CoachLine | null {
  const myId = game.manager.clubId;
  const next = nextFixtureOf(game, myId);
  if (!next) return null;
  const opponentId = next.homeId === myId ? next.awayId : next.homeId;
  const opponent = game.clubs[opponentId];
  if (!opponent) return null;
  const style = nearestStyle(opponent.tactics.instructions);
  const row = standingsOf(game).find((r) => r.clubId === opponentId);
  return {
    key: `next:${next.id}`, kind: 'state', priority: 50,
    text: `次は${formatDate(next.date, false)}の${opponent.name}戦です。${row && row.played > 0 ? `相手は${row.position}位、` : ''}${style ? `${style.name}で来そうです。` : '独自の戦い方で来そうです。'}`,
  };
}

/** その画面でコーチが話せること（大事な順に並べる） */
export function coachLines(game: GameState, screen: CoachScreen): CoachLine[] {
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  if (!club) return [];
  const lines: CoachLine[] = [];
  const players = club.playerIds.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined);

  switch (screen) {
    case 'home': {
      // 「今やること」と同じ文は繰り返さず、いくつあって、どれから片づけるとよいかだけ話す
      const todos = homeTodos(game);
      const todo = todos[0];
      if (todo) {
        const first: Record<TodoKind, string> = { problem: '試合のメンバーの問題', reply: '返事を待っている話', deadline: '期限が近いこと', advice: 'わたしのおすすめ' };
        lines.push({
          key: `todo:${todo.key}`, kind: 'next', priority: 90,
          text: todos.length === 1 ? `監督、今やることが1つあります。${first[todo.kind]}です。` : `監督、今やることが${todos.length}つあります。まずは${first[todo.kind]}から片づけましょう。`,
          action: { label: '最初の1つへ', screen: todo.screen },
        });
      }
      const next = nextMatchLine(game);
      if (next) lines.push(next);
      break;
    }
    case 'tactics': {
      // 相手に合わせたおすすめは「戦い方」の欄に出ているので、ここでは取り入れていないときに知らせるだけ
      const next = nextFixtureOf(game, myId);
      if (next) {
        const advice = recommendStyle(game, myId, next.homeId === myId ? next.awayId : next.homeId);
        if (instructionDistance(advice.style.instructions, club.tactics.instructions) > 0) {
          lines.push({ key: `advice:${next.id}:${advice.style.id}`, kind: 'next', priority: 50, text: `次の相手に合わせた戦い方のおすすめを、「戦い方」の欄に書いておきました。よければ見てください。` });
        }
      }
      const familiarity = Math.round(teamFamiliarity(club));
      if (familiarity < 50) {
        lines.push({ key: `familiarity:${club.tactics.formation}:${Math.floor(familiarity / 10)}`, kind: 'state', priority: 60, text: `今の形の熟成度は${familiarity}%です。形や指示をあまり変えないほうが、力を出せます。` });
      }
      const mine = nearestStyle(club.tactics.instructions);
      if (mine) {
        const { players: lineup, positions } = lineupOf(game, myId);
        const fit = styleFit(lineup, mine, positions);
        if (fit.stars === 1 && fit.weakest) {
          lines.push({ key: `fit:${mine.id}:${fit.weakest}`, kind: 'state', priority: 70, text: `今の戦い方（${mine.name}）には、今の先発の${ATTRIBUTE_LABEL[fit.weakest]}が足りないかもしれません。` });
        }
      }
      break;
    }
    case 'training': {
      const tired = players.filter((p) => p.status.fatigue >= 70);
      if (tired.length >= 3) {
        lines.push({ key: `tired:${game.date.slice(0, 7)}:${tired.length}`, kind: 'state', priority: 70, text: `${tired.length}人の疲れがたまっています。強度を軽めにするか、試合で休ませましょう。` });
      }
      const injured = players.filter((p) => p.status.injury);
      if (injured.length >= 4 && club.training.intensity === 'hard') {
        lines.push({ key: `injuries:${game.date.slice(0, 7)}`, kind: 'next', priority: 65, text: `ケガ人が${injured.length}人います。ハードな練習は、しばらく控えたほうがよさそうです。` });
      }
      break;
    }
    case 'squad': {
      const unhappy = players.filter((p) => (isUnhappyWithPlayingTime(p) || p.status.morale < 35) && talkCooldownLeft(game, p) === 0);
      const first = unhappy[0];
      if (first) {
        lines.push({ key: `unhappy:${first.id}:${game.date.slice(0, 7)}`, kind: 'next', priority: 70, text: `${first.name}が不満を持っています。面談で話を聞いてあげましょう。`, action: { label: '面談する', screen: { name: 'talk', playerId: first.id } } });
      }
      const riser = players.filter((p) => p.age <= 21 && p.hidden.potential - overallRating(p) >= 4).sort((a, b) => b.hidden.potential - a.hidden.potential)[0];
      if (riser) lines.push({ key: `riser:${riser.id}:${game.season.year}`, kind: 'state', priority: 40, text: `${riser.name}は伸びしろがあります。試合に出すと、もっと伸びます。` });
      break;
    }
    case 'transfers': {
      const spot = weakSpots(game, myId)[0];
      if (spot) {
        lines.push({
          key: `weak:${spot.position}:${game.date.slice(0, 7)}`, kind: 'next', priority: 70,
          text: spot.reason === 'quality'
            ? `監督、${POSITION_NAME[spot.position]}が手薄なようです（今の一番手の力 ${spot.best.toFixed(1)}、先発の平均 ${spot.average.toFixed(1)}）。移籍で探してみますか？`
            : `監督、${POSITION_NAME[spot.position]}の控えが足りません（${spot.count}人）。ケガや出場停止に備えて、もう1人いると安心です。`,
          action: { label: 'この位置の選手を探す', screen: { name: 'transfers', tab: 'search', position: spot.position } },
        });
      }
      if (windowOpen(game.date)) lines.push({ key: `budget:${game.date.slice(0, 7)}`, kind: 'state', priority: 40, text: `今は移籍期間です。移籍予算の残りは${yenText(transferBudgetLeft(club))}です。` });
      const rumor = transferRumor(game);
      if (rumor) lines.push(rumor);
      break;
    }
    case 'scouting': {
      const free = freeScouts(game);
      if (free > 0) lines.push({ key: `freeScouts:${game.date}`, kind: 'next', priority: 70, text: `仕事のないスカウトが${free}人います。探しに行かせましょう。` });
      if (offersOpen(game.date) && prospectPlayers(game).length > 0) {
        lines.push({ key: `prospects:${game.season.year}`, kind: 'state', priority: 60, text: '新人の候補が発表されています。良い候補は他クラブも狙うので、早めに調べて内定を出しましょう。', action: { label: '新人の候補を見る', screen: { name: 'scouting', tab: 'prospects' } } });
      }
      break;
    }
    case 'management': {
      const fin = club.finance;
      if (fin.sponsorOffers.length > 0) lines.push({ key: `sponsor:${fin.sponsorOffers[0]?.id}`, kind: 'next', priority: 80, text: 'スポンサーの提案が来ています。条件を比べて選びましょう。', action: { label: '営業担当と話す', screen: { name: 'conversation', topic: 'sponsor' } } });
      const net = netResult(yearToDate(fin));
      if (net < 0) lines.push({ key: `deficit:${game.date.slice(0, 7)}`, kind: 'state', priority: 60, text: `今年はここまで${yenText(-net)}の赤字です。年俸を抑えるか、収入を増やす手を考えましょう。` });
      if (game.owner.trust < 40) lines.push({ key: `trust:${game.date.slice(0, 7)}`, kind: 'state', priority: 75, text: `オーナーの信頼度が${Math.round(game.owner.trust)}まで下がっています。目標の順位に近づけましょう。` });
      break;
    }
    case 'fixtures':
    case 'league': {
      const next = nextMatchLine(game);
      if (next) lines.push(next);
      const row = standingsOf(game).find((r) => r.clubId === myId);
      if (row && row.played >= 10 && row.position <= 3) lines.push({ key: `race:${game.season.year}:${row.played}`, kind: 'state', priority: 55, text: `${row.position}位で優勝争いをしています。ここからが勝負です。` });
      break;
    }
    case 'inbox': {
      const waiting = game.inbox.filter((m) => m.action && !m.resolved).length;
      if (waiting > 0) lines.push({ key: `waiting:${game.date}:${waiting}`, kind: 'next', priority: 70, text: `返事を待っている知らせが${waiting}件あります。` });
      break;
    }
  }
  TIPS[screen].forEach((text, i) => lines.push({ key: `tip:${screen}:${i}`, kind: 'tip', priority: 10 - i, text }));
  return lines.sort((a, b) => b.priority - a.priority);
}

/** まだ話していない中で、いちばん大事な一言（なければ null） */
export function pickCoachLine(game: GameState, screen: CoachScreen, seen: ReadonlySet<string>): CoachLine | null {
  return coachLines(game, screen).find((line) => !seen.has(`${game.seed}:${line.key}`)) ?? null;
}
