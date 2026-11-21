/**
 * Y-axis domains for value-over-time charts (net worth, account balances,
 * goal balances). One rule, shared by every such chart.
 */

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

export interface ClampedDomain {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * The y-domain for a balance-over-time line.
 *
 * Fitting the window to the data alone turns a rounding error into a cliff: a
 * month in which a $1.8M net worth moved 0.4% filled the frame top to bottom,
 * the line plunging to the floor and spiking back, beside a label reading
 * -0.4%. So the window has a floor: it never spans less than `minSpanFraction`
 * of the series mean (or `minAbsoluteSpan`, for a mean near zero). Below the
 * floor the window widens around the middle of the series, so a small move
 * draws small. Above it nothing changes, so a real swing still fills the frame.
 *
 * The domain always contains every value. A series that never crosses zero
 * never gets an axis on the other side of zero.
 */
export function clampedDomain(
  values: number[],
  {
    minSpanFraction = 0.1,
    minAbsoluteSpan = 100,
    padFraction = 0.08,
    tickCount = 4,
  }: { minSpanFraction?: number; minAbsoluteSpan?: number; padFraction?: number; tickCount?: number } = {},
): ClampedDomain {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: minAbsoluteSpan, ticks: niceTicks(0, minAbsoluteSpan, tickCount) };

  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length;
  const span = Math.max(rawMax - rawMin, Math.abs(mean) * minSpanFraction, minAbsoluteSpan);

  // Widen around the MIDDLE of the series, not around zero: the line stays
  // centred, and what grows is the empty room above and below it.
  const mid = (rawMin + rawMax) / 2;
  let lo = mid - span / 2;
  let hi = mid + span / 2;
  const pad = span * padFraction;
  lo -= pad;
  hi += pad;

  // An all-positive series (or all-negative) keeps zero as its outer bound.
  if (rawMin >= 0 && lo < 0) { hi -= lo; lo = 0; }
  else if (rawMax <= 0 && hi > 0) { lo -= hi; hi = 0; }

  return { min: lo, max: hi, ticks: niceTicks(lo, hi, tickCount) };
}
