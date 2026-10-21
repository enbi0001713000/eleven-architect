// チームミーティング：シーズン前の目標の共有、連敗中の立て直しなど。チーム全体のモラルが変わる（要件定義書「面談と声かけ」）

import { useState } from 'react';
import { MEETINGS, meetingCooldownLeft, recentResults, teamMeeting, type MeetingKind, type Reaction } from '../../game/talks';
import { FormBadges, Panel } from '../components/bits';
import { Reactions } from '../components/Reactions';
import { store, useGame } from '../store';

export function Meeting() {
  const game = useGame();
  const [result, setResult] = useState<{ summary: string; reactions: Reaction[] } | null>(null);
  const cooldown = meetingCooldownLeft(game);
  const recent = recentResults(game, game.manager.clubId, 5);
  const form = recent.map((r) => (r === 1 ? 'W' : r === 0 ? 'D' : 'L') as 'W' | 'D' | 'L').reverse();

  const hold = (kind: MeetingKind) => {
    let outcome: { summary: string; reactions: Reaction[] } | null = null;
    store.update((g) => {
      outcome = teamMeeting(g, kind);
    });
    setResult(outcome);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>チームミーティング</h1>
      </header>
      <Panel title="チームの状況">
        <p>直近の結果：{form.length > 0 ? <FormBadges form={form} /> : <span className="muted">まだ試合をしていません</span>}　第{Math.min(game.season.round, 34)}節</p>
        <p className="muted small">状況に合った話をすると、チーム全体のモラルが上がります。合っていないと逆効果です。</p>
      </Panel>
      {result ? (
        <Panel title="ミーティングの結果">
          <p>{result.summary}</p>
          <Reactions reactions={result.reactions} />
          <div className="button-row"><button type="button" className="primary" onClick={() => store.back()}>戻る</button></div>
        </Panel>
      ) : cooldown > 0 ? (
        <Panel><p className="muted">最近ミーティングをしたばかりです。あと{cooldown}日たつと、またできます。</p></Panel>
      ) : (
        <Panel title="何を話しますか">
          <div className="option-cards">
            {MEETINGS.map((m) => (
              <button key={m.id} type="button" className="option-card" onClick={() => hold(m.id)}>
                <strong>{m.label}</strong>
                <span className="muted small">{m.description}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
