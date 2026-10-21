// クラブの詳細（他クラブを含む）：基本情報、選手、結果

import { clubPlayers } from '../../game/selection';
import { standingsOf } from '../../game/standings';
import { ClubLink, FormBadges, Panel, ResultChip } from '../components/bits';
import { DataTable } from '../components/DataTable';
import { Emblem } from '../components/Emblem';
import { SIZE_LABEL } from '../format';
import { COLUMN_PRESETS, playerColumns } from '../playerColumns';
import { playedFixtures, scoreFor } from '../queries';
import { store, useGame } from '../store';

export function ClubDetail({ id }: { id: string }) {
  const game = useGame();
  const club = game.clubs[id];
  if (!club) return <div className="page"><p>クラブが見つかりません。</p></div>;
  const row = standingsOf(game).find((r) => r.clubId === id);
  const columns = playerColumns(game);
  const mine = id === game.manager.clubId;
  const keys = COLUMN_PRESETS[0]?.keys.filter((k) => mine || !['status', 'cond', 'morale'].includes(k)) ?? [];
  const relation = game.managerRelations[id];

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <Emblem spec={club.emblem} size={64} />
        <div>
          <h1>{club.name}{mine ? '（自分のクラブ）' : ''}</h1>
          <div className="muted">{club.hometown}　創設{club.founded}年　規模：{SIZE_LABEL[club.size]}</div>
          {row && <div>{row.position}位　勝ち点{row.points}　<FormBadges form={row.form} /></div>}
        </div>
      </header>

      <div className="grid-2">
        <Panel title="基本情報">
          <dl className="facts">
            <dt>監督</dt><dd>{mine ? game.manager.name : club.managerName}</dd>
            <dt>スタジアム</dt><dd>{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</dd>
            <dt>ファンの数</dt><dd>約{club.fans.toLocaleString('ja-JP')}人</dd>
            <dt>ライバル</dt><dd>{club.rivalId && <ClubLink game={game} clubId={club.rivalId} />}</dd>
            <dt>フォーメーション</dt><dd>{club.tactics.formation}</dd>
            <dt>評判</dt><dd>{club.reputation}</dd>
            {!mine && <><dt>監督との関係</dt><dd>{relation === undefined || relation === 0 ? '普通' : relation > 20 ? '良好' : relation > 0 ? 'やや良い' : relation < -20 ? '険悪' : 'やや悪い'}</dd></>}
          </dl>
        </Panel>
        <Panel title="結果">
          <ul className="result-list">
            {playedFixtures(game, id).slice(-8).reverse().map((f) => {
              const s = scoreFor(f, id);
              return s ? (
                <li key={f.id}>
                  <span className="muted small">第{f.round}節</span>
                  <ResultChip goalsFor={s.goalsFor} goalsAgainst={s.goalsAgainst} />
                  <span className="muted small">{s.home ? 'H' : 'A'}</span>
                  <ClubLink game={game} clubId={s.opponentId} />
                </li>
              ) : null;
            })}
          </ul>
          {playedFixtures(game, id).length === 0 && <p className="muted">まだ試合をしていません。</p>}
        </Panel>
      </div>

      <h2>選手</h2>
      {!mine && <p className="muted small">他クラブの選手の能力は幅で表示されます（知識度50%）。</p>}
      <DataTable rows={clubPlayers(game, id)} rowKey={(p) => p.id} initialSort={{ key: 'pos', desc: false }}
        columns={columns.filter((c) => keys.includes(c.key))}
        onRowClick={(p) => store.navigate({ name: 'player', id: p.id })} />
    </div>
  );
}
