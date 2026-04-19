interface ChartErrorProps {
  message: string;
  data?: unknown[];
}

export function ChartError({ message, data }: ChartErrorProps) {
  return (
    <div className="glass-card p-4 border border-warning/30">
      <div className="text-warning text-sm mb-2">Chart Error: {message}</div>
      {data && data.length > 0 && (
        <details className="text-xs text-text-secondary">
          <summary className="cursor-pointer hover:text-text-secondary">
            View raw data ({data.length} rows)
          </summary>
          <pre className="mt-2 p-2 bg-surface rounded overflow-auto max-h-48">
            {JSON.stringify(data.slice(0, 5), null, 2)}
            {data.length > 5 && `\n... and ${data.length - 5} more rows`}
          </pre>
        </details>
      )}
    </div>
  );
}
