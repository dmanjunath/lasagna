import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { useTheme } from "@/design";
import { ARM_BOX, ARM_SHOULDER, splitWavingArm } from "@/lib/mascot-arm";

// The artwork is 140 by 124 (packages/design/src/mascot/*.svg).
const ASPECT = 124 / 140;

/**
 * The theme's character: `happy` greets, `sleepy` waits on an empty screen.
 * Renders nothing when the theme has no mascot. Decorative unless given a label.
 * The artwork's outline token (currentColor) takes the scheme's ink, so the
 * silhouette and arms read on a dark canvas as on a light one. Given `arm`
 * (degrees, on the UI thread), the raised arm is drawn on its own layer and
 * turns at the shoulder: a real wave, not a tilt of the whole body.
 */
export function Mascot({
  name,
  width,
  label,
  outline,
  arm,
}: {
  name: "happy" | "sleepy";
  width: number;
  label?: string;
  /** The outline on a surface of the other scheme (the always-dark toast). */
  outline?: string;
  /** The waving arm's turn in degrees, 0 at rest. Only the happy artwork has a raised arm. */
  arm?: SharedValue<number>;
}) {
  const { mascot, color } = useTheme();
  if (!mascot) return null;
  const height = Math.round(width * ASPECT);
  const ink = outline ?? color.content;
  const a11y = {
    accessible: !!label,
    accessibilityLabel: label,
    accessibilityElementsHidden: !label,
    importantForAccessibility: (label ? "yes" : "no-hide-descendants") as "yes" | "no-hide-descendants",
  };
  const split = arm ? splitWavingArm(mascot[name]) : null;
  if (!split || !arm) return <SvgXml xml={mascot[name]} color={ink} width={width} height={height} {...a11y} />;
  return (
    <View style={{ width, height }} {...a11y}>
      <WavingArm xml={split.arm} arm={arm} width={width} height={height} color={ink} />
      <SvgXml xml={split.body} color={ink} width={width} height={height} style={StyleSheet.absoluteFill} />
    </View>
  );
}

/**
 * The arm alone, turning about the shoulder, drawn under the body as the
 * artwork draws it. Its layer runs past the artwork's right and top edges
 * (ARM_BOX), so a wide wave is never clipped.
 */
function WavingArm({ xml, arm, width, height, color }: { xml: string; arm: SharedValue<number>; width: number; height: number; color: string }) {
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${arm.value}deg` }] }));
  const k = width / 140;
  const w = ARM_BOX.w * k;
  const h = ARM_BOX.h * k;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: ARM_BOX.x * k, top: ARM_BOX.y * k, width: w, height: h, transformOrigin: `${ARM_SHOULDER.x * 100}% ${ARM_SHOULDER.y * 100}%` }, style]}
    >
      <SvgXml xml={xml} color={color} width={w} height={h} />
    </Animated.View>
  );
}
