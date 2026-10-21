// 試合の日：試合前の確認 → 観戦（速さの変更、一時停止、交代と戦術の変更）→ 試合後のレポート → 結果の確定
// 要件定義書「戦術と観戦」「観戦画面」に対応する。他会場の試合は Web Worker で先に計算しておき、時間に合わせて見せる。

import { useEffect, useRef, useState } from 'react';
import { LiveMatch, SUBSTITUTION_RULES } from '../../engine/match';
import { positionRating } from '../../engine/ratings';
import { ROLE_OPTIONS, ROLE_PROFILES } from '../../engine/roles';
import type { FormationName, MatchResult, Role, Side, TeamInstructions } from '../../engine/types';
import { applyMatchday, isSeasonOver, nextFixtureOf, prepareMatchday } from '../../game/season';
import { autoSelect, validateSelection } from '../../game/selection';
import { standingsOf } from '../../game/standings';
import type { Fixture } from '../../game/types';
import { FormBadges, Panel, StaminaBar } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { KeyEvents, ScoreHeader, StatsTable } from '../components/MatchSummary';
import { FORMATIONS_LIST, formatDate, INSTRUCTION_LABELS, POSITION_LABEL, ratingTone } from '../format';
import type { CommentaryMode, MatchSpeed } from '../settings';
import { simulateInBackground } from '../simClient';
import { store, useGame, useStore } from '../store';

type Stage = 'preview' | 'loading' | 'live' | 'report';

interface Running {
  live: LiveMatch;
  fixture: Fixture;
  mySide: Side;
  others: Record<string, MatchResult>;
}

/** 他会場の、その時点までのスコア */
function scoreUntil(result: MatchResult, half: 1 | 2, clock: number): [number, number] {
  const score: [number, number] = [0, 0];
  let currentHalf = 1;
  for (const e of result.events) {
    if (e.type === 'halftime') {
      currentHalf = 2;
      continue;
    }
    if ((e.type === 'goal' || e.type === 'penaltyGoal') && e.side !== null
      && (currentHalf < half || (currentHalf === half && e.clock <= clock))) {
      score[e.side]++;
    }
  }
  return score;
}

