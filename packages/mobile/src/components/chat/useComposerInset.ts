import { useRef, useState } from "react";
import { useWindowDimensions, type View } from "react-native";
import type React from "react";
import { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Keeps a composer at the foot of a screen above the tab bar at rest and
 * above the keyboard while it is up, following the keyboard frame by frame
 * (an interactive dismiss included). The screen's view may run under the tab
 * bar, so the gap is measured from where the view actually ends. Attach
 * `boxRef`/`onLayout` to the screen's outer view and draw `spacer` under the composer.
 */
export function useComposerInset() {
  const keyboard = useAnimatedKeyboard();
  const { height: screen } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const boxRef = useRef<React.ComponentRef<typeof View>>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  const onLayout = () =>
    boxRef.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const b = y + h;
      setBottom((v) => (v != null && Math.abs(v - b) < 0.5 ? v : b));
    });
  const end = bottom ?? screen;
  // What of the view the tab bar and home indicator cover (inside a tab the safe area includes the tab bar), and what the keyboard covers.
  const rest = Math.max(0, end - (screen - insets.bottom));
  const below = screen - end;
  const spacer = useAnimatedStyle(() => ({ height: Math.max(rest, keyboard.height.value - below) }), [rest, below]);
  return { boxRef, onLayout, spacer, keyboard };
}
