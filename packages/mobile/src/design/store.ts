import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME_ID, getTheme, themes } from "@lasagna/design";

// The active design system, outside React so the @/theme adapter's module-level
// objects and themedStyles() can read it. Persisted in AsyncStorage. The color
// scheme is not here: it follows the system and is applied by ThemeProvider.

const KEY = "lf_design";

let activeId = DEFAULT_THEME_ID;
let version = 0;
const listeners = new Set<() => void>();

export const activeTheme = () => getTheme(activeId);
/** Bumps on every switch, so caches keyed on it rebuild. */
export const designVersion = () => version;

export function subscribeDesign(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function apply(id: string) {
  const next = getTheme(id).meta.id;
  if (next === activeId) return;
  activeId = next;
  version++;
  listeners.forEach((l) => l());
}

/** Switches the design system live and remembers it. */
export function setDesign(id: string) {
  apply(id);
  void AsyncStorage.setItem(KEY, activeId).catch(() => {});
}

/** The saved choice, read once at boot before the first screen draws. */
export async function loadDesign(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved && themes.some((t) => t.meta.id === saved)) apply(saved);
  } catch {
    // Keep the default.
  }
}
