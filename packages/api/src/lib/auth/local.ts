import { eq, users } from "@lasagna/core";
import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../password.js";
import { provisionUser } from "./provision.js";

export async function localSignUp(input: { email: string; password: string; name?: string }) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) return { conflict: true as const };
  const passwordHash = await hashPassword(input.password);
  const { user, tenant } = await provisionUser({
    email: input.email, name: input.name ?? null, passwordHash, acceptedTerms: true,
  });
  return { conflict: false as const, user, tenant };
}

export async function localLogin(input: { email: string; password: string }) {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (!user || !user.passwordHash) return null;
  const ok = await verifyPassword(input.password, user.passwordHash);
  return ok ? user : null;
}
