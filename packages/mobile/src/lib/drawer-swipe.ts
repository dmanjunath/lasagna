/**
 * Whether a left-edge swipe that let go at `x` (how far the app is pushed) opens
 * the drawer: past a quarter of the panel, unless flung back left, or on a
 * rightward flick from anywhere, like the system's own edge swipes.
 */
export function edgeSwipeOpens(x: number, width: number, velocityX: number): boolean {
  "worklet";
  return velocityX > 400 || (x > width * 0.25 && velocityX > -200);
}
