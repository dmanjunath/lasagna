import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../lib/api';
import { SimpleShell } from '../components/layout/simple-shell';

type Range = '1M' | '6M' | '1Y' | 'All';

interface Balance {
  accountId: string;
  name: string;
  type: string;
  balance: string | null;
  currency: string;
  asOf: string | null;
}
interface Debt {
  id: string;
  name: string;
  type: string;
  balance: number;
  interestRate: number | null;
  minimumPayment: number;
}
interface Holding {
  id: string;
  tickerSymbol: string | null;
  institutionValue: string | null;
}
interface Transaction {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  category: string;
}
interface NetWorthPoint {
  date: string;
  value: number;
}

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: frac,
    minimumFractionDigits: frac,
  });

const categoryIcon: Record<string, string> = {
  income: '💵',
  groceries: '🛒',
  food_dining: '🍽️',
  housing: '🏠',
  transportation: '🚗',
  entertainment: '🎬',
  shopping: '🛍️',
  utilities: '💡',
  healthcare: '🏥',
  insurance: '🛡️',
  travel: '✈️',
  subscriptions: '📺',
  debt_payment: '💳',
  savings_investment: '📈',
  taxes: '📋',
  transfer: '↔️',
};

export function SimpleMoney() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [range, setRange] = useState<Range>('6M');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getBalances().then((d) => setBalances(d.balances)).catch(() => {}),
      api.getDebts().then((d) => setDebts(d.debts)).catch(() => {}),
      api.getHoldings().then((d) => setHoldings(d.holdings)).catch(() => {}),
      api.getTransactions({ limit: 5 }).then((d) => setTransactions(d.transactions)).catch(() => {}),
      api.getNetWorthHistory().then((d) => setHistory(d.history)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // ── Totals ──
  const cashAccounts = balances.filter((a) => a.type === 'depository');
  const investmentAccounts = balances.filter((a) => a.type === 'investment');
  const cashTotal = cashAccounts.reduce((s, a) => s + parseFloat(a.balance ?? '0'), 0);
  const investTotal = investmentAccounts.reduce((s, a) => s + parseFloat(a.balance ?? '0'), 0);
  const debtTotal = debts.reduce((s, d) => s + d.balance, 0);
  const netWorth = cashTotal + investTotal - debtTotal;

  // Use invest account balances as the source of truth — summing holdings
  // can double-count when the API returns duplicated rows.
  const portfolioTotal = investTotal;

  // ── Net-worth deltas ──
  const monthChange = computeDelta(history, 30);
  const yearChange = computeDelta(history, 365);

  // ── Chart points filtered by range ──
  const chartPoints = useMemo(() => filterByRange(history, range), [history, range]);

  // ── Highest-interest debt (for "pay this first" label) ──
  // When the API doesn't return an interest rate (common today),
  // fall back to type: credit cards are almost always high-interest,
  // loans (mortgages/student loans) are assumed lower-rate.
  function effectiveRate(d: Debt): number {
    if (d.interestRate != null) return d.interestRate;
    if (d.type === 'credit') return 22; // credit-card default
    return 6; // loan default
  }
  function isHighInterest(d: Debt): boolean {
    return effectiveRate(d) >= 10;
  }
  const ranked = [...debts].sort((a, b) => effectiveRate(b) - effectiveRate(a));
  const highInterestId = ranked[0] && isHighInterest(ranked[0]) ? ranked[0].id : null;

  return (
    <SimpleShell title="Money" activeTab="money">
      {/* Net worth hero — flush to the page gutter (no px-1) so the number
          column aligns with the cards below. */}
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium">Net worth</div>
        <div className="mt-2 text-[40px] font-serif font-medium leading-[1.05] tabular-nums">
          {loading ? '…' : fmtUsd(netWorth)}
        </div>
        <div className="text-sm text-success mt-2 tabular-nums">
          {monthChange !== null && <span>↑ {fmtUsd(monthChange)} this month</span>}
          {monthChange !== null && yearChange !== null && <span className="text-text-muted"> · </span>}
          {yearChange !== null && <span>↑ {fmtUsd(yearChange)} this year</span>}
          {monthChange === null && yearChange === null && <span className="text-text-muted">No history yet</span>}
        </div>
      </div>

      {/* Chart */}
      {chartPoints.length >= 2 && (
        <section className="rounded-2xl bg-bg-elevated border border-rule p-4 mb-6 shadow-sm">
          <NetWorthChart points={chartPoints} range={range} />
          <div className="flex justify-center mt-3">
            <div className="inline-flex bg-bg rounded-full p-0.5 text-xs border border-rule/60">
              {(['1M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1 rounded-full transition ${
                    range === r ? 'bg-bg-elevated shadow-sm font-medium text-text' : 'text-text-muted'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Breakdown — what makes up the net-worth number above */}
      {!loading && (cashAccounts.length > 0 || investmentAccounts.length > 0 || debts.length > 0) && (
        <section className="rounded-2xl bg-bg-elevated border border-rule shadow-sm mb-6 overflow-hidden">
          <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium px-4 pt-4 pb-2">
            Breakdown
          </div>
          {cashAccounts.length > 0 && (
            <BreakdownRow icon="💰" label="Cash" sublabel={`${cashAccounts.length} account${cashAccounts.length === 1 ? '' : 's'}`} amount={cashTotal} positive />
          )}
          {investmentAccounts.length > 0 && (
            <BreakdownRow icon="📈" label="Investments" sublabel={`${investmentAccounts.length} account${investmentAccounts.length === 1 ? '' : 's'}`} amount={investTotal} positive />
          )}
          {debts.length > 0 && (
            <BreakdownRow icon="💳" label="Debts" sublabel={`${debts.length} account${debts.length === 1 ? '' : 's'}`} amount={-debtTotal} />
          )}
          <div className="flex items-center justify-between px-4 py-3 bg-bg/40 border-t border-rule/60">
            <div className="text-sm font-semibold">Net worth</div>
            <div className="text-sm font-semibold tabular-nums">{fmtUsd(netWorth)}</div>
          </div>
        </section>
      )}

      {/* Manage accounts link */}
      <div className="flex items-center justify-end mb-5">
        <Link href="/accounts" className="text-xs text-text-muted underline py-1">
          Manage accounts →
        </Link>
      </div>

      {/* ── Cash: header & total, then insight, then accounts ── */}
      {cashAccounts.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Cash" total={cashTotal} />
          {cashTotal > 1000 && (
            <Insight tone="positive" eyebrow="Looking good" body="Your savings cover a starter buffer — keep it building." />
          )}
          <AccountList>
            {cashAccounts.map((a) => (
              <Row
                key={a.accountId}
                icon={isSavings(a) ? '💰' : '🏦'}
                name={a.name}
                subtitle={isSavings(a) ? 'Set aside' : 'For spending'}
                amount={parseFloat(a.balance ?? '0')}
              />
            ))}
          </AccountList>
        </section>
      )}

      {/* ── Investments: header & total, then insight, then accounts ── */}
      {investmentAccounts.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Investments" total={investTotal} />
          {portfolioTotal > 0 && (
            <Insight tone="info" eyebrow="Your portfolio" icon="📊">
              <p className="text-sm leading-relaxed text-text-secondary">
                You have <strong className="tabular-nums text-text">{fmtUsd(portfolioTotal)}</strong> invested — that's your money working for you over the long run.
              </p>
            </Insight>
          )}
          <AccountList>
            {investmentAccounts.map((a) => (
              <Row
                key={a.accountId}
                icon={isRetirement(a.name) ? '🏛️' : '📈'}
                name={a.name}
                subtitle={isRetirement(a.name) ? 'Retirement · through work' : 'Long-term investing'}
                amount={parseFloat(a.balance ?? '0')}
              />
            ))}
          </AccountList>
        </section>
      )}

      {/* ── Debt: header & total, then insight, then accounts ── */}
      {debts.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Debt" total={debtTotal} />
          {ranked[0] && isHighInterest(ranked[0]) && ranked[0].minimumPayment > 0 && (
            <Insight tone="warn" eyebrow={`If you keep paying ${fmtUsd(ranked[0].minimumPayment)}/mo`} icon="🎉">
              <p className="text-sm leading-relaxed text-text-secondary">
                You'll be free of <strong className="text-text">{ranked[0].name}</strong> in{' '}
                <strong className="text-text tabular-nums">{monthsToPayOff(ranked[0])}</strong>.
              </p>
            </Insight>
          )}
          <AccountList>
            {debts.map((d) => {
              const hi = isHighInterest(d);
              const rate = d.interestRate;
              const subtitle = hi
                ? rate != null
                  ? `${rate.toFixed(1)}% — pay this first`
                  : 'High interest · pay this first'
                : rate != null
                  ? `${rate.toFixed(1)}% — no rush`
                  : 'Low interest · no rush';
              return (
                <Row
                  key={d.id}
                  icon={d.type === 'credit' ? '💳' : '🎓'}
                  name={d.name}
                  subtitle={subtitle}
                  subtitleClass={hi ? 'text-accent' : 'text-text-muted'}
                  amount={d.balance}
                  accent={highInterestId === d.id}
                />
              );
            })}
          </AccountList>
        </section>
      )}

      {/* ── Recent activity ── */}
      {transactions.length > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-serif font-medium text-text">Recent activity</h3>
            <span className="text-xs text-text-muted">Last {transactions.length}</span>
          </div>
          <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
            {transactions.map((t, i) => {
              const amt = parseFloat(t.amount);
              const isIncome = amt < 0;
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-3 p-4 ${i < transactions.length - 1 ? 'border-b border-rule/60' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-full ${isIncome ? 'bg-success/10' : 'bg-bg'} grid place-items-center text-sm`}>
                    {categoryIcon[t.category] || '💸'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.merchantName || t.name}</div>
                    <div className="text-xs text-text-muted">
                      {formatDate(t.date)} · {humanCategory(t.category)}
                    </div>
                  </div>
                  <div className={`text-sm font-medium tabular-nums ${isIncome ? 'text-success' : ''}`}>
                    {isIncome ? '+' : '−'}
                    {fmtUsd(Math.abs(amt), 2)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </SimpleShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

function computeDelta(history: NetWorthPoint[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const now = history[history.length - 1].value;
  const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const past = [...history].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
  if (!past) return null;
  return now - past.value;
}

function filterByRange(history: NetWorthPoint[], range: Range): NetWorthPoint[] {
  if (range === 'All' || history.length === 0) return history;
  const days = range === '1M' ? 30 : range === '6M' ? 180 : 365;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.date).getTime() >= cutoff);
}

// ── Interactive net-worth chart ──────────────────────────────────────────
//
// Renders Y-axis ticks (4 nice round values + dashed gridlines), X-axis
// labels at evenly spaced points, the line + area path, and a pointer-driven
// crosshair / tooltip so the user can scrub through the series on touch.
//
// Coords live in a 360×180 viewBox; `preserveAspectRatio` defaults to xMidYMid
// meet so text + dots don't stretch on wide containers.

const CHART_W = 360;
const CHART_H = 180;
const CHART_M = { top: 18, right: 12, bottom: 26, left: 46 };

function NetWorthChart({ points, range }: { points: NetWorthPoint[]; range: Range }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const innerW = CHART_W - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    const lo = rawMin - pad;
    const hi = rawMax + pad;
    return { yMin: lo, yMax: hi, yTicks: niceTicks(lo, hi, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) =>
    CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(1)} ${(CHART_M.top + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(CHART_M.top + innerH).toFixed(1)} Z`;

  function pointerToIdx(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const { x } = pt.matrixTransform(ctm.inverse());
    const ratio = (x - CHART_M.left) / innerW;
    const idx = Math.round(ratio * (points.length - 1));
    return Math.min(points.length - 1, Math.max(0, idx));
  }

  function handleDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setHoverIdx(pointerToIdx(e.clientX));
  }
  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    if (e.buttons === 0 && e.pointerType !== 'touch') return;
    setHoverIdx(pointerToIdx(e.clientX));
  }
  function clear() { setHoverIdx(null); }

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const last = points[points.length - 1];
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  return (
    <div className="relative select-none">
      {/* Hover readout floats above the chart so it doesn't overlap the line. */}
      <div className="h-6 flex items-baseline justify-end gap-2 px-1 mb-1 tabular-nums">
        {hover ? (
          <>
            <span className="text-xs text-text-muted">
              {new Date(hover.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-sm font-semibold text-text">{fmtUsd(hover.value)}</span>
          </>
        ) : (
          <span className="text-xs text-text-muted/0">.</span>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full h-auto block touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerLeave={clear}
        onPointerUp={clear}
        onPointerCancel={clear}
      >
        <defs>
          <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(76 122 62)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(76 122 62)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y gridlines + tick labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={CHART_M.left}
              y1={yAt(t)}
              x2={CHART_W - CHART_M.right}
              y2={yAt(t)}
              className="stroke-rule"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={CHART_M.left - 6}
              y={yAt(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-text-muted"
              style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShortMoney(t)}
            </text>
          </g>
        ))}

        {/* Area + line */}
        <path d={areaPath} fill="url(#nw-grad)" />
        <path
          d={linePath}
          fill="none"
          stroke="rgb(76 122 62)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* End-of-line dot when not scrubbing */}
        {!hover && last && (
          <circle cx={xAt(points.length - 1)} cy={yAt(last.value)} r={3.5} fill="rgb(76 122 62)" />
        )}

        {/* Hover crosshair + dot halo */}
        {hover && hoverIdx !== null && (
          <g>
            <line
              x1={xAt(hoverIdx)}
              y1={CHART_M.top}
              x2={xAt(hoverIdx)}
              y2={CHART_M.top + innerH}
              className="stroke-text-muted"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={9} fill="rgb(76 122 62)" fillOpacity={0.15} />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={4} fill="rgb(76 122 62)" />
          </g>
        )}

        {/* X-axis labels — anchored to the actual data-point positions so
            they align with the line above instead of drifting. */}
        {xLabels.map(({ idx, label }) => (
          <text
            key={`${idx}-${label}`}
            x={xAt(idx)}
            y={CHART_H - 8}
            textAnchor="middle"
            className="fill-text-muted"
            style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// "Nice" tick generator — picks 1/2/2.5/5 × 10^n step so the axis reads
// in round numbers regardless of the input range.
function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.001; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

function formatShortMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function pickXLabels(points: NetWorthPoint[], range: Range): Array<{ idx: number; label: string }> {
  if (points.length === 0) return [];
  const fmt: Intl.DateTimeFormatOptions =
    range === '1M'
      ? { month: 'short', day: 'numeric' }
      : range === '6M'
        ? { month: 'short' }
        : { month: 'short', year: '2-digit' };
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

function isSavings(a: Balance) {
  return /sav|hys|money mkt|emerg/i.test(a.name);
}

function isRetirement(name: string) {
  return /401|403|ira|roth|pension/i.test(name);
}

function monthsToPayOff(d: Debt): string {
  // crude — does not account for interest; for display only
  if (!d.minimumPayment) return '—';
  const months = Math.ceil(d.balance / d.minimumPayment);
  if (months < 12) return `about ${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `about ${years} years` : `about ${years} years, ${rem} months`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function humanCategory(c: string) {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────
// presentational subcomponents
// ─────────────────────────────────────────────────────────────────────────

function SectionHeader({ title, total }: { title: string; total: number }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h3 className="text-base font-serif font-medium text-text">{title}</h3>
      <span className="text-base font-medium tabular-nums">{fmtUsd(total)}</span>
    </div>
  );
}

function AccountList({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
      {children}
    </div>
  );
}

function BreakdownRow({
  icon,
  label,
  sublabel,
  amount,
  positive,
}: {
  icon: string;
  label: string;
  sublabel: string;
  amount: number;
  positive?: boolean;
}) {
  const display = positive ? fmtUsd(amount) : amount < 0 ? `−${fmtUsd(Math.abs(amount))}` : fmtUsd(amount);
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-rule/60 last:border-b-0">
      <div className="text-lg">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-text-muted">{sublabel}</div>
      </div>
      <div className={`text-sm font-medium tabular-nums ${amount < 0 ? 'text-text-secondary' : ''}`}>
        {display}
      </div>
    </div>
  );
}

function Row({
  icon,
  name,
  subtitle,
  subtitleClass,
  amount,
  accent,
}: {
  icon: string;
  name: string;
  subtitle: string;
  subtitleClass?: string;
  amount: number;
  accent?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-4 border-b border-rule/60 last:border-b-0 ${accent ? 'bg-accent/[0.02]' : ''}`}>
      <div className="text-xl">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className={`text-xs ${subtitleClass ?? 'text-text-muted'}`}>{subtitle}</div>
      </div>
      <div className="text-sm font-medium tabular-nums">{fmtUsd(amount)}</div>
    </div>
  );
}

function Insight({
  tone,
  eyebrow,
  body,
  icon,
  children,
}: {
  tone: 'positive' | 'info' | 'warn';
  eyebrow: string;
  body?: string;
  icon?: string;
  children?: React.ReactNode;
}) {
  // Tones stay inside the warm palette — the old `info` was sky-blue which
  // looked foreign next to cream + terracotta. Now it uses the cream/ink
  // pairing already used elsewhere in Simple mode.
  const toneClass =
    tone === 'positive'
      ? 'bg-success/10 border-success/30'
      : tone === 'info'
        ? 'bg-bg border-rule'
        : 'bg-cheese/10 border-cheese/40';
  const labelClass =
    tone === 'positive' ? 'text-success' : tone === 'info' ? 'text-text-secondary' : 'text-lf-crust';
  return (
    <article className={`rounded-2xl border p-4 mb-3 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <div className="text-xl">{icon ?? '✨'}</div>
        <div className="flex-1">
          <div className={`text-[11px] uppercase tracking-[0.16em] font-medium mb-1 ${labelClass}`}>{eyebrow}</div>
          {body && <p className="text-sm leading-relaxed text-text-secondary">{body}</p>}
          {children}
        </div>
      </div>
    </article>
  );
}
