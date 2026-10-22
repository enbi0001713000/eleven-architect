// 契約の交渉：選手の代理人に条件を提示し、その場で返事をもらう（要件定義書 フェーズ4「契約の条件」「契約の更新」「代理人」、フェーズ4-A）。
// 年俸、年数、約束する役割、違約金、出来高ボーナスを決める。代理人の希望は、提示して返事が来ると分かる。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import { AGENT_STYLES, CONTRACT, RELEASE_CLAUSE_OPTIONS } from '../../game/contractBalance';
import {
  agentOf, bonusValue, clauseFor, contractStartYear, deservedRole, formatValueRange, marketValueRange, maxYears, offerContract, salaryText, talkStatus,
  wageRoom, type ContractOffer, type OfferAnswer,
} from '../../game/contracts';
import { yenText } from '../../game/finance';
import { knowledgeOf, viewAttribute } from '../../game/knowledge';
import { SQUAD_ROLE_LABEL } from '../../game/morale';
import type { SquadRole } from '../../game/types';
import { salaryFor, SIZE_PROFILE } from '../../game/world';
import { AttributeValue, ClubLink, Panel } from '../components/bits';
import { POSITION_NAME } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

const ROLES: SquadRole[] = ['key', 'rotation', 'backup', 'youth'];
const clauseLabel = (m: number | null): string => (m === null ? 'なし' : `市場価値の${m}倍`);

interface LogLine {
  who: 'me' | 'them';
  text: string;
  verdict?: OfferAnswer['verdict'];
}

