// 小さな表示部品：直近の成績、スタミナのバー、クラブ名、能力値など

import type { ReactNode } from 'react';
import type { GameState } from '../../game/types';
import { formatView, type AttributeView } from '../../game/knowledge';
import { store } from '../store';
import { attributeTone, ratingTone } from '../format';
import { Emblem } from './Emblem';

export function FormBadges({ form }: { form: ('W' | 'D' | 'L')[] }) {
  const label = { W: '勝', D: '分', L: '負' } as const;
  return (
    <span className="form-badges">
      {form.map((r, i) => <span key={i} className={`form form-${r}`}>{label[r]}</span>)}
    </span>
  );
}

export function StaminaBar({ value }: { value: number }) {
  const tone = value >= 70 ? 'good' : value >= 50 ? 'mid' : 'low';
  return (
    <span className="stamina" title={`スタミナ ${Math.round(value)}`}>
      <span className={`stamina-fill stamina-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/** クラブ名（エンブレムつき）。押すとクラブの詳細へ */
export function ClubLink({ game, clubId, short, size = 18 }: { game: GameState; clubId: string; short?: boolean; size?: number }) {
  const club = game.clubs[clubId];
  if (!club) return null;
  const mine = clubId === game.manager.clubId;
  return (
    <button type="button" className={`club-link${mine ? ' mine' : ''}`}
      onClick={(e) => { e.stopPropagation(); store.navigate({ name: 'club', id: clubId }); }}>
      <Emblem spec={club.emblem} size={size} />
      <span>{short ? club.shortName : club.name}</span>
    </button>
  );
}

export function AttributeValue({ view }: { view: AttributeView }) {
  const tone = attributeTone(view.exact ? view.low : (view.low + view.high) / 2);
  return <span className={`attr ${tone}${view.exact ? '' : ' attr-range'}`}>{formatView(view)}</span>;
}

export function Rating({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">-</span>;
  return <span className={`rating ${ratingTone(value)}`}>{value.toFixed(2)}</span>;
}

export function Panel({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <header className="panel-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function ResultChip({ goalsFor, goalsAgainst }: { goalsFor: number; goalsAgainst: number }) {
  const r = goalsFor > goalsAgainst ? 'W' : goalsFor === goalsAgainst ? 'D' : 'L';
  return <span className={`result-chip form-${r}`}>{goalsFor}-{goalsAgainst}</span>;
}
