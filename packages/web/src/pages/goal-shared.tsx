import { ComponentType, ReactElement, useState } from 'react';
import {
  Check, Search,
  Target, Shield, Home as HomeIcon, Plane, Car, Heart,
  GraduationCap, Hammer, Sparkles, Palmtree, CreditCard, Wallet, Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Input, SegmentedControl } from '../components/uikit';
import { faviconUrl, institutionDomainFor } from '../components/ds/institutions';

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

// Goals created before the registry stored emoji in `goal.icon` — map the
// known ones so old goals keep distinct glyphs instead of all collapsing to
// the generic Target.
const LEGACY_EMOJI_ICONS: Record<string, IconKey> = {
  '🛡️': 'shield', '🛡': 'shield',
  '🏠': 'home', '🏡': 'home',
  '✈️': 'plane', '✈': 'plane',
  '🏖️': 'palmtree', '🏖': 'palmtree', '🌴': 'palmtree',
  '🚗': 'car',
  '🎓': 'graduationCap',
  '💍': 'heart', '❤️': 'heart', '👶': 'heart',
  '🔧': 'wrench', '🔨': 'hammer',
  '💳': 'creditCard',
  '💰': 'wallet', '💵': 'wallet',
  '✨': 'sparkles', '💪': 'target', '🎯': 'target',
};

export function iconFor(key: string | null | undefined, size = 20): ReactElement {
  const resolved = key && (ICON_REGISTRY[key as IconKey] ? key : LEGACY_EMOJI_ICONS[key]);
  const Cmp = (resolved && ICON_REGISTRY[resolved as IconKey]) || Target;
  return <Cmp size={size} />;
}

// Toggle membership of an id in a string array.
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// ---------------------------------------------------------------------------
// AccountPicker
// ---------------------------------------------------------------------------

export interface AccountPickerProps {
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    type: string;
    balance: string | null;
    institutionId?: string | null;
    institutionName?: string | null;
  }>;
  selected: string[];
  onToggle: (id: string) => void;
}

const PICKER_TYPE_LABELS: Record<string, string> = {
  depository: 'Cash',
  investment: 'Investments',
};

// Institution brand icon for an account row — favicon when the institution is
// known, wallet glyph for manual accounts, monogram otherwise. Mirrors the
// Accounts page's InstIcon. Shared by the picker and the linked-accounts list.
export function InstitutionIcon({ institutionId, institutionName, size = 28 }: {
  institutionId?: string | null;
  institutionName?: string | null;
  size?: number;
}) {
  const manual = institutionId === 'manual' || !institutionName;
  const url = manual ? null : faviconUrl(institutionDomainFor(institutionName), 64);
  const [err, setErr] = useState(false);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center overflow-hidden rounded-ui-sm border border-line bg-canvas-sunken text-[11px] font-bold text-content-secondary"
      style={{ width: size, height: size }}
    >
      {url && !err ? (
        <img
          src={url}
          alt=""
          className="rounded-[4px]"
          style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
          onError={() => setErr(true)}
        />
      ) : manual ? (
        <Wallet size={Math.round(size * 0.46)} className="text-content-muted" />
      ) : (
        (institutionName || '?').trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

// Shared account picker — reused by the create form and the per-goal
// "edit linked accounts" inline editor. Full-width rows (whole name visible,
// balance right-aligned) with search and a type filter, so the right account
// is findable even across many similarly-named ones.
export function AccountPicker({ accounts, selected, onToggle }: AccountPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  // Pin the accounts that were linked when the picker OPENED — live-sorting on
  // toggle would make rows jump under the user's finger.
  const [pinnedIds] = useState(() => new Set(selected));

  const types = [...new Set(accounts.map((a) => a.type))];
  const q = query.trim().toLowerCase();
  const visible = accounts
    .filter(
      (a) =>
        (typeFilter === 'all' || a.type === typeFilter) &&
        (!q || a.name.toLowerCase().includes(q) || (a.mask ?? '').includes(q)),
    )
    // Already-linked first (so they're visible, not buried), then biggest
    // funding sources — goals are usually backed by the large ones.
    .sort(
      (a, b) =>
        Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) ||
        parseFloat(b.balance ?? '0') - parseFloat(a.balance ?? '0'),
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="w-full sm:w-[240px]">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            aria-label="Search accounts"
            leadingIcon={<Search className="h-3.5 w-3.5" />}
          />
        </div>
        {types.length > 1 && (
          <SegmentedControl
            size="sm"
            stretch={false}
            aria-label="Filter by account type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All' },
              ...types.map((t) => ({ value: t, label: PICKER_TYPE_LABELS[t] ?? t })),
            ]}
          />
        )}
        {selected.length > 0 && (
          <span className="ml-auto text-[12.5px] font-semibold text-content-muted ui-tnum">
            {selected.length} selected
          </span>
        )}
      </div>

      <div className="mt-3 max-h-[340px] overflow-y-auto rounded-ui-lg border border-line">
        {visible.map((acct) => {
          const active = selected.includes(acct.id);
          return (
            <button
              key={acct.id}
              type="button"
              onClick={() => onToggle(acct.id)}
              aria-pressed={active}
              className={cn(
                'ui-focus flex w-full items-center gap-3 border-t border-line px-3.5 py-2.5 text-left transition-colors first:border-t-0',
                active ? 'bg-brand-softer' : 'hover:bg-canvas-sunken/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                  active ? 'border-brand bg-brand text-white' : 'border-line-strong bg-panel',
                )}
              >
                {active && <Check size={12} strokeWidth={3.5} />}
              </span>
              <InstitutionIcon institutionId={acct.institutionId} institutionName={acct.institutionName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold leading-tight" title={acct.name}>
                  {acct.name}
                </span>
                <span className="mt-0.5 block text-[12px] text-content-muted">
                  {PICKER_TYPE_LABELS[acct.type] ?? acct.type}
                  {acct.mask && (
                    <>
                      {' '}· <span className="ui-tnum">••{acct.mask}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-editorial text-[14px] font-extrabold tracking-[-0.015em] ui-tnum">
                {formatCurrency(parseFloat(acct.balance ?? '0'))}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3.5 py-5 text-center text-[12.5px] text-content-muted">
            No accounts match your search.
          </p>
        )}
      </div>
    </div>
  );
}
