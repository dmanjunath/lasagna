import type { TableBlock as TableBlockType } from "../../../lib/types.js";

export function TableBlockRenderer({ block }: { block: TableBlockType }) {
  return (
    <div className="overflow-x-auto">
      {block.title && (
        <h4 className="text-sm font-medium text-text-muted mb-2">
          {block.title}
        </h4>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {block.columns.map((col) => (
              <th
                key={col.key}
                className="text-left py-2 px-3 text-text-muted font-medium"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {block.columns.map((col) => (
                <td key={col.key} className="py-2 px-3 text-text">
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
