import { ComponentType, ReactElement } from 'react';
import {
  Check,
  Target, Shield, Home as HomeIcon, Plane, Car, Heart,
  GraduationCap, Hammer, Sparkles, Palmtree, CreditCard, Wallet, Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils';

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
// Goal category → Bright accent color
// ---------------------------------------------------------------------------

// Mirrors the goals list page's `goalAccent` mapping so a goal reads with the
// same accent on the list card and its detail page. Returns a CSS color string
// (a --ui viz token, or the brand green for safety nets) so light/dark adapt
// automatically. The goal name is folded in because category strings are coarse
// (a "New car fund" is stored as category "savings").
export function goalColor(category: string, name = ''): string {
  const c = `${category ?? ''} ${name}`.toLowerCase();
  if (c.includes('emergency') || c.includes('safety')) return 'rgb(var(--ui-brand))';
  if (c.includes('home') || c.includes('house') || c.includes('down_payment')) return 'var(--ui-viz-2)';
  if (c.includes('retire')) return 'var(--ui-viz-1)';
  if (c.includes('educat') || c.includes('529')) return 'var(--ui-viz-6)';
  if (c.includes('travel') || c.includes('vacation') || c.includes('relocation')) return 'var(--ui-viz-5)';
  if (c.includes('car') || c.includes('vehicle') || c.includes('transport')) return 'var(--ui-viz-3)';
  if (c.includes('wedding') || c.includes('life')) return 'var(--ui-viz-4)';
  if (c.includes('debt')) return 'var(--ui-viz-7)';
  if (c.includes('repair') || c.includes('major')) return 'var(--ui-viz-3)';
  return 'var(--ui-viz-2)';
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
    <div className="flex flex-wrap gap-2">
      {accounts.map((acct) => {
        const active = selected.includes(acct.id);
        return (
          <button
            key={acct.id}
            type="button"
            onClick={() => onToggle(acct.id)}
            aria-pressed={active}
            className={cn(
              'ui-focus inline-flex min-h-touch items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-[background-color,border-color,color]',
              active
                ? 'border-brand bg-brand-soft text-[rgb(var(--ui-brand-ink))]'
                : 'border-line bg-panel text-content-secondary hover:border-line-strong hover:text-content',
            )}
          >
            {active && <Check size={13} strokeWidth={3} className="shrink-0" />}
            <span className="max-w-[180px] truncate">{acct.name}</span>
            <span className="ui-tnum text-[11.5px] font-medium text-content-muted">
              {acct.mask ? `••${acct.mask} ` : ''}{formatCurrency(parseFloat(acct.balance ?? '0'))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
