// 解任されたとき：これまでの成績をふり返る。他クラブからのオファーで続ける機能は、フェーズ3-Cで加わる

import { goalLabel, verdictLabel } from '../../game/owner';
import { Panel } from '../components/bits';
import { formatDate } from '../format';
import { store, useGame } from '../store';

export function Dismissed() {
  const game = useGame();
  const club = game.clubs[game.manager.clubId];
  const dismissed = game.owner.dismissed;
  const seasons = game.history.filter((h) => h.manager.clubId === game.manager.clubId);
  const message = game.inbox.find((m) => m.topic === 'dismissal');
  return (
    <div className="page">
      <h1>{club?.name}の監督を解任されました</h1>
      <div className="grid-2">
        <Panel title="オーナーから">
          <p>{dismissed ? `${formatDate(dismissed.date)}、オーナーから解任を告げられました。` : ''}</p>
          <p className="muted">{dismissed?.reason}</p>
          {message && <button type="button" className="secondary" onClick={() => store.navigate({ name: 'conversation', messageId: message.id })}>オーナーとの話をもう一度見る</button>}
        </Panel>
        <Panel title="監督としての記録">
          {seasons.length === 0 && game.owner.evaluations.length === 0 ? <p className="muted">最初のシーズンの途中でした。</p> : (
            <table className="data-table compact">
              <thead><tr><th>シーズン</th><th className="num">順位</th><th>目標</th><th>評価</th></tr></thead>
              <tbody>
                {seasons.map((h) => {
                  const e = game.owner.evaluations.find((v) => v.year === h.year);
                  return (
                    <tr key={h.year}>
                      <td>{h.year}年</td>
                      <td className="num">{h.manager.position}位</td>
                      <td>{e ? goalLabel(e.goal) : '-'}</td>
                      <td>{e ? verdictLabel(e.verdict) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      <Panel>
        <p>このセーブデータでは、これ以上時間を進められません。他クラブからのオファーを受けて監督を続ける機能は、フェーズ3-Cで加わります。</p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => { void store.saveNow(); store.setGame(null, null); store.open({ name: 'title' }); }}>タイトルへ</button>
          <button type="button" className="primary" onClick={() => { void store.saveNow(); store.setGame(null, null); store.open({ name: 'newGame' }); }}>新しいゲームを始める</button>
        </div>
      </Panel>
    </div>
  );
}
