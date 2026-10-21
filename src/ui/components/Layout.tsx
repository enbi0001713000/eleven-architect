// ゲーム中の画面の枠：左にメニュー、上に日付と「次の試合へ」ボタン（要件定義書「画面」）

import type { ReactNode } from 'react';
import { isSeasonOver, nextFixtureOf } from '../../game/season';
import { formatDate } from '../format';
import { store, useStore, type Screen } from '../store';
import { Emblem } from './Emblem';

interface MenuItem {
  label: string;
  screen: Screen;
  /** まだ作っていない画面は、追加されるフェーズを示す */
  phase?: number;
}

const MENU: MenuItem[] = [
  { label: 'ホーム', screen: { name: 'home' } },
  { label: '受信箱', screen: { name: 'later', title: '受信箱', phase: 2 }, phase: 2 },
  { label: '選手', screen: { name: 'squad' } },
  { label: '戦術', screen: { name: 'tactics' } },
  { label: '練習', screen: { name: 'later', title: '練習', phase: 2 }, phase: 2 },
  { label: '日程と結果', screen: { name: 'fixtures' } },
  { label: 'リーグ', screen: { name: 'league' } },
  { label: '移籍', screen: { name: 'later', title: '移籍', phase: 4 }, phase: 4 },
  { label: 'スカウト', screen: { name: 'later', title: 'スカウト', phase: 4 }, phase: 4 },
  { label: '財務', screen: { name: 'later', title: '財務', phase: 3 }, phase: 3 },
  { label: 'クラブ', screen: { name: 'later', title: 'クラブ', phase: 3 }, phase: 3 },
];

const MENU_SCREENS: Record<string, string> = {
  home: 'ホーム', squad: '選手', player: '選手', tactics: '戦術', fixtures: '日程と結果', league: 'リーグ', club: 'リーグ',
};

export function Layout({ children }: { children: ReactNode }) {
  const s = useStore();
  const game = s.game;
  if (!game) return null;
  const club = game.clubs[game.manager.clubId];
  const over = isSeasonOver(game);
  const next = nextFixtureOf(game, game.manager.clubId);
  const activeLabel = s.screen.name === 'later' ? s.screen.title : MENU_SCREENS[s.screen.name];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-club">
          {club && <Emblem spec={club.emblem} size={40} />}
          <div>
            <div className="sidebar-club-name">{club?.name}</div>
            <div className="muted small">監督 {game.manager.name}</div>
          </div>
        </div>
        <nav>
          {MENU.map((item) => (
            <button key={item.label} type="button" disabled={s.locked}
              className={`menu-item${activeLabel === item.label ? ' active' : ''}${item.phase ? ' later' : ''}`}
              onClick={() => store.open(item.screen)}>
              {item.label}
              {item.phase && <span className="menu-phase">P{item.phase}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-date">
            <strong>{formatDate(game.date)}</strong>
            <span className="muted">{game.season.year}年シーズン　{over ? '全日程終了' : `次は第${game.season.round}節`}</span>
          </div>
          <div className="topbar-actions">
            <span className="muted small">{s.saving ? '保存中…' : s.lastSavedAt ? `自動保存 ${s.lastSavedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            <button type="button" className="secondary" disabled={s.locked} onClick={() => void store.saveNow()}>セーブ</button>
            <button type="button" className="secondary" disabled={s.locked}
              onClick={() => { void store.saveNow(); store.setGame(null, null); store.open({ name: 'title' }); }}>タイトルへ</button>
            <button type="button" className="primary" disabled={s.locked || (s.screen.name === 'match')}
              onClick={() => store.open(over ? { name: 'seasonEnd' } : { name: 'match' })}>
              {over ? 'シーズンの結果を見る' : next ? `次の試合へ ▶` : '次へ ▶'}
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
