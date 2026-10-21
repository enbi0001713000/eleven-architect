// 選手とのやり取り：選手からの申し出、個人面談、チームミーティング、記者会見、試合の声かけ。
// 要件定義書「面談と声かけ」に対応する。どれも選手のモラル（と声かけはその日の出来）を通じて試合に影響する。
// 効き方は、選手の性格（気の強さ、プレッシャーへの強さ、プロ意識、野心）と状況で変わる。

import { createRng, type Rng } from '../engine/rng';
import { overallRating } from '../engine/ratings';
import { BALANCE } from './balance';
import { adjustMorale } from './condition';
import { daysBetween, daySeed } from './dates';
import { addMessage } from './inbox';
import { SQUAD_ROLE_LABEL } from './morale';
import { LEAGUE_RULES } from './rules';
import { clubPlayers } from './selection';
import { standingsOf } from './standings';
import type { Fixture, GameState, PlayerRecord } from './types';

export type ReactionTone = 'positive' | 'neutral' | 'negative';

export interface Reaction {
  playerId: string;
  name: string;
  tone: ReactionTone;
  text: string;
  /** モラルの変化 */
  morale: number;
  /** その日の出来の変化（声かけだけ。+0.03 なら3%良くなる） */
  form: number;
}

export interface TalkOutcome {
  /** 選手の反応の文章 */
  text: string;
  tone: ReactionTone;
  morale: number;
}

const toneOf = (score: number): ReactionTone => (score > 0.9 ? 'positive' : score < -0.9 ? 'negative' : 'neutral');

const REACTION_TEXT: Record<ReactionTone, readonly string[]> = {
  positive: ['気合いが入った', '集中している', '自信をつけたようだ', '奮い立った', 'やる気に満ちている'],
  neutral: ['特に反応はない', '落ち着いて聞いている', '静かにうなずいた'],
  negative: ['萎縮している', '不満そうだ', '落ち込んでいる', '気が緩んでいる', '納得していない様子だ'],
};

/** 直近の試合結果（新しい順。1勝ち 0引き分け -1負け） */
export function recentResults(state: GameState, clubId: string, count: number): (1 | 0 | -1)[] {
  return state.fixtures
    .filter((f) => f.result && (f.homeId === clubId || f.awayId === clubId))
    .sort((a, b) => b.round - a.round)
    .slice(0, count)
    .map((f) => {
      const r = f.result as NonNullable<Fixture['result']>;
      const diff = f.homeId === clubId ? r.homeGoals - r.awayGoals : r.awayGoals - r.homeGoals;
      return Math.sign(diff) as 1 | 0 | -1;
    });
}

function talkRng(state: GameState, salt: string): Rng {
  return createRng(daySeed(state.seed, state.date, salt));
}

function myPlayers(state: GameState): PlayerRecord[] {
  return clubPlayers(state, state.manager.clubId);
}

/** 直近の平均評価点（記録がなければ null） */
export function recentForm(player: PlayerRecord): number | null {
  const r = player.status.recentRatings;
  return r.length === 0 ? null : r.reduce((a, b) => a + b, 0) / r.length;
}

// ---- 選手からの申し出（出場機会） ----

export type RequestReply = 'promise' | 'compete' | 'accept';

export const REQUEST_REPLIES: { id: RequestReply; label: string; description: string }[] = [
  { id: 'promise', label: '「次の5試合のうち、3試合は先発で使う」と約束する', description: 'モラルは上がるが、守れないと大きく下がる' },
  { id: 'compete', label: '「練習で結果を出せば使う」と伝える', description: 'プロ意識の高い選手は前向きに受け止める' },
  { id: 'accept', label: '「今の立場を受け入れてほしい」と伝える', description: '野心のある選手ほど不満を持つ' },
];

export function canPromise(state: GameState): boolean {
  return state.season.round <= LEAGUE_RULES.rounds - 2;
}

