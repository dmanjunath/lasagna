import type { TableBlock as TableBlockType } from "../../../lib/types.js";

export function TableBlockRenderer({ block }: { block: TableBlockType }) {
  // Handle both formats: columns (structured) or headers (simple strings)
  const headers = block.headers || block.columns?.map(c => c.label) || [];
  const columnKeys = block.columns?.map(c => c.key);

  return (
    <div className="overflow-x-auto rounded-ui-xl border border-line bg-panel shadow-ui-sm p-4 col-span-full">
      {block.title && (
        <h4 className="text-base font-bold tracking-tight text-content mb-4">
          {block.title}
        </h4>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            {headers.map((header, idx) => (
              <th
                key={idx}
                className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-[0.06em] text-content-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-line hover:bg-canvas-sunken">
              {Array.isArray(row) ? (
                // Row is an array of values
                row.map((cell, j) => (
                  <td key={j} className="py-3 px-4 text-content-secondary ui-tnum">
                    {cell}
                  </td>
                ))
              ) : (
                // Row is an object with column keys
                columnKeys?.map((key) => (
                  <td key={key} className="py-3 px-4 text-content-secondary ui-tnum">
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
