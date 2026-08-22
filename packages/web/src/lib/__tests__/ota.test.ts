import { describe, it, expect } from "vitest";
import { compareVersions, decideUpdate, type OtaManifest } from "../ota.js";

const manifest = (over: Partial<OtaManifest> = {}): OtaManifest => ({
  version: "1.2.0",
  url: "https://example.com/bundles/1.2.0.zip",
  checksum: "a".repeat(64),
  minNativeVersion: "1.0",
  ...over,
});

describe("compareVersions", () => {
  it("treats missing segments as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });
});

describe("decideUpdate", () => {
  it("applies a newer bundle the shell can run", () => {
    const d = decideUpdate(manifest(), "1.1.0", "1.0");
    expect(d).toEqual({ apply: true, manifest: manifest() });
  });

  it("skips only the version already running", () => {
    expect(decideUpdate(manifest(), "1.2.0", "1.0")).toEqual({ apply: false, reason: "up-to-date" });
    // "1.2" and "1.2.0" are the same bundle, so neither should trigger a swap.
    expect(decideUpdate(manifest({ version: "1.2" }), "1.2.0", "1.0")).toEqual({
      apply: false,
      reason: "up-to-date",
    });
  });

  it("applies an older bundle, which is how a rollback reaches devices", () => {
    // The manifest is authoritative in both directions: publishing an earlier
    // bundle is the only way to pull a bad release off installs already on it.
    expect(decideUpdate(manifest({ version: "1.1.0" }), "1.2.0", "1.0")).toMatchObject({
      apply: true,
    });
  });

  it("refuses a bundle that needs a newer native shell", () => {
    const d = decideUpdate(manifest({ minNativeVersion: "2.0" }), "1.1.0", "1.0");
    expect(d).toEqual({ apply: false, reason: "native-too-old" });
  });

  it("accepts a bundle whose minimum exactly matches the shell", () => {
    expect(decideUpdate(manifest({ minNativeVersion: "1.0.0" }), "1.1.0", "1.0")).toMatchObject({
      apply: true,
    });
  });

  it("fails closed when the running bundle version was not baked in", () => {
    // The plugin reports the shipped bundle as "builtin", so an unset
    // VITE_OTA_BUNDLE_VERSION must not be read as "older than everything".
    expect(decideUpdate(manifest(), "", "1.0")).toEqual({ apply: false, reason: "up-to-date" });
    expect(decideUpdate(manifest(), "builtin", "1.0")).toEqual({
      apply: false,
      reason: "up-to-date",
    });
  });

  it.each([
    ["null", null],
    ["no checksum", manifest({ checksum: "" })],
    ["plaintext http url", manifest({ url: "http://example.com/b.zip" })],
    ["non-numeric version", manifest({ version: "1.2.0-beta" })],
    ["missing minNativeVersion", { ...manifest(), minNativeVersion: undefined }],
  ])("rejects a malformed manifest (%s)", (_label, bad) => {
    expect(decideUpdate(bad, "1.1.0", "1.0")).toEqual({ apply: false, reason: "malformed" });
  });
});
