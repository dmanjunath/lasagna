import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { AuthEnv } from "../../middleware/auth.js";

// Every write the goal routes can make, behind a spy. A rejected request must
// leave all of them untouched.
const insert = vi.fn(() => ({
  values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "goal-1", currentAmount: "0" }]) })),
}));
const update = vi.fn(() => ({
  set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "goal-1" }]) })) })),
}));
const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
const findFirst = vi.fn(async () => ({
  id: "goal-1",
  tenantId: "tenant-1",
  category: "home_purchase",
  targetAmount: "103500.00",
}));
const findMany = vi.fn(async () => []);
// The personal profile the deadline is dated from. Born mid-1994, so "by age
// 30" is 2024-06-15 and nothing about it is guessable from the target.
const profileFindFirst = vi.fn(async (): Promise<{ dateOfBirth: Date | null } | undefined> => ({
  dateOfBirth: new Date("1994-06-15T00:00:00Z"),
}));

vi.mock("../../lib/db.js", () => ({
  db: {
    insert,
    update,
    delete: del,
    query: {
      goals: { findFirst, findMany },
      goalAccounts: { findMany },
      goalSnapshots: { findMany },
      accounts: { findMany },
      userProfiles: { findFirst: profileFindFirst },
    },
  },
}));

const { goalRoutes } = await import("../goals.js");

function testApp() {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "owner",
      isDemo: false,
      isAdmin: false,
    });
    await next();
  });
  app.route("/goals", goalRoutes);
  return app;
}

function post(body: unknown) {
  return testApp().request("/goals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown) {
  return testApp().request("/goals/goal-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const homeDetails = {
  kind: "home_purchase",
  homePrice: 450_000,
  downPaymentPct: 20,
  includeClosingCosts: true,
  closingCostPct: 3,
  byAge: 30,
  byDate: null,
};

describe("POST /goals with details", () => {
  beforeEach(() => {
    insert.mockClear();
    update.mockClear();
    del.mockClear();
  });

  it("rejects details that do not match the goal's category, writing nothing", async () => {
    const res = await post({ name: "New car", targetAmount: 8000, category: "car", details: homeDetails });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("does not match goal category");
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("rejects details on a category that does not take them, writing nothing", async () => {
    const res = await post({ name: "Trip", targetAmount: 5000, category: "vacation", details: homeDetails });

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("stores the computed target, not the one the client sent", async () => {
    const res = await post({
      name: "First home",
      targetAmount: 1,
      category: "home_purchase",
      details: homeDetails,
    });

    expect(res.status).toBe(201);
    const values = insert.mock.results[0].value.values.mock.calls[0][0];
    expect(values.targetAmount).toBe("103500");
    expect(values.details).toMatchObject({ kind: "home_purchase", homePrice: 450_000 });
  });

  it("stores the date the age works out to, not the one the client sent", async () => {
    const res = await post({
      name: "First home",
      category: "home_purchase",
      details: homeDetails,
      deadline: "2099-01-01",
    });

    expect(res.status).toBe(201);
    const values = insert.mock.results[0].value.values.mock.calls[0][0];
    // Born 1994-06-15, so "by age 30" is 2024-06-15 — 2099 was never the goal.
    expect(values.deadline).toEqual(new Date("2024-06-15"));
  });

  it("refuses an age it cannot date, rather than storing one it made up", async () => {
    profileFindFirst.mockResolvedValueOnce(undefined);

    const res = await post({ name: "First home", category: "home_purchase", details: homeDetails });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("date of birth");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("PATCH /goals/:id with details", () => {
  beforeEach(() => {
    insert.mockClear();
    update.mockClear();
    del.mockClear();
  });

  it("rejects mismatched details before touching linked accounts", async () => {
    const res = await testApp().request("/goals/goal-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountIds: [],
        details: { kind: "car", vehiclePrice: 32_000, payCash: true },
      }),
    });

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    // reconcileGoalAccounts deletes before it inserts — neither may have run.
    expect(del).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps the date a goal was already saved by age with after the birth date goes", async () => {
    // The form still offers the age on a goal saved that way, so an edit must
    // not fail on a birth date the goal no longer needs.
    findFirst.mockResolvedValueOnce({
      id: "goal-1",
      tenantId: "tenant-1",
      category: "home_purchase",
      targetAmount: "103500.00",
      details: homeDetails,
    } as never);
    profileFindFirst.mockResolvedValueOnce(undefined);

    const res = await patch({ name: "First home", details: homeDetails });

    expect(res.status).toBe(200);
    expect(update.mock.results[0].value.set.mock.calls[0][0]).not.toHaveProperty("deadline");
  });

  it("re-dates the goal when the age changes, ignoring the client's date", async () => {
    const res = await patch({ details: { ...homeDetails, byAge: 40 }, deadline: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(update.mock.results[0].value.set.mock.calls[0][0].deadline).toEqual(
      new Date("2034-06-15"),
    );
  });
});
