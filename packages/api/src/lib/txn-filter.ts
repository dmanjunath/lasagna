// The one transaction filter every endpoint reads: POST /transactions/query,
// GET /transactions, /spending-summary, /monthly-trend and /merchants. One
// parser per transport (a JSON body, a query string) and one predicate
// builder, so a filter means the same rows wherever it is applied.

import { sql, eq, inArray, notInArray, or, isNull, transactions, type SQL } from "@lasagna/core";
import { excludedTxnAccountIds } from "./account-balances.js";
import { UUID_RE } from "./taxonomy.js";

/** in and out leave transfers out (the Spending rule), transfer is only them. */
export type TxnKind = "all" | "in" | "out" | "transfer";
export type TxnSource = "bank" | "manual";

export interface TxnFilter {
  search?: string;
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  categoryGroupIds?: string[];
  accountIds?: string[];
  startDate?: Date;
  endDate?: Date;
  amountMin?: number;
  amountMax?: number;
  merchants?: string[];
  kind?: TxnKind;
  pending?: boolean;
  excluded?: boolean;
  recurring?: boolean;
  source?: TxnSource;
}

const KINDS: TxnKind[] = ["all", "in", "out", "transfer"];
// The old two-value field, kept so clients that still send it keep working.
const DIRECTION_ALIAS: Record<string, TxnKind> = { credit: "in", debit: "out" };

type Parsed = { ok: TxnFilter } | { error: string };

function list(v: unknown, key: string): { ok: string[] } | { error: string } {
  if (v == null) return { ok: [] };
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { error: `${key} must be an array of strings` };
  return { ok: v };
}

function bool(v: unknown, key: string): { ok: boolean | undefined } | { error: string } {
  if (v == null) return { ok: undefined };
  if (v === true || v === "true") return { ok: true };
  if (v === false || v === "false") return { ok: false };
  return { error: `${key} must be true or false` };
}

/** A filter object from a JSON body (POST /transactions/query's `filters`). */
export function parseTxnFilter(f: any): Parsed {
  f = f ?? {};
  const out: TxnFilter = {};

  if (f.search != null && String(f.search).trim() !== "") out.search = String(f.search).trim();

  if (f.kind != null) {
    if (!KINDS.includes(f.kind)) return { error: "kind must be all, in, out or transfer" };
    if (f.kind !== "all") out.kind = f.kind;
  } else if (f.direction != null) {
    const k = DIRECTION_ALIAS[f.direction];
    if (!k) return { error: "direction must be credit or debit" };
    out.kind = k;
  }

  for (const key of ["categories", "excludeCategories", "categoryGroups"] as const) {
    const r = list(f[key], key);
    if ("error" in r) return r;
    if (r.ok.length === 0) continue;
    if (!r.ok.every((x) => UUID_RE.test(x))) {
      return { error: key === "categoryGroups" ? "categoryGroups must be category group ids" : `${key} must be category ids` };
    }
    if (key === "categories") out.categoryIds = r.ok;
    else if (key === "excludeCategories") out.excludeCategoryIds = r.ok;
    else out.categoryGroupIds = r.ok;
  }

  const accts = list(f.accountIds, "accountIds");
  if ("error" in accts) return accts;
  if (accts.ok.length > 0) out.accountIds = accts.ok;

  const merchants = list(f.merchants, "merchants");
  if ("error" in merchants) return merchants;
  const names = [...merchants.ok, ...(f.merchant != null ? [String(f.merchant)] : [])]
    .map((m) => m.trim())
    .filter((m) => m !== "");
  if (names.length > 0) out.merchants = [...new Set(names)];

  for (const key of ["startDate", "endDate"] as const) {
    const v = f[key];
    if (v == null) continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return { error: `${key} is not a valid date` };
    out[key] = d;
  }

  for (const key of ["amountMin", "amountMax"] as const) {
    const v = f[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: `${key} must be a non-negative finite number` };
    out[key] = n;
  }
  if (out.amountMin != null && out.amountMax != null && out.amountMin > out.amountMax) {
    return { error: "amountMin must be <= amountMax" };
  }

  for (const key of ["pending", "excluded", "recurring"] as const) {
    const r = bool(f[key], key);
    if ("error" in r) return r;
    if (r.ok !== undefined) out[key] = r.ok;
  }

  if (f.source != null) {
    if (f.source !== "bank" && f.source !== "manual") return { error: "source must be bank or manual" };
    out.source = f.source;
  }

  return { ok: out };
}

/**
 * The same filter from a query string. Ids are comma-joined (categories,
 * excludeCategories, categoryGroups, accountIds); merchant names can hold
 * commas, so each is its own repeated `merchant` parameter.
 *
 * Category ids that are not uuids are dropped here instead of rejected: a stale
 * id surviving in a shared link is harmless (it matches no row in an include
 * list and is a no-op in an exclude list).
 */
