import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

// Same behavior as packages/web/src/lib/hide-amounts.ts: one module-wide flag
// every formatter reads, persisted across launches.
const STORAGE_KEY = "lf-hide-amounts";

export const HIDDEN_AMOUNT = "$•••••";

let hidden = false;
const subs = new Set<() => void>();

export function isAmountsHidden(): boolean {
  return hidden;
}

export function setAmountsHidden(on: boolean): void {
  if (on === hidden) return;
  hidden = on;
  (on ? AsyncStorage.setItem(STORAGE_KEY, "1") : AsyncStorage.removeItem(STORAGE_KEY)).catch(() => {});
  subs.forEach((f) => f());
}

export function toggleAmountsHidden(): void {
  setAmountsHidden(!hidden);
}

/** Reads the stored preference once at boot. */
export async function loadAmountsHidden(): Promise<void> {
  const v = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  setAmountsHidden(v === "1");
}

/** Calls `cb` on every change of the setting. Returns the unsubscribe. */
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, isAmountsHidden);
}

/**
 * Every currency-looking run in free text, as packages/web/src/lib/hide-amounts.ts
 * matches it. Anchored on a currency sigil, never on a bare number, so a year,
 * a step number, a percentage and a count are left alone.
 */
const CURRENCY_IN_TEXT =
  /(?:[-−–+]\s?)?(?:US\$|\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[KkMmBbTt]|thousand|million|billion|trillion)\b)?|(?:[-−–+]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:[KkMmBbTt]|thousand|million|billion|trillion))?\s?USD\b/g;

/** Masks the money inside server-composed copy. Pass-through when the mode is off. */
export function maskCurrencyInText(text: string): string {
  return hidden ? text.replace(CURRENCY_IN_TEXT, HIDDEN_AMOUNT) : text;
}
