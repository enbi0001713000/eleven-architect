// 移籍：選手を探す、交渉、自分の選手（移籍リストとレンタル）、契約の更新、契約満了の選手、移籍の記録。
// 要件定義書 フェーズ4「移籍交渉」「契約の更新」「レンタル移籍」（フェーズ4-A、4-B）。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import type { Position } from '../../engine/types';
import { AGENT_STYLES, CONTRACT } from '../../game/contractBalance';
import {
  agentOf, canDelegate, expiringPlayers, formatValueRange, isDelegated, marketPlayers, marketValueRange, projectedSquad, salaryText, setDelegation,
  talkStatus, wageRoom,
} from '../../game/contracts';
import { monthDay } from '../../game/dates';
import { yenText } from '../../game/finance';
import { knowledgeOf, viewAttribute } from '../../game/knowledge';
import { SQUAD_ROLE_LABEL } from '../../game/morale';
import { LEAGUE_RULES } from '../../game/rules';
import { isOpen, nextWindowStart, setListing, transferBudgetLeft, windowOpen } from '../../game/transfers';
import type { Club, GameState, PlayerRecord, TransferKind } from '../../game/types';
import { BidActions, bidStatusLabel, bidSummary } from '../components/BidActions';
import { AttributeValue, ClubLink, Panel } from '../components/bits';
import { formatDate, POSITION_LABEL, POSITION_ORDER } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

export type TransfersTab = 'search' | 'bids' | 'mine' | 'renewals' | 'market' | 'history';

const TABS: { key: TransfersTab; label: string }[] = [
  { key: 'search', label: '選手を探す' },
  { key: 'bids', label: '交渉' },
  { key: 'mine', label: '自分の選手' },
  { key: 'renewals', label: '契約の更新' },
  { key: 'market', label: '契約満了の選手' },
  { key: 'history', label: '移籍の記録' },
];

/** 今の時期にできること */
function seasonNote(date: string): string {
  const md = monthDay(date);
  const window = windowOpen(date)
    ? '今は移籍期間です。合意した移籍は、すぐに成立します。'
    : `今は移籍期間の外です。合意した移籍は、次の移籍期間（${formatDate(nextWindowStart(date), false)}）に成立します。`;
  if (md >= CONTRACT.renewalOpens && md <= CONTRACT.renewalCloses) return `${window}今年で契約が切れる選手と、更新の交渉ができます（11月30日まで）。`;
  if (md.startsWith('12-')) return `${window}契約満了の選手と、仮の契約ができます（1月1日に加入）。`;
  if (md <= CONTRACT.freeAgencyEnds) return `${window}所属のない選手を獲ると、すぐに加入します（3月27日まで）。`;
  return window;
}

export function Transfers({ initialTab }: { initialTab?: TransfersTab }) {
  useTutorial('transfers', 'transferMarket');
  const game = useGame();
  const md = monthDay(game.date);
  const pending = (game.bids ?? []).some((b) => b.sellerId === game.manager.clubId && b.status === 'waiting')
    || (game.bids ?? []).some((b) => b.buyerId === game.manager.clubId && (b.status === 'countered' || b.status === 'accepted'));
  const fallback: TransfersTab = pending ? 'bids' : md.startsWith('12-') || (md <= CONTRACT.freeAgencyEnds && (game.freeAgents ?? []).length > 0) ? 'market'
    : md >= CONTRACT.renewalOpens && md <= CONTRACT.renewalCloses ? 'renewals' : 'search';
  const [tab, setTab] = useState<TransfersTab>(initialTab ?? fallback);
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  return (
    <div className="page">
      <div className="toolbar">
        <h1>移籍</h1>
        <div className="segmented" data-tutorial="transfer-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <Summary game={game} club={club} />
      <div className="notice-box">{seasonNote(game.date)}</div>
      {tab === 'search' && <Search game={game} />}
      {tab === 'bids' && <Bids game={game} />}
      {tab === 'mine' && <MyPlayers game={game} />}
      {tab === 'renewals' && <Renewals game={game} />}
      {tab === 'market' && <Market game={game} />}
      {tab === 'history' && <History game={game} />}
    </div>
  );
}

