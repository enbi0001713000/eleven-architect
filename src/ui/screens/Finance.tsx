// 財務：収支、予算の配分、スポンサー、チケットの値段、借り入れ、過去の決算（要件定義書「フェーズ3：財務とオーナー」）
// オーナーへの相談（予算の増額、借り入れ）とスポンサーの提案は、会話画面で行う。

import { useState } from 'react';
import {
  budgetIncreaseRoom, clampTicketPrice, debtOf, expectedGate, listPrice, loanDecision, netResult, payrollOf, priceLevel, repayLoan,
  requestLoan, setWageBudget, sponsorIncome, totalExpense, totalIncome, yearToDate, yenText,
} from '../../game/finance';
import { EXPENSE_LABEL, FINANCE, INCOME_LABEL, SEAT_KINDS, SEATS, SPONSOR_DEALS, SPONSOR_SLOTS } from '../../game/financeBalance';
import type { Club, ExpenseKind, GameState, IncomeKind, Ledger, SeatKind } from '../../game/types';
import { BalanceChart, type BalancePoint } from '../components/BalanceChart';
import { ClubLink, Panel } from '../components/bits';
import { formatDate } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

type Tab = 'overview' | 'budget' | 'sponsors' | 'tickets' | 'loans' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '収支' },
  { key: 'budget', label: '予算' },
  { key: 'sponsors', label: 'スポンサー' },
  { key: 'tickets', label: 'チケット' },
  { key: 'loans', label: '借り入れ' },
  { key: 'history', label: '過去の決算' },
];

const INCOME_KEYS: IncomeKind[] = ['tickets', 'sponsor', 'merchandise', 'fanClub', 'broadcast', 'prize', 'transfers'];
const EXPENSE_KEYS: ExpenseKind[] = ['wages', 'operations', 'matchday', 'merchandiseCost', 'fanClubCost', 'interest', 'transfers', 'agentFees'];
/** フェーズ4-Bで使い始める項目 */
const LATER: ReadonlySet<string> = new Set(['income.transfers', 'expense.transfers']);

const Signed = ({ yen }: { yen: number }) => <span className={yen < 0 ? 'tone-low' : ''}>{yenText(yen)}</span>;
const monthText = (month: string): string => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

export function Finance({ initialTab }: { initialTab?: Tab }) {
  useTutorial('finance');
  const game = useGame();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  return (
    <div className="page">
      <div className="toolbar">
        <h1>財務</h1>
        <div className="segmented" data-tutorial="finance-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <Summary game={game} club={club} />
      {tab === 'overview' && <Overview game={game} club={club} />}
      {tab === 'budget' && <BudgetPanel game={game} club={club} />}
      {tab === 'sponsors' && <Sponsors game={game} club={club} />}
      {tab === 'tickets' && <Tickets game={game} club={club} />}
      {tab === 'loans' && <Loans club={club} />}
      {tab === 'history' && <History club={club} />}
    </div>
  );
}

function Summary({ game, club }: { game: GameState; club: Club }) {
  const fin = club.finance;
  const year = yearToDate(fin);
  const payroll = payrollOf(game, club.id);
  return (
    <div className="stat-tiles" data-tutorial="finance-tiles">
      <div className="stat-tile">
        <span className="muted small">手元のお金</span>
        <strong className={fin.balance < 0 ? 'tone-low' : ''}>{yenText(fin.balance)}</strong>
      </div>
      <div className="stat-tile">
        <span className="muted small">今年の差し引き（{game.date.slice(0, 4)}年1月から）</span>
        <strong className={netResult(year) < 0 ? 'tone-low' : ''}>{yenText(netResult(year))}</strong>
        <span className="muted small">{netResult(year) >= 0 ? '黒字' : '赤字'}</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">年俸の合計 ／ 年俸予算</span>
        <strong className={payroll > fin.budget.wages ? 'tone-low' : ''}>{yenText(payroll)}</strong>
        <span className="muted small">予算 {yenText(fin.budget.wages)}（{fin.budget.wages > 0 ? Math.round(payroll / fin.budget.wages * 100) : 0}%）</span>
      </div>
      <div className="stat-tile">
        <span className="muted small">借り入れの残り</span>
        <strong>{yenText(debtOf(fin))}</strong>
        <span className="muted small">上限 {yenText(FINANCE.loanLimit[club.size])}</span>
      </div>
    </div>
  );
}

