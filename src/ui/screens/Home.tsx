// ホーム（まとめ画面）：次の試合、順位、最近の結果、受信箱の新着、チームの状態（要件定義書「画面の一覧」）

import { overallRating } from '../../engine/ratings';
import { injuryName, moraleLabel, teamFamiliarity } from '../../game/condition';
import { daysBetween } from '../../game/dates';
import { debtOf, netResult, payrollOf, yearToDate, yenText } from '../../game/finance';
import { totalMembers } from '../../game/fanClub';
import { financeGoalStatus, goalLabel, trustLabel } from '../../game/owner';
import { FINANCE_GOAL_LABEL } from '../../game/ownerBalance';
import { pendingActions } from '../../game/inbox';
import { todaysFixture } from '../../game/progress';
import { averageRating, isSeasonOver, nextFixtureOf } from '../../game/season';
import { clubPlayers, validateSelection } from '../../game/selection';
import { standingsOf } from '../../game/standings';
import { meetingCooldownLeft } from '../../game/talks';
import { Bar, ClubLink, FormBadges, Panel, Rating, ResultChip } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { fanMoodLabel, formatDate, INBOX_CATEGORY_LABEL, POSITION_LABEL } from '../format';
import { playedFixtures, scoreFor, topScorers } from '../queries';
import { store, useGame } from '../store';

