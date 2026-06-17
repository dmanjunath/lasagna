import { ComponentType, ReactElement } from 'react';
import {
  Check,
  Target, Shield, Home as HomeIcon, Plane, Car, Heart,
  GraduationCap, Hammer, Sparkles, Palmtree, CreditCard, Wallet, Wrench,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared goal helpers — used by the goals list page and the savings-goal
// detail page so both stay in sync (colors, icons, currency, account chips).
// ---------------------------------------------------------------------------

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Goal category → LasagnaFi color
// ---------------------------------------------------------------------------

export function goalColor(category: string): string {
  const c = category?.toLowerCase() ?? '';
  if (c === 'home_purchase' || c === 'house' || c === 'home' || c.includes('down_payment') || c.includes('house')) return 'var(--lf-sauce)';
  if (c === 'emergency_fund' || c === 'safety' || c.includes('emergency')) return 'var(--lf-basil)';
  if (c === 'vacation' || c === 'travel' || c === 'relocation' || c.includes('travel') || c.includes('vacation')) return 'var(--lf-cheese)';
  if (c === 'car' || c === 'vehicle' || c === 'transport' || c.includes('car')) return 'var(--lf-crust)';
  if (c === 'wedding' || c === 'life_event' || c === 'life' || c.includes('wedding')) return 'var(--lf-burgundy)';
  if (c === 'home_repair' || c === 'major_purchase' || c.includes('repair') || c.includes('major')) return 'var(--lf-crust)';
  if (c === 'education' || c === 'retirement' || c.includes('education') || c.includes('retirement')) return 'var(--lf-noodle)';
  if (c === 'debt_payoff' || c.includes('debt')) return 'var(--lf-muted)';
  return 'var(--lf-muted)';
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

// Lucide icon registry — neutral monochrome glyphs replace emoji per iter 2
// critic. Stored as a stable string key so we can persist the choice (still
// `goal.icon: string`) but render a real SVG via `iconFor()`.
export type IconKey =
  | 'shield' | 'home' | 'plane' | 'car' | 'heart' | 'graduationCap'
  | 'wrench' | 'sparkles' | 'palmtree' | 'creditCard' | 'wallet'
  | 'target' | 'hammer';

const ICON_REGISTRY: Record<IconKey, ComponentType<{ size?: number; className?: string }>> = {
  shield: Shield, home: HomeIcon, plane: Plane, car: Car, heart: Heart,
  graduationCap: GraduationCap, wrench: Wrench, sparkles: Sparkles,
  palmtree: Palmtree, creditCard: CreditCard, wallet: Wallet,
  target: Target, hammer: Hammer,
};

export function iconFor(key: string | null | undefined, size = 20): ReactElement {
  const Cmp = (key && ICON_REGISTRY[key as IconKey]) || Target;
  return <Cmp size={size} />;
}

// Toggle membership of an id in a string array.
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// ---------------------------------------------------------------------------
// AccountChips
// ---------------------------------------------------------------------------

export interface AccountChipsProps {
  accounts: Array<{ id: string; name: string; mask: string | null; balance: string | null }>;
  selected: string[];
  onToggle: (id: string) => void;
}

// Shared account toggle-chip list — reused by the create form and the
// per-goal "edit linked accounts" inline editor.
export function AccountChips({ accounts, selected, onToggle }: AccountChipsProps): ReactElement {
  return (
    <div className="goals-presets">
      {accounts.map((acct) => {
        const active = selected.includes(acct.id);
        return (
          <button
            key={acct.id}
            type="button"
            onClick={() => onToggle(acct.id)}
            className="goals-preset"
            style={{
              borderColor: active ? 'var(--lf-basil)' : 'var(--lf-rule)',
              color: active ? 'var(--lf-basil)' : 'var(--lf-muted)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {active && <Check size={12} />}
            <span style={{
              maxWidth: 200, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {acct.name}
            </span>
            <span style={{ color: 'var(--lf-muted)', fontSize: 11 }}>
              {acct.mask ? `••${acct.mask} ` : ''}{formatCurrency(parseFloat(acct.balance ?? '0'))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
