import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartHover } from './ChartHover';

// ── Shared interactive trend chart ─────────────────────────────────────────
// Extracted verbatim from simple-money's NetWorthChart so the Money page and
// the account-detail page render the same full-width interactive area+line
// chart (hover crosshair, value readout via ChartHover, smooth spline).

export type Range = '1M' | '6M' | '1Y' | 'All';
export interface TrendPoint { date: string; value: number; }

export const CHART_H = 240;
export const CHART_M = { top: 16, right: 12, bottom: 36, left: 56 };
// Single source of truth for the chart accent — matches `text-success` /
// `--color-success` (#4C7A3E) so palette changes propagate automatically.
export const CHART_COLOR = 'rgb(var(--color-success))';

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

/**
 * Build a smooth monotone-cubic Hermite spline path through (x, y) points.
 * Fritsch–Carlson tangents prevent the curve from overshooting the data —
 * monthly balances will look like a sweep, not a connect-the-dots zigzag.
 */
export function smoothLinePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} L ${pts[1][0].toFixed(2)} ${pts[1][1].toFixed(2)}`;

  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) {
      m[i] = 0;
    } else {
      m[i] = (d[i - 1] + d[i]) / 2;
      const a = m[i] / d[i - 1];
      const b = m[i] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i - 1];
      }
    }
  }

  let out = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    const c1x = pts[i][0] + dx;
    const c1y = pts[i][1] + m[i] * dx;
    const c2x = pts[i + 1][0] - dx;
    const c2y = pts[i + 1][1] - m[i + 1] * dx;
    out += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${pts[i + 1][0].toFixed(2)} ${pts[i + 1][1].toFixed(2)}`;
  }
  return out;
}

export function TrendChart({ points, range, onHoverChange }: { points: TrendPoint[]; range: Range; onHoverChange?: (i: number | null) => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => {
    setHoverIdxRaw(i);
    onHoverChange?.(i);
  };
  const [chartW, setChartW] = useState(600);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const CHART_W = chartW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  return (
    <div ref={wrapperRef} className="relative select-none" style={{ color: CHART_COLOR }}>
      <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Net worth trend chart"
        className="w-full block touch-none"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="nw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="40%"  stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="nw-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={CHART_M.left} y1={yAt(t)} x2={CHART_W - CHART_M.right} y2={yAt(t)} className="stroke-rule/70" strokeWidth={1} strokeDasharray="2 5" />
            <text x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end" className="fill-text-muted" style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{formatShortMoney(t)}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#nw-area)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#nw-line)"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 2px 3px rgb(31 26 22 / 0.12))' }}
        />
        {!hover && points.length > 0 && (
          <>
            <circle
              cx={xAt(points.length - 1)}
              cy={yAt(points[points.length - 1].value)}
              r={11}
              fill="currentColor"
              fillOpacity={0.12}
            />
            <circle
              cx={xAt(points.length - 1)}
              cy={yAt(points[points.length - 1].value)}
              r={5.5}
              fill="currentColor"
              stroke="rgb(var(--color-bg))"
              strokeWidth={2.5}
            />
          </>
        )}
        {hover && hoverIdx !== null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} className="stroke-text-muted/60" strokeWidth={1} strokeDasharray="2 4" />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={14} fill="currentColor" fillOpacity={0.18} />
            <circle
              cx={xAt(hoverIdx)}
              cy={yAt(hover.value)}
              r={5.5}
              fill="currentColor"
              stroke="rgb(var(--color-bg))"
              strokeWidth={2.5}
            />
          </g>
        )}
        {xLabels.map(({ idx, label }) => (
          <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 12} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{label}</text>
        ))}
      </svg>
      {points.length > 0 && (
        <ChartHover
          width={CHART_W}
          height={CHART_H}
          paddingLeft={CHART_M.left}
          paddingRight={CHART_M.right}
          count={points.length}
          onHoverChange={setHoverIdx}
          getValue={(i) => fmtUsd(points[i].value)}
          getLabel={(i) =>
            new Date(points[i].date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          }
          getCurvePoint={(i) => ({ x: xAt(i), y: yAt(points[i].value) })}
        />
      )}
      </div>
    </div>
  );
}

export function filterByRange(history: TrendPoint[], range: Range): TrendPoint[] {
  if (range === 'All' || history.length === 0) return history;
  const days = range === '1M' ? 30 : range === '6M' ? 180 : 365;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.date).getTime() >= cutoff);
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = mag; else if (norm < 3) step = 2 * mag; else if (norm < 7) step = 5 * mag; else step = 10 * mag;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

// Decimals needed so adjacent tick labels stay distinct in compact ($X.XXM)
// notation: at least `minDecimals`, more when the tick step is small relative
// to the unit (e.g. a $380 range on an $8.03M base needs 4, not 2).
export function tickDecimals(ticks: number[], minDecimals = 2): number {
  if (ticks.length < 2) return minDecimals;
  const step = Math.abs(ticks[1] - ticks[0]);
  const max = Math.max(...ticks.map(Math.abs));
  const unit = max >= 1e6 ? 1e6 : max >= 1e3 ? 1e3 : 1;
  if (step <= 0) return minDecimals;
  const needed = Math.ceil(-Math.log10(step / unit) - 1e-9);
  return Math.max(minDecimals, Math.min(5, needed));
}

export function formatShortMoney(n: number, decimals?: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(decimals ?? (abs >= 1e7 ? 0 : 1))}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(decimals ?? (abs >= 1e4 ? 0 : 1))}K`;
  return `${sign}$${decimals != null ? abs.toFixed(decimals) : Math.round(abs)}`;
}

export function pickXLabels(points: TrendPoint[], range: Range): Array<{ idx: number; label: string }> {
  if (points.length === 0) return [];
  const fmt: Intl.DateTimeFormatOptions = range === '1M' ? { month: 'short', day: 'numeric' } : range === '6M' ? { month: 'short' } : { month: 'short', year: '2-digit' };
  const want = Math.min(5, points.length);
  const step = (points.length - 1) / Math.max(1, want - 1);
  const out: Array<{ idx: number; label: string }> = [];
  let lastLabel = '';
  for (let i = 0; i < want; i++) {
    const idx = Math.round(i * step);
    const label = new Date(points[idx].date).toLocaleString('en-US', fmt);
    if (label === lastLabel) continue;
    out.push({ idx, label });
    lastLabel = label;
  }
  return out;
}
