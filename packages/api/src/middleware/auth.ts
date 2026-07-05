import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq, users } from "@lasagna/core";
import { db } from "../lib/db.js";
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

  // Stateless tokens can't be revoked by themselves — check the user row so
  // "sign out everywhere" and user deletion take effect immediately.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { sessionsRevokedAt: true },
  });
  if (!user) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  if (
    user.sessionsRevokedAt &&
    session.iat < Math.floor(user.sessionsRevokedAt.getTime() / 1000)
  ) {
    // Same message as any bad token — don't confirm to the holder that the
    // session was explicitly revoked.
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  c.set("session", session);
  await next();
});