function ledgerRows(ledgers: { label: string; ledger: Ledger | null }[]) {
  const row = (side: 'income' | 'expense', key: IncomeKind | ExpenseKind, label: string) => (
    <tr key={`${side}.${key}`} className={LATER.has(`${side}.${key}`) ? 'muted' : ''}>
      <td>{label}{LATER.has(`${side}.${key}`) ? '（フェーズ4）' : ''}</td>
      {ledgers.map((l, i) => {
        // 古い記録（フェーズ3.5より前）には、ファンクラブの項目がない
        const value = l.ledger ? (side === 'income' ? l.ledger.income[key as IncomeKind] : l.ledger.expense[key as ExpenseKind]) ?? 0 : null;
        return <td key={i} className="num">{value === null ? '' : value === 0 ? '—' : yenText(value)}</td>;
      })}
    </tr>
  );
  return (
    <table className="data-table compact">
      <thead><tr><th>項目</th>{ledgers.map((l) => <th key={l.label} className="num">{l.label}</th>)}</tr></thead>
      <tbody>
        <tr className="table-section"><td colSpan={ledgers.length + 1}>収入</td></tr>
        {INCOME_KEYS.map((k) => row('income', k, INCOME_LABEL[k]))}
        <tr className="table-total"><td>収入の合計</td>{ledgers.map((l, i) => <td key={i} className="num">{l.ledger ? yenText(totalIncome(l.ledger)) : ''}</td>)}</tr>
        <tr className="table-section"><td colSpan={ledgers.length + 1}>支出</td></tr>
        {EXPENSE_KEYS.map((k) => row('expense', k, EXPENSE_LABEL[k]))}
        <tr className="table-total"><td>支出の合計</td>{ledgers.map((l, i) => <td key={i} className="num">{l.ledger ? yenText(totalExpense(l.ledger)) : ''}</td>)}</tr>
        <tr className="table-total"><td>差し引き</td>{ledgers.map((l, i) => <td key={i} className="num">{l.ledger ? <Signed yen={netResult(l.ledger)} /> : ''}</td>)}</tr>
      </tbody>
    </table>
  );
}

function balancePoints(club: Club): BalancePoint[] {
  const fin = club.finance;
  const previous = fin.history.at(-1)?.balances ?? [];
  return [...previous, ...fin.months.map((m) => ({ month: m.month, balance: m.balance }))].slice(-24);
}

function Overview({ game, club }: { game: GameState; club: Club }) {
  const fin = club.finance;
  const lastMonth = fin.months.at(-1);
  const lastYear = fin.history.at(-1);
  const points = balancePoints(club);
  return (
    <div className="grid-2">
      <Panel title="収支">
        {ledgerRows([
          { label: '今月', ledger: fin.current },
          { label: lastMonth ? `${Number(lastMonth.month.slice(5))}月` : '先月', ledger: lastMonth?.ledger ?? null },
          { label: '今年の累計', ledger: yearToDate(fin) },
          { label: lastYear ? `${lastYear.year}年` : '前年', ledger: lastYear?.ledger ?? null },
        ])}
        <p className="muted small">
          入場料とグッズの一部はホームゲームの日に、スポンサー、配分、年俸、運営費などは毎月1日に前の月の分が入ります（出ます）。
          運営費は、スタッフ、育成、遠征、事務など、試合と年俸以外の費用です。
        </p>
      </Panel>
      <div>
        <Panel title="手元のお金の推移（月末）">
          <BalanceChart points={points} />
          {points.length > 0 && (
            <details className="small">
              <summary className="muted">月ごとの表</summary>
              <table className="data-table compact">
                <thead><tr><th>月</th><th className="num">手元のお金</th></tr></thead>
                <tbody>{points.map((p) => <tr key={p.month}><td>{monthText(p.month)}</td><td className="num"><Signed yen={p.balance} /></td></tr>)}</tbody>
              </table>
            </details>
          )}
        </Panel>
        <Panel title="収入のもと">
          <dl className="facts">
            <dt>スポンサー</dt><dd>{fin.sponsors.length}社、年額の合計{yenText(sponsorIncome(fin))}（スポンサーのタブで見られる）</dd>
            <dt>リーグからの配分</dt><dd>年額{yenText(fin.broadcast)}（前年の順位で決まる）</dd>
            <dt>クラブの運営費</dt><dd>年額{yenText(fin.operations)}</dd>
            <dt>クラブの評判</dt><dd>{club.reputation}（高いほど、スポンサーの条件と観客が良くなる）</dd>
            <dt>ファンの数</dt><dd>約{club.fans.toLocaleString('ja-JP')}人</dd>
          </dl>
          <p className="muted small">
            スポンサーは枠ごとに契約し、切れる枠には12月1日に提案が届きます。
            優勝すると賞金{yenText(FINANCE.prize[0] ?? 0)}、2位{yenText(FINANCE.prize[1] ?? 0)}、3位{yenText(FINANCE.prize[2] ?? 0)}。
          </p>
        </Panel>
        <RecentGates game={game} club={club} />
      </div>
    </div>
  );
}

