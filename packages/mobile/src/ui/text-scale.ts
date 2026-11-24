import { useWindowDimensions } from "react-native";

// iOS keeps text measured at the size it was first laid out at. A text-size
// change while the app is open re-renders the JavaScript side, but a sentence
// or a row of figures can keep its old measurements and run off the edge until
// the app relaunches. A subtree keyed on this is laid out again at the new size,
// the way a design switch rebuilds the screens, without resetting navigation.

/** The key for a given text-size multiplier. */
export function textScaleKey(fontScale: number): string {
  return `scale-${Math.round(fontScale * 1000) / 1000}`;
}

/** A key that changes with the system text size. */
export function useTextScaleKey(): string {
  return textScaleKey(useWindowDimensions().fontScale);
}
