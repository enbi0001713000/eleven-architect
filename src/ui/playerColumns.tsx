// 選手の一覧で使う列の定義。自分のクラブは正確な値、他クラブは知識度に応じた幅で見せる。

import { overallRating } from '../engine/ratings';
import { ATTRIBUTE_KEYS, type AttributeKey } from '../engine/types';
import { knowledgeOf, viewAttribute } from '../game/knowledge';
import { averageRating } from '../game/season';
import type { GameState, PlayerRecord } from '../game/types';
import { AttributeValue, Rating } from './components/bits';
import type { Column } from './components/DataTable';
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABEL, ATTRIBUTE_SHORT, formatYen, POSITION_LABEL, POSITION_NAME, POSITION_ORDER } from './format';

export function playerColumns(game: GameState): Column<PlayerRecord>[] {
  const club = game.clubs[game.manager.clubId];
  const lineup = new Set(club?.selection?.lineup ?? []);
  const bench = new Set(club?.selection?.bench ?? []);
  const view = (p: PlayerRecord, key: AttributeKey) => viewAttribute(p.attributes[key], knowledgeOf(game, p), `${p.id}:${key}`);
  const overallView = (p: PlayerRecord) => viewAttribute(overallRating(p), knowledgeOf(game, p), `${p.id}:overall`);
  const mid = (v: { low: number; high: number }) => (v.low + v.high) / 2;

  const attributeColumns: Column<PlayerRecord>[] = ATTRIBUTE_KEYS.map((key) => ({
    key,
    label: ATTRIBUTE_SHORT[key],
    title: ATTRIBUTE_LABEL[key],
    align: 'center',
    value: (p) => mid(view(p, key)),
    render: (p) => <AttributeValue view={view(p, key)} />,
  }));

  return [
    { key: 'no', label: '番号', align: 'right', width: 44, value: (p) => p.squadNumber },
    { key: 'pos', label: 'Pos', title: 'ポジション', width: 44, value: (p) => POSITION_ORDER.indexOf(p.position), render: (p) => <span title={POSITION_NAME[p.position]}>{POSITION_LABEL[p.position]}</span> },
    { key: 'name', label: '名前', value: (p) => p.name },
    { key: 'age', label: '年齢', align: 'right', value: (p) => p.age },
    { key: 'nat', label: '国籍', value: (p) => p.nationality },
    { key: 'ovr', label: '総合力', align: 'center', value: (p) => mid(overallView(p)), render: (p) => <AttributeValue view={overallView(p)} /> },
    {
      key: 'status', label: '状態', value: (p) => (p.discipline.suspendedMatches > 0 ? 0 : lineup.has(p.id) ? 1 : bench.has(p.id) ? 2 : 3),
      render: (p) => p.discipline.suspendedMatches > 0 ? <span className="tag tag-bad">出場停止{p.discipline.suspendedMatches}</span>
        : p.clubId !== game.manager.clubId ? null
          : lineup.has(p.id) ? <span className="tag tag-good">先発</span>
            : bench.has(p.id) ? <span className="tag">控え</span> : <span className="muted">-</span>,
    },
    { key: 'yellowAcc', label: '警告累積', title: '出場停止までの警告の累積', align: 'right', value: (p) => p.discipline.yellowAccumulation },
    ...attributeColumns,
    { key: 'apps', label: '出場', align: 'right', value: (p) => p.season.appearances },
    { key: 'starts', label: '先発', align: 'right', value: (p) => p.season.starts },
    { key: 'minutes', label: '出場時間', align: 'right', value: (p) => p.season.minutes },
    { key: 'goals', label: '得点', align: 'right', value: (p) => p.season.goals },
    { key: 'assists', label: 'アシスト', align: 'right', value: (p) => p.season.assists },
    { key: 'yellow', label: '警告', align: 'right', value: (p) => p.season.yellowCards },
    { key: 'red', label: '退場', align: 'right', value: (p) => p.season.redCards },
    { key: 'avg', label: '平均評価', align: 'right', value: (p) => averageRating(p.season), render: (p) => <Rating value={averageRating(p.season)} /> },
    {
      key: 'salary', label: '年俸', align: 'right', value: (p) => (p.clubId === game.manager.clubId ? p.contract?.salary ?? 0 : null),
      render: (p) => (p.clubId === game.manager.clubId && p.contract ? formatYen(p.contract.salary) : <span className="muted">非公開</span>),
    },
    { key: 'contractEnd', label: '契約満了', align: 'right', value: (p) => p.contract?.endYear ?? null, render: (p) => (p.contract ? `${p.contract.endYear}年` : '-') },
  ];
}

const BASE = ['no', 'pos', 'name'];

export const COLUMN_PRESETS: { id: string; label: string; keys: string[] }[] = [
  { id: 'overview', label: '概要', keys: [...BASE, 'age', 'nat', 'ovr', 'status', 'apps', 'goals', 'assists', 'avg'] },
  ...ATTRIBUTE_GROUPS.map((g) => ({ id: g.label, label: g.label, keys: [...BASE, 'ovr', ...g.keys] })),
  { id: 'records', label: '記録', keys: [...BASE, 'apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'yellowAcc', 'red', 'avg'] },
  { id: 'contract', label: '契約', keys: [...BASE, 'age', 'ovr', 'salary', 'contractEnd'] },
];
