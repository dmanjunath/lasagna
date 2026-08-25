import { describe, it, expect } from "vitest";
import { scrubIds, beforeSend } from "../analytics.js";

// Placeholders only. The first is the canonical all-zero uuid, the second is a
// sentinel that exercises the hex letters the all-zero one cannot.
const UUID = "00000000-0000-0000-0000-000000000000";
const UUID_HEX = "deadbeef-dead-beef-dead-beefdeadbeef";

describe("scrubIds", () => {
  it("replaces a uuid in an absolute url", () => {
    expect(scrubIds(`https://app.lasagnafi.com/accounts/${UUID}`)).toBe(
      "https://app.lasagnafi.com/accounts/:id",
    );
    expect(scrubIds(`https://app.lasagnafi.com/accounts/${UUID_HEX}`)).toBe(
      "https://app.lasagnafi.com/accounts/:id",
    );
  });

  it("replaces ids on every id-bearing route", () => {
    expect(scrubIds(`/accounts/${UUID}`)).toBe("/accounts/:id");
    expect(scrubIds(`/plans/${UUID}`)).toBe("/plans/:id");
    expect(scrubIds(`/plans/savings/${UUID}`)).toBe("/plans/savings/:id");
    expect(scrubIds(`/financial-plans/${UUID}`)).toBe("/financial-plans/:id");
    expect(scrubIds(`/admin/users/${UUID}`)).toBe("/admin/users/:id");
  });

  it("replaces numeric and long opaque ids", () => {
    expect(scrubIds("/plans/4821")).toBe("/plans/:id");
    expect(scrubIds("/accounts/xxxxxxxxxxxxxxxx1234")).toBe("/accounts/:id");
  });

  it("leaves every real route path alone", () => {
    const routes = [
      "/",
      "/accept-invite",
      "/accounts",
      "/actions",
      "/admin",
      "/admin/spend",
      "/admin/users",
      "/billing/success",
      "/chat",
      "/debt",
      "/financial-level",
      "/financial-plans",
      "/forgot-password",
      "/goals",
      "/insights",
      "/login",
      "/money",
      "/onboarding",
      "/plans",
      "/plans/new",
      "/plans/retirement",
      "/portfolio",
      "/priorities",
      "/probability",
      "/profile",
      "/quick-import",
      "/reset-password",
      "/retirement",
      "/retirement-v2",
      "/s/action",
      "/settings",
      "/spending",
      "/tax",
      "/tax-history",
      "/transactions",
      "/verify-email",
    ];
    for (const route of routes) expect(scrubIds(route)).toBe(route);
  });

  it("keeps the url shape it was given", () => {
    expect(scrubIds("https://app.lasagnafi.com/accounts")).toBe(
      "https://app.lasagnafi.com/accounts",
    );
    expect(scrubIds("/accounts")).toBe("/accounts");
    expect(scrubIds("")).toBe("");
  });
});

describe("beforeSend", () => {
  it("scrubs both the url and the referrer", () => {
    const sent = beforeSend("event", {
      url: `https://app.lasagnafi.com/accounts/${UUID_HEX}`,
      referrer: `/plans/${UUID_HEX}`,
    });
    expect(sent).toEqual({
      url: "https://app.lasagnafi.com/accounts/:id",
      referrer: "/plans/:id",
    });
    expect(JSON.stringify(sent)).not.toContain(UUID_HEX);
  });

  it("passes through a payload with nothing to scrub", () => {
    expect(beforeSend("event", { url: "/money", referrer: "" })).toEqual({
      url: "/money",
      referrer: "",
    });
  });
});
