// 試合の日：試合前の確認 → 試合前の声かけ → 観戦（速さの変更、一時停止、交代と戦術の変更、ハーフタイムの声かけ）
// → 試合後のレポートと声かけ → 結果の確定
// 要件定義書「戦術と観戦」「観戦画面」「面談と声かけ」に対応する。他会場の試合は Web Worker で先に計算しておき、時間に合わせて見せる。

import { useEffect, useRef, useState } from 'react';
import { LiveMatch, SUBSTITUTION_RULES } from '../../engine/match';
import { createRng } from '../../engine/rng';
import { roleLabel } from '../../engine/roles';
import type { MatchEvent, MatchResult, Side } from '../../engine/types';
import { matchGate } from '../../game/finance';
import { applyMatchday, isSeasonOver, nextFixtureOf, prepareMatchday } from '../../game/season';
import { autoSelect, repairSelection, selectionWarnings, validateSelection } from '../../game/selection';
import { standingsOf } from '../../game/standings';
import {
  applyTalkMorale, averageOverall, strengthBalance, TALK_TONES, teamTalk,
  type Reaction, type TalkMoment, type TalkTone,
} from '../../game/talks';
import type { Fixture, PlayerRecord } from '../../game/types';
import { FormBadges, Panel, PosChip, StaminaBar } from '../components/bits';
import { Confetti, GOLD, useForAWhile } from '../components/Celebration';
import { Reactions } from '../components/Reactions';
import { Emblem } from '../components/Emblem';
import { LiveTacticsPanel } from '../components/LiveTacticsPanel';
import { kitColors, MatchPitch } from '../components/MatchPitch';
import { KeyEvents, ScoreHeader, StatsTable } from '../components/MatchSummary';
import { textOn } from '../colors';
import { formatDate, ratingTone } from '../format';
import { moveDuration, stepDelay } from '../matchPace';
import type { CommentaryMode, MatchSpeed } from '../settings';
import { simulateInBackground } from '../simClient';
import { store, useGame, useStore } from '../store';
import { useTutorial } from '../useTutorial';

type Stage = 'preview' | 'loading' | 'pretalk' | 'live' | 'report';

interface Running {
  live: LiveMatch;
  fixture: Fixture;
  mySide: Side;
  others: Record<string, MatchResult>;
  /** 力関係（1 有利、0 互角、-1 不利） */
  favorite: -1 | 0 | 1;
  /** 声かけの反応（試合前、ハーフタイム、試合後）。モラルは結果の確定のときに反映する */
  talks: Partial<Record<TalkMoment, Reaction[]>>;
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
  useTutorial('match');
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

