// 画面全体で共有する状態（ゲームの状態、今の画面、設定）。
// ゲームの状態は update() の中で直接書き換え、書き換えたら画面を描き直す。変更は少し待ってから自動でセーブする。

import { useSyncExternalStore } from 'react';
import { advanceDay, advanceToNextEvent } from '../game/progress';
import type { GameState } from '../game/types';
import { loadSettings, saveSettings, type Settings } from './settings';
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
  | { name: 'later'; title: string; phase: number };

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

  /** 「次の出来事まで進める」。大事な知らせが届いたら受信箱を、試合の日ならホームを開く */
  advance(): void {
    if (!this.game || this.locked) return;
    let reason = 'match';
    this.update((g) => {
      reason = advanceToNextEvent(g).reason;
    });
    this.open(reason === 'message' ? { name: 'inbox' } : { name: 'home' });
  }

  /** 1日だけ進める */
  advanceOneDay(): void {
    if (!this.game || this.locked) return;
    const before = this.game.nextMessageNumber;
    this.update((g) => advanceDay(g));
    const important = this.game.inbox.some((m) => Number(m.id.slice(1)) >= before && m.important);
    if (important) this.open({ name: 'inbox' });
  }

  updateSettings(change: Partial<Settings>): void {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
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
