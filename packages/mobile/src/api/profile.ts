import type { FinancialProfile } from "@/lib/profile";
import { patch, post, request } from "./client";

// The Settings calls, mirroring packages/web/src/lib/api.ts.

export type Member = { userId: string; name: string | null; email: string; role: string; isYou: boolean; profile: FinancialProfile };
export type Invite = { id: string; email: string; role: string; expiresAt: string; createdAt: string };
export type Passkey = { id: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null };

export const profileApi = {
  get: () => request<{ financialProfile: FinancialProfile | null }>("/settings/financial-profile"),
  update: (data: Partial<FinancialProfile>) => patch<{ ok: boolean }>("/settings/financial-profile", data),
};

export const householdApi = {
  profiles: () => request<{ members: Member[] }>("/settings/household-profiles"),
  invites: () => request<{ invites: Invite[] }>("/household/invites"),
  invite: (email: string) => post<{ invite: Invite }>("/household/invites", { email }),
  revoke: (id: string) => request<{ ok: true }>(`/household/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  remove: (userId: string) => request<{ ok: true }>(`/household/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  leave: () => post<{ ok: true }>("/household/leave"),
};

export const securityApi = {
  setPassword: (password: string) => post<unknown>("/auth/set-password", { password }),
  passkeys: () => request<{ credentials: Passkey[] }>("/auth/webauthn/credentials"),
  removePasskey: (id: string) => request<{ ok: boolean }>(`/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const accountApi = {
  /** A passwordless account confirms deletion with an emailed code. */
  requestDeletionCode: () => post<{ ok: true }>("/account/deletion-code"),
  /** Permanent. Only ever called from the confirmed Delete account sheet. */
  remove: (proof: { password: string } | { code: string }) =>
    request<{ ok: true }>("/account", { method: "DELETE", body: JSON.stringify(proof) }),
};
