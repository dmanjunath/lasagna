import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  Wallet, TrendingUp, CreditCard, RefreshCw, Lightbulb, Plus,
  Banknote, ShoppingCart, UtensilsCrossed, Home, Car, Clapperboard,
  ShoppingBag, HeartPulse, Shield, Plane, Tv, Receipt, ArrowLeftRight,
  DollarSign,
} from 'lucide-react';
import { api } from '../lib/api';

type Range = '1M' | '6M' | '1Y' | 'All';

interface Item {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    mask: string | null;
    balance: string | null;
    currency: string;
  }>;
}
interface NetWorthPoint { date: string; value: number; }
interface Transaction {
  id: string; date: string; name: string; merchantName: string | null;
  amount: string; category: string;
}
interface Insight {
  id: string; category: string; type: string | null; title: string; description: string;
}

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

const categoryIcon: Record<string, React.ReactNode> = {
  income: <DollarSign size={16} />, groceries: <ShoppingCart size={16} />,
  food_dining: <UtensilsCrossed size={16} />, housing: <Home size={16} />,
  transportation: <Car size={16} />, entertainment: <Clapperboard size={16} />,
  shopping: <ShoppingBag size={16} />, utilities: <Lightbulb size={16} />,
  healthcare: <HeartPulse size={16} />, insurance: <Shield size={16} />,
  travel: <Plane size={16} />, subscriptions: <Tv size={16} />,
  debt_payment: <CreditCard size={16} />, savings_investment: <TrendingUp size={16} />,
  taxes: <Receipt size={16} />, transfer: <ArrowLeftRight size={16} />,
};

