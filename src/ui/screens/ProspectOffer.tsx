// 新人の候補に内定を出す（要件定義書 フェーズ4「新人の獲得（高校生・大学生）」、フェーズ4-C）。
// 約束する役割と年俸を決める。候補は、最初の内定から数日後に、届いた内定の中からクラブを選ぶ。

import { useState } from 'react';
import { salaryText, wageRoom } from '../../game/contracts';
import { SQUAD_ROLE_LABEL } from '../../game/morale';
import { makeOffer, offerFrom, offerProblem, SCHOOL_LABEL, standardSalary, withdrawOffer } from '../../game/prospects';
import { PROSPECTS } from '../../game/scoutingBalance';
import type { SquadRole } from '../../game/types';
import { Panel } from '../components/bits';
import { ScoutReportView } from '../components/ScoutReport';
import { formatDate, POSITION_NAME } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

const ROLES: SquadRole[] = ['youth', 'backup', 'rotation'];

export function ProspectOfferScreen({ playerId }: { playerId: string }) {
  useTutorial('prospect');
  const game = useGame();
  const player = game.players[playerId];
  const myId = game.manager.clubId;
  const [role, setRole] = useState<SquadRole>('youth');
  const [salary, setSalary] = useState(() => (player ? Math.round(standardSalary(game, player, myId, 'youth') / 1e4) : 0));
  const [note, setNote] = useState('');
  if (!player) return <div className="page"><p>この候補は、もういません（決まらなかった候補は1月10日に去ります）。</p></div>;
  const prospect = player.prospect;
  const mine = offerFrom(player, myId);
  const problem = offerProblem(game, playerId, role, salary * 1e4);
  const others = (prospect?.offers ?? []).filter((o) => o.clubId !== myId).length;
  const changeRole = (next: SquadRole) => {
    setRole(next);
    setSalary(Math.round(standardSalary(game, player, myId, next) / 1e4));
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <div>
          <h1>{player.name}への内定</h1>
          <div className="muted">
            {POSITION_NAME[player.position]}　{player.age}歳　{prospect ? `${SCHOOL_LABEL[prospect.school]}（${prospect.joinYear}年1月に加入）` : ''}
          </div>
        </div>
      </header>

      <div className="grid-2">
        <Panel title="スカウトレポート" tutorial="prospect-report">
          <ScoutReportView game={game} player={player} />
        </Panel>

        <Panel title="内定" tutorial="prospect-offer">
          {!prospect ? <p>{player.clubId ? `${game.clubs[player.clubId]?.name ?? ''}に加入しました。` : '新人の候補ではありません。'}</p>
            : prospect.signed ? (
              <p>{prospect.signed.clubId === myId
                ? `うちの内定を受けてくれました。${prospect.joinYear}年1月10日に加入します（${SQUAD_ROLE_LABEL[prospect.signed.role]}、年俸${salaryText(prospect.signed.salary)}）。`
                : `${game.clubs[prospect.signed.clubId]?.name ?? '他クラブ'}を選びました。`}</p>
            ) : mine ? (
              <>
                <p>内定を出しています（{SQUAD_ROLE_LABEL[mine.role]}、年俸{salaryText(mine.salary)}）。</p>
                {prospect.decideBy && <p className="muted small">{formatDate(prospect.decideBy, false)}ごろに、どのクラブにするか決めます。{others > 0 ? `他クラブからも内定が${others}つ届いています。` : ''}</p>}
                <div className="button-row">
                  <button type="button" className="secondary" onClick={() => store.update((g) => withdrawOffer(g, playerId))}>内定を取り下げる</button>
                </div>
              </>
            ) : (
              <>
                {others > 0 && <p className="notice-box">他クラブからも内定が{others}つ届いています。{prospect.decideBy ? `${formatDate(prospect.decideBy, false)}ごろに決めます。` : ''}</p>}
                <div className="offer-form">
                  <label htmlFor="role">約束する役割</label>
                  <select id="role" value={role} onChange={(e) => changeRole(e.target.value as SquadRole)}>
                    {ROLES.map((r) => <option key={r} value={r}>{SQUAD_ROLE_LABEL[r]}</option>)}
                  </select>
                  <label htmlFor="salary">年俸（万円）</label>
                  <input id="salary" type="number" min={1} step={50} value={salary} onChange={(e) => setSalary(Math.max(0, Number(e.target.value) || 0))} />
                  <span className="hint muted small">
                    目安は{salaryText(standardSalary(game, player, myId, role))}。年俸予算の残りは{salaryText(Math.max(0, wageRoom(game, myId)))}です。
                    契約は{PROSPECTS.years}年（{(prospect.joinYear) + PROSPECTS.years - 1}年まで）。役割を高く約束するほど、年俸を上げるほど、選ばれやすくなります。
                  </span>
                </div>
                {problem && <p className="warning">{problem}</p>}
                <div className="button-row">
                  <button type="button" className="primary" disabled={!!problem} onClick={() => {
                    let message = '';
                    store.update((g) => { message = makeOffer(g, playerId, role, salary * 1e4); });
                    setNote(message);
                  }}>内定を出す</button>
                </div>
              </>
            )}
          {note && <p className="notice-box">{note}</p>}
          <p className="muted small">候補は、クラブの評判、同じポジションの選手の顔ぶれ（出番の見込み）、約束する役割、年俸を比べてクラブを選びます。</p>
        </Panel>
      </div>
    </div>
  );
}