export function MatchDay() {
  const game = useGame();
  const s = useStore();
  const myId = game.manager.clubId;
  const [stage, setStage] = useState<Stage>('preview');
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<MatchSpeed>(s.settings.matchSpeed);
  const [mode, setMode] = useState<CommentaryMode>(s.settings.commentary);
  const [showTactics, setShowTactics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const match = useRef<Running | null>(null);

  // 観戦中は一定の間隔で試合を進める（等倍で1分＝1秒）
  useEffect(() => {
    if (!running || stage !== 'live') return;
    const timer = setInterval(() => {
      const m = match.current;
      if (!m) return;
      m.live.advance(m.live.clock + 6 * speed);
      if (m.live.phase === 'halftime' || m.live.phase === 'finished') setRunning(false);
      setTick((t) => t + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [running, stage, speed]);

  useEffect(() => () => store.setLocked(false), []);

  const fixture = nextFixtureOf(game, myId);
  if (isSeasonOver(game) || !fixture) {
    return (
      <div className="page">
        <Panel>
          <p>今シーズンの試合はすべて終わりました。</p>
          <button type="button" className="primary" onClick={() => store.open({ name: 'seasonEnd' })}>シーズンの結果を見る</button>
        </Panel>
      </div>
    );
  }

  const club = game.clubs[myId];
  const formation = club?.tactics.formation ?? '4-4-2';
  const selection = club?.selection ?? null;
  const problems = selection ? validateSelection(game, myId, formation, selection) : ['メンバーが決まっていません'];

  const begin = async () => {
    setError(null);
    setStage('loading');
    store.setLocked(true);
    try {
      const matchday = prepareMatchday(game);
      const mine = matchday.find((m) => m.fixture.id === fixture.id);
      if (!mine) throw new Error('この節の試合が見つかりません');
      const mySide: Side = mine.fixture.homeId === myId ? 0 : 1;
      const others = await simulateInBackground(matchday.filter((m) => m !== mine).map((m) => ({
        id: m.fixture.id, home: m.home, away: m.away, seed: m.seed, important: m.important,
      })));
      const live = new LiveMatch(mine.home, mine.away, {
        seed: mine.seed, important: mine.important, aiControl: mySide === 0 ? [false, true] : [true, false],
      });
      match.current = { live, fixture: mine.fixture, mySide, others };
      setStage('live');
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
      setStage('preview');
      store.setLocked(false);
    }
  };

  const confirm = () => {
    const m = match.current;
    if (!m) return;
    const result = m.live.result();
    store.update((g) => applyMatchday(g, { ...m.others, [m.fixture.id]: result }));
    store.setLocked(false);
    void store.saveNow();
    match.current = null;
    store.open(isSeasonOver(store.game ?? game) ? { name: 'seasonEnd' } : { name: 'home' });
  };

  if (stage === 'preview' || stage === 'loading') {
    const home = fixture.homeId === myId;
    const opponentId = home ? fixture.awayId : fixture.homeId;
    const opponent = game.clubs[opponentId];
    const table = standingsOf(game);
    const rowOf = (id: string) => table.find((r) => r.clubId === id);
    return (
      <div className="page">
        <h1>第{fixture.round}節　{formatDate(fixture.date)}</h1>
        <ScoreHeader game={game} homeId={fixture.homeId} awayId={fixture.awayId} homeGoals={null} awayGoals={null}
          sub={`${home ? 'ホーム' : 'アウェイ'}　${club?.rivalId === opponentId ? 'ダービー' : ''}`} />
        <div className="grid-2">
          <Panel title="相手">
            {opponent && (
              <div className="opponent">
                <Emblem spec={opponent.emblem} size={40} />
                <div>
                  <strong>{opponent.name}</strong>
                  <div className="muted">{rowOf(opponentId)?.position}位　フォーメーション {opponent.tactics.formation}</div>
                  <FormBadges form={rowOf(opponentId)?.form ?? []} />
                </div>
              </div>
            )}
          </Panel>
          <Panel title={`自分のメンバー（${formation}）`} actions={<button type="button" className="link" onClick={() => store.open({ name: 'tactics' })}>戦術画面へ</button>}>
            {selection && (
              <ol className="lineup-list">
                {selection.lineup.map((id) => {
                  const p = game.players[id];
                  return p ? <li key={id}><span className="pos-chip">{POSITION_LABEL[p.position]}</span>{p.name}</li> : null;
                })}
              </ol>
            )}
            <div className="muted small">控え：{selection?.bench.map((id) => game.players[id]?.name).join('、')}</div>
          </Panel>
        </div>
        {problems.length > 0 && (
          <div className="warning">
            メンバーに問題があります：{problems.join('／')}
            <button type="button" className="secondary small" onClick={() => store.update((g) => {
              const c = g.clubs[myId];
              if (c) c.selection = autoSelect(g, myId, c.tactics.formation);
            })}>自動で選び直す</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="button-row">
          <button type="button" className="primary large" disabled={problems.length > 0 || stage === 'loading'} onClick={() => void begin()}>
            {stage === 'loading' ? '準備中…' : '試合開始'}
          </button>
        </div>
      </div>
    );
  }

  const m = match.current;
  if (!m) return null;
  const snap = m.live.snapshot();
  const finished = snap.phase === 'finished';

  if (stage === 'report' && finished) {
    const result = m.live.result();
    return (
      <div className="page">
        <h1>試合後のレポート</h1>
        <ScoreHeader game={game} homeId={m.fixture.homeId} awayId={m.fixture.awayId}
          homeGoals={result.score[0]} awayGoals={result.score[1]} sub={`第${m.fixture.round}節　試合終了`} />
        <div className="grid-2">
          <Panel title="主な出来事"><KeyEvents events={result.events.filter((e) => e.importance >= 2)} /></Panel>
          <Panel title="スタッツ">
            <StatsTable stats={result.stats} names={[game.clubs[m.fixture.homeId]?.shortName ?? '', game.clubs[m.fixture.awayId]?.shortName ?? '']} />
          </Panel>
          {([0, 1] as const).map((side) => (
            <Panel key={side} title={`評価点：${result.teams[side].name}`}>
              <table className="data-table compact">
                <tbody>
                  {result.players.filter((l) => l.side === side).map((l) => (
                    <tr key={l.player.id}>
                      <td>{POSITION_LABEL[l.position]}</td>
                      <td>{l.player.name}{l.minuteOn !== null ? <span className="muted small">（{l.minuteOn}分〜）</span> : null}{l.minuteOff !== null ? <span className="muted small">（〜{l.minuteOff}分）</span> : null}</td>
                      <td className="small">{[l.stats.goals ? `⚽${l.stats.goals}` : '', l.stats.assists ? `A${l.stats.assists}` : '', l.stats.yellowCards ? '🟨' : '', l.stats.redCards ? '🟥' : ''].join(' ')}</td>
                      <td className="num"><span className={`rating ${ratingTone(l.stats.rating)}`}>{l.stats.rating.toFixed(1)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
          <Panel title="他会場の結果">
            <OtherScores game={game} m={m} half={2} clock={Number.POSITIVE_INFINITY} />
          </Panel>
        </div>
        <div className="button-row">
          <button type="button" className="primary large" onClick={confirm}>結果を確定して次へ</button>
        </div>
      </div>
    );
  }

  const events = m.live.events.filter((e) => mode === 'all' || e.importance >= 2).slice(-150).reverse();
  const half: 1 | 2 = snap.phase === 'firstHalf' || snap.phase === 'halftime' ? 1 : 2;
  const mine = snap.sides[m.mySide];
  const theirs = snap.sides[m.mySide === 0 ? 1 : 0];

  return (
    <div className="page live">
      <ScoreHeader game={game} homeId={m.fixture.homeId} awayId={m.fixture.awayId}
        homeGoals={snap.score[0]} awayGoals={snap.score[1]}
        sub={snap.phase === 'halftime' ? 'ハーフタイム' : finished ? '試合終了' : snap.minute} />

      <div className="live-controls">
        {!finished && snap.phase !== 'halftime' && (
          <button type="button" className="primary" onClick={() => setRunning(!running)}>{running ? '⏸ 一時停止' : '▶ 再開'}</button>
        )}
        {snap.phase === 'halftime' && (
          <button type="button" className="primary" onClick={() => { m.live.startSecondHalf(); setRunning(true); setTick((t) => t + 1); }}>▶ 後半開始</button>
        )}
        <div className="segmented small">
          {([1, 2, 4] as MatchSpeed[]).map((v) => (
            <button key={v} type="button" className={speed === v ? 'active' : ''} onClick={() => setSpeed(v)}>{v === 1 ? '等倍' : `${v}倍`}</button>
          ))}
        </div>
        {!finished && (
          <button type="button" className="secondary" title="残りの交代と戦術の変更はAIに任せます"
            onClick={() => { m.live.setAiControl(m.mySide, true); m.live.playToEnd(); setRunning(false); setTick((t) => t + 1); }}>
            結果まで飛ばす
          </button>
        )}
        {!finished && (
          <label className="inline small">
            <input type="checkbox" checked={m.live.isAiControlled(m.mySide)}
              onChange={(e) => { m.live.setAiControl(m.mySide, e.target.checked); setTick((t) => t + 1); }} />
            交代と戦術の変更をAIに任せる
          </label>
        )}
        {!finished && (
          <button type="button" className="secondary" onClick={() => { setRunning(false); setShowTactics(true); }}>交代・戦術の変更</button>
        )}
        <div className="segmented small">
          <button type="button" className={mode === 'key' ? 'active' : ''} onClick={() => setMode('key')}>主な場面</button>
          <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>すべての実況</button>
        </div>
        {finished && <button type="button" className="primary" onClick={() => setStage('report')}>試合後のレポートへ ▶</button>}
      </div>

      {showTactics && !finished && (
        <TacticsPanel live={m.live} side={m.mySide} onChange={() => setTick((t) => t + 1)}
          onClose={() => { setShowTactics(false); setTick((t) => t + 1); }} />
      )}

      <div className="live-grid">
        <Panel title="実況">
          <ul className="commentary">
            {events.map((e, i) => (
              <li key={`${e.clock}-${i}`} className={`event imp-${e.importance} type-${e.type} side-${e.side ?? 'none'}`}>
                <span className="event-minute">{e.minute}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <div>
          <Panel title="選手">
            <PlayersOnPitch side={mine} />
            <div className="muted small">交代 {mine.subsUsed}/{SUBSTITUTION_RULES.maxSubs}　交代の回数 {mine.windowsUsed}/{SUBSTITUTION_RULES.maxWindows}（ハーフタイムは数えない）</div>
          </Panel>
          <Panel title="スタッツ">
            <StatsTable stats={[snap.sides[0].stats, snap.sides[1].stats]}
              names={[game.clubs[m.fixture.homeId]?.shortName ?? '', game.clubs[m.fixture.awayId]?.shortName ?? '']} />
          </Panel>
          <Panel title="他会場">
            <OtherScores game={game} m={m} half={half} clock={snap.phase === 'halftime' ? Number.POSITIVE_INFINITY : finished ? Number.POSITIVE_INFINITY : snap.clock} full={finished} />
          </Panel>
          <Panel title={`相手：${theirs.team.name}`}>
            <PlayersOnPitch side={theirs} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function OtherScores({ game, m, half, clock, full }: {
  game: ReturnType<typeof useGame>; m: Running; half: 1 | 2; clock: number; full?: boolean;
}) {
  return (
    <table className="data-table compact">
      <tbody>
        {Object.entries(m.others).map(([id, result]) => {
          const [h, a] = full ? result.score : scoreUntil(result, half, clock);
          return (
            <tr key={id}>
              <td style={{ textAlign: 'right' }}>{game.clubs[result.teams[0].id]?.shortName}</td>
              <td className="center"><strong>{h} - {a}</strong></td>
              <td>{game.clubs[result.teams[1].id]?.shortName}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PlayersOnPitch({ side, compact }: { side: ReturnType<LiveMatch['snapshot']>['sides'][0]; compact?: boolean }) {
  return (
    <table className="data-table compact">
      <tbody>
        {side.onPitch.map((p) => (
          <tr key={p.player.id} className={p.sentOff ? 'sent-off' : ''}>
            <td>{POSITION_LABEL[p.position]}</td>
            <td>{p.player.name}{p.stats.yellowCards > 0 && !p.sentOff ? ' 🟨' : ''}{p.sentOff ? ' 🟥' : ''}{p.stats.goals > 0 ? ` ⚽${p.stats.goals > 1 ? p.stats.goals : ''}` : ''}</td>
            {!compact && <td className="small muted">{ROLE_PROFILES[p.role].label}</td>}
            <td><StaminaBar value={p.stamina} /></td>
            <td className="num"><span className={`rating ${ratingTone(p.stats.rating)}`}>{p.stats.rating.toFixed(1)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 試合中の交代と戦術の変更 */
function TacticsPanel({ live, side, onChange, onClose }: { live: LiveMatch; side: Side; onChange: () => void; onClose: () => void }) {
  const current = live.snapshot().sides[side];
  const [formation, setFormation] = useState<FormationName>(current.tactics.formation);
  const [instructions, setInstructions] = useState<TeamInstructions>(current.tactics.instructions);
  const [roles, setRoles] = useState<Role[]>(current.onPitch.map((p) => p.role));
  const [outId, setOutId] = useState('');
  const [inId, setInId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [, setVersion] = useState(0);

  const substitute = () => {
    const result = live.substitute(side, outId, inId);
    setMessage(result.ok ? '交代しました' : result.message ?? '交代できませんでした');
    if (result.ok) {
      setOutId('');
      setInId('');
      setRoles(live.snapshot().sides[side].onPitch.map((p) => p.role));
    }
    setVersion((v) => v + 1);
    onChange();
  };

  const apply = () => {
    const formationChanged = formation !== current.tactics.formation;
    const result = live.changeTactics(side, formationChanged ? { formation, instructions } : { instructions, roles });
    setMessage(result.ok ? '戦術を変更しました' : result.message ?? '変更できませんでした');
    if (result.ok) {
      setRoles(live.snapshot().sides[side].onPitch.map((p) => p.role));
      setVersion((v) => v + 1);
      onChange();
    }
  };

  const outgoing = current.onPitch.find((p) => p.player.id === outId);

  return (
    <div className="tactics-overlay">
      <Panel title="交代・戦術の変更（試合は止まっています）" actions={<button type="button" className="primary" onClick={onClose}>閉じて戻る</button>}>
        <div className="grid-2">
          <div>
            <h3>選手交代（{current.subsUsed}/{SUBSTITUTION_RULES.maxSubs}人、回数 {current.windowsUsed}/{SUBSTITUTION_RULES.maxWindows}）</h3>
            <label className="block">下げる選手
              <select value={outId} onChange={(e) => setOutId(e.target.value)}>
                <option value="">選ぶ…</option>
                {current.onPitch.filter((p) => !p.sentOff).map((p) => (
                  <option key={p.player.id} value={p.player.id}>{POSITION_LABEL[p.position]} {p.player.name}（スタミナ{Math.round(p.stamina)}・評価{p.stats.rating.toFixed(1)}）</option>
                ))}
              </select>
            </label>
            <label className="block">入れる選手
              <select value={inId} onChange={(e) => setInId(e.target.value)}>
                <option value="">選ぶ…</option>
                {current.bench.filter((b) => !b.used).map((b) => (
                  <option key={b.player.id} value={b.player.id}>
                    {POSITION_LABEL[b.player.position]} {b.player.name}{outgoing ? `（この枠での力 ${positionRating(b.player, outgoing.position).toFixed(1)}）` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary" disabled={!outId || !inId} onClick={substitute}>交代する</button>
          </div>
          <div>
            <h3>戦術</h3>
            <label className="inline">フォーメーション
              <select value={formation} onChange={(e) => setFormation(e.target.value as FormationName)}>
                {FORMATIONS_LIST.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            {INSTRUCTION_LABELS.map((item) => (
              <div key={item.key} className="instruction">
                <span className="instruction-label">{item.label}</span>
                <div className="segmented small">
                  {[-2, -1, 0, 1, 2].map((v) => (
                    <button key={v} type="button" className={instructions[item.key] === v ? 'active' : ''}
                      onClick={() => setInstructions({ ...instructions, [item.key]: v })}>
                      {v === -2 ? item.low : v === 2 ? item.high : v === 0 ? '標準' : v > 0 ? '＋' : '−'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {formation === current.tactics.formation && (
              <details>
                <summary>役割を変える</summary>
                {current.onPitch.map((p, i) => (
                  <label key={p.player.id} className="inline">
                    {POSITION_LABEL[p.position]} {p.player.name}
                    <select value={roles[i]} onChange={(e) => setRoles(roles.map((r, j) => (j === i ? (e.target.value as Role) : r)))}>
                      {ROLE_OPTIONS[p.position].map((r) => <option key={r} value={r}>{ROLE_PROFILES[r].label}</option>)}
                    </select>
                  </label>
                ))}
              </details>
            )}
            {formation !== current.tactics.formation && <p className="muted small">フォーメーションを変えると、選手は適性の高い枠に自動で並び直し、役割は初期値に戻ります。</p>}
            <button type="button" className="primary" onClick={apply}>戦術を変更する</button>
          </div>
        </div>
        {message && <p className="notice">{message}</p>}
      </Panel>
    </div>
  );
}
