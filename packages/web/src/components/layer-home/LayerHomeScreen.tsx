import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, PiggyBank, Sprout, TrendingUp, Rocket,
  Layers, ChevronDown, ChevronUp, ArrowRight, Zap,
} from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';
import { formatRelativeTime } from '../../lib/utils';
import type { PriorityStep, PrioritySummary, MockInsight, MockDebt } from './types';
import {
  getPrimaryLayer,
  getSecondaryLayers,
  getNextLayer,
  isDebtUser,
  isFireUser,
  formatDateShort,
} from './layer-mocks';
import { DebtCascade } from './DebtCascade';

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: 'var(--lf-paper)',
    border: '1px solid var(--lf-rule)',
    borderRadius: 14,
  } as React.CSSProperties,
  darkCard: {
    background: 'var(--lf-ink)',
    color: 'var(--lf-paper)',
    borderRadius: 14,
  } as React.CSSProperties,
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--lf-muted)',
  } as React.CSSProperties,
  serif: {
    fontFamily: "'Instrument Serif', Georgia, serif",
  } as React.CSSProperties,
};

function fmt(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtK(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return fmt(value);
}

// ── Layer color map (matches financial-level.tsx) ────────────────────────────

const LAYER_COLORS = [
  { bg: '#B83B3B', text: '#fff' },     // 1
  { bg: '#C25030', text: '#fff' },     // 2
  { bg: '#C46425', text: '#fff' },     // 3
  { bg: '#B87A1E', text: '#fff' },     // 4
  { bg: '#8B7A22', text: '#fff' },     // 5
  { bg: '#5E7A28', text: '#fff' },     // 6
  { bg: '#3D7A35', text: '#fff' },     // 7
  { bg: '#2D7040', text: '#fff' },     // 8
  { bg: '#25664A', text: '#fff' },     // 9
  { bg: '#1E5C50', text: '#fff' },     // 10
  { bg: '#185248', text: '#fff' },     // 11
  { bg: '#134840', text: '#fff' },     // 12
];

function layerColor(order: number): string {
  return LAYER_COLORS[order - 1]?.bg ?? '#7A5C3F';
}

function layerIcon(order: number) {
  if (order <= 3) return Flame;
  if (order <= 5) return PiggyBank;
  if (order <= 8) return Sprout;
  if (order <= 10) return TrendingUp;
  if (order === 11) return Rocket;
  return Layers;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({
  data,
  color = 'var(--lf-cheese)',
  height = 130,
  strokeWidth = 2,
  onHover,
}: {
  data: Array<{ value: number; date?: string }>;
  color?: string;
  height?: number;
  strokeWidth?: number;
  onHover?: (index: number | null, value: number | null, date: string | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(480);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgWidth(el.clientWidth || 480));
    ro.observe(el);
    setSvgWidth(el.clientWidth || 480);
    return () => ro.disconnect();
  }, []);

  const values = data.map(d => d.value);
  const dates = data.map(d => (d as { value: number; date?: string }).date || '');
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;

  const PL = 62, PB = 24, PT = 6, PR = 8;
  const W = svgWidth;
  const H = height + PT + PB;
  const PW = W - PL - PR;

  const pts = values.map((v, i) => [
    PL + (i / Math.max(values.length - 1, 1)) * PW,
    PT + height - ((v - min) / range) * height,
  ]);
  const pathD = 'M ' + pts.map(p => p.join(',')).join(' L ');
  const fillD = pathD + ` L ${PL + PW},${PT + height} L ${PL},${PT + height} Z`;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const plotX = svgX - PL;
    const rawIdx = Math.round((plotX / PW) * (values.length - 1));
    const idx = Math.max(0, Math.min(values.length - 1, rawIdx));
    setHoverIdx(idx);
    if (onHover) {
      onHover(idx, values[idx], dates[idx] || null);
    }
  }, [values.length, PW, values, dates, onHover]);

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
    if (onHover) {
      onHover(null, null, null);
    }
  }, [onHover]);

  const fmtV = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`;

  const hx = hoverIdx !== null ? pts[hoverIdx][0] : null;
  const hy = hoverIdx !== null ? pts[hoverIdx][1] : null;
  const hv = hoverIdx !== null ? values[hoverIdx] : null;
  const hd = hoverIdx !== null && dates[hoverIdx] ? new Date(dates[hoverIdx]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const mid = (max + min) / 2;

  const firstDateStr = dates[0] ? new Date(dates[0]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const lastDateStr = dates[dates.length - 1] ? new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';

  const axisColor = '#7A5C3F';

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
      <svg width={W} height={H} style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PL} y1={PT} x2={PL + PW} y2={PT} stroke={axisColor} strokeWidth={0.5} opacity={0.35} />
        <line x1={PL} y1={PT + height / 2} x2={PL + PW} y2={PT + height / 2} stroke={axisColor} strokeWidth={0.5} opacity={0.25} strokeDasharray="4 4" />
        <line x1={PL} y1={PT + height} x2={PL + PW} y2={PT + height} stroke={axisColor} strokeWidth={0.5} opacity={0.35} />
        <text x={PL - 6} y={PT + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor}>{fmtV(max)}</text>
        <text x={PL - 6} y={PT + height / 2 + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.8}>{fmtV(mid)}</text>
        <text x={PL - 6} y={PT + height + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor}>{fmtV(min)}</text>
        <path d={fillD} fill="url(#sparkGrad)" />
        <path d={pathD} stroke={color} strokeWidth={strokeWidth} fill="none" />
        {hx !== null && hy !== null && hv !== null && (
          <g>
            <line x1={hx} x2={hx} y1={PT} y2={PT + height} stroke={color} strokeWidth={1} opacity={0.4} />
            <circle cx={hx} cy={hy} r={4} fill={color} />
            <rect x={Math.max(PL, Math.min(hx - 56, PL + PW - 120))} y={Math.max(PT, hy - 42)} width={120} height={38} rx={4} fill="rgba(30,30,30,0.92)" />
            {hd && (
              <text x={Math.max(PL, Math.min(hx - 56, PL + PW - 120)) + 8} y={Math.max(PT, hy - 42) + 14} fontFamily="'JetBrains Mono', monospace" fontSize={11} fill="#D4C6B0" opacity={0.9}>{hd}</text>
            )}
            <text x={Math.max(PL, Math.min(hx - 56, PL + PW - 120)) + 8} y={Math.max(PT, hy - 42) + 30} fontFamily="'JetBrains Mono', monospace" fontSize={13} fill="#FBF6EC">{fmtV(hv)}</text>
          </g>
        )}
        {firstDateStr && <text x={PL} y={H - 4} textAnchor="start" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.8}>{firstDateStr}</text>}
        {lastDateStr && <text x={PL + PW} y={H - 4} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.8}>{lastDateStr}</text>}
      </svg>
    </div>
  );
}

// ── DonutMini ─────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  income:             'var(--lf-pos)',
  housing:            'var(--lf-sauce)',
  transportation:     'var(--lf-basil)',
  food_dining:        'var(--lf-cheese)',
  groceries:          '#D4B053',
  utilities:          'var(--lf-burgundy)',
  healthcare:         '#A68965',
  insurance:          'var(--lf-crust)',
  entertainment:      'var(--lf-noodle)',
  shopping:           '#8B6B45',
  subscriptions:      '#6B5040',
  savings_investment: 'var(--lf-pos)',
  debt_payment:       'var(--lf-sauce-deep)',
  transfer:           '#8B7E6F',
  other:              '#7A5C3F',
};

function DonutMini({ cats, totalLabel }: {
  cats: Array<{ name: string; total: number; color: string }>;
  totalLabel: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = cats.reduce((s, c) => s + c.total, 0) || 1;
  const r = 34, R = 52, cx = 60, cy = 60;
  let a0 = -Math.PI / 2;
  const slicedCats = cats.slice(0, 8);
  const paths = slicedCats.map((c, idx) => {
    const frac = c.total / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { d, color: c.color, name: c.name, pct: Math.round(frac * 100), idx };
  });
  const hp = hovered !== null ? paths[hovered] : null;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ cursor: 'pointer', flexShrink: 0 }}>
      {paths.map((p) => (
        <path key={p.idx} d={p.d} fill={p.color}
          opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.4}
          style={{ transition: 'opacity 0.15s' }}
          onMouseEnter={() => setHovered(p.idx)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => setHovered(hovered === p.idx ? null : p.idx)}
        />
      ))}
      {hp ? (
        <>
          <text x="60" y="54" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="9" fill="var(--lf-muted)">{hp.name.slice(0, 10)}</text>
          <text x="60" y="66" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="14" fill="var(--lf-ink)">{hp.pct}%</text>
        </>
      ) : (
        <>
          <text x="60" y="58" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="15" fill="var(--lf-ink)">{totalLabel}</text>
          <text x="60" y="72" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="var(--lf-muted)">monthly</text>
        </>
      )}
    </svg>
  );
}

// ── HealthRing ──────────────────────────────────────────────────────────────

function HealthRing({ score, color, size = 40 }: { score: number; color: string; size?: number }) {
  const R = (size / 2) - 4;
  const C = 2 * Math.PI * R;
  const off = C * (1 - score / 100);
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={R} stroke="var(--lf-cream)" strokeWidth="4" fill="none" />
      <circle cx={cx} cy={cy} r={R} stroke={color} strokeWidth="4" fill="none"
        strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x={cx} y={cy + 3} textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize={size > 44 ? 14 : 11} fill="var(--lf-ink)">{score}</text>
    </svg>
  );
}

// ── LayerHomeScreen ─────────────────────────────────────────────────────────

interface LayerHomeScreenProps {
  steps: PriorityStep[];
  summary: PrioritySummary;
  insights: MockInsight[];
  debts: MockDebt[];
  netWorth?: number | null;
  netWorthChange?: number | null;
  netWorthHistory?: Array<{ date: string; value: number }>;
  totalAssets?: number;
  totalLiabilities?: number;
  healthScore?: { score: number; grade: string; color: string } | null;
  spendingCategories?: Array<{ category: string; total: number; count: number; percentage: number }>;
  totalSpending?: number;
  totalIncome?: number;
  lastActionsGeneratedAt?: Date | null;
  onCompleteStep?: (stepId: string, note?: string) => void;
  onSkipStep?: (stepId: string, skipped: boolean) => void;
  onNavigate?: (path: string) => void;
  greeting?: string;
}

export function LayerHomeScreen({
  steps,
  summary,
  insights,
  debts,
  netWorth,
  netWorthChange,
  netWorthHistory,
  totalAssets,
  totalLiabilities,
  healthScore,
  spendingCategories = [],
  totalSpending = 0,
  totalIncome = 0,
  lastActionsGeneratedAt,
  onNavigate,
  greeting = 'Good evening',
}: LayerHomeScreenProps) {
  const [, navigate] = useLocation();
  const { openChat } = useChatStore();
  const [secondaryExpanded, setSecondaryExpanded] = useState(false);

  // Net worth hover state
  const [hoveredNwValue, setHoveredNwValue] = useState<number | null>(null);
  const [hoveredNwDate, setHoveredNwDate] = useState<string | null>(null);

  const primaryLayer = useMemo(() => getPrimaryLayer(steps), [steps]);
  const secondaryLayers = useMemo(() => getSecondaryLayers(steps), [steps]);
  const nextLayer = useMemo(
    () => (primaryLayer ? getNextLayer(steps, primaryLayer.id) : null),
    [steps, primaryLayer]
  );
  const debtUser = useMemo(() => isDebtUser(steps), [steps]);
  const fireUser = useMemo(() => isFireUser(steps), [steps]);

  const filteredInsights = useMemo(() => {
    if (!primaryLayer) return insights;
    const currentOrder = primaryLayer.order;
    return insights.filter((i) => {
      const insightOrder = steps.find((s) => s.id === i.layerId)?.order ?? 0;
      return Math.abs(insightOrder - currentOrder) <= 1;
    });
  }, [insights, primaryLayer, steps]);

  // Fallback insights = any non-filtered insights if filtered is empty
  const displayInsights = filteredInsights.length > 0
    ? filteredInsights
    : insights;

  const handleNav = (path: string) => {
    if (onNavigate) onNavigate(path);
    else navigate(path);
  };

  const handleSparklineHover = useCallback((idx: number | null, value: number | null, date: string | null) => {
    setHoveredNwValue(value);
    setHoveredNwDate(date);
  }, []);

  if (!primaryLayer) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 40px)', maxWidth: 1200, margin: '0 auto' }}>
        <AllCompleteView summary={summary} />
      </div>
    );
  }

  const color = layerColor(primaryLayer.order);
  const Icon = layerIcon(primaryLayer.order);

  // Debt-free countdown calc
  const highRateDebts = debts.filter((d) => d.apr > 8);
  const totalMinPayment = highRateDebts.reduce((s, d) => s + d.minPayment, 0);
  const debtFreeMonths =
    summary.monthlySurplus && summary.monthlySurplus > 0
      ? Math.ceil(
          highRateDebts.reduce((s, d) => s + d.balance, 0) / (totalMinPayment + summary.monthlySurplus)
        )
      : null;
  const debtFreeDate = debtFreeMonths
    ? formatDateShort(new Date(Date.now() + debtFreeMonths * 30 * 24 * 60 * 60 * 1000))
    : null;

  // Savings rate
  const savingsRate =
    summary.monthlyIncome > 0 && summary.monthlySurplus !== null
      ? Math.round((summary.monthlySurplus / summary.monthlyIncome) * 100)
      : null;

  // FI number and date
  const annualExpenses = (summary.monthlyExpenses ?? summary.monthlyIncome * 0.7) * 12;
  const fiNumber = annualExpenses * 25;
  const fiProgress = fiNumber > 0 ? Math.min(100, Math.round((summary.totalInvested / fiNumber) * 100)) : 0;

  // Net worth helpers
  const hasNetWorthData = netWorth !== null && netWorth !== undefined;
  const displayNetWorth = hoveredNwValue !== null ? hoveredNwValue : netWorth;
  const displayNetWorthDate = hoveredNwDate !== null ? hoveredNwDate : null;

  const nwChangeSign = netWorthChange !== null && netWorthChange !== undefined ? (netWorthChange >= 0 ? '+' : '') : '';
  const nwChangePct = (netWorthChange !== null && netWorthChange !== undefined && netWorth != null && netWorth !== 0)
    ? ` · ${nwChangeSign}${((netWorthChange / Math.abs(netWorth - netWorthChange)) * 100).toFixed(1)}% MoM`
    : '';

  // Monthly spend helpers
  const spendCatsForDonut = useMemo(() =>
    (spendingCategories || []).map(c => ({
      name: c.category,
      total: c.total,
      color: CAT_COLORS[c.category] || '#7A5C3F',
    })),
    [spendingCategories]
  );

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 40px)', paddingBottom: 'clamp(80px, 10vw, 48px)', maxWidth: 1200, margin: '0 auto' }}>
      <style>{`
        @media (max-width: 900px) {
          .layer-hero-grid { grid-template-columns: 1fr !important; }
          .layer-networth-grid { grid-template-columns: 1fr !important; }
          .layer-bottom-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, fontWeight: 400, margin: 0 }}>
            Your Focus
          </h1>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginTop: 6 }}>
            {greeting} · {displayInsights.length} insight{displayInsights.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Health Score */}
          {healthScore && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <HealthRing score={healthScore.score} color={healthScore.color} size={44} />
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lf-muted)' }}>
                  Health
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: healthScore.color }}>
                  {healthScore.score} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--lf-muted)' }}>{healthScore.grade}</span>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleNav('/financial-level')}
              style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)', color: 'var(--lf-ink)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              View all layers
            </button>
            <button
              onClick={() => openChat(`I'm on Layer ${primaryLayer.order}: ${primaryLayer.title}. What should I focus on right now?`)}
              style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid var(--lf-ink)', background: 'var(--lf-ink)', color: 'var(--lf-paper)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              Walk me through this →
            </button>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════
          1. HERO: Current Layer + Insights & Actions
         ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        style={{ ...S.darkCard, padding: 'clamp(24px, 4vw, 40px)', marginBottom: 20 }}
      >
        <div className="layer-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 32, alignItems: 'start' }}>
          {/* LEFT: Layer identity */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={22} color="#fff" />
              </div>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)' }}>
                  Layer {primaryLayer.order} · Current focus
                </div>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 'clamp(28px, 5vw, 40px)', lineHeight: 1.1, color: 'var(--lf-paper)', marginTop: 2 }}>
                  {primaryLayer.title}
                </div>
              </div>
            </div>

            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#D4C6B0', maxWidth: 480, margin: '0 0 20px' }}>
              {primaryLayer.description || primaryLayer.subtitle}
            </p>

            {/* Progress bar */}
            {primaryLayer.target !== null && primaryLayer.current !== null && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-cheese)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Progress
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: color }}>
                    {primaryLayer.progress}% · {fmt(primaryLayer.current)} of {fmt(primaryLayer.target)}
                  </span>
                </div>
                <div style={{ height: 6, background: 'rgba(251,246,236,0.12)', borderRadius: 3, overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${primaryLayer.progress}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    style={{ height: '100%', background: color, borderRadius: 3 }}
                  />
                </div>
              </div>
            )}

            {/* Debt-specific countdown */}
            {debtUser && debtFreeDate && (
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Zap size={16} color="var(--lf-cheese)" />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)' }}>
                  {debtFreeMonths} months to debt-free · {debtFreeDate}
                </span>
              </div>
            )}

            {/* FIRE-specific stats */}
            {fireUser && savingsRate !== null && (
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUp size={16} color="var(--lf-cheese)" />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)' }}>
                    {savingsRate}% savings rate
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Rocket size={16} color="var(--lf-basil)" />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-basil)' }}>
                    {fiProgress}% to FI · {fmt(fiNumber)}
                  </span>
                </div>
              </div>
            )}

            {/* Next layer preview */}
            {nextLayer && (
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(251,246,236,0.04)', borderRadius: 10 }}>
                <ArrowRight size={14} color="#D4C6B0" />
                <span style={{ fontSize: 13, color: '#D4C6B0' }}>
                  When you complete this, you unlock: <strong style={{ color: 'var(--lf-paper)' }}>{nextLayer.title}</strong>
                </span>
              </div>
            )}
          </div>

          {/* RIGHT: Insights & Actions */}
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 12 }}>
              Insights & Actions
            </div>

            {/* Last generated timestamp */}
            {lastActionsGeneratedAt && (
              <div style={{ fontSize: 11, color: 'var(--lf-muted)', marginBottom: 10 }}>
                Last updated {formatRelativeTime(lastActionsGeneratedAt)}
              </div>
            )}

            {displayInsights.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {displayInsights.slice(0, 3).map((insight, i) => (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
                    onClick={() => handleNav('/insights')}
                    style={{
                      background: 'rgba(251,246,236,0.06)',
                      border: '1px solid rgba(251,246,236,0.12)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: insight.urgency === 'critical' || insight.urgency === 'high' ? 'var(--lf-sauce)' : insight.urgency === 'medium' ? 'var(--lf-cheese)' : 'var(--lf-basil)',
                        flexShrink: 0, marginTop: 5,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--lf-paper)', lineHeight: 1.4 }}>
                          {insight.title}
                        </div>
                        <div style={{ fontSize: 12, color: '#D4C6B0', marginTop: 2, lineHeight: 1.4 }}>
                          {insight.actionText || insight.impact}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div style={{
                background: 'rgba(251,246,236,0.06)',
                border: '1px solid rgba(251,246,236,0.12)',
                borderRadius: 10,
                padding: '14px 16px',
              }}>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: '#D4C6B0', margin: 0 }}>
                  {primaryLayer.action || 'Complete this layer to unlock the next phase of your financial journey.'}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--lf-muted)' }}>
                {insights.length > displayInsights.length && `${insights.length - displayInsights.length} hidden (outside layer)`}
              </span>
              <button
                onClick={() => handleNav('/insights')}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-cheese)', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
              >
                All actions →
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════
          2. NET WORTH OVER TIME + METRICS
         ═══════════════════════════════════════════════════════════════════════ */}
      {hasNetWorthData && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          style={{ ...S.card, padding: 'clamp(20px, 4vw, 32px)', marginBottom: 20 }}
        >
          <div className="layer-networth-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.3fr) 1.7fr', gap: 28, alignItems: 'center' }}>
            {/* LEFT: Net worth headline */}
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginBottom: 10 }}>
                {displayNetWorthDate ? displayNetWorthDate : 'Net Worth · live'}
              </div>
              <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 'clamp(40px, 8vw, 72px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: 'var(--lf-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayNetWorth != null ? fmt(displayNetWorth) : '—'}
              </div>
              {netWorthChange !== null && netWorthChange !== undefined && !displayNetWorthDate && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: netWorthChange >= 0 ? 'var(--lf-basil)' : 'var(--lf-sauce)', marginTop: 10 }}>
                  {netWorthChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorthChange))}{nwChangePct}
                </div>
              )}
              {displayNetWorthDate && netWorthHistory && hoveredNwValue !== null && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 10 }}>
                  Hovering historical point
                </div>
              )}
              <div style={{ display: 'flex', gap: 20, marginTop: 18, flexWrap: 'wrap' }}>
                {totalAssets !== undefined && totalAssets > 0 && (
                  <StatMini label="Assets" value={fmt(totalAssets)} />
                )}
                {totalLiabilities !== undefined && totalLiabilities > 0 && (
                  <StatMini label="Liabilities" value={fmt(totalLiabilities)} />
                )}
                <StatMini label="Cash" value={fmt(summary.totalCash)} />
                <StatMini label="Invested" value={fmt(summary.totalInvested)} />
              </div>
            </div>

            {/* RIGHT: Sparkline */}
            <div style={{ minWidth: 0 }}>
              {netWorthHistory && netWorthHistory.length > 1 ? (
                <Sparkline
                  data={netWorthHistory}
                  color="var(--lf-sauce)"
                  height={130}
                  strokeWidth={2}
                  onHover={handleSparklineHover}
                />
              ) : (
                <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lf-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                  Link accounts to see history
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          3. TWO-COLUMN: Debt Cascade (left) + Monthly Spend (right)
         ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.4 }}
        className="layer-bottom-grid"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}
      >
        {/* LEFT: Debt cascade (if debt user) OR Insights + secondary layers (if not) */}
        <div>
          {debtUser && debts.length > 0 ? (
            <DebtCascade
              debts={debts}
              extraPayment={summary.monthlySurplus ?? 0}
              primaryColor={color}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Insights card (shown here when no debt cascade) */}
              <div style={{ ...S.card, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                  <div style={S.eyebrow}>Layer-relevant insights</div>
                  <button onClick={() => handleNav('/insights')} style={{ fontSize: 12, color: 'var(--lf-sauce)', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                    all →
                  </button>
                </div>
                {lastActionsGeneratedAt && (
                  <div style={{ fontSize: 11, color: 'var(--lf-muted)', marginBottom: 10 }}>
                    Last updated {formatRelativeTime(lastActionsGeneratedAt)}
                  </div>
                )}
                {displayInsights.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {displayInsights.slice(0, 3).map((insight, i) => (
                      <InsightRow key={insight.id} insight={insight} index={i} onClick={() => handleNav('/insights')} />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--lf-muted)', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
                    No insights for your current layer.
                  </div>
                )}
              </div>

              {/* Secondary layers */}
              {secondaryLayers.length > 0 && (
                <div style={{ ...S.card, padding: 20 }}>
                  <button
                    onClick={() => setSecondaryExpanded(!secondaryExpanded)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                  >
                    <div style={S.eyebrow}>Also working on · {secondaryLayers.length} layer{secondaryLayers.length !== 1 ? 's' : ''}</div>
                    {secondaryExpanded ? <ChevronUp size={16} color="var(--lf-muted)" /> : <ChevronDown size={16} color="var(--lf-muted)" />}
                  </button>
                  <AnimatePresence>
                    {secondaryExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        {secondaryLayers.map((layer) => (
                          <div
                            key={layer.id}
                            onClick={() => handleNav('/financial-level')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 12px', background: 'var(--lf-cream)',
                              borderRadius: 10, cursor: 'pointer', border: '1px solid var(--lf-rule)',
                            }}
                          >
                            <div style={{
                              width: 28, height: 28, borderRadius: 8,
                              background: layerColor(layer.order),
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0, fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 11, color: '#fff', fontWeight: 600,
                            }}>
                              {layer.order}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--lf-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {layer.title}
                              </div>
                              {layer.action && (
                                <div style={{ fontSize: 12, color: 'var(--lf-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {layer.action}
                                </div>
                              )}
                            </div>
                            {layer.progress > 0 && (
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: layerColor(layer.order) }}>
                                {layer.progress}%
                              </div>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Monthly Spend */}
        <div style={{ ...S.card, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
            <div style={S.eyebrow}>Monthly Spend</div>
            <button onClick={() => handleNav('/spending')} style={{ fontSize: 12, color: 'var(--lf-sauce)', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
              details →
            </button>
          </div>

          {spendCatsForDonut.length > 0 ? (
            <div>
              {/* Donut + total centered */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 }}>
                <DonutMini cats={spendCatsForDonut} totalLabel={totalSpending > 0 ? fmtK(totalSpending) : '$0'} />
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginBottom: 4 }}>
                    Total Spend
                  </div>
                  <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, lineHeight: 1, color: 'var(--lf-ink)' }}>
                    {fmt(totalSpending)}
                  </div>
                  {totalIncome > 0 && (
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: totalSpending > totalIncome ? 'var(--lf-sauce)' : 'var(--lf-basil)', marginTop: 4 }}>
                      {totalSpending > totalIncome ? 'Over budget' : `${Math.round((totalSpending / totalIncome) * 100)}% of income`}
                    </div>
                  )}
                </div>
              </div>

              {/* Category breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {spendCatsForDonut.slice(0, 5).map((c, i) => {
                  const pct = totalSpending > 0 ? Math.round((c.total / totalSpending) * 100) : 0;
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto auto', gap: '8px 12px', alignItems: 'center', padding: '6px 0', borderBottom: i < 4 ? '1px solid var(--lf-cream)' : 'none' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--lf-ink)', fontSize: 13, fontWeight: 500, textTransform: 'capitalize' as const }}>{c.name.replace(/_/g, ' ')}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-ink)' }}>{fmt(c.total)}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Income vs spend mini-bar */}
              {totalIncome > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--lf-rule)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--lf-muted)', marginBottom: 6 }}>
                    <span>Spend <strong style={{ color: 'var(--lf-ink)', fontWeight: 500 }}>{fmt(totalSpending)}</strong></span>
                    <span>Income <strong style={{ color: 'var(--lf-ink)', fontWeight: 500 }}>{fmt(totalIncome)}</strong></span>
                  </div>
                  <div style={{ height: 8, background: 'var(--lf-cream)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, (totalSpending / totalIncome) * 100)}%`,
                      height: '100%',
                      background: totalSpending > totalIncome ? 'var(--lf-sauce)' : 'var(--lf-cheese)',
                      borderRadius: 4,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  {totalSpending > totalIncome && (
                    <div style={{ fontSize: 12, color: 'var(--lf-sauce)', marginTop: 4 }}>
                      ▲ {fmt(totalSpending - totalIncome)} over income
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
              No spending data yet.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── StatMini (for net worth section) ────────────────────────────────────────

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--lf-ink)' }}>
        {value}
      </div>
    </div>
  );
}

// ── InsightRow (for non-debt left column) ─────────────────────────────────────

function InsightRow({ insight, index, onClick }: { insight: MockInsight; index: number; onClick: () => void }) {
  const urgencyColor =
    insight.urgency === 'critical' || insight.urgency === 'high'
      ? 'var(--lf-sauce)'
      : insight.urgency === 'medium'
      ? 'var(--lf-cheese)'
      : 'var(--lf-basil)';

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', background: 'var(--lf-cream)',
        borderRadius: 10, cursor: 'pointer', border: '1px solid var(--lf-rule)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: urgencyColor, flexShrink: 0, marginTop: 6 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--lf-ink)', lineHeight: 1.4 }}>
          {insight.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--lf-muted)', marginTop: 2, lineHeight: 1.4 }}>
          {insight.impact}
        </div>
      </div>
    </motion.div>
  );
}

// ── AllCompleteView ─────────────────────────────────────────────────────────

function AllCompleteView({ summary }: { summary: PrioritySummary }) {
  const { openChat } = useChatStore();
  return (
    <div style={{ textAlign: 'center', padding: '64px 0' }}>
      <Rocket size={48} style={{ color: 'var(--lf-basil)', margin: '0 auto 16px' }} />
      <h2 style={{ ...S.serif, fontSize: 32, color: 'var(--lf-ink)', marginBottom: 8 }}>
        All layers complete
      </h2>
      <p style={{ fontSize: 14, color: 'var(--lf-muted)', maxWidth: 400, margin: '0 auto 24px', lineHeight: 1.6 }}>
        You have completed every layer of the financial independence framework. Your portfolio of {fmt(summary.totalInvested)} sustains your lifestyle.
      </p>
      <button
        onClick={() => openChat('I have completed all 12 financial layers. What should I focus on now?')}
        style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--lf-ink)', color: 'var(--lf-paper)', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
      >
        Walk me through this →
      </button>
    </div>
  );
}
