import { ComponentType, ReactElement, useState } from 'react';
import {
  Check, ChevronDown, Search,
  Target, Shield, Home as HomeIcon, Plane, Car, Heart,
  GraduationCap, Hammer, Sparkles, Palmtree, CreditCard, Wallet, Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../lib/api';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../lib/hide-amounts';
import { Input, MaskedText } from '../components/uikit';
import { faviconUrl, institutionDomainFor } from '../components/ds/institutions';

// ---------------------------------------------------------------------------
// Shared goal helpers — used by the goals list page and the savings-goal
// detail page so both stay in sync (colors, icons, currency, account chips).
// ---------------------------------------------------------------------------

export function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
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

// ---------------------------------------------------------------------------
// Create-goal presets — shared by the goals list page (Suggested tiles) and
// the create-goal page (kind picker), so both offer the same set.
// ---------------------------------------------------------------------------

// A typed category works its own target out from what the user tells it, so it
// carries no suggested number — one would only contradict the form.
export const GOAL_PRESETS: Array<{ name: string; category: string; icon: IconKey; suggestedTarget?: number }> = [
  { name: 'Emergency Fund', category: 'emergency_fund', icon: 'shield' },
  { name: 'Home Purchase', category: 'home_purchase', icon: 'home' },
  { name: 'Vacation / Travel', category: 'vacation', icon: 'plane', suggestedTarget: 5000 },
  { name: 'Vehicle Purchase', category: 'car', icon: 'car' },
  { name: 'Wedding Fund', category: 'wedding', icon: 'heart', suggestedTarget: 30000 },
  { name: 'Education / 529', category: 'education', icon: 'graduationCap' },
  { name: 'Home Repair', category: 'home_repair', icon: 'wrench', suggestedTarget: 15000 },
  { name: 'Major Purchase', category: 'major_purchase', icon: 'sparkles', suggestedTarget: 10000 },
  { name: 'Life Event', category: 'life_event', icon: 'sparkles', suggestedTarget: 10000 },
  { name: 'Fully funded retirement', category: 'retirement', icon: 'palmtree' },
  { name: 'Debt Payoff', category: 'debt_payoff', icon: 'creditCard', suggestedTarget: 20000 },
  { name: 'General Savings', category: 'savings', icon: 'wallet', suggestedTarget: 10000 },
];

// Bright accent per category — mirrors the redesign mockup's --b-viz mapping.
// Returns a CSS color string (a viz token, or the brand green for safety nets)
// so light/dark adapt automatically and goals stay visually distinct.
export function goalAccent(category: string, name = ''): string {
  // Category strings are coarse (a "New car fund" is stored as category
  // "savings"), so fold the goal name in too — keeps each goal's accent
  // matched to its real intent rather than the generic-savings fallback.
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
  // Only a savings goal no name above claimed: "New car fund" is still a car.
  if (category === 'savings') return 'var(--ui-viz-8)';
  return 'var(--ui-viz-2)';
}

// Toggle membership of an id in a string array.
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// ---------------------------------------------------------------------------
// Fundable accounts — shared by the goals list page (linked-account names on
// a goal card) and the create-goal page (the account picker), so both fetch
// and filter the same way instead of each keeping their own copy.
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  balance: string | null;
  institutionId: string | null;
  institutionName: string | null;
}

