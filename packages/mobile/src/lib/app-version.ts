/** What a running update says about itself (from expo-updates). */
export type RunningUpdate = { enabled: boolean; embedded: boolean; commit?: string | null; updateId?: string | null };

/**
 * The Profile footer: the store build, and the over-the-air update running
 * on it, named by its commit, so a screenshot says exactly what code runs.
 * Builds without updates (development) show the build alone.
 */
export function versionLabel(version: string, build: string | undefined, update: RunningUpdate): string {
  const base = `Version ${version}${build ? ` (${build})` : ""}`;
  if (!update.enabled) return base;
  if (update.embedded) return `${base}, no update`;
  const id = update.commit?.slice(0, 7) || update.updateId?.slice(0, 8);
  return id ? `${base}, update ${id}` : base;
}
