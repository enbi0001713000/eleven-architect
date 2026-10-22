// 監督：評判と経歴、届いているオファー、監督が空いているクラブ（応募）、これまでのクラブ（要件定義書「解任と転職」、フェーズ3-C）。
// 無職の間は、この画面がホームになる。

import { applyFor, canApply, declineOffer, isUnemployed, reputationLabel, resign, vacancies } from '../../game/career';
import { BACKGROUNDS, DIFFICULTIES } from '../../game/careerBalance';
import { goalLabel, positionGoalFor, verdictLabel } from '../../game/owner';
import type { StintEnd } from '../../game/types';
import { TrendChart } from '../components/BalanceChart';
import { Bar, Panel } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { formatDate, SIZE_LABEL } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

const END_LABEL: Record<StintEnd, string> = { dismissed: '解任', resigned: '辞任', moved: '移籍' };

export function Manager() {
  const game = useGame();
  const m = game.manager;
  const unemployed = isUnemployed(game);
  useTutorial(unemployed ? 'unemployed' : 'manager');
  const club = game.clubs[m.clubId];
  const pending = m.pendingMove ? game.clubs[m.pendingMove.clubId] : undefined;
  const open = vacancies(game);
  const offerMessage = (offerId: string) => game.inbox.find((msg) => msg.action?.kind === 'jobOffer' && msg.action.offerId === offerId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>監督 {m.name}</h1>
          <div className="muted">
            {unemployed ? `無職（${m.unemployedSince ? `${formatDate(m.unemployedSince)}から` : ''}）` : `${club?.name}の監督`}
            {pending ? `　→ 1月1日から${pending.name}の監督` : ''}
          </div>
        </div>
      </header>

      {unemployed && (
        <div className="notice-box" data-tutorial="job-hunt">
          <strong>次のクラブを探しています。</strong>
          日を進めると、監督が空いたクラブからオファーが届きます。下の「監督が空いているクラブ」に応募することもできます。
        </div>
      )}

      <div className="grid-2">
        <Panel title="監督の評判" tutorial="manager-reputation">
          <div className="trust-row">
            <strong className="trust-value">{Math.round(m.reputation)}</strong>
            <span>{reputationLabel(m.reputation)}</span>
            <Bar value={m.reputation} width={200} title={`評判 ${Math.round(m.reputation)}`} />
          </div>
          <TrendChart points={m.reputationHistory.map((h) => ({ date: h.date, value: h.value }))} domain={[0, 100]}
            format={(v) => `${Math.round(v)}`} tick={(v) => `${v}`} label="監督の評判の推移"
            pointLabel={(d) => formatDate(d)} axisLabel={(d) => `${d.slice(0, 4)}年`} />
          <dl className="facts">
            <dt>経歴</dt><dd>{BACKGROUNDS[m.background].label}<div className="muted small">{BACKGROUNDS[m.background].perk}</div></dd>
            <dt>難易度</dt><dd>{DIFFICULTIES[m.difficulty].label}<div className="muted small">{DIFFICULTIES[m.difficulty].description}</div></dd>
          </dl>
          <p className="muted small">
            評判は、シーズンの評価（1月1日）と優勝で上がり、目標を下回ったり解任されたりすると下がります。評判が上がるほど、評判の高いクラブからオファーが届きます。
          </p>
        </Panel>

        <Panel title={`届いているオファー（${m.offers.length}）`} tutorial="manager-offers">
          {m.offers.length === 0 ? (
            <p className="muted">
              {unemployed ? '今は届いていません。日を進めて待つか、空いているクラブに応募しましょう。' : '今は届いていません。在任中のオファーは、シーズンが終わった12月に届きます。'}
            </p>
          ) : (
            <ul className="offer-list">
              {m.offers.map((o) => {
                const c = game.clubs[o.clubId];
                if (!c) return null;
                const msg = offerMessage(o.id);
                return (
                  <li key={o.id} className="offer">
                    <Emblem spec={c.emblem} size={40} />
                    <div className="offer-text">
                      <strong>{c.name}</strong>
                      <span className="muted small">評判 {c.reputation}　規模：{SIZE_LABEL[c.size]}　目標の目安：{goalLabel(positionGoalFor(game, c.id))}</span>
                      <span className="small">{o.start === 'now' ? '受けると、次の日から監督になる' : '受けると、1月1日から監督になる'}（返事は{formatDate(o.expires)}まで）</span>
                    </div>
                    <div className="offer-actions">
                      {msg && <button type="button" className="primary small" onClick={() => store.navigate({ name: 'conversation', messageId: msg.id })}>話を聞く</button>}
                      <button type="button" className="secondary small" onClick={() => store.update((g) => declineOffer(g, o.id))}>断る</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={`監督が空いているクラブ（${open.length}）`} tutorial="manager-vacancies">
          {open.length === 0 ? <p className="muted">今は、監督が空いているクラブはありません。成績の悪いクラブは、監督を解任することがあります。</p> : (
            <table className="data-table compact">
              <thead><tr><th>クラブ</th><th className="num">評判</th><th>規模</th><th>空いた日</th><th /></tr></thead>
              <tbody>
                {open.map((c) => {
                  const check = canApply(game, c.id);
                  const applied = m.applications.some((a) => a.clubId === c.id);
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="num">{c.reputation}</td>
                      <td>{SIZE_LABEL[c.size]}</td>
                      <td>{c.vacancy ? formatDate(c.vacancy.since) : ''}</td>
                      <td>
                        {applied ? <span className="muted small">返事を待っています</span>
                          : check.ok ? <button type="button" className="secondary small" onClick={() => store.update((g) => { applyFor(g, c.id); })}>応募する</button>
                            : <span className="muted small">{check.reason}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted small">評判（{Math.round(m.reputation)}）より大きく上のクラブは、応募しても選ばれにくいです。</p>
        </Panel>

        <Panel title="これまでのクラブ">
          <table className="data-table compact">
            <thead><tr><th>クラブ</th><th>期間</th><th>シーズン</th><th>終わり方</th></tr></thead>
            <tbody>
              {[...m.career].reverse().map((s, i) => (
                <tr key={`${s.clubId}-${i}`}>
                  <td>{s.clubName}</td>
                  <td className="wrap small">{formatDate(s.from)}〜{s.to ? formatDate(s.to) : '今'}</td>
                  <td className="wrap small">
                    {s.seasons.length === 0 ? '—' : s.seasons.map((x) => `${x.year}年 ${x.position}位${x.partial ? '（途中まで）' : ''}${x.verdict ? `・${verdictLabel(x.verdict)}` : ''}`).join('　')}
                  </td>
                  <td>{s.end ? END_LABEL[s.end] : '在任中'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel>
        {unemployed ? (
          <div className="button-row">
            <span className="muted">このまま続けるのをやめて、新しいゲームを始めることもできます。</span>
            <button type="button" className="secondary" onClick={() => { void store.saveNow(); store.setGame(null, null); store.open({ name: 'newGame' }); }}>新しいゲームを始める</button>
          </div>
        ) : (
          <div className="button-row">
            <span className="muted">監督を辞めると、評判が少し下がり、無職になります。</span>
            <button type="button" className="danger" onClick={() => {
              if (window.confirm(`${club?.name}の監督を辞任します。元に戻せません。よろしいですか？`)) {
                store.update((g) => { resign(g); });
                store.open({ name: 'manager' });
              }
            }}>辞任する</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
