// 設定：配色、観戦の速さ、実況の表示、会話画面（遊ぶ人ごとにブラウザへ保存）

import type { CommentaryMode, MatchSpeed, Theme } from '../settings';
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
            配色
            <select value={s.settings.theme} onChange={(e) => store.updateSettings({ theme: e.target.value as Theme })}>
              <option value="light">明るい</option>
              <option value="dark">暗い</option>
            </select>
          </label>
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
          <label className="inline">
            <input type="checkbox" checked={s.settings.conversations} onChange={(e) => store.updateSettings({ conversations: e.target.checked })} />
            大事な出来事（オーナーの予算、スポンサーの提案、選手の申し出など）を会話画面で開く
          </label>
        </div>
      </section>
    </div>
  );
}
