// One-shot bounded retry over a set of ids, run a few at a time.
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
  /** True when the first pass failed so broadly that the retry was not worth paying for. */
  retrySkipped: boolean;
}

// How many ids are in flight at once. This used to be all of them: one
// `Promise.allSettled` over every id started 44 model calls of ~16k input
// tokens simultaneously, which is both the peak bill and the peak rate-limit
// pressure in one spike.
const CONCURRENCY = 4;

// Above this share of first-pass failures the retry pass is skipped. A handful
// of rejections is flakiness worth one more attempt; most of the set failing
// means the thing they all depend on is down, and retrying only doubles the
// bill for the same errors. Observed: 41 of 42 tenants failed, all 41 were
// retried, all 41 failed again.
const RETRY_FAILURE_RATE_CEILING = 0.5;

// ...but only once there are enough ids for the rate to mean anything. "One of
// one failed" is not evidence of a shared outage, it is one failure, and the
// retry it would otherwise skip is the cheap self-heal this function exists
// for. Below this many ids the retry always runs; a few extra calls is a
// rounding error next to skipping a recovery that would have worked.
const RETRY_MIN_SAMPLE = 5;

/** Run `fn` over `ids`, at most CONCURRENCY at a time, settling every one. */
async function settleInBatches(
  ids: string[],
  fn: (id: string) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const out: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    out.push(...(await Promise.allSettled(ids.slice(i, i + CONCURRENCY).map((id) => fn(id)))));
  }
  return out;
}

export async function runWithRetry(
  ids: string[],
  fn: (id: string) => Promise<unknown>
): Promise<RetryResult> {
  const first = await settleInBatches(ids, fn);
  const succeededFirstPass = first.filter((r) => r.status === "fulfilled").length;
  const failedIds = ids.filter((_, i) => first[i].status === "rejected");

  // Bounded: only one extra pass, and only if the first pass had failures.
  if (failedIds.length === 0) {
    return {
      total: ids.length,
      succeededFirstPass,
      recoveredOnRetry: 0,
      stillFailedIds: [],
      retrySkipped: false,
    };
  }

  if (
    ids.length >= RETRY_MIN_SAMPLE &&
    failedIds.length / ids.length > RETRY_FAILURE_RATE_CEILING
  ) {
    return {
      total: ids.length,
      succeededFirstPass,
      recoveredOnRetry: 0,
      stillFailedIds: failedIds,
      retrySkipped: true,
    };
  }

  const retry = await settleInBatches(failedIds, fn);
  const recoveredOnRetry = retry.filter((r) => r.status === "fulfilled").length;
  const stillFailedIds = failedIds.filter((_, i) => retry[i].status === "rejected");

  return {
    total: ids.length,
    succeededFirstPass,
    recoveredOnRetry,
    stillFailedIds,
    retrySkipped: false,
  };
}
