// 声かけやミーティングへの選手の反応を、良い・普通・悪いに分けて見せる

import type { Reaction } from '../../game/talks';

export function Reactions({ reactions }: { reactions: Reaction[] }) {
  const groups = [
    { tone: 'positive', title: '良い反応' },
    { tone: 'neutral', title: '普通' },
    { tone: 'negative', title: '悪い反応' },
  ] as const;
  return (
    <div className="reactions">
      {groups.map((g) => {
        const list = reactions.filter((r) => r.tone === g.tone);
        return (
          <div key={g.tone} className={`reaction-group ${g.tone}`}>
            <h3>{g.title}（{list.length}人）</h3>
            <ul>
              {list.map((r) => <li key={r.playerId}>{r.name}<span className="muted small">：{r.text}</span></li>)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