  // 観戦中は1手ずつ進め、手の場面に合わせて待つ（matchPace.ts）。速さを上げると、ボールの動きも時計も速くなる
  const [moveMs, setMoveMs] = useState(400);
  useEffect(() => {
    if (!running || stage !== 'live') return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const m = match.current;
      if (!m) return;
      const before = m.live.events.length;
      m.live.advanceStep();
      const delay = stepDelay(speed, m.live.snapshot(), m.live.events.slice(before));
      setMoveMs(moveDuration(delay));
      setTick((t) => t + 1);
      if (m.live.phase === 'halftime' || m.live.phase === 'finished') {
        setRunning(false);
        return;
      }
      timer = setTimeout(next, delay);
    };
    timer = setTimeout(next, 150);
    return () => clearTimeout(timer);
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

  if ((stage === 'preview' || stage === 'loading') && fixture.date !== game.date) {
    return (
      <div className="page">
        <Panel>
          <p>次の試合（第{fixture.round}節）は{formatDate(fixture.date)}です。今日は{formatDate(game.date)}です。</p>
          <button type="button" className="primary" onClick={() => store.advance()}>次の出来事まで進める ▶</button>
        </Panel>
      </div>
    );
  }

  const club = game.clubs[myId];
  const formation = club?.tactics.formation ?? '4-4-2';
  const selection = club?.selection ?? null;
  const problems = selection ? validateSelection(game, myId, formation, selection) : ['メンバーが決まっていません'];
  const warnings = selection && problems.length === 0 ? selectionWarnings(game, selection) : [];
  const press = game.inbox.find((m) => m.action?.kind === 'press' && m.action.fixtureId === fixture.id && !m.resolved);

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
      const myTeam = mySide === 0 ? mine.home : mine.away;
      const theirTeam = mySide === 0 ? mine.away : mine.home;
      const strength = (ids: string[]) => averageOverall(ids.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined));
      const favorite = strengthBalance(strength(myTeam.lineup), strength(theirTeam.lineup));
      match.current = { live, fixture: mine.fixture, mySide, others, favorite, talks: {} };
      setStage('pretalk');
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
    store.update((g) => {
      applyMatchday(g, { ...m.others, [m.fixture.id]: result });
      for (const reactions of Object.values(m.talks)) applyTalkMorale(g, reactions);
    });
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
    const gate = matchGate(game, fixture, table);
    const venue = game.clubs[fixture.homeId]?.stadium.name ?? '';
    return (
      <div className="page">
        <h1>第{fixture.round}節　{formatDate(fixture.date)}</h1>
        <ScoreHeader game={game} homeId={fixture.homeId} awayId={fixture.awayId} homeGoals={null} awayGoals={null}
          sub={`${home ? 'ホーム' : 'アウェイ'}${club?.rivalId === opponentId ? '　ダービー' : ''}　${venue}　観客の見込み 約${(Math.round(gate.total / 100) * 100).toLocaleString('ja-JP')}人`} />
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
                  return p ? <li key={id}><PosChip position={p.position} />{p.name}</li> : null;
                })}
              </ol>
            )}
            <div className="muted small">控え：{selection?.bench.map((id) => game.players[id]?.name).join('、')}</div>
          </Panel>
        </div>
        {problems.length > 0 && (
          <div className="warning">
            メンバーに問題があります：{problems.join('／')}
            {selection && (
              <button type="button" className="secondary small" onClick={() => store.update((g) => {
                const c = g.clubs[myId];
                if (c?.selection) c.selection = repairSelection(g, myId, c.tactics.formation, c.selection);
              })}>出られない選手だけ入れ替える</button>
            )}
            <button type="button" className="secondary small" onClick={() => store.update((g) => {
              const c = g.clubs[myId];
              if (c) c.selection = autoSelect(g, myId, c.tactics.formation);
            })}>自動で選び直す</button>
          </div>
        )}
        {warnings.length > 0 && <div className="warning small">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
        {press && (
          <Panel title="試合前の記者会見">
            <p className="small">記者会見の準備ができています。出なければ、コーチが代わりに無難に答えます。</p>
            <button type="button" className="secondary" onClick={() => store.navigate({ name: 'press', fixtureId: fixture.id })}>記者会見に出る</button>
          </Panel>
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

  /** 声かけをする。試合前とハーフタイムはその日の出来も変わる */
  const giveTalk = (moment: TalkMoment, tone: TalkTone) => {
    const squad = moment === 'post'
      ? m.live.result().players.filter((l) => l.side === m.mySide).map((l) => l.player.id)
      : [...snap.sides[m.mySide].onPitch.map((p) => p.player.id), ...snap.sides[m.mySide].bench.filter((b) => !b.used).map((b) => b.player.id)];
    const players = squad.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined);
    const goalDiff = snap.score[m.mySide] - snap.score[m.mySide === 0 ? 1 : 0];
    const rng = createRng(game.seed * 31 + m.fixture.round * 7919 + (moment === 'pre' ? 11 : moment === 'half' ? 22 : 33));
    const reactions = teamTalk(rng, players, { moment, goalDiff, favorite: m.favorite }, tone);
    if (moment !== 'post' && tone !== 'none') {
      const label = TALK_TONES.find((t) => t.id === tone)?.label ?? '';
      m.live.boostForm(m.mySide, Object.fromEntries(reactions.map((r) => [r.playerId, r.form])),
        `${snap.sides[m.mySide].team.name}の監督が選手に声をかける（${label}）`);
    }
    m.talks[moment] = reactions;
    setTick((t) => t + 1);
  };

  if (stage === 'pretalk') {
    return (
      <div className="page">
        <ScoreHeader game={game} homeId={m.fixture.homeId} awayId={m.fixture.awayId} homeGoals={null} awayGoals={null}
          sub={`第${m.fixture.round}節　キックオフ前`} />
        <TalkPanel moment="pre" situation={m.favorite === 1 ? '相手より力が上と見られています。' : m.favorite === -1 ? '相手のほうが力が上と見られています。' : '力は互角と見られています。'}
          reactions={m.talks.pre} onTalk={(tone) => giveTalk('pre', tone)} />
        <div className="button-row">
          <button type="button" className="primary large" onClick={() => { setStage('live'); setRunning(true); }}>キックオフ ▶</button>
        </div>
      </div>
    );
  }

  if (stage === 'report' && finished) {
    const result = m.live.result();
    const attendance = matchGate(game, m.fixture, standingsOf(game)).total;
    return (
      <div className="page">
        <h1>試合後のレポート <OutcomeBadge diff={result.score[m.mySide] - result.score[m.mySide === 0 ? 1 : 0]} /></h1>
        <ScoreHeader game={game} homeId={m.fixture.homeId} awayId={m.fixture.awayId}
          homeGoals={result.score[0]} awayGoals={result.score[1]}
          sub={`第${m.fixture.round}節　試合終了　${game.clubs[m.fixture.homeId]?.stadium.name ?? ''}　観客 ${attendance.toLocaleString('ja-JP')}人`} />
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
                      <td><PosChip position={l.position} /></td>
                      <td>{l.player.name}{l.minuteOn !== null ? <span className="muted small">（{l.minuteOn}分〜）</span> : null}{l.minuteOff !== null ? <span className="muted small">（〜{l.minuteOff}分）</span> : null}</td>
                      <td className="small">{[l.stats.goals ? `⚽${l.stats.goals}` : '', l.stats.assists ? `A${l.stats.assists}` : '', l.stats.yellowCards ? '🟨' : '', l.stats.redCards ? '🟥' : '', l.injured ? '🩹負傷' : ''].join(' ')}</td>
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
        <TalkPanel moment="post" situation={result.score[m.mySide] > result.score[m.mySide === 0 ? 1 : 0] ? '勝ちました。' : result.score[m.mySide] === result.score[m.mySide === 0 ? 1 : 0] ? '引き分けました。' : '負けました。'}
          reactions={m.talks.post} onTalk={(tone) => giveTalk('post', tone)} />
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
  const kits = kitColors(game.clubs[m.fixture.homeId]?.colors ?? { primary: '#1559c2', secondary: '#ffffff' }, game.clubs[m.fixture.awayId]?.colors ?? { primary: '#d9480f', secondary: '#ffffff' });
  const lastGoal = [...m.live.events].reverse().find((e) => (e.type === 'goal' || e.type === 'penaltyGoal') && e.side !== null);
  const myClub = game.clubs[myId];
  const diff = snap.score[m.mySide] - snap.score[m.mySide === 0 ? 1 : 0];

  return (
    <div className="page live">
      <ScoreHeader game={game} homeId={m.fixture.homeId} awayId={m.fixture.awayId}
        homeGoals={snap.score[0]} awayGoals={snap.score[1]} live={s.settings.celebrations}
        sub={snap.phase === 'halftime' ? 'ハーフタイム' : finished ? '試合終了' : snap.minute} />
      {s.settings.celebrations && !finished && (
        <GoalFlash goal={lastGoal} colors={kits} mySide={m.mySide}
          scorer={(id) => (id ? game.players[id]?.name : undefined)} club={(side) => snap.sides[side].team.name} />
      )}
      {finished && (
        <div className={`result-banner ${diff > 0 ? 'win' : diff === 0 ? 'draw' : 'loss'}`}
          style={diff > 0 && myClub ? { background: myClub.colors.primary, color: textOn(myClub.colors.primary) } : undefined}>
          {diff > 0 && s.settings.celebrations && myClub && <Confetti colors={[myClub.colors.secondary, GOLD, '#ffffff']} count={40} />}
          <strong>{diff > 0 ? '勝利！' : diff === 0 ? '引き分け' : '敗戦'}</strong>
          <span>{snap.score[m.mySide]} - {snap.score[m.mySide === 0 ? 1 : 0]}　{theirs.team.name}{diff > 0 ? 'に勝ちました' : diff === 0 ? 'と引き分けました' : 'に負けました'}</span>
        </div>
      )}

      <div className="live-controls">
        {!finished && snap.phase !== 'halftime' && (
          <button type="button" className="primary" onClick={() => setRunning(!running)}>{running ? '⏸ 一時停止' : '▶ 再開'}</button>
        )}
        {snap.phase === 'halftime' && (
          <button type="button" className="primary" onClick={() => { m.live.startSecondHalf(); setRunning(true); setTick((t) => t + 1); }}>▶ 後半開始</button>
        )}
        <div className="segmented small">
          {([1, 2, 4, 8] as MatchSpeed[]).map((v) => (
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
        {!s.settings.showPitch && <button type="button" className="secondary" onClick={() => store.updateSettings({ showPitch: true })}>ピッチを見せる</button>}
        <div className="segmented small">
          <button type="button" className={mode === 'key' ? 'active' : ''} onClick={() => setMode('key')}>主な場面</button>
          <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>すべての実況</button>
        </div>
        {finished && <button type="button" className="primary" onClick={() => setStage('report')}>試合後のレポートへ ▶</button>}
      </div>

      {snap.phase === 'halftime' && (
        <TalkPanel moment="half" situation={`前半を終えて ${snap.score[m.mySide]} - ${snap.score[m.mySide === 0 ? 1 : 0]}。`}
          reactions={m.talks.half} onTalk={(tone) => giveTalk('half', tone)} />
      )}

      {showTactics && !finished && (
        <LiveTacticsPanel live={m.live} side={m.mySide} onChange={() => setTick((t) => t + 1)}
          onClose={() => { setShowTactics(false); setTick((t) => t + 1); }} />
      )}

      <div className="live-grid">
        <div>
        {s.settings.showPitch && (
          <Panel title="ピッチ" actions={<button type="button" className="secondary small" onClick={() => store.updateSettings({ showPitch: false })}>隠す</button>}>
            <MatchPitch snapshot={snap} events={m.live.events} colors={kits} moveMs={moveMs} numberOf={(id) => game.players[id]?.squadNumber ?? null} />
          </Panel>
        )}
        <Panel title={<>実況<span className="side-legend"><span className="swatch side-0" />{game.clubs[m.fixture.homeId]?.shortName}<span className="swatch side-1" />{game.clubs[m.fixture.awayId]?.shortName}</span></>}>
          <ul className="commentary">
            {events.map((e, i) => (
              <li key={`${e.clock}-${i}`} className={`event imp-${e.importance} type-${e.type} side-${e.side ?? 'none'}`}>
                <span className="event-minute">{e.minute}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
        </div>
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

/** 点が入ったら、スコアの下に少しの間（実際の時間で）、誰の得点かを大きく出す */
function GoalFlash({ goal, colors, mySide, scorer, club }: {
  goal: MatchEvent | undefined; colors: [string, string]; mySide: Side;
  scorer: (playerId: string | undefined) => string | undefined; club: (side: Side) => string;
}) {
  const shown = useForAWhile(goal, 3200);
  if (!shown || shown.side === null) return null;
  const color = colors[shown.side];
  return (
    <div key={shown.clock} className={`goal-flash${shown.side === mySide ? ' mine' : ''}`} style={{ background: color, color: textOn(color) }} role="status">
      <strong>{shown.type === 'penaltyGoal' ? 'PKで' : ''}ゴール！</strong>
      <span>{shown.minute}　{scorer(shown.playerId) ?? ''}（{club(shown.side)}）</span>
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
            <td><PosChip position={p.position} /></td>
            <td>{p.player.name}{p.stats.yellowCards > 0 && !p.sentOff ? ' 🟨' : ''}{p.sentOff ? ' 🟥' : ''}{p.stats.goals > 0 ? ` ⚽${p.stats.goals > 1 ? p.stats.goals : ''}` : ''}{p.injured ? ' 🩹' : ''}</td>
            {!compact && <td className="small muted">{roleLabel(p.role, p.position)}</td>}
            <td><StaminaBar value={p.stamina} /></td>
            <td className="num"><span className={`rating ${ratingTone(p.stats.rating)}`}>{p.stats.rating.toFixed(1)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutcomeBadge({ diff }: { diff: number }) {
  return <span className={`outcome-badge ${diff > 0 ? 'win' : diff === 0 ? 'draw' : 'loss'}`}>{diff > 0 ? '勝ち' : diff === 0 ? '引き分け' : '負け'}</span>;
}

const MOMENT_TITLE: Record<TalkMoment, string> = { pre: '試合前の声かけ', half: 'ハーフタイムの声かけ', post: '試合後の声かけ' };

/** 声かけ：言い方を選ぶと、選手の反応が出る。選手の性格と試合の状況で効き方が変わる */
function TalkPanel({ moment, situation, reactions, onTalk }: {
  moment: TalkMoment; situation: string; reactions: Reaction[] | undefined; onTalk: (tone: TalkTone) => void;
}) {
  return (
    <section className="panel talk-panel">
      <header className="panel-header"><h2>{MOMENT_TITLE[moment]}</h2></header>
      <div className="panel-body">
        <p className="small">{situation}{reactions ? '' : ' 選手たちにどう声をかけますか？'}</p>
        {reactions ? <Reactions reactions={reactions} /> : (
          <div className="button-row">
            {TALK_TONES.map((t) => (
              <button key={t.id} type="button" className={t.id === 'none' ? 'secondary' : 'primary'} onClick={() => onTalk(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
        {!reactions && <p className="muted small">気の強い選手は叱られて奮起し、プレッシャーに弱い選手は鼓舞されると萎縮することがあります。</p>}
      </div>
    </section>
  );
}
