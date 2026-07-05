import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../lib/api';
import { Button, Skeleton } from '../components/uikit';
import { AdminShell } from '../components/admin/admin-shell';
import { cn } from '../lib/utils';

type Spend = Awaited<ReturnType<typeof api.adminGetSpend>>;

const RANGES = [7, 30, 90, 365] as const;

// Sub-cent amounts are common here — "$0.00" would hide real spend.
const usd = (v: string | number, digits = 2) => {
  const n = Number(v);
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : digits)}`;
};
const fmtDay = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' });
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** Stacked bars (LLM = viz-2 periwinkle, Plaid = viz-1 teal) — plain divs, no chart lib. */
function SpendChart({ series, bucket }: { series: Spend['series']; bucket: 'day' | 'week' }) {
  const max = Math.max(...series.map((d) => Number(d.llmCost) + Number(d.plaidCost)), 0.000001);
  const hasData = series.some((d) => Number(d.llmCost) + Number(d.plaidCost) > 0);
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
          {bucket === 'week' ? 'Weekly spend' : 'Daily spend'}
        </span>
        {hasData && (
          <span className="text-[11px] text-content-muted ui-tnum">
            peak {usd(max)}{bucket === 'week' ? '/wk' : '/day'}
          </span>
        )}
      </div>
      {/* Baseline grounds empty days; the dashed top rule marks the peak level the label names. */}
      <div className="relative flex items-end gap-[3px] h-[160px] border-b border-line" role="img" aria-label={`${bucket === 'week' ? 'Weekly' : 'Daily'} spend chart`}>
        {hasData && <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden />}
        {!hasData && (
          <p className="absolute inset-0 grid place-items-center text-[12.5px] text-content-muted">No spend in this window.</p>
        )}
        {series.map((d) => {
          const llm = Number(d.llmCost);
          const plaid = Number(d.plaidCost);
          const total = llm + plaid;
          return (
            <div
              key={d.day}
              className="flex-1 min-w-[3px] max-w-[42px] flex flex-col justify-end h-full transition-opacity hover:opacity-75"
              title={`${bucket === 'week' ? 'Week of ' : ''}${fmtDay(d.day, true)} — LLM ${usd(llm, 4)} · Plaid ${usd(plaid, 4)} · ${d.events} events`}
            >
              <div className="w-full rounded-t-[3px] bg-viz-2" style={{ height: `${(llm / max) * 100}%`, minHeight: llm > 0 ? 2 : 0 }} />
              <div className={cn('w-full bg-viz-1', llm === 0 && 'rounded-t-[3px]')} style={{ height: `${(plaid / max) * 100}%`, minHeight: plaid > 0 ? 2 : 0 }} />
              <div className={cn('w-full', total === 0 && 'h-[2px] bg-canvas-sunken rounded-t-[3px]')} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-content-muted ui-tnum">{series[0] ? fmtDay(series[0].day, true) : ''}</span>
        <div className="flex items-center gap-4 text-[12px] font-medium text-content-secondary">
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-viz-2" /> LLM</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-viz-1" /> Plaid</span>
        </div>
        <span className="text-[11px] text-content-muted ui-tnum">{series.length ? fmtDay(series[series.length - 1].day, true) : ''}</span>
      </div>
    </div>
  );
}

const TH = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => (
  <th className={cn('px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted', right ? 'text-right' : 'text-left')}>{children}</th>
);
const TD = ({ children, right = false, mono = true }: { children: React.ReactNode; right?: boolean; mono?: boolean }) => (
  <td className={cn('px-4 py-2.5 text-[13px]', right && 'text-right', mono && 'ui-tnum')}>{children}</td>
);

export function AdminSpend() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Spend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = (d: number) => {
    setLoading(true);
    setError('');
    api
      .adminGetSpend(d)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(days);
  }, [days]);

  // Fill missing days so the chart reads as a continuous timeline. Long ranges
  // bucket into weeks — 365 daily bars would overflow the card and clip.
  const bucket: 'day' | 'week' = days > 180 ? 'week' : 'day';
  const series = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(data.series.map((d) => [d.day, d]));
    const daily: Spend['series'] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      daily.push(byDay.get(day) ?? { day, llmCost: '0', plaidCost: '0', events: 0 });
    }
    if (bucket === 'day') return daily;
    // Chunk from the end so the partial bucket is the OLDEST week — the
    // current week should never render as a misleading 1-day sliver.
    const weeks: Spend['series'] = [];
    for (let end = daily.length; end > 0; end -= 7) {
      const chunk = daily.slice(Math.max(0, end - 7), end);
      weeks.unshift({
        day: chunk[0].day,
        llmCost: String(chunk.reduce((s, d) => s + Number(d.llmCost), 0)),
        plaidCost: String(chunk.reduce((s, d) => s + Number(d.plaidCost), 0)),
        events: chunk.reduce((s, d) => s + d.events, 0),
      });
    }
    return weeks;
  }, [data, days, bucket]);

  const totalCost = data ? Number(data.totals.llmCost) + Number(data.totals.plaidCost) : 0;

  return (
    <AdminShell subtitle="Estimated LLM and Plaid spend, metered per activity event.">
      {/* Range toggle */}
      <div className="mt-7 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-full border border-line bg-panel p-1" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={days === r}
              onClick={() => setDays(r)}
              className={cn(
                'ui-focus touch-target h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors',
                days === r ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]' : 'text-content-muted hover:text-content',
              )}
            >
              {r}d
            </button>
          ))}
        </div>
        <p className="text-[12px] text-content-muted">Costs are estimates based on current model and Plaid pricing.</p>
      </div>

      {error ? (
        <div className="mt-6 rounded-ui-md border border-negative/25 bg-negative-soft px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] font-medium text-negative">Could not load spend — {error}</p>
          <Button variant="secondary" size="sm" onClick={() => load(days)}>Retry</Button>
        </div>
      ) : loading || !data ? (
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-24 rounded-ui-md" />
          <Skeleton className="h-48 rounded-ui-md" />
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-5">
            {[
              { label: 'Total spend', value: usd(totalCost) },
              { label: 'LLM spend', value: usd(data.totals.llmCost) },
              { label: 'Plaid spend', value: usd(data.totals.plaidCost) },
              { label: 'LLM calls', value: compact(data.totals.llmCalls) },
              { label: 'Tokens in / out', value: `${compact(data.totals.inputTokens)} / ${compact(data.totals.outputTokens)}` },
            ].map((s) => (
              // flex-col justify-between keeps values on one baseline when a label wraps to two lines.
              <div key={s.label} className="border-l-2 border-line pl-3.5 flex flex-col justify-between">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">{s.label}</div>
                <div className="mt-1 font-editorial text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5">
            <SpendChart series={series} bucket={bucket} />
          </div>

          {/* Breakdowns */}
          <div className="mt-6 grid lg:grid-cols-2 gap-5">
            <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-line text-[13px] font-semibold">By source</div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead><tr className="border-b border-line"><TH>Source</TH><TH right>Events</TH><TH right>Tokens</TH><TH right>Cost</TH></tr></thead>
                <tbody>
                  {data.bySource.map((s) => (
                    <tr key={`${s.kind}-${s.source}`} className="border-b border-line last:border-b-0">
                      <TD mono={false}><span className="font-medium">{s.source}</span> <span className="text-content-muted text-[11.5px]">{s.kind}</span></TD>
                      <TD right>{compact(s.events)}</TD>
                      <TD right>{s.kind === 'llm' ? compact(s.inputTokens + s.outputTokens) : <span className="text-content-faint">—</span>}</TD>
                      <TD right>{usd(s.cost)}</TD>
                    </tr>
                  ))}
                  {data.bySource.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-content-muted text-[13px]">No activity in this window.</td></tr>}
                </tbody>
              </table>
              </div>
            </div>

            <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-line text-[13px] font-semibold">By model</div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead><tr className="border-b border-line"><TH>Model</TH><TH right>Calls</TH><TH right>Tokens</TH><TH right>Cost</TH></tr></thead>
                <tbody>
                  {data.byModel.map((m) => (
                    <tr key={m.model ?? 'unknown'} className="border-b border-line last:border-b-0">
                      <TD mono={false}><span className="font-medium">{(m.model ?? 'unknown').split('/').pop()}</span></TD>
                      <TD right>{compact(m.calls)}</TD>
                      <TD right>{compact(m.inputTokens + m.outputTokens)}</TD>
                      <TD right>{usd(m.cost)}</TD>
                    </tr>
                  ))}
                  {data.byModel.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-content-muted text-[13px]">No LLM calls in this window.</td></tr>}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* Per-tenant — the cost-per-account view */}
          <div className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-[13px] font-semibold">By user <span className="font-normal text-content-muted">(top 50 by cost)</span></div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr className="border-b border-line"><TH>User</TH><TH right>Events</TH><TH right>LLM</TH><TH right>Plaid</TH><TH right>Total</TH></tr></thead>
              <tbody>
                {data.byTenant.map((t) => (
                  <tr key={t.tenantId ?? 'deleted'} className="border-b border-line last:border-b-0">
                    <TD mono={false}>
                      {t.tenantId ? (
                        <Link href={`/admin/users/${t.tenantId}`} className="font-medium hover:underline">{t.email ?? t.tenantName ?? 'Unnamed user'}</Link>
                      ) : (
                        <span className="font-medium text-content-muted">Deleted user</span>
                      )}
                    </TD>
                    <TD right>{compact(t.events)}</TD>
                    {/* Zero cells print faint so the non-zero side of the split stands out. */}
                    <TD right>{Number(t.llmCost) === 0 ? <span className="text-content-faint">{usd(0)}</span> : usd(t.llmCost)}</TD>
                    <TD right>{Number(t.plaidCost) === 0 ? <span className="text-content-faint">{usd(0)}</span> : usd(t.plaidCost)}</TD>
                    <TD right><span className="font-semibold">{usd(Number(t.llmCost) + Number(t.plaidCost))}</span></TD>
                  </tr>
                ))}
                {data.byTenant.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-content-muted text-[13px]">No attributed activity in this window.</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
