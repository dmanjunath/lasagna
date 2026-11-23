import { View } from "react-native";
import { useTheme } from "@/theme";

/** A rounded progress track with a colored fill. */
export function Track({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.canvasSunken, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** Proportional segments in one bar, with a 2pt gap between them. */
export function SegmentBar({ segments, height = 10 }: { segments: Array<{ key: string; value: number; color: string }>; height?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2, height, borderRadius: height / 2, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {segments.map(({ key, value: size, color }) => (
        <View key={key} style={{ flexGrow: size, flexBasis: 0, minWidth: size > 0 ? 4 : 0, backgroundColor: color }} />
      ))}
    </View>
  );
}
