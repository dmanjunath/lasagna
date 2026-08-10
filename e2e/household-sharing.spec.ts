import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";

/**
 * End-to-end coverage for household account sharing.
 *
 * WorkOS Magic Auth is disabled in local dev, so a partner cannot complete the
 * real signup UI. The exercisable flow — and the seed+login bypass this repo
 * uses everywhere — drives auth through the local-mode auth API (a stored
 * password hash, no WorkOS link): the seeded owner logs in, invites a partner,
 * and the partner's signup runs `localSignUp` → `provisionUser`, whose invite
 * JOIN branch makes them a household `member` in the SAME tenant. From there we
 * assert pooled financial data, independent chat, owner-removes-member, and the
 * admin membership tooling — the entire Task 9 scenario.
 *
 * The owner comes from the shared seed (e2e/global-setup.ts → e2e/.test-user.json).
 * Because every test mutates the same tenant's membership, they run serially.
 */

const repoRoot = path.resolve(__dirname, "..");
const testUser = JSON.parse(readFileSync(path.resolve(__dirname, ".test-user.json"), "utf-8")) as {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
};

// A unique partner email per run so reruns never collide on the users unique index.
const partnerEmail = `partner-${testUser.tenantId.slice(0, 8)}@lasagna.local`;
const partnerPassword = "partnerpass123";

