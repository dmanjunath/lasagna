import { describe, it, expect, vi } from "vitest";
import { runWithRetry } from "../retry-failed.js";

describe("runWithRetry", () => {
  it("an id that fails once then succeeds on retry ends up succeeded, called twice", async () => {
    const calls: string[] = [];
    const fn = vi.fn(async (id: string) => {
      calls.push(id);
      // Fail only the first time we see this id.
      if (calls.filter((c) => c === id).length === 1) throw new Error("transient");
      return "ok";
    });

    const res = await runWithRetry(["a"], fn);

    expect(res.stillFailedIds).toEqual([]);
    expect(res.recoveredOnRetry).toBe(1);
    expect(res.succeededFirstPass).toBe(0);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "a");
    expect(fn).toHaveBeenNthCalledWith(2, "a");
  });

  it("an id that fails both times is reported as still-failed", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });

    const res = await runWithRetry(["b"], fn);

    expect(res.stillFailedIds).toEqual(["b"]);
    expect(res.recoveredOnRetry).toBe(0);
    // one first-pass attempt + one retry attempt = exactly two
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ids that succeed first time are NOT retried (fn called once)", async () => {
    const fn = vi.fn(async (id: string) => id);

    const res = await runWithRetry(["x", "y"], fn);

    expect(res.succeededFirstPass).toBe(2);
    expect(res.recoveredOnRetry).toBe(0);
    expect(res.stillFailedIds).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2); // once each, no retry pass
    expect(fn).toHaveBeenCalledWith("x");
    expect(fn).toHaveBeenCalledWith("y");
  });

  it("retry is bounded to a single extra pass; only failed ids retried", async () => {
    // "ok" succeeds first try; "flap" fails once then succeeds; "dead" always fails.
    const attempts: Record<string, number> = {};
    const fn = vi.fn(async (id: string) => {
      attempts[id] = (attempts[id] ?? 0) + 1;
      if (id === "ok") return "ok";
      if (id === "flap") {
        if (attempts[id] === 1) throw new Error("transient");
        return "ok";
      }
      throw new Error("permanent"); // "dead"
    });

    const res = await runWithRetry(["ok", "flap", "dead"], fn);

    // Bounded: succeed-first-pass ids attempted once, failed ids attempted twice.
    expect(attempts.ok).toBe(1); // never retried
    expect(attempts.flap).toBe(2); // one retry, then succeeded
    expect(attempts.dead).toBe(2); // one retry, still failed — no third attempt

    expect(res.succeededFirstPass).toBe(1);
    expect(res.recoveredOnRetry).toBe(1);
    expect(res.stillFailedIds).toEqual(["dead"]);
    // 3 first-pass + 2 retried = 5 total; proves no unbounded fan-out.
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

/**
 * The two brakes on what a run costs.
 *
 * Both are about the insights cron, where `fn` is a model call of roughly 16k
 * input tokens per tenant. The first pass used to start every one of them at
 * once, and the retry pass used to run no matter how badly the first pass went:
 * on one observed day 41 of 42 tenants failed, all 41 were retried, all 41
 * failed again, and the day cost double for nothing.
 */
describe("runWithRetry cost bounds", () => {
  /** Runs fn over ids, recording the highest number ever in flight at once. */
  async function peakConcurrency(ids: string[], settle: (id: string) => Promise<unknown>) {
    let inFlight = 0;
    let peak = 0;
    const fn = async (id: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        return await settle(id);
      } finally {
        inFlight--;
      }
    };
    const res = await runWithRetry(ids, fn);
    return { peak, res };
  }

  const ids = (n: number, prefix = "t") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("never has more than a handful in flight, however many ids there are", async () => {
    const { peak } = await peakConcurrency(ids(44), async (id) => {
      await new Promise((r) => setTimeout(r, 1));
      return id;
    });

    // The number itself is a policy choice; what matters is that it is a small
    // constant rather than ids.length.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("still settles every id despite batching", async () => {
    const seen: string[] = [];
    const res = await runWithRetry(ids(10), async (id) => {
      seen.push(id);
      return id;
    });

    expect(seen.sort()).toEqual(ids(10).sort());
    expect(res.succeededFirstPass).toBe(10);
    expect(res.total).toBe(10);
  });

  it("SKIPS the retry pass when most of the first pass failed", async () => {
    // 41 of 42, the observed shape: the dependency is down, not flaky.
    const fn = vi.fn(async (id: string) => {
      if (id === "t0") return id;
      throw new Error("model unavailable");
    });

    const res = await runWithRetry(ids(42), fn);

    // One attempt each and no more: the retry pass never ran.
    expect(fn).toHaveBeenCalledTimes(42);
    expect(res.retrySkipped).toBe(true);
    expect(res.recoveredOnRetry).toBe(0);
    expect(res.stillFailedIds).toHaveLength(41);
  });

  it("still retries when only a few failed, which is what flakiness looks like", async () => {
    const attempts: Record<string, number> = {};
    const fn = vi.fn(async (id: string) => {
      attempts[id] = (attempts[id] ?? 0) + 1;
      // Two of ten fail once, then recover.
      if ((id === "t0" || id === "t1") && attempts[id] === 1) throw new Error("transient");
      return id;
    });

    const res = await runWithRetry(ids(10), fn);

    expect(res.retrySkipped).toBe(false);
    expect(res.recoveredOnRetry).toBe(2);
    expect(res.stillFailedIds).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(12);
  });

  it("retries at exactly half failed, and not above it", async () => {
    // Three of six is not "most of them", so the retry is still worth paying for.
    const half = vi.fn(async (id: string) => {
      if (id === "t0" || id === "t1" || id === "t2") throw new Error("down");
      return id;
    });
    expect((await runWithRetry(ids(6), half)).retrySkipped).toBe(false);

    // Four of six is.
    const overHalf = vi.fn(async (id: string) => {
      if (id === "t4" || id === "t5") return id;
      throw new Error("down");
    });
    expect((await runWithRetry(ids(6), overHalf)).retrySkipped).toBe(true);
  });

  it("always retries a small set, where a failure rate means nothing", async () => {
    // Every id failed, but three ids failing is not evidence that a shared
    // dependency is down — and skipping the retry would lose a real self-heal.
    const attempts: Record<string, number> = {};
    const fn = vi.fn(async (id: string) => {
      attempts[id] = (attempts[id] ?? 0) + 1;
      if (attempts[id] === 1) throw new Error("transient");
      return id;
    });

    const res = await runWithRetry(ids(3), fn);

    expect(res.retrySkipped).toBe(false);
    expect(res.recoveredOnRetry).toBe(3);
    expect(res.stillFailedIds).toEqual([]);
  });
});
