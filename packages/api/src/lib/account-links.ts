const DEBT_TYPES = new Set(["credit", "loan"]);

/**
 * Can `account` link to `target` as its property? `target` is the tenant-scoped
 * lookup result: undefined = not found (or cross-tenant, since lookups are
 * tenant-scoped), null = explicit unlink. Returns an error message or null.
 */
export function validatePropertyLink(
  account: { type: string },
  target: { type: string } | null | undefined,
): string | null {
  if (!DEBT_TYPES.has(account.type)) {
    return "Only debt accounts (credit/loan) can be linked to a property";
  }
  if (target === null) return null; // unlink
  if (!target || target.type !== "real_estate") {
    return "Linked account must be an existing property (real_estate) account";
  }
  return null;
}
