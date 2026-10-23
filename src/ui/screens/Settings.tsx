// 設定：配色、観戦の速さ、ピッチの描き方、音、実況の表示、会話画面、チュートリアル（遊ぶ人ごとにブラウザへ保存）

import type { CommentaryMode, MatchSpeed, MatchView, PitchStyle, Theme, UiScale } from '../settings';
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
            文字の大きさ
            <select value={s.settings.uiScale} onChange={(e) => store.updateSettings({ uiScale: e.target.value as UiScale })}>
              <option value="normal">標準</option>
              <option value="large">大きめ</option>
            </select>
          </label>
          <label>
            観戦の速さ（最初の値）
            <select value={s.settings.matchSpeed} onChange={(e) => store.updateSettings({ matchSpeed: Number(e.target.value) as MatchSpeed })}>
              <option value={1}>等倍（ボールの動きを1つずつ見られる。1試合およそ6分）</option>
              <option value={2}>2倍（およそ3分）</option>
              <option value={4}>4倍（およそ1分半）</option>
              <option value={8}>8倍（およそ1分）</option>
            </select>
          </label>
          <label>
            観戦の見せ方（試合中にも切り替えられ、前回選んだほうから始まる）
            <select value={s.settings.matchView} onChange={(e) => store.updateSettings({ matchView: e.target.value as MatchView })}>
              <option value="big">大きく見る（ピッチを大きく、上に操作の帯、下に字幕）</option>
              <option value="normal">今までの並び（ピッチ、実況、スタッツを並べる）</option>
            </select>
          </label>
          <label>
            ピッチの描き方
            <select value={s.settings.pitchStyle} onChange={(e) => store.updateSettings({ pitchStyle: e.target.value as PitchStyle })}>
              <option value="dot">ドット絵（斜め上から。選手が走り、ボールが飛ぶ）</option>
              <option value="classic">上から見た図（背番号の丸）</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.sound} onChange={(e) => store.updateSettings({ sound: e.target.checked })} />
            観戦中に音を出す（歓声、笛、ボールを蹴る音、応援）
          </label>
          <label>
            音量
            <input type="range" min={0} max={1} step={0.05} value={s.settings.volume} disabled={!s.settings.sound}
              onChange={(e) => store.updateSettings({ volume: Number(e.target.value) })} />
          </label>
          <label>
            実況の表示
            <select value={s.settings.commentary} onChange={(e) => store.updateSettings({ commentary: e.target.value as CommentaryMode })}>
              <option value="key">主な場面だけ</option>
              <option value="all">すべて</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.showPitch} onChange={(e) => store.updateSettings({ showPitch: e.target.checked })} />
            観戦中にピッチの図（選手とボールの動き）を出す
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.celebrations} onChange={(e) => store.updateSettings({ celebrations: e.target.checked })} />
            ゴールや勝利、優勝、選手の加入を大きく見せる（演出）
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.conversations} onChange={(e) => store.updateSettings({ conversations: e.target.checked })} />
            大事な出来事（オーナーの予算、スポンサーの提案、選手の申し出など）を会話画面で開く
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.coach} onChange={(e) => store.updateSettings({ coach: e.target.checked })} />
            アシスタントコーチが、画面を開いたときに一言アドバイスする
          </label>
          <label className="inline">
            <input type="checkbox" checked={s.settings.tutorials} onChange={(e) => store.updateSettings({ tutorials: e.target.checked })} />
            チュートリアル（画面や機能を初めて使うときの説明）を出す
          </label>
          <div>
            <button type="button" className="secondary small" disabled={s.settings.tutorialSeen.length === 0}
              onClick={() => store.updateSettings({ tutorials: true, tutorialSeen: [] })}>
              見た説明をリセットする（もう一度、最初から出す）
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
