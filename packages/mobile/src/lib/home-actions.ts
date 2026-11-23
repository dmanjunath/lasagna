import { actionArea } from "@web/lib/action-destination";
import { toActionRow, type ActionRow, type ApiActionRow, type Effort } from "@web/lib/action-rows";
import { amountLabel } from "@web/lib/spend-cuts";
import { localDayKey } from "./format";

// Home's action shortlist, ported from ActionsSection in
// packages/web/src/pages/simple-home.tsx and the row in components/common/action-item.tsx.

/** How many actions home shows before handing off to the actions page. */
export const HOME_ACTION_LIMIT = 3;

/** Put away for a month, as /insights does. */
export const SNOOZE_HOURS = 720;

const EFFORT_RANK: Record<string, number> = { quick: 0, moderate: 1, involved: 2 };
const UNRATED_EFFORT_RANK = EFFORT_RANK.moderate;
const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Least work first, urgency breaks the tie, newest after that. At most three. */
export function homeActions(actions: ApiActionRow[]): ActionRow[] {
  const byEffort = (i: ActionRow) => (i.effort ? EFFORT_RANK[i.effort] ?? UNRATED_EFFORT_RANK : UNRATED_EFFORT_RANK);
  const byUrgency = (i: ActionRow) => URGENCY_RANK[i.urgency] ?? URGENCY_RANK.medium;
  return actions
    .map(toActionRow)
    .sort((a, b) => byEffort(a) - byEffort(b) || byUrgency(a) - byUrgency(b) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, HOME_ACTION_LIMIT);
}

/** The server's drill to the exact context, or the page the action is about. The catch-all has none. */
export function actionDestination(row: ActionRow): { label: string; href: string } | null {
  if (row.drill) return row.drill;
  const area = actionArea(row.type, row.category);
  return area.link ? { label: `Open ${area.label}`, href: area.link } : null;
}

/** The figure the row prints in its pill, or null. A figure that is not money back prints the row's words. */
export function rowFigure(row: Pick<ActionRow, "amount" | "impact" | "handsMoneyBack">): string | null {
  if (row.amount) return row.handsMoneyBack === false ? row.impact || null : amountLabel(row.amount);
  return row.impact || null;
}

/** What "Ask Lasagna about this" sends to chat, word for word as the web does. */
export function actionChatPrompt(row: ActionRow): string {
  return `Walk me through this insight:\n\nTitle: ${row.title}\nDescription: ${row.description}\nImpact: ${rowFigure(row) ?? ""}\n\n${row.chatPrompt}`;
}

export const EFFORT_LABEL: Record<Effort, string> = { quick: "Quick", moderate: "Moderate", involved: "Involved" };

/** "Found Oct 3. Updated today.", the second only when it is a later day. */
export function datesLine(foundAt: string, updatedAt: string | undefined, now: Date = new Date()): string {
  const today = localDayKey(now);
  const day = (iso: string) => {
    const d = new Date(iso);
    return localDayKey(d) === today
      ? "today"
      : d.toLocaleString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  };
  const found = `Found ${day(foundAt)}.`;
  return updatedAt && localDayKey(new Date(updatedAt)) > localDayKey(new Date(foundAt)) ? `${found} Updated ${day(updatedAt)}.` : found;
}

/** The count line over the transactions behind a figure. */
export function txnCountLine(shown: number, total: number, scope?: string | null): string {
  if (total <= 1) return "The transaction behind this";
  const what = scope ?? "transactions behind this";
  if (total > shown) return `The ${total} ${what}, largest first`;
  return `The ${total} ${what}`;
}
