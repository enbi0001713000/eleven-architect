// 戦術：フォーメーション、先発と控え、役割、チーム指示、キャプテンとキッカー（要件定義書「戦術と観戦」）

import { useState } from 'react';
import { FORMATIONS } from '../../engine/formations';
import { overallRating, positionFit, positionRating } from '../../engine/ratings';
import { ROLE_OPTIONS, ROLE_PROFILES, roleForSlot, roleLabel } from '../../engine/roles';
import type { FormationName, Role, TeamInstructions } from '../../engine/types';
import { teamFamiliarity } from '../../game/condition';
import { instructionFamiliarity } from '../../game/progress';
import { bestRoles, ROLE_FIT_MARK, ROLE_FIT_TEXT, roleFit } from '../../game/roleFit';
import { LEAGUE_RULES } from '../../game/rules';
import {
  arrangeForFormation, autoSelect, clubPlayers, isAvailable, isForeign, repairSelection, selectionWarnings, unavailableReason, validateSelection,
} from '../../game/selection';
import type { PlayerRecord } from '../../game/types';
import { Condition, Panel, StatusTags } from '../components/bits';
import { FORMATIONS_LIST, INSTRUCTION_LABELS, POSITION_LABEL } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

export function Tactics() {
  useTutorial('tactics');
  const game = useGame();
  const clubId = game.manager.clubId;
  const club = game.clubs[clubId];
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  if (!club) return null;

  const tactics = club.tactics;
  const slots = FORMATIONS[tactics.formation];
  const selection = club.selection ?? autoSelect(game, clubId, tactics.formation);
  const players = clubPlayers(game, clubId);
  const byId = (id: string | undefined) => (id ? game.players[id] : undefined);
  const errors = validateSelection(game, clubId, tactics.formation, selection);
  const warnings = errors.length === 0 ? selectionWarnings(game, selection) : [];
  const foreignCount = [...selection.lineup, ...selection.bench].filter((id) => {
    const p = byId(id);
    return p ? isForeign(p) : false;
  }).length;

  const save = (lineup: string[], bench: string[]) => store.update((g) => {
    const c = g.clubs[clubId];
    if (c) c.selection = { lineup, bench };
  });
  const setTactics = (change: Partial<typeof tactics>) => store.update((g) => {
    const c = g.clubs[clubId];
    if (c) c.tactics = { ...c.tactics, ...change };
  });

  const changeFormation = (formation: FormationName) => {
    store.update((g) => {
      const c = g.clubs[clubId];
      if (!c) return;
      const lineup = arrangeForFormation(g, selection.lineup, formation);
      c.selection = { lineup, bench: selection.bench };
      c.tactics = { ...c.tactics, formation, roles: undefined };
    });
  };

  /** 選んだ枠に選手を入れる。すでに先発か控えにいる選手なら入れ替える */
  const assign = (playerId: string) => {
    const lineup = [...selection.lineup];
    const bench = [...selection.bench];
    const current = lineup[selectedSlot];
    const inLineup = lineup.indexOf(playerId);
    const inBench = bench.indexOf(playerId);
    if (inLineup >= 0) {
      lineup[inLineup] = current ?? '';
    } else if (inBench >= 0) {
      if (current) bench[inBench] = current;
      else bench.splice(inBench, 1);
    }
    lineup[selectedSlot] = playerId;
    save(lineup.filter((id) => id !== ''), bench);
  };

  const setRole = (role: Role) => {
    const roles = slots.map((slot, i) => (i === selectedSlot ? role : roleForSlot(tactics, i, slot.position)));
    setTactics({ roles });
  };

  const setInstruction = (key: keyof TeamInstructions, value: number) =>
    setTactics({ instructions: { ...tactics.instructions, [key]: value } });

  const slot = slots[selectedSlot];
  const slotPlayer = byId(selection.lineup[selectedSlot]);
  const slotRole = slot ? roleForSlot(tactics, selectedSlot, slot.position) : null;
  const candidates = slot
    ? [...players].sort((a, b) => positionRating(b, slot.position) - positionRating(a, slot.position))
    : [];
  const notSelected = players.filter((p) => !selection.lineup.includes(p.id) && !selection.bench.includes(p.id))
    .sort((a, b) => overallRating(b) - overallRating(a));
  const lineupPlayers = selection.lineup.map(byId).filter((p): p is PlayerRecord => p !== undefined);

  return (
    <div className="page tactics">
      <div className="toolbar">
        <h1>戦術</h1>
        <label className="inline" data-tutorial="formation">
          フォーメーション
          <select value={tactics.formation} onChange={(e) => changeFormation(e.target.value as FormationName)}>
            {FORMATIONS_LIST.map((f) => <option key={f} value={f}>{f}（熟成度 {Math.round(club.familiarity.formations[f] ?? 0)}%）</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => {
          const auto = autoSelect(game, clubId, tactics.formation);
          save(auto.lineup, auto.bench);
        }}>
          自動で選ぶ
        </button>
        <button type="button" className="secondary" data-tutorial="fit-roles" title="先発の全員を、一番向いている役割にする" onClick={() =>
          setTactics({ roles: bestRoles(tactics.formation, selection.lineup.map(byId)) })}>
          役割を選手に合わせる
        </button>
        <span className="muted small">外国籍選手 {foreignCount}/{LEAGUE_RULES.foreignLimit}</span>
        <span className="muted small" title="フォーメーション6割、チーム指示4割">
          熟成度 {Math.round(teamFamiliarity(club))}%（{tactics.formation} {Math.round(club.familiarity.formations[tactics.formation] ?? 0)}%・指示 {Math.round(instructionFamiliarity(club))}%）
        </span>
      </div>
      {errors.length > 0 && (
        <div className="warning">
          {errors.join('／')}
          <button type="button" className="secondary small" onClick={() => {
            const fixed = repairSelection(game, clubId, tactics.formation, selection);
            save(fixed.lineup, fixed.bench);
          }}>出られない選手だけ入れ替える</button>
        </div>
      )}
      {warnings.length > 0 && <div className="warning small">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}

      <div className="tactics-grid">
        <div>
          <div className="pitch" data-tutorial="pitch">
            <div className="pitch-lines" />
            {slots.map((s, i) => {
              const p = byId(selection.lineup[i]);
              const role = roleForSlot(tactics, i, s.position);
              const fit = p ? positionFit(p.position, s.position) : 0;
              const problem = !p || !isAvailable(p) || fit < 0.85 || p.status.injury !== null;
              return (
                <button key={i} type="button"
                  className={`pitch-slot${selectedSlot === i ? ' selected' : ''}${problem ? ' problem' : ''}`}
                  style={{ top: `${(1 - s.x / 4.6) * 88 + 4}%`, left: `${50 + (s.y - 2.5) * 19}%` }}
                  onClick={() => setSelectedSlot(i)}>
                  <span className="slot-pos">{POSITION_LABEL[s.position]}</span>
                  <span className="slot-name">{p ? p.name.split(' ')[0]?.split('・')[0] : '（空き）'}</span>
                  <span className="slot-role">{p && <span className={`fit-mark fit-${roleFit(p, role, s.position)}`}>{ROLE_FIT_MARK[roleFit(p, role, s.position)]}</span>}{roleLabel(role, s.position)}</span>
                  {p && <span className="slot-rating">{positionRating(p, s.position).toFixed(1)}　<Condition value={p.status.condition} /></span>}
                </button>
              );
            })}
          </div>

          <Panel title={`控え（${selection.bench.length}/${LEAGUE_RULES.benchSize}）`}>
            <ul className="bench-list">
              {selection.bench.map((id) => {
                const p = byId(id);
                if (!p) return null;
                return (
                  <li key={id}>
                    <span className="pos-chip">{POSITION_LABEL[p.position]}</span>
                    <span>{p.name}</span>
                    <span className="muted small">{overallRating(p).toFixed(1)}</span>
                    <StatusTags player={p} />
                    <button type="button" className="link" onClick={() => save(selection.lineup, selection.bench.filter((b) => b !== id))}>外す</button>
                  </li>
                );
              })}
            </ul>
            {selection.bench.length < LEAGUE_RULES.benchSize && (
              <select value="" onChange={(e) => e.target.value && save(selection.lineup, [...selection.bench, e.target.value])}>
                <option value="">控えに加える…</option>
                {notSelected.filter(isAvailable).map((p) => (
                  <option key={p.id} value={p.id}>{POSITION_LABEL[p.position]} {p.name}（{overallRating(p).toFixed(1)}）</option>
                ))}
              </select>
            )}
          </Panel>
        </div>

        <div className="tactics-side">
          {slot && (
            <Panel title={`${POSITION_LABEL[slot.position]} の枠${slotPlayer ? `：${slotPlayer.name}` : ''}`}>
              <div className="role-options" data-tutorial="roles">
                {ROLE_OPTIONS[slot.position].map((role) => {
                  const fit = slotPlayer ? roleFit(slotPlayer, role, slot.position) : null;
                  return (
                    <label key={role} className={`role-option${slotRole === role ? ' active' : ''}`}>
                      <input type="radio" name="role" checked={slotRole === role} onChange={() => setRole(role)} />
                      <strong>
                        {fit && <span className={`fit-mark fit-${fit}`} title={`${slotPlayer?.name}に${ROLE_FIT_TEXT[fit]}`}>{ROLE_FIT_MARK[fit]}</span>}
                        {roleLabel(role, slot.position)}
                      </strong>
                      <span className="muted small">{ROLE_PROFILES[role].description}</span>
                    </label>
                  );
                })}
                {slotPlayer && <p className="muted small">◎○△は、その役割で大事な能力が、{slotPlayer.name}のこの位置での力より高いかどうかの目安です。</p>}
              </div>
              <table className="data-table compact">
                <thead><tr><th>Pos</th><th>名前</th><th className="num">この枠での力</th><th title={slotRole ? `${roleLabel(slotRole, slot.position)}への向き不向き` : ''}>役割</th><th>調子</th><th>状態</th><th /></tr></thead>
                <tbody>
                  {candidates.slice(0, 12).map((p) => {
                    const where = selection.lineup.includes(p.id) ? '先発' : selection.bench.includes(p.id) ? '控え' : '';
                    return (
                      <tr key={p.id} className={p.id === slotPlayer?.id ? 'highlight' : ''}>
                        <td>{POSITION_LABEL[p.position]}</td>
                        <td>{p.name}{isForeign(p) ? <span className="muted small">（外）</span> : null}</td>
                        <td className="num">{positionRating(p, slot.position).toFixed(1)}</td>
                        <td>{slotRole && <span className={`fit-mark fit-${roleFit(p, slotRole, slot.position)}`}>{ROLE_FIT_MARK[roleFit(p, slotRole, slot.position)]}</span>}</td>
                        <td><Condition value={p.status.condition} /></td>
                        <td>{unavailableReason(p) ? <StatusTags player={p} /> : <>{where} <StatusTags player={p} /></>}</td>
                        <td>
                          {p.id !== slotPlayer?.id && isAvailable(p) && (
                            <button type="button" className="secondary small" onClick={() => assign(p.id)}>入れる</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="チーム指示" tutorial="instructions">
            {INSTRUCTION_LABELS.map((item) => (
              <div key={item.key} className="instruction">
                <span className="instruction-label">{item.label}</span>
                <div className="segmented small">
                  {[-2, -1, 0, 1, 2].map((v) => (
                    <button key={v} type="button" className={tactics.instructions[item.key] === v ? 'active' : ''}
                      onClick={() => setInstruction(item.key, v)}>
                      {v === -2 ? item.low : v === 2 ? item.high : v === 0 ? '標準' : v > 0 ? '＋' : '−'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="キャプテンとキッカー">
            {([
              ['captainId', 'キャプテン'], ['penalty', 'PK'], ['freeKick', '直接FK'], ['corner', 'CK・間接FK'],
            ] as const).map(([key, label]) => {
              const value = key === 'captainId' ? tactics.captainId : tactics.setPieces?.[key];
              return (
                <label key={key} className="inline">
                  {label}
                  <select value={value ?? ''} onChange={(e) => {
                    const v = e.target.value || undefined;
                    if (key === 'captainId') setTactics({ captainId: v });
                    else setTactics({ setPieces: { ...tactics.setPieces, [key]: v } });
                  }}>
                    <option value="">自動で選ぶ</option>
                    {lineupPlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              );
            })}
          </Panel>
        </div>
      </div>
    </div>
  );
}
