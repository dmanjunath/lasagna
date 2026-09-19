// ---------------------------------------------------------------------------
// The spending page's category scope, and the URL it is carried in.
//
// Two disjoint parameters, never a mode flag:
//
//   /spending?categories=<id>,<id>          include these
//   /spending?excludeCategories=<id>,<id>   everything except these
//
// `categories` is the SAME name, format and meaning the transactions page reads
// (see filtersFromQuery in components/transactions/TransactionFilters.tsx), so
// an include scope hands to /transactions verbatim with no translation. Putting
// the exclude set under its own name is a safety property: a reader that only
// knows `categories` ignores the unknown parameter and degrades to a WIDER
// scope. A `categoryMode=exclude` flag would make that same reader show the
// exactly inverted set, and `categories=a,-b` would make it query a category id
// that does not exist.
//
// `period` is 'YYYY-MM' or 'YYYY'; the granularity is the string's length, the
// way the page already derives it. A shared link that reproduced the filter but
// landed the reader on a different month would only half-deliver the share.
// ---------------------------------------------------------------------------

export interface SpendFilter {
  /** Category ids to keep. Empty = keep everything the exclude list allows. */
  include: string[];
  /** Category ids to drop. */
  exclude: string[];
}

export const EMPTY_SPEND_FILTER: SpendFilter = { include: [], exclude: [] };

export function isActive(f: SpendFilter): boolean {
  return f.include.length > 0 || f.exclude.length > 0;
}

/** 'YYYY-MM' or 'YYYY'. Anything else is not a period this page can land on. */
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

// Mirrors UUID_RE in packages/api/src/lib/taxonomy.ts, which the transactions
// route applies to this same `categories` parameter. The two halves have to
// agree: if only one of them dropped a malformed token, the page would show an
// active filter over numbers the server never filtered.
const CATEGORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The reading half. A token that cannot possibly be an id (truncated by a
// line-wrapped link, hand-mangled) is DROPPED, so the page degrades to the
// wider scope on both sides of the wire rather than showing a chip the server
// is ignoring. A well-formed id the tenant does not own is KEPT: rewriting a
// shared link would change the scope the sender meant, and the honest result is
// the empty state — the server matches no row and the client filters to none.
export function spendFilterFromQuery(queryString: string): { filter: SpendFilter; period: string | null } {
  const params = new URLSearchParams(queryString);
  const filter: SpendFilter = { include: [], exclude: [] };

  const include = params.get('categories');
  if (include) filter.include = include.split(',').filter((id) => CATEGORY_ID_RE.test(id));

  const exclude = params.get('excludeCategories');
  if (exclude) filter.exclude = exclude.split(',').filter((id) => CATEGORY_ID_RE.test(id));

  const period = params.get('period');
  return { filter, period: period && PERIOD_RE.test(period) ? period : null };
}

// The writing half: the query string spendFilterFromQuery reads back to the
// same scope. Commas stay literal, matching the shape /transactions builds.
export function spendFilterToSearchParams(f: SpendFilter, period?: string | null): string {
  const parts: string[] = [];
  if (period) parts.push(`period=${encodeURIComponent(period)}`);
  if (f.include.length > 0) {
    parts.push(`categories=${f.include.map(encodeURIComponent).join(',')}`);
  }
  if (f.exclude.length > 0) {
    parts.push(`excludeCategories=${f.exclude.map(encodeURIComponent).join(',')}`);
  }
  return parts.join('&');
}

/**
 * Whether a summary row survives the filter. `null` is the uncategorized row.
 *
 * An include list names ids, so uncategorized (which has no id) is not in it and
 * drops out; with only an exclude list, uncategorized is kept. That is derived
 * here rather than encoded as a magic id inside `categories`, which would flow
 * to /transactions and be cast to uuid server-side.
 *
 * The UI only ever sets one of the two lists. A hand-edited URL carrying both
 * narrows to the include list and THEN subtracts the exclude list, so exclude
 * wins, rather than crashing or silently inverting.
 */
export function spendFilterAllows(categoryId: string | null, f: SpendFilter): boolean {
  if (f.include.length > 0 && (categoryId === null || !f.include.includes(categoryId))) return false;
  if (categoryId !== null && f.exclude.includes(categoryId)) return false;
  return true;
}
