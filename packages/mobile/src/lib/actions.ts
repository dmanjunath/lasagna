import { actionArea, areaKey, groupByArea } from "@web/lib/action-destination";
import { rankActions, toActionRow, type ActionRow, type ApiActionRow } from "@web/lib/action-rows";

// The Actions page's grouping, ported from packages/web/src/pages/insights.tsx,
// and the Spending page's own actions, from components/common/page-actions.tsx.

export type Band = "do_now" | "this_week" | "watch";

const BAND_OF: Record<string, Band> = { critical: "do_now", high: "do_now", medium: "this_week", low: "watch" };
const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const BANDS: Array<{ key: Band; title: string }> = [
  { key: "do_now", title: "Worth doing now" },
  { key: "this_week", title: "Worth doing in the next month" },
  { key: "watch", title: "Keep an eye on" },
];

export const ALL_AREAS = "all";

/** The area rail: All, then each page that has an action. One area is not a filter, so none then. */
export function areaFilters(rows: ActionRow[]): Array<{ value: string; label: string }> {
  const groups = groupByArea(rows);
  return groups.length > 1 ? [{ value: ALL_AREAS, label: "All" }, ...groups.map((g) => ({ value: areaKey(g), label: g.label }))] : [];
}

export function inArea(row: ActionRow, area: string): boolean {
  return area === ALL_AREAS || areaKey(actionArea(row.type, row.category)) === area;
}

/** Rows by how pressing they are, most urgent first inside each band. Empty bands are left out. */
export function bandRows(rows: ActionRow[]): Array<{ key: Band; title: string; rows: ActionRow[] }> {
  const by = new Map<Band, ActionRow[]>();
  for (const r of rows) {
    const b = BAND_OF[r.urgency] ?? "watch";
    by.set(b, [...(by.get(b) ?? []), r]);
  }
  return BANDS.flatMap(({ key, title }) => {
    const list = by.get(key);
    if (!list?.length) return [];
    return [{ key, title, rows: [...list].sort((a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0)) }];
  });
}

/** The band an action sits in. */
export function bandOf(row: Pick<ActionRow, "urgency">): Band {
  return BAND_OF[row.urgency] ?? "watch";
}

/** The Spending page's actions: spending and behavioral advice, ranked as the web ranks them. */
export function spendingActions(insights: ApiActionRow[]): ActionRow[] {
  return rankActions(insights.filter((i) => ["spending", "behavioral"].includes(i.type ?? "general")).map(toActionRow));
}

/** Refresh rewrites the actions at most once every three hours, as on the web. */
export const REFRESH_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export function canRefresh(lastGeneratedAt: string | null, now: number = Date.now()): boolean {
  return !lastGeneratedAt || now - new Date(lastGeneratedAt).getTime() >= REFRESH_COOLDOWN_MS;
}

/** "Updated 3 hours ago", "Updated just now", "Updated Nov 19". */
export function updatedLine(lastGeneratedAt: string | null, now: Date = new Date()): string | null {
  if (!lastGeneratedAt) return null;
  const then = new Date(lastGeneratedAt);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
  return `Updated ${then.toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}
