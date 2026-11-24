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

/**
 * Whether a pull indicator may show while following the content: only during a
 * pull the user started. It arms when a drag begins and disarms once the drag
 * has ended and the content is back at rest. The offset alone is not enough: a
 * screen's content settles for a moment as a tab appears or the bar measures
 * itself, which reads as a pull of a few points.
 */
export function nextArmed(armed: boolean, dragging: boolean, pull: number, rest: number): boolean {
  "worklet";
  if (dragging) return true;
  if (armed && pull <= rest) return false;
  return armed;
}

/**
 * The one point a pull refreshes at, in points past rest. Crossing it is the
 * moment: the mascot dives into the sauce (or Home's waves and jumps), the
 * haptic fires, and from then on letting go refreshes. It sits well short of
 * the system control's own trigger (about 130 to 160pt on iOS 26), which used
 * to fire only after the dive, so the user had to keep pulling.
 */
export const PULL_TRIGGER = 88;

/**
 * Whether a pull is primed to refresh on release. It primes once a drag the
 * user started crosses the trigger, and stays primed (letting go anywhere after
 * that refreshes) until the refresh it starts is under way or the pull ends.
 * The trigger is an argument, not a default: a worklet does not capture a
 * module constant used only in a default parameter, so on the UI thread it
 * would not exist.
 */
export function nextPrimed(primed: boolean, armed: boolean, dragging: boolean, pull: number, trigger: number): boolean {
  "worklet";
  if (primed) return true;
  return armed && dragging && pull >= trigger;
}

/**
 * Whether a release (or the system control's own trigger, on a very long pull)
 * starts a refresh: only a primed pull, and never a second time while one is
 * already under way, so there is one refresh and one haptic per pull.
 */
export function shouldFire(primed: boolean, inFlight: boolean): boolean {
  return primed && !inFlight;
}

/** How opaque the pull mascot is. Leaving, it fades out on its own clock, whatever the content's position. */
export function mascotOpacity(phase: number, pull: number, exit: number, rest: number, armed = true): number {
  "worklet";
  if (phase === MASCOT_PHASE.held) return 1;
  if (phase === MASCOT_PHASE.leaving) return 1 - exit;
  return armed && pull > rest ? 1 : 0;
}

/** How far a pull has gone toward arming the refresh, 0 to 1, for the stretch that follows the finger. Only a user's pull counts. */
export function pullStretch(pull: number, rest: number, armed: boolean, span: number): number {
  "worklet";
  if (!armed || pull <= rest) return 0;
  return Math.min(1, (pull - rest) / span);
}

/**
 * The sauce pool under the pull mascot, 0 to 1: it forms as the user pulls,
 * stays full while the mascot is in it, and drains as the mascot leaves.
 */
export function poolScale(phase: number, pull: number, rest: number, armed: boolean, span: number, exit: number): number {
  "worklet";
  if (phase === MASCOT_PHASE.held) return 1;
  if (phase === MASCOT_PHASE.leaving) return Math.max(0, 1 - exit);
  return pullStretch(pull, rest, armed, span);
}

/** How far into the sauce the mascot sinks while the screen refetches, as a share of its height: its face stays above. */
export const DIVE_DEPTH = 0.32;

/** A refresh that finishes faster than this still shows its indicator this long, so the hop and the bob read. */
export const MIN_REFRESH_MS = 900;

/** A mascot that has left follows the next pull only once it is fully gone and the content is back at rest. */
export function mascotRearms(phase: number, pull: number, exit: number, rest: number): boolean {
  "worklet";
  return phase === MASCOT_PHASE.leaving && exit >= 1 && pull <= rest;
}

/** After the finger lifts, the indicator stays this long, so the bob and the finish read once the content is free. */
export const AFTER_RELEASE_MS = 700;

/**
 * How much longer a finished refresh stays on screen, in ms. A refresh arms as
 * the pull passes its threshold, while the finger is still down, and a fast one
 * is done before the finger lifts, so its hop and bob would play hidden in the
 * drag. It stays on at least MIN_REFRESH_MS from its start and, once the finger
 * has lifted (`releasedAt`; null while it is still down), AFTER_RELEASE_MS more.
 */
export function holdRemaining(startedAt: number, now: number, releasedAt: number | null = 0, min = MIN_REFRESH_MS, after = AFTER_RELEASE_MS): number {
  if (releasedAt === null) return Infinity;
  const fromStart = min - (now - startedAt);
  const fromRelease = releasedAt >= startedAt ? after - (now - releasedAt) : 0;
  return Math.max(0, fromStart, fromRelease);
}

let greeted = false;
/** True only the first time it is asked in an app session: Home's mascot pops in and waves once, not on every tab switch or remount. */
export function takeGreetingIntro(): boolean {
  if (greeted) return false;
  greeted = true;
  return true;
}
/** For tests. */
export function resetGreetingIntro() {
  greeted = false;
}
