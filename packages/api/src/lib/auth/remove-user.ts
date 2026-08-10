import { and, eq, users } from "@lasagna/core";
import { db } from "../db.js";
import { deleteWorkosUser } from "./workos.js";

/**
 * Delete a single user's login + WorkOS identity (best-effort — a WorkOS outage
 * must not block removal). Their tenant-scoped household data is untouched;
 * cascades remove only their per-user rows (userProfiles, chatThreads/messages).
 * Shared by the household leave/remove flow and the admin remove-user tool so
 * the teardown stays identical in both places.
 */
export async function removeUserRow(
  tenantId: string,
  target: { id: string; workosUserId: string | null },
): Promise<void> {
  if (target.workosUserId) {
    await deleteWorkosUser(target.workosUserId).catch((e) =>
      console.error(
        `[User] workos deleteUser failed (${target.workosUserId}):`,
        e instanceof Error ? e.message : e,
      ),
    );
  }
  await db.delete(users).where(and(eq(users.id, target.id), eq(users.tenantId, tenantId)));
}
