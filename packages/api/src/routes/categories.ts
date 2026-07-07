// Tenant taxonomy management: GET the grouped taxonomy + CRUD for custom
// categories/groups, rename/disable for system rows (locked three exempt).
// Disabled categories are returned (flagged) — pickers filter client-side,
// historical rows still need names.

import { Hono } from "hono";
import { eq, and, sql, asc, categories, categoryGroups, transactions, categoryRules, recurringTransactions } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import {
  isLockedCategory,
  categoryPatchError,
  categoryDeleteError,
  groupPatchError,
} from "../lib/category-admin.js";

export const categoryRoutes = new Hono<AuthEnv>();

// GET / — grouped taxonomy (groups by sortOrder then name; categories by name)
categoryRoutes.get("/", async (c) => {
  const session = c.get("session");
  const [groupRows, catRows] = await Promise.all([
    db.select().from(categoryGroups)
      .where(eq(categoryGroups.tenantId, session.tenantId))
      .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.name)),
    db.select().from(categories)
      .where(eq(categories.tenantId, session.tenantId))
      .orderBy(asc(categories.name)),
  ]);
  const byGroup = new Map<string, typeof catRows>();
  for (const cat of catRows) {
    if (!byGroup.has(cat.groupId)) byGroup.set(cat.groupId, []);
    byGroup.get(cat.groupId)!.push(cat);
  }
  return c.json({
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      systemKey: g.systemKey,
      sortOrder: g.sortOrder,
      categories: (byGroup.get(g.id) ?? []).map((cat) => ({
        id: cat.id,
        name: cat.name,
        systemKey: cat.systemKey,
        emoji: cat.emoji,
        disabled: cat.disabledAt !== null,
        locked: isLockedCategory(cat),
        sortOrder: cat.sortOrder,
      })),
    })),
  });
});

// POST / — create a custom category in a tenant-owned group
categoryRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) return c.json({ error: "Name must be 1-80 characters" }, 400);
  const emoji = body.emoji == null || body.emoji === "" ? null : String(body.emoji);
  if (emoji && emoji.length > 8) return c.json({ error: "Emoji must be at most 8 characters" }, 400);
  const group = await db.query.categoryGroups.findFirst({
    where: and(eq(categoryGroups.id, String(body.groupId ?? "")), eq(categoryGroups.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!group) return c.json({ error: "Unknown group" }, 400);
  const [row] = await db.insert(categories)
    .values({ tenantId: session.tenantId, groupId: group.id, name, emoji })
    .returning();
  return c.json({ category: row });
});

// PATCH /:id — rename / disable / (custom only) emoji + group move
categoryRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();
  const cat = await db.query.categories.findFirst({
    where: and(eq(categories.id, id), eq(categories.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!cat) return c.json({ error: "Category not found" }, 404);
  const err = categoryPatchError(cat, body);
  if (err) return c.json({ error: err }, 400);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = (body.name as string).trim();
  if (body.emoji !== undefined) updates.emoji = body.emoji === "" || body.emoji === null ? null : String(body.emoji);
  if (body.disabled !== undefined) updates.disabledAt = body.disabled ? new Date() : null;
  if (body.groupId !== undefined) {
    const group = await db.query.categoryGroups.findFirst({
      where: and(eq(categoryGroups.id, String(body.groupId)), eq(categoryGroups.tenantId, session.tenantId)),
    }).catch(() => null);
    if (!group) return c.json({ error: "Unknown group" }, 400);
    updates.groupId = group.id;
  }
  if (Object.keys(updates).length === 0) return c.json({ category: cat });

  const [row] = await db.update(categories)
    .set(updates as any)
    .where(and(eq(categories.id, id), eq(categories.tenantId, session.tenantId)))
    .returning();
  return c.json({ category: row });
});

// DELETE /:id — custom only; reassigns every reference in one transaction
categoryRoutes.delete("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const cat = await db.query.categories.findFirst({
    where: and(eq(categories.id, id), eq(categories.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!cat) return c.json({ error: "Category not found" }, 404);
  const err = categoryDeleteError(cat);
  if (err) return c.json({ error: err }, 400);

  const reassignTo = String(body.reassignTo ?? "");
  if (!reassignTo || reassignTo === id) return c.json({ error: "reassignTo must be a different category" }, 400);
  const target = await db.query.categories.findFirst({
    where: and(eq(categories.id, reassignTo), eq(categories.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!target) return c.json({ error: "reassignTo must be a different category" }, 400);
  if (target.disabledAt !== null) return c.json({ error: "Cannot reassign to a disabled category" }, 400);

  let moved = 0;
  await db.transaction(async (tx) => {
    const movedRows = await tx.update(transactions)
      .set({ categoryId: target.id })
      .where(and(eq(transactions.tenantId, session.tenantId), eq(transactions.categoryId, id)))
      .returning({ id: transactions.id });
    moved = movedRows.length;
    await tx.update(categoryRules)
      .set({ setCategoryId: target.id })
      .where(and(eq(categoryRules.tenantId, session.tenantId), eq(categoryRules.setCategoryId, id)));
    await tx.update(categoryRules)
      .set({ matchCategoryId: target.id })
      .where(and(eq(categoryRules.tenantId, session.tenantId), eq(categoryRules.matchCategoryId, id)));
    await tx.update(recurringTransactions)
      .set({ categoryId: target.id })
      .where(and(eq(recurringTransactions.tenantId, session.tenantId), eq(recurringTransactions.categoryId, id)));
    await tx.delete(categories)
      .where(and(eq(categories.id, id), eq(categories.tenantId, session.tenantId)));
  });
  return c.json({ success: true, moved });
});

// POST /groups — create a custom group
categoryRoutes.post("/groups", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) return c.json({ error: "Name must be 1-80 characters" }, 400);
  if (!["income", "expense", "transfer"].includes(String(body.type))) {
    return c.json({ error: "type must be income, expense, or transfer" }, 400);
  }
  const [row] = await db.insert(categoryGroups)
    .values({ tenantId: session.tenantId, name, type: body.type, sortOrder: 1000 })
    .returning();
  return c.json({ group: row });
});

// PATCH /groups/:id — rename any group; type change on custom groups only
categoryRoutes.patch("/groups/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();
  const group = await db.query.categoryGroups.findFirst({
    where: and(eq(categoryGroups.id, id), eq(categoryGroups.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!group) return c.json({ error: "Group not found" }, 404);
  const err = groupPatchError(group, body);
  if (err) return c.json({ error: err }, 400);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = (body.name as string).trim();
  if (body.type !== undefined) updates.type = body.type;
  if (Object.keys(updates).length === 0) return c.json({ group });

  const [row] = await db.update(categoryGroups)
    .set(updates as any)
    .where(and(eq(categoryGroups.id, id), eq(categoryGroups.tenantId, session.tenantId)))
    .returning();
  return c.json({ group: row });
});

// DELETE /groups/:id — custom AND empty only (categories FK is restrict)
categoryRoutes.delete("/groups/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const group = await db.query.categoryGroups.findFirst({
    where: and(eq(categoryGroups.id, id), eq(categoryGroups.tenantId, session.tenantId)),
  }).catch(() => null);
  if (!group) return c.json({ error: "Group not found" }, 404);
  if (group.systemKey !== null) return c.json({ error: "System groups can't be deleted" }, 400);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.groupId, id));
  if (count > 0) return c.json({ error: "Move or delete its categories first" }, 400);
  await db.delete(categoryGroups)
    .where(and(eq(categoryGroups.id, id), eq(categoryGroups.tenantId, session.tenantId)));
  return c.json({ success: true });
});