export function answerRequest(state: GameState, requestId: string, reply: RequestReply): TalkOutcome {
  const request = state.requests.find((r) => r.id === requestId);
  const player = request ? state.players[request.playerId] : undefined;
  if (!request || !player) throw new Error('申し出が見つかりません');
  const h = player.hidden;
  let outcome: TalkOutcome;
  if (reply === 'promise') {
    if (!canPromise(state)) throw new Error('今シーズンの残り試合では約束できません');
    state.promises.push({
      id: `pr${state.nextMessageNumber}`, playerId: player.id, kind: 'playingTime', madeOn: state.date,
      year: state.season.year, untilRound: Math.min(LEAGUE_RULES.rounds, state.season.round + 4),
      target: 3, startsAtPromise: player.season.starts,
    });
    outcome = { text: `${player.name}は約束を信じて、チームのために頑張ると話した。`, tone: 'positive', morale: 10 };
  } else if (reply === 'compete') {
    outcome = h.professionalism >= 12 || h.ambition <= 9
      ? { text: `${player.name}は「練習で証明します」と前向きに受け止めた。`, tone: 'positive', morale: 4 }
      : { text: `${player.name}は「もう十分やっています」と納得していない。`, tone: 'negative', morale: -5 };
  } else {
    outcome = h.ambition >= 13
      ? { text: `${player.name}は怒って部屋を出て行った。`, tone: 'negative', morale: -14 }
      : { text: `${player.name}はしぶしぶ受け入れたが、表情は暗い。`, tone: 'negative', morale: -5 };
  }
  adjustMorale(player, outcome.morale);
  if (reply !== 'promise') player.status.playingTime = Math.max(player.status.playingTime, 0.3);
  state.requests = state.requests.filter((r) => r.id !== requestId);
  for (const m of state.inbox) {
    if (m.action?.kind === 'playerRequest' && m.action.requestId === requestId) {
      m.resolved = true;
      m.read = true;
    }
  }
  return outcome;
}

// ---- 監督からの個人面談 ----

export type ManagerTalk = 'praise' | 'criticize' | 'expect';

/** say は会話画面で監督が話すセリフ */
export const MANAGER_TALKS: { id: ManagerTalk; label: string; description: string; say: string }[] = [
  { id: 'praise', label: '最近のプレーを褒める', description: '調子の良い選手に効く。悪いときに褒めても響かない', say: '最近のプレー、とても良いぞ。この調子で頼む。' },
  { id: 'criticize', label: '最近のプレーについて注意する', description: '気の強い選手は奮起するが、そうでない選手は落ち込む', say: '最近のプレーには満足していない。もっとできるはずだ。' },
  { id: 'expect', label: '期待していると伝える', description: 'プレッシャーに強い選手ほど意気に感じる', say: '君には大いに期待している。チームを引っ張ってほしい。' },
];

export function talkCooldownLeft(state: GameState, player: PlayerRecord): number {
  if (!player.lastTalk) return 0;
  return Math.max(0, BALANCE.talkCooldown - daysBetween(player.lastTalk, state.date));
}

