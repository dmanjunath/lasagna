import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  /** Right-align this column (numeric values) */
  num?: boolean;
  /** Visually muted column */
  muted?: boolean;
  /** Cell renderer */
  cell: (row: T) => ReactNode;
  /** Optional width hint */
  width?: string;
  /** Extra className applied to both <th> and <td> for this column.
   *  Useful for responsive visibility (e.g. "hidden md:table-cell") or
   *  enabling wrapping (e.g. "td--wrap" — only meaningful on <td>). */
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Function returning unique row key */
  rowKey: (row: T) => string;
  /** Show hover state on rows */
  hover?: boolean;
  onRowClick?: (row: T) => void;
  emptyMessage?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  hover,
  onRowClick,
  emptyMessage = 'No records.',
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="ds-caption" style={{ padding: '32px 16px', textAlign: 'center' }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="ds-table-scroll">
      <table className="ds-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(c.num && 'th--num', c.className)}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(hover && 'ds-table__row--hover')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(c.num && 'td--num', c.muted && 'td--muted', c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
