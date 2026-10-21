// 並べ替えができる表。列を自分で選べる（要件定義書「画面の決まりごと」）。

import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  /** 列の選択メニューに出す説明（省略すると label） */
  title?: string;
  /** 並べ替えに使う値 */
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; desc: boolean };
  highlight?: (row: T) => boolean;
  compact?: boolean;
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, initialSort, highlight, compact }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const va = column.value(a);
      const vb = column.value(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const result = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ja');
      return sort.desc ? -result : result;
    });
  }, [rows, columns, sort]);

  const clickHeader = (key: string) => {
    setSort((current) => (current?.key === key ? { key, desc: !current.desc } : { key, desc: true }));
  };

  return (
    <div className="table-wrap">
      <table className={`data-table${compact ? ' compact' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? 'left', width: c.width }} title={c.title ?? c.label}
                onClick={() => clickHeader(c.key)} className={sort?.key === c.key ? 'sorted' : ''}>
                {c.label}{sort?.key === c.key ? (sort.desc ? ' ▼' : ' ▲') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`${onRowClick ? 'clickable' : ''}${highlight?.(row) ? ' highlight' : ''}`}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>{c.render ? c.render(row) : c.value(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 列の表示を切り替えるメニュー */
export function ColumnPicker<T>({ columns, visible, onChange }: {
  columns: Column<T>[]; visible: string[]; onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="column-picker">
      <button type="button" className="secondary" onClick={() => setOpen(!open)}>列を選ぶ {open ? '▲' : '▼'}</button>
      {open && (
        <div className="column-picker-menu">
          {columns.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={visible.includes(c.key)}
                onChange={(e) => onChange(e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key))} />
              {c.title ?? c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
