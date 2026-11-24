import { AccessibilityInfo, type ViewStyle } from "react-native";
import type { Palette } from "@/theme";

// The app's one pressed state for a tappable row or card: a slightly darker
// fill and a tiny shrink, so a tap reads as a press (owner decision
// 2026-11-23). Reduce Motion keeps the fill and drops the shrink.

/** How far a pressed row or card shrinks. */
export const PRESS_SCALE = 0.985;

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    reduceMotion = on;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
  reduceMotion = on;
});

/**
 * The pressed look for a Pressable's style callback, or nothing at rest. A row
 * inside a hero passes `fill` from usePressFill, so the press reads on the tint.
 */
export function pressFeedback(t: Pick<Palette, "canvasSunken">, pressed: boolean, fill?: string): ViewStyle | false {
  if (!pressed) return false;
  const backgroundColor = fill ?? t.canvasSunken;
  return reduceMotion ? { backgroundColor } : { backgroundColor, transform: [{ scale: PRESS_SCALE }] };
}

/** The pressed shrink alone, for a Pressable wrapping a Card that keeps its own fill. */
export function pressScale(pressed: boolean): ViewStyle | false {
  return pressed && !reduceMotion ? { transform: [{ scale: PRESS_SCALE }] } : false;
}
