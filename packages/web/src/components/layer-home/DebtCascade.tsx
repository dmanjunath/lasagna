import { useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Landmark, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { MockDebt, CascadeDebt } from './types';
import { calculateCascade, formatDateShort } from './layer-mocks';

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: 'var(--lf-paper)',
    border: '1px solid var(--lf-rule)',
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

// ── DebtCascade ───────────────────────────────────────────────────────────────

interface DebtCascadeProps {
  debts: MockDebt[];
  extraPayment?: number;
  primaryColor?: string;
}

export function DebtCascade({ debts, extraPayment = 0, primaryColor = 'var(--lf-sauce)' }: DebtCascadeProps) {
  const [strategy, setStrategy] = useState<'avalanche' | 'snowball'>('avalanche');
  const [expanded, setExpanded] = useState(true);

  const highRateDebts = debts.filter((d) => d.apr > 8);
  if (highRateDebts.length === 0) return null;

  const cascade = calculateCascade(highRateDebts, strategy, extraPayment);
  const totalInterest = cascade.reduce((s, d) => s + d.totalInterest, 0);
  const debtFreeDate = cascade.length > 0 ? cascade[cascade.length - 1].payoffDate : new Date();
  const totalMonths = cascade.length > 0 ? cascade[cascade.length - 1].monthsToPayoff : 0;

  return (
    <div style={{ ...S.card, overflow: 'hidden', marginBottom: 20 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 22px',
          borderBottom: expanded ? '1px solid var(--lf-rule)' : 'none',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ ...S.eyebrow, margin: 0 }}>Debt Cascade · {strategy}</div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: 'var(--lf-basil)',
              background: 'rgba(90,107,63,0.1)',
              padding: '3px 8px',
              borderRadius: 20,
            }}
          >
            {fmt(totalInterest)} interest
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)' }}>
            Free {formatDateShort(debtFreeDate)}
          </span>
          {expanded ? <ChevronUp size={16} color="var(--lf-muted)" /> : <ChevronDown size={16} color="var(--lf-muted)" />}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '20px 22px' }}>
          {/* Strategy toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button
              onClick={() => setStrategy('avalanche')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: strategy === 'avalanche' ? `1.5px solid ${primaryColor}` : '1.5px solid var(--lf-rule)',
                background: strategy === 'avalanche' ? 'rgba(201,84,58,0.06)' : 'transparent',
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                color: strategy === 'avalanche' ? primaryColor : 'var(--lf-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Avalanche (highest APR)
            </button>
            <button
              onClick={() => setStrategy('snowball')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: strategy === 'snowball' ? `1.5px solid ${primaryColor}` : '1.5px solid var(--lf-rule)',
                background: strategy === 'snowball' ? 'rgba(201,84,58,0.06)' : 'transparent',
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                color: strategy === 'snowball' ? primaryColor : 'var(--lf-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Snowball (smallest balance)
            </button>
          </div>

          {/* Waterfall visualization */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {cascade.map((debt, i) => (
              <CascadeRow
                key={debt.id}
                debt={debt}
                index={i}
                isLast={i === cascade.length - 1}
                primaryColor={primaryColor}
              />
            ))}
          </div>

          {/* Summary line */}
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px dashed var(--lf-rule)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--lf-muted)' }}>
              {cascade.length} debts · {totalMonths < 999 ? `${totalMonths} months` : 'never at minimum'}
            </div>
            <div style={{ display: 'flex', gap: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              <span style={{ color: 'var(--lf-muted)' }}>
                Total interest: <strong style={{ color: primaryColor }}>{fmt(totalInterest)}</strong>
              </span>
              <span style={{ color: 'var(--lf-muted)' }}>
                Debt-free: <strong style={{ color: 'var(--lf-basil)' }}>{formatDateShort(debtFreeDate)}</strong>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CascadeRow ────────────────────────────────────────────────────────────────

function CascadeRow({
  debt,
  index,
  isLast,
  primaryColor,
}: {
  debt: CascadeDebt;
  index: number;
  isLast: boolean;
  primaryColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  const pct = Math.min(100, Math.max(5, (debt.suggestedPayment / (debt.balance * 0.05 + debt.suggestedPayment)) * 100));

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        background: index === 0 ? 'rgba(201,84,58,0.03)' : 'var(--lf-cream)',
        border: '1px solid var(--lf-rule)',
        borderRadius: 12,
        transition: 'background 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Rank */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          fontWeight: 600,
          background: index === 0 ? 'rgba(201,84,58,0.12)' : 'var(--lf-paper)',
          color: index === 0 ? primaryColor : 'var(--lf-muted)',
          border: index === 0 ? `1px solid rgba(201,84,58,0.2)` : '1px solid var(--lf-rule)',
        }}
      >
        {index + 1}
      </div>

      {/* Icon */}
      <div style={{ flexShrink: 0, color: 'var(--lf-muted)' }}>
        {debt.type === 'credit' ? <CreditCard size={18} /> : <Landmark size={18} />}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--lf-ink)' }}>{debt.name}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)' }}>
            {debt.apr}% APR · {fmt(debt.balance)}
          </span>
        </div>

        {/* Payment bar */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--lf-cream-deep)', borderRadius: 3, overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, delay: index * 0.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ height: '100%', background: index === 0 ? primaryColor : 'var(--lf-cheese)', borderRadius: 3 }}
            />
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-ink)', whiteSpace: 'nowrap' }}>
            {fmt(debt.suggestedPayment)}/mo
          </span>
        </div>

        {/* Rollover annotation */}
        {hovered && !isLast && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--lf-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ArrowRight size={12} />
            When paid off, roll {fmt(debt.rolledOverAmount)}/mo into next debt
          </motion.div>
        )}
      </div>

      {/* Payoff date */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-basil)' }}>
          {debt.monthsToPayoff < 999 ? `${debt.monthsToPayoff} mo` : '∞'}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', marginTop: 2 }}>
          {formatDateShort(debt.payoffDate)}
        </div>
      </div>
    </motion.div>
  );
}
