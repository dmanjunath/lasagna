/**
 * Canonical email form. Emails are treated case-insensitively (the `users.email`
 * unique index is plain, so we keep stored values lowercase and normalize every
 * lookup to match). Trims surrounding whitespace and lowercases; tolerates
 * null/undefined so request handlers can normalize before validating presence.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * The shape an address has to have to be one at all: something, an `@`,
 * something, a dot, something, and no whitespace anywhere.
 *
 * Deliberately the same expression the web client validates with, so a field
 * the browser accepted is never rejected by the server and vice versa. It is
 * not RFC 5322 and does not try to be: the job is to keep `abc` out of the
 * users table, not to decide which mailbox exists.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a NORMALIZED address is well formed. Normalize first: this rejects whitespace. */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}
