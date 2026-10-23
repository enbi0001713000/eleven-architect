// 経営：財務とクラブ（オーナー、ファンクラブ）をまとめた画面（要件定義書「画面の作り直し（1.1）」の「経営」）。
// 上に今できることと、要点を信号の色で。お金の推移と収入・支出の内訳はグラフで見せ、数字の表は「収支の表」のタブに入れる。

import { useState, type ReactNode } from 'react';
import { budgetIncreaseRoom, netResult, payrollOf, totalExpense, totalIncome, yearToDate, yenText } from '../../game/finance';
import { EXPENSE_LABEL, INCOME_LABEL } from '../../game/financeBalance';
import { canHoldEvent } from '../../game/fanClub';
import { canNegotiate, trustLabel } from '../../game/owner';
import { OWNER } from '../../game/ownerBalance';
import type { Club, ExpenseKind, GameState, IncomeKind } from '../../game/types';
import { BalanceChart } from '../components/BalanceChart';
import { Panel } from '../components/bits';
import { Emblem } from '../components/Emblem';
import { Icon } from '../components/Icon';
import { Term } from '../components/Term';
import { SIZE_LABEL } from '../format';
import { store, useGame, type ManagementTab, type Screen } from '../store';
import { useTutorial } from '../useTutorial';
import { FanClubTab } from './FanClubTab';
import { balancePoints, BudgetPanel, History, Loans, Overview, Sponsors, Tickets } from './Finance';
import { OwnerTab } from './OwnerTab';

const TABS: { key: ManagementTab; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'ledger', label: '収支の表' },
  { key: 'budget', label: '予算' },
  { key: 'sponsors', label: 'スポンサー' },
  { key: 'tickets', label: 'チケット' },
  { key: 'loans', label: '借り入れ' },
  { key: 'history', label: '過去の決算' },
  { key: 'owner', label: 'オーナー' },
  { key: 'fanClub', label: 'ファンクラブ' },
];

export type Signal = 'good' | 'warn' | 'bad';
const SIGNAL_LABEL: Record<Signal, string> = { good: '良い', warn: '注意', bad: '危ない' };

/** 要点の良し悪し（青・黄・赤）。手元のお金、今年の差し引き、オーナーの信頼、年俸と予算 */
export function financeSignals(game: GameState, club: Club): { money: Signal; net: Signal; trust: Signal; wages: Signal } {
  const fin = club.finance;
  const payroll = payrollOf(game, club.id);
  const year = yearToDate(fin);
  const net = netResult(year);
  const income = totalIncome(year);
  const warn = OWNER.thresholds[game.owner.strictness].warn[0];
  return {
    money: fin.balance < 0 ? 'bad' : fin.balance < payroll / 12 ? 'warn' : 'good',
    net: net >= 0 ? 'good' : net > -0.05 * Math.max(income, 1) ? 'warn' : 'bad',
    trust: game.owner.trust >= 60 ? 'good' : game.owner.trust >= warn ? 'warn' : 'bad',
    wages: payroll <= fin.budget.wages * 0.95 ? 'good' : payroll <= fin.budget.wages ? 'warn' : 'bad',
  };
}

/** 経営の画面で、今できること（押すとその話や画面へ） */
export function managementActions(game: GameState, club: Club): { key: string; text: string; screen: Screen }[] {
  const actions: { key: string; text: string; screen: Screen }[] = [];
  const fin = club.finance;
  if (fin.sponsorOffers.length > 0) actions.push({ key: 'sponsor', text: `スポンサーの提案が${fin.sponsorOffers.length}件来ています`, screen: { name: 'conversation', topic: 'sponsor' } });
  if (canNegotiate(game)) actions.push({ key: 'goals', text: '開幕までに、オーナーと今シーズンの目標を話し合えます', screen: { name: 'conversation', topic: 'goals' } });
  if (budgetIncreaseRoom(game, club) > 0) actions.push({ key: 'budget', text: `オーナーに予算の増額を頼めます（あと${yenText(budgetIncreaseRoom(game, club))}まで）`, screen: { name: 'conversation', topic: 'budgetIncrease' } });
  const homes = game.fixtures.filter((f) => f.homeId === club.id && f.result?.attendance !== undefined).slice(-3);
  if (homes.length >= 2) {
    const fill = homes.reduce((n, f) => n + (f.result?.attendance ?? 0), 0) / homes.length / club.stadium.capacity;
    if (fill < 0.6) actions.push({ key: 'tickets-low', text: `最近のホームゲームは入りが${Math.round(fill * 100)}%です。チケットの値段を見直せます`, screen: { name: 'management', tab: 'tickets' } });
    else if (fill > 0.97) actions.push({ key: 'tickets-high', text: '最近のホームゲームは満員です。チケットを値上げできるかもしれません', screen: { name: 'management', tab: 'tickets' } });
  }
  if (canHoldEvent(game, 'community').ok) actions.push({ key: 'fan-event', text: 'ファンクラブのイベント（地域の訪問）を開けます', screen: { name: 'management', tab: 'fanClub' } });
  return actions;
}

