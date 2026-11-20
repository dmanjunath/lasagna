import { Hono } from "hono";
import { type AuthEnv } from "../middleware/auth.js";
import { savePushToken, deletePushToken } from "../lib/push.js";

export const pushRoutes = new Hono<AuthEnv>();

const PLATFORMS = new Set(["ios", "android"]);

// FCM tokens are ~160 characters. The cap only stops junk filling the table.
const cleanToken = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 && raw.length <= 4096 ? raw : null;

pushRoutes.post("/token", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{ token?: unknown; platform?: unknown }>().catch(() => null);
  const token = cleanToken(body?.token);
  const platform = typeof body?.platform === "string" && PLATFORMS.has(body.platform) ? body.platform : null;
  if (!token || !platform) return c.json({ error: "Invalid request" }, 400);
  await savePushToken(session.userId, token, platform);
  return c.json({ ok: true });
});

pushRoutes.delete("/token", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{ token?: unknown }>().catch(() => null);
  const token = cleanToken(body?.token);
  if (!token) return c.json({ error: "Invalid request" }, 400);
  await deletePushToken(session.userId, token);
  return c.json({ ok: true });
});
