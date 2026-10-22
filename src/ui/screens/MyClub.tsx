// クラブ：オーナーの目標と信頼度、評価の履歴、クラブの情報、ファンクラブ（要件定義書「画面の一覧」の「クラブ」。スタッフはフェーズ5）

import { useState } from 'react';
import { canNegotiate, financeGoalStatus, goalLabel, trustLabel, verdictLabel } from '../../game/owner';
import { FINANCE_GOAL_LABEL, OWNER, STRICTNESS_LABEL } from '../../game/ownerBalance';
import { standingsOf } from '../../game/standings';
import { TrendChart } from '../components/BalanceChart';
import { Bar, ClubLink, Panel } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { formatDate, SIZE_LABEL } from '../format';
import { store, useGame } from '../store';
import { FanClubTab } from './FanClubTab';

type Tab = 'owner' | 'fanClub';
const TABS: { key: Tab; label: string }[] = [{ key: 'owner', label: 'オーナー' }, { key: 'fanClub', label: 'ファンクラブ' }];

export function MyClub({ initialTab }: { initialTab?: Tab }) {
  const game = useGame();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'owner');
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  const owner = game.owner;
  const goals = owner.goals;
  const row = standingsOf(game).find((r) => r.clubId === club.id);
  const money = financeGoalStatus(game);
  const t = OWNER.thresholds[owner.strictness];
  const played = (row?.played ?? 0) > 0;

  return (
    <div className="page">
      <header className="page-header">
        <Emblem spec={club.emblem} size={56} />
        <div>
          <h1>{club.name}</h1>
          <div className="muted">{club.hometown}　創設{club.founded}年　規模：{SIZE_LABEL[club.size]}　監督 {game.manager.name}</div>
        </div>
      </header>
      <div className="tabs">
        <div className="segmented" data-tutorial="club-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'fanClub' ? <FanClubTab game={game} club={club} /> : (
      <div className="grid-2">
        <Panel title="オーナーの信頼度">
          <div className="trust-row">
            <strong className="trust-value">{Math.round(owner.trust)}</strong>
            <span>{trustLabel(owner.trust)}</span>
            <Bar value={owner.trust} width={200} title={`信頼度 ${Math.round(owner.trust)}`} />
          </div>
          <TrendChart points={owner.trustHistory.map((h) => ({ date: h.date, value: h.trust }))} domain={[0, 100]}
            format={(v) => `${Math.round(v)}`} tick={(v) => `${v}`} label="オーナーの信頼度の推移"
            pointLabel={(d) => formatDate(d)} axisLabel={(d) => `${d.slice(0, 4)}年`} />
          <p className="muted small">
            成績（目標の順位との差、その月の勝ち点）とお金（緊急の借り入れ、オーナーの穴埋め、借り入れの多さ）で、毎月上下します。
            {t.warn[0]}を下回ると警告が届き、シーズン中に{t.dismiss}を下回ると解任されます。シーズンの評価で目標を大きく下回り、{t.seasonDismiss}を下回っても解任されます。
            （オーナーの厳しさ：{STRICTNESS_LABEL[owner.strictness]}）
          </p>
        </Panel>

        <Panel title={`${goals.year}年シーズンの目標`} actions={canNegotiate(game)
          ? <button type="button" className="primary small" onClick={() => store.navigate({ name: 'conversation', topic: 'goals' })}>オーナーと目標を話し合う</button>
          : undefined}>
          <dl className="facts">
            <dt>順位</dt>
            <dd>
              {goalLabel(goals.position)}{goals.position !== goals.basePosition ? `（最初は${goalLabel(goals.basePosition)}）` : ''}
              {played && row && (
                <span className={`tag ${row.position <= goals.position ? 'tag-good' : row.position <= goals.position + 3 ? 'tag-warn' : 'tag-bad'}`} style={{ marginLeft: 8 }}>
                  今 {row.position}位
                </span>
              )}
            </dd>
            <dt>財務</dt>
            <dd>
              {FINANCE_GOAL_LABEL[goals.finance]}
              <span className={`tag ${money.met === null ? '' : money.met ? 'tag-good' : 'tag-bad'}`} style={{ marginLeft: 8 }}>{money.met === null ? '年末に判定' : money.met ? '今は達成' : '今は未達'}</span>
              <div className="muted small">{money.text}</div>
            </dd>
          </dl>
          <p className="muted small">
            {canNegotiate(game)
              ? '目標は、開幕までに1回だけ話し合えます。下げてもらうと予算が減り、上げると予算が増えます。'
              : goals.negotiated ? '今シーズンの目標は、話し合って決めました。' : '開幕したので、今シーズンの目標はもう変えられません。'}
            シーズンが終わると、1月1日にオーナーが評価します。
          </p>
        </Panel>

        <Panel title="これまでの評価">
          {owner.evaluations.length === 0 ? <p className="muted">まだ評価を受けたシーズンはありません。</p> : (
            <table className="data-table compact">
              <thead><tr><th>年</th><th>目標</th><th className="num">順位</th><th>評価</th><th>財務の目標</th><th className="num">信頼度</th></tr></thead>
              <tbody>
                {[...owner.evaluations].reverse().map((e) => (
                  <tr key={e.year}>
                    <td>{e.year}年</td>
                    <td>{goalLabel(e.goal)}</td>
                    <td className="num">{e.position}位</td>
                    <td>{verdictLabel(e.verdict)}</td>
                    <td>{FINANCE_GOAL_LABEL[e.finance]}：{e.financeMet ? '達成' : '未達'}</td>
                    <td className="num">{Math.round(e.trustBefore)} → {Math.round(e.trustAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="クラブの情報">
          <dl className="facts">
            <dt>スタジアム</dt><dd>{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</dd>
            <dt>評判</dt><dd>{club.reputation}</dd>
            <dt>ファンの数</dt><dd>約{club.fans.toLocaleString('ja-JP')}人</dd>
            <dt>ライバル</dt><dd>{club.rivalId && <ClubLink game={game} clubId={club.rivalId} />}</dd>
            <dt>スタッフ</dt><dd className="muted">フェーズ5で加わります</dd>
          </dl>
        </Panel>
      </div>
      )}
    </div>
  );
}
