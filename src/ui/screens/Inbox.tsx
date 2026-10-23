// 受信箱：FMのようなメール形式の知らせ（要件定義書「時間の進め方」「画面の一覧」）
// 返事が必要な知らせ（選手からの申し出、記者会見、スポンサーの提案）と、オーナーなどの話は、ここから会話画面を開く。
// 1.1：種類ごとのタブ（すべて、返事待ち、選手、試合、お金、移籍、練習）で絞れる。タブには未読の数を出す。

import { useEffect, useState } from 'react';
import { markAllRead, markRead } from '../../game/inbox';
import type { InboxCategory, InboxMessage } from '../../game/types';
import { BidActions } from '../components/BidActions';
import { Panel } from '../components/bits';
import { formatDate, INBOX_CATEGORY_LABEL } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

type InboxTab = 'all' | 'reply' | 'player' | 'match' | 'money' | 'transfer' | 'training';

const TABS: { key: InboxTab; label: string; categories?: InboxCategory[] }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'reply', label: '返事待ち' },
  { key: 'player', label: '選手', categories: ['player', 'medical', 'discipline'] },
  { key: 'match', label: '試合', categories: ['match', 'media', 'league'] },
  { key: 'money', label: 'お金', categories: ['finance', 'club'] },
  { key: 'transfer', label: '移籍', categories: ['transfer', 'scout'] },
  { key: 'training', label: '練習', categories: ['training'] },
];

const waitingReply = (m: InboxMessage): boolean => m.action !== undefined && m.action !== null && !m.resolved;

function inTab(m: InboxMessage, tab: InboxTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'reply') return waitingReply(m);
  return TABS.find((t) => t.key === tab)?.categories?.includes(m.category) ?? false;
}

export function Inbox({ initialId }: { initialId?: string }) {
  useTutorial('inbox');
  const game = useGame();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [tab, setTab] = useState<InboxTab>('all');
  const messages = game.inbox.filter((m) => inTab(m, tab) && (!onlyUnread || !m.read || m.id === initialId));
  const firstUnread = game.inbox.find((m) => !m.read && m.important) ?? game.inbox.find((m) => !m.read);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId ?? firstUnread?.id ?? game.inbox[0]?.id);
  const selected = game.inbox.find((m) => m.id === selectedId);

  const open = (message: InboxMessage) => setSelectedId(message.id);

  // 開いている知らせは既読にする（画面を開いたときに選ばれている知らせも）
  useEffect(() => {
    if (selected && !selected.read) store.update((g) => markRead(g, selected.id));
  }, [selected]);

  return (
    <div className="page">
      <div className="toolbar">
        <h1>受信箱</h1>
        <label className="inline small">
          <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
          未読だけ
        </label>
        <button type="button" className="secondary small" onClick={() => store.update(markAllRead)}>すべて既読にする</button>
      </div>
      <div className="segmented wrap inbox-tabs" data-tutorial="inbox-tabs">
        {TABS.map((t) => {
          const count = t.key === 'reply' ? game.inbox.filter(waitingReply).length : game.inbox.filter((m) => !m.read && inTab(m, t.key)).length;
          return (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}
              title={t.key === 'reply' ? '返事を待っている知らせの数' : '未読の数'}>
              {t.label}{count > 0 && <span className={`tab-count${t.key === 'reply' ? ' warn' : ''}`}>{count}</span>}
            </button>
          );
        })}
      </div>
      {game.inbox.length === 0 ? <Panel><p className="muted">知らせはまだありません。</p></Panel> : (
        <div className="inbox">
          <ul className="inbox-list" data-tutorial="inbox-list">
            {messages.map((m) => (
              <li key={m.id}>
                <button type="button" className={`inbox-item${m.read ? '' : ' unread'}${m.id === selectedId ? ' selected' : ''}`} onClick={() => open(m)}>
                  <span className="inbox-meta">
                    {!m.read && <span className={`inbox-dot${m.important ? ' important' : ''}`} />}
                    <span>{formatDate(m.date, false)}</span>
                    <span className="tag">{INBOX_CATEGORY_LABEL[m.category]}</span>
                    <span>{m.from}</span>
                    {m.action && !m.resolved && <span className="tag tag-warn">返事を待っています</span>}
                  </span>
                  <span className="inbox-subject">{m.subject}</span>
                </button>
              </li>
            ))}
            {messages.length === 0 && <li className="muted" style={{ padding: 12 }}>{tab === 'reply' ? '返事を待っている知らせはありません。' : onlyUnread ? '未読の知らせはありません。' : 'この種類の知らせはありません。'}</li>}
          </ul>
          {selected ? <MessageView message={selected} /> : <Panel><p className="muted">知らせを選んでください。</p></Panel>}
        </div>
      )}
    </div>
  );
}

