// 選手の詳細：能力、記録、契約、スカウトレポート（フェーズ4）をタブで切り替える

import { useState } from 'react';
import { overallRating, positionRating } from '../../engine/ratings';
import { ATTRIBUTE_KEYS, type AttributeKey, type Position } from '../../engine/types';
import { GOALKEEPING_KEYS, INJURY_TYPES } from '../../game/balance';
import { injuryName } from '../../game/condition';
import { knowledgeOf, potentialStars, viewAttribute } from '../../game/knowledge';
import { expectedPlayingTime, isUnhappyWithPlayingTime, SQUAD_ROLE_LABEL } from '../../game/morale';
import { talkCooldownLeft } from '../../game/talks';
import { LEAGUE_RULES } from '../../game/rules';
import { averageRating } from '../../game/season';
import { AttributeValue, Bar, ClubLink, Condition, Fatigue, Morale, Panel, Rating, Stars, StatusTags } from '../components/bits';
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABEL, formatDate, formatYen, POSITION_LABEL, POSITION_NAME, POSITION_ORDER } from '../format';
import { store, useGame } from '../store';

type Tab = 'attributes' | 'records' | 'contract' | 'scout';

export function PlayerDetail({ id }: { id: string }) {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('attributes');
  const player = game.players[id];
  if (!player) return <div className="page"><p>選手が見つかりません。</p></div>;
  const knowledge = knowledgeOf(game, player);
  const mine = player.clubId === game.manager.clubId;
  const view = (value: number, key: string) => viewAttribute(value, knowledge, `${player.id}:${key}`);
  const s = player.season;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <div className="player-head">
          <div className="player-number">{player.squadNumber ?? '-'}</div>
          <div>
            <h1>{player.name}</h1>
            <div className="muted">
              {POSITION_NAME[player.position]}　{player.age}歳　{player.nationality}　利き足：{player.foot === 'left' ? '左' : player.foot === 'right' ? '右' : '両足'}
            </div>
            <div>{player.clubId ? <ClubLink game={game} clubId={player.clubId} /> : <span className="muted">所属なし（海外）</span>}</div>
          </div>
          <div className="player-overall">
            <span className="muted small">総合力</span>
            <AttributeValue view={view(overallRating(player), 'overall')} />
            {!mine && <span className="muted small">知識度 {knowledge}%</span>}
          </div>
        </div>
      </header>

      {player.discipline.suspendedMatches > 0 && <div className="warning">出場停止：残り{player.discipline.suspendedMatches}試合</div>}
      {mine && player.status.injury && (
        <div className="warning">{injuryName(player.status.injury)}で離脱中：残り{player.status.injury.daysLeft}日（全治{player.status.injury.days}日）</div>
      )}

      {mine && (
        <Panel title="状態" actions={
          <button type="button" className="secondary small" disabled={talkCooldownLeft(game, player) > 0}
            onClick={() => store.navigate({ name: 'talk', playerId: player.id })}>
            個人面談{talkCooldownLeft(game, player) > 0 ? `（あと${talkCooldownLeft(game, player)}日）` : ''}
          </button>}>
          <div className="grid-2">
            <dl className="facts">
              <dt>コンディション</dt><dd><Bar value={player.status.condition} /> <Condition value={player.status.condition} /></dd>
              <dt>蓄積疲労</dt><dd><Bar value={player.status.fatigue} invert /> <Fatigue value={player.status.fatigue} /></dd>
              <dt>モラル</dt><dd><Morale value={player.status.morale} /></dd>
              <dt>ケガ</dt><dd>{player.status.injury ? injuryName(player.status.injury) : 'なし'} <StatusTags player={player} /></dd>
            </dl>
            <dl className="facts">
              <dt>約束した役割</dt><dd>{player.contract ? SQUAD_ROLE_LABEL[player.contract.role] : '-'}</dd>
              <dt>出場機会</dt>
              <dd>最近 {Math.round(player.status.playingTime * 100)}%（目安 {Math.round(expectedPlayingTime(player) * 100)}%）{isUnhappyWithPlayingTime(player) && <span className="tag tag-warn" style={{ marginLeft: 6 }}>不満</span>}</dd>
              <dt>伸びしろ</dt><dd><Stars count={potentialStars(player)} /></dd>
              <dt>戦術への慣れ</dt><dd><Bar value={player.status.integration} /> {Math.round(player.status.integration)}%</dd>
              <dt>練習の重点</dt>
              <dd>
                <select value={player.trainingFocus ?? ''} onChange={(e) => store.update((g) => {
                  const p = g.players[player.id];
                  if (p) p.trainingFocus = (e.target.value || null) as AttributeKey | null;
                })}>
                  <option value="">なし</option>
                  {ATTRIBUTE_KEYS.filter((k) => player.position === 'GK' || !GOALKEEPING_KEYS.includes(k)).map((k) => (
                    <option key={k} value={k}>{ATTRIBUTE_LABEL[k]}</option>
                  ))}
                </select>
              </dd>
            </dl>
          </div>
        </Panel>
      )}

      <div className="segmented tabs">
        <button type="button" className={tab === 'attributes' ? 'active' : ''} onClick={() => setTab('attributes')}>能力</button>
        <button type="button" className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>記録</button>
        <button type="button" className={tab === 'contract' ? 'active' : ''} onClick={() => setTab('contract')}>契約</button>
        <button type="button" disabled title="フェーズ4で追加">スカウトレポート</button>
      </div>

      {tab === 'attributes' && (
        <div className="grid-4">
          {ATTRIBUTE_GROUPS.map((group) => (
            <Panel key={group.label} title={group.label}>
              <table className="attr-table">
                <tbody>
                  {group.keys.map((key) => (
                    <tr key={key}>
                      <td>{ATTRIBUTE_LABEL[key]}</td>
                      <td className="num"><AttributeValue view={view(player.attributes[key], key)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
          {mine && (
            <Panel title="ポジションの適性">
              <table className="attr-table">
                <tbody>
                  {POSITION_ORDER.map((pos: Position) => (
                    <tr key={pos} className={pos === player.position ? 'highlight' : ''}>
                      <td title={POSITION_NAME[pos]}>{POSITION_LABEL[pos]}</td>
                      <td className="num"><AttributeValue view={view(positionRating(player, pos), `pos-${pos}`)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
          {!mine && (
            <Panel title="能力の見え方">
              <p className="small">他クラブの選手の能力は、幅（例：12〜16）でしか分かりません。スカウトで調べると正確になります（フェーズ4）。</p>
            </Panel>
          )}
        </div>
      )}

      {tab === 'records' && player.career.length > 0 && (
        <Panel title="経歴">
          <table className="data-table compact">
            <thead><tr><th>年</th><th>クラブ</th><th className="num">出場</th><th className="num">得点</th><th className="num">アシスト</th><th className="num">平均評価</th></tr></thead>
            <tbody>
              {[...player.career].reverse().map((c) => (
                <tr key={c.year}>
                  <td>{c.year}</td>
                  <td>{c.clubId ? <ClubLink game={game} clubId={c.clubId} short /> : '-'}</td>
                  <td className="num">{c.appearances}</td>
                  <td className="num">{c.goals}</td>
                  <td className="num">{c.assists}</td>
                  <td className="num"><Rating value={c.averageRating} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {tab === 'records' && mine && (
        <Panel title="ケガの履歴">
          {player.injuryHistory.length === 0 ? <p className="muted">ケガの記録はありません。</p> : (
            <ul className="notice-list">
              {player.injuryHistory.map((h, i) => (
                <li key={i}><span className="muted small">{formatDate(h.date)}</span>{h.part}の{INJURY_TYPES[h.kind].label}（全治{h.days}日）</li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {tab === 'records' && (
        <Panel title={`${game.season.year}年シーズン`}>
          <dl className="facts">
            <dt>出場</dt><dd>{s.appearances}試合（先発{s.starts}）</dd>
            <dt>出場時間</dt><dd>{s.minutes}分</dd>
            <dt>得点</dt><dd>{s.goals}</dd>
            <dt>アシスト</dt><dd>{s.assists}</dd>
            <dt>警告</dt><dd>{s.yellowCards}（累積 {player.discipline.yellowAccumulation}/{LEAGUE_RULES.yellowLimit}）</dd>
            <dt>退場</dt><dd>{s.redCards}</dd>
            <dt>平均評価点</dt><dd><Rating value={averageRating(s)} /></dd>
          </dl>
        </Panel>
      )}

      {tab === 'contract' && (
        <Panel title="契約">
          {player.contract ? (
            <dl className="facts">
              <dt>年俸</dt><dd>{mine ? formatYen(player.contract.salary) : '非公開'}</dd>
              <dt>契約満了</dt><dd>{player.contract.endYear}年</dd>
              {mine && <><dt>約束した役割</dt><dd>{SQUAD_ROLE_LABEL[player.contract.role]}</dd></>}
            </dl>
          ) : <p className="muted">契約はありません。</p>}
          <p className="muted small">契約の交渉はフェーズ4で追加します。</p>
        </Panel>
      )}
    </div>
  );
}
