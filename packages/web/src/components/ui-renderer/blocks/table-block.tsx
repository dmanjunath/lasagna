import type { TableBlock as TableBlockType } from "../../../lib/types.js";

export function TableBlockRenderer({ block }: { block: TableBlockType }) {
  // Handle both formats: columns (structured) or headers (simple strings)
  const headers = block.headers || block.columns?.map(c => c.label) || [];
  const columnKeys = block.columns?.map(c => c.key);

  return (
    <div className="overflow-x-auto glass-card p-4 col-span-full">
      {block.title && (
        <h4 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h4>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((header, idx) => (
              <th
                key={idx}
                className="text-left py-3 px-4 text-text-muted font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
              {Array.isArray(row) ? (
                // Row is an array of values
                row.map((cell, j) => (
                  <td key={j} className="py-3 px-4 text-text-secondary">
                    {cell}
                  </td>
                ))
              ) : (
                // Row is an object with column keys
                columnKeys?.map((key) => (
                  <td key={key} className="py-3 px-4 text-text-secondary">
                    {row[key]}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
