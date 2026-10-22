// スカウトレポートの中身（選手の詳細と、内定を出す画面で使う）。フェーズ4-C。

import { formatValueRange } from '../../game/contracts';
import { potentialStars } from '../../game/knowledge';
import { freeScouts, GRADE_LABEL, scoutPlayer, scoutProblem, scoutReport } from '../../game/scouting';
import type { GameState, PlayerRecord } from '../../game/types';
import { ATTRIBUTE_LABEL, formatDate } from '../format';
import { store } from '../store';
import { AttributeValue, Stars } from './bits';

/** 伸びしろの星（幅があれば「★★〜★★★」） */
export function StarRange({ range }: { range: [number, number] }) {
  if (range[0] === range[1]) return <Stars count={range[0]} />;
  return <span className="stars" title={`伸びしろの目安：星${range[0]}〜${range[1]}つ`}>{'★'.repeat(range[0])}<span className="muted">〜</span>{'★'.repeat(range[1])}</span>;
}

export function GradeBadge({ grade }: { grade: 'A' | 'B' | 'C' | 'D' }) {
  return <span className={`tag grade-${grade}`}>{GRADE_LABEL[grade]}</span>;
}

/** スカウトを送るボタン（送れなければ理由を出す） */
export function ScoutButton({ game, player, small }: { game: GameState; player: PlayerRecord; small?: boolean }) {
  const problem = scoutProblem(game, player.id);
  const busy = (game.scouting?.assignments ?? []).some((a) => a.playerId === player.id);
  return (
    <button type="button" className={`secondary${small ? ' small' : ''}`} disabled={!!problem} title={problem ?? `空いているスカウト：${freeScouts(game)}人`}
      onClick={() => store.update((g) => { scoutPlayer(g, player.id); })}>
      {busy ? '調べています' : 'スカウトを送る'}
    </button>
  );
}

export function ScoutReportView({ game, player }: { game: GameState; player: PlayerRecord }) {
  const mine = player.clubId === game.manager.clubId;
  if (mine) {
    return (
      <div>
        <p>自分のクラブの選手です。能力はすべて分かっています。</p>
        <dl className="facts"><dt>伸びしろ（コーチの評価）</dt><dd><Stars count={potentialStars(player)} /></dd></dl>
      </div>
    );
  }
  const report = scoutReport(game, player);
  const last = game.scouting?.reports.find((r) => r.playerId === player.id);
  return (
    <div>
      <dl className="facts">
        <dt>知識度</dt><dd>{report.knowledge}%{last ? `（${formatDate(last.date, false)}に調べた）` : '（まだ調べていない）'}</dd>
        <dt>総合力</dt><dd><AttributeValue view={report.overall} /></dd>
        <dt>伸びしろ</dt><dd><StarRange range={report.potential} /></dd>
        <dt>市場価値</dt><dd>{formatValueRange(report.value)}</dd>
        <dt>長所</dt><dd>{report.strengths.map((k) => ATTRIBUTE_LABEL[k]).join('、') || '-'}</dd>
        <dt>短所</dt><dd>{report.weaknesses.map((k) => ATTRIBUTE_LABEL[k]).join('、') || '-'}</dd>
        <dt>人柄</dt><dd>{report.hints.length > 0 ? report.hints.join(' ') : report.knowledge < 50 ? 'まだ分かりません。' : '目立ったところはありません。'}</dd>
        <dt>スカウトの評価</dt><dd><GradeBadge grade={report.grade} /> <span className="small">{report.reason}</span></dd>
      </dl>
      <div className="button-row" style={{ marginTop: 10 }}>
        <ScoutButton game={game} player={player} />
        <span className="muted small">調べると知識度が上がり、能力の幅が狭まります。知識度は下がりません。</span>
      </div>
    </div>
  );
}