export function managerTalk(state: GameState, playerId: string, kind: ManagerTalk): TalkOutcome {
  const player = state.players[playerId];
  if (!player || player.clubId !== state.manager.clubId) throw new Error('自分のクラブの選手ではありません');
  if (talkCooldownLeft(state, player) > 0) throw new Error('最近話をしたばかりです');
  const rng = talkRng(state, `talk-${playerId}`);
  const form = recentForm(player);
  const h = player.hidden;
  let outcome: TalkOutcome;
  if (kind === 'praise') {
    if (form === null) outcome = { text: `${player.name}は少し照れくさそうだ。`, tone: 'neutral', morale: 2 };
    else if (form >= 7.0) outcome = { text: `${player.name}は嬉しそうだ。「この調子を続けます」`, tone: 'positive', morale: 8 };
    else if (form >= 6.5) outcome = { text: `${player.name}は「ありがとうございます」と答えた。`, tone: 'positive', morale: 4 };
    else outcome = { text: `${player.name}は戸惑っている。自分の出来が良くないことは分かっているようだ。`, tone: 'neutral', morale: -1 };
  } else if (kind === 'criticize') {
    if (form !== null && form >= 6.9) {
      outcome = { text: `${player.name}は「どこが悪いんですか」と納得していない。`, tone: 'negative', morale: -8 };
    } else if (h.temperament >= 12) {
      outcome = { text: `${player.name}は悔しそうに「見返してみせます」と答えた。`, tone: 'positive', morale: 6 };
    } else if (h.temperament <= 8) {
      outcome = { text: `${player.name}はすっかり落ち込んでしまった。`, tone: 'negative', morale: -8 };
    } else {
      outcome = { text: `${player.name}は黙って聞いていた。`, tone: 'neutral', morale: 0 };
    }
  } else if (h.pressure >= 13) {
    outcome = { text: `${player.name}は「期待に応えます」と意気込んでいる。`, tone: 'positive', morale: 7 };
  } else if (h.pressure <= 8) {
    outcome = { text: `${player.name}はプレッシャーを感じているようだ。`, tone: 'negative', morale: -4 };
  } else {
    outcome = { text: `${player.name}は「頑張ります」と答えた。`, tone: 'positive', morale: 3 };
  }
  outcome.morale += Math.round(rng.normal(0, 1));
  adjustMorale(player, outcome.morale);
  player.lastTalk = state.date;
  return outcome;
}

// ---- チームミーティング ----

export type MeetingKind = 'goals' | 'rally' | 'praise' | 'demand';

export const MEETINGS: { id: MeetingKind; label: string; description: string }[] = [
  { id: 'goals', label: 'シーズンの目標を共有する', description: 'シーズンの始めに効く' },
  { id: 'rally', label: '立て直しを呼びかける', description: '負けが込んでいるときに効く。勝っているときは逆効果' },
  { id: 'praise', label: '最近の戦いぶりをたたえる', description: '勝っているときに効く' },
  { id: 'demand', label: '気を引き締める', description: '気の強い選手やプロ意識の高い選手には響く' },
];

export function meetingCooldownLeft(state: GameState): number {
  if (!state.lastTeamMeeting) return 0;
  return Math.max(0, BALANCE.meetingCooldown - daysBetween(state.lastTeamMeeting, state.date));
}

export function teamMeeting(state: GameState, kind: MeetingKind): { summary: string; reactions: Reaction[] } {
  if (meetingCooldownLeft(state) > 0) throw new Error('最近ミーティングをしたばかりです');
  const rng = talkRng(state, 'meeting');
  const results = recentResults(state, state.manager.clubId, 3);
  const wins = results.filter((r) => r === 1).length;
  const losses = results.filter((r) => r === -1).length;
  const early = state.season.round <= 3;
  let base: number;
  let summary: string;
  switch (kind) {
    case 'goals':
      base = early ? 5 : 1;
      summary = early ? '選手たちは目標を共有し、シーズンに向けて気持ちがそろった。' : 'シーズンの途中だが、目標を確かめ合った。';
      break;
    case 'rally':
      base = losses >= 2 ? 6 : -3;
      summary = losses >= 2 ? '立て直しへの呼びかけに、選手たちは前を向いた。' : '負けていないのに立て直しと言われ、選手たちは戸惑っている。';
      break;
    case 'praise':
      base = wins >= 2 ? 5 : -3;
      summary = wins >= 2 ? '戦いぶりをたたえられ、チームの雰囲気は明るい。' : '結果が出ていないのにたたえられ、選手たちはしらけている。';
      break;
    default:
      base = 0;
      summary = '気を引き締めるように求めた。受け止め方は選手によって違う。';
  }
  const reactions = myPlayers(state).filter((p) => p.status.injury === null || p.status.injury.daysLeft < 30).map((player) => {
    let score = base;
    if (kind === 'demand') {
      if (wins >= 2) score = player.hidden.professionalism >= 12 ? 3 : -2;
      else if (losses >= 2) score = player.hidden.temperament >= 12 ? 4 : -4;
      else score = player.hidden.temperament >= 12 ? 1 : -1;
    }
    if (kind === 'rally' && losses >= 2 && player.hidden.temperament >= 12) score += 2;
    score += rng.normal(0, 1.2);
    const morale = Math.round(score);
    adjustMorale(player, morale);
    const tone = toneOf(score);
    return { playerId: player.id, name: player.name, tone, text: rng.pick(REACTION_TEXT[tone]), morale, form: 0 };
  });
  state.lastTeamMeeting = state.date;
  return { summary, reactions };
}

