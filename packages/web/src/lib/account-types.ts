// ---------------------------------------------------------------------------
// The account type vocabulary — one list, shared by everything that offers or
// names a type.
//
// `type` is the coarse category (accounts.type, the DB enum); `subtype` is the
// specific kind (accounts.subtype). Every token below is one the app already
// matches on, so a value written from the create modal reaches the feature that
// reads it: subtype drives the tax bucket (api/services/account-buckets),
// the retirement kind split, the debt kind classification, and the rental
// fields on a property.
//
// Shared by the create modal (pages/Accounts), the reclassify select
// (pages/account-detail) and the debt labels (pages/debt) so the three lists
// can't drift apart.
// ---------------------------------------------------------------------------

export type AccountCategory = 'bank' | 'realEstate' | 'other' | 'debt';

export interface AccountTypeOption {
  label: string;
  type: string;
  subtype: string | null;
  isDebt: boolean;
  category: AccountCategory;
}

export const ACCOUNT_TYPE_CATALOG: AccountTypeOption[] = [
  { label: 'Checking', type: 'depository', subtype: 'checking', isDebt: false, category: 'bank' },
  { label: 'Savings', type: 'depository', subtype: 'savings', isDebt: false, category: 'bank' },
  { label: 'Brokerage', type: 'investment', subtype: 'brokerage', isDebt: false, category: 'bank' },
  { label: '401(k)', type: 'investment', subtype: '401k', isDebt: false, category: 'bank' },
  { label: 'Traditional IRA', type: 'investment', subtype: 'ira', isDebt: false, category: 'bank' },
  { label: 'Roth IRA', type: 'investment', subtype: 'roth_ira', isDebt: false, category: 'bank' },
  { label: 'HSA', type: 'investment', subtype: 'hsa', isDebt: false, category: 'bank' },
  { label: 'Primary residence', type: 'real_estate', subtype: 'primary', isDebt: false, category: 'realEstate' },
  { label: 'Rental property', type: 'real_estate', subtype: 'rental', isDebt: false, category: 'realEstate' },
  { label: 'Other asset', type: 'alternative', subtype: null, isDebt: false, category: 'other' },
  { label: 'Credit card', type: 'credit', subtype: null, isDebt: true, category: 'debt' },
  { label: 'Mortgage', type: 'loan', subtype: 'mortgage', isDebt: true, category: 'debt' },
  { label: 'Auto loan', type: 'loan', subtype: 'auto', isDebt: true, category: 'debt' },
  { label: 'Student loan', type: 'loan', subtype: 'student', isDebt: true, category: 'debt' },
  { label: 'Other loan', type: 'loan', subtype: null, isDebt: true, category: 'debt' },
];

/** Stable key for a (type, subtype) pair — a `<select>` value / React key. */
export const accountTypeKey = (type: string, subtype: string | null | undefined) =>
  `${type}:${subtype ?? ''}`;

export const accountTypesIn = (category: AccountCategory): AccountTypeOption[] =>
  ACCOUNT_TYPE_CATALOG.filter((o) => o.category === category);

// Subtypes that mean the same thing as a catalog token but are spelled
// differently: `credit card` is what Plaid sends, `student_loan` is what older
// code wrote, `roth` is what Plaid calls a Roth IRA. Without these the label
// falls through and the same list reads "Roth" beside "Roth IRA".
const SUBTYPE_ALIASES: Record<string, string | null> = {
  student_loan: 'student',
  'credit card': null,
  roth: 'roth_ira',
};

/**
 * The catalog token a persisted subtype means. Use this anywhere a stored
 * subtype is matched against the catalog, so a value the label aliases is
 * recognised as the option it already is rather than treated as a new one.
 */
export const canonicalSubtype = (subtype: string | null | undefined): string | null =>
  subtype != null && subtype in SUBTYPE_ALIASES ? SUBTYPE_ALIASES[subtype] : subtype ?? null;

// Account-vocabulary words that are acronyms, so the sentence-case fallback
// doesn't render "utma" as "Utma". Digits need no entry: "529" has no letter to
// capitalise, so it passes through as typed.
const SUBTYPE_ACRONYMS: Record<string, string> = {
  cd: 'CD',
  ebt: 'EBT',
  gic: 'GIC',
  hsa: 'HSA',
  ira: 'IRA',
  isa: 'ISA',
  resp: 'RESP',
  rrsp: 'RRSP',
  sep: 'SEP',
  tfsa: 'TFSA',
  ugma: 'UGMA',
  utma: 'UTMA',
};

/**
 * Human label for a persisted (type, subtype). A subtype the catalog doesn't
 * list falls back to sentence case, matching the catalog's own casing so a
 * synced value never reads as a different idiom beside a catalogued one.
 */
export function accountTypeLabel(type: string, subtype: string | null | undefined): string {
  const sub = canonicalSubtype(subtype);
  const hit = ACCOUNT_TYPE_CATALOG.find((o) => o.type === type && o.subtype === sub);
  if (hit) return hit.label;
  const words = (sub ?? type).replace(/_/g, ' ').split(' ');
  return words
    .map((w, i) => {
      const acronym = SUBTYPE_ACRONYMS[w.toLowerCase()];
      if (acronym) return acronym;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}
