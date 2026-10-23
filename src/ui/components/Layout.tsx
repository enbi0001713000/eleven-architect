// ゲーム中の画面の枠：左にメニュー、上に日付と「次の出来事まで進める」ボタン（要件定義書「画面」）
// 右上のボタンは、どの画面からでも押せる。試合の日は「試合へ」に変わる。

import type { CSSProperties, ReactNode } from 'react';
import { attentionCount } from '../../game/inbox';
import { todaysFixture } from '../../game/progress';
import { isSeasonOver } from '../../game/season';
import { clubVars } from '../colors';
import { formatDate } from '../format';
import { downloadSave } from '../storage';
import { store, useStore, type Screen } from '../store';
import { MomentOverlay } from './Celebration';
import { CoachBubble } from './CoachBubble';
import { Emblem } from './Emblem';
import { Icon, type IconName } from './Icon';
import { TutorialOverlay } from './TutorialOverlay';

interface MenuItem {
  label: string;
  icon: IconName;
  screen: Screen;
  /** まだ作っていない画面は、追加されるフェーズを示す */
  phase?: number;
}

/** 左のメニュー。ホームと受信箱を一番上に置き、その下をグループに分ける（要件定義書「画面の作り直し（1.1）」） */
const MENU: { label: string | null; items: MenuItem[] }[] = [
  { label: null, items: [
    { label: 'ホーム', icon: 'home', screen: { name: 'home' } },
    { label: '受信箱', icon: 'inbox', screen: { name: 'inbox' } },
  ] },
  { label: 'チーム', items: [
    { label: '選手', icon: 'squad', screen: { name: 'squad' } },
    { label: '戦術', icon: 'tactics', screen: { name: 'tactics' } },
    { label: '練習', icon: 'training', screen: { name: 'training' } },
  ] },
  { label: '試合', items: [
    { label: '日程と結果', icon: 'fixtures', screen: { name: 'fixtures' } },
    { label: 'リーグ', icon: 'league', screen: { name: 'league' } },
  ] },
  { label: '補強', items: [
    { label: '移籍', icon: 'transfers', screen: { name: 'transfers' } },
    { label: 'スカウト', icon: 'scouting', screen: { name: 'scouting' } },
  ] },
  { label: '経営', items: [
    { label: '経営', icon: 'finance', screen: { name: 'management' } },
    { label: '監督', icon: 'manager', screen: { name: 'manager' } },
  ] },
];

/** 無職の間のメニュー（監督の画面がホームになる） */
const UNEMPLOYED_MENU = new Set(['受信箱', '日程と結果', 'リーグ', '監督']);

const MENU_SCREENS: Record<string, string> = {
  home: 'ホーム', squad: '選手', player: '選手', tactics: '戦術', fixtures: '日程と結果', league: 'リーグ', club: 'リーグ',
  inbox: '受信箱', training: '練習', talk: '選手', meeting: 'ホーム', press: '受信箱', seasonEnd: 'リーグ', management: '経営', conversation: '受信箱', manager: '監督', transfers: '移籍', contract: '移籍', bid: '移籍', scouting: 'スカウト', prospect: 'スカウト',
};

export function Layout({ children }: { children: ReactNode }) {
  const s = useStore();
  const game = s.game;
  if (!game) return null;
  const club = game.clubs[game.manager.clubId];
  const over = isSeasonOver(game);
  const today = todaysFixture(game);
  const unread = attentionCount(game);
  const unemployed = game.manager.clubId === '';
  const activeLabel = s.screen.name === 'later' ? s.screen.title : MENU_SCREENS[s.screen.name];

  return (
    <div className="layout" style={clubVars(club?.colors, s.settings.theme) as CSSProperties}>
      <aside className="sidebar">
        <div className="sidebar-club">
          {club && <Emblem spec={club.emblem} size={44} />}
          <div>
            <div className="sidebar-club-name">{club?.name ?? '無職'}</div>
            <div className="muted small">監督 {game.manager.name}</div>
          </div>
        </div>
        <nav data-tutorial="menu">
          {MENU.map((group) => {
            const items = group.items.filter((item) => !unemployed || UNEMPLOYED_MENU.has(item.label));
            if (items.length === 0) return null;
            return (
              <div key={group.label ?? 'top'} className="menu-group">
                {group.label && <div className="menu-group-label">{group.label}</div>}
                {items.map((item) => (
                  <button key={item.label} type="button" disabled={s.locked} data-tutorial={item.phase ? undefined : `menu-${item.screen.name}`}
                    className={`menu-item${activeLabel === item.label ? ' active' : ''}${item.phase ? ' later' : ''}`}
                    onClick={() => store.open(item.screen)}>
                    <span className="menu-label"><Icon name={item.icon} size={20} />{item.label}</span>
                    {item.phase && <span className="menu-phase">P{item.phase}</span>}
                    {item.screen.name === 'inbox' && unread > 0 && <span className="menu-badge">{unread}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-date">
            <strong>{formatDate(game.date)}</strong>
            <span className="muted">{game.season.year}年シーズン　{over ? '全日程終了（オフ）' : today ? `今日は第${game.season.round}節の試合の日` : `次は第${game.season.round}節`}</span>
          </div>
          <div className="topbar-actions">
            <span className="muted small">{s.saving ? '保存中…' : s.saveError ? '保存できていません' : s.lastSavedAt ? `自動保存 ${s.lastSavedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            <button type="button" className="secondary" data-tutorial="help" disabled={!s.tutorialContext || s.tutorial !== null}
              title="この画面の説明をもう一度見る" aria-label="この画面の説明をもう一度見る" onClick={() => store.replayTutorial()}>？</button>
            <button type="button" className="secondary" disabled={s.locked} title="配色、観戦の速さなど" onClick={() => store.navigate({ name: 'settings' })}>設定</button>
            <button type="button" className="secondary" disabled={s.locked} onClick={() => void store.saveNow()}>セーブ</button>
            <button type="button" className="secondary" disabled={s.locked}
              onClick={() => { void store.saveNow(); store.setGame(null, null); store.open({ name: 'title' }); }}>タイトルへ</button>
            {!today && (
              <button type="button" className="secondary" disabled={s.locked || s.tutorial !== null} title="1日だけ進める" onClick={() => store.advanceOneDay()}>＋1日</button>
            )}
            {today ? (
              <button type="button" className="primary" disabled={s.locked || s.screen.name === 'match'} onClick={() => store.open({ name: 'match' })}>
                試合へ ▶
              </button>
            ) : (
              <button type="button" className="primary" data-tutorial="advance" disabled={s.locked || s.tutorial !== null} onClick={() => store.advance()}>
                次の出来事まで進める ▶
              </button>
            )}
          </div>
        </header>
        {s.saveError && (
          <div className="save-error" role="alert">
            <span>保存できませんでした（{s.saveError}）。ブラウザのプライベートモードや、空き容量の不足が考えられます。進めた分を失わないように、ファイルに書き出してください。</span>
            <button type="button" className="secondary small" onClick={() => downloadSave(game)}>ファイルに書き出す</button>
            <button type="button" className="secondary small" disabled={s.locked} onClick={() => void store.saveNow()}>もう一度保存する</button>
          </div>
        )}
        <main className="content">
          <CoachBubble />
          {children}
        </main>
      </div>
      <TutorialOverlay />
      <MomentOverlay />
    </div>
  );
}
