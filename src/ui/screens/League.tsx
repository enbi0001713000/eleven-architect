// リーグ：順位表、得点ランキング、アシストランキング

import { useState } from 'react';
import { averageRating } from '../../game/season';
import { standingsOf } from '../../game/standings';
import { ClubLink, FormBadges, Rating } from '../components/bits';
import { DataTable } from '../components/DataTable';
import { POSITION_LABEL } from '../format';
import { topAssists, topRated, topScorers } from '../queries';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

type Tab = 'table' | 'scorers' | 'assists' | 'rated' | 'history';

export function League() {
  useTutorial('league');
  const game = useGame();
  const [tab, setTab] = useState<Tab>('table');
  const table = standingsOf(game);
  const myId = game.manager.clubId;
  const players = tab === 'scorers' ? topScorers(game, 20) : tab === 'assists' ? topAssists(game, 20)
    : tab === 'rated' ? topRated(game, 20, Math.max(90, (game.season.round - 1) * 45)) : [];

  return (
    <div className="page">
      <h1>リーグ</h1>
      <div className="segmented tabs">
        <button type="button" className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>順位表</button>
        <button type="button" className={tab === 'scorers' ? 'active' : ''} onClick={() => setTab('scorers')}>得点ランキング</button>
        <button type="button" className={tab === 'assists' ? 'active' : ''} onClick={() => setTab('assists')}>アシストランキング</button>
        <button type="button" className={tab === 'rated' ? 'active' : ''} onClick={() => setTab('rated')}>平均評価点</button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>過去のシーズン</button>
      </div>

      {tab === 'history' && (
        game.history.length === 0 ? <p className="muted">まだ終わったシーズンはありません（シーズンの記録は12月10日に残ります）。</p> : (
          <table className="data-table">
            <thead><tr><th>年</th><th>優勝</th><th className="num">勝ち点</th><th>あなたのクラブ</th><th>得点王</th><th>平均評価点トップ</th></tr></thead>
            <tbody>
              {[...game.history].reverse().map((h) => (
                <tr key={h.year}>
                  <td>{h.year}</td>
                  <td><ClubLink game={game} clubId={h.championId} /></td>
                  <td className="num">{h.table[0]?.points}</td>
                  <td>{game.clubs[h.manager.clubId]?.shortName} {h.manager.position}位</td>
                  <td>{h.topScorer ? `${h.topScorer.name}（${h.topScorer.goals}点）` : '-'}</td>
                  <td>{h.bestPlayer ? `${h.bestPlayer.name}（${h.bestPlayer.rating.toFixed(2)}）` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'table' && (
        <table className="data-table standings" data-tutorial="league">
          <thead>
            <tr>
              <th>順位</th><th>クラブ</th><th className="num">試合</th><th className="num">勝</th><th className="num">分</th>
              <th className="num">敗</th><th className="num">得点</th><th className="num">失点</th><th className="num">得失点差</th>
              <th className="num">勝ち点</th><th>直近5試合</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.clubId} className={`clickable${row.clubId === myId ? ' highlight' : ''}`}
                onClick={() => store.navigate({ name: 'club', id: row.clubId })}>
                <td>{row.position}</td>
                <td><ClubLink game={game} clubId={row.clubId} /></td>
                <td className="num">{row.played}</td>
                <td className="num">{row.won}</td>
                <td className="num">{row.drawn}</td>
                <td className="num">{row.lost}</td>
                <td className="num">{row.goalsFor}</td>
                <td className="num">{row.goalsAgainst}</td>
                <td className="num">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                <td className="num"><strong>{row.points}</strong></td>
                <td><FormBadges form={row.form} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab !== 'table' && tab !== 'history' && (
        players.length === 0 ? <p className="muted">まだ記録がありません。</p> : (
          <DataTable rows={players} rowKey={(p) => p.id} onRowClick={(p) => store.navigate({ name: 'player', id: p.id })}
            highlight={(p) => p.clubId === myId}
            columns={[
              { key: 'rank', label: '順位', align: 'right', value: (p) => players.indexOf(p) + 1 },
              { key: 'name', label: '名前', value: (p) => p.name },
              { key: 'pos', label: 'Pos', value: (p) => POSITION_LABEL[p.position] },
              { key: 'club', label: 'クラブ', value: (p) => game.clubs[p.clubId ?? '']?.shortName ?? '', render: (p) => (p.clubId ? <ClubLink game={game} clubId={p.clubId} short /> : null) },
              { key: 'apps', label: '出場', align: 'right', value: (p) => p.season.appearances },
              { key: 'goals', label: '得点', align: 'right', value: (p) => p.season.goals },
              { key: 'assists', label: 'アシスト', align: 'right', value: (p) => p.season.assists },
              { key: 'avg', label: '平均評価', align: 'right', value: (p) => averageRating(p.season), render: (p) => <Rating value={averageRating(p.season)} /> },
            ]} />
        )
      )}
    </div>
  );
}
