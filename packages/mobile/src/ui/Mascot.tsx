import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { useTheme } from "@/design";
import { ARM_BOX, ARM_SHOULDER, BLINK_EVERY, BLINK_LIDS, BLINK_MS, BLINK_START, LID_BOX, LID_SVG, splitWavingArm } from "@lasagna/design";

// The artwork is 140 by 124 (packages/design/src/mascot/*.svg).
const ASPECT = 124 / 140;

/**
 * The theme's character: `happy` greets, `sleepy` waits on an empty screen.
 * Renders nothing when the theme has no mascot. Decorative unless given a label.
 * The artwork's outline token (currentColor) takes the scheme's ink, so the
 * silhouette and arms read on a dark canvas as on a light one. Given `arm`
 * (degrees, on the UI thread), the raised arm is drawn on its own layer and
 * turns at the shoulder: a real wave, not a tilt of the whole body. With
 * `blink`, the happy artwork closes its eyes for a moment every few seconds
 * once the hello is over. Reduce Motion: no blink.
 */
export function Mascot({
  name,
  width,
  label,
  outline,
  arm,
  blink,
}: {
  name: "happy" | "sleepy";
  width: number;
  label?: string;
  /** The outline on a surface of the other scheme (the always-dark toast). */
  outline?: string;
  /** The waving arm's turn in degrees, 0 at rest. Only the happy artwork has a raised arm. */
  arm?: SharedValue<number>;
  /** Blink every few seconds (the happy artwork only). */
  blink?: boolean;
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
  const lids = blink && name === "happy" ? <Lids width={width} /> : null;
  if (!split || !arm) {
    if (!lids) return <SvgXml xml={mascot[name]} color={ink} width={width} height={height} {...a11y} />;
    return (
      <View style={{ width, height }} {...a11y}>
        <SvgXml xml={mascot[name]} color={ink} width={width} height={height} />
        {lids}
      </View>
    );
  }
  return (
    <View style={{ width, height }} {...a11y}>
      <WavingArm xml={split.arm} arm={arm} width={width} height={height} color={ink} />
      <SvgXml xml={split.body} color={ink} width={width} height={height} style={StyleSheet.absoluteFill} />
      {lids}
    </View>
  );
}

/**
 * A lid over each eye that drops from its top edge and lifts again, one blink
 * every BLINK_EVERY ms, starting after the hello wave.
 */
function Lids({ width }: { width: number }) {
  const reduceMotion = useReducedMotion();
  const shut = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    const half = { duration: BLINK_MS / 2, easing: Easing.inOut(Easing.quad) };
    shut.value = withDelay(
      BLINK_START,
      withRepeat(withSequence(withTiming(1, half), withTiming(0, half), withDelay(BLINK_EVERY - BLINK_MS, withTiming(0, { duration: 0 }))), -1),
    );
    return () => cancelAnimation(shut);
  }, [reduceMotion, shut]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: shut.value }] }));
  const k = width / 140;
  return BLINK_LIDS.map((l) => (
    <Animated.View
      key={l.x}
      pointerEvents="none"
      style={[{ position: "absolute", left: l.x * k, top: l.y * k, width: LID_BOX.w * k, height: LID_BOX.h * k, transformOrigin: "50% 0%" }, style]}
    >
      <SvgXml xml={LID_SVG} width={LID_BOX.w * k} height={LID_BOX.h * k} />
    </Animated.View>
  ));
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
