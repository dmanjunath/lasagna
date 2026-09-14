/**
 * Operator switches that apply to the whole deployment.
 *
 * A flag with no row is off. That is the whole of the default rule: adding a
 * flag costs a name in `FEATURE_FLAGS` below and nothing else, and a database
 * that has never heard of a flag behaves exactly like one where it is off.
 *
 * Nothing here is tenant scoped. A flag is on for every user or none of them,
 * which is what makes it a release switch rather than a per-account setting.
 */

import { eq, featureFlags } from '@lasagna/core';
import { db } from './db.js';

/** Every flag this build knows about, with what it does in the operator's words. */
export const FEATURE_FLAGS = {
  journey_v2: {
    label: 'Model-built financial journey',
    description:
      'Build the financial journey with one model call that chooses the steps, their order and their targets, instead of the ranked rules engine. Applies to every user. Each household pays for one generation the next time they open the page.',
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

/** Whether a flag is on. Anything unreadable reads as off, never as on. */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  try {
    const [row] = await db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);
    return row?.enabled === true;
  } catch (e) {
    // A flag read must never take the app down. Off is the state that keeps
    // every household on the engine they are already on.
    console.error('[flags] could not read', key, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Every known flag with its current state, for the operator page. */
export async function readAllFlags(): Promise<
  Array<{ key: FeatureFlagKey; label: string; description: string; enabled: boolean; updatedAt: string | null }>
> {
  const rows = await db.select().from(featureFlags);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => ({
    key,
    label: FEATURE_FLAGS[key].label,
    description: FEATURE_FLAGS[key].description,
    enabled: byKey.get(key)?.enabled === true,
    updatedAt: byKey.get(key)?.updatedAt?.toISOString() ?? null,
  }));
}

/** Turn a flag on or off, recording who did it. */
export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
  userId: string,
): Promise<void> {
  await db
    .insert(featureFlags)
    .values({ key, enabled, updatedBy: userId })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled, updatedBy: userId, updatedAt: new Date() },
    });
}
