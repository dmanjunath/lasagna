import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import {
  verifySessionToken,
  COOKIE_NAME,
  type SessionPayload,
} from "../lib/session.js";

export type AuthEnv = {
  Variables: {
    session: SessionPayload;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token =
    getCookie(c, COOKIE_NAME) ??
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  c.set("session", session);
  await next();
});
