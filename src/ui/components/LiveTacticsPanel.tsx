// 試合中の交代と戦術の変更。戦術画面と同じピッチの図で、枠を2つ押すと選手が入れ替わる。
// フォーメーションを変えると、おすすめの並びが出る。そこから自分で並べ替えてから「戦術を変更する」で決める。
// 枠を選んで控えの選手を押すと、その場で交代する。

import { useState } from 'react';
import { FORMATIONS } from '../../engine/formations';
import { SUBSTITUTION_RULES, type LiveMatch } from '../../engine/match';
import { positionFit, positionRating } from '../../engine/ratings';
import { ROLE_OPTIONS, roleForSlot, roleLabel } from '../../engine/roles';
import type { FormationName, Role, Side, TeamInstructions } from '../../engine/types';
import { ROLE_FIT_MARK, roleFit } from '../../game/roleFit';
import { FORMATIONS_LIST, INSTRUCTION_LABELS, POSITION_LABEL, ratingTone } from '../format';
import { Panel, PosChip, StaminaBar } from './bits';

const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function LiveTacticsPanel({ live, side, onChange, onClose }: { live: LiveMatch; side: Side; onChange: () => void; onClose: () => void }) {
  const current = live.snapshot().sides[side];
  const currentOrder = current.onPitch.map((p) => p.player.id);
  const currentRoles = current.onPitch.map((p) => p.role);
  const [formation, setFormation] = useState<FormationName>(current.tactics.formation);
  const [order, setOrder] = useState<string[]>(currentOrder);
  const [roles, setRoles] = useState<Role[]>(currentRoles);
  const [instructions, setInstructions] = useState<TeamInstructions>(current.tactics.instructions);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const slots = FORMATIONS[formation];
  const onPitch = new Map(current.onPitch.map((p) => [p.player.id, p]));
  const formationChanged = formation !== current.tactics.formation;
  const orderChanged = !sameList(order, currentOrder);
  const changed = formationChanged || orderChanged || !sameList(roles, currentRoles)
    || INSTRUCTION_LABELS.some((item) => instructions[item.key] !== current.tactics.instructions[item.key]);

  /** 今の試合の状態に合わせて、選んでいる内容を戻す */
  const reset = () => {
    const now = live.snapshot().sides[side];
    setFormation(now.tactics.formation);
    setOrder(now.onPitch.map((p) => p.player.id));
    setRoles(now.onPitch.map((p) => p.role));
    setInstructions(now.tactics.instructions);
    setSelected(null);
  };

  const changeFormation = (next: FormationName) => {
    setFormation(next);
    setSelected(null);
    if (next === current.tactics.formation) {
      setOrder(currentOrder);
      setRoles(currentRoles);
      return;
    }
    setOrder(live.suggestOrder(side, next));
    setRoles(FORMATIONS[next].map((slot, i) => roleForSlot({ ...current.tactics, formation: next, roles: [] }, i, slot.position)));
  };

  /** 1つ目の枠を選び、2つ目の枠を押すと入れ替える */
  const clickSlot = (i: number) => {
    if (selected === null || selected === i) {
      setSelected(selected === i ? null : i);
      return;
    }
    const next = [...order];
    [next[i], next[selected]] = [next[selected] as string, next[i] as string];
    setOrder(next);
    setSelected(null);
  };

  const substitute = (inId: string) => {
    if (selected === null) return;
    const outId = order[selected] as string;
    const result = live.substitute(side, outId, inId);
    setMessage(result.ok ? '交代しました' : result.message ?? '交代できませんでした');
    if (result.ok) setOrder(order.map((id) => (id === outId ? inId : id)));
    onChange();
  };

  const apply = () => {
    const result = live.changeTactics(side, {
      formation: formationChanged ? formation : undefined,
      order: formationChanged || orderChanged ? order : undefined,
      roles,
      instructions,
    });
    setMessage(result.ok ? '戦術を変更しました' : result.message ?? '変更できませんでした');
    if (result.ok) {
      reset();
      onChange();
    }
  };

  const selectedSlot = selected === null ? null : slots[selected];
  const selectedPlayer = selected === null ? undefined : onPitch.get(order[selected] ?? '');
  // 選んだ枠で力を出せる控えから順に並べる
  const bench = current.bench.filter((b) => !b.used)
    .sort((a, b) => (selectedSlot ? positionRating(b.player, selectedSlot.position) - positionRating(a.player, selectedSlot.position) : 0));
  const subsLeft = current.subsUsed < SUBSTITUTION_RULES.maxSubs;

  return (
    <div className="tactics-overlay">
      <Panel title="交代・戦術の変更（試合は止まっています）" actions={<button type="button" className="primary" onClick={onClose}>閉じて戻る</button>}>
        <div className="live-tactics">
          <div>
            <label className="inline">フォーメーション
              <select value={formation} onChange={(e) => changeFormation(e.target.value as FormationName)}>
                {FORMATIONS_LIST.map((f) => <option key={f} value={f}>{f}{f === current.tactics.formation ? '（今）' : ''}</option>)}
              </select>
            </label>
            <div className="pitch pitch-small">
              <div className="pitch-lines" />
              {slots.map((s, i) => {
                const p = onPitch.get(order[i] ?? '');
                const role = roles[i] ?? roleForSlot({ ...current.tactics, formation, roles: [] }, i, s.position);
                const fit = p ? positionFit(p.player.position, s.position) : 0;
                const problem = !p || p.sentOff || p.injured || fit < 0.85;
                return (
                  <button key={i} type="button"
                    className={`pitch-slot${selected === i ? ' selected' : ''}${problem ? ' problem' : ''}${p?.sentOff ? ' sent-off' : ''}`}
                    style={{ top: `${(1 - s.x / 4.6) * 88 + 4}%`, left: `${50 + (s.y - 2.5) * 19}%` }}
                    title={selected !== null && selected !== i ? 'この枠の選手と入れ替える' : '選んで、別の枠を押すと入れ替わる'}
                    onClick={() => clickSlot(i)}>
                    <span className="slot-pos">{POSITION_LABEL[s.position]}</span>
                    <span className="slot-name">{p ? p.player.name.split(' ')[0]?.split('・')[0] : '（空き）'}{p?.sentOff ? ' 🟥' : p?.injured ? ' 🩹' : ''}</span>
                    {p && <span className="slot-role"><span className={`fit-mark fit-${roleFit(p.player, role, s.position)}`}>{ROLE_FIT_MARK[roleFit(p.player, role, s.position)]}</span>{roleLabel(role, s.position)}</span>}
                    {p && !p.sentOff && (
                      <span className="slot-rating">
                        {positionRating(p.player, s.position).toFixed(1)} <StaminaBar value={p.stamina} />{' '}
                        <span className={ratingTone(p.stats.rating)}>{p.stats.rating.toFixed(1)}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="muted small">
              枠を押して選び、別の枠を押すと2人が入れ替わります。数字は、その枠での力・スタミナ・今日の評価点です。
              {formationChanged ? 'フォーメーションを変えたので、おすすめの並びにしてあります。並べ替えてから決められます。' : ''}
            </p>
          </div>

          <div>
            {selectedSlot && selectedPlayer ? (
              <>
                <h3>{POSITION_LABEL[selectedSlot.position]} の枠：{selectedPlayer.player.name}</h3>
                <label className="inline">役割
                  <select value={roles[selected as number]} onChange={(e) => setRoles(roles.map((r, j) => (j === selected ? (e.target.value as Role) : r)))}>
                    {ROLE_OPTIONS[selectedSlot.position].map((r) => (
                      <option key={r} value={r}>{ROLE_FIT_MARK[roleFit(selectedPlayer.player, r, selectedSlot.position)]} {roleLabel(r, selectedSlot.position)}</option>
                    ))}
                  </select>
                </label>
                <h3>交代（{current.subsUsed}/{SUBSTITUTION_RULES.maxSubs}人、回数 {current.windowsUsed}/{SUBSTITUTION_RULES.maxWindows}）</h3>
                {selectedPlayer.sentOff ? <p className="muted small">退場した選手は交代できません。</p>
                  : !subsLeft ? <p className="muted small">交代枠を使い切っています。</p>
                    : bench.length === 0 ? <p className="muted small">控えの選手がいません。</p> : (
                      <table className="data-table compact">
                        <thead><tr><th>Pos</th><th>控え</th><th className="num">この枠での力</th><th /></tr></thead>
                        <tbody>
                          {bench.map((b) => (
                            <tr key={b.player.id}>
                              <td><PosChip position={b.player.position} /></td>
                              <td>{b.player.name}</td>
                              <td className="num">{positionRating(b.player, selectedSlot.position).toFixed(1)}</td>
                              <td><button type="button" className="secondary small" onClick={() => substitute(b.player.id)}>{selectedPlayer.player.name.split(' ')[0]}と交代</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
              </>
            ) : <p className="muted small">ピッチの枠を押すと、その選手の役割を変えたり、控えの選手と交代したりできます。</p>}

            <h3>チーム指示</h3>
            {INSTRUCTION_LABELS.map((item) => (
              <div key={item.key} className="instruction">
                <span className="instruction-label">{item.label}</span>
                <div className="segmented small">
                  {[-2, -1, 0, 1, 2].map((v) => (
                    <button key={v} type="button" className={instructions[item.key] === v ? 'active' : ''}
                      onClick={() => setInstructions({ ...instructions, [item.key]: v })}>
                      {v === -2 ? item.low : v === 2 ? item.high : v === 0 ? '標準' : v > 0 ? '＋' : '−'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="button-row">
              <button type="button" className="primary" disabled={!changed} onClick={apply}>戦術を変更する</button>
              <button type="button" className="secondary" disabled={!changed} onClick={reset}>元に戻す</button>
            </div>
          </div>
        </div>
        {message && <p className="notice">{message}</p>}
      </Panel>
    </div>
  );
}
