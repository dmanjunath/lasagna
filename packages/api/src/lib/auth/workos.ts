import { env } from "../env.js";
import { getWorkos } from "./mode.js";

export interface Identity { workosUserId: string; email: string; name: string | null; }
export type LoginResult =
  | { status: "ok"; identity: Identity }
  | { status: "needs_verification"; email: string };
export type SignUpResult = { status: "needs_verification"; email: string };

function toIdentity(u: { id: string; email: string; firstName?: string | null; lastName?: string | null }): Identity {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return { workosUserId: u.id, email: u.email, name: name || null };
}

export function friendlyError(err: unknown, fallback: string): string {
  const e = err as { rawData?: { message?: string; errors?: Array<{ message?: string }> }; message?: string; errors?: Array<{ message?: string }> } | undefined;
  return e?.rawData?.errors?.[0]?.message || e?.rawData?.message || e?.errors?.[0]?.message || e?.message || fallback;
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

export async function signUp(input: { email: string; password?: string; name?: string }): Promise<SignUpResult> {
  const wm = getWorkos().userManagement;
  try {
    const user = await wm.createUser({ email: input.email, ...(input.password ? { password: input.password } : {}), ...splitName(input.name) });
    await wm.createMagicAuth({ email: user.email });
    return { status: "needs_verification", email: user.email };
  } catch (err) {
    // Already exists in WorkOS but likely never verified → resend a Magic Auth code instead of hard-failing.
    const found = await wm.listUsers({ email: input.email });
    const existing = found.data?.[0];
    if (existing) {
      await wm.createMagicAuth({ email: existing.email });
      return { status: "needs_verification", email: existing.email };
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
    // Unverified → send a Magic Auth code (email-keyed); the client finishes on the code screen.
    await wm.createMagicAuth({ email: input.email });
    return { status: "needs_verification", email: input.email };
  }
}

export async function sendMagicAuth(input: { email: string }): Promise<void> {
  await getWorkos().userManagement.createMagicAuth({ email: input.email });
}

export async function deleteWorkosUser(workosUserId: string): Promise<void> {
  await getWorkos().userManagement.deleteUser(workosUserId);
}

export async function authenticateWithMagicAuth(input: { email: string; code: string }): Promise<Identity> {
  const { user } = await getWorkos().userManagement.authenticateWithMagicAuth({
    clientId: env.WORKOS_CLIENT_ID,
    email: input.email,
    code: input.code,
  });
  return toIdentity(user);
}

export async function hasWorkosUser(email: string): Promise<boolean> {
  const found = await getWorkos().userManagement.listUsers({ email });
  return Boolean(found.data?.[0]);
}

export async function setPassword(input: { workosUserId: string; password: string }): Promise<void> {
  await getWorkos().userManagement.updateUser({ userId: input.workosUserId, password: input.password });
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
