import { Hono } from "hono";
import { type AuthEnv } from "../middleware/auth.js";
import { recordPageView, findLastVisit } from "../lib/page-views.js";

export const pageViewRoutes = new Hono<AuthEnv>();

// Route path only. A query string or hash is dropped here as well as in the
// client, so search text can never land in this table.
const cleanPath = (raw: unknown): string | null => {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  const path = raw.split(/[?#]/)[0];
  return path.length > 0 && path.length <= 255 ? path : null;
};

pageViewRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown });
  const path = cleanPath(body.path);
  if (!path) return c.json({ error: "Invalid path" }, 400);
  await recordPageView({ userId: session.userId, tenantId: session.tenantId }, path);
  return c.json({ ok: true });
});

pageViewRoutes.get("/last-visit", async (c) => {
  const session = c.get("session");
  const last = await findLastVisit(session.userId);
  return c.json({ lastVisitAt: last ? last.toISOString() : null });
});
