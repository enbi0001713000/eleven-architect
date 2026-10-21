// 受信箱（FMのようなメール形式の知らせ）。要件定義書「時間の進め方」に対応する。

import type { GameState, InboxMessage } from './types';

/** 古い知らせは、これを超えたら既読のものから消す */
const INBOX_LIMIT = 400;

export type NewMessage = Omit<InboxMessage, 'id' | 'date' | 'read'> & { date?: string };

export function addMessage(state: GameState, message: NewMessage): InboxMessage {
  const full: InboxMessage = { ...message, id: `m${state.nextMessageNumber++}`, date: message.date ?? state.date, read: false };
  state.inbox.unshift(full);
  if (state.inbox.length > INBOX_LIMIT) {
    let index = state.inbox.length - 1;
    while (index > 0 && !(state.inbox[index]?.read && !state.inbox[index]?.action)) index--;
    state.inbox.splice(index > 0 ? index : state.inbox.length - 1, 1);
  }
  return full;
}

/** メニューに出す数：まだ読んでいない大事な知らせと、返事を待っている知らせ */
export function attentionCount(state: GameState): number {
  return state.inbox.filter((m) => (!m.read && m.important) || (m.action && !m.resolved)).length;
}

/** 返事を待っている知らせ */
export function pendingActions(state: GameState): InboxMessage[] {
  return state.inbox.filter((m) => m.action && !m.resolved);
}

export function markRead(state: GameState, id: string): void {
  const message = state.inbox.find((m) => m.id === id);
  if (message) message.read = true;
}

export function markAllRead(state: GameState): void {
  for (const message of state.inbox) message.read = true;
}
