// クラブ画面の「ファンクラブ」タブ：会員数、会費、会員数の推移、イベント（要件定義書 フェーズ3.5「ファンクラブ」）

import { yearToDate, yenText } from '../../game/finance';
import { canHoldEvent, feePreview, feeRevenue, setFee, totalMembers, type HeldEventKind } from '../../game/fanClub';
import { EVENT_LABEL, FAN_CLUB, FAN_CLUB_RANKS, FAN_EVENTS, RANK_BENEFITS, RANK_LABEL, THANKS_DAY } from '../../game/fanClubBalance';
import type { Club, FanClubRank, GameState } from '../../game/types';
import { TrendChart } from '../components/BalanceChart';
import { Panel } from '../components/bits';
import { formatDate } from '../format';
import { store } from '../store';
import { useTutorial } from '../useTutorial';

const people = (n: number): string => `${Math.round(n).toLocaleString('ja-JP')}人`;
const yen = (n: number): string => `${n.toLocaleString('ja-JP')}円`;

const EVENT_TEXT: Record<HeldEventKind, string> = {
  signing: `シーズン中、今日と明日に試合がない日。月に${FAN_EVENTS.signing.perMonth}回まで。選手を1〜2人呼ぶ。人気の選手ほど入会が増えるが、出た選手は少し疲れる`,
  openTraining: `シーズン中。明日の練習を会員に公開する（試合の日と前日を除く）。月に${FAN_EVENTS.openTraining.perMonth}回まで。雰囲気が少し上がるが、その日の練習の効果が2割下がる`,
  community: `一年中、今日と明日に試合がない日。月に${FAN_EVENTS.community.perMonth}回まで。選手を1〜2人連れて学校や病院を訪ねる。ファンの数が少しずつ増えるが、出た選手は少し疲れる`,
};