// psql helper against the local dev DB — mirrors insights-last-generated.spec.ts.
// Test setup on seed data only (promote the owner to admin; read ids).
function psql(sql: string): string {
  return execSync(`docker compose exec -T db psql -U lasagna -d lasagna -tA -c "${sql}"`, {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim();
}

// A fresh Playwright request context authenticated as the given credentials.
// Each context keeps its own cookie jar, so owner and partner sessions coexist.
async function loginContext(baseURL: string, email: string, password: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()}`).toBeTruthy();
  return ctx;
}

test.describe.configure({ mode: "serial" });

test.describe("Household account sharing", () => {
  let baseURL: string;
  let owner: APIRequestContext;

  test.beforeAll(async ({ baseURL: b }) => {
    baseURL = b!;
    owner = await loginContext(baseURL, testUser.email, testUser.password);
  });

  test.afterAll(async () => {
    // Best-effort cleanup: revoke any pending invites and delete the partner row
    // so a rerun starts clean. Local/seed DB only.
    try {
      psql(`DELETE FROM users WHERE email = '${partnerEmail}';`);
      psql(`DELETE FROM invites WHERE email = '${partnerEmail}';`);
    } catch {
      /* cleanup is best-effort */
    }
    await owner.dispose();
  });

  test("owner invites a partner; a pending invite appears in Settings → Household", async ({ page }) => {
    // Create the invite via the owner session (the Settings UI calls this same endpoint).
    const create = await owner.post("/api/household/invites", { data: { email: partnerEmail } });
    expect(create.ok()).toBeTruthy();
    const { invite } = (await create.json()) as { invite: { id: string; email: string } };
    expect(invite.email).toBe(partnerEmail);

    // The owner's Settings → Household section renders members + the pending invite.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a partner" })).toBeVisible();
    // Pending invite row shows the invited email.
    await expect(page.getByText(partnerEmail, { exact: false }).first()).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/household-owner-settings.png", fullPage: true });
  });

  test("the accept-invite page renders the household summary for a valid token", async ({ browser }) => {
    const token = psql(
      `SELECT token FROM invites WHERE email = '${partnerEmail}' AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1;`,
    );
    expect(token.length).toBeGreaterThan(20);

    // Public token-validate endpoint is reachable UNAUTHENTICATED (guard prefix
    // exemption). Assert via a cookie-less request context.
    const anon = await playwrightRequest.newContext({ baseURL });
    const validate = await anon.get(`/api/household/invite/${encodeURIComponent(token)}`);
    expect(validate.ok()).toBeTruthy();
    expect((await validate.json()).status).toBe("ok");
    await anon.dispose();

    // The /accept-invite page must be reachable LOGGED OUT (the recipient has no
    // account yet), so drive it from a fresh, cookie-less browser context.
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await page.goto(`/accept-invite?token=${encodeURIComponent(token)}`);
    await expect(page.getByText(/invited you to join their household|invited to join a household/i)).toBeVisible();
    await expect(
      page.getByText(/share the same accounts, balances, and financial picture/i),
    ).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/household-accept-invite.png", fullPage: true });
    await ctx.close();
  });

  test("a bad token shows an error on the accept-invite page", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await page.goto("/accept-invite?token=this-token-does-not-exist");
    await expect(page.getByText(/couldn't find this invitation|no longer valid/i)).toBeVisible();
    await ctx.close();
  });

  test("partner joins via signup and lands as a member at the income onboarding stage", async () => {
    // Local-mode signup runs provisionUser's invite JOIN branch (WorkOS is off in dev).
    const anon = await playwrightRequest.newContext({ baseURL });
    const signup = await anon.post("/api/auth/signup", {
      data: {
        email: partnerEmail,
        password: partnerPassword,
        name: "Partner",
        acceptedTos: true,
        acceptedPrivacy: true,
        acceptedNotRia: true,
      },
    });
    expect(signup.ok(), `partner signup failed: ${signup.status()}`).toBeTruthy();
    const { user, tenant } = (await signup.json()) as {
      user: { role: string; onboardingStage: string | null };
      tenant: { id: string };
    };
    // Joined the OWNER's tenant as a member at the income stage — no new tenant,
    // no accounts step (accounts are already pooled).
    expect(user.role).toBe("member");
    expect(user.onboardingStage).toBe("income");
    expect(tenant.id).toBe(testUser.tenantId);
    await anon.dispose();

    // The owner now sees two members in the household.
    const members = await (await owner.get("/api/household/members")).json();
    expect(members.members).toHaveLength(2);
    const partner = members.members.find((m: { email: string }) => m.email === partnerEmail);
    expect(partner.role).toBe("member");
  });

  test("both members see the same pooled accounts, but chat history is independent", async () => {
    const partner = await loginContext(baseURL, partnerEmail, partnerPassword);

    // (a) Pooled data: identical account sets for owner and partner.
    const ownerAccounts = await (await owner.get("/api/accounts")).json();
    const partnerAccounts = await (await partner.get("/api/accounts")).json();
    expect(partnerAccounts).toEqual(ownerAccounts);
    expect(Array.isArray(ownerAccounts) ? ownerAccounts.length : ownerAccounts.accounts?.length).toBeGreaterThan(0);

    // (b) Independent chat: the partner's thread is invisible to the owner.
    const before = await (await owner.get("/api/threads")).json();
    const create = await partner.post("/api/threads", { data: { title: "Partner private thread" } });
    expect(create.ok()).toBeTruthy();
    const partnerThreadId = (await create.json()).thread.id as string;

    const partnerThreads = await (await partner.get("/api/threads")).json();
    expect(partnerThreads.threads.some((t: { id: string }) => t.id === partnerThreadId)).toBeTruthy();

    const ownerThreadsAfter = await (await owner.get("/api/threads")).json();
    expect(ownerThreadsAfter.threads.some((t: { id: string }) => t.id === partnerThreadId)).toBeFalsy();
    expect(ownerThreadsAfter.threads).toHaveLength(before.threads.length);

    // The owner cannot open the partner's thread directly either → 404.
    const cross = await owner.get(`/api/threads/${partnerThreadId}`);
    expect(cross.status()).toBe(404);

    await partner.dispose();
  });

  test("owner removes the partner: their session dies and the pooled data is intact", async () => {
    const partner = await loginContext(baseURL, partnerEmail, partnerPassword);
    const partnerId = psql(`SELECT id FROM users WHERE email = '${partnerEmail}';`);

    const remove = await owner.delete(`/api/household/members/${partnerId}`);
    expect(remove.ok()).toBeTruthy();

    // The removed user's next request is unauthorized (their users row is gone).
    const afterRemoval = await partner.get("/api/accounts");
    expect(afterRemoval.status()).toBe(401);

    // Owner's pooled data is untouched; membership is back to just the owner.
    const ownerAccounts = await owner.get("/api/accounts");
    expect(ownerAccounts.ok()).toBeTruthy();
    const members = await (await owner.get("/api/household/members")).json();
    expect(members.members).toHaveLength(1);
    expect(members.members[0].email).toBe(testUser.email);

    // The partner's chat threads were cascade-deleted with their user row.
    expect(psql(`SELECT count(*) FROM chat_threads WHERE user_id = '${partnerId}';`)).toBe("0");

    await partner.dispose();
  });

  test("admin can view a tenant's members and move/remove a user", async () => {
    // Promote the seeded owner to admin (test setup on seed data only) so we can
    // reach the admin endpoints, then re-login to pick up the flag.
    psql(`UPDATE users SET is_admin = true WHERE id = '${testUser.userId}';`);
    const admin = await loginContext(baseURL, testUser.email, testUser.password);

    // Seed a second household member to move/remove.
    await admin.post("/api/household/invites", { data: { email: partnerEmail } });
    const anon = await playwrightRequest.newContext({ baseURL });
    const signup = await anon.post("/api/auth/signup", {
      data: {
        email: partnerEmail,
        password: partnerPassword,
        name: "Partner",
        acceptedTos: true,
        acceptedPrivacy: true,
        acceptedNotRia: true,
      },
    });
    expect(signup.ok()).toBeTruthy();
    await anon.dispose();
    const partnerId = psql(`SELECT id FROM users WHERE email = '${partnerEmail}';`);

    // Admin detail lists the tenant's members.
    const detail = await (await admin.get(`/api/admin/tenants/${testUser.tenantId}/detail`)).json();
    const detailEmails: string[] = (detail.users ?? detail.tenant?.users ?? []).map(
      (u: { email: string }) => u.email,
    );
    expect(detailEmails).toContain(partnerEmail);

    // Create a target tenant (fresh owner) and MOVE the partner into it.
    const otherEmail = `other-${testUser.tenantId.slice(0, 8)}@lasagna.local`;
    const other = await playwrightRequest.newContext({ baseURL });
    await other.post("/api/auth/signup", {
      data: {
        email: otherEmail,
        password: "otherpass123",
        name: "Other",
        acceptedTos: true,
        acceptedPrivacy: true,
        acceptedNotRia: true,
      },
    });
    await other.dispose();
    const otherTenantId = psql(`SELECT tenant_id FROM users WHERE email = '${otherEmail}';`);

    const move = await admin.post(`/api/admin/users/${partnerId}/move-tenant`, {
      data: { tenantId: otherTenantId },
    });
    expect(move.ok()).toBeTruthy();
    expect(psql(`SELECT tenant_id FROM users WHERE id = '${partnerId}';`)).toBe(otherTenantId);

    // Admin REMOVE deletes the user row.
    const del = await admin.delete(`/api/admin/users/${partnerId}`);
    expect(del.ok()).toBeTruthy();
    expect(psql(`SELECT count(*) FROM users WHERE id = '${partnerId}';`)).toBe("0");

    // Cleanup the throwaway "other" tenant/owner.
    psql(`DELETE FROM users WHERE email = '${otherEmail}';`);
    await admin.dispose();
  });
});
