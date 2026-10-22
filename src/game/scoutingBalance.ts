// スカウトと新人の数字（要件定義書 フェーズ4「スカウト」「新人の獲得（高校生・大学生）」、フェーズ4-C）

import type { ClubSize, ProspectSchool, ScoutRegion, SquadRole } from './types';

export const SCOUTING = {
  /** スカウトの人数（クラブの規模で決まる。フェーズ5のスタッフで変えられるようにする） */
  scouts: { large: 3, medium: 2, small: 1 } satisfies Record<ClubSize, number>,
  /** 調べる前の知識度：同じリーグの選手と所属なしの選手、海外の選手、新人の候補 */
  base: { league: 50, overseas: 20, prospect: 20 },
  /** 選手を指名して調べる日数（国内と新人の候補、海外）と、上がる知識度 */
  playerDays: { near: 5, overseas: 10 },
  playerGain: 35,
  /** 条件を付けて探す日数（国内と新人の候補、海外）、見つける人数、上がる知識度 */
  searchDays: { near: 14, overseas: 21 },
  searchFinds: 5,
  searchGain: 30,
  /** 対戦すると、相手の出場した選手の知識度がこれだけ上がる（ここまで。それより上はスカウトで） */
  matchGain: 4,
  matchCap: 70,
  /** 知識度がこれ以上なら、伸びしろを星の数で正確に言える。これ以上なら幅1つ */
  potentialExact: 85,
  potentialNear: 55,
  /** 知識度がこれより低いと、勧める度合いは出さない（幅が広すぎるため） */
  gradeFrom: 40,
  /** 長所と短所、性格のほのめかしの数（知識度で増える） */
  traitsAt: [[50, 2, 1, 1], [80, 3, 2, 2]] as [number, number, number, number][],
  keepReports: 200,
};

/** 海外の地域と国籍 */
export const SCOUT_REGIONS: Record<ScoutRegion, { label: string; nationalities: readonly string[] | null }> = {
  domestic: { label: '国内のリーグ', nationalities: null },
  students: { label: '高校・大学', nationalities: null },
  southAmerica: { label: '南米（ブラジル）', nationalities: ['ブラジル'] },
  asia: { label: 'アジア（韓国）', nationalities: ['韓国'] },
  europe: { label: 'ヨーロッパ（スペイン、セルビア）', nationalities: ['スペイン', 'セルビア'] },
};

export const PROSPECTS = {
  /** 候補の発表と、内定を出せる期間（'MM-DD'） */
  announce: '06-01',
  offersClose: '10-31',
  /** 1年の候補の人数 */
  count: { high: 36, university: 28 } satisfies Record<ProspectSchool, number>,
  /** 発表のときの年齢（1月1日に1つ上がって、18歳と22歳で加入する） */
  age: { high: 17, university: 21 } satisfies Record<ProspectSchool, number>,
  /** 総合力：リーグの水準の平均からの差と、ばらつき */
  level: { high: -3.5, university: -2.7 } satisfies Record<ProspectSchool, number>,
  spread: 1.1,
  /** 最初の内定から、どのクラブにするか決めるまでの日数 */
  decideDays: 21,
  /** AIクラブが内定を出す日と、1年に内定を出す人数の上限 */
  aiDays: ['06-05', '06-25', '07-20', '08-20', '09-20', '10-15'],
  aiMax: 3,
  /** 自分のクラブが一度に出せる内定の数 */
  myOpenMax: 5,
  /** 契約の年数（加入した年を含む） */
  years: 3,
  /** 約束する役割ごとの、選手から見た魅力と、年俸の目安の倍率 */
  roleAppeal: { youth: 0, backup: 0.5, rotation: 1.2, key: 2 } satisfies Record<SquadRole, number>,
  roleSalary: { youth: 1, backup: 1.15, rotation: 1.4, key: 2 } satisfies Record<SquadRole, number>,
};
