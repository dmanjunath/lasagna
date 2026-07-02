import { env } from "../env.js";
import { getWorkos } from "./mode.js";

export interface Identity { workosUserId: string; email: string; name: string | null; }
export type LoginResult =
  | { status: "ok"; identity: Identity }
  | { status: "needs_verification"; workosUserId: string; email: string };
export type SignUpResult = { status: "needs_verification"; workosUserId: string; email: string };

function toIdentity(u: { id: string; email: string; firstName?: string | null; lastName?: string | null }): Identity {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return { workosUserId: u.id, email: u.email, name: name || null };
}

function isVerificationRequired(err: unknown): boolean {
  const e = err as { code?: string; rawData?: { code?: string }; message?: string } | undefined;
  return e?.code === "email_verification_required"
    || e?.rawData?.code === "email_verification_required"
    || Boolean(e?.message?.includes("email_verification_required"));
}

function splitName(name?: string): { firstName?: string; lastName?: string } {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

export async function signUp(input: { email: string; password: string; name?: string }): Promise<SignUpResult> {
  const wm = getWorkos().userManagement;
  try {
    const user = await wm.createUser({ email: input.email, password: input.password, ...splitName(input.name) });
    await wm.sendVerificationEmail({ userId: user.id });
    return { status: "needs_verification", workosUserId: user.id, email: user.email };
  } catch (err) {
    // Already exists in WorkOS but likely never verified → resend instead of hard-failing.
    const found = await wm.listUsers({ email: input.email });
    const existing = found.data?.[0];
    if (existing) {
      await wm.sendVerificationEmail({ userId: existing.id });
      return { status: "needs_verification", workosUserId: existing.id, email: existing.email };
    }
    throw err;
  }
}

export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const wm = getWorkos().userManagement;
  const clientId = env.WORKOS_CLIENT_ID;
  try {
    const { user } = await wm.authenticateWithPassword({ clientId, email: input.email, password: input.password });
    return { status: "ok", identity: toIdentity(user) };
  } catch (err) {
    if (!isVerificationRequired(err)) throw err;
    const found = await wm.listUsers({ email: input.email });
    const existing = found.data?.[0];
    if (!existing) throw err;
    await wm.sendVerificationEmail({ userId: existing.id });
    return { status: "needs_verification", workosUserId: existing.id, email: existing.email };
  }
}

export async function verifyEmailCode(input: { workosUserId: string; code: string }): Promise<Identity> {
  const { user } = await getWorkos().userManagement.verifyEmail({ userId: input.workosUserId, code: input.code });
  return toIdentity(user);
}

export function googleAuthUrl(input: { state: string; redirectUri: string }): string {
  return getWorkos().userManagement.getAuthorizationUrl({
    clientId: env.WORKOS_CLIENT_ID,
    provider: "GoogleOAuth",
    redirectUri: input.redirectUri,
    state: input.state,
  });
}

export async function handleCallback(input: { code: string }): Promise<Identity> {
  const { user } = await getWorkos().userManagement.authenticateWithCode({ clientId: env.WORKOS_CLIENT_ID, code: input.code });
  return toIdentity(user);
}

export async function sendPasswordReset(input: { email: string }): Promise<void> {
  await getWorkos().userManagement.createPasswordReset({ email: input.email });
}

export async function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  await getWorkos().userManagement.resetPassword({ token: input.token, newPassword: input.newPassword });
}
