import { eq, sql, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "./db.js";
import { LIABILITY_TYPES } from "./account-balances.js";

/**
 * The caller's IANA zone, or null when it is missing or not a zone this
 * runtime knows. Postgres accepts the same names, so a zone that passes here
 * is safe to bind into `AT TIME ZONE`.
 */
export function validTimeZone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

/**
 * Net worth per day, aggregated across the tenant's accounts. A day is the
 * calendar day in `tz` when one is given (so an evening snapshot in the US
 * lands on that evening, not on the next UTC day), else the UTC day.
 */
export async function netWorthHistory(
  tenantId: string,
  tz: string | null,
): Promise<Array<{ date: string; value: number }>> {
  const accts = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, tenantId),
  });
  if (accts.length === 0) return [];

  // Per-account overrides for the aggregation below: skip excluded accounts,
  // flip the sign on inverted ones, and keep the liability convention.
  const acctMeta = new Map(
    accts.map((a) => [
      a.id,
      { type: a.type, invert: a.invertBalance, exclude: a.excludeFromNetWorth },
    ]),
  );

  // `tz` is a bound parameter. GROUP BY / ORDER BY use the output position so
  // Postgres does not see two different parameters and reject the grouping.
  const day = tz
    ? sql<string>`date_trunc('day', ${balanceSnapshots.snapshotAt} AT TIME ZONE ${tz})::date`
    : sql<string>`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`;

  // Get latest snapshot per account per day
  const rows = await db
    .select({
      date: day.as("date"),
      accountId: balanceSnapshots.accountId,
      balance: sql<string>`(array_agg(${balanceSnapshots.balance} ORDER BY ${balanceSnapshots.snapshotAt} DESC))[1]`.as("balance"),
    })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.tenantId, tenantId))
    .groupBy(sql`1`, balanceSnapshots.accountId)
    .orderBy(sql`1`);

  // Build per-account balance timeline, carrying forward last known balance
  // This prevents false drops when an account has no snapshot on a given day
  const allDates = [...new Set(rows.map((r) => String(r.date)))].sort();
  const accountBalances = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const acctId = row.accountId;
    const date = String(row.date);
    if (!accountBalances.has(acctId)) accountBalances.set(acctId, new Map());
    accountBalances.get(acctId)!.set(date, parseFloat(row.balance || "0"));
  }

  // Fill forward: for each account, carry the last known balance into missing days
  for (const [, dateBalMap] of accountBalances) {
    let lastBal = 0;
    for (const date of allDates) {
      if (dateBalMap.has(date)) {
        lastBal = dateBalMap.get(date)!;
      } else {
        dateBalMap.set(date, lastBal);
      }
    }
  }

  // Aggregate per-date net worth
  return allDates.map((date) => {
    let total = 0;
    for (const [acctId, dateBalMap] of accountBalances) {
      const m = acctMeta.get(acctId);
      if (!m || m.exclude) continue;
      let bal = dateBalMap.get(date) || 0;
      if (m.invert) bal = -bal;
      total += LIABILITY_TYPES.has(m.type) ? -Math.abs(bal) : bal;
    }
    return { date, value: Math.round(total * 100) / 100 };
  });
}
