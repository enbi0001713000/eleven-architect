// 選手の詳細：能力、記録、契約、スカウトレポート（フェーズ4）をタブで切り替える

import { useState } from 'react';
import { overallRating, positionRating } from '../../engine/ratings';
import type { Position } from '../../engine/types';
import { knowledgeOf, viewAttribute } from '../../game/knowledge';
import { LEAGUE_RULES } from '../../game/rules';
import { averageRating } from '../../game/season';
import { AttributeValue, ClubLink, Panel, Rating } from '../components/bits';
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABEL, formatYen, POSITION_LABEL, POSITION_NAME, POSITION_ORDER } from '../format';
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
            </dl>
          ) : <p className="muted">契約はありません。</p>}
          <p className="muted small">契約の交渉はフェーズ4で追加します。</p>
        </Panel>
      )}
    </div>
  );
}