const INCOME_KEYS: IncomeKind[] = ['tickets', 'sponsor', 'merchandise', 'fanClub', 'broadcast', 'prize', 'transfers'];
const EXPENSE_KEYS: ExpenseKind[] = ['wages', 'operations', 'matchday', 'merchandiseCost', 'fanClubCost', 'interest', 'transfers', 'agentFees'];

export function Management({ initialTab }: { initialTab?: ManagementTab }) {
  const game = useGame();
  const [tab, setTab] = useState<ManagementTab>(initialTab ?? 'overview');
  useTutorial(tab === 'owner' ? 'myClub' : tab === 'fanClub' ? undefined : 'finance');
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  return (
    <div className="page management">
      <header className="page-header">
        <Emblem spec={club.emblem} size={52} />
        <div>
          <h1>経営</h1>
          <div className="muted">{club.name}　{club.hometown}　創設{club.founded}年　規模：{SIZE_LABEL[club.size]}</div>
        </div>
      </header>
      <ActionList game={game} club={club} />
      <SignalTiles game={game} club={club} />
      <div className="tabs">
        <div className="segmented wrap" data-tutorial="finance-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} data-tutorial={t.key === 'fanClub' ? 'club-tabs' : undefined}
              onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'overview' && <Charts club={club} />}
      {tab === 'ledger' && <Overview game={game} club={club} />}
      {tab === 'budget' && <BudgetPanel game={game} club={club} />}
      {tab === 'sponsors' && <Sponsors game={game} club={club} />}
      {tab === 'tickets' && <Tickets game={game} club={club} />}
      {tab === 'loans' && <Loans club={club} />}
      {tab === 'history' && <History club={club} />}
      {tab === 'owner' && <OwnerTab game={game} club={club} />}
      {tab === 'fanClub' && <FanClubTab game={game} club={club} />}
    </div>
  );
}

function ActionList({ game, club }: { game: GameState; club: Club }) {
  const actions = managementActions(game, club);
  if (actions.length === 0) return null;
  return (
    <section className="action-list" aria-label="今できること">
      <h2>今できること</h2>
      <ul>
        {actions.map((a) => (
          <li key={a.key}>
            <button type="button" className="action-item" onClick={() => (a.screen.name === 'management' ? store.replace(a.screen) : store.navigate(a.screen))}>
              <Icon name="chart" size={16} />{a.text}<span className="action-go">▶</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SignalTiles({ game, club }: { game: GameState; club: Club }) {
  const fin = club.finance;
  const signals = financeSignals(game, club);
  const net = netResult(yearToDate(fin));
  const payroll = payrollOf(game, club.id);
  const tile = (signal: Signal, label: ReactNode, value: string, note: string) => (
    <div className={`stat-tile signal-${signal}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      <span className="signal-note"><span className={`signal-dot ${signal}`} />{SIGNAL_LABEL[signal]}　<span className="muted small">{note}</span></span>
    </div>
  );
  return (
    <div className="stat-tiles" data-tutorial="finance-tiles">
      {tile(signals.money, '手元のお金', yenText(fin.balance), fin.balance < 0 ? 'お金が足りません' : `年俸のおよそ${Math.max(0, Math.round(fin.balance / Math.max(1, payroll / 12)))}か月分`)}
      {tile(signals.net, `今年の差し引き（${game.date.slice(0, 4)}年1月から）`, yenText(net), net >= 0 ? '黒字' : '赤字')}
      {tile(signals.trust, <Term k="信頼度">オーナーの信頼</Term>, `${Math.round(game.owner.trust)}`, trustLabel(game.owner.trust))}
      {tile(signals.wages, <><Term k="年俸予算">年俸</Term>と予算</>, `${fin.budget.wages > 0 ? Math.round(payroll / fin.budget.wages * 100) : 0}%`, `${yenText(payroll)} ／ ${yenText(fin.budget.wages)}`)}
    </div>
  );
}

/** お金の推移と、今年の収入・支出の内訳（グラフ） */
function Charts({ club }: { club: Club }) {
  const year = yearToDate(club.finance);
  const income = INCOME_KEYS.map((k) => ({ label: INCOME_LABEL[k], value: year.income[k] ?? 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const expense = EXPENSE_KEYS.map((k) => ({ label: EXPENSE_LABEL[k], value: year.expense[k] ?? 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...income.map((r) => r.value), ...expense.map((r) => r.value));
  const bars = (rows: { label: string; value: number }[], tone: 'income' | 'expense') => (
    rows.length === 0 ? <p className="muted small">まだありません。</p> : (
      <ul className="hbars">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="hbar-label">{r.label}</span>
            <span className="hbar-track"><span className={`hbar-fill ${tone}`} style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="hbar-value">{yenText(r.value)}</span>
          </li>
        ))}
      </ul>
    )
  );
  return (
    <div className="grid-2">
      <Panel title="手元のお金の推移（月末）" icon="chart">
        <BalanceChart points={balancePoints(club)} />
      </Panel>
      <div>
        <Panel title={`今年の収入（合計 ${yenText(totalIncome(year))}）`} icon="finance">{bars(income, 'income')}</Panel>
        <Panel title={`今年の支出（合計 ${yenText(totalExpense(year))}）`} icon="finance">{bars(expense, 'expense')}</Panel>
        <p className="muted small">数字の表は「収支の表」のタブで見られます。</p>
      </div>
    </div>
  );
}
