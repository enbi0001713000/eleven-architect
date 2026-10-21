// 設定：観戦の速さ、実況の表示（遊ぶ人ごとにブラウザへ保存）

import type { CommentaryMode, MatchSpeed } from '../settings';
import { store, useStore } from '../store';

export function Settings() {
  const s = useStore();
  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>設定</h1>
      </header>
      <section className="panel">
        <div className="panel-body settings">
          <label>
            観戦の速さ（最初の値）
            <select value={s.settings.matchSpeed} onChange={(e) => store.updateSettings({ matchSpeed: Number(e.target.value) as MatchSpeed })}>
              <option value={1}>等倍（1分＝1秒）</option>
              <option value={2}>2倍</option>
              <option value={4}>4倍</option>
            </select>
          </label>
          <label>
            実況の表示
            <select value={s.settings.commentary} onChange={(e) => store.updateSettings({ commentary: e.target.value as CommentaryMode })}>
              <option value="key">主な場面だけ</option>
              <option value="all">すべて</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
