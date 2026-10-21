// ホーム（まとめ画面）：次の試合、順位、最近の結果、知らせ（要件定義書「画面の一覧」）

import { overallRating } from '../../engine/ratings';
import { averageRating, isSeasonOver, nextFixtureOf } from '../../game/season';
import { clubPlayers, validateSelection } from '../../game/selection';
import { standingsOf } from '../../game/standings';
import { ClubLink, FormBadges, Panel, Rating, ResultChip } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { formatDate, POSITION_LABEL } from '../format';
import { playedFixtures, scoreFor, topScorers } from '../queries';
import { store, useGame } from '../store';

export function Home() {
  const game = useGame();
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  const table = standingsOf(game);
  const myRow = table.find((r) => r.clubId === myId);
  const next = nextFixtureOf(game, myId);
  const recent = playedFixtures(game, myId).slice(-5).reverse();
  const formation = club?.tactics.formation ?? '4-4-2';
  const problems = club?.selection ? validateSelection(game, myId, formation, club.selection) : ['メンバーが決まっていません'];
  const suspended = clubPlayers(game, myId).filter((p) => p.discipline.suspendedMatches > 0);
  const warned = clubPlayers(game, myId).filter((p) => p.discipline.yellowAccumulation === 3);

  // 自分の順位の前後を見せる
  const myIndex = myRow ? myRow.position - 1 : 0;
  const start = Math.max(0, Math.min(table.length - 7, myIndex - 3));
  const nearby = table.slice(start, start + 7);

  return (
    <div className="page home">
      <h1>ホーム</h1>
      <div className="grid-2">
        <Panel title="次の試合">
          {isSeasonOver(game) && (
            <div className="next-match">
              <p>今シーズンの全日程が終わりました。</p>
              <button type="button" className="primary" onClick={() => store.open({ name: 'seasonEnd' })}>シーズンの結果を見る</button>
            </div>
          )}
          {next && (() => {
            const home = next.homeId === myId;
            const opponentId = home ? next.awayId : next.homeId;
            const opponent = game.clubs[opponentId];
            const oppRow = table.find((r) => r.clubId === opponentId);
            const derby = club?.rivalId === opponentId;
            return (
              <div className="next-match">
                <div className="muted">第{next.round}節　{formatDate(next.date)}　{home ? 'ホーム' : 'アウェイ'}{derby ? '　ダービー' : ''}</div>
                <div className="next-match-vs">
                  {opponent && <Emblem spec={opponent.emblem} size={56} />}
                  <div>
                    <div className="vs-name">vs {opponent?.name}</div>
                    <div className="muted">{oppRow ? `${oppRow.position}位　勝ち点${oppRow.points}` : ''}</div>
                    {oppRow && <FormBadges form={oppRow.form} />}
                  </div>
                </div>
                {problems.length > 0 && (
                  <div className="warning">
                    メンバーに問題があります：{problems.join('／')}
                    <button type="button" className="secondary small" onClick={() => store.open({ name: 'tactics' })}>戦術画面で直す</button>
                  </div>
                )}
                <div className="button-row">
                  <button type="button" className="secondary" onClick={() => store.open({ name: 'tactics' })}>スタメンと戦術</button>
                  <button type="button" className="primary" onClick={() => store.open({ name: 'match' })}>試合へ進む ▶</button>
                </div>
              </div>
            );
          })()}
        </Panel>

        <Panel title="順位" actions={<button type="button" className="link" onClick={() => store.open({ name: 'league' })}>順位表へ</button>}>
          <table className="data-table compact">
            <thead><tr><th>順位</th><th>クラブ</th><th className="num">試合</th><th className="num">差</th><th className="num">勝ち点</th><th>直近</th></tr></thead>
            <tbody>
              {nearby.map((row) => (
                <tr key={row.clubId} className={row.clubId === myId ? 'highlight' : ''}>
                  <td>{row.position}</td>
                  <td><ClubLink game={game} clubId={row.clubId} short /></td>
                  <td className="num">{row.played}</td>
                  <td className="num">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td className="num"><strong>{row.points}</strong></td>
                  <td><FormBadges form={row.form} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="最近の結果">
          {recent.length === 0 && <p className="muted">まだ試合をしていません。</p>}
          <ul className="result-list">
            {recent.map((f) => {
              const s = scoreFor(f, myId);
              if (!s) return null;
              return (
                <li key={f.id}>
                  <span className="muted small">第{f.round}節</span>
                  <ResultChip goalsFor={s.goalsFor} goalsAgainst={s.goalsAgainst} />
                  <span className="muted small">{s.home ? 'H' : 'A'}</span>
                  <ClubLink game={game} clubId={s.opponentId} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="知らせ">
          <ul className="notice-list">
            {suspended.map((p) => (
              <li key={p.id}><span className="tag tag-bad">出場停止</span>{p.name}（残り{p.discipline.suspendedMatches}試合）</li>
            ))}
            {warned.map((p) => (
              <li key={p.id}><span className="tag tag-warn">警告3枚</span>{p.name}：次に警告を受けると出場停止</li>
            ))}
            {suspended.length === 0 && warned.length === 0 && <li className="muted">特にありません。</li>}
          </ul>
        </Panel>

        <Panel title="チームの得点ランキング">
          <table className="data-table compact">
            <thead><tr><th>選手</th><th>Pos</th><th className="num">得点</th><th className="num">アシスト</th><th className="num">平均評価</th></tr></thead>
            <tbody>
              {topScorers(game, 5, myId).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => store.navigate({ name: 'player', id: p.id })}>
                  <td>{p.name}</td>
                  <td>{POSITION_LABEL[p.position]}</td>
                  <td className="num">{p.season.goals}</td>
                  <td className="num">{p.season.assists}</td>
                  <td className="num"><Rating value={averageRating(p.season)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {topScorers(game, 1, myId).length === 0 && <p className="muted">まだ得点がありません。</p>}
        </Panel>

        <Panel title="クラブ">
          {club && (
            <dl className="facts">
              <dt>本拠地</dt><dd>{club.hometown}</dd>
              <dt>スタジアム</dt><dd>{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</dd>
              <dt>ライバル</dt><dd>{club.rivalId && <ClubLink game={game} clubId={club.rivalId} />}</dd>
              <dt>フォーメーション</dt><dd>{club.tactics.formation}</dd>
              <dt>選手の平均総合力</dt>
              <dd>{(clubPlayers(game, myId).reduce((n, p) => n + overallRating(p), 0) / Math.max(1, club.playerIds.length)).toFixed(1)}</dd>
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
