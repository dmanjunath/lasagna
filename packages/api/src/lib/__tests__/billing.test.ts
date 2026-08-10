import { describe, it, expect } from "vitest";
import { classifyPlanSource, checkoutReturnUrls } from "../billing.js";

const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("classifyPlanSource (comp precedence: paid > comped > demo > free)", () => {
  it("paid tenant → paid, even while comped", () => {
    expect(classifyPlanSource({ plan: "pro", compedUntil: null, hasDemoUser: false })).toBe("paid");
    expect(classifyPlanSource({ plan: "pro", compedUntil: future, hasDemoUser: false })).toBe("paid");
  });

  it("active comp → comped", () => {
    expect(classifyPlanSource({ plan: "free", compedUntil: future, hasDemoUser: false })).toBe("comped");
  });

  it("expired comp lapses on its own → free", () => {
    expect(classifyPlanSource({ plan: "free", compedUntil: past, hasDemoUser: false })).toBe("free");
  });

  it("revoked comp (null) → free", () => {
    expect(classifyPlanSource({ plan: "free", compedUntil: null, hasDemoUser: false })).toBe("free");
  });

  it("demo tenant → demo (unless comped, which outranks it)", () => {
    expect(classifyPlanSource({ plan: "free", compedUntil: null, hasDemoUser: true })).toBe("demo");
    expect(classifyPlanSource({ plan: "free", compedUntil: future, hasDemoUser: true })).toBe("comped");
  });

  it("expired comp on a demo tenant → demo", () => {
    expect(classifyPlanSource({ plan: "free", compedUntil: past, hasDemoUser: true })).toBe("demo");
  });
});

describe("checkoutReturnUrls", () => {
  it("web: profile URLs (unchanged behavior)", () => {
    expect(checkoutReturnUrls("https://app.example.com", false)).toEqual({
      successUrl: "https://app.example.com/profile?upgraded=1",
      cancelUrl: "https://app.example.com/profile",
    });
  });

  it("native: universal-link billing page", () => {
    expect(checkoutReturnUrls("https://app.example.com", true)).toEqual({
      successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/billing/success?canceled=1",
    });
  });
});
