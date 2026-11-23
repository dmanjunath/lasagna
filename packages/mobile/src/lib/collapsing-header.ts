// The slim nav bar's state, from how far the page has scrolled. Pure and
// worklet-safe: the screen scaffold runs these on the UI thread.

/** The in-content title's frame, in the scroll content's coordinates. */
export type TitleFrame = { y: number; height: number };

const clamp01 = (v: number) => {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/**
 * How far the in-content title has passed under the bar: 0 while it shows in
 * full, 1 once it is gone. `scrolled` is the distance from the page's resting
 * position (0 at rest, negative while pulling to refresh). Before the title
 * has been measured, any scroll counts as gone. With Reduce Motion the bar
 * switches at the halfway point instead of following the finger.
 */
export function chromeProgress(scrolled: number, title: TitleFrame | null, reduceMotion: boolean): number {
  "worklet";
  const p = !title || title.height <= 0 ? (scrolled > 0 ? 1 : 0) : clamp01((scrolled - title.y) / title.height);
  return reduceMotion ? (p >= 0.5 ? 1 : 0) : p;
}

/** The bar's small title shows over the second half, once the big one is mostly gone. */
export function inlineTitleOpacity(progress: number): number {
  "worklet";
  return clamp01((progress - 0.5) * 2);
}

/** The bar's surface and its hairline come in with the title's passage. */
export function barOpacity(progress: number): number {
  "worklet";
  return clamp01(progress);
}
