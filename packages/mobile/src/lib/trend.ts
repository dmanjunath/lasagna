import { formatStoredDate } from "./format";
import { HIDDEN_AMOUNT, isAmountsHidden } from "./hide-amounts";

// A value over time (net worth, an account's balance), ported from
// packages/web/src/components/ds/TrendChart.tsx and NetWorthTrendCard.tsx.
// The y-domain rule is the web's own module (lib/chart-domain.ts), which
// imports nothing, so the chart imports it directly.

export type Range = "1M" | "6M" | "1Y" | "All";
export interface TrendPoint {
  date: string;
  value: number;
}

export const RANGES: Range[] = ["1M", "6M", "1Y", "All"];

export function filterByRange(history: TrendPoint[], range: Range, now: number = Date.now()): TrendPoint[] {
  if (range === "All" || history.length === 0) return history;
  const days = range === "1M" ? 30 : range === "6M" ? 180 : 365;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.date).getTime() >= cutoff);
}

/** The shortest range from `preferred` up that holds two points (the ranges nest). */
export function drawableRange(history: TrendPoint[], preferred: Range, now: number = Date.now()): Range {
  const from = Math.max(0, RANGES.indexOf(preferred));
  for (let i = from; i < RANGES.length; i++) {
    if (filterByRange(history, RANGES[i], now).length >= 2) return RANGES[i];
  }
  return preferred;
}

/** A monotone cubic spline through the points (Fritsch-Carlson), so the line never overshoots. */
export function smoothLinePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) return `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} L ${pts[1][0].toFixed(2)} ${pts[1][1].toFixed(2)}`;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
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
      if (s > 9) m[i] = (3 / Math.sqrt(s)) * a * d[i - 1];
    }
  }
  let out = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    out += ` C ${(pts[i][0] + dx).toFixed(2)} ${(pts[i][1] + m[i] * dx).toFixed(2)}, ${(pts[i + 1][0] - dx).toFixed(2)} ${(pts[i + 1][1] - m[i + 1] * dx).toFixed(2)}, ${pts[i + 1][0].toFixed(2)} ${pts[i + 1][1].toFixed(2)}`;
  }
  return out;
}

/** Up to five date labels across the points, never the same label twice in a row. */
/**
 * Where each point sits across the plot, 0 to 1, by its date: a gap of three
 * months reads as three months, not as one step. Points on one day, or dates
 * that do not parse, fall back to even spacing.
 */
export function timeFractions(points: TrendPoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  const even = points.map((_, i) => (n === 1 ? 0 : i / (n - 1)));
  const ts = points.map((p) => Date.parse(p.date.length === 10 ? `${p.date}T00:00:00Z` : p.date));
  if (ts.some((t) => !Number.isFinite(t))) return even;
  const span = ts[n - 1] - ts[0];
  if (!(span > 0)) return even;
  return ts.map((t) => Math.min(1, Math.max(0, (t - ts[0]) / span)));
}

/** The point nearest a position across the plot (0 to 1). */
export function nearestIndex(fracs: number[], at: number): number {
  let best = 0;
  for (let i = 1; i < fracs.length; i++) if (Math.abs(fracs[i] - at) < Math.abs(fracs[best] - at)) best = i;
  return best;
}

export function pickXLabels(points: TrendPoint[], range: Range, fracs: number[] = timeFractions(points)): Array<{ idx: number; label: string }> {
  if (points.length === 0) return [];
  const fmt: Intl.DateTimeFormatOptions = range === "1M" ? { month: "short", day: "numeric" } : range === "6M" ? { month: "short" } : { month: "short", year: "2-digit" };
  const want = Math.min(5, points.length);
  const out: Array<{ idx: number; label: string }> = [];
  let last = "";
  let lastIdx = -1;
  // Evenly spaced in time, each at the point nearest that moment.
  for (let i = 0; i < want; i++) {
    const idx = nearestIndex(fracs, want === 1 ? 0 : i / (want - 1));
    if (idx === lastIdx) continue;
    const label = formatStoredDate(points[idx].date, fmt);
    if (label === last) continue;
    out.push({ idx, label });
    last = label;
    lastIdx = idx;
  }
  return out;
}

/** Drops every other label (ends kept) until neighbours are at least `need` points apart on a plot `width` wide. */
export function thinLabels<T extends { idx: number; label: string }>(labels: T[], count: number, width: number, charWidth: number, fracs?: number[]): T[] {
  const span = Math.max(1, count - 1);
  const pos = (idx: number) => (fracs ? fracs[idx] ?? idx / span : idx / span);
  const need = Math.max(0, ...labels.map((l) => l.label.length)) * charWidth * 1.5 + 6;
  const tightest = (rows: T[]) => Math.min(...rows.slice(1).map((l, i) => (pos(l.idx) - pos(rows[i].idx)) * width));
  let out = labels;
  while (out.length > 2 && tightest(out) < need) out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1);
  return out;
}

/** Decimals that keep adjacent compact tick labels distinct. */
export function tickDecimals(ticks: number[], minDecimals = 2): number {
  if (ticks.length < 2) return minDecimals;
  const step = Math.abs(ticks[1] - ticks[0]);
  const max = Math.max(...ticks.map(Math.abs));
  const unit = max >= 1e6 ? 1e6 : max >= 1e3 ? 1e3 : 1;
  if (step <= 0) return minDecimals;
  const needed = Math.ceil(-Math.log10(step / unit) - 1e-9);
  return Math.max(minDecimals, Math.min(5, needed));
}

/**
 * A chart readout's day, short enough for one line: "Sep 30" this year,
 * "Sep 30 ’25" otherwise (never "September 30, 2025").
 */
export function chartDay(iso: string, now: Date = new Date()): string {
  const day = formatStoredDate(iso, { month: "short", day: "numeric" });
  const year = iso.slice(0, 4);
  return year === String(now.getFullYear()) ? day : `${day} ’${year.slice(2)}`;
}

/** "$98K", "$1.2M", with a true minus. */
export function tickLabel(n: number, decimals?: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(decimals ?? (abs >= 1e7 ? 0 : 1))}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(decimals ?? (abs >= 1e4 ? 0 : 1))}K`;
  return `${sign}$${decimals != null ? abs.toFixed(decimals) : Math.round(abs)}`;
}

/** "+1.2%", "−0.4%", and an unsigned "0.0%" for a change that rounds to nothing. */
export function signedPct(pct: number): string {
  if (Math.abs(pct) < 0.05) return "0.0%";
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct).toFixed(1)}%`;
}

/** An account's snapshots as ascending points keyed to the viewer's day. A debt plots what is owed. */
export function snapshotPoints(snapshots: Array<{ balance: string | null; snapshotAt: string }>, owed: boolean): TrendPoint[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return snapshots
    .map((s) => {
      const v = parseFloat(s.balance ?? "0");
      return { at: new Date(s.snapshotAt), value: owed ? Math.abs(v) : v };
    })
    .filter((p) => Number.isFinite(p.value) && !Number.isNaN(p.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((p) => ({ date: `${p.at.getFullYear()}-${pad(p.at.getMonth() + 1)}-${pad(p.at.getDate())}`, value: p.value }));
}
