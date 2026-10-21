// 試合のまとめ（スタッツ、得点経過、評価点）。試合後のレポートと、日程画面の結果表示で使う。

import type { MatchEvent, TeamStats } from '../../engine/types';
import type { GameState } from '../../game/types';
import { Emblem } from './Emblem';

const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, a + b)) * 100)}%`;

export function StatsTable({ stats, names }: { stats: [TeamStats, TeamStats]; names: [string, string] }) {
  const [h, a] = stats;
  const rows: [string, string, string][] = [
    ['ボール支配率', pct(h.possessionSeconds, a.possessionSeconds), pct(a.possessionSeconds, h.possessionSeconds)],
    ['シュート', `${h.shots}`, `${a.shots}`],
    ['枠内シュート', `${h.shotsOnTarget}`, `${a.shotsOnTarget}`],
    ['xG（ゴール期待値）', h.xg.toFixed(2), a.xg.toFixed(2)],
    ['パス成功率', `${Math.round((h.passesCompleted / Math.max(1, h.passes)) * 100)}%`, `${Math.round((a.passesCompleted / Math.max(1, a.passes)) * 100)}%`],
    ['パス', `${h.passes}`, `${a.passes}`],
    ['タックル', `${h.tackles}`, `${a.tackles}`],
    ['相手陣内での奪取', `${h.highRecoveries}`, `${a.highRecoveries}`],
    ['ファウル', `${h.fouls}`, `${a.fouls}`],
    ['コーナーキック', `${h.corners}`, `${a.corners}`],
    ['オフサイド', `${h.offsides}`, `${a.offsides}`],
    ['イエローカード', `${h.yellowCards}`, `${a.yellowCards}`],
    ['レッドカード', `${h.redCards}`, `${a.redCards}`],
  ];
  return (
    <table className="stats-table">
      <thead><tr><th className="num">{names[0]}</th><th /><th>{names[1]}</th></tr></thead>
      <tbody>
        {rows.map(([label, home, away]) => (
          <tr key={label}><td className="num">{home}</td><td className="stat-label">{label}</td><td>{away}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeyEvents({ events }: { events: readonly MatchEvent[] }) {
  const key = events.filter((e) => ['goal', 'penaltyGoal', 'redCard', 'penaltyMissed', 'yellowCard', 'substitution'].includes(e.type));
  if (key.length === 0) return <p className="muted">主な出来事はありません。</p>;
  return (
    <ul className="event-list">
      {key.map((e, i) => (
        <li key={i} className={`event side-${e.side ?? 'none'} type-${e.type}`}>
          <span className="event-minute">{e.minute}</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreHeader({ game, homeId, awayId, homeGoals, awayGoals, sub }: {
  game: GameState; homeId: string; awayId: string; homeGoals: number | null; awayGoals: number | null; sub?: string;
}) {
  const home = game.clubs[homeId];
  const away = game.clubs[awayId];
  return (
    <div className="score-header">
      <div className="score-team">{home && <Emblem spec={home.emblem} size={48} />}<span>{home?.name}</span></div>
      <div className="score-center">
        <div className="score-numbers">{homeGoals ?? '-'} <span className="muted">-</span> {awayGoals ?? '-'}</div>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      <div className="score-team away">{away && <Emblem spec={away.emblem} size={48} />}<span>{away?.name}</span></div>
    </div>
  );
}
