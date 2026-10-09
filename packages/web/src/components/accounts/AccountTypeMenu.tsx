import { cn } from '../../lib/utils';
import { accountTypeKey, type AccountCategory } from '../../lib/account-types';
import { OptionMenu } from '../common/OptionMenu';

// ---------------------------------------------------------------------------
// AccountTypeMenu — the account type dropdown, shared by the create modal
// (pages/Accounts) and the reclassify field (pages/account-detail). Types sit
// under their category's tinted band once the list spans more than one
// category, so a checking account never runs on beside a mortgage.
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  bank: 'Bank & investments',
  other: 'Other assets',
  debt: 'Debt',
  realEstate: 'Property',
};

export function AccountTypeMenu({
  types,
  value,
  onChange,
  ariaLabel,
  placeholder,
  portal,
}: {
  /** In catalog order. A type without a category (an unknown synced one) sits above the bands. */
  types: Array<{ label: string; type: string; subtype: string | null; category?: AccountCategory }>;
  /** accountTypeKey of the chosen type, or '' while unanswered. */
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  /** Trigger text while nothing is chosen, muted so it doesn't read as an answer. */
  placeholder?: string;
  /** For a modal body, which clips overflow. */
  portal?: boolean;
}) {
  const banded = new Set(types.map((t) => t.category).filter(Boolean)).size > 1;
  const options = types.map((t) => ({
    value: accountTypeKey(t.type, t.subtype),
    label: t.label,
    group: banded && t.category ? CATEGORY_LABELS[t.category] : undefined,
  }));
  const unanswered = !options.some((o) => o.value === value);
  return (
    <OptionMenu
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      triggerLabel={unanswered ? placeholder : undefined}
      portal={portal}
      className={cn(unanswered && '[&>button]:text-content-muted')}
    />
  );
}
