// The Accounts page's rules, ported from packages/web/src/pages/simple-money.tsx:
// the /plaid/items shapes, the balance math that matches the server's net
// worth, the two groupings (by type, by institution) and each row's words.

export type ValueSource = "synced" | "estimated" | "manual";

export interface ItemAccount {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  balance: string | null;
  currency: string;
  apr?: string | null;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertBalance?: boolean;
  frozen?: boolean;
  propertyAccountId?: string | null;
  valueSource?: ValueSource;
  metadata?: Record<string, unknown> | null;
}

export interface Item {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: ItemAccount[];
}

export const isDebtType = (type: string) => type === "credit" || type === "loan";
export const isManualItem = (item: Pick<Item, "institutionId">) => item.institutionId === "manual";
export const isItemError = (item: Pick<Item, "status">) => item.status === "error" || item.status === "item_login_required";
export const institutionOf = (item: Pick<Item, "institutionName">) => item.institutionName || "Manual";

/** The balance with the user's invert override, as the server's net worth counts it. */
export function effectiveBalance(a: Pick<ItemAccount, "balance" | "invertBalance">): number {
  return (a.invertBalance ? -1 : 1) * parseFloat(a.balance ?? "0");
}

/** The dashboard's title case: short words ("HQ", "529") stay capitals. */
export function titleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** packages/web/src/lib/utils.ts stripAccountMask: drops a trailing mask the bank put in the name. */
export function stripAccountMask(name: string, mask?: string | null): string {
  if (!mask) return name;
  const m = mask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("[\\s(–—-]*(?:[•·]{1,4}|\\.{2,4}|…|[#*xX]{1,4})?\\s*" + m + "[)\\s]*$");
  if (!re.test(name)) return name;
  const stripped = name.replace(re, "").trim();
  return stripped.length >= 2 ? stripped : name;
}

/** The name an account shows under. */
export const displayName = (a: Pick<ItemAccount, "name" | "mask">) => titleCase(stripAccountMask(a.name, a.mask));

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The newest sync across every connection. */
export function lastSyncedOf(items: Item[]): string | null {
  const stamps = items.map((i) => i.lastSyncedAt).filter(Boolean) as string[];
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
}

/** "8 accounts (1 not counted in net worth)". */
export function accountCountText(connected: number, counted: number): string {
  const notCounted = connected - counted;
  return `${connected} account${connected === 1 ? "" : "s"}${notCounted > 0 ? ` (${notCounted} not counted in net worth)` : ""}`;
}

/** Property and mortgage names across the link, so a row can say "linked to X". */
export function linkedNames(items: Item[]): (a: ItemAccount) => string | null {
  const all = items.flatMap((i) => i.accounts);
  const nameById = new Map(all.map((a) => [a.id, displayName(a)] as const));
  const mortgageByProperty = new Map<string, string>();
  for (const a of all) if (a.propertyAccountId) mortgageByProperty.set(a.propertyAccountId, displayName(a));
  return (a) =>
    a.propertyAccountId ? (nameById.get(a.propertyAccountId) ?? null) : a.type === "real_estate" ? (mortgageByProperty.get(a.id) ?? null) : null;
}

export interface AccountRowData {
  account: ItemAccount;
  item: Item;
  name: string;
  institution: string;
  meta: string;
  /** Whole-dollar figure to show: unsigned under Debt, signed otherwise. */
  value: number;
  /** Red: a debt (or a negative balance). */
  negative: boolean;
  /** Under the Debt heading the amount is owed by definition: no sign. */
  owed: boolean;
  badges: string[];
  estimating: boolean;
}