export function FanClubTab({ game, club }: { game: GameState; club: Club }) {
  useTutorial('fanClub');
  const fc = club.fanClub;
  const total = totalMembers(fc.members);
  const thisYear = yearToDate(club.finance).income.fanClub ?? 0;
  const preview = feePreview(game, fc.fees);
  const inWindow = fc.renewal !== null;
  const changeFee = (rank: FanClubRank, fee: number) => store.update((g) => setFee(g, rank, fee));

  return (
    <div className="grid-2">
      <Panel title="会員">
        <div className="stat-tiles fan-tiles">
          <div className="stat-tile"><span className="muted small">会員の数</span><strong>{people(total)}</strong><span className="muted small">ファンの{(total / Math.max(1, club.fans) * 100).toFixed(1)}%</span></div>
          <div className="stat-tile"><span className="muted small">今年の会費の収入</span><strong>{yenText(thisYear)}</strong><span className="muted small">1月から今日まで</span></div>
          <div className="stat-tile"><span className="muted small">ファンの数</span><strong>{people(club.fans)}</strong><span className="muted small">雰囲気 {Math.round(game.fanMood)}</span></div>
        </div>
        <table className="data-table compact" data-tutorial="fan-ranks">
          <thead><tr><th>ランク</th><th className="num">会員</th><th className="num">今の年会費</th><th>次の期間の年会費</th><th>特典</th></tr></thead>
          <tbody>
            {FAN_CLUB_RANKS.map((r) => {
              const [lo, hi] = FAN_CLUB.feeRange[r];
              const step = FAN_CLUB.feeStep[r];
              return (
                <tr key={r}>
                  <td><strong>{RANK_LABEL[r]}</strong></td>
                  <td className="num">{people(fc.members[r])}</td>
                  <td className="num">{yen(fc.activeFees[r])}</td>
                  <td>
                    <span className="price-input">
                      <button type="button" className="small secondary" aria-label={`${RANK_LABEL[r]}の会費を下げる`} disabled={fc.fees[r] <= lo}
                        onClick={() => changeFee(r, fc.fees[r] - step)}>−</button>
                      <strong>{yen(fc.fees[r])}</strong>
                      <button type="button" className="small secondary" aria-label={`${RANK_LABEL[r]}の会費を上げる`} disabled={fc.fees[r] >= hi}
                        onClick={() => changeFee(r, fc.fees[r] + step)}>＋</button>
                    </span>
                  </td>
                  <td className="small wrap">{RANK_BENEFITS[r]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">
          次の期間の年会費は、12月1日からの入会と更新の受付で使います（{inWindow ? '今は受付中なので、変えると次の年の受付から' : '11月末までに決めてください'}）。
          会費を上げるとそのランクの会員が減り、下げると増えます。会員が多いほど、スタジアムに人が来て、グッズも売れます。ゴールド以上はチケットとグッズが10%引きです。
        </p>
        <p className="small">
          この会費で、今の成績のままなら：会員 約{people(totalMembers(preview.members))}、会費 約{yenText(preview.revenue)}
          <span className="muted">（今の会員と会費では {yenText(feeRevenue(fc.members, fc.activeFees))}）</span>
        </p>
      </Panel>

      <Panel title="入会と更新">
        {fc.renewal ? (
          <dl className="facts">
            <dt>受付</dt><dd>{fc.renewal.year}年の会員を受付中（2月末まで）</dd>
            <dt>見込み</dt><dd>{people(totalMembers(fc.renewal.members))}（更新 {people(fc.renewal.renewed)}、新しく入る人 {people(fc.renewal.joined)}）</dd>
            <dt>会費</dt><dd>{yenText(feeRevenue(fc.renewal.members, fc.renewal.fees))}（入ったのは {Math.round(fc.renewal.paid * 100)}%）</dd>
          </dl>
        ) : (
          <p>次の入会と更新の受付は、12月1日から2月末までです。今シーズンの成績とファンの雰囲気、会費の高さで、会員の数が決まります。</p>
        )}
        <p className="muted small">会費は12月に3割、1月に4割、2月に3割が入ります。シーズン中も、勝ちが続くと毎月少しずつ入会があります。</p>
        <h3>会員の数の推移</h3>
        <TrendChart points={fc.history.map((h) => ({ date: h.month, value: h.total }))} format={people}
          tick={(v) => (v >= 10000 ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万` : `${v}`)}
          minRange={1000} label="ファンクラブの会員の数の推移" pointLabel={(d) => `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月末`} />
      </Panel>

      <Panel title="イベント">
        <div className="fan-events" data-tutorial="fan-events">
          <div className="fan-event">
            <div>
              <strong>{EVENT_LABEL.thanksDay}</strong>
              <div className="muted small">
                12月に1回。11月にファンクラブ担当から提案が届く。選手全員が出る。更新と入会が増え、雰囲気が上がる
                （小さく {yenText(THANKS_DAY.small.cost[club.size])}、大きく {yenText(THANKS_DAY.large.cost[club.size])}）
              </div>
            </div>
            <span className="small">
              {fc.thanksDay?.scale ? `${fc.thanksDay.year}年：${THANKS_DAY[fc.thanksDay.scale].label}予定` : fc.thanksDay ? `${fc.thanksDay.year}年：開かない` : '11月に提案が届きます'}
            </span>
          </div>
          {(['signing', 'openTraining', 'community'] as HeldEventKind[]).map((kind) => {
            const check = canHoldEvent(game, kind);
            return (
              <div key={kind} className="fan-event">
                <div>
                  <strong>{EVENT_LABEL[kind]}</strong>
                  <div className="muted small">{EVENT_TEXT[kind]}</div>
                  {!check.ok && <div className="small">{check.reason}{check.nextDate ? `（次に開けるのは ${formatDate(check.nextDate)}）` : ''}</div>}
                </div>
                <button type="button" className={check.ok ? 'primary small' : 'secondary small'} disabled={!check.ok}
                  onClick={() => store.navigate({ name: 'conversation', topic: 'fanEvent', eventKind: kind })}>
                  {kind === 'openTraining' ? '明日開く' : '今日開く'}
                </button>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="これまでのイベント">
        {fc.events.length === 0 ? <p className="muted">まだイベントを開いていません。</p> : (
          <table className="data-table compact">
            <thead><tr><th>日付</th><th>イベント</th><th>出た選手</th><th className="num">効果</th><th className="num">費用</th></tr></thead>
            <tbody>
              {[...fc.events].reverse().slice(0, 12).map((e, i) => (
                <tr key={`${e.date}-${i}`}>
                  <td>{formatDate(e.date)}</td>
                  <td>{EVENT_LABEL[e.kind]}</td>
                  <td>{e.playerIds.map((id) => game.players[id]?.name ?? '').join('、') || (e.kind === 'thanksDay' ? '全員' : '—')}</td>
                  <td className="num">{e.kind === 'community' ? `ファン＋${people(e.gained)}` : e.kind === 'thanksDay' ? '更新と入会が増える' : `入会 ${people(e.gained)}`}</td>
                  <td className="num">{yenText(e.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
