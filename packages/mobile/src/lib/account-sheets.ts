import { pushInTab } from "./navigation";

// The account sheets, opened inside the current tab's stack.

/** The Edit account sheet over an account. */
export function openAccountEdit(id: string) {
  pushInTab(`/account-edit?id=${encodeURIComponent(id)}`);
}

/** The Add account sheet, optionally on a form already typed and linked (?add=loan:mortgage&link=id). */
export function openAddAccount(params?: { add?: string; link?: string }) {
  const q = [params?.add && `add=${encodeURIComponent(params.add)}`, params?.link && `link=${encodeURIComponent(params.link)}`].filter(Boolean).join("&");
  pushInTab(`/add-account${q ? `?${q}` : ""}`);
}

// An account deleted from its Edit sheet: the account's page, under the
// sheet, steps back off it when it is in view again.
const deleted = new Set<string>();
export const markAccountDeleted = (id: string) => void deleted.add(id);
export function takeAccountDeleted(id: string): boolean {
  return deleted.delete(id);
}
