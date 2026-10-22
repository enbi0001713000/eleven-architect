// スカウト：スカウトの仕事（指名して調べる、条件を付けて探す）、レポート、新人の候補、海外の選手。
// 要件定義書 フェーズ4「スカウト」「新人の獲得（高校生・大学生）」（フェーズ4-C）。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import type { Position } from '../../engine/types';
import { formatValueRange } from '../../game/contracts';
import { knowledgeOf, viewAttribute } from '../../game/knowledge';
import { offerFrom, offersOpen, prospectPlayers, SCHOOL_LABEL } from '../../game/prospects';
import {
  cancelAssignment, freeScouts, isFoundOverseas, regionOf, scoutCount, scoutReport, searchProblem, startSearch, type SearchFilter,
} from '../../game/scouting';
import { PROSPECTS, SCOUT_REGIONS, SCOUTING } from '../../game/scoutingBalance';
import { SQUAD_ROLE_LABEL } from '../../game/morale';
import type { GameState, PlayerRecord, ScoutAssignment, ScoutRegion } from '../../game/types';
import { AttributeValue, ClubLink, Panel } from '../components/bits';
import { GradeBadge, ScoutButton, StarRange } from '../components/ScoutReport';
import { formatDate, POSITION_LABEL, POSITION_ORDER } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

export type ScoutingTab = 'scouts' | 'reports' | 'prospects' | 'overseas';

const TABS: { key: ScoutingTab; label: string }[] = [
  { key: 'scouts', label: 'スカウト' },
  { key: 'reports', label: 'レポート' },
  { key: 'prospects', label: '新人の候補' },
  { key: 'overseas', label: '海外の選手' },
];

const closeText = `${Number(PROSPECTS.offersClose.slice(0, 2))}月${Number(PROSPECTS.offersClose.slice(3))}日`;

export function Scouting({ initialTab }: { initialTab?: ScoutingTab }) {
  useTutorial('scouting');
  const game = useGame();
  const fallback: ScoutingTab = offersOpen(game.date) && prospectPlayers(game).length > 0 ? 'prospects' : 'scouts';
  const [tab, setTab] = useState<ScoutingTab>(initialTab ?? fallback);
  const club = game.clubs[game.manager.clubId];
  if (!club) return <div className="page"><h1>スカウト</h1><p>監督をしているクラブがありません。</p></div>;
  return (
    <div className="page">
      <div className="toolbar">
        <h1>スカウト</h1>
        <div className="segmented" data-tutorial="scout-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <Summary game={game} />
      {tab === 'scouts' && <Scouts game={game} />}
      {tab === 'reports' && <Reports game={game} />}
      {tab === 'prospects' && <Prospects game={game} />}
      {tab === 'overseas' && <Overseas game={game} />}
    </div>
  );
}

function Summary({ game }: { game: GameState }) {
  const myId = game.manager.clubId;
  const prospects = prospectPlayers(game);
  const mine = prospects.filter((p) => p.prospect!.signed?.clubId === myId).length;
  const waiting = prospects.filter((p) => !p.prospect!.signed && offerFrom(p, myId)).length;
  return (
    <div className="stat-tiles" data-tutorial="scout-tiles">
      <div className="stat-tile">
        <span className="muted small">スカウト</span>
        <strong>{scoutCount(game)}人</strong>
        <span className="muted small">空き {freeScouts(game)}人</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">レポート</span>
        <strong>{(game.scouting?.reports ?? []).length}人</strong>
        <span className="muted small">調べた選手</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">新人の候補</span>
        <strong>{prospects.length > 0 ? `${prospects.length}人` : '-'}</strong>
        <span className="muted small">{prospects.length > 0 ? `内定は${closeText}まで` : '6月1日に発表'}</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">内定</span>
        <strong>{mine}人</strong>
        <span className="muted small">返事待ち {waiting}人</span>
      </div>
    </div>
  );
}

function assignmentText(game: GameState, a: ScoutAssignment): string {
  if (a.kind === 'player') return `${game.players[a.playerId ?? '']?.name ?? '（いなくなった選手）'}を調べる`;
  return `${SCOUT_REGIONS[a.region ?? 'domestic'].label}${a.position ? `の${POSITION_LABEL[a.position]}` : ''}${a.maxAge ? `（${a.maxAge}歳以下）` : ''}を探す`;
}

