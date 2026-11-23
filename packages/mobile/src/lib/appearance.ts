import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { useSyncExternalStore } from "react";

// Light or dark on this device (the web's Dark mode switch). "auto" follows
// iOS. Set app-wide through Appearance, so every useColorScheme() and the
// system's own bars follow it. Persisted, and applied at boot.

export type AppearanceMode = "auto" | "light" | "dark";

const KEY = "lf-appearance";
let mode: AppearanceMode = "auto";
const subs = new Set<() => void>();

export const appearanceMode = () => mode;

export function setAppearanceMode(next: AppearanceMode) {
  mode = next;
  Appearance.setColorScheme(next);
  (next === "auto" ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, next)).catch(() => {});
  subs.forEach((f) => f());
}

/** Reads the saved choice once at boot. */
export async function loadAppearance(): Promise<void> {
  const v = await AsyncStorage.getItem(KEY).catch(() => null);
  if (v === "light" || v === "dark") {
    mode = v;
    Appearance.setColorScheme(v);
  }
}

export function useAppearanceMode(): AppearanceMode {
  return useSyncExternalStore((cb) => {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, appearanceMode);
}
