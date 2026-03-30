import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { colors } from '../../styles/theme';

interface HistogramBucket {
  bucket: string | number;
  count: number;
  status: 'success' | 'close' | 'failure';
}

interface HistogramChartProps {
  data: HistogramBucket[];
  height?: number;
}

const STATUS_COLORS = {
  success: '#4ade80',
  close: '#f59e0b',
  failure: '#ef4444',
};

function formatValue(v: number): string {
  if (v === 0) return '$0';
  if (v < 0) return `-$${formatValue(Math.abs(v)).slice(1)}`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Find a nice round step size for the given range
function getNiceStep(range: number, targetBins: number): number {
  const roughStep = range / targetBins;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  // Pick nice round numbers: 1, 2, 2.5, 5, 10
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;

  return niceNormalized * magnitude;
}

// Re-bucket the data into bins with nice round boundaries
function rebucket(data: HistogramBucket[]): { buckets: HistogramBucket[]; step: number } {
  if (data.length === 0) return { buckets: data, step: 0 };

  // Get all bucket values as numbers
  const values = data.map(d => typeof d.bucket === 'string' ? parseFloat(d.bucket) : d.bucket);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal;

  if (range === 0) return { buckets: data, step: 0 };

  // Target around 12-15 bins for a clean look
  const targetBins = 12;
  const step = getNiceStep(range, targetBins);

  // Round min down and max up to nice boundaries
  const niceMin = Math.floor(minVal / step) * step;
  const niceMax = Math.ceil(maxVal / step) * step;

  // Create bins at nice round boundaries
  const bins: Map<number, { count: number; statusCounts: Record<string, number> }> = new Map();

  for (let boundary = niceMin; boundary <= niceMax; boundary += step) {
    bins.set(boundary, { count: 0, statusCounts: { success: 0, close: 0, failure: 0 } });
  }

  // Assign each data point to a bin
  for (const d of data) {
    const val = typeof d.bucket === 'string' ? parseFloat(d.bucket) : d.bucket;
    // Find the bin this value belongs to (round down to nearest boundary)
    const binKey = Math.floor(val / step) * step;
    const bin = bins.get(binKey);
    if (bin) {
      bin.count += d.count;
      bin.statusCounts[d.status] += d.count;
    }
  }

  // Convert to array, filter out empty bins
  const result: HistogramBucket[] = [];
  for (const [boundary, bin] of bins) {
    if (bin.count === 0) continue;

    // Determine status by majority
    const { statusCounts } = bin;
    let status: 'success' | 'close' | 'failure';
    if (statusCounts.failure >= statusCounts.success && statusCounts.failure >= statusCounts.close) {
      status = 'failure';
    } else if (statusCounts.close >= statusCounts.success) {
      status = 'close';
    } else {
      status = 'success';
    }

    result.push({ bucket: boundary, count: bin.count, status });
  }

  // Sort by bucket value
  result.sort((a, b) => {
    const aVal = typeof a.bucket === 'number' ? a.bucket : parseFloat(a.bucket);
    const bVal = typeof b.bucket === 'number' ? b.bucket : parseFloat(b.bucket);
    return aVal - bVal;
  });

  return { buckets: result, step };
}

export function HistogramChart({ data, height = 250 }: HistogramChartProps) {
  const { buckets, step } = rebucket(data);
  const totalSimulations = buckets.reduce((sum, d) => sum + d.count, 0);
  const displayData = buckets.map((d) => {
    const bucketVal = typeof d.bucket === 'string' ? parseFloat(d.bucket) : d.bucket;
    const label = step > 0
      ? `${formatValue(bucketVal)}\u2013${formatValue(bucketVal + step)}`
      : formatValue(bucketVal);
    return { ...d, label };
  });

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={displayData} barCategoryGap="8%">
          <XAxis
            dataKey="label"
            stroke={colors.text.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{ value: 'Simulations', angle: -90, position: 'insideLeft', fill: colors.text.muted, fontSize: 11, dy: 40 }}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
              fontSize: '13px',
            }}
            formatter={(value: any, _name: any, props: any) => {
              const pct = totalSimulations > 0
                ? ((value as number) / totalSimulations * 100).toFixed(1)
                : '0.0';
              return [`${props.payload.label}  —  ${value} simulations (${pct}%)`, ''];
            }}
            labelFormatter={() => ''}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {displayData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status]} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.success }} />
          Succeeded
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.close }} />
          Close call
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.failure }} />
          Ran out
        </div>
      </div>
    </div>
  );
}
