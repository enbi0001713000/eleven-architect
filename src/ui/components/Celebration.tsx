// 演出：紙吹雪、ユニフォーム、トロフィーと、積まれた演出（新しい選手の加入、新人の加入、優勝）を大きく見せる画面。
// 設定で切ると出さない。動きを減らす設定のブラウザでは、紙吹雪を出さず、動きもなくす（styles.css）。

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { overallRating } from '../../engine/ratings';
import { LEAGUE_RULES } from '../../game/rules';
import { dismissMoment } from '../../game/moments';
import type { Club, GameState, Moment, PlayerRecord } from '../../game/types';
import { colorDistance, textOn } from '../colors';
import { formatYen, POSITION_NAME } from '../format';
import { store, useStore } from '../store';
import { Emblem } from './Emblem';
import { PlayerFace } from './Face';

export const GOLD = '#e0b43a';

/**
 * 新しい出来事が来たら、決まった時間だけ返す（試合を速く見ていても見逃さないように、実際の時間で数える）。
 * 消す時計は、次の出来事が来たときと画面を閉じたときだけ止める（出来事がなくなっても、時間が来れば消す）
 */
export function useForAWhile<T>(event: T | undefined, ms: number): T | undefined {
  const [shown, setShown] = useState<T | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (event === undefined) return;
    setShown(event);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown((current) => (current === event ? undefined : current)), ms);
  }, [event, ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return shown;
}

