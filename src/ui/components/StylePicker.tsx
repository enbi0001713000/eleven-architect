// 戦い方を選ぶ（要件定義書「画面の作り直し（1.1）」の「戦術と練習」）。現実の戦術の名前が付いたカードから選ぶと、チーム指示6つが決まる。
// 合うフォーメーションと役割は「おすすめ」として出し、押したときだけ変える。今の先発との合い具合を★で見せる。
// コーチは次の相手に合わせたおすすめを出す。自分で決めた指示は、名前を付けて3つまで残せる（試合中にも使える）。

import { useState } from 'react';
import { FORMATIONS } from '../../engine/formations';
import { roleForSlot } from '../../engine/roles';
import { instructionDistance } from '../../game/progress';
import { autoSelect, arrangeForFormation } from '../../game/selection';
import { nextFixtureOf } from '../../game/season';
import {
  lineupOf, nearestStyle, recommendStyle, STYLE_BY_ID, styleFit, styleFormation, styleRoles, STYLES, type PlayStyle, type StyleId,
} from '../../game/styles';
import type { GameState } from '../../game/types';
import type { FormationName, TeamInstructions } from '../../engine/types';
import { coachName } from '../coach';
import { ATTRIBUTE_LABEL } from '../format';
import { store } from '../store';
import { Panel } from './bits';
import { StaffFace } from './Face';
import { Term } from './Term';

export const SAVED_STYLES_MAX = 3;

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

function setInstructions(clubId: string, instructions: TeamInstructions): void {
  store.update((g) => {
    const c = g.clubs[clubId];
    if (c) c.tactics = { ...c.tactics, instructions: { ...instructions } };
  });
}

/** 戦い方に合うフォーメーションと役割にする（形を変えたら、先発も並べ直す）。形を渡せば、その形にする */
function applyShape(clubId: string, style: PlayStyle, to?: FormationName): void {
  store.update((g) => {
    const c = g.clubs[clubId];
    if (!c) return;
    const formation = to ?? styleFormation(style, c.tactics.formation, c.familiarity.formations);
    if (formation !== c.tactics.formation) {
      const selection = c.selection ?? autoSelect(g, clubId, c.tactics.formation);
      c.selection = { lineup: arrangeForFormation(g, selection.lineup, formation), bench: selection.bench };
    }
    c.tactics = { ...c.tactics, formation, roles: styleRoles(style, formation, c.tactics) };
  });
}

