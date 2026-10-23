// 選手の一覧（自分のクラブ）。表示を切り替えたり、列を自分で選んだりできる。

import { useState } from 'react';
import { clubPlayers } from '../../game/selection';
import { ColumnPicker, DataTable } from '../components/DataTable';
import { COLUMN_PRESETS, playerColumns } from '../playerColumns';
import { store, useGame, useStore } from '../store';
import { useTutorial } from '../useTutorial';

export function Squad() {
  useTutorial('squad');
  const game = useGame();
  const s = useStore();
  const [preset, setPreset] = useState<string>(s.settings.squadColumns ? 'custom' : 'overview');
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
        <div className="segmented" data-tutorial="squad-views">
          {COLUMN_PRESETS.map((p) => (
            <button key={p.id} type="button" className={preset === p.id ? 'active' : ''} onClick={() => setPreset(p.id)}>{p.label}</button>
          ))}
          <button type="button" className={preset === 'custom' ? 'active' : ''} disabled={!s.settings.squadColumns}
            onClick={() => setPreset('custom')}>自分で選んだ列</button>
        </div>
        <button type="button" className="secondary" onClick={() => store.navigate({ name: 'meeting' })}>チームミーティング</button>
        <ColumnPicker columns={columns} visible={keys} onChange={(next) => {
          store.updateSettings({ squadColumns: next });
          setPreset('custom');
        }} />
      </div>
      <div data-tutorial="squad-table">
        <DataTable rows={players} columns={visible} rowKey={(p) => p.id} initialSort={{ key: 'pos', desc: false }}
          onRowClick={(p, rows) => store.navigate({ name: 'player', id: p.id, list: rows.map((r) => r.id) })} />
      </div>
    </div>
  );
}
