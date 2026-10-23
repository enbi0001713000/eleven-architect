// ホームの「今やること」（要件定義書「画面の作り直し（1.1）」）：試合前の問題、返事待ち、期限が近いこと、コーチのおすすめ。
// ゲームの状態から毎回作り直す。押すとその画面へ移る。

import { CONTRACT } from '../game/contractBalance';
import { expiringPlayers, isDelegated } from '../game/contracts';
import { daysBetween, monthDay, yearOf } from '../game/dates';
import { pendingActions } from '../game/inbox';
import { isUnhappyWithPlayingTime } from '../game/morale';
import { canNegotiate } from '../game/owner';
import { offersOpen, prospectPlayers } from '../game/prospects';
import { PROSPECTS } from '../game/scoutingBalance';
import { nextFixtureOf } from '../game/season';
import { validateSelection } from '../game/selection';
import { talkCooldownLeft } from '../game/talks';
import { TRANSFER } from '../game/transferBalance';
import { windowOpen } from '../game/transfers';
import type { GameState, PlayerRecord } from '../game/types';
import type { Screen } from './store';

export type TodoKind = 'problem' | 'reply' | 'deadline' | 'advice';

export interface Todo {
  key: string;
  kind: TodoKind;
  text: string;
  screen: Screen;
}

export const TODO_KIND_LABEL: Record<TodoKind, string> = {
  problem: '試合前の問題', reply: '返事待ち', deadline: '期限が近い', advice: 'コーチのおすすめ',
};

const md = (monthDayText: string): string => `${Number(monthDayText.slice(0, 2))}月${Number(monthDayText.slice(3))}日`;

/** 今の移籍期間の終わりの日（期間の外なら null） */
function windowEnd(date: string): string | null {
  const today = monthDay(date);
  const window = TRANSFER.windows.find(([from, to]) => today >= from && today <= to);
  return window ? `${yearOf(date)}-${window[1]}` : null;
}

export function homeTodos(game: GameState): Todo[] {
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  if (!club) return [];
  const todos: Todo[] = [];
  const today = monthDay(game.date);

  // 試合前の問題
  const next = nextFixtureOf(game, myId);
  if (next && club.selection) {
    for (const problem of validateSelection(game, myId, club.tactics.formation, club.selection)) {
      todos.push({ key: `problem:${problem}`, kind: 'problem', text: `メンバーを直す：${problem}`, screen: { name: 'tactics' } });
    }
  } else if (next && !club.selection) {
    todos.push({ key: 'problem:none', kind: 'problem', text: '試合のメンバーを決める', screen: { name: 'tactics' } });
  }

  // 返事待ち
  for (const m of pendingActions(game)) {
    const action = m.action;
    if (!action) continue;
    const player = m.playerId ? game.players[m.playerId] : undefined;
    switch (action.kind) {
      case 'playerRequest':
        if (player) todos.push({ key: `reply:${m.id}`, kind: 'reply', text: `${player.name}の申し出に返事をする`, screen: { name: 'talk', playerId: player.id, requestId: action.requestId } });
        break;
      case 'press': {
        const fixture = game.fixtures.find((f) => f.id === action.fixtureId);
        if (fixture && fixture.result === null) {
          const opponent = game.clubs[fixture.homeId === myId ? fixture.awayId : fixture.homeId];
          todos.push({ key: `reply:${m.id}`, kind: 'reply', text: `記者会見に出る（${opponent?.shortName ?? ''}戦の前）`, screen: { name: 'press', fixtureId: action.fixtureId } });
        }
        break;
      }
      case 'sponsorOffer':
        todos.push({ key: `reply:${m.id}`, kind: 'reply', text: 'スポンサーの提案を選ぶ', screen: { name: 'conversation', messageId: m.id } });
        break;
      case 'transferBid':
        todos.push({ key: `reply:${m.id}`, kind: 'reply', text: `${player ? `${player.name}の` : ''}移籍の話に返事をする`, screen: { name: 'inbox', messageId: m.id } });
        break;
      case 'jobOffer':
        todos.push({ key: `reply:${m.id}`, kind: 'reply', text: '監督のオファーに返事をする', screen: { name: 'conversation', messageId: m.id } });
        break;
      case 'fanThanksDay':
        todos.push({ key: `reply:${m.id}`, kind: 'reply', text: 'ファン感謝デーを開くか決める', screen: { name: 'conversation', messageId: m.id } });
        break;
    }
  }

  // 期限が近いこと
  if (canNegotiate(game)) {
    todos.push({ key: 'deadline:goals', kind: 'deadline', text: '開幕までに、オーナーと今シーズンの目標を話し合う（1回だけ）', screen: { name: 'conversation', topic: 'goals' } });
  }
  if (today >= CONTRACT.renewalOpens && today <= CONTRACT.renewalCloses) {
    const waiting = expiringPlayers(game).filter((p) => !p.leaving && !isDelegated(game, p));
    if (waiting.length > 0) {
      todos.push({ key: `deadline:renewal:${waiting.length}`, kind: 'deadline', text: `契約の更新を決める（${waiting.length}人、${md(CONTRACT.renewalCloses)}まで）`, screen: { name: 'transfers', tab: 'renewals' } });
    }
  }
  const end = windowEnd(game.date);
  if (end && daysBetween(game.date, end) <= 14) {
    todos.push({ key: `deadline:window:${end}`, kind: 'deadline', text: `移籍期間は${md(end.slice(5))}で終わる（補強するなら今のうち）`, screen: { name: 'transfers' } });
  }
  if (offersOpen(game.date) && prospectPlayers(game).length > 0 && daysBetween(game.date, `${yearOf(game.date)}-${PROSPECTS.offersClose}`) <= 30) {
    todos.push({ key: 'deadline:prospects', kind: 'deadline', text: `新人の候補に内定を出す（${md(PROSPECTS.offersClose)}まで）`, screen: { name: 'scouting', tab: 'prospects' } });
  }
  if (club.fanClub.renewal) {
    todos.push({ key: 'deadline:fanClub', kind: 'deadline', text: 'ファンクラブの入会と更新を受付中（会費を見直せる）', screen: { name: 'management', tab: 'fanClub' } });
  }

  // コーチのおすすめ
  const lineup = (club.selection?.lineup ?? []).map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined);
  const tired = lineup.filter((p) => p.status.fatigue >= 70);
  if (tired.length > 0) {
    todos.push({ key: `advice:tired:${tired.map((p) => p.id).join(',')}`, kind: 'advice', text: `${tired.map((p) => p.name).slice(0, 2).join('、')}${tired.length > 2 ? `ほか${tired.length - 2}人` : ''}の疲れがたまっている。先発から外して休ませる`, screen: { name: 'tactics' } });
  }
  const unhappy = club.playerIds.map((id) => game.players[id])
    .filter((p): p is PlayerRecord => p !== undefined && (isUnhappyWithPlayingTime(p) || p.status.morale < 35) && talkCooldownLeft(game, p) === 0)
    .slice(0, 2);
  for (const p of unhappy) {
    todos.push({ key: `advice:talk:${p.id}`, kind: 'advice', text: `${p.name}が不満を持っている。面談で話を聞く`, screen: { name: 'talk', playerId: p.id } });
  }
  return todos;
}
