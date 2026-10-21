// 練習：チームの方針と強度、個人の重点、戦術の熟成度、ケガ人（要件定義書「練習」「戦術の熟成度」「ケガと疲労」）

import { overallRating } from '../../engine/ratings';
import { ATTRIBUTE_KEYS, type AttributeKey } from '../../engine/types';
import { GOALKEEPING_KEYS, TRAINING_FOCUS, TRAINING_INTENSITY } from '../../game/balance';
import { injuryName, teamFamiliarity } from '../../game/condition';
import { addDays } from '../../game/dates';
import { potentialStars } from '../../game/knowledge';
import { instructionFamiliarity } from '../../game/progress';
import { clubPlayers } from '../../game/selection';
import type { TrainingFocus, TrainingIntensity } from '../../game/types';
import { Bar, Condition, Fatigue, Morale, Panel, Stars, StatusTags } from '../components/bits';
import { ATTRIBUTE_LABEL, formatDate, FORMATIONS_LIST, POSITION_LABEL, POSITION_ORDER } from '../format';
import { store, useGame } from '../store';

const level = (v: number, labels: [string, string, string, string, string]): string =>
  v >= 1.5 ? labels[4] : v >= 1.15 ? labels[3] : v > 0.85 ? labels[2] : v >= 0.5 ? labels[1] : labels[0];

export function Training() {
  const game = useGame();
  const club = game.clubs[game.manager.clubId];
  if (!club) return null;
  const players = clubPlayers(game, club.id)
    .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || overallRating(b) - overallRating(a));
  const injured = players.filter((p) => p.status.injury);
  const focus = TRAINING_FOCUS[club.training.focus];
  const intensity = TRAINING_INTENSITY[club.training.intensity];

  const setTraining = (change: Partial<typeof club.training>) => store.update((g) => {
    const c = g.clubs[club.id];
    if (c) c.training = { ...c.training, ...change };
  });
  const setFocus = (playerId: string, key: AttributeKey | null) => store.update((g) => {
    const p = g.players[playerId];
    if (p) p.trainingFocus = key;
  });

  return (
    <div className="page">
      <h1>練習</h1>
      <div className="grid-2">
        <Panel title="チームの練習">
          <h3 className="small muted">方針</h3>
          <div className="option-cards">
            {(Object.keys(TRAINING_FOCUS) as TrainingFocus[]).map((key) => (
              <button key={key} type="button" className={`option-card${club.training.focus === key ? ' active' : ''}`} onClick={() => setTraining({ focus: key })}>
                <strong>{TRAINING_FOCUS[key].label}</strong>
                <span className="muted small">{TRAINING_FOCUS[key].description}</span>
              </button>
            ))}
          </div>
          <h3 className="small muted">強度</h3>
          <div className="segmented">
            {(Object.keys(TRAINING_INTENSITY) as TrainingIntensity[]).map((key) => (
              <button key={key} type="button" className={club.training.intensity === key ? 'active' : ''} onClick={() => setTraining({ intensity: key })}>
                {TRAINING_INTENSITY[key].label}
              </button>
            ))}
          </div>
          <p className="muted small">ハードは伸びやすいが、疲労とケガのリスクが増えます。試合の前日と翌日は、自動で軽めになります。</p>
          <dl className="facts">
            <dt>能力の伸び</dt><dd>{level(focus.growth * intensity.growth, ['ほとんどない', '少ない', '普通', '多い', 'とても多い'])}</dd>
            <dt>疲労</dt><dd>{level(focus.load * intensity.load, ['ほとんどない', '少ない', '普通', '多い', 'とても多い'])}</dd>
            <dt>ケガのリスク</dt><dd>{level(focus.injury * intensity.injury, ['とても低い', '低い', '普通', '高い', 'とても高い'])}</dd>
            <dt>熟成度の上がり方</dt><dd>{level(focus.familiarity * intensity.growth, ['ほとんどない', '遅い', '普通', '早い', 'とても早い'])}</dd>
          </dl>
        </Panel>

        <div>
          <Panel title="戦術の熟成度">
            {FORMATIONS_LIST.map((f) => {
              const v = club.familiarity.formations[f] ?? 0;
              return (
                <div key={f} className="fam-row">
                  <span>{f}{f === club.tactics.formation ? <span className="tag tag-good" style={{ marginLeft: 6 }}>使用中</span> : null}</span>
                  <Bar value={v} />
                  <span className="num">{Math.round(v)}%</span>
                </div>
              );
            })}
            <div className="fam-row">
              <span>チーム指示</span>
              <Bar value={instructionFamiliarity(club)} />
              <span className="num">{Math.round(instructionFamiliarity(club))}%</span>
            </div>
            <p className="small">チームとしての熟成度：<strong>{Math.round(teamFamiliarity(club))}%</strong></p>
            <p className="muted small">低いと、試合で判断力とポジショニングが実質的に下がります。戦術の練習と、試合で使うことで上がり、使わない形は少しずつ下がります。チーム指示を大きく変えると下がります。</p>
          </Panel>

          <Panel title={`ケガ人（${injured.length}人）`}>
            {injured.length === 0 ? <p className="muted">ケガ人はいません。</p> : (
              <table className="data-table compact">
                <thead><tr><th>選手</th><th>ケガ</th><th className="num">残り</th><th>復帰の見込み</th></tr></thead>
                <tbody>
                  {injured.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => store.navigate({ name: 'player', id: p.id })}>
                      <td>{p.name}</td>
                      <td>{p.status.injury && injuryName(p.status.injury)}</td>
                      <td className="num">{p.status.injury?.daysLeft}日</td>
                      <td>{p.status.injury && formatDate(addDays(game.date, p.status.injury.daysLeft), false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="個人の重点">
        <p className="muted small">選んだ能力は伸びやすくなり、ほかは少し伸びにくくなります。伸びしろはコーチの評価（星）で目安が分かります。</p>
        <table className="data-table compact">
          <thead>
            <tr><th>Pos</th><th>名前</th><th className="num">年齢</th><th className="num">総合力</th><th>伸びしろ</th><th>コンディション</th><th>疲労</th><th>モラル</th><th>状態</th><th>重点的に伸ばす能力</th></tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{POSITION_LABEL[p.position]}</td>
                <td><button type="button" className="link" onClick={() => store.navigate({ name: 'player', id: p.id })}>{p.name}</button></td>
                <td className="num">{p.age}</td>
                <td className="num">{overallRating(p).toFixed(1)}</td>
                <td><Stars count={potentialStars(p)} /></td>
                <td><Condition value={p.status.condition} /></td>
                <td><Fatigue value={p.status.fatigue} /></td>
                <td><Morale value={p.status.morale} /></td>
                <td><StatusTags player={p} /></td>
                <td>
                  <select value={p.trainingFocus ?? ''} onChange={(e) => setFocus(p.id, (e.target.value || null) as AttributeKey | null)}>
                    <option value="">なし</option>
                    {ATTRIBUTE_KEYS.filter((k) => p.position === 'GK' || !GOALKEEPING_KEYS.includes(k)).map((k) => (
                      <option key={k} value={k}>{ATTRIBUTE_LABEL[k]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
