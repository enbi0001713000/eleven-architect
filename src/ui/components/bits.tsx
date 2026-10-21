// 小さな表示部品：直近の成績、スタミナのバー、クラブ名、能力値など

import type { ReactNode } from 'react';
import { injuryName, isCarryingInjury, moraleLabel, moraleTone } from '../../game/condition';
import type { GameState, PlayerRecord } from '../../game/types';
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

/** 0〜100の値のバー。high が良い値なら tone は高いほど緑 */
export function Bar({ value, invert, title, width = 60 }: { value: number; invert?: boolean; title?: string; width?: number }) {
  const good = invert ? 100 - value : value;
  const tone = good >= 70 ? 'good' : good >= 50 ? 'mid' : 'low';
  return (
    <span className="stamina" style={{ width }} title={title ?? `${Math.round(value)}`}>
      <span className={`stamina-fill stamina-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function Condition({ value }: { value: number }) {
  const tone = value >= 90 ? 'tone-good' : value >= 75 ? 'tone-mid' : 'tone-low';
  return <span className={tone} title="コンディション">{Math.round(value)}%</span>;
}

export function Fatigue({ value }: { value: number }) {
  const tone = value >= 70 ? 'tone-low' : value >= 45 ? 'tone-mid' : 'tone-good';
  const label = value >= 70 ? '限界' : value >= 45 ? '疲れ' : value >= 25 ? '普通' : '元気';
  return <span className={tone} title={`蓄積疲労 ${Math.round(value)}`}>{label}</span>;
}

export function Morale({ value }: { value: number }) {
  return <span className={`morale morale-${moraleTone(value)}`} title={`モラル ${Math.round(value)}`}>{moraleLabel(value)}</span>;
}

export function Stars({ count }: { count: number }) {
  return <span className="stars" title={`コーチの評価：星${count}つ`}>{'★'.repeat(count)}<span className="muted">{'★'.repeat(5 - count)}</span></span>;
}

/** 出場停止とケガのしるし */
export function StatusTags({ player }: { player: PlayerRecord }) {
  const injury = player.status.injury;
  return (
    <>
      {player.discipline.suspendedMatches > 0 && <span className="tag tag-bad">出場停止{player.discipline.suspendedMatches}</span>}
      {injury && (isCarryingInjury(player)
        ? <span className="tag tag-warn" title={injuryName(injury)}>完治前 残り{injury.daysLeft}日</span>
        : <span className="tag tag-bad" title={injuryName(injury)}>ケガ 残り{injury.daysLeft}日</span>)}
      {!injury && player.status.recurrence && <span className="tag" title={`${player.status.recurrence.part}を再び痛めやすい`}>再発注意</span>}
    </>
  );
}