function RecentGates({ game, club }: { game: GameState; club: Club }) {
  const homes = game.fixtures.filter((f) => f.homeId === club.id && f.result?.attendance !== undefined).slice(-6).reverse();
  if (homes.length === 0) return null;
  return (
    <Panel title="最近のホームゲームの観客">
      <table className="data-table compact">
        <thead><tr><th>日付</th><th>相手</th><th className="num">観客</th><th className="num">入り</th></tr></thead>
        <tbody>
          {homes.map((f) => (
            <tr key={f.id}>
              <td>{formatDate(f.date, false)}</td>
              <td><ClubLink game={game} clubId={f.awayId} short /></td>
              <td className="num">{f.result?.attendance?.toLocaleString('ja-JP')}人</td>
              <td className="num">{Math.round((f.result?.attendance ?? 0) / club.stadium.capacity * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function BudgetPanel({ game, club }: { game: GameState; club: Club }) {
  const budget = club.finance.budget;
  const payroll = payrollOf(game, club.id);
  const room = budgetIncreaseRoom(game, club);
  const top = club.playerIds.map((id) => game.players[id]).filter((p) => p !== undefined)
    .sort((a, b) => (b.contract?.salary ?? 0) - (a.contract?.salary ?? 0)).slice(0, 10);
  const change = (wages: number) => store.update((g) => {
    const c = g.clubs[club.id];
    if (c) setWageBudget(c, wages);
  });
  return (
    <div className="grid-2">
      <Panel title={`${budget.year}年の予算`}>
        <p>オーナーが決めた総予算は <strong>{yenText(budget.total)}</strong> です。年俸予算と移籍予算に分けて使います。</p>
        <label className="block">
          年俸予算：<strong>{yenText(budget.wages)}</strong>　移籍予算：<strong>{yenText(budget.transfers)}</strong>
          <input type="range" min={0} max={budget.total} step={1e7} value={budget.wages}
            onChange={(e) => change(Number(e.target.value))} disabled={budget.total <= 0} />
        </label>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={() => change(budget.wages - 1e8)}>年俸予算を1億円減らす</button>
          <button type="button" className="secondary small" onClick={() => change(budget.wages + 1e8)}>年俸予算を1億円増やす</button>
        </div>
        <div className="button-row">
          <button type="button" className="primary" onClick={() => store.navigate({ name: 'conversation', topic: 'budgetIncrease' })}>
            オーナーに予算の増額を頼む
          </button>
          <span className="muted small">
            {room > 0 ? `貯めたお金から、今年はあと${yenText(room)}まで足してもらえます。` : '今は手元のお金に余裕がないので、増やしてもらえません。'}
            {budget.extra > 0 ? `（今年はもう${yenText(budget.extra)}足してもらった）` : ''}
          </span>
        </div>
        <dl className="facts" style={{ marginTop: 12 }}>
          <dt>今の年俸の合計</dt><dd>{yenText(payroll)}（年俸予算の{budget.wages > 0 ? Math.round(payroll / budget.wages * 100) : 0}%）</dd>
          <dt>年俸予算の残り</dt><dd><Signed yen={budget.wages - payroll} /></dd>
          <dt>移籍予算の残り</dt><dd>{yenText(budget.transfers - budget.transfersSpent)}</dd>
        </dl>
        {payroll > budget.wages && <div className="warning small">年俸の合計が年俸予算を超えています。契約を更新するとき、年俸を相場より抑えることになります。</div>}
        <p className="muted small">
          年俸予算を超える契約は結べません。移籍予算は、フェーズ4で選手を獲るときの移籍金に使います。
          予算は毎年1月1日に、見込みの収支と手元のお金からオーナーが決め直します。
          黒字を貯めておけば、オーナーに頼んで予算を増やしてもらい、他クラブの主力に高い年俸を出すこともできます（フェーズ4）。
        </p>
      </Panel>
      <Panel title="年俸の高い選手">
        <table className="data-table compact">
          <thead><tr><th>選手</th><th className="num">年齢</th><th className="num">年俸</th><th className="num">契約</th></tr></thead>
          <tbody>
            {top.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => store.navigate({ name: 'player', id: p.id })}>
                <td>{p.name}</td>
                <td className="num">{p.age}</td>
                <td className="num">{yenText(p.contract?.salary ?? 0)}</td>
                <td className="num">{p.contract?.endYear}年まで</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Tickets({ game, club }: { game: GameState; club: Club }) {
  const prices = club.finance.ticketPrices;
  const gate = expectedGate(club, prices, game.fanMood);
  const listGate = expectedGate(club, Object.fromEntries(SEAT_KINDS.map((s) => [s, listPrice(club, s)])) as Record<SeatKind, number>, game.fanMood);
  const level = priceLevel(club, prices);
  const setPrice = (seat: SeatKind, price: number) => store.update((g) => {
    const c = g.clubs[club.id];
    if (c) c.finance.ticketPrices[seat] = clampTicketPrice(c, seat, price);
  });
  const reset = () => store.update((g) => {
    const c = g.clubs[club.id];
    if (c) for (const s of SEAT_KINDS) c.finance.ticketPrices[s] = listPrice(c, s);
  });
  return (
    <div className="grid-2">
      <Panel title="チケットの値段" actions={<button type="button" className="link" onClick={reset}>すべて定価に戻す</button>}>
        <table className="data-table compact">
          <thead><tr><th>席</th><th className="num">席数</th><th className="num">定価</th><th className="num">値段</th><th className="num">見込みの観客</th></tr></thead>
          <tbody>
            {SEAT_KINDS.map((s) => {
              const seats = Math.round(club.stadium.capacity * SEATS[s].share);
              const step = s === 'vip' ? 1000 : 500;
              return (
                <tr key={s}>
                  <td>{SEATS[s].label}</td>
                  <td className="num">{seats.toLocaleString('ja-JP')}</td>
                  <td className="num">{listPrice(club, s).toLocaleString('ja-JP')}円</td>
                  <td className="num">
                    <span className="price-input">
                      <button type="button" className="secondary small" onClick={() => setPrice(s, prices[s] - step)}>−</button>
                      <strong>{prices[s].toLocaleString('ja-JP')}円</strong>
                      <button type="button" className="secondary small" onClick={() => setPrice(s, prices[s] + step)}>＋</button>
                    </span>
                  </td>
                  <td className="num">{gate.seats[s].toLocaleString('ja-JP')}人（{Math.round(gate.seats[s] / seats * 100)}%）</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">
          値段は定価の{Math.round(FINANCE.priceRange[0] * 100)}%〜{Math.round(FINANCE.priceRange[1] * 100)}%で決められ、次のホームゲームから変わります。
          高くすると観客が減り、安くすると増えます。定価より高いとファンの雰囲気が少しずつ悪くなり、安いと良くなります。
        </p>
      </Panel>
      <Panel title="1試合の見込み（週末、ダービーでない、成績は平均のとき）">
        <dl className="facts">
          <dt>観客</dt><dd>{gate.total.toLocaleString('ja-JP')}人（収容{club.stadium.capacity.toLocaleString('ja-JP')}人の{Math.round(gate.fill * 100)}%）</dd>
          <dt>入場料の収入</dt><dd>{yenText(gate.tickets)}（定価なら{yenText(listGate.tickets)}）</dd>
          <dt>値段の水準</dt><dd>定価の{Math.round(level * 100)}%</dd>
          <dt>ファンの雰囲気</dt><dd>{Math.round(game.fanMood)}</dd>
        </dl>
        <p className="muted small">
          実際の観客は、相手（強いクラブやダービーは増える）、平日かどうか、最近の成績、ファンの雰囲気で変わります。
          入場料は、年間チケットの割引や招待券があるので、定価の合計の約{Math.round(FINANCE.ticketYield * 100)}%になります。
        </p>
      </Panel>
    </div>
  );
}

function Loans({ club }: { club: Club }) {
  const fin = club.finance;
  const limit = FINANCE.loanLimit[club.size];
  const room = Math.max(0, limit - debtOf(fin));
  const choices = Array.from({ length: Math.floor(room / 1e8) }, (_, i) => (i + 1) * 1e8);
  const [amount, setAmount] = useState<number>(choices[0] ?? 0);
  const [months, setMonths] = useState<number>(FINANCE.loanTerms[1] ?? 24);
  const rate = FINANCE.loanRate[club.size];
  const preview = amount > 0 ? loanDecision(club, amount) : null;
  /** 申請すると、オーナーとの会話で返事を聞く */
  const apply = () => {
    let result = { approved: false, reason: '' };
    store.update((g) => {
      result = requestLoan(g, club.id, amount, months);
    });
    store.navigate({
      name: 'conversation', topic: 'loan', amount, months, approved: result.approved, reason: result.reason,
      rate, monthly: Math.ceil(amount / months),
    });
  };
  const repay = (id: string) => store.update((g) => {
    repayLoan(g, club.id, id);
  });
  return (
    <div className="grid-2">
      <Panel title="借り入れの残り">
        {fin.loans.length === 0 ? <p className="muted">借り入れはありません。</p> : (
          <table className="data-table compact">
            <thead><tr><th>借りた月</th><th className="num">借りた額</th><th className="num">残り</th><th className="num">年利</th><th className="num">毎月の元金</th><th>最後に返す月</th><th /></tr></thead>
            <tbody>
              {fin.loans.map((l) => (
                <tr key={l.id}>
                  <td>{monthText(l.startMonth)}{l.emergency ? <span className="tag tag-warn" style={{ marginLeft: 6 }}>緊急</span> : null}</td>
                  <td className="num">{yenText(l.amount)}</td>
                  <td className="num">{yenText(l.remaining)}</td>
                  <td className="num">{(l.rate * 100).toFixed(1)}%</td>
                  <td className="num">{yenText(l.monthly)}</td>
                  <td>{monthText(l.endMonth)}</td>
                  <td><button type="button" className="secondary small" disabled={fin.balance < l.remaining} onClick={() => repay(l.id)}>残りを返す</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          利息と元金は毎月1日に払います。手元のお金が足りなくなると、銀行から自動で緊急の借り入れをし（年利が{(FINANCE.emergencyExtraRate * 100).toFixed(1)}%高い）、
          上限を超える分はオーナーが入れます。どちらも、オーナーの評価に響きます（フェーズ3-B）。
        </p>
      </Panel>
      <Panel title="オーナーに借り入れを申請する">
        {choices.length === 0 ? <p className="muted">借り入れの上限（{yenText(limit)}）に達しています。</p> : (
          <>
            <div className="toolbar">
              <label className="inline">借りる額
                <select value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
                  {choices.map((c) => <option key={c} value={c}>{yenText(c)}</option>)}
                </select>
              </label>
              <label className="inline">返す期間
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {FINANCE.loanTerms.map((m) => <option key={m} value={m}>{m}か月</option>)}
                </select>
              </label>
            </div>
            <dl className="facts">
              <dt>年利</dt><dd>{(rate * 100).toFixed(1)}%</dd>
              <dt>毎月の元金</dt><dd>{yenText(Math.ceil(amount / months))}</dd>
              <dt>利息の合計（目安）</dt><dd>{yenText(amount * rate * (months + 1) / 24)}</dd>
            </dl>
            {preview && !preview.approved && <div className="warning small">{preview.reason}</div>}
            <div className="button-row">
              <button type="button" className="primary" disabled={!preview?.approved} onClick={apply}>オーナーに申請する</button>
            </div>
          </>
        )}
        <p className="muted small">借りられる額の上限は、クラブの規模で決まります（このクラブは{yenText(limit)}）。前の年が赤字だと、上限の半分までしか認められません。</p>
      </Panel>
    </div>
  );
}

function Sponsors({ game, club }: { game: GameState; club: Club }) {
  const fin = club.finance;
  const pending = fin.sponsorOffers.length > 0;
  return (
    <Panel title={`スポンサー（${fin.sponsors.length}社、年額の合計${yenText(sponsorIncome(fin))}）`}
      actions={pending ? <button type="button" className="primary small" onClick={() => store.navigate({ name: 'conversation', topic: 'sponsor' })}>営業担当と話す（提案を選ぶ）</button> : undefined}>
      {pending && <div className="warning small">来年からの提案が届いています。12月31日までに選んでください（選ばなければ、標準の契約になります）。</div>}
      <table className="data-table compact">
        <thead>
          <tr><th>枠</th><th>会社</th><th>契約</th><th className="num">年額</th><th>期限</th><th className="num">3位以内の上乗せ</th><th>来年から</th></tr>
        </thead>
        <tbody>
          {fin.sponsors.map((d) => (
            <tr key={d.slot}>
              <td>{SPONSOR_SLOTS[d.slot].label}</td>
              <td>{d.company}</td>
              <td>{SPONSOR_DEALS[d.kind].label}</td>
              <td className="num">{yenText(d.annual)}</td>
              <td>{d.endYear}年まで{d.endYear === Number(game.date.slice(0, 4)) && !d.next ? <span className="tag tag-warn" style={{ marginLeft: 6 }}>今年まで</span> : null}</td>
              <td className="num">{d.bonus > 0 ? yenText(d.bonus) : '—'}</td>
              <td>{d.next ? `${d.next.company}（${SPONSOR_DEALS[d.next.kind].label}、年額${yenText(d.next.annual)}）` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        年額は、クラブの評判が高いほど大きくなります。契約が切れる枠には、12月1日に営業担当から提案が届きます。
        1年の高額契約は年額が高いけれど毎年結び直し、長期の契約は年額が少し低い代わりに、評判が下がっても3年は変わりません。
        成績連動の契約は、3位以内に入った年に上乗せがあります。オフィシャルパートナーは、まとめて自動で結び直します。
      </p>
    </Panel>
  );
}

function History({ club }: { club: Club }) {
  const years = [...club.finance.history].reverse();
  if (years.length === 0) return <Panel><p className="muted">まだ締めた年度はありません。年度（1月〜12月）は、1月1日に締めます。</p></Panel>;
  return (
    <Panel title="過去の決算（1月〜12月）">
      <table className="data-table compact">
        <thead>
          <tr>
            <th>年</th><th className="num">順位</th><th className="num">収入</th>
            <th className="num">入場料</th><th className="num">スポンサー</th><th className="num">グッズ</th><th className="num">配分と賞金</th>
            <th className="num">支出</th><th className="num">年俸</th><th className="num">差し引き</th>
            <th className="num">手元のお金</th><th className="num">借り入れ</th><th className="num">平均の観客</th>
          </tr>
        </thead>
        <tbody>
          {years.map((h) => (
            <tr key={h.year}>
              <td>{h.year}年</td>
              <td className="num">{h.position ?? '-'}</td>
              <td className="num">{yenText(totalIncome(h.ledger))}</td>
              <td className="num">{yenText(h.ledger.income.tickets)}</td>
              <td className="num">{yenText(h.ledger.income.sponsor)}</td>
              <td className="num">{yenText(h.ledger.income.merchandise)}</td>
              <td className="num">{yenText(h.ledger.income.broadcast + h.ledger.income.prize)}</td>
              <td className="num">{yenText(totalExpense(h.ledger))}</td>
              <td className="num">{yenText(h.ledger.expense.wages)}</td>
              <td className="num"><Signed yen={netResult(h.ledger)} /></td>
              <td className="num"><Signed yen={h.balance} /></td>
              <td className="num">{yenText(h.debt)}</td>
              <td className="num">{h.averageAttendance?.toLocaleString('ja-JP') ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
