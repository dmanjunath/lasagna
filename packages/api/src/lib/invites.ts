import { randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface InviteRow {
  id: string;
  tenantId: string;
  email: string;
  role: "member" | "viewer";
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreateInviteDeps {
  findPending(tenantId: string, email: string): Promise<InviteRow | undefined>;
  revokeInvite(id: string): Promise<void>;
  insertInvite(row: {
    tenantId: string;
    email: string;
    role: "member" | "viewer";
    token: string;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<InviteRow>;
}

export async function createInvite(
  deps: CreateInviteDeps,
  input: { tenantId: string; email: string; role: "member" | "viewer"; invitedByUserId: string },
): Promise<InviteRow> {
  const stale = await deps.findPending(input.tenantId, input.email);
  if (stale) await deps.revokeInvite(stale.id); // frees the partial-unique slot (also covers expired-but-not-revoked)
  try {
    return await deps.insertInvite({
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      token: generateInviteToken(),
      invitedByUserId: input.invitedByUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
  } catch (err) {
    // A concurrent create for the same (tenantId, email) can win the
    // partial-unique race (invites_pending_tenant_email_idx). Rather than
    // surfacing a 500, treat it as idempotent and return the pending invite
    // that landed. If nothing pending is found, the failure was something else.
    const winner = await deps.findPending(input.tenantId, input.email);
    if (winner) return winner;
    throw err;
  }
}

export type ResolveResult =
  | { status: "ok"; invite: InviteRow }
  | { status: "expired" | "used" | "revoked" | "not_found" };

export function resolveInvite(invite: InviteRow | undefined, now = new Date()): ResolveResult {
  if (!invite) return { status: "not_found" };
  if (invite.revokedAt) return { status: "revoked" };
  if (invite.acceptedAt) return { status: "used" };
  if (invite.expiresAt <= now) return { status: "expired" };
  return { status: "ok", invite };
}
