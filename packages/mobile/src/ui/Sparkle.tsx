import Svg, { Path } from "react-native-svg";
import { useTheme } from "@/design";

/** A four-point sparkle beside a win. Decorative. Nothing when the theme has no celebration. */
export function Sparkle({ size = 18 }: { size?: number }) {
  const d = useTheme();
  if (d.skin.celebration !== "sparkle") return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M30 6 L34 24 L52 28 L34 33 L30 52 L26 33 L8 28 L26 24Z" fill={d.color.celebration} />
    </Svg>
  );
}
