import { eq, users } from "@lasagna/core";
import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../password.js";
import { normalizeEmail } from "../normalize-email.js";
import { provisionUser } from "./provision.js";

export async function localSignUp(input: { email: string; password: string; name?: string }) {
  const email = normalizeEmail(input.email);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return { conflict: true as const };
  const passwordHash = await hashPassword(input.password);
  const { user, tenant } = await provisionUser({
    email, name: input.name ?? null, passwordHash, acceptedTerms: true, hasPassword: true,
  });
  return { conflict: false as const, user, tenant };
}

export async function localLogin(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !user.passwordHash) return null;
  const ok = await verifyPassword(input.password, user.passwordHash);
  return ok ? user : null;
}
