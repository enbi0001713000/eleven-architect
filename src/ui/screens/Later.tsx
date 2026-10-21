// まだ作っていない画面（後のフェーズで追加）

import { Panel } from '../components/bits';

const DESCRIPTION: Record<string, string> = {
  受信箱: 'ケガ、交渉の返事、オーナーからの連絡などが、メール形式で届きます。',
  練習: 'チームの練習方針と強度、選手ごとに伸ばしたい能力を決めます。',
  移籍: '選手の検索、移籍金と契約の交渉、放出したい選手の一覧を扱います。',
  スカウト: 'スカウトを派遣して、他クラブや海外の選手を調べます。',
  財務: '収支、予算の配分、借り入れ、チケット料金を管理します。',
  クラブ: 'オーナーの目標と交渉、スタジアム、スタッフを扱います。',
};

export function Later({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <Panel>
        <p>この画面はフェーズ{phase}で追加します。</p>
        <p className="muted">{DESCRIPTION[title]}</p>
      </Panel>
    </div>
  );
}