/** 0〜1の決まった値（紙吹雪の位置や速さを、描き直しても変わらないように決める） */
const wobble = (i: number, k: number): number => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** 紙吹雪。fixed なら画面全体に、そうでなければ親の枠の中に降らせる */
export function Confetti({ colors, count = 60, fixed = false }: { colors: string[]; count?: number; fixed?: boolean }) {
  return (
    <div className={`confetti${fixed ? ' fixed' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const style = {
          left: `${wobble(i, 1) * 100}%`,
          width: `${5 + wobble(i, 2) * 6}px`,
          height: `${8 + wobble(i, 3) * 8}px`,
          background: colors[i % colors.length],
          borderRadius: wobble(i, 4) > 0.7 ? '50%' : '2px',
          '--delay': `${wobble(i, 5) * 1.2}s`,
          '--duration': `${2.4 + wobble(i, 6) * 1.8}s`,
          '--drift': `${(wobble(i, 7) - 0.5) * 160}px`,
          '--spin': `${360 + wobble(i, 8) * 720}deg`,
        } as CSSProperties;
        return <i key={i} style={style} />;
      })}
    </div>
  );
}

/** ユニフォームの絵（クラブの色と背番号） */
export function Jersey({ primary, secondary, number, size = 96 }: { primary: string; secondary: string; number: number | null; size?: number }) {
  // 2番目の色が1番目の色に埋もれるなら、番号は白か黒にする
  const ink = colorDistance(primary, secondary) > 220 ? secondary : textOn(primary);
  const edge = textOn(primary) === '#ffffff' ? '#00000055' : '#00000033';
  return (
    <svg className="jersey" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d="M32 8 L42 4 Q50 13 58 4 L68 8 L94 26 L83 44 L74 38 L74 95 L26 95 L26 38 L17 44 L6 26 Z" fill={primary} stroke={edge} strokeWidth={2} strokeLinejoin="round" />
      <path d="M42 4 Q50 13 58 4" fill="none" stroke={secondary} strokeWidth={4} strokeLinecap="round" />
      <path d="M6 26 L17 44" stroke={secondary} strokeWidth={4} />
      <path d="M94 26 L83 44" stroke={secondary} strokeWidth={4} />
      {number !== null && <text x={50} y={74} textAnchor="middle" fontSize={number >= 10 ? 34 : 38} fontWeight={800} fill={ink}>{number}</text>}
    </svg>
  );
}

/** 優勝のトロフィー */
export function Trophy({ size = 96 }: { size?: number }) {
  return (
    <svg className="trophy" viewBox="0 0 100 110" width={size} height={size * 1.1} aria-hidden="true">
      <defs>
        <linearGradient id="trophy-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset="0.45" stopColor={GOLD} />
          <stop offset="1" stopColor="#9a6a00" />
        </linearGradient>
      </defs>
      <path d="M24 16 Q8 16 9 32 Q11 50 32 54" fill="none" stroke="url(#trophy-gold)" strokeWidth={6} />
      <path d="M76 16 Q92 16 91 32 Q89 50 68 54" fill="none" stroke="url(#trophy-gold)" strokeWidth={6} />
      <path d="M22 8 H78 V30 Q78 62 50 68 Q22 62 22 30 Z" fill="url(#trophy-gold)" stroke="#7a5200" strokeWidth={1.5} />
      <rect x={44} y={67} width={12} height={16} fill="url(#trophy-gold)" />
      <path d="M30 84 H70 L74 100 H26 Z" fill="url(#trophy-gold)" stroke="#7a5200" strokeWidth={1.5} />
      <polygon points="50,20 54,31 66,31 56,38 60,49 50,42 40,49 44,38 34,31 46,31" fill="#fffbe6" opacity={0.85} />
    </svg>
  );
}

const SIGNING_TITLE: Record<Extract<Moment, { kind: 'signing' }>['via'], string> = {
  transfer: '新加入', loan: 'レンタルで加入', free: '新加入（移籍金なし）', abroad: '海外から新加入',
};

function SigningCard({ game, moment, club, player }: {
  game: GameState; moment: Extract<Moment, { kind: 'signing' }>; club: Club; player: PlayerRecord;
}) {
  const from = moment.fromClubId ? game.clubs[moment.fromClubId] : undefined;
  return (
    <>
      <div className="moment-kicker">{SIGNING_TITLE[moment.via]}</div>
      <div className="signing">
        <div className="signing-portrait">
          <PlayerFace game={game} player={player} size={132} />
          <Jersey primary={club.colors.primary} secondary={club.colors.secondary} number={player.squadNumber} size={60} />
        </div>
        <div>
          <h2>{player.name}</h2>
          <div>{POSITION_NAME[player.position]}　{player.age}歳　{player.nationality}</div>
          <div className="muted">総合力 {overallRating(player).toFixed(1)}　背番号 {player.squadNumber ?? '-'}</div>
          <div className="signing-route">
            {from ? <><Emblem spec={from.emblem} size={28} />{from.shortName}</> : <span>{moment.via === 'abroad' ? '海外のクラブ' : '所属なし'}</span>}
            <span className="arrow">→</span>
            <Emblem spec={club.emblem} size={28} />{club.shortName}
          </div>
          {moment.fee > 0 && <div>移籍金 {formatYen(moment.fee)}</div>}
        </div>
      </div>
    </>
  );
}

function NewcomersCard({ game, moment, club }: { game: GameState; moment: Extract<Moment, { kind: 'newcomers' }>; club: Club }) {
  const players = moment.playerIds.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined && p.clubId === club.id);
  return (
    <>
      <div className="moment-kicker">{moment.year}年の新人</div>
      <h2>新人選手が加入しました</h2>
      <div className="newcomers">
        {players.map((p) => (
          <button key={p.id} type="button" className="newcomer" title="選手の詳細を見る"
            onClick={() => { store.update(dismissMoment); store.navigate({ name: 'player', id: p.id }); }}>
            <span className="signing-portrait small">
              <PlayerFace game={game} player={p} size={72} />
              <Jersey primary={club.colors.primary} secondary={club.colors.secondary} number={p.squadNumber} size={34} />
            </span>
            <strong>{p.name}</strong>
            <span className="muted small">{POSITION_NAME[p.position]}</span>
            <span className="muted small">{p.age}歳　総合力 {overallRating(p).toFixed(1)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function TitleCard({ moment, club }: { moment: Extract<Moment, { kind: 'title' }>; club: Club }) {
  const left = LEAGUE_RULES.rounds - moment.round;
  return (
    <>
      <div className="title-trophy">
        <Trophy size={110} />
        <Emblem spec={club.emblem} size={96} />
      </div>
      <div className="moment-kicker">{moment.year}年シーズン</div>
      <h2 className="title-headline">優勝！</h2>
      <p className="title-club">{club.name}</p>
      <p>{left > 0 ? `第${moment.round}節、残り${left}試合を残して優勝が決まりました。` : '最終節で優勝が決まりました。'}勝ち点{moment.points}。</p>
      <p className="muted small">おめでとうございます。選手たち、スタッフ、そしてサポーターと喜びを分かち合いましょう。</p>
    </>
  );
}

/** 積まれた演出を、一番前から1つずつ見せる。チュートリアルや試合の途中は待つ */
export function MomentOverlay() {
  const s = useStore();
  const game = s.game;
  const moments = game?.moments ?? [];
  const moment = moments[0];
  const club = game?.clubs[game.manager.clubId];
  const player = moment?.kind === 'signing' ? game?.players[moment.playerId] : undefined;
  // 選手が去ったあとの加入や、クラブを移ったあとの演出は見せない
  const stale = moment !== undefined && (!club || (moment.kind === 'signing' && player?.clubId !== club.id));
  const enabled = s.settings.celebrations;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (moments.length > 0 && (!enabled || stale)) store.update((g) => { if (!enabled) g.moments = []; else dismissMoment(g); });
  });
  const visible = moment !== undefined && !stale && enabled && !s.tutorial && !s.locked && club !== undefined;
  useEffect(() => {
    if (!visible) return;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.update(dismissMoment); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, moment]);
  if (!visible || !game || !club) return null;

  const close = () => store.update(dismissMoment);
  const rest = moments.length - 1;
  const colors = [club.colors.primary, club.colors.secondary, GOLD, '#ffffff'];
  return (
    <div className="moment-backdrop" role="dialog" aria-modal="true" aria-label="お知らせ" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <Confetti colors={colors} count={moment.kind === 'title' ? 140 : 50} fixed />
      <div className={`moment-card moment-${moment.kind}`} style={{ '--club': club.colors.primary, '--club-ink': textOn(club.colors.primary) } as CSSProperties}>
        {moment.kind === 'signing' && player && <SigningCard game={game} moment={moment} club={club} player={player} />}
        {moment.kind === 'newcomers' && <NewcomersCard game={game} moment={moment} club={club} />}
        {moment.kind === 'title' && <TitleCard moment={moment} club={club} />}
        <div className="button-row">
          {moment.kind === 'signing' && player && (
            <button type="button" className="secondary" onClick={() => { close(); store.navigate({ name: 'player', id: player.id }); }}>選手の詳細を見る</button>
          )}
          <button ref={button} type="button" className="primary" onClick={close}>{rest > 0 ? `次へ（ほかに${rest}件）` : '閉じる'}</button>
        </div>
      </div>
    </div>
  );
}