export function ContractTalk({ playerId }: { playerId: string }) {
  useTutorial('contract');
  const game = useGame();
  const player = game.players[playerId];
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  const [log, setLog] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);
  const [offer, setOffer] = useState<ContractOffer>(() => {
    const p = game.players[playerId];
    const c = game.clubs[myId];
    const market = p && c ? salaryFor(overallRating(p), SIZE_PROFILE[c.size].salary) : 0;
    const renewal = p?.clubId === myId && !p.leaving;
    return {
      salary: Math.round((renewal && p?.contract ? p.contract.salary : market) / 1e5) * 1e5,
      years: p ? Math.min(maxYears(p), CONTRACT.preferredYears(p.age)) : 2,
      role: p ? deservedRole(game, p, myId) : 'backup',
      clauseMultiple: CONTRACT.defaultClause,
      bonus: { appearance: 0, goal: 0 },
    };
  });
  if (!player || !club) return <div className="page"><p>選手が見つかりません。</p></div>;

  const check = talkStatus(game, playerId);
  const agent = agentOf(game, player);
  const profile = AGENT_STYLES[agent.style];
  const talk = game.contractTalks?.[playerId];
  const room = wageRoom(game, myId);
  const deserved = deservedRole(game, player, myId);
  const renewal = check.kind === 'renewal';
  const start = contractStartYear(game.date);
  const set = (change: Partial<ContractOffer>) => setOffer((o) => ({ ...o, ...change }));
  const bonusYen = bonusValue(player, offer.role, offer.bonus);

  const submit = () => {
    let answer: OfferAnswer | null = null;
    store.update((g) => { answer = offerContract(g, playerId, offer); });
    const a = answer as OfferAnswer | null;
    if (!a) return;
    const mine: LogLine = {
      who: 'me',
      text: `年俸 ${salaryText(offer.salary)}、${offer.years}年（${start + offer.years - 1}年まで）、${SQUAD_ROLE_LABEL[offer.role]}、違約金 ${clauseLabel(offer.clauseMultiple)}`
        + (offer.bonus.appearance || offer.bonus.goal ? `、出来高（出場 ${yenText(offer.bonus.appearance)}／ゴール ${yenText(offer.bonus.goal)}）` : ''),
    };
    setLog((l) => (a.verdict === 'invalid' ? [...l, { who: 'them', text: a.message, verdict: a.verdict }] : [...l, mine, { who: 'them', text: a.message, verdict: a.verdict }]));
    if (a.verdict === 'accept' || a.verdict === 'brokeOff') setDone(true);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <div>
          <h1>{player.name}との契約の交渉</h1>
          <div className="muted">
            {POSITION_NAME[player.position]}　{player.age}歳　{player.clubId ? <ClubLink game={game} clubId={player.clubId} short /> : '所属なし'}
            {'　'}{renewal ? '契約の更新' : player.clubId ? '仮の契約（1月1日に加入）' : '獲得（すぐに加入）'}
          </div>
        </div>
      </header>

      <div className="grid-2">
        <Panel title="選手と代理人" tutorial="contract-player">
          <dl className="facts">
            <dt>総合力</dt><dd><AttributeValue view={viewAttribute(overallRating(player), knowledgeOf(game, player), `${player.id}:overall`)} /></dd>
            <dt>市場価値</dt><dd>{formatValueRange(marketValueRange(game, player))}</dd>
            {renewal && player.contract && <><dt>今の契約</dt><dd>年俸 {yenText(player.contract.salary)}、{player.contract.endYear}年まで、{SQUAD_ROLE_LABEL[player.contract.role]}</dd></>}
            <dt>ふさわしい役割</dt><dd>{SQUAD_ROLE_LABEL[deserved]}<div className="muted small">これより低い役割だと、年俸の希望が上がるか、断られます</div></dd>
            <dt>代理人</dt><dd>{agent.name}（{profile.label}）<div className="muted small">手数料は年俸の{Math.round(profile.feeRate * 100)}%。提示できるのは{profile.patience}回までで、決裂すると14日話せません</div></dd>
            {talk?.lastAsk && (
              <>
                <dt>代理人の希望</dt>
                <dd>
                  <strong>{salaryText(talk.lastAsk)}</strong>
                  {!done && <button type="button" className="link" onClick={() => set({ salary: talk.lastAsk ?? offer.salary })}>この額にする</button>}
                  <div className="muted small">前の提示の条件での、合意に必要な年俸</div>
                </dd>
              </>
            )}
            <dt>年俸予算の残り</dt><dd className={room < 0 ? 'tone-low' : ''}>{yenText(room)}</dd>
          </dl>
        </Panel>

        <Panel title="提示する条件" tutorial="contract-offer">
          {!check.ok && !done ? <p className="warning">{check.reason}</p> : null}
          <div className="offer-form">
            <label htmlFor="salary">年俸（万円）</label>
            <input id="salary" type="number" min={CONTRACT.minSalary / 1e4} step={10} value={Math.round(offer.salary / 1e4)} disabled={done}
              onChange={(e) => set({ salary: Math.max(0, Number(e.target.value) || 0) * 1e4 })} />
            <label htmlFor="years">契約年数</label>
            <select id="years" value={offer.years} disabled={done} onChange={(e) => set({ years: Number(e.target.value) })}>
              {Array.from({ length: maxYears(player) }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y}年（{start + y - 1}年まで）</option>)}
            </select>
            <label htmlFor="role">約束する役割</label>
            <select id="role" value={offer.role} disabled={done} onChange={(e) => set({ role: e.target.value as SquadRole })}>
              {ROLES.filter((r) => r !== 'youth' || player.age <= 21).map((r) => <option key={r} value={r}>{SQUAD_ROLE_LABEL[r]}</option>)}
            </select>
            <label htmlFor="clause">違約金</label>
            <select id="clause" value={String(offer.clauseMultiple)} disabled={done}
              onChange={(e) => set({ clauseMultiple: e.target.value === 'null' ? null : Number(e.target.value) })}>
              {RELEASE_CLAUSE_OPTIONS.map((m) => {
                const yen = clauseFor(player, game.season.year, m);
                return <option key={String(m)} value={String(m)}>{clauseLabel(m)}{yen !== null ? `（${yenText(yen)}）` : ''}</option>;
              })}
            </select>
            <span className="hint muted small">低いほど選手は喜び、年俸の希望が下がります。ただし、この額を払われると他クラブに引き抜かれます（フェーズ4-B）。</span>
            <label htmlFor="appearance">出場ボーナス</label>
            <select id="appearance" value={offer.bonus.appearance} disabled={done}
              onChange={(e) => set({ bonus: { ...offer.bonus, appearance: Number(e.target.value) } })}>
              {CONTRACT.appearanceBonusOptions.map((v) => <option key={v} value={v}>{v === 0 ? 'なし' : `1試合 ${yenText(v)}`}</option>)}
            </select>
            <label htmlFor="goal">ゴールボーナス</label>
            <select id="goal" value={offer.bonus.goal} disabled={done}
              onChange={(e) => set({ bonus: { ...offer.bonus, goal: Number(e.target.value) } })}>
              {CONTRACT.goalBonusOptions.map((v) => <option key={v} value={v}>{v === 0 ? 'なし' : `1点 ${yenText(v)}`}</option>)}
            </select>
            {bonusYen > 0 && <span className="hint muted small">選手は出来高を、年俸 約{yenText(bonusYen)}分として数えます（出場の見込みから）。</span>}
          </div>
          <div className="button-row">
            <button type="button" className="primary" disabled={!check.ok || done} onClick={submit}>提示する</button>
            {done && <button type="button" className="secondary" onClick={() => store.open({ name: 'transfers' })}>移籍の画面へ</button>}
          </div>
        </Panel>
      </div>

      {log.length > 0 && (
        <Panel title="やり取り">
          <ul className="talk-log">
            {log.map((line, i) => (
              <li key={i} className={`${line.who}${line.verdict === 'accept' ? ' accept' : ''}`}>{line.text}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