// ---- 記者会見 ----

export interface PressAnswer {
  id: string;
  label: string;
}

export interface PressQuestion {
  id: string;
  text: string;
  answers: PressAnswer[];
}

/** 試合前の記者会見の質問。同じ試合なら同じ質問になる */
export function pressQuestions(state: GameState, fixtureId: string): PressQuestion[] {
  const fixture = state.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) return [];
  const myId = state.manager.clubId;
  const opponentId = fixture.homeId === myId ? fixture.awayId : fixture.homeId;
  const opponent = state.clubs[opponentId];
  const derby = state.clubs[myId]?.rivalId === opponentId;
  const rng = createRng(daySeed(state.seed, fixture.date, `press-${fixtureId}`));
  const questions: PressQuestion[] = [];

  questions.push({
    id: 'preview',
    text: derby
      ? `いよいよ${opponent?.name}とのダービーです。意気込みを聞かせてください。`
      : `次は${opponent?.name}戦です。どんな試合にしたいですか？`,
    answers: [
      { id: 'confident', label: '「自信があります。勝ちに行きます」' },
      { id: 'respect', label: '「手強い相手です。敬意を持って臨みます」' },
      { id: 'focus', label: '「自分たちのサッカーをするだけです」' },
    ],
  });

  const players = myPlayers(state).filter((p) => p.status.recentRatings.length >= 3);
  const hot = players.filter((p) => (recentForm(p) ?? 0) >= 7.1).sort((a, b) => (recentForm(b) ?? 0) - (recentForm(a) ?? 0))[0];
  const cold = players.filter((p) => p.contract?.role === 'key' && (recentForm(p) ?? 10) <= 6.4)[0];
  const target = hot && cold ? rng.pick([hot, cold]) : hot ?? cold;
  if (target) {
    questions.push({
      id: `player:${target.id}`,
      text: target === hot ? `${target.name}選手が好調です。どう見ていますか？` : `${target.name}選手が不調のようですが？`,
      answers: [
        { id: 'praise', label: '「彼はチームに欠かせない選手です」' },
        { id: 'challenge', label: '「彼ならもっとできるはずです」' },
        { id: 'neutral', label: '「個人のことは話しません」' },
      ],
    });
  }

  if (opponent) {
    const quotes = ['今季は負ける気がしない', '相手の弱点は分かっている', '内容でも結果でも上回る'];
    questions.push({
      id: 'rival',
      text: `${opponent.managerName}監督が「${rng.pick(quotes)}」と話していますが？`,
      answers: [
        { id: 'fire', label: '「ピッチの上で答えを出します」' },
        { id: 'respect', label: '「優れた監督です。敬意を払っています」' },
        { id: 'ignore', label: '「他の人の発言は気にしていません」' },
      ],
    });
  }
  return questions;
}

