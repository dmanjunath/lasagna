// One-shot bounded retry over a set of ids run via Promise.allSettled.
//
// Runs `fn` for every id once. Any id whose settled entry rejected is retried
// exactly ONE more time (no loops, no recursion, no unbounded fan-out). Ids
// that succeed on the first pass are never retried. Returns the counts and the
// ids that STILL failed after the retry so callers can log a diagnosable line.
export interface RetryResult {
  total: number;
  succeededFirstPass: number;
  recoveredOnRetry: number;
  stillFailedIds: string[];
}

export async function runWithRetry(
  ids: string[],
  fn: (id: string) => Promise<unknown>
): Promise<RetryResult> {
  const first = await Promise.allSettled(ids.map((id) => fn(id)));
  const succeededFirstPass = first.filter((r) => r.status === "fulfilled").length;
  const failedIds = ids.filter((_, i) => first[i].status === "rejected");

  // Bounded: only one extra pass, and only if the first pass had failures.
  if (failedIds.length === 0) {
    return { total: ids.length, succeededFirstPass, recoveredOnRetry: 0, stillFailedIds: [] };
  }

  const retry = await Promise.allSettled(failedIds.map((id) => fn(id)));
  const recoveredOnRetry = retry.filter((r) => r.status === "fulfilled").length;
  const stillFailedIds = failedIds.filter((_, i) => retry[i].status === "rejected");

  return { total: ids.length, succeededFirstPass, recoveredOnRetry, stillFailedIds };
}