function Summary({ game, club }: { game: GameState; club: Club }) {
  const room = wageRoom(game, club.id);
  const squad = projectedSquad(game, club.id).length;
  return (
    <div className="stat-tiles" data-tutorial="transfer-tiles">
      <div className="stat-tile">
        <span className="muted small">年俸予算の残り</span>
        <strong className={room < 0 ? 'tone-low' : ''}>{yenText(room)}</strong>
        <span className="muted small">年俸予算 {yenText(club.finance.budget.wages)}</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">来季の登録人数（見込み）</span>
        <strong>{squad}人</strong>
        <span className="muted small">上限 {LEAGUE_RULES.squadMax}人</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">移籍予算の残り</span>
        <strong className={transferBudgetLeft(club) < 0 ? 'tone-low' : ''}>{yenText(transferBudgetLeft(club))}</strong>
        <span className="muted small">移籍予算 {yenText(club.finance.budget.transfers)}</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">今年で契約が切れる選手</span>
        <strong>{expiringPlayers(game).filter((p) => !p.leaving).length}人</strong>
        <span className="muted small">締め切り 11月30日</span>
      </div>
    </div>
  );
}

function AgentCell({ game, player }: { game: GameState; player: PlayerRecord }) {
  const agent = agentOf(game, player);
  return <span title={`代理人 ${agent.name}`}>{agent.name}<span className="muted small">（{AGENT_STYLES[agent.style].label}）</span></span>;
}

function renewalState(game: GameState, player: PlayerRecord): string {
  if (player.leaving) return player.joining ? `${game.clubs[player.joining.clubId]?.name ?? ''}へ移籍（1月1日）` : '契約満了で退団';
  const talk = game.contractTalks?.[player.id];
  if (talk?.closedUntil && game.date < talk.closedUntil) return `決裂（${formatDate(talk.closedUntil, false)}まで話せない）`;
  if (isDelegated(game, player)) return '強化部に任せる';
  if (talk?.lastAsk) return `交渉中（希望 ${salaryText(talk.lastAsk)}）`;
  return '交渉が必要';
}

