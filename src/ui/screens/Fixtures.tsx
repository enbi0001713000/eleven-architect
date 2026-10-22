// 日程と結果：自分の34試合と、節ごとの全試合の結果

import { useState } from 'react';
import { LEAGUE_RULES } from '../../game/rules';
import { fixturesOfClub, fixturesOfRound } from '../../game/season';
import type { Fixture } from '../../game/types';
import { ClubLink, Panel, ResultChip } from '../components/bits';
import { KeyEvents, ScoreHeader, StatsTable } from '../components/MatchSummary';
import { formatDate } from '../format';
import { scoreFor } from '../queries';
import { useGame } from '../store';
import { useTutorial } from '../useTutorial';

export function Fixtures({ initialRound }: { initialRound?: number }) {
  useTutorial('fixtures');
  const game = useGame();
  const myId = game.manager.clubId;
  const [round, setRound] = useState(initialRound ?? Math.min(LEAGUE_RULES.rounds, Math.max(1, game.season.round - 1)));
  const [opened, setOpened] = useState<Fixture | null>(null);

  return (
    <div className="page">
      <h1>日程と結果</h1>
      <div className="grid-2">
        <Panel title="自分の試合" tutorial="fixtures">
          <table className="data-table compact">
            <thead><tr><th>節</th><th>日付</th><th /><th>相手</th><th>結果</th></tr></thead>
            <tbody>
              {fixturesOfClub(game, myId).map((f) => {
                const home = f.homeId === myId;
                const s = scoreFor(f, myId);
                return (
                  <tr key={f.id} className={`clickable${f.round === game.season.round ? ' highlight' : ''}`}
                    onClick={() => (f.result ? setOpened(f) : setRound(f.round))}>
                    <td>{f.round}</td>
                    <td className="small">{formatDate(f.date, false)}</td>
                    <td className="muted small">{home ? 'H' : 'A'}</td>
                    <td><ClubLink game={game} clubId={home ? f.awayId : f.homeId} /></td>
                    <td>{s ? <ResultChip goalsFor={s.goalsFor} goalsAgainst={s.goalsAgainst} /> : <span className="muted">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div>
          <Panel title={
            <span className="round-picker">
              <button type="button" className="secondary small" disabled={round <= 1} onClick={() => setRound(round - 1)}>◀</button>
              第{round}節
              <button type="button" className="secondary small" disabled={round >= LEAGUE_RULES.rounds} onClick={() => setRound(round + 1)}>▶</button>
            </span>
          }>
            <div className="muted small">{formatDate(fixturesOfRound(game, round)[0]?.date ?? game.date)}</div>
            <table className="data-table compact">
              <tbody>
                {fixturesOfRound(game, round).map((f) => (
                  <tr key={f.id} className={`${f.result ? 'clickable' : ''}${f.homeId === myId || f.awayId === myId ? ' highlight' : ''}`}
                    onClick={() => f.result && setOpened(f)}>
                    <td style={{ textAlign: 'right' }}><ClubLink game={game} clubId={f.homeId} short /></td>
                    <td className="center"><strong>{f.result ? `${f.result.homeGoals} - ${f.result.awayGoals}` : 'vs'}</strong></td>
                    <td><ClubLink game={game} clubId={f.awayId} short /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {opened?.result && (
            <Panel title={`第${opened.round}節の試合`} actions={<button type="button" className="link" onClick={() => setOpened(null)}>閉じる</button>}>
              <ScoreHeader game={game} homeId={opened.homeId} awayId={opened.awayId}
                homeGoals={opened.result.homeGoals} awayGoals={opened.result.awayGoals} sub={formatDate(opened.date)} />
              <KeyEvents events={opened.result.events} />
              <StatsTable stats={opened.result.stats}
                names={[game.clubs[opened.homeId]?.shortName ?? '', game.clubs[opened.awayId]?.shortName ?? '']} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
