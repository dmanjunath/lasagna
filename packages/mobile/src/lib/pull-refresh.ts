import type { Skins } from "@lasagna/design";

/** What a pull to refresh draws: the theme's skin, or the system spinner alone. */
export type RefreshLook = Skins["refresh"] | "spinner";

/**
 * The indicator for a theme's refresh skin. Reduce Motion: the plain tinted
 * spinner, with no sliding, hopping or bobbing. A mascot skin on a theme
 * without a mascot falls back to the brand mark.
 */
export function refreshLook(skin: Skins["refresh"], { reduceMotion, hasMascot }: { reduceMotion: boolean; hasMascot: boolean }): RefreshLook {
  if (reduceMotion) return "spinner";
  if (skin === "mascot" && !hasMascot) return "brandPuff";
  return skin;
}

/**
 * The pull mascot's phases: following the pull, held while the screen
 * refetches, and leaving once it is done (a finish hop, then up under the bar).
 */
export const MASCOT_PHASE = { follow: 0, held: 1, leaving: 2 } as const;

/** How opaque the pull mascot is. Leaving, it fades out on its own clock, whatever the content's position. */
export function mascotOpacity(phase: number, pull: number, exit: number, rest: number): number {
  "worklet";
  if (phase === MASCOT_PHASE.held) return 1;
  if (phase === MASCOT_PHASE.leaving) return 1 - exit;
  return pull > rest ? 1 : 0;
}

/** A mascot that has left follows the next pull only once it is fully gone and the content is back at rest. */
export function mascotRearms(phase: number, pull: number, exit: number, rest: number): boolean {
  "worklet";
  return phase === MASCOT_PHASE.leaving && exit >= 1 && pull <= rest;
}
