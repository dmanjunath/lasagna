import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";
import type { LinkSuccess } from "react-native-plaid-link-sdk";
import { accountsApi, invalidateAccounts } from "@/api/accounts";
import { committed, failed } from "@/ui/feedback";
import { institutionOf, type Item } from "./account-list";

// Plaid Link, native (react-native-plaid-link-sdk), with the flows of the web's
// useAccountConnections: a new institution, and update mode on one already
// connected (reconnect it, or add accounts opened since). It lives outside any
// screen: the Add account sheet closes before Link opens, and the wait for a
// new connection's accounts outlives it.
//
// OAuth banks return through the redirect URI the API puts in the link token,
// a universal link under the web host (see deep-links.ts PLAID_OAUTH_PATH).
// LinkKit resumes on its own when the app reopens on it.

type Phase = "idle" | "opening" | "syncing";
let phase: Phase = "idle";
const subs = new Set<() => void>();
const set = (p: Phase) => {
  phase = p;
  subs.forEach((f) => f());
};

/** What Plaid is doing: opening Link, or waiting for a new connection's accounts. */
export function usePlaidPhase(): Phase {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => phase,
  );
}

/** Loaded on first use, so a build without the native module only fails when a bank is connected. */
function sdk(): typeof import("react-native-plaid-link-sdk") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("react-native-plaid-link-sdk");
}

async function openLink(token: string, onSuccess: (s: LinkSuccess) => void) {
  const session = await sdk().createPlaidLinkSession({
    token,
    onSuccess,
    onExit: () => {
      if (phase === "opening") set("idle");
    },
    onEvent: () => {},
  });
  await session.open();
}

/** Polls the connections every 2s, up to 10 times, until `done` says the accounts are in. */
async function waitFor(done: (items: Item[]) => boolean): Promise<Item[] | null> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const { items } = await accountsApi.items();
      if (done(items) || i === 9) return items;
    } catch {
      return null;
    }
  }
  return null;
}

/** Link a new institution. One already connected is offered update mode instead, which keeps its accounts from duplicating. */
export async function connectBank(qc: QueryClient) {
  if (phase !== "idle") return;
  set("opening");
  try {
    const { linkToken } = await accountsApi.linkToken();
    await openLink(linkToken, (s) => void finishNew(qc, s));
  } catch {
    set("idle");
    failed("Couldn't open the bank connection. Try again in a moment.");
  }
}

async function finishNew(qc: QueryClient, { publicToken, metadata }: LinkSuccess) {
  const inst = metadata.institution;
  try {
    if (inst?.id) {
      const { items } = await accountsApi.items();
      const existing = items.find((i) => i.institutionId === inst.id);
      if (existing) {
        set("idle");
        Alert.alert(
          `${existing.institutionName ?? "This institution"} is already connected`,
          "Connecting it again would duplicate all of its accounts. To track a newly opened account, add it to your existing connection instead.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Add to existing connection", onPress: () => void updateConnection(qc, existing) },
          ],
        );
        return;
      }
    }
    await accountsApi.exchangeToken({ publicToken, institutionId: inst?.id, institutionName: inst?.name });
  } catch {
    set("idle");
    failed("Couldn't link that account. Try again.");
    return;
  }
  set("syncing");
  const items = await waitFor((all) => all.some((i) => i.institutionName === inst?.name && i.accounts.length > 0));
  set("idle");
  invalidateAccounts(qc);
  if (items) committed(`Connected ${inst?.name ?? "your bank"}`);
}

/** Plaid's update mode: reconnect a connection that needs it, or add accounts opened since. */
export async function updateConnection(qc: QueryClient, item: Item) {
  if (phase !== "idle") return;
  set("opening");
  const name = institutionOf(item);
  try {
    const { linkToken } = await accountsApi.updateLinkToken(item.id);
    await openLink(linkToken, () => void finishUpdate(qc, item));
  } catch {
    set("idle");
    failed(`Couldn't open the connection to ${name}. Try again.`);
  }
}

async function finishUpdate(qc: QueryClient, item: Item) {
  const prev = item.accounts.length;
  try {
    await accountsApi.syncPlaidItem(item.id);
  } catch {
    set("idle");
    failed(`Couldn't update ${institutionOf(item)}. Try again.`);
    return;
  }
  set("syncing");
  await waitFor((all) => (all.find((i) => i.id === item.id)?.accounts.length ?? 0) > prev);
  set("idle");
  invalidateAccounts(qc);
  committed(`${institutionOf(item)} is up to date`);
}
