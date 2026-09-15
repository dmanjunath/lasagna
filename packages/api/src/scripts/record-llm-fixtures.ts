/**
 * Record LLM fixtures by driving the app's own routes.
 *
 * The prompt a fixture is keyed on has to be the prompt the app really builds,
 * so this script does not compose one. It signs a session for a seeded tenant
 * and calls the same HTTP handlers the browser calls; every model call on the
 * way past is captured by lib/llm-fixtures.ts.
 *
 *   LLM_FIXTURES=record pnpm -F @lasagna/api record:llm -- \
 *     --source insights --tenant <seeded-tenant-id>
 *
 * Sources:
 *   insights    one structured-output call
 *   chat        the agent loop (one call per tool round) plus the thread title
 *   all         both of the above
 *
 * THIS SPENDS MONEY. Every call is real and billed, and each prints its price.
 * Seeded or synthetic tenants only — never a real household.
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { users, chatThreads, eq } from "@lasagna/core";
import { env } from "../lib/env.js";
import { createSessionToken, COOKIE_NAME } from "../lib/session.js";
import { app } from "../server.js";

const { values: argv } = parseArgs({
  options: {
    source: { type: "string", default: "all" },
    tenant: { type: "string" },
    message: { type: "string", default: "How am I doing on my retirement savings?" },
  },
});

function die(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// LLM_FIXTURES=replay is a free dry run: it builds the app's real prompts and
// then misses, naming exactly what is missing. Worth doing before you spend.
// "off" would bill every call and save nothing, which is the whole problem.
if (env.LLM_FIXTURES !== "record" && env.LLM_FIXTURES !== "replay") {
  die(
    `LLM_FIXTURES is "${env.LLM_FIXTURES || "off"}". Set it to "record" to capture fixtures ` +
      `(real, billed calls) or "replay" for a free dry run that shows which are missing. ` +
      `"off" would bill every call and save nothing.`,
  );
}

const tenantId = String(argv.tenant ?? "");
if (!tenantId) {
  die(
    "Pass --tenant <seeded-tenant-id>. Fixtures are recorded against seeded or synthetic\n" +
      "tenants only, never a real household. `pnpm db:seed` makes one.",
  );
}

/** The seeded tenant's owner, whose session the app's routes run under. */
async function sessionCookie(): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.tenantId, tenantId)).limit(1);
  if (!user) die(`No user belongs to tenant ${tenantId}. Check the id, or run \`pnpm db:seed\`.`);
  const token = await createSessionToken({
    userId: user.id,
    tenantId,
    role: user.role ?? "owner",
    isDemo: false,
    isAdmin: false,
  });
  return `${COOKIE_NAME}=${token}`;
}

/** No Origin header: a non-browser client, which the CSRF guard lets through. */
async function call(path: string, cookie: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function recordInsights(cookie: string): Promise<void> {
  console.log("\n[record] insights: one structured-output call against the real prompt.");
  const res = await call("/api/insights/generate", cookie, {});
  console.log(`[record] insights: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function recordChat(cookie: string): Promise<void> {
  // A thread with no title makes the app generate one, which is the chat-title
  // call. Reusing a titled thread would silently skip it.
  const threadId = randomUUID();
  const [user] = await db.select().from(users).where(eq(users.tenantId, tenantId)).limit(1);
  await db.insert(chatThreads).values({ id: threadId, tenantId, userId: user!.id, title: null });
  console.log(`\n[record] chat: driving /api/chat on a fresh untitled thread.`);
  try {
    const res = await call("/api/chat", cookie, { threadId, message: String(argv.message) });
    console.log(`[record] chat: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  } finally {
    await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
  }
}

async function main(): Promise<void> {
  const cookie = await sessionCookie();
  const source = String(argv.source);
  console.log(
    env.LLM_FIXTURES === "record"
      ? "[record] LLM_FIXTURES=record. Every call below is real and billed, and prints its price."
      : "[record] LLM_FIXTURES=replay. Dry run: nothing is billed, and a miss names what to record.",
  );
  if (source === "insights" || source === "all") await recordInsights(cookie);
  if (source === "chat" || source === "chat-title" || source === "all") await recordChat(cookie);
  if (!["insights", "chat", "chat-title", "all"].includes(source)) {
    die(`Unknown --source "${source}". Use insights, chat, chat-title or all.`);
  }
  console.log("\n[record] Done. Fixtures are under packages/api/fixtures/llm.");
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("[record] failed:", e);
  process.exit(1);
});