export function StylePicker({ game, clubId }: { game: GameState; clubId: string }) {
  const club = game.clubs[clubId];
  const [proposal, setProposal] = useState<StyleId | null>(null);
  const [name, setName] = useState('');
  if (!club) return null;
  const instructions = club.tactics.instructions;
  const { players, positions } = lineupOf(game, clubId);
  const saved = game.savedStyles ?? [];
  const activeSaved = saved.find((s) => instructionDistance(s.instructions, instructions) === 0);
  const proposed = proposal ? STYLE_BY_ID[proposal] : null;
  const proposedFormation = proposed ? styleFormation(proposed, club.tactics.formation, club.familiarity.formations) : null;
  const shapeDiffers = proposed !== null && (proposedFormation !== club.tactics.formation
    || styleRoles(proposed, club.tactics.formation, club.tactics)
      .some((r, i) => r !== roleForSlot(club.tactics, i, FORMATIONS[club.tactics.formation][i]?.position ?? 'CM')));

  const choose = (style: PlayStyle) => {
    setInstructions(clubId, style.instructions);
    setProposal(style.id);
  };

  return (
    <Panel title={<><Term k="戦い方">戦い方</Term>{activeSaved ? `：${activeSaved.name}` : ''}</>} icon="tactics" tutorial="styles">
      <CoachAdvice game={game} clubId={clubId} onAdopt={() => setProposal(null)} />
      <div className="style-grid">
        {STYLES.map((style) => {
          const active = instructionDistance(style.instructions, instructions) === 0;
          const fit = styleFit(players, style, positions);
          return (
            <button key={style.id} type="button" className={`style-card${active ? ' active' : ''}`} aria-pressed={active} onClick={() => choose(style)}>
              <span className="style-head">
                <strong>{style.name}</strong>
                {style.keys.length > 0
                  ? <span className={`style-stars stars-${fit.stars}`} title="今の先発との合い具合">{stars(fit.stars)}</span>
                  : <span className="muted small">誰でも</span>}
              </span>
              <span className="style-summary">{style.summary}</span>
              <span className="muted small">強い：{style.strong}</span>
              <span className="muted small">弱い：{style.weak}</span>
              {fit.strongest && (
                <span className="style-fit small">
                  生きる力：{ATTRIBUTE_LABEL[fit.strongest]}{fit.weakest ? `　足りない力：${ATTRIBUTE_LABEL[fit.weakest]}` : ''}
                </span>
              )}
              {active && <span className="style-now">今の戦い方</span>}
            </button>
          );
        })}
      </div>
      {proposed && instructionDistance(proposed.instructions, instructions) === 0 && shapeDiffers && (
        <div className="style-proposal">
          <span>
            チーム指示を「{proposed.name}」にしました。
            {proposedFormation !== club.tactics.formation
              ? <>合う形は <strong>{proposedFormation}</strong>（熟成度 {Math.round(club.familiarity.formations[proposedFormation!] ?? 0)}%）です。形を変えると、慣れるまで力を出しにくくなります。役割も{proposed.name}向きにできます。</>
              : <>役割も{proposed.name}向きにできます。</>}
          </span>
          <button type="button" className="primary small" onClick={() => { applyShape(clubId, proposed); setProposal(null); }}>形と役割も合わせる</button>
          <button type="button" className="secondary small" onClick={() => setProposal(null)}>指示だけにする</button>
        </div>
      )}
      <div className="saved-styles">
        <span className="muted small">自分の戦い方（{saved.length}/{SAVED_STYLES_MAX}）：</span>
        {saved.map((s, i) => (
          <span key={`${s.name}-${i}`} className={`saved-style${s === activeSaved ? ' active' : ''}`}>
            <button type="button" className="link" title="この指示にする" onClick={() => { setInstructions(clubId, s.instructions); setProposal(null); }}>{s.name}</button>
            <button type="button" className="link small" aria-label={`${s.name}を消す`} title="消す"
              onClick={() => store.update((g) => { g.savedStyles = (g.savedStyles ?? []).filter((_, j) => j !== i); })}>×</button>
          </span>
        ))}
        {saved.length < SAVED_STYLES_MAX && !activeSaved && STYLES.some((st) => instructionDistance(st.instructions, instructions) === 0) && (
          <span className="muted small">チーム指示を「詳しく」で変えると、自分の戦い方として残せます。</span>
        )}
        {saved.length < SAVED_STYLES_MAX && !activeSaved && !STYLES.some((st) => instructionDistance(st.instructions, instructions) === 0) && (
          <form className="inline-form" onSubmit={(e) => {
            e.preventDefault();
            const label = name.trim() || `自分の戦い方${saved.length + 1}`;
            store.update((g) => { g.savedStyles = [...(g.savedStyles ?? []), { name: label.slice(0, 16), instructions: { ...instructions } }].slice(0, SAVED_STYLES_MAX); });
            setName('');
          }}>
            <input type="text" value={name} maxLength={16} placeholder="名前（例：雨の日用）" aria-label="今の指示に付ける名前" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="secondary small">今の指示を残す</button>
          </form>
        )}
      </div>
    </Panel>
  );
}

/** 次の相手に合わせた、コーチのおすすめ */
function CoachAdvice({ game, clubId, onAdopt }: { game: GameState; clubId: string; onAdopt: () => void }) {
  const club = game.clubs[clubId];
  const next = nextFixtureOf(game, clubId);
  if (!club || !next) return null;
  const opponentId = next.homeId === clubId ? next.awayId : next.homeId;
  const opponent = game.clubs[opponentId];
  if (!opponent) return null;
  const advice = recommendStyle(game, clubId, opponentId);
  const theirs = nearestStyle(opponent.tactics.instructions);
  const adopted = instructionDistance(advice.style.instructions, club.tactics.instructions) === 0 && club.tactics.formation === advice.formation;
  return (
    <div className="coach-advice">
      <StaffFace seed={`${club.id}:coach`} age={38} tie={club.colors.primary} size={40} />
      <div>
        <div className="small muted">
          次の相手 <strong>{opponent.name}</strong>：{theirs ? theirs.name : '独自の戦い方'}（{opponent.tactics.formation}）
        </div>
        <div>
          <strong>コーチ {coachName(game, club.id)} のおすすめ：{advice.style.name}（{advice.formation}）</strong>
          <span className="muted small">　{advice.reason}</span>
          {advice.formation !== club.tactics.formation ? (
            <span className="muted small">形を{advice.formation}に変えます（熟成度 {Math.round(club.familiarity.formations[advice.formation] ?? 0)}%）。</span>
          ) : !advice.style.formations.includes(advice.formation) && (
            <span className="muted small">形は、慣れている今の{advice.formation}のままにします。</span>
          )}
        </div>
      </div>
      {adopted ? <span className="muted small nowrap">取り入れています</span> : (
        <button type="button" className="primary small" onClick={() => {
          setInstructions(clubId, advice.style.instructions);
          applyShape(clubId, advice.style, advice.formation);
          onAdopt();
        }}>取り入れる</button>
      )}
    </div>
  );
}