/** 記者会見の答えを反映する。結果の説明を返す */
export function answerPress(state: GameState, fixtureId: string, answers: Record<string, string>): string[] {
  const fixture = state.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error('試合が見つかりません');
  const myId = state.manager.clubId;
  const opponentId = fixture.homeId === myId ? fixture.awayId : fixture.homeId;
  const notes: string[] = [];
  const squad = myPlayers(state);
  const table = standingsOf(state);
  const posOf = (id: string) => table.find((r) => r.clubId === id)?.position ?? 9;
  const favorite = posOf(myId) <= posOf(opponentId);
  const relation = (delta: number) => {
    state.managerRelations[opponentId] = Math.max(-100, Math.min(100, (state.managerRelations[opponentId] ?? 0) + delta));
  };
  const fans = (delta: number) => {
    state.fanMood = Math.max(0, Math.min(100, state.fanMood + delta));
  };
  const everyone = (delta: (p: PlayerRecord) => number) => {
    for (const p of squad) adjustMorale(p, delta(p));
  };

  for (const [questionId, answer] of Object.entries(answers)) {
    if (questionId === 'preview') {
      if (answer === 'confident') {
        fans(3);
        relation(-3);
        everyone((p) => (favorite ? 2 : p.hidden.pressure <= 8 ? -2 : 0));
        notes.push(favorite ? 'ファンは盛り上がり、選手たちも自信を深めた。' : 'ファンは盛り上がったが、プレッシャーを感じている選手もいる。');
      } else if (answer === 'respect') {
        relation(4);
        fans(-1);
        notes.push('相手への敬意が伝わった。');
      } else {
        everyone(() => 1);
        notes.push('落ち着いた受け答えだった。');
      }
    } else if (questionId.startsWith('player:')) {
      const player = state.players[questionId.slice('player:'.length)];
      if (!player) continue;
      if (answer === 'praise') {
        adjustMorale(player, 6);
        notes.push(`${player.name}は監督の言葉を喜んでいる。`);
      } else if (answer === 'challenge') {
        const d = player.hidden.temperament >= 12 ? 4 : -6;
        adjustMorale(player, d);
        notes.push(d > 0 ? `${player.name}は発奮している。` : `${player.name}は公の場で言われたことを気にしている。`);
      }
    } else if (questionId === 'rival') {
      if (answer === 'fire') {
        fans(4);
        relation(-8);
        everyone(() => 2);
        notes.push('強気な発言にファンは沸き、相手監督との関係は冷えた。');
      } else if (answer === 'respect') {
        relation(5);
        fans(-1);
        notes.push('相手監督との関係が良くなった。');
      } else {
        notes.push('特に話題にはならなかった。');
      }
    }
  }
  for (const m of state.inbox) {
    if (m.action?.kind === 'press' && m.action.fixtureId === fixtureId) {
      m.resolved = true;
      m.read = true;
    }
  }
  return notes;
}

/** 試合の日の朝に、記者会見の知らせを届ける */
export function schedulePress(state: GameState, fixture: Fixture): void {
  const myId = state.manager.clubId;
  const opponent = state.clubs[fixture.homeId === myId ? fixture.awayId : fixture.homeId];
  addMessage(state, {
    category: 'media', from: '広報', important: false, fixtureId: fixture.id,
    subject: `${opponent?.name}戦の前の記者会見`,
    body: '試合前の記者会見の準備ができています。答え方で、選手のモラルやファンの雰囲気、相手監督との関係が変わります。\n出なければ、コーチが代わりに無難に答えます。',
    action: { kind: 'press', fixtureId: fixture.id },
  });
}

/** 試合が終わったら、答えなかった記者会見は締め切る */
export function closePress(state: GameState, fixtureId: string): void {
  for (const m of state.inbox) {
    if (m.action?.kind === 'press' && m.action.fixtureId === fixtureId) m.resolved = true;
  }
}

// ---- 試合の声かけ（試合前、ハーフタイム、試合後） ----

export type TalkMoment = 'pre' | 'half' | 'post';
export type TalkTone = 'calm' | 'motivate' | 'praise' | 'criticize' | 'none';

export const TALK_TONES: { id: TalkTone; label: string }[] = [
  { id: 'calm', label: '落ち着かせる' },
  { id: 'motivate', label: '鼓舞する' },
  { id: 'praise', label: '褒める' },
  { id: 'criticize', label: '叱る' },
  { id: 'none', label: '何も言わない' },
];

export interface TalkSituation {
  moment: TalkMoment;
  /** 自分の得点 − 相手の得点 */
  goalDiff: number;
  /** 力関係（1 有利、0 互角、-1 不利） */
  favorite: -1 | 0 | 1;
}

/** 相手との力関係。先発の総合力の平均で比べる */
export function strengthBalance(myOverall: number, theirOverall: number): -1 | 0 | 1 {
  const diff = myOverall - theirOverall;
  return diff > 0.4 ? 1 : diff < -0.4 ? -1 : 0;
}

