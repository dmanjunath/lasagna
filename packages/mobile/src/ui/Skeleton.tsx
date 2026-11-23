import { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { radius, useTheme } from "@/theme";

/** A pulsing placeholder block. */
export function Skeleton({ width = "100%", height = 14, style }: { width?: DimensionValue; height?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius.xs, backgroundColor: t.canvasSunken }, anim, style]}
    />
  );
}