function MessageView({ message }: { message: InboxMessage }) {
  const game = useGame();
  const player = message.playerId ? game.players[message.playerId] : undefined;
  const fixture = message.fixtureId ? game.fixtures.find((f) => f.id === message.fixtureId) : undefined;
  const action = message.action;
  const pendingRequest = action?.kind === 'playerRequest' && !message.resolved && game.requests.some((r) => r.id === action.requestId);
  const pendingPress = action?.kind === 'press' && !message.resolved && fixture?.result === null;
  const pendingSponsor = action?.kind === 'sponsorOffer' && !message.resolved && (game.clubs[game.manager.clubId]?.finance.sponsorOffers.length ?? 0) > 0;

  return (
    <Panel title={message.subject} tutorial="inbox-body">
      <div className="muted small" style={{ marginBottom: 10 }}>
        {formatDate(message.date)}　差出人：{message.from}　{INBOX_CATEGORY_LABEL[message.category]}
      </div>
      <p className="message-body">{message.body}</p>
      <div className="button-row">
        {pendingRequest && action?.kind === 'playerRequest' && player && (
          <button type="button" className="primary" onClick={() => store.navigate({ name: 'talk', playerId: player.id, requestId: action.requestId })}>
            {player.name}と話をする
          </button>
        )}
        {pendingPress && action?.kind === 'press' && (
          <button type="button" className="primary" onClick={() => store.navigate({ name: 'press', fixtureId: action.fixtureId })}>記者会見に出る</button>
        )}
        {pendingSponsor && (
          <button type="button" className="primary" onClick={() => store.navigate({ name: 'conversation', messageId: message.id })}>営業担当と話す（提案を選ぶ）</button>
        )}
        {message.topic && message.topic !== 'sponsorOffer' && (
          <button type="button" className="primary" onClick={() => store.navigate({ name: 'conversation', messageId: message.id })}>{message.from}と話す</button>
        )}
        {action?.kind === 'transferBid' && !message.resolved && (() => {
          const bid = game.bids?.find((b) => b.id === action.bidId);
          return bid ? <BidActions game={game} bid={bid} /> : null;
        })()}
        {action && message.resolved && <span className="muted small">対応済み</span>}
        {message.category === 'finance' && <button type="button" className="secondary" onClick={() => store.open({ name: 'management' })}>経営の画面へ</button>}
        {message.category === 'transfer' && <button type="button" className="secondary" onClick={() => store.open({ name: 'transfers' })}>移籍の画面へ</button>}
        {message.category === 'scout' && <button type="button" className="secondary" onClick={() => store.open({ name: 'scouting' })}>スカウトの画面へ</button>}
        {player && <button type="button" className="secondary" onClick={() => store.navigate({ name: 'player', id: player.id })}>選手を見る</button>}
        {message.category === 'training' && <button type="button" className="secondary" onClick={() => store.open({ name: 'training' })}>練習の画面へ</button>}
        {message.category === 'medical' && <button type="button" className="secondary" onClick={() => store.open({ name: 'tactics' })}>メンバーを見直す</button>}
      </div>
    </Panel>
  );
}