// Only liquid, fundable accounts can back a savings goal. Liabilities
// (credit/loan) would track debt, and illiquid assets (real_estate,
// alternative) would slam progress to 100% instantly — drop both.
export function fetchFundableAccounts(): Promise<Account[]> {
  return api.getBalances().then(({ balances }) =>
    balances
      .filter(b => b.type === 'depository' || b.type === 'investment')
      .map(b => ({
        id: b.accountId, name: b.name, mask: b.mask, type: b.type, balance: b.balance,
        institutionId: b.institutionId, institutionName: b.institutionName,
      }))
  );
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

/** The account type a goal of this kind is usually funded from. */
export function preferredAccountType(category: string): 'depository' | 'investment' {
  return category === 'retirement' || category === 'education' ? 'investment' : 'depository';
}

// Inset, so the list box's rounded clip can't cut the ring off a row.
const ROW_FOCUS = 'focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]';

/** Past this many accounts the list gets a search field. */
const PICKER_SEARCH_MIN = 12;

// Shared account picker — reused by the create form and the per-goal
// "edit linked accounts" inline editor. Linking accounts is the normal way a
// goal tracks progress, so this is a plain list in the form, not a tool inside
// a fold: grouped by type with the group this kind of goal usually draws on
// first, the whole row as the tap target with a check on the right, and the
// running total of what the picked accounts hold. Search appears only when
// the list is long enough to need it.
export function AccountPicker({ accounts, selected, onToggle, preferType, target }: AccountPickerProps & {
  /** The group listed first. */
  preferType?: string;
  /** The goal's target, so the total can be read against it. */
  target?: number;
}): ReactElement {
  const [query, setQuery] = useState('');
  // Pin the accounts that were linked when the picker OPENED — live-sorting on
  // toggle would make rows jump under the user's finger.
  const [pinnedIds] = useState(() => new Set(selected));

  const q = query.trim().toLowerCase();
  const visible = accounts
    .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.mask ?? '').includes(q))
    // Already-linked first (so they're visible, not buried), then biggest
    // funding sources — goals are usually backed by the large ones.
    .sort(
      (a, b) =>
        Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) ||
        parseFloat(b.balance ?? '0') - parseFloat(a.balance ?? '0'),
    );
  const types = [...new Set(accounts.map((a) => a.type))].sort(
    (a, b) => Number(b === preferType) - Number(a === preferType),
  );
  const groups = types
    .map((t) => ({ type: t, rows: visible.filter((a) => a.type === t) }))
    .filter((g) => g.rows.length > 0);
  // Groups other than the preferred one start folded, unless they hold a
  // linked account, so a cash goal is not a list of seven retirement accounts.
  const [openTypes, setOpenTypes] = useState<Set<string>>(
    () => new Set(accounts.filter((a) => !preferType || a.type === preferType || selected.includes(a.id)).map((a) => a.type)),
  );
  const groupCount = (rows: typeof accounts) => {
    const picked = rows.filter((a) => selected.includes(a.id)).length;
    return picked > 0 ? `${picked} of ${rows.length} selected` : `${rows.length} account${rows.length === 1 ? '' : 's'}`;
  };
  const total = accounts
    .filter((a) => selected.includes(a.id))
    .reduce((sum, a) => sum + parseFloat(a.balance ?? '0'), 0);

  return (
    <div>
      {accounts.length > PICKER_SEARCH_MIN && (
        <Input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts"
          aria-label="Search accounts"
          leadingIcon={<Search className="h-3.5 w-3.5" />}
          className="mb-3"
        />
      )}

      <div className="overflow-hidden rounded-ui-lg border border-line bg-panel">
        {groups.map((g, gi) => (
          <div key={g.type} role="group" aria-label={PICKER_TYPE_LABELS[g.type] ?? g.type}>
            {/* Only worth a heading when there is more than one group. A
                folded group's heading is the row that opens it. A search
                shows every match, folded or not. */}
            {groups.length > 1 && (q ? (
              <div className={cn('px-3.5 pt-3 pb-1.5 text-[12.5px] font-semibold text-content-muted', gi > 0 && 'border-t border-line')}>
                {PICKER_TYPE_LABELS[g.type] ?? g.type}
              </div>
            ) : (
              <button
                type="button"
                aria-expanded={openTypes.has(g.type)}
                aria-controls={`acct-group-${g.type}`}
                aria-label={`${PICKER_TYPE_LABELS[g.type] ?? g.type}, ${groupCount(g.rows)}`}
                onClick={() => setOpenTypes((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.type)) next.delete(g.type); else next.add(g.type);
                  return next;
                })}
                className={cn(
                  ROW_FOCUS,
                  'flex w-full items-center gap-2 px-3.5 py-2.5 min-h-touch text-left text-[13.5px] font-semibold text-content-secondary transition-colors active:bg-canvas-sunken [@media(hover:hover)]:hover:bg-canvas-sunken/60',
                  gi > 0 && 'border-t border-line',
                )}
              >
                <span className="flex-1">
                  {PICKER_TYPE_LABELS[g.type] ?? g.type}
                  {/* Says what a folded group holds that is picked, so nothing ticked is out of sight. */}
                  <span className="ml-1.5 font-medium text-content-muted ui-tnum">{groupCount(g.rows)}</span>
                </span>
                <ChevronDown
                  size={16}
                  className={cn('shrink-0 text-content-muted transition-transform duration-200', openTypes.has(g.type) && 'rotate-180')}
                />
              </button>
            ))}
            <div id={`acct-group-${g.type}`}>
            {(groups.length === 1 || openTypes.has(g.type) || q) && g.rows.map((acct, ri) => {
              const active = selected.includes(acct.id);
              return (
                <button
                  key={acct.id}
                  type="button"
                  onClick={() => onToggle(acct.id)}
                  aria-pressed={active}
                  className={cn(
                    ROW_FOCUS,
                    'flex w-full items-center gap-3 px-3.5 py-2.5 min-h-touch text-left transition-colors active:bg-canvas-sunken',
                    (ri > 0 || groups.length > 1) && 'border-t border-line',
                    active ? 'bg-brand-softer' : '[@media(hover:hover)]:hover:bg-canvas-sunken/60',
                  )}
                >
                  <InstitutionIcon institutionId={acct.institutionId} institutionName={acct.institutionName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold leading-tight text-content" title={acct.name}>
                      {acct.name}
                    </span>
                    {acct.mask && (
                      <span className="mt-0.5 block text-[12px] text-content-muted ui-tnum">••{acct.mask}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold text-content-secondary ui-tnum">
                    <MaskedText text={formatCurrency(parseFloat(acct.balance ?? '0'))} />
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors',
                      active ? 'border-brand bg-brand text-[rgb(var(--ui-brand-fg))]' : 'border-line-strong bg-panel',
                    )}
                  >
                    {active && <Check size={13} strokeWidth={3.25} />}
                  </span>
                </button>
              );
            })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3.5 py-5 text-center text-[12.5px] text-content-muted">
            No accounts match your search.
          </p>
        )}
      </div>

      {/* What the picked accounts hold, read against the target: linking a
          large account to a small goal starts it as reached, and that should
          be visible before it is created. */}
      {/* The live region stays mounted so the first pick is announced too. */}
      <div aria-live="polite">
      {selected.length > 0 && (
        <p className="mt-2.5 text-[13px] text-content-secondary ui-tnum">
          {selected.length === 1 ? 'This account holds' : `These ${selected.length} accounts hold`}{' '}
          <span className="font-semibold text-content"><MaskedText text={formatCurrency(total)} /></span>
          {target && target > 0 ? (
            <>
              {' '}of the <MaskedText text={formatCurrency(target)} /> target.
              {total >= target && ' The goal will start as reached.'}
            </>
          ) : '.'}
        </p>
      )}
      </div>
    </div>
  );
}
