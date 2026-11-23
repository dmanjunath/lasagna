// The account index of packages/web/src/lib/use-accounts-index.ts and the
// grouping of components/common/AccountPicker.tsx.

export interface AccountIndexEntry {
  id: string;
  name: string;
  mask: string | null;
  institution: string;
  isManual: boolean;
  /** accounts.type: depository, credit, investment, loan, real_estate, alternative. */
  type: string;
}

export type PlaidItems = {
  items: Array<{
    institutionName: string | null;
    institutionId: string | null;
    accounts: Array<{ id: string; name: string; mask: string | null; type: string }>;
  }>;
};

export function indexFromItems({ items }: PlaidItems): AccountIndexEntry[] {
  return items.flatMap((item) =>
    item.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      institution: item.institutionName || "Manual",
      isManual: item.institutionId === "manual",
      type: a.type,
    })),
  );
}

// The order a person reads their money: cash, cards, what they own, what they owe.
const ACCOUNT_TYPE_GROUPS: Array<[string, string]> = [
  ["depository", "Cash"],
  ["credit", "Credit cards"],
  ["investment", "Investments"],
  ["real_estate", "Property"],
  ["alternative", "Other assets"],
  ["loan", "Loans"],
];

/** Accounts grouped by type, in reading order. */
export function groupAccounts(accounts: AccountIndexEntry[]): Array<{ title: string; accounts: AccountIndexEntry[] }> {
  const rank = (type: string) => {
    const i = ACCOUNT_TYPE_GROUPS.findIndex(([t]) => t === type);
    return i === -1 ? ACCOUNT_TYPE_GROUPS.length : i;
  };
  const title = (type: string) => ACCOUNT_TYPE_GROUPS.find(([t]) => t === type)?.[1] ?? "Other";
  const out: Array<{ title: string; accounts: AccountIndexEntry[] }> = [];
  for (const a of [...accounts].sort((x, y) => rank(x.type) - rank(y.type))) {
    const t = title(a.type);
    const last = out[out.length - 1];
    if (last && last.title === t) last.accounts.push(a);
    else out.push({ title: t, accounts: [a] });
  }
  return out;
}
