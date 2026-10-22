// 画面全体で共有する状態（ゲームの状態、今の画面、設定）。
// ゲームの状態は update() の中で直接書き換え、書き換えたら画面を描き直す。変更は少し待ってから自動でセーブする。

import { useSyncExternalStore } from 'react';
import type { HeldEventKind } from '../game/fanClub';
import { advanceDay, advanceToNextEvent } from '../game/progress';
import type { GameState, InboxMessage } from '../game/types';
import { applyTheme, loadSettings, saveSettings, type Settings } from './settings';
import { writeSave } from './storage';

export type Screen =
  | { name: 'title' }
  | { name: 'newGame' }
  | { name: 'settings' }
  | { name: 'home' }
  | { name: 'squad' }
  | { name: 'player'; id: string }
  | { name: 'tactics' }
  | { name: 'fixtures'; round?: number }
  | { name: 'league' }
  | { name: 'club'; id: string }
  | { name: 'match' }
  | { name: 'seasonEnd' }
  | { name: 'inbox'; messageId?: string }
  | { name: 'training' }
  | { name: 'talk'; playerId: string; requestId?: string }
  | { name: 'meeting' }
  | { name: 'press'; fixtureId: string }
  | { name: 'finance'; tab?: 'overview' | 'budget' | 'sponsors' | 'tickets' | 'loans' | 'history' }
  | {
    name: 'conversation';
    /** 受信箱の知らせを会話で見る */
    messageId?: string;
    /** 財務やクラブの画面からの相談 */
    topic?: 'budgetIncrease' | 'loan' | 'sponsor' | 'goals' | 'fanEvent';
    /** ファンクラブのイベントの種類 */
    eventKind?: HeldEventKind;
    /** 借り入れの相談の中身と、オーナーの返事 */
    amount?: number;
    months?: number;
    approved?: boolean;
    reason?: string;
    rate?: number;
    monthly?: number;
  }
  | { name: 'later'; title: string; phase: number }
  | { name: 'myClub'; tab?: 'owner' | 'fanClub' }
  | { name: 'dismissed' };

class Store {
  game: GameState | null = null;
  slotId: string | null = null;
  screen: Screen = { name: 'title' };
  history: Screen[] = [];
  settings: Settings = loadSettings();
  /** 試合中はメニューで他の画面に移れない */
  locked = false;
  saving = false;
  lastSavedAt: Date | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** 画面を移ったら、ページの一番上から見せる */
  private scrollToTop(): void {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  navigate(screen: Screen): void {
    this.history.push(this.screen);
    if (this.history.length > 30) this.history.shift();
    this.screen = screen;
    this.scrollToTop();
    this.emit();
  }

  /** メニューから移るとき（戻る履歴を残さない） */
  open(screen: Screen): void {
    this.history = [];
    this.screen = screen;
    this.scrollToTop();
    this.emit();
  }

  back(): void {
    const previous = this.history.pop();
    if (previous) this.screen = previous;
    this.scrollToTop();
    this.emit();
  }

  setGame(game: GameState | null, slotId: string | null): void {
    this.game = game;
    this.slotId = slotId;
    this.emit();
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.emit();
  }

  /** ゲームの状態を書き換える。少し待ってから自動でセーブする */
  update(change: (game: GameState) => void): void {
    if (!this.game) return;
    change(this.game);
    this.emit();
    this.scheduleSave();
  }

  /**
   * 大事な知らせのうち、会話画面で開くもの（オーナーの予算、お金が足りない、スポンサーの提案、選手からの申し出）。
   * 設定で切ってあれば null
   */
  conversationFor(message: InboxMessage | undefined): Screen | null {
    if (!message || !this.settings.conversations) return null;
    if (message.action?.kind === 'playerRequest' && !message.resolved && message.playerId) {
      return { name: 'talk', playerId: message.playerId, requestId: message.action.requestId };
    }
    return message.topic ? { name: 'conversation', messageId: message.id } : null;
  }

  /** 届いた大事な知らせを開く。会話で見る知らせがあれば会話画面を（戻ると受信箱）、なければ受信箱を */
  private openArrived(since: number): void {
    const arrived = (this.game?.inbox ?? []).filter((m) => Number(m.id.slice(1)) >= since && m.important);
    const talk = arrived.map((m) => ({ m, screen: this.conversationFor(m) })).find((t) => t.screen !== null);
    this.open({ name: 'inbox', messageId: talk?.m.id });
    if (talk?.screen) this.navigate(talk.screen);
  }

  /** 「次の出来事まで進める」。大事な知らせが届いたら受信箱（か会話画面）を、試合の日ならホームを開く */
  advance(): void {
    if (!this.game || this.locked || this.game.owner?.dismissed) return;
    const before = this.game.nextMessageNumber;
    let reason = 'match';
    this.update((g) => {
      reason = advanceToNextEvent(g).reason;
    });
    if (reason === 'message') this.openArrived(before);
    else this.open({ name: 'home' });
  }

  /** 1日だけ進める */
  advanceOneDay(): void {
    if (!this.game || this.locked || this.game.owner?.dismissed) return;
    const before = this.game.nextMessageNumber;
    this.update((g) => advanceDay(g));
    const important = this.game.inbox.some((m) => Number(m.id.slice(1)) >= before && m.important);
    if (important) this.openArrived(before);
  }

  updateSettings(change: Partial<Settings>): void {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
    applyTheme(this.settings.theme);
    this.emit();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 800);
  }

  async saveNow(): Promise<void> {
    if (!this.game || !this.slotId) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saving = true;
    this.emit();
    try {
      await writeSave(this.slotId, this.game);
      this.lastSavedAt = new Date();
    } finally {
      this.saving = false;
      this.emit();
    }
  }
}

export const store = new Store();

/** 状態が変わったら描き直す */
export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

export function useGame(): GameState {
  const s = useStore();
  if (!s.game) throw new Error('ゲームが読み込まれていません');
  return s.game;
}
