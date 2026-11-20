/**
 * The token store needs a running Postgres reachable via DATABASE_URL (see
 * page-views-db.test.ts). Without one those cases self-skip. isDeadToken is
 * pure and always runs.
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, tenants, users, pushTokens } from "@lasagna/core";
import { db } from "../db.js";
import { isDeadToken, savePushToken, deletePushToken } from "../push.js";

const fcmError = (errorCode: string) => ({
  error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] },
});

describe("isDeadToken", () => {
  it("drops a token FCM reports as unregistered", () => {
    expect(isDeadToken(404, fcmError("UNREGISTERED"))).toBe(true);
  });

  it("drops a token FCM rejects as malformed", () => {
    expect(isDeadToken(400, fcmError("INVALID_ARGUMENT"))).toBe(true);
  });

  it("keeps the token on outages, quota and auth errors", () => {
    expect(isDeadToken(503, fcmError("UNAVAILABLE"))).toBe(false);
    expect(isDeadToken(429, fcmError("QUOTA_EXCEEDED"))).toBe(false);
    expect(isDeadToken(401, fcmError("THIRD_PARTY_AUTH_ERROR"))).toBe(false);
    expect(isDeadToken(500, null)).toBe(false);
  });
});

let tenantId: string | null = null;
let userA: string | null = null;
let userB: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "push.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const stamp = Date.now();
    const [a, b] = await db
      .insert(users)
      .values([
        { tenantId, email: `push-a-${stamp}@example.com` },
        { tenantId, email: `push-b-${stamp}@example.com` },
      ])
      .returning({ id: users.id });
    userA = a.id;
    userB = b.id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

const ownerOf = async (token: string) =>
  (await db.select({ userId: pushTokens.userId }).from(pushTokens).where(eq(pushTokens.token, token)))[0]?.userId;

describe("push token store", () => {
  it("moves a device's token to the user who signs in on it last", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    const token = `test-token-move-${Date.now()}`;
    await savePushToken(userA!, token, "ios");
    await savePushToken(userB!, token, "ios");
    expect(await ownerOf(token)).toBe(userB);
  });

  it("only lets the owner delete a token", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    const token = `test-token-delete-${Date.now()}`;
    await savePushToken(userA!, token, "ios");
    await deletePushToken(userB!, token);
    expect(await ownerOf(token)).toBe(userA);
    await deletePushToken(userA!, token);
    expect(await ownerOf(token)).toBeUndefined();
  });
});
