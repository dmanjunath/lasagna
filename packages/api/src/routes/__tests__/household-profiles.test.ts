import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders + the tables settings.ts touches ──
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  users: { id: "users.id", name: "users.name", email: "users.email", tenantId: "users.tenantId", role: "users.role" },
  tenants: { id: "tenants.id", name: "tenants.name" },
  financialProfiles: { tenantId: "financialProfiles.tenantId" },
  userProfiles: { tenantId: "userProfiles.tenantId", userId: "userProfiles.userId" },
}));

// ── DB mock: overridable per-test via these handles ──
const usersFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const usersFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const financialProfilesFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const userProfilesFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: {
        findMany: (...a: unknown[]) => usersFindMany(...a),
        findFirst: (...a: unknown[]) => usersFindFirst(...a),
      },
      financialProfiles: { findFirst: (...a: unknown[]) => financialProfilesFindFirst(...a) },
      userProfiles: { findFirst: (...a: unknown[]) => userProfilesFindFirst(...a) },
    },
  },
}));

// billing.resolveTenantPlan isn't exercised by /household-profiles, but
// settings.ts imports it at module load — stub it so the import graph stays light.
vi.mock("../../lib/billing.js", () => ({
  resolveTenantPlan: vi.fn(async () => "free"),
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { settingsRoutes } from "../settings.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("/api/settings/*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/settings", settingsRoutes);
  return app;
}

const you: SessionPayload = { userId: "u-you", tenantId: "t-1", role: "owner", isDemo: false, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  usersFindMany.mockResolvedValue([]);
  financialProfilesFindFirst.mockResolvedValue(undefined);
  userProfilesFindFirst.mockResolvedValue(undefined);
});

describe("GET /household-profiles", () => {
  it("returns one entry per member with isYou and merged household+personal profiles", async () => {
    usersFindMany.mockResolvedValue([
      { id: "u-you", name: "You", email: "you@example.com" },
      { id: "u-partner", name: "Partner", email: "partner@example.com" },
    ]);
    // Shared household row (same for both members).
    financialProfilesFindFirst.mockResolvedValue({
      filingStatus: "married_joint",
      stateOfResidence: "CA",
      dependentCount: 1,
    });
    // Each member's personal row differs by userId → keyed off the where arg.
    userProfilesFindFirst.mockImplementation(async (arg: any) => {
      // where: and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId))
      const whereStr = JSON.stringify(arg?.where ?? arg);
      if (whereStr.includes("u-you")) {
        return { dateOfBirth: null, annualIncome: "150000", employmentType: "w2", riskTolerance: "moderate", retirementAge: 65, employerMatch: "5", hasHDHP: false, isPSLFEligible: false };
      }
      if (whereStr.includes("u-partner")) {
        return { dateOfBirth: null, annualIncome: "90000", employmentType: "1099", riskTolerance: "aggressive", retirementAge: 60, employerMatch: null, hasHDHP: true, isPSLFEligible: true };
      }
      return undefined;
    });

    const res = await appWithSession(you).request("/api/settings/household-profiles");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.members).toHaveLength(2);

    const meEntry = body.members.find((m: any) => m.userId === "u-you");
    expect(meEntry.isYou).toBe(true);
    expect(meEntry.name).toBe("You");
    // Personal (mine)
    expect(meEntry.profile.annualIncome).toBe(150000);
    expect(meEntry.profile.employmentType).toBe("w2");
    // Household (shared)
    expect(meEntry.profile.filingStatus).toBe("married_joint");
    expect(meEntry.profile.stateOfResidence).toBe("CA");
    expect(meEntry.profile.dependentCount).toBe(1);

    const partnerEntry = body.members.find((m: any) => m.userId === "u-partner");
    expect(partnerEntry.isYou).toBe(false);
    // Partner's personal fields are DIFFERENT from mine
    expect(partnerEntry.profile.annualIncome).toBe(90000);
    expect(partnerEntry.profile.employmentType).toBe("1099");
    expect(partnerEntry.profile.isPSLFEligible).toBe(true);
    // But shares the same household fields
    expect(partnerEntry.profile.filingStatus).toBe("married_joint");
    expect(partnerEntry.profile.dependentCount).toBe(1);
  });

  it("returns nulled personal fields for a member with no personal profile", async () => {
    usersFindMany.mockResolvedValue([{ id: "u-you", name: "You", email: "you@example.com" }]);
    financialProfilesFindFirst.mockResolvedValue({ filingStatus: "single", stateOfResidence: "NY", dependentCount: 0 });
    userProfilesFindFirst.mockResolvedValue(undefined);

    const res = await appWithSession(you).request("/api/settings/household-profiles");
    const body = await res.json();
    expect(body.members).toHaveLength(1);
    expect(body.members[0].profile.annualIncome).toBeNull();
    expect(body.members[0].profile.filingStatus).toBe("single");
    expect(body.members[0].isYou).toBe(true);
  });
});
