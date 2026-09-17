/**
 * The spend meter and the development cap that sit at the lib/llm.ts boundary.
 *
 * Tested with plain numbers, not model calls: the whole point of both is to be
 * exercisable without spending anything.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordLlmSpend,
  assertLlmSpendUnderCap,
  llmSpendTotalUsd,
  resetLlmSpend,
} from "../llm-spend.js";

const ORIGINAL = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV };

/** The meter reads the environment per call, so a case can move it. */
function setEnv(appEnv: string | undefined, nodeEnv: string | undefined) {
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}

const call = (source: string, costUsd: number) =>
  recordLlmSpend({ source, model: "~anthropic/claude-opus-latest", inputTokens: 4876, outputTokens: 358, costUsd });

beforeEach(() => {
  resetLlmSpend();
  setEnv("dev", "test");
  delete process.env.LLM_DEV_SPEND_CAP_USD;
});

afterEach(() => {
  vi.restoreAllMocks();
  setEnv(ORIGINAL.APP_ENV, ORIGINAL.NODE_ENV);
  delete process.env.LLM_DEV_SPEND_CAP_USD;
});

describe("the spend meter", () => {
  it("accumulates cost across calls", () => {
    call("strategy", 0.0333);
    call("strategy", 0.0102);
    call("chat", 0.002);
    expect(llmSpendTotalUsd()).toBeCloseTo(0.0455, 6);
  });

  it("prints source, model, tokens, dollars and the running total", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    call("strategy", 0.0333);
    expect(log).toHaveBeenCalledWith(
      "[llm] strategy ~anthropic/claude-opus-latest 4876in/358out $0.0333 (run total $0.03)",
    );
  });

  it("keeps the running total moving across printed lines", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    call("strategy", 0.1);
    call("strategy", 0.11);
    expect(log.mock.calls[1]?.[0]).toContain("(run total $0.21)");
  });

  it("prints nothing in production", () => {
    setEnv("production", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    call("strategy", 0.0333);
    expect(log).not.toHaveBeenCalled();
    // Still counted — production meters, it just does not narrate.
    expect(llmSpendTotalUsd()).toBeCloseTo(0.0333, 6);
  });

  it("treats a non-finite cost as zero rather than poisoning the total", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    call("strategy", 0.05);
    // A mocked logLlmUsage returns undefined; NaN here would disable the cap.
    call("strategy", undefined as unknown as number);
    call("strategy", NaN);
    expect(llmSpendTotalUsd()).toBeCloseTo(0.05, 6);
  });

  it("resets", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    call("strategy", 0.5);
    resetLlmSpend();
    expect(llmSpendTotalUsd()).toBe(0);
  });
});

describe("the development spend cap", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.LLM_DEV_SPEND_CAP_USD = "1";
  });

  it("allows calls while the total is under the cap", () => {
    call("strategy", 0.9);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("allows the call that crosses the cap, and stops the one after it", () => {
    call("strategy", 0.95);
    // Still under: this call is allowed to happen.
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
    call("strategy", 0.2); // total 1.15, over the cap of 1
    expect(() => assertLlmSpendUnderCap()).toThrow();
  });

  it("does not throw exactly at the cap", () => {
    call("strategy", 1);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("names the total, the cap, the biggest source and the env var", () => {
    call("chat", 0.1);
    call("strategy", 0.8);
    call("strategy", 0.4);
    let message = "";
    try {
      assertLlmSpendUnderCap();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("$1.30"); // the total
    expect(message).toContain("across 3 model calls"); // the call count
    expect(message).toContain("cap of $1.00"); // the cap
    expect(message).toContain("Biggest source: strategy ($1.20 over 2 calls)");
    expect(message).toContain("LLM_DEV_SPEND_CAP_USD");
  });

  it("NEVER throws in production, however far over the cap", () => {
    setEnv("production", "production");
    call("strategy", 500);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("is still off in production when only NODE_ENV says so", () => {
    setEnv("dev", "production");
    call("strategy", 500);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("honours a raised cap", () => {
    process.env.LLM_DEV_SPEND_CAP_USD = "10";
    call("strategy", 5);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("is disabled by a cap of 0", () => {
    process.env.LLM_DEV_SPEND_CAP_USD = "0";
    call("strategy", 99);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
  });

  it("defaults to a couple of dollars when unset", () => {
    delete process.env.LLM_DEV_SPEND_CAP_USD;
    call("strategy", 1.99);
    expect(() => assertLlmSpendUnderCap()).not.toThrow();
    call("strategy", 0.02); // total 2.01
    expect(() => assertLlmSpendUnderCap()).toThrow(/cap of \$2\.00/);
  });
});