export function Home() {
  const game = useGame();
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  const table = standingsOf(game);
  const myRow = table.find((r) => r.clubId === myId);
  const next = nextFixtureOf(game, myId);
  const recent = playedFixtures(game, myId).slice(-5).reverse();
  const formation = club?.tactics.formation ?? '4-4-2';
  const problems = club?.selection ? validateSelection(game, myId, formation, club.selection) : ['メンバーが決まっていません'];
  const squad = clubPlayers(game, myId);
  const suspended = squad.filter((p) => p.discipline.suspendedMatches > 0);
  const warned = squad.filter((p) => p.discipline.yellowAccumulation === 3);
  const injured = squad.filter((p) => p.status.injury).sort((a, b) => (a.status.injury?.daysLeft ?? 0) - (b.status.injury?.daysLeft ?? 0));
  const moraleAvg = squad.reduce((n, p) => n + p.status.morale, 0) / Math.max(1, squad.length);
  const today = todaysFixture(game);
  const latest = game.inbox.slice(0, 6);
  const waiting = pendingActions(game);

  // 自分の順位の前後を見せる
  const myIndex = myRow ? myRow.position - 1 : 0;
  const start = Math.max(0, Math.min(table.length - 7, myIndex - 3));
  const nearby = table.slice(start, start + 7);

  return (
    <div className="page home">
      <h1>ホーム</h1>
      <div className="grid-2">
        <Panel title="次の試合">
          {isSeasonOver(game) && (
            <div className="next-match">
              <p>今シーズンの全日程が終わりました。「次の出来事まで進める」で、シーズンの総括、引退の発表、新しい日程、新人の加入と進みます。</p>
              <button type="button" className="secondary" onClick={() => store.open({ name: 'seasonEnd' })}>シーズンの結果を見る</button>
            </div>
          )}
          {next && (() => {
            const home = next.homeId === myId;
            const opponentId = home ? next.awayId : next.homeId;
            const opponent = game.clubs[opponentId];
            const oppRow = table.find((r) => r.clubId === opponentId);
            const derby = club?.rivalId === opponentId;
            return (
              <div className="next-match">
                <div className="muted">
                  第{next.round}節　{formatDate(next.date)}　{home ? 'ホーム' : 'アウェイ'}{derby ? '　ダービー' : ''}
                  {today ? <span className="tag tag-good" style={{ marginLeft: 8 }}>今日</span> : <span className="small">（あと{daysBetween(game.date, next.date)}日）</span>}
                </div>
                <div className="next-match-vs">
                  {opponent && <Emblem spec={opponent.emblem} size={56} />}
                  <div>
                    <div className="vs-name">vs {opponent?.name}</div>
                    <div className="muted">{oppRow ? `${oppRow.position}位　勝ち点${oppRow.points}` : ''}</div>
                    {oppRow && <FormBadges form={oppRow.form} />}
                  </div>
                </div>
                {problems.length > 0 && (
                  <div className="warning">
                    メンバーに問題があります：{problems.join('／')}
                    <button type="button" className="secondary small" onClick={() => store.open({ name: 'tactics' })}>戦術画面で直す</button>
                  </div>
                )}
                <div className="button-row">
                  <button type="button" className="secondary" onClick={() => store.open({ name: 'tactics' })}>スタメンと戦術</button>
                  {today
                    ? <button type="button" className="primary" onClick={() => store.open({ name: 'match' })}>試合へ ▶</button>
                    : <button type="button" className="primary" onClick={() => store.advance()}>次の出来事まで進める ▶</button>}
                </div>
              </div>
            );
          })()}
        </Panel>

        <Panel title="順位" actions={<button type="button" className="link" onClick={() => store.open({ name: 'league' })}>順位表へ</button>}>
          <table className="data-table compact">
            <thead><tr><th>順位</th><th>クラブ</th><th className="num">試合</th><th className="num">差</th><th className="num">勝ち点</th><th>直近</th></tr></thead>
            <tbody>
              {nearby.map((row) => (
                <tr key={row.clubId} className={row.clubId === myId ? 'highlight' : ''}>
                  <td>{row.position}</td>
                  <td><ClubLink game={game} clubId={row.clubId} short /></td>
                  <td className="num">{row.played}</td>
                  <td className="num">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td className="num"><strong>{row.points}</strong></td>
                  <td><FormBadges form={row.form} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="最近の結果">
          {recent.length === 0 && <p className="muted">まだ試合をしていません。</p>}
          <ul className="result-list">
            {recent.map((f) => {
              const s = scoreFor(f, myId);
              if (!s) return null;
              return (
                <li key={f.id}>
                  <span className="muted small">第{f.round}節</span>
                  <ResultChip goalsFor={s.goalsFor} goalsAgainst={s.goalsAgainst} />
                  <span className="muted small">{s.home ? 'H' : 'A'}</span>
                  <ClubLink game={game} clubId={s.opponentId} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="オーナーの評価" actions={<button type="button" className="link" onClick={() => store.open({ name: 'myClub' })}>クラブの画面へ</button>}>
          {(() => {
            const owner = game.owner;
            const money = financeGoalStatus(game);
            return (
              <dl className="facts">
                <dt>信頼度</dt>
                <dd className="trust-row">
                  <strong>{Math.round(owner.trust)}</strong><span>{trustLabel(owner.trust)}</span>
                  <Bar value={owner.trust} width={120} title={`信頼度 ${Math.round(owner.trust)}`} />
                </dd>
                <dt>順位の目標</dt>
                <dd>{goalLabel(owner.goals.position)}{myRow && myRow.played > 0 ? `（今 ${myRow.position}位）` : ''}</dd>
                <dt>財務の目標</dt>
                <dd>{FINANCE_GOAL_LABEL[owner.goals.finance]}<span className={`tag ${money.met === null ? '' : money.met ? 'tag-good' : 'tag-bad'}`} style={{ marginLeft: 6 }}>{money.met === null ? '年末に判定' : money.met ? '今は達成' : '今は未達'}</span></dd>
              </dl>
            );
          })()}
        </Panel>

        <Panel title="受信箱の新着" actions={<button type="button" className="link" onClick={() => store.open({ name: 'inbox' })}>受信箱へ</button>}>
          {waiting.length > 0 && <div className="warning small">返事を待っている知らせが{waiting.length}件あります。</div>}
          <ul className="notice-list">
            {latest.map((m) => (
              <li key={m.id} className="clickable" onClick={() => store.open({ name: 'inbox', messageId: m.id })}>
                <span className="muted small">{formatDate(m.date, false)}</span>
                <span className="tag">{INBOX_CATEGORY_LABEL[m.category]}</span>
                <span style={{ fontWeight: m.read ? 400 : 700 }}>{m.subject}</span>
              </li>
            ))}
            {latest.length === 0 && <li className="muted">知らせはまだありません。</li>}
          </ul>
        </Panel>

        <Panel title="チームの状態" actions={
          <button type="button" className="link" disabled={meetingCooldownLeft(game) > 0} onClick={() => store.navigate({ name: 'meeting' })}>
            チームミーティング{meetingCooldownLeft(game) > 0 ? `（あと${meetingCooldownLeft(game)}日）` : ''}
          </button>}>
          <dl className="facts">
            <dt>チームのモラル</dt><dd>{moraleLabel(moraleAvg)}（{Math.round(moraleAvg)}）</dd>
            <dt>ファンの雰囲気</dt><dd>{fanMoodLabel(game.fanMood)}</dd>
            {club && <><dt>戦術の熟成度</dt><dd>{Math.round(teamFamiliarity(club))}%</dd></>}
          </dl>
          <ul className="notice-list">
            {injured.map((p) => (
              <li key={p.id}><span className="tag tag-bad">ケガ</span>{p.name}：{p.status.injury && injuryName(p.status.injury)}（残り{p.status.injury?.daysLeft}日）</li>
            ))}
            {suspended.map((p) => (
              <li key={p.id}><span className="tag tag-bad">出場停止</span>{p.name}（残り{p.discipline.suspendedMatches}試合）</li>
            ))}
            {warned.map((p) => (
              <li key={p.id}><span className="tag tag-warn">警告3枚</span>{p.name}：次に警告を受けると出場停止</li>
            ))}
            {injured.length === 0 && suspended.length === 0 && warned.length === 0 && <li className="muted">ケガ人や出場停止の選手はいません。</li>}
          </ul>
        </Panel>

        <Panel title="チームの得点ランキング">
          <table className="data-table compact">
            <thead><tr><th>選手</th><th>Pos</th><th className="num">得点</th><th className="num">アシスト</th><th className="num">平均評価</th></tr></thead>
            <tbody>
              {topScorers(game, 5, myId).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => store.navigate({ name: 'player', id: p.id })}>
                  <td>{p.name}</td>
                  <td>{POSITION_LABEL[p.position]}</td>
                  <td className="num">{p.season.goals}</td>
                  <td className="num">{p.season.assists}</td>
                  <td className="num"><Rating value={averageRating(p.season)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {topScorers(game, 1, myId).length === 0 && <p className="muted">まだ得点がありません。</p>}
        </Panel>

        <Panel title="クラブとお金" actions={<button type="button" className="link" onClick={() => store.open({ name: 'finance' })}>財務へ</button>}>
          {club && (() => {
            const fin = club.finance;
            const net = netResult(yearToDate(fin));
            const payroll = payrollOf(game, myId);
            return (
              <dl className="facts">
                <dt>スタジアム</dt><dd>{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</dd>
                <dt>ライバル</dt><dd>{club.rivalId && <ClubLink game={game} clubId={club.rivalId} />}</dd>
                <dt>選手の平均総合力</dt>
                <dd>{(squad.reduce((n, p) => n + overallRating(p), 0) / Math.max(1, club.playerIds.length)).toFixed(1)}</dd>
                <dt>手元のお金</dt><dd className={fin.balance < 0 ? 'tone-low' : ''}>{yenText(fin.balance)}{debtOf(fin) > 0 ? `（借り入れの残り ${yenText(debtOf(fin))}）` : ''}</dd>
                <dt>今年の差し引き</dt><dd className={net < 0 ? 'tone-low' : ''}>{yenText(net)}（{net >= 0 ? '黒字' : '赤字'}）</dd>
                <dt>年俸 ／ 年俸予算</dt><dd className={payroll > fin.budget.wages ? 'tone-low' : ''}>{yenText(payroll)} ／ {yenText(fin.budget.wages)}</dd>
                <dt>ファンクラブ</dt>
                <dd>
                  会員 {totalMembers(club.fanClub.members).toLocaleString('ja-JP')}人
                  <button type="button" className="link" onClick={() => store.open({ name: 'myClub', tab: 'fanClub' })}>ファンクラブへ</button>
                </dd>
              </dl>
            );
          })()}
        </Panel>
      </div>
    </div>
  );
}
