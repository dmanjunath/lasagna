import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSnapshot, pollRealEstateValue } from "../fetchRealEstateValues.js";

describe("parseSnapshot", () => {
  it("returns the estimate (not the listing price) when present", () => {
    const record = { price: 999999, zestimate: 742000, currency: "USD" };
    const result = parseSnapshot([record]);
    expect(result).toEqual({ status: "ready", value: 742000, currency: "USD" });
    // Guard: must read the estimate, never the listing price.
    if (result.status === "ready") {
      expect(result.value).not.toBe(999999);
    }
  });

  it("defaults currency to USD when absent", () => {
    const result = parseSnapshot([{ zestimate: 500000 }]);
    expect(result).toEqual({ status: "ready", value: 500000, currency: "USD" });
  });

  it("accepts a residential homeType", () => {
    const result = parseSnapshot([{ zestimate: 500000, homeType: "SINGLE_FAMILY" }]);
    expect(result).toEqual({ status: "ready", value: 500000, currency: "USD" });
  });

  it("rejects a non-residential homeType as no_home_value", () => {
    expect(parseSnapshot([{ zestimate: 500000, homeType: "COMMERCIAL" }])).toEqual({
      status: "failed",
      reason: "no home value for this address",
      kind: "no_home_value",
    });
  });

  it("honors a non-USD currency", () => {
    const result = parseSnapshot([{ zestimate: 500000, currency: "CAD" }]);
    expect(result).toEqual({ status: "ready", value: 500000, currency: "CAD" });
  });

  it("coerces a numeric-string estimate", () => {
    const result = parseSnapshot([{ zestimate: "630000" }]);
    expect(result).toEqual({ status: "ready", value: 630000, currency: "USD" });
  });

  it("treats a missing estimate as unavailable", () => {
    expect(parseSnapshot([{ price: 800000 }])).toEqual({
      status: "failed",
      reason: "no home value for this address",
      kind: "no_home_value",
    });
  });

  it("treats a non-numeric estimate as unavailable", () => {
    expect(parseSnapshot([{ zestimate: "n/a" }])).toEqual({
      status: "failed",
      reason: "no home value for this address",
      kind: "no_home_value",
    });
  });

  it("treats an empty array as unavailable", () => {
    expect(parseSnapshot([])).toEqual({
      status: "failed",
      reason: "no home value for this address",
      kind: "no_home_value",
    });
  });
});

describe("pollRealEstateValue", () => {
  const env = {
    REAL_ESTATE_VALUES_API_URL: "https://provider.test/datasets/v3",
    REAL_ESTATE_VALUES_API_KEY: "test-key",
    REAL_ESTATE_VALUES_DATASET_ID: "ds_test",
  };
  const prev = { ...process.env };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, prev);
  });

  function withEnv() {
    Object.assign(process.env, env);
  }

  it("maps HTTP 202 to pending", async () => {
    withEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "running" }), { status: 202 })),
    );
    expect(await pollRealEstateValue("sd_123")).toEqual({ status: "pending" });
  });

  it("maps a ready 200 array to the estimate value", async () => {
    withEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ price: 999999, zestimate: 742000, currency: "USD" }]), {
            status: 200,
          }),
      ),
    );
    expect(await pollRealEstateValue("sd_123")).toEqual({
      status: "ready",
      value: 742000,
      currency: "USD",
    });
  });
});
