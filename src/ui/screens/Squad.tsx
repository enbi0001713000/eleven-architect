// 選手の一覧（自分のクラブ）。1.1から、はじめはポジションごとのカードで見せ、表に切り替えられる（どちらで見たかは覚えておく）。
// 表は表示を切り替えたり、列を自分で選んだりできる。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import { POSITION_ORDER } from '../format';
import { clubPlayers } from '../../game/selection';
import type { GameState, PlayerRecord } from '../../game/types';
import { Condition, POSITION_GROUP, PosChip, StatusTags } from '../components/bits';
import { ColumnPicker, DataTable } from '../components/DataTable';
import { PlayerFace } from '../components/Face';
import { Term } from '../components/Term';
import { COLUMN_PRESETS, playerColumns } from '../playerColumns';
import { store, useGame, useStore } from '../store';
import { useTutorial } from '../useTutorial';

const GROUPS: { key: 'gk' | 'df' | 'mf' | 'fw'; label: string }[] = [
  { key: 'gk', label: 'ゴールキーパー' },
  { key: 'df', label: 'ディフェンダー' },
  { key: 'mf', label: 'ミッドフィールダー' },
  { key: 'fw', label: 'フォワード' },
];

export function Squad() {
  useTutorial('squad');
  const game = useGame();
  const s = useStore();
  const [preset, setPreset] = useState<string>(s.settings.squadColumns ? 'custom' : 'overview');
  const view = s.settings.squadView;
  const columns = playerColumns(game);
  const keys = preset === 'custom'
    ? s.settings.squadColumns ?? []
    : COLUMN_PRESETS.find((p) => p.id === preset)?.keys ?? [];
  const visible = columns.filter((c) => keys.includes(c.key));
  const players = clubPlayers(game, game.manager.clubId);

  return (
    <div className="page">
      <h1>選手（{players.length}人）</h1>
      <div className="toolbar">
        <div className="segmented" data-tutorial="squad-switch">
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => store.updateSettings({ squadView: 'cards' })}>カードで見る</button>
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => store.updateSettings({ squadView: 'table' })}>表で見る</button>
        </div>
        {view === 'table' && (
          <div className="segmented" data-tutorial="squad-views">
            {COLUMN_PRESETS.map((p) => (
              <button key={p.id} type="button" className={preset === p.id ? 'active' : ''} onClick={() => setPreset(p.id)}>{p.label}</button>
            ))}
            <button type="button" className={preset === 'custom' ? 'active' : ''} disabled={!s.settings.squadColumns}
              onClick={() => setPreset('custom')}>自分で選んだ列</button>
          </div>
        )}
        <button type="button" className="secondary" onClick={() => store.navigate({ name: 'meeting' })}>チームミーティング</button>
        {view === 'table' && (
          <ColumnPicker columns={columns} visible={keys} onChange={(next) => {
            store.updateSettings({ squadColumns: next });
            setPreset('custom');
          }} />
        )}
      </div>
      {view === 'cards' ? <SquadCards game={game} players={players} /> : (
        <div data-tutorial="squad-table">
          <DataTable rows={players} columns={visible} rowKey={(p) => p.id} initialSort={{ key: 'pos', desc: false }}
            onRowClick={(p, rows) => store.navigate({ name: 'player', id: p.id, list: rows.map((r) => r.id) })} />
        </div>
      )}
    </div>
  );
}

/** ポジションの組ごとのカード（顔、背番号、名前、年齢、総合力、コンディション、ケガなど） */
function SquadCards({ game, players }: { game: GameState; players: PlayerRecord[] }) {
  const lineup = new Set(game.clubs[game.manager.clubId]?.selection?.lineup ?? []);
  const sorted = [...players].sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || overallRating(b) - overallRating(a));
  const list = sorted.map((p) => p.id);
  return (
    <div data-tutorial="squad-cards">
      {GROUPS.map((group) => {
        const members = sorted.filter((p) => POSITION_GROUP[p.position] === group.key);
        if (members.length === 0) return null;
        return (
          <section key={group.key} className="squad-group">
            <h2>{group.label}<span className="muted small">　{members.length}人</span></h2>
            <div className="squad-cards">
              {members.map((p) => (
                <button key={p.id} type="button" className={`squad-card${lineup.has(p.id) ? ' starter' : ''}`}
                  onClick={() => store.navigate({ name: 'player', id: p.id, list })}>
                  <PlayerFace game={game} player={p} size={48} />
                  <span className="squad-card-body">
                    <span className="squad-card-name">
                      <span className="squad-number">{p.squadNumber ?? '-'}</span>
                      <strong>{p.name}</strong>
                    </span>
                    <span className="squad-card-line">
                      <PosChip position={p.position} />
                      <span className="muted small">{p.age}歳</span>
                      {lineup.has(p.id) && <span className="tag tag-good">先発</span>}
                      <StatusTags player={p} />
                    </span>
                    <span className="squad-card-line small">
                      <span><span className="muted"><Term k="総合力">総合力</Term></span> <strong>{overallRating(p).toFixed(1)}</strong></span>
                      <span><span className="muted">調子</span> <Condition value={p.status.condition} /></span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