function Renewals({ game }: { game: GameState }) {
  const players = expiringPlayers(game);
  return (
    <Panel title={`今年で契約が切れる選手（${players.length}人）`} tutorial="renewal-list">
      {players.length === 0 ? <p className="muted">今年で契約が切れる選手はいません。</p> : (
        <div className="table-wrap"><table className="data-table compact">
          <thead>
            <tr><th>選手</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th>役割</th><th className="num">年俸</th><th className="num">市場価値</th><th>代理人</th><th>状況</th><th>強化部に任せる</th><th /></tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const check = talkStatus(game, p.id);
              return (
                <tr key={p.id}>
                  <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                  <td>{POSITION_LABEL[p.position]}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">{overallRating(p).toFixed(1)}</td>
                  <td>{p.contract ? SQUAD_ROLE_LABEL[p.contract.role] : '-'}</td>
                  <td className="num">{yenText(p.contract?.salary ?? 0)}</td>
                  <td className="num">{formatValueRange(marketValueRange(game, p))}</td>
                  <td><AgentCell game={game} player={p} /></td>
                  <td className="wrap small">{renewalState(game, p)}</td>
                  <td>
                    {canDelegate(p) && !p.leaving ? (
                      <input type="checkbox" checked={isDelegated(game, p)} aria-label={`${p.name}の更新を強化部に任せる`}
                        onChange={(e) => store.update((g) => setDelegation(g, p.id, e.target.checked))} />
                    ) : <span className="muted small">自分で</span>}
                  </td>
                  <td>
                    <button type="button" className="primary small" disabled={!check.ok} title={check.ok ? '' : check.reason}
                      onClick={() => store.navigate({ name: 'contract', playerId: p.id })}>交渉する</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <p className="muted small">
        主力とローテーションの選手は、監督が自分で交渉します。控えと若手は強化部に任せられ、12月1日に相場の年俸で更新するか、序列の低いベテランなら更新しません。
        11月30日までに更新しなかった選手は、契約満了で退団します。
      </p>
    </Panel>
  );
}

function Market({ game }: { game: GameState }) {
  const [position, setPosition] = useState<Position | ''>('');
  const myId = game.manager.clubId;
  const players = marketPlayers(game).filter((p) => p.clubId !== myId || p.leaving)
    .filter((p) => !position || p.position === position)
    .sort((a, b) => overallRating(b) - overallRating(a));
  const joining = Object.values(game.players).filter((p) => p.joining?.clubId === myId);
  return (
    <>
      {joining.length > 0 && (
        <Panel title={`仮の契約をした選手（${joining.length}人）`}>
          <ul className="plain-list">
            {joining.map((p) => <li key={p.id}>{p.name}（{POSITION_LABEL[p.position]}、{p.age}歳）　年俸 {yenText(p.joining!.contract.salary)}　{p.joining!.contract.endYear}年まで　1月1日に加入</li>)}
          </ul>
        </Panel>
      )}
      <Panel title={`契約満了の選手（${players.length}人）`} tutorial="market-list" actions={
        <select value={position} onChange={(e) => setPosition(e.target.value as Position | '')} aria-label="ポジションで絞る">
          <option value="">すべてのポジション</option>
          {POSITION_ORDER.map((pos) => <option key={pos} value={pos}>{POSITION_LABEL[pos]}</option>)}
        </select>
      }>
        {players.length === 0 ? (
          <p className="muted">今は、獲れる契約満了の選手はいません。契約満了の選手は12月1日に決まり、3月27日まで獲れます。</p>
        ) : (
          <div className="table-wrap"><table className="data-table compact">
            <thead>
              <tr><th>選手</th><th>今の所属</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th className="num">市場価値</th><th>代理人</th><th /></tr>
            </thead>
            <tbody>
              {players.slice(0, 80).map((p) => {
                const check = talkStatus(game, p.id);
                return (
                  <tr key={p.id}>
                    <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                    <td>{p.clubId ? <ClubLink game={game} clubId={p.clubId} short /> : <span className="muted">所属なし</span>}</td>
                    <td>{POSITION_LABEL[p.position]}</td>
                    <td className="num">{p.age}</td>
                    <td className="num"><AttributeValue view={viewAttribute(overallRating(p), knowledgeOf(game, p), `${p.id}:overall`)} /></td>
                    <td className="num">{formatValueRange(marketValueRange(game, p))}</td>
                    <td><AgentCell game={game} player={p} /></td>
                    <td>
                      <button type="button" className="primary small" disabled={!check.ok} title={check.ok ? '' : check.reason}
                        onClick={() => store.navigate({ name: 'contract', playerId: p.id })}>交渉する</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="muted small">契約満了の選手には、移籍金はかかりません。年俸と代理人の手数料だけです。他クラブも獲りに来るので、早いほど有利です。</p>
      </Panel>
    </>
  );
}

const mid = (v: { low: number; high: number }): number => (v.low + v.high) / 2;

function listingLabel(p: PlayerRecord): string {
  if (p.loan) return 'レンタル中';
  if (p.listed === 'sale') return '移籍リスト';
  if (p.listed === 'loan') return 'レンタル可';
  return '';
}

function Search({ game }: { game: GameState }) {
  const [position, setPosition] = useState<Position | ''>('');
  const [maxAge, setMaxAge] = useState(40);
  const [minOverall, setMinOverall] = useState(10);
  const [onlyListed, setOnlyListed] = useState(false);
  const myId = game.manager.clubId;
  const rows = Object.values(game.players)
    .filter((p) => p.clubId && p.clubId !== myId && !p.retiring && (!position || p.position === position) && p.age <= maxAge && (!onlyListed || p.listed))
    .map((p) => ({ p, view: viewAttribute(overallRating(p), knowledgeOf(game, p), `${p.id}:overall`), value: marketValueRange(game, p) }))
    .filter((r) => mid(r.view) >= minOverall)
    .sort((a, b) => mid(b.view) - mid(a.view) || mid(b.value) - mid(a.value))
    .slice(0, 80);
  return (
    <Panel title="他クラブの選手" tutorial="transfer-search" actions={
      <div className="inline-form">
        <select value={position} onChange={(e) => setPosition(e.target.value as Position | '')} aria-label="ポジション">
          <option value="">すべてのポジション</option>
          {POSITION_ORDER.map((pos) => <option key={pos} value={pos}>{POSITION_LABEL[pos]}</option>)}
        </select>
        <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} aria-label="年齢">
          {[40, 30, 27, 24, 21].map((a) => <option key={a} value={a}>{a === 40 ? 'すべての年齢' : `${a}歳以下`}</option>)}
        </select>
        <select value={minOverall} onChange={(e) => setMinOverall(Number(e.target.value))} aria-label="総合力">
          {[10, 12, 13, 14, 15, 16].map((o) => <option key={o} value={o}>{o === 10 ? 'すべての総合力' : `総合力${o}以上`}</option>)}
        </select>
        <label className="inline small nowrap"><input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} /> リストの選手だけ</label>
      </div>
    }>
      <div className="table-wrap"><table className="data-table compact">
        <thead>
          <tr><th>選手</th><th>クラブ</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th className="num">市場価値</th><th className="num">契約</th><th className="num">違約金</th><th /><th /></tr>
        </thead>
        <tbody>
          {rows.map(({ p, view, value }) => (
            <tr key={p.id}>
              <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
              <td><ClubLink game={game} clubId={p.clubId!} short /></td>
              <td>{POSITION_LABEL[p.position]}</td>
              <td className="num">{p.age}</td>
              <td className="num"><AttributeValue view={view} /></td>
              <td className="num">{formatValueRange(value)}</td>
              <td className="num">{p.contract ? `${p.contract.endYear}年` : '-'}</td>
              <td className="num">{p.contract?.releaseClause != null ? yenText(p.contract.releaseClause) : 'なし'}</td>
              <td className="small">{p.leaving ? '契約満了' : listingLabel(p)}</td>
              <td>
                <button type="button" className="primary small" disabled={!!p.leaving || !!p.loan}
                  onClick={() => store.navigate({ name: 'bid', playerId: p.id })}>獲得の交渉</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {rows.length === 0 && <p className="muted">条件に合う選手はいません。</p>}
      <p className="muted small">他クラブの選手の総合力と市場価値は、知識度に応じた幅で見えます（スカウトはフェーズ4-C）。契約満了の選手は「契約満了の選手」から、移籍金なしで話せます。</p>
    </Panel>
  );
}

function Bids({ game }: { game: GameState }) {
  const myId = game.manager.clubId;
  const bids = (game.bids ?? []).filter((b) => b.buyerId === myId || b.sellerId === myId).slice().reverse();
  const open = bids.filter(isOpen);
  const closed = bids.filter((b) => !isOpen(b)).slice(0, 20);
  const row = (b: (typeof bids)[number]) => {
    const player = game.players[b.playerId];
    return (
      <li key={b.id} className="bid-row">
        <div>
          <strong>{player ? <button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: player.id })}>{player.name}</button> : '（去った選手）'}</strong>
          <span className="muted small">　{b.buyerId === myId ? '獲得' : '放出'}　{bidSummary(game, b)}　{formatDate(b.date, false)}〜</span>
          <div className="small">{bidStatusLabel(b, myId)}</div>
        </div>
        <BidActions game={game} bid={b} />
      </li>
    );
  };
  return (
    <>
      <Panel title={`進んでいる交渉（${open.length}）`} tutorial="transfer-bids">
        {open.length === 0 ? <p className="muted">今は、進んでいる交渉はありません。「選手を探す」から申し込めます。</p> : <ul className="bid-list">{open.map(row)}</ul>}
      </Panel>
      {closed.length > 0 && (
        <Panel title="終わった交渉">
          <ul className="bid-list">{closed.map(row)}</ul>
        </Panel>
      )}
    </>
  );
}

function MyPlayers({ game }: { game: GameState }) {
  const myId = game.manager.clubId;
  const mine = (game.clubs[myId]?.playerIds ?? []).map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined)
    .sort((a, b) => overallRating(b) - overallRating(a));
  const lent = Object.values(game.players).filter((p) => p.loan?.fromClubId === myId);
  return (
    <>
      <Panel title="自分の選手" tutorial="transfer-mine">
        <div className="table-wrap"><table className="data-table compact">
          <thead>
            <tr><th>選手</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th>役割</th><th className="num">市場価値</th><th className="num">違約金</th><th>リスト</th></tr>
          </thead>
          <tbody>
            {mine.map((p) => (
              <tr key={p.id}>
                <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                <td>{POSITION_LABEL[p.position]}</td>
                <td className="num">{p.age}</td>
                <td className="num">{overallRating(p).toFixed(1)}</td>
                <td>{p.contract ? SQUAD_ROLE_LABEL[p.contract.role] : '-'}</td>
                <td className="num">{formatValueRange(marketValueRange(game, p))}</td>
                <td className="num">{p.contract?.releaseClause != null ? yenText(p.contract.releaseClause) : 'なし'}</td>
                <td>
                  {p.loan ? <span className="muted small">{game.clubs[p.loan.fromClubId]?.shortName}から借りている</span> : p.leaving ? <span className="muted small">契約満了で退団</span> : (
                    <select value={p.listed ?? ''} aria-label={`${p.name}のリスト`} onChange={(e) => store.update((g) => setListing(g, p.id, (e.target.value || null) as 'sale' | 'loan' | null))}>
                      <option value="">載せない</option>
                      <option value="sale">移籍リスト（売る）</option>
                      <option value="loan">レンタルに出す</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="muted small">移籍リストに載せると、市場価値より安くても他クラブが申し込んでくるようになります。レンタルに出すと、出番のありそうなクラブから申し込みが届きます（移籍期間の中）。</p>
      </Panel>
      {lent.length > 0 && (
        <Panel title={`レンタルに出している選手（${lent.length}人）`}>
          <ul className="plain-list">
            {lent.map((p) => <li key={p.id}>{p.name}（{POSITION_LABEL[p.position]}、{p.age}歳）　{game.clubs[p.clubId ?? '']?.name}へ　{formatDate(p.loan!.until, false)}まで</li>)}
          </ul>
        </Panel>
      )}
    </>
  );
}

const KIND_LABEL: Record<TransferKind, string> = {
  transfer: '移籍', free: '契約満了', loan: 'レンタル', loanReturn: 'レンタルから戻る', fromAbroad: '海外から', abroad: '海外へ',
};

function History({ game }: { game: GameState }) {
  const [onlyMine, setOnlyMine] = useState(false);
  const myId = game.manager.clubId;
  const records = (game.transferHistory ?? []).filter((r) => r.kind !== 'loanReturn' && (!onlyMine || r.fromClubId === myId || r.toClubId === myId)).slice(0, 120);
  const name = (id: string | null, kind: TransferKind, side: 'from' | 'to') => {
    if (id) return <ClubLink game={game} clubId={id} short />;
    if ((kind === 'abroad' && side === 'to') || (kind === 'fromAbroad' && side === 'from')) return <span className="muted">海外</span>;
    return <span className="muted">所属なし</span>;
  };
  return (
    <Panel title="移籍の記録" tutorial="transfer-history" actions={
      <label className="inline small nowrap"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> 自分のクラブだけ</label>
    }>
      {records.length === 0 ? <p className="muted">まだ移籍はありません。</p> : (
        <div className="table-wrap"><table className="data-table compact">
          <thead><tr><th>日付</th><th>選手</th><th>種類</th><th>移籍元</th><th>移籍先</th><th className="num">移籍金</th></tr></thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={`${r.playerId}-${r.date}-${i}`}>
                <td>{formatDate(r.date)}</td>
                <td>{game.players[r.playerId] ? <button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: r.playerId })}>{r.playerName}</button> : r.playerName}</td>
                <td>{KIND_LABEL[r.kind]}</td>
                <td>{name(r.fromClubId, r.kind, 'from')}</td>
                <td>{name(r.toClubId, r.kind, 'to')}</td>
                <td className="num">{r.fee > 0 ? yenText(r.fee) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="muted small">契約満了での移籍は、新しいクラブに加わった日に記録します。</p>
    </Panel>
  );
}
