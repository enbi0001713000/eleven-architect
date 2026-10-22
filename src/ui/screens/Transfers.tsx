// 移籍：契約の更新（今年で契約が切れる自分の選手）と、契約満了の選手（12月〜3月）。要件定義書 フェーズ4「契約の更新」、フェーズ4-A。
// 移籍金のある移籍とレンタルはフェーズ4-Bで足す。

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
import type { Club, GameState, PlayerRecord } from '../../game/types';
import { AttributeValue, ClubLink, Panel } from '../components/bits';
import { formatDate, POSITION_LABEL, POSITION_ORDER } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

type Tab = 'renewals' | 'market';

/** 今の時期にできること */
function seasonNote(date: string): string {
  const md = monthDay(date);
  if (md >= CONTRACT.renewalOpens && md <= CONTRACT.renewalCloses) return '今年で契約が切れる選手と、更新の交渉ができます（11月30日まで）。';
  if (md.startsWith('12-')) return '契約満了の選手と、仮の契約ができます。1月1日に加入します。';
  if (md <= CONTRACT.freeAgencyEnds) return '所属のない選手を獲ると、すぐに加入します（3月27日まで）。';
  return '契約の更新の交渉は7月1日から、契約満了の選手の獲得は12月からです。';
}

export function Transfers({ initialTab }: { initialTab?: Tab }) {
  useTutorial('transfers');
  const game = useGame();
  const md = monthDay(game.date);
  const offseason = md.startsWith('12-') || md <= CONTRACT.freeAgencyEnds;
  const [tab, setTab] = useState<Tab>(initialTab ?? (offseason ? 'market' : 'renewals'));
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  return (
    <div className="page">
      <div className="toolbar">
        <h1>移籍</h1>
        <div className="segmented" data-tutorial="transfer-tabs">
          <button type="button" className={tab === 'renewals' ? 'active' : ''} onClick={() => setTab('renewals')}>契約の更新</button>
          <button type="button" className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>契約満了の選手</button>
        </div>
      </div>
      <Summary game={game} club={club} />
      <div className="notice-box">{seasonNote(game.date)}</div>
      {tab === 'renewals' && <Renewals game={game} />}
      {tab === 'market' && <Market game={game} />}
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
        <table className="data-table compact">
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
        </table>
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
          <table className="data-table compact">
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
          </table>
        )}
        <p className="muted small">契約満了の選手には、移籍金はかかりません。年俸と代理人の手数料だけです。他クラブも獲りに来るので、早いほど有利です。</p>
      </Panel>
    </>
  );
}
