import { SvgXml } from "react-native-svg";
import { useTheme } from "@/design";

// The artwork is 140 by 124 (packages/design/src/mascot/*.svg).
const ASPECT = 124 / 140;

/**
 * The theme's character: `happy` greets, `sleepy` waits on an empty screen.
 * Renders nothing when the theme has no mascot. Decorative unless given a label.
 * The artwork's outline token (currentColor) takes the scheme's ink, so the
 * silhouette and arms read on a dark canvas as on a light one.
 */
export function Mascot({ name, width, label, outline }: { name: "happy" | "sleepy"; width: number; label?: string; /** The outline on a surface of the other scheme (the always-dark toast). */ outline?: string }) {
  const { mascot, color } = useTheme();
  if (!mascot) return null;
  return (
    <SvgXml
      xml={mascot[name]}
      color={outline ?? color.content}
      width={width}
      height={Math.round(width * ASPECT)}
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
    />
  );
}
