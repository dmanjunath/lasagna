// The happy artwork's raised arm (src/mascot/happy.svg) is one stroke from the
// shoulder at (122, 70) up to (134, 50) in a 140 by 124 box. For a real wave it
// is lifted out into its own layer and turned at the shoulder. Shared so the web
// and the native app wave the same arm the same way.

/** The raised arm's path: it starts at the shoulder. */
const ARM_PATH = /<path d="M122 70 L134 50"[^>]*\/>/;

/**
 * Room the arm layer draws into past the artwork's right and top edges, in
 * artwork units, so a wide wave is never clipped by the 140 by 124 box.
 */
export const ARM_ROOM = 24;
/** The arm layer's own box: the artwork plus ARM_ROOM to the right and above. */
export const ARM_BOX = { x: 0, y: -ARM_ROOM, w: 140 + ARM_ROOM, h: 124 + ARM_ROOM } as const;
/** The shoulder as fractions of the arm layer's box, for its transform origin. */
export const ARM_SHOULDER = { x: 122 / ARM_BOX.w, y: (70 - ARM_BOX.y) / ARM_BOX.h } as const;

/** The hello wave, as the native app plays it: degrees from the raised rest, clockwise. */
export const WAVE_OUT = 40;
export const WAVE_BACK = -18;
/** One half of a wave (out, or back), in ms. */
export const WAVE_HALF = 260;
/** The hello waits this long for the screen to settle before the arm starts. */
export const INTRO_DELAY = 400;
/** The hello's arm angles, one per half wave: three waves, then back to rest. */
export const HELLO_WAVE = [WAVE_OUT, WAVE_BACK, WAVE_OUT, WAVE_BACK, WAVE_OUT, 0] as const;

/**
 * The artwork without its raised arm, and the arm alone in its wider box, or
 * null where the artwork has no raised arm (the sleepy one, another theme's).
 */
export function splitWavingArm(svg: string): { body: string; arm: string } | null {
  const match = svg.match(ARM_PATH);
  const open = svg.match(/^<svg[^>]*>/);
  if (!match || !open) return null;
  const armOpen = open[0].replace(/viewBox="[^"]*"/, `viewBox="${ARM_BOX.x} ${ARM_BOX.y} ${ARM_BOX.w} ${ARM_BOX.h}"`);
  return { body: svg.replace(ARM_PATH, ""), arm: `${armOpen}${match[0]}</svg>` };
}

/**
 * Where the hand ends up for an arm turned `deg` degrees clockwise about the
 * shoulder, in the artwork's coordinates. The wave's bounds keep it right of
 * the body (x 124) and inside the arm layer's box.
 */
export function waveHand(deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const dx = 12;
  const dy = -20;
  return { x: 122 + dx * Math.cos(r) - dy * Math.sin(r), y: 70 + dx * Math.sin(r) + dy * Math.cos(r) };
}