export function averageOverall(players: PlayerRecord[]): number {
  return players.length === 0 ? 0 : players.reduce((n, p) => n + overallRating(p), 0) / players.length;
}

function talkScore(player: PlayerRecord, situation: TalkSituation, tone: TalkTone): number {
  const { moment, goalDiff, favorite } = situation;
  const h = player.hidden;
  const tough = h.temperament >= 13 ? 1 : h.temperament <= 8 ? -1 : 0;
  const nervous = h.pressure <= 8;
  if (tone === 'none') return 0;
  if (moment === 'pre') {
    switch (tone) {
      case 'calm': return favorite < 0 ? 2 + (nervous ? 1 : 0) : favorite === 0 ? 1 : nervous ? 1 : -1;
      case 'motivate': return favorite === 1 ? (tough === 1 ? 1 : 0) : nervous ? (favorite < 0 ? -1 : 0) : 2;
      case 'praise': return favorite === 1 ? 2 : favorite === 0 ? 1 : 0;
      case 'criticize': return tough === 1 ? 2 : tough === -1 ? -3 : -1;
    }
  }
  const state = goalDiff > 0 ? 'ahead' : goalDiff === 0 ? 'level' : 'behind';
  if (moment === 'half') {
    switch (tone) {
      case 'calm': return state === 'ahead' ? 2 : state === 'level' ? 1 : nervous || goalDiff === -1 ? 2 : 0;
      case 'motivate':
        // 鼓舞は、気の強い選手には響くが、プレッシャーに弱い選手は大差で負けていると萎縮する
        if (state === 'ahead') return tough === 1 ? 1 : 0;
        if (state === 'level') return nervous ? 0 : tough === 1 ? 3 : 2;
        return nervous ? (goalDiff <= -2 ? -2 : 0) : tough === 1 ? 3 : 2;
      case 'praise': return state === 'ahead' ? (goalDiff === 1 ? 1 : 2) : state === 'level' ? 0 : -2;
      case 'criticize':
        if (state === 'ahead') return tough === 1 ? -1 : -3;
        if (state === 'level') return tough === 1 ? 3 : tough === -1 ? -3 : 0;
        return tough === 1 ? 4 : tough === -1 ? -4 : 1;
    }
  }
  switch (tone) {
    case 'calm': return state === 'behind' ? 2 : 1;
    case 'motivate': return state === 'level' || state === 'behind' ? 2 : 1;
    case 'praise': return state === 'ahead' ? 3 : state === 'level' ? (favorite < 0 ? 2 : 1) : favorite < 0 ? 1 : -1;
    case 'criticize':
      if (state === 'ahead') return h.professionalism >= 15 ? 0 : -4;
      return tough === 1 ? 2 : tough === -1 ? -5 : state === 'level' ? -1 : -2;
  }
  return 0;
}

/**
 * 声かけの効果。試合前とハーフタイムは、その日の出来（form）とモラルを少し変える。試合後はモラルだけを変える。
 * 状態（players）は書き換えない。モラルの反映は applyTalkMorale で行う。
 */
export function teamTalk(rng: Rng, players: PlayerRecord[], situation: TalkSituation, tone: TalkTone): Reaction[] {
  return players.map((player) => {
    const score = talkScore(player, situation, tone) + (tone === 'none' ? 0 : rng.normal(0, 0.7));
    const t = toneOf(score);
    const post = situation.moment === 'post';
    return {
      playerId: player.id,
      name: player.name,
      tone: t,
      text: tone === 'none' ? '—' : rng.pick(REACTION_TEXT[t]),
      morale: Math.round(score * (post ? 1.5 : 0.6)),
      form: post ? 0 : Math.round(score * 0.01 * 1000) / 1000,
    };
  });
}

export function applyTalkMorale(state: GameState, reactions: Reaction[]): void {
  for (const r of reactions) {
    const player = state.players[r.playerId];
    if (player) adjustMorale(player, r.morale);
  }
}

export const roleLabel = (p: PlayerRecord): string => SQUAD_ROLE_LABEL[p.contract?.role ?? 'backup'];
