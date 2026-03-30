import { Hono } from "hono";
import { eq, users, tenants } from "@lasagna/core";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const settingsRoutes = new Hono<AuthEnv>();

settingsRoutes.use("*", requireAuth);

// Get profile
settingsRoutes.get("/profile", async (c) => {
  const session = c.get("session");

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
  });

  return c.json({
    profile: {
      email: user.email,
      name: tenant?.name || null,
      plan: tenant?.plan || "free",
      createdAt: user.createdAt,
    },
  });
});

// Update profile (name)
settingsRoutes.patch("/profile", async (c) => {
  const session = c.get("session");
  const { name } = await c.req.json<{ name?: string }>();

  if (name !== undefined) {
    if (!name.trim()) {
      return c.json({ error: "Name cannot be empty" }, 400);
    }
    await db
      .update(tenants)
      .set({ name: name.trim() })
      .where(eq(tenants.id, session.tenantId));
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
  });

  return c.json({
    profile: {
      name: tenant?.name || null,
      plan: tenant?.plan || "free",
    },
  });
});

// Change password
settingsRoutes.post("/change-password", async (c) => {
  const session = c.get("session");
  const { currentPassword, newPassword } = await c.req.json<{
    currentPassword: string;
    newPassword: string;
  }>();

  if (!currentPassword || !newPassword) {
    return c.json({ error: "Both current and new password are required" }, 400);
  }

  if (newPassword.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, session.userId));

  return c.json({ ok: true });
});