export function parseTxnFilterQuery(
  get: (key: string) => string | undefined,
  getAll: (key: string) => string[] | undefined,
): Parsed {
  const ids = (key: string) => (get(key) ?? "").split(",").filter((id) => id !== "");
  const uuids = (key: string) => ids(key).filter((id) => UUID_RE.test(id));
  return parseTxnFilter({
    search: get("search"),
    kind: get("kind"),
    direction: get("direction"),
    categories: uuids("categories"),
    excludeCategories: uuids("excludeCategories"),
    categoryGroups: uuids("categoryGroups"),
    accountIds: [...ids("accountIds"), ...(get("accountId") ? [get("accountId")!] : [])],
    merchants: getAll("merchant") ?? [],
    startDate: get("startDate"),
    endDate: get("endDate"),
    amountMin: get("amountMin"),
    amountMax: get("amountMax"),
    pending: get("pending"),
    excluded: get("excluded"),
    recurring: get("recurring"),
    source: get("source"),
  });
}

/** The group type of a transaction's category, `expense` when it has none. */
const groupType = sql`coalesce((select cg.type::text from categories c join category_groups cg on cg.id = c.group_id where c.id = ${transactions.categoryId}), 'expense')`;
/** The one transfer rule, the group-type test Spent uses. */
export const isTransfer = sql`${groupType} = 'transfer'`;
/** Money in: the income categories, the rule the Income total uses. */
export const isIncome = sql`${groupType} = 'income'`;
const merchantExpr = sql`coalesce(${transactions.merchantName}, ${transactions.name})`;

/**
 * The WHERE conditions for a filter, tenant scope included. Without an account
 * list, the accounts the user excluded from spending views stay out, as they
 * always have; naming accounts on purpose shows them.
 *
 * Conditions use subqueries, not joins, so any caller can add them to a query
 * whatever it already joins.
 */
export async function txnFilterConditions(tenantId: string, f: TxnFilter): Promise<SQL[]> {
  const out: SQL[] = [eq(transactions.tenantId, tenantId)];

  if (f.search) {
    const like = "%" + f.search + "%";
    out.push(sql`(${transactions.name} ILIKE ${like} OR ${transactions.merchantName} ILIKE ${like} OR ${transactions.notes} ILIKE ${like} OR exists (select 1 from categories c where c.id = ${transactions.categoryId} and c.name ILIKE ${like}))`);
  }

  if (f.categoryIds?.length) out.push(inArray(transactions.categoryId, f.categoryIds));
  // `not in (...)` is NULL for an uncategorized row, so the NULL case is
  // spelled out or every uncategorized transaction silently drops.
  if (f.excludeCategoryIds?.length) {
    out.push(or(isNull(transactions.categoryId), notInArray(transactions.categoryId, f.excludeCategoryIds))!);
  }
  if (f.categoryGroupIds?.length) {
    out.push(sql`${transactions.categoryId} in (select c.id from categories c where c.group_id in (${sql.join(f.categoryGroupIds.map((id) => sql`${id}::uuid`), sql`, `)}))`);
  }

  if (f.accountIds?.length) {
    out.push(inArray(transactions.accountId, f.accountIds));
  } else {
    const excludedIds = await excludedTxnAccountIds(tenantId);
    if (excludedIds.length > 0) out.push(notInArray(transactions.accountId, excludedIds));
  }

  if (f.startDate) out.push(sql`${transactions.date} >= ${f.startDate.toISOString()}::timestamptz`);
  if (f.endDate) out.push(sql`${transactions.date} <= ${f.endDate.toISOString()}::timestamptz`);
  if (f.amountMin != null) out.push(sql`abs(${transactions.amount}) >= ${f.amountMin}`);
  if (f.amountMax != null) out.push(sql`abs(${transactions.amount}) <= ${f.amountMax}`);
  if (f.merchants?.length) {
    out.push(sql`${merchantExpr} in (${sql.join(f.merchants.map((m) => sql`${m}`), sql`, `)})`);
  }

  // One rule for the rows and the totals (lib/cash-flow.ts): Money in is the
  // income categories, Money out everything else that is not a transfer. So a
  // refund is a Money out row that reduces its category (never income, never
  // lost), and the rows a side lists are the rows its total nets.
  if (f.kind === "in") out.push(isIncome);
  if (f.kind === "out") out.push(sql`not ${isIncome} and not ${isTransfer}`);
  if (f.kind === "transfer") out.push(isTransfer);

  if (f.pending != null) out.push(eq(transactions.pending, f.pending ? 1 : 0));
  if (f.excluded === true) out.push(sql`${transactions.excludedAt} is not null`);
  if (f.excluded === false) out.push(sql`${transactions.excludedAt} is null`);
  if (f.source === "bank") out.push(sql`${transactions.source} = 'plaid'`);
  if (f.source === "manual") out.push(sql`${transactions.source} <> 'plaid'`);

  if (f.recurring != null) {
    // A transaction is recurring when an active detected series has its
    // merchant (and its account, when the series names one).
    const series = sql`exists (select 1 from recurring_transactions r where r.tenant_id = ${transactions.tenantId} and r.is_active and r.dismissed_at is null and lower(coalesce(r.merchant_name, r.name)) = lower(${merchantExpr}) and (r.account_id is null or r.account_id = ${transactions.accountId}))`;
    out.push(f.recurring ? series : sql`not ${series}`);
  }

  return out;
}
