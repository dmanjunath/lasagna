/**
 * Canonical email form. Emails are treated case-insensitively (the `users.email`
 * unique index is plain, so we keep stored values lowercase and normalize every
 * lookup to match). Trims surrounding whitespace and lowercases; tolerates
 * null/undefined so request handlers can normalize before validating presence.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}
