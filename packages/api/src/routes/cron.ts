import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { runSyncAll, runDailyInsights } from "../lib/cron.js";

// Service-to-service endpoints for Cloud Scheduler. Mounted at /cron (NOT under
// /api), so the /api/* user-auth and demo guards never apply — these calls
// carry no user session, only a shared secret.
export const cronRoutes = new Hono();

// Fail-closed shared-secret guard. Missing config → 503 (never run
// unprotected). Constant-time compare of X-Cron-Secret against CRON_SECRET.
cronRoutes.use("*", async (c, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: "cron secret not configured" }, 503);
  }
  const provided = c.req.header("X-Cron-Secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

cronRoutes.post("/sync", async (c) => {
  try {
    const proOnly = c.req.query("proOnly") === "true";
    const result = await runSyncAll(proOnly);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[Cron] /sync failed:", error);
    return c.json({ ok: false, error }, 500);
  }
});

cronRoutes.post("/insights", async (c) => {
  try {
    const result = await runDailyInsights();
    return c.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[Cron] /insights failed:", error);
    return c.json({ ok: false, error }, 500);
  }
});
