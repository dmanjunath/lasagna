import { designVersion } from "./store";

/**
 * A module-level style sheet that follows the active design system. The
 * factory runs on first use and again after a switch, so the `type.*` and
 * `radius.*` it spreads are the active theme's. Use it where StyleSheet.create
 * would read theme tokens.
 */
export function themedStyles<T extends object>(factory: () => T): T {
  let built: T | null = null;
  let at = -1;
  const get = () => {
    if (built === null || at !== designVersion()) {
      built = factory();
      at = designVersion();
    }
    return built;
  };
  return new Proxy({} as T, {
    get: (_, key) => (get() as Record<PropertyKey, unknown>)[key],
    has: (_, key) => key in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Object.getOwnPropertyDescriptor(get(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
