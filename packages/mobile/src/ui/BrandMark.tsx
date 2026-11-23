import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { themedStyles, type, useTheme } from "@/theme";
import { Mascot } from "./Mascot";

/**
 * The brand mark in a size-by-size box. Where the theme has a mascot it is the
 * app icon's tile: the mascot on the brand fill. Else the LasagnaFi mark,
 * three amber waves, as packages/web/src/components/common/BrandMark.tsx
 * draws it (artwork 28 by 24).
 */
export function BrandMark({ size = 38 }: { size?: number }) {
  const d = useDesign();
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {d.mascot ? (
        <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.26, backgroundColor: d.color.brand }]}>
          <Mascot name="happy" width={size * 0.84} />
        </View>
      ) : (
        <Image source={require("../../assets/brand-mark.png")} style={{ width: size, height: (size * 24) / 28 }} />
      )}
    </View>
  );
}

/** The name in the theme's display face, "Fi" in the brand ink. Home's nav bar shows it in place of a title. */
export function BrandWordmark({ large }: { large?: boolean }) {
  const t = useTheme();
  return (
    // Bar chrome: like the system's own bar titles it stops growing early with the text size.
    <Text style={[large ? type.largeTitle : type.title, { color: t.content }]} maxFontSizeMultiplier={1.2} accessibilityRole="header" accessibilityLabel="LasagnaFi">
      Lasagna<Text style={{ color: t.brandInk }}>Fi</Text>
    </Text>
  );
}

/** The mark beside the wordmark: the drawer's header, and `large` on the signed-out screens. */
export function BrandLockup({ size = 30, large }: { size?: number; large?: boolean }) {
  return (
    <View style={styles.lockup} accessible accessibilityRole="header" accessibilityLabel="LasagnaFi">
      <BrandMark size={size} />
      <BrandWordmark large={large} />
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    lockup: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    tile: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  }),
);
