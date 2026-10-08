import { and, desc, eq, gte, lt, sql, pageViews } from "@lasagna/core";
import { db } from "./db.js";

/**
 * A view newer than this is part of the visit happening now, not the last one.
 * Without it, a refresh or a click to another page would make "last visit" a
 * few seconds ago.
 */
export const LAST_VISIT_GAP_MS = 30 * 60 * 1000;
const SESSION_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function recordPageView(
  who: { userId: string; tenantId: string },
  path: string,
): Promise<void> {
  await db.insert(pageViews).values({ userId: who.userId, tenantId: who.tenantId, path });
}

/**
 * The newest view from before the session under way now.
 *
 * Views closer together than the gap are one session. "Older than the gap" on
 * its own is not enough: after 40 minutes of clicking around, a view from the
 * same session would pass that test and the last visit would become today.
 */
export async function findLastVisit(userId: string, now: Date = new Date()): Promise<Date | null> {
  const cutoff = new Date(now.getTime() - LAST_VISIT_GAP_MS);
  const [newest] = await db
    .select({ visitedAt: pageViews.visitedAt })
    .from(pageViews)
    .where(eq(pageViews.userId, userId))
    .orderBy(desc(pageViews.visitedAt))
    .limit(1);
  if (!newest) return null;
  // No session under way: the newest view is the last visit.
  if (newest.visitedAt < cutoff) return newest.visitedAt;

  // Otherwise find where the current session started: the newest view that
  // came a full gap after the one before it.
  const gap = sql.raw(`interval '${LAST_VISIT_GAP_MS / 60_000} minutes'`);
  const views = db
    .select({
      visitedAt: pageViews.visitedAt,
      sincePrev: sql`${pageViews.visitedAt} - lag(${pageViews.visitedAt}) over (order by ${pageViews.visitedAt})`.as("since_prev"),
    })
    .from(pageViews)
    // The session under way started recently, so there is no need to walk
    // every view this person has ever made.
    .where(and(eq(pageViews.userId, userId), gte(pageViews.visitedAt, new Date(now.getTime() - SESSION_LOOKBACK_MS))))
    .as("v");
  const [session] = await db
    .select({ startedAt: sql<Date | null>`max(${views.visitedAt})`.mapWith(pageViews.visitedAt) })
    .from(views)
    .where(sql`${views.sincePrev} is null or ${views.sincePrev} >= ${gap}`);
  if (!session?.startedAt) return null;

  const [before] = await db
    .select({ visitedAt: pageViews.visitedAt })
    .from(pageViews)
    .where(and(eq(pageViews.userId, userId), lt(pageViews.visitedAt, session.startedAt)))
    .orderBy(desc(pageViews.visitedAt))
    .limit(1);
  return before?.visitedAt ?? null;
}
