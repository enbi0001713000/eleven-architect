// シーズンの結果：優勝クラブ、最終順位、得点王など

import { averageRating } from '../../game/season';
import { standingsOf } from '../../game/standings';
import { ClubLink, Panel, Rating } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { topRated, topScorers } from '../queries';
import { store, useGame } from '../store';

export function SeasonEnd() {
  const game = useGame();
  const table = standingsOf(game);
  const champion = table[0];
  const championClub = champion ? game.clubs[champion.clubId] : undefined;
  const mine = table.find((r) => r.clubId === game.manager.clubId);
  const scorer = topScorers(game, 1)[0];
  const best = topRated(game, 1, 1500)[0];
  const finished = game.season.round > 34;

  if (!finished) {
    const last = game.history.at(-1);
    return (
      <div className="page">
        <Panel>
          <p>まだシーズンの途中です（次は第{game.season.round}節）。</p>
          {last && <p className="muted">{last.year}年の優勝は{game.clubs[last.championId]?.name}でした。過去のシーズンは「リーグ」の画面で見られます。</p>}
        </Panel>
      </div>
    );
  }

  return (
    <div className="page season-end">
      <div className="champion">
        {championClub && <Emblem spec={championClub.emblem} size={120} />}
        <div>
          <div className="muted">{game.season.year}年シーズン 優勝</div>
          <h1>{championClub?.name}</h1>
          <div>勝ち点{champion?.points}（{champion?.won}勝{champion?.drawn}分{champion?.lost}敗）</div>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="あなたのクラブ">
          {mine && (
            <p className="big">
              {mine.position}位　勝ち点{mine.points}（{mine.won}勝{mine.drawn}分{mine.lost}敗、得点{mine.goalsFor}・失点{mine.goalsAgainst}）
            </p>
          )}
          <p className="muted">画面右上の「次の出来事まで進める」で、12月10日のシーズンの総括、12月20日の引退の発表と契約の更新、1月1日の新しい日程、1月10日の新人の加入と進み、2月末に次のシーズンが開幕します。</p>
        </Panel>
        <Panel title="個人タイトル">
          <dl className="facts">
            <dt>得点王</dt>
            <dd>{scorer ? <>{scorer.name}（{scorer.season.goals}点）{scorer.clubId && <ClubLink game={game} clubId={scorer.clubId} short />}</> : '-'}</dd>
            <dt>平均評価点トップ</dt>
            <dd>{best ? <>{best.name} <Rating value={averageRating(best.season)} /> {best.clubId && <ClubLink game={game} clubId={best.clubId} short />}</> : '-'}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title="最終順位">
        <table className="data-table compact">
          <thead><tr><th>順位</th><th>クラブ</th><th className="num">勝</th><th className="num">分</th><th className="num">敗</th><th className="num">得失点差</th><th className="num">勝ち点</th></tr></thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.clubId} className={row.clubId === game.manager.clubId ? 'highlight' : ''}>
                <td>{row.position}</td>
                <td><ClubLink game={game} clubId={row.clubId} /></td>
                <td className="num">{row.won}</td><td className="num">{row.drawn}</td><td className="num">{row.lost}</td>
                <td className="num">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                <td className="num"><strong>{row.points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="button-row"><button type="button" className="primary" onClick={() => store.open({ name: 'home' })}>ホームへ</button></div>
    </div>
  );
}