export function SimpleMoney() {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [range, setRange] = useState<Range>('6M');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getItems().catch(() => ({ items: [] as Item[] })),
      api.getNetWorthHistory().catch(() => ({ history: [] as NetWorthPoint[] })),
      api.getTransactions({ limit: 5 }).catch(() => ({ transactions: [] as Transaction[] })),
      api.getInsights().catch(() => ({ insights: [] as Insight[] })),
    ]).then(([itemsData, historyData, txData, insightsData]) => {
      setItems(itemsData.items);
      setHistory(historyData.history || []);
      setTransactions(txData.transactions);
      setInsights((insightsData.insights || []).filter((i: any) => !i.dismissedAt).slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  const [syncingAll, setSyncingAll] = useState(false);

  async function handleSync(itemId: string) {
    setSyncing(itemId);
    setSyncError(null);
    try {
      await api.syncItem(itemId);
      const fresh = await api.getItems();
      setItems(fresh.items);
    } catch {
      const name = items.find((i) => i.id === itemId)?.institutionName || 'Institution';
      setSyncError(`Couldn't sync ${name}. Try again in a moment.`);
    }
    setSyncing(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    setSyncError(null);
    try {
      await Promise.all(items.map((item) => api.syncItem(item.id).catch(() => {})));
      const fresh = await api.getItems();
      setItems(fresh.items);
    } catch {
      setSyncError('Some accounts failed to sync. Try again.');
    }
    setSyncingAll(false);
  }

  // ── Totals from items ──
  const allAccounts = items.flatMap((i) => i.accounts);
  const cashAccounts = allAccounts.filter((a) => a.type === 'depository');
  const investAccounts = allAccounts.filter((a) => a.type === 'investment');
  const debtAccounts = allAccounts.filter((a) => a.type === 'credit' || a.type === 'loan');
  const cashTotal = cashAccounts.reduce((s, a) => s + parseFloat(a.balance ?? '0'), 0);
  const investTotal = investAccounts.reduce((s, a) => s + parseFloat(a.balance ?? '0'), 0);
  const debtTotal = debtAccounts.reduce((s, a) => s + Math.abs(parseFloat(a.balance ?? '0')), 0);
  const netWorth = cashTotal + investTotal - debtTotal;

  const monthChange = computeDelta(history, 30);
  const yearChange = computeDelta(history, 365);
  const chartPoints = useMemo(() => filterByRange(history, range), [history, range]);

  // ── Prebaked + real insights per section ──
  const cashInsight = cashTotal > 50000
    ? `You have ${fmtUsd(cashTotal)} in cash — that's ${Math.round(cashTotal / (netWorth || 1) * 100)}% of your net worth.`
    : cashTotal > 1000
      ? 'Your cash reserves are building. Keep growing your emergency fund.'
      : null;
  const investInsight = investTotal > 0
    ? `${fmtUsd(investTotal)} invested — that's your money compounding over time.`
    : null;
  const debtInsight = debtTotal > 0
    ? `${fmtUsd(debtTotal)} in total debt. ${debtAccounts.some((a) => a.type === 'credit') ? 'Focus on high-interest credit cards first.' : 'Low-interest debt — no rush.'}`
    : null;

  // Real AI insights filtered to portfolio/debt/cash categories
  const moneyInsights = insights.filter((i) =>
    ['portfolio', 'cash', 'debt', 'savings', 'investment'].some((k) => (i.category + (i.type || '')).toLowerCase().includes(k))
  );

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 40px)', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Net worth hero + action buttons ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted font-medium">Net worth</div>
          <div className="mt-2 font-serif text-4xl md:text-5xl font-medium leading-[1.05] tabular-nums">
            {loading ? '…' : fmtUsd(netWorth)}
          </div>
          <div className="text-sm mt-2 tabular-nums">
            {monthChange !== null && (
              <span className={monthChange >= 0 ? 'text-success' : 'text-accent'}>
                {monthChange >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(monthChange))} this month
              </span>
            )}
            {monthChange !== null && yearChange !== null && <span className="text-text-muted"> · </span>}
            {yearChange !== null && (
              <span className={yearChange >= 0 ? 'text-success' : 'text-accent'}>
                {yearChange >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(yearChange))} this year
              </span>
            )}
            {monthChange === null && yearChange === null && <span className="text-text-muted">No history yet</span>}
          </div>
        </div>
        {!loading && items.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rule hover:bg-bg-elevated transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncingAll ? 'animate-spin' : ''} />
              {syncingAll ? 'Syncing…' : 'Sync all'}
            </button>
            <Link
              href="/accounts"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-text text-white hover:bg-text/90 transition-colors"
            >
              <Plus size={12} />
              Add account
            </Link>
          </div>
        )}
      </div>

      {/* Sync error banner */}
      {syncError && (
        <div className="rounded-xl bg-accent/5 border border-accent/20 px-4 py-3 mb-4 flex items-center justify-between" role="alert">
          <span className="text-sm text-accent">{syncError}</span>
          <button onClick={() => setSyncError(null)} className="text-xs text-text-muted hover:text-text ml-3">Dismiss</button>
        </div>
      )}

      {/* ── Chart — full width, borderless ── */}
      {chartPoints.length >= 2 && (
        <section className="mb-8 pb-4 border-b border-rule/60">
          <NetWorthChart points={chartPoints} range={range} />
          <div className="flex justify-center mt-3">
            <div className="inline-flex bg-bg rounded-full p-0.5 text-xs border border-rule/60">
              {(['1M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`px-3.5 py-1.5 min-h-[44px] rounded-full transition ${range === r ? 'bg-bg-elevated shadow-sm font-medium text-text' : 'text-text-muted'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="animate-pulse space-y-6 mb-8">
          {[1, 2].map((n) => (
            <div key={n}>
              <div className="flex items-center justify-between mb-3">
                <div className="h-5 w-24 bg-rule/40 rounded" />
                <div className="h-5 w-20 bg-rule/40 rounded" />
              </div>
              <div className="rounded-2xl bg-bg-elevated border border-rule overflow-hidden">
                {[1, 2].map((r) => (
                  <div key={r} className={`flex items-center gap-3 px-4 py-3 ${r > 1 ? 'border-t border-rule/40' : ''}`}>
                    <div className="w-8 h-8 rounded-lg bg-rule/40" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 w-32 bg-rule/40 rounded" />
                      <div className="h-3 w-24 bg-rule/40 rounded" />
                    </div>
                    <div className="h-4 w-16 bg-rule/40 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && allAccounts.length === 0 && (
        <div className="rounded-2xl bg-bg-elevated border border-rule p-8 text-center mb-8">
          <Wallet size={32} className="text-text-muted mx-auto mb-3" />
          <div className="text-sm font-medium text-text mb-1">No accounts connected</div>
          <div className="text-xs text-text-muted mb-4">Link a bank or brokerage to see your money here.</div>
          <Link href="/accounts" className="text-sm font-medium text-accent underline">Connect an account</Link>
        </div>
      )}

      {/* ── Cash section ── */}
      {cashAccounts.length > 0 && (
        <AccountSection
          title="Cash"
          icon={<Wallet size={18} className="text-success" />}
          total={cashTotal}
          insight={cashInsight}
          items={items}
          filterType="depository"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Investments section ── */}
      {investAccounts.length > 0 && (
        <AccountSection
          title="Investments"
          icon={<TrendingUp size={18} className="text-cheese" />}
          total={investTotal}
          insight={investInsight}
          items={items}
          filterType="investment"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Debt section ── */}
      {debtAccounts.length > 0 && (
        <AccountSection
          title="Debt"
          icon={<CreditCard size={18} className="text-accent" />}
          total={debtTotal}
          insight={debtInsight}
          items={items}
          filterType={['credit', 'loan']}
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── AI Insights ── */}
      {moneyInsights.length > 0 && (
        <section className="mt-8 mb-6">
          <h3 className="font-serif text-lg font-medium text-text mb-3">Insights</h3>
          <div className="space-y-3">
            {moneyInsights.map((ins) => (
              <Link key={ins.id} href={`/insights?id=${ins.id}`} className="block rounded-2xl bg-bg-elevated border border-rule p-4 hover:border-accent/30 transition">
                <div className="flex items-start gap-3">
                  <Lightbulb size={16} className="text-cheese mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{ins.title}</div>
                    <div className="text-xs text-text-muted mt-1 line-clamp-2">{ins.description}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent activity ── */}
      {transactions.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-serif text-lg font-medium text-text">Recent activity</h3>
            <Link href="/spending" className="text-xs text-text-muted underline">All spending →</Link>
          </div>
          {transactions.map((t, i) => {
            const amt = parseFloat(t.amount);
            const isIncome = amt < 0;
            return (
              <div key={t.id} className={`flex items-center gap-3 py-3 ${i < transactions.length - 1 ? 'border-b border-rule/60' : ''}`}>
                <div className={`w-8 h-8 rounded-full ${isIncome ? 'bg-success/10' : 'bg-bg-elevated'} grid place-items-center text-sm`}>
                  {categoryIcon[t.category] || <Banknote size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.merchantName || t.name}</div>
                  <div className="text-xs text-text-muted">{formatDate(t.date)} · {humanCategory(t.category)}</div>
                </div>
                <div className={`text-sm font-medium tabular-nums ${isIncome ? 'text-success' : ''}`}>
                  {isIncome ? '+' : '−'}{fmtUsd(Math.abs(amt), 2)}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Account section — groups accounts by institution with sync controls
// ─────────────────────────────────────────────────────────────────────────

function AccountSection({
  title, icon, total, insight, items, filterType, syncing, onSync,
}: {
  title: string;
  icon: React.ReactNode;
  total: number;
  insight: string | null;
  items: Item[];
  filterType: string | string[];
  syncing: string | null;
  onSync: (itemId: string) => void;
}) {
  const types = Array.isArray(filterType) ? filterType : [filterType];
  // Flat list of accounts matching this type, with their parent item attached
  const accounts = items.flatMap((item) =>
    item.accounts
      .filter((a) => types.includes(a.type))
      .map((a) => ({ ...a, item }))
  );

  // Find items with sync errors that have accounts in this section
  const errorItems = items.filter(
    (item) =>
      (item.status === 'error' || item.status === 'item_login_required') &&
      item.accounts.some((a) => types.includes(a.type))
  );

  return (
    <section className="mb-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-serif text-lg font-medium text-text">{title}</h3>
        </div>
        <span className="text-base font-medium tabular-nums">{fmtUsd(total)}</span>
      </div>

      {/* Insight card */}
      {insight && (
        <div className="rounded-xl bg-bg-elevated border border-rule/60 px-4 py-3 mb-3 text-sm text-text-secondary">
          {insight}
        </div>
      )}

      {/* Sync error banners */}
      {errorItems.map((item) => (
        <div key={item.id} className="rounded-xl bg-accent/5 border border-accent/20 px-4 py-3 mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-accent">
              {item.institutionName || 'Institution'} needs attention
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {item.status === 'item_login_required' ? 'Login expired — reconnect to resume syncing' : 'Sync error — try reconnecting'}
            </div>
          </div>
          <Link
            href="/accounts"
            className="text-xs font-medium text-accent underline whitespace-nowrap"
          >
            Reconnect →
          </Link>
        </div>
      ))}

      {/* Account rows — grouped by type, each row shows institution + sync */}
      <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
        {accounts.map((acct, i) => {
          const bal = parseFloat(acct.balance ?? '0');
          return (
            <div key={acct.id} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-rule/40' : ''}`}>
              {/* Institution badge */}
              <div
                className="w-8 h-8 rounded-lg grid place-items-center text-sm font-medium shrink-0 text-white"
                style={{ background: institutionColor(acct.item.institutionName || '') }}
              >
                {(acct.item.institutionName || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{titleCase(acct.name)}</div>
                <div className="text-[11px] text-text-muted font-mono truncate">
                  {acct.item.institutionName || 'Manual'}
                  {acct.subtype && <span> · {titleCase(acct.subtype)}</span>}
                  {acct.mask && <span> · ··{acct.mask}</span>}
                  {acct.item.lastSyncedAt && <span> · {relativeTime(acct.item.lastSyncedAt)}</span>}
                </div>
              </div>
              <span className="text-sm font-medium tabular-nums shrink-0">{fmtUsd(Math.abs(bal))}</span>
              <button
                onClick={() => onSync(acct.item.id)}
                disabled={syncing === acct.item.id}
                className="w-11 h-11 grid place-items-center rounded-lg hover:bg-bg transition-colors text-text-muted hover:text-text disabled:opacity-50 shrink-0 -mr-2"
                title={`Sync ${acct.item.institutionName || ''}`}
                aria-label={`Sync ${acct.item.institutionName || 'account'}`}
              >
                <RefreshCw size={14} className={syncing === acct.item.id ? 'animate-spin' : ''} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Deterministic color from institution name — warm palette for visual distinction. */
const INST_COLORS = ['#8B4A2B', '#5A6B3F', '#6B2420', '#3D7A35', '#C25030', '#1E5C50', '#B87A1E', '#7A5C3F', '#A23F29', '#185248'];
function institutionColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return INST_COLORS[Math.abs(hash) % INST_COLORS.length];
}

function titleCase(raw: string): string {
  return raw.split(/\s+/).map((w) =>
    w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
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
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function humanCategory(c: string) {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// ── Interactive net-worth chart ──────────────────────────────────────────

const CHART_W = 900;
const CHART_H = 200;
const CHART_M = { top: 16, right: 16, bottom: 28, left: 56 };

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
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(1)} ${(CHART_M.top + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(CHART_M.top + innerH).toFixed(1)} Z`;

  function pointerToIdx(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = 0;
    const { x } = pt.matrixTransform(ctm.inverse());
    const ratio = (x - CHART_M.left) / innerW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  }

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  return (
    <div className="relative select-none">
      <div className="h-6 flex items-baseline justify-end gap-2 px-1 mb-1 tabular-nums">
        {hover ? (
          <>
            <span className="text-xs text-text-muted">{new Date(hover.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-sm font-semibold text-text">{fmtUsd(hover.value)}</span>
          </>
        ) : <span className="text-xs text-text-muted/0">.</span>}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Net worth trend chart"
        className="w-full block touch-none"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerUp={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(76 122 62)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(76 122 62)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={CHART_M.left} y1={yAt(t)} x2={CHART_W - CHART_M.right} y2={yAt(t)} className="stroke-rule" strokeWidth={1} strokeDasharray="2 3" />
            <text x={CHART_M.left - 6} y={yAt(t)} dy="0.32em" textAnchor="end" className="fill-text-muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{formatShortMoney(t)}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#nw-grad)" />
        <path d={linePath} fill="none" stroke="rgb(76 122 62)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {!hover && points.length > 0 && <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={3.5} fill="rgb(76 122 62)" />}
        {hover && hoverIdx !== null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} className="stroke-text-muted" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={9} fill="rgb(76 122 62)" fillOpacity={0.15} />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={4} fill="rgb(76 122 62)" />
          </g>
        )}
        {xLabels.map(({ idx, label }) => (
          <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 8} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{label}</text>
        ))}
      </svg>
    </div>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
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

function formatShortMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function pickXLabels(points: NetWorthPoint[], range: Range): Array<{ idx: number; label: string }> {
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