function Scouts({ game }: { game: GameState }) {
  const [filter, setFilter] = useState<SearchFilter>({ region: 'domestic', position: null, maxAge: null });
  const [note, setNote] = useState('');
  const assignments = game.scouting?.assignments ?? [];
  const problem = searchProblem(game, filter);
  const overseas = filter.region !== 'domestic' && filter.region !== 'students';
  return (
    <div className="grid-2">
      <Panel title={`スカウトの仕事（${assignments.length}/${scoutCount(game)}人）`} tutorial="scout-work">
        {assignments.length === 0 ? <p className="muted">今は、どのスカウトも空いています。</p> : (
          <ul className="bid-list">
            {assignments.map((a) => (
              <li key={a.id} className="bid-row">
                <div><strong>{assignmentText(game, a)}</strong></div>
                <div className="button-row">
                  <span className="muted small">{formatDate(a.start, false)}から、{formatDate(a.due, false)}ごろに報告</span>
                  <button type="button" className="secondary small" onClick={() => store.update((g) => cancelAssignment(g, a.id))}>呼び戻す</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          選手を指名して調べるときは、選手の詳細の「スカウトレポート」か、この画面の「新人の候補」「海外の選手」から「スカウトを送る」を押します（国内{SCOUTING.playerDays.near}日、海外{SCOUTING.playerDays.overseas}日）。
          スカウトの人数はクラブの規模で決まります（大{SCOUTING.scouts.large}人、中{SCOUTING.scouts.medium}人、小{SCOUTING.scouts.small}人）。
        </p>
      </Panel>
      <Panel title="条件を付けて探す" tutorial="scout-search">
        <div className="offer-form">
          <label htmlFor="region">地域</label>
          <select id="region" value={filter.region} onChange={(e) => setFilter({ ...filter, region: e.target.value as ScoutRegion })}>
            {(Object.keys(SCOUT_REGIONS) as ScoutRegion[]).map((r) => <option key={r} value={r}>{SCOUT_REGIONS[r].label}</option>)}
          </select>
          <label htmlFor="position">ポジション</label>
          <select id="position" value={filter.position ?? ''} onChange={(e) => setFilter({ ...filter, position: (e.target.value || null) as Position | null })}>
            <option value="">どこでも</option>
            {POSITION_ORDER.map((pos) => <option key={pos} value={pos}>{POSITION_LABEL[pos]}</option>)}
          </select>
          <label htmlFor="age">年齢</label>
          <select id="age" value={filter.maxAge ?? 0} onChange={(e) => setFilter({ ...filter, maxAge: Number(e.target.value) || null })}>
            {[0, 21, 24, 27, 30].map((a) => <option key={a} value={a}>{a === 0 ? '何歳でも' : `${a}歳以下`}</option>)}
          </select>
        </div>
        <p className="muted small">
          {overseas ? SCOUTING.searchDays.overseas : SCOUTING.searchDays.near}日ほどで、条件に合うまだ調べていない選手を、良い順に{SCOUTING.searchFinds}人まで報告します。
          {overseas ? '海外の選手は、見つけると獲得の申し込みができるようになります（外国籍は5人まで）。' : ''}
        </p>
        {problem && <p className="warning">{problem}</p>}
        <div className="button-row">
          <button type="button" className="primary" disabled={!!problem} onClick={() => {
            let message = '';
            store.update((g) => { message = startSearch(g, filter); });
            setNote(message);
          }}>探しに行く</button>
        </div>
        {note && <p className="notice-box">{note}</p>}
      </Panel>
    </div>
  );
}

function regionLabel(game: GameState, p: PlayerRecord) {
  if (p.clubId) return <ClubLink game={game} clubId={p.clubId} short />;
  if (p.prospect) return <span>{SCHOOL_LABEL[p.prospect.school]}</span>;
  if (isFoundOverseas(game, p)) return <span>{p.nationality}</span>;
  return <span className="muted">所属なし</span>;
}

function Reports({ game }: { game: GameState }) {
  const [onlyGood, setOnlyGood] = useState(false);
  const rows = (game.scouting?.reports ?? []).flatMap((r) => {
    const p = game.players[r.playerId];
    if (!p || p.clubId === game.manager.clubId) return [];
    const view = scoutReport(game, p);
    return !onlyGood || view.grade === 'A' || view.grade === 'B' ? [{ r, p, view }] : [];
  });
  return (
    <Panel title="スカウトレポート" tutorial="scout-reports" actions={
      <label className="inline small nowrap"><input type="checkbox" checked={onlyGood} onChange={(e) => setOnlyGood(e.target.checked)} /> 勧める選手だけ</label>
    }>
      {rows.length === 0 ? <p className="muted">まだレポートはありません。「スカウト」から選手を探しに行くか、選手を指名して調べてください。</p> : (
        <div className="table-wrap"><table className="data-table compact">
          <thead>
            <tr><th>調べた日</th><th>選手</th><th>所属</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th>伸びしろ</th><th className="num">市場価値</th><th>評価</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ r, p, view }) => (
              <tr key={r.playerId}>
                <td>{formatDate(r.date, false)}</td>
                <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                <td>{regionLabel(game, p)}</td>
                <td>{POSITION_LABEL[p.position]}</td>
                <td className="num">{p.age}</td>
                <td className="num"><AttributeValue view={view.overall} /></td>
                <td><StarRange range={view.potential} /></td>
                <td className="num">{formatValueRange(view.value)}</td>
                <td><GradeBadge grade={view.grade} /></td>
                <td><ActionFor game={game} player={p} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Panel>
  );
}

/** レポートの行の、次にできること */
function ActionFor({ game, player }: { game: GameState; player: PlayerRecord }) {
  if (player.prospect) return <button type="button" className="primary small" onClick={() => store.navigate({ name: 'prospect', playerId: player.id })}>内定</button>;
  if (player.clubId || isFoundOverseas(game, player)) {
    return <button type="button" className="primary small" disabled={!!player.leaving || !!player.loan} onClick={() => store.navigate({ name: 'bid', playerId: player.id })}>獲得の交渉</button>;
  }
  return null;
}

function prospectState(game: GameState, p: PlayerRecord): string {
  const myId = game.manager.clubId;
  const prospect = p.prospect!;
  if (prospect.signed) return prospect.signed.clubId === myId ? '内定（加入予定）' : `${game.clubs[prospect.signed.clubId]?.shortName ?? '他クラブ'}に決定`;
  const mine = offerFrom(p, myId);
  if (mine) return `内定を出した（${SQUAD_ROLE_LABEL[mine.role]}）`;
  return prospect.offers.length > 0 ? '他クラブが内定を出している' : '';
}

function Prospects({ game }: { game: GameState }) {
  const [position, setPosition] = useState<Position | ''>('');
  const [school, setSchool] = useState<'' | 'high' | 'university'>('');
  const [onlyScouted, setOnlyScouted] = useState(false);
  const all = prospectPlayers(game);
  if (all.length === 0) {
    return (
      <Panel title="新人の候補">
        <p>毎年6月1日に、来年プロになる高校生と大学生の候補が発表されます。スカウトで調べて、{closeText}までに内定を出せます。</p>
        <p className="muted small">内定を出さなくても、足りない分は強化部が新人を獲って、1月10日に加入します。</p>
      </Panel>
    );
  }
  const rows = all
    .filter((p) => (!position || p.position === position) && (!school || p.prospect!.school === school) && (!onlyScouted || knowledgeOf(game, p) > SCOUTING.base.prospect))
    .map((p) => ({ p, view: scoutReport(game, p) }))
    .sort((a, b) => (b.view.overall.low + b.view.overall.high + b.view.potential[0] + b.view.potential[1]) - (a.view.overall.low + a.view.overall.high + a.view.potential[0] + a.view.potential[1]));
  return (
    <Panel title={`新人の候補（${all.length}人）`} tutorial="scout-prospects" actions={
      <div className="inline-form">
        <select value={position} onChange={(e) => setPosition(e.target.value as Position | '')} aria-label="ポジション">
          <option value="">すべてのポジション</option>
          {POSITION_ORDER.map((pos) => <option key={pos} value={pos}>{POSITION_LABEL[pos]}</option>)}
        </select>
        <select value={school} onChange={(e) => setSchool(e.target.value as '' | 'high' | 'university')} aria-label="学校">
          <option value="">高校と大学</option>
          <option value="high">高校</option>
          <option value="university">大学</option>
        </select>
        <label className="inline small nowrap"><input type="checkbox" checked={onlyScouted} onChange={(e) => setOnlyScouted(e.target.checked)} /> 調べた選手だけ</label>
      </div>
    }>
      <p className="muted small">
        {offersOpen(game.date) ? `内定は${closeText}まで出せます。` : '今年の内定の期間は終わりました。'}
        候補は、最初の内定から{PROSPECTS.decideDays}日後に、届いた内定の中から、クラブの評判、出番の見込み、約束する役割、年俸を比べて選びます。
        調べる前は能力の幅が広いので、気になる候補にはスカウトを送りましょう。
      </p>
      <div className="table-wrap"><table className="data-table compact">
        <thead>
          <tr><th>選手</th><th>学校</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th>伸びしろ</th><th className="num">知識度</th><th>状況</th><th /><th /></tr>
        </thead>
        <tbody>
          {rows.map(({ p, view }) => (
            <tr key={p.id}>
              <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
              <td>{SCHOOL_LABEL[p.prospect!.school]}</td>
              <td>{POSITION_LABEL[p.position]}</td>
              <td className="num">{p.age}</td>
              <td className="num"><AttributeValue view={view.overall} /></td>
              <td><StarRange range={view.potential} /></td>
              <td className="num">{view.knowledge}%</td>
              <td className="small">{prospectState(game, p)}</td>
              <td><ScoutButton game={game} player={p} small /></td>
              <td>
                <button type="button" className="primary small" disabled={!!p.prospect!.signed}
                  onClick={() => store.navigate({ name: 'prospect', playerId: p.id })}>{offerFrom(p, game.manager.clubId) ? '内定を見る' : '内定を出す'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Panel>
  );
}

function Overseas({ game }: { game: GameState }) {
  const players = (game.scouting?.found ?? []).map((id) => game.players[id]).filter((p): p is PlayerRecord => !!p && isFoundOverseas(game, p))
    .sort((a, b) => overallRating(b) - overallRating(a));
  return (
    <Panel title={`スカウトが見つけた海外の選手（${players.length}人）`} tutorial="scout-overseas">
      {players.length === 0 ? (
        <p className="muted">まだいません。「スカウト」で、南米、アジア、ヨーロッパに選手を探しに行くと、見つけた選手がここに並びます。</p>
      ) : (
        <div className="table-wrap"><table className="data-table compact">
          <thead>
            <tr><th>選手</th><th>国籍</th><th>地域</th><th>ポジ</th><th className="num">年齢</th><th className="num">総合力</th><th className="num">市場価値</th><th className="num">知識度</th><th /><th /></tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const knowledge = knowledgeOf(game, p);
              return (
                <tr key={p.id}>
                  <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                  <td>{p.nationality}</td>
                  <td className="small">{SCOUT_REGIONS[regionOf(game, p)].label}</td>
                  <td>{POSITION_LABEL[p.position]}</td>
                  <td className="num">{p.age}</td>
                  <td className="num"><AttributeValue view={viewAttribute(overallRating(p), knowledge, `${p.id}:overall`)} /></td>
                  <td className="num">{formatValueRange(scoutReport(game, p).value)}</td>
                  <td className="num">{knowledge}%</td>
                  <td><ScoutButton game={game} player={p} small /></td>
                  <td><button type="button" className="primary small" onClick={() => store.navigate({ name: 'bid', playerId: p.id })}>獲得の交渉</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <p className="muted small">海外の選手の移籍金は、市場価値の9割ほどが目安です。移籍期間に、選手（代理人）と契約がまとまると加入します。</p>
    </Panel>
  );
}