function rowFor(item: Item, a: ItemAccount, linked: (a: ItemAccount) => string | null, byInstitution: boolean): AccountRowData {
  const institution = institutionOf(item);
  // A hand-entered account says so with its "You entered" tag, so its line skips the institution.
  const own = byInstitution || isManualItem(item);
  const segs: string[] = own ? [] : [institution];
  if (a.subtype) segs.push(titleCase(a.subtype));
  else if (own) segs.push(titleCase(a.type.replace(/_/g, " ")));
  const link = linked(a);
  if (link) segs.push(`linked to ${link}`);
  const badges: string[] = [];
  if (a.excludeFromNetWorth) badges.push("Not counted");
  if (a.invertBalance) badges.push("Inverted");
  const value = effectiveBalance(a);
  const debt = isDebtType(a.type);
  return {
    account: a,
    item,
    name: displayName(a),
    institution,
    meta: segs.join(", "),
    value,
    negative: debt || value < 0,
    owed: debt && !byInstitution,
    badges,
    estimating: (a.metadata?.valueEstimate as { status?: string } | undefined)?.status === "pending",
  };
}

export interface AccountGroup {
  key: string;
  title: string;
  count: number;
  unit: "account" | "item";
  /** Gross for assets, the sum owed for Debt. */
  total: number;
  /** Debt: shown in the negative ink, unsigned. */
  owed: boolean;
  /** Index into the chart palette for the group's swatch (web --ui-viz-N, zero-based). */
  viz: number;
  rows: AccountRowData[];
}

const TYPE_GROUPS: Array<{ key: string; title: string; types: string[]; viz: number; unit?: "item" }> = [
  { key: "cash", title: "Cash", types: ["depository"], viz: 0 },
  { key: "investments", title: "Investments", types: ["investment"], viz: 1 },
  { key: "property", title: "Property", types: ["real_estate"], viz: 4 },
  { key: "other", title: "Other assets", types: ["alternative"], viz: 4, unit: "item" },
  { key: "debt", title: "Debt", types: ["credit", "loan"], viz: 3 },
];

/** Accounts by type, in the web's order. Totals skip excluded accounts and follow the invert override. */
export function groupsByType(items: Item[]): AccountGroup[] {
  const linked = linkedNames(items);
  return TYPE_GROUPS.flatMap((g) => {
    const rows = items.flatMap((item) => item.accounts.filter((a) => g.types.includes(a.type)).map((a) => rowFor(item, a, linked, false)));
    if (rows.length === 0) return [];
    const owed = g.key === "debt";
    const counted = rows.filter((r) => !r.account.excludeFromNetWorth);
    const total = counted.reduce((s, r) => s + (owed ? Math.abs(r.value) : r.value), 0);
    return [{ key: g.key, title: g.title, count: rows.length, unit: g.unit ?? "account", total, owed, viz: g.viz, rows }];
  });
}

export interface InstitutionGroup {
  item: Item;
  institution: string;
  manual: boolean;
  error: boolean;
  /** "Manual entry", "Needs attention", "synced 3h ago". */
  status: string;
  /** Net: debts reduce it. */
  total: number;
  rows: AccountRowData[];
}

export function groupsByInstitution(items: Item[], now: number = Date.now()): InstitutionGroup[] {
  const linked = linkedNames(items);
  return items.map((item) => {
    const manual = isManualItem(item);
    const error = isItemError(item);
    const status = manual ? "Manual entry" : error ? "Needs attention" : item.lastSyncedAt ? `synced ${relativeTime(item.lastSyncedAt, now)}` : "Synced";
    const total = item.accounts
      .filter((a) => !a.excludeFromNetWorth)
      .reduce((s, a) => {
        const v = effectiveBalance(a);
        return isDebtType(a.type) ? s - Math.abs(v) : s + v;
      }, 0);
    return { item, institution: institutionOf(item), manual, error, status, total, rows: item.accounts.map((a) => rowFor(item, a, linked, true)) };
  });
}

/** Connections that new accounts can be added to through Plaid's update mode. A frozen one is left out. */
export function addableItems(items: Item[]): Item[] {
  return items.filter((i) => !isManualItem(i) && !(i.accounts.length > 0 && i.accounts.every((a) => a.frozen === true)));
}

/** Where an account lives, by id. */
export function findAccount(items: Item[], id: string): { item: Item; account: ItemAccount } | null {
  for (const item of items) {
    const account = item.accounts.find((a) => a.id === id);
    if (account) return { item, account };
  }
  return null;
}
