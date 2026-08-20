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
