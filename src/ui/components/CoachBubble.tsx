// アシスタントコーチの一言（要件定義書「画面の作り直し（1.1）」）。画面を開いたときに、その画面で大事なことを1つだけ話す。
// 話す一言は画面を開いたときに決めて、その画面にいる間は変えない（読んでいる途中で変わらないように）。小さくたためる。

import { useEffect, useState } from 'react';
import { coachName, coachScreenOf, pickCoachLine, type CoachLine } from '../coach';
import { store, useStore } from '../store';
import { StaffFace } from './Face';

const KIND_LABEL: Record<CoachLine['kind'], string> = { state: '今の状態', next: '次にやること', tip: '豆知識', rumor: '噂' };

export function CoachBubble() {
  const s = useStore();
  const game = s.game;
  const screen = coachScreenOf(s.screen.name);
  const [line, setLine] = useState<CoachLine | null>(null);

  // 画面が変わったら（同じ画面でも開き直したら）、まだ話していない一言を選ぶ
  useEffect(() => {
    if (!game || !screen || !s.settings.coach) {
      setLine(null);
      return;
    }
    const next = pickCoachLine(game, screen, new Set(store.settings.coachSeen));
    setLine(next);
    if (next) store.markCoachSeen(`${game.seed}:${next.key}`);
  }, [s.screen, s.settings.coach]);

  const club = game ? game.clubs[game.manager.clubId] : undefined;
  if (!game || !club || !screen || !line || !s.settings.coach || s.locked) return null;
  const name = coachName(game, club.id);
  const face = <StaffFace seed={`${club.id}:coach`} age={38} tie={club.colors.primary} size={s.settings.coachCollapsed ? 30 : 46} />;

  if (s.settings.coachCollapsed) {
    return (
      <button type="button" className="coach-chip" title="コーチの一言を開く" onClick={() => store.updateSettings({ coachCollapsed: false })}>
        <span className="coach-face">{face}</span>コーチの一言
      </button>
    );
  }
  return (
    <aside className={`coach-bubble kind-${line.kind}`} aria-label="アシスタントコーチの一言">
      <span className="coach-face">{face}</span>
      <div className="coach-body">
        <div className="coach-name">アシスタントコーチ {name}<span className="coach-kind">{KIND_LABEL[line.kind]}</span></div>
        <p>{line.text}</p>
        {line.action && (
          <button type="button" className="secondary small" onClick={() => {
            const target = line.action!.screen;
            if (target.name === s.screen.name) store.replace(target);
            else store.navigate(target);
          }}>{line.action.label} ▶</button>
        )}
      </div>
      <button type="button" className="link small coach-close" title="小さくたたむ" aria-label="コーチの一言をたたむ" onClick={() => store.updateSettings({ coachCollapsed: true })}>たたむ</button>
    </aside>
  );
}
