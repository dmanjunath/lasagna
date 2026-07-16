import { describe, it, expect } from "vitest";
import { pathFromUrl } from "../native-shell.js";

describe("pathFromUrl", () => {
  it("extracts path+query from a universal link", () => {
    expect(pathFromUrl("https://app.lasagnafi.com/billing/success?x=1")).toBe("/billing/success?x=1");
  });
  it("returns null for junk", () => {
    expect(pathFromUrl("not a url")).toBeNull();
  });
});
