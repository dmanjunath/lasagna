import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { font, themedStyles, type, useTheme } from "@/theme";
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

/**
 * The name in the theme's display face. Home's nav bar shows it in place of a
 * title. Under a character theme it is the heavy wordmark with "Fi" in the
 * brand ink. Without one (Classic) it is the web's: the display face at its
 * semibold, "Fi" in the brand color on the large signed-out lockup and plain
 * beside the mark in the drawer, as the web's login and sidebar draw it.
 */
export function BrandWordmark({ large }: { large?: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const fi = d.mascot ? t.brandInk : large ? d.color.brand : t.content;
  return (
    // Bar chrome: like the system's own bar titles it stops growing early with the text size.
    <Text
      style={[large ? type.largeTitle : type.title, !d.mascot && { fontFamily: font.headingSemibold }, { color: t.content }]}
      maxFontSizeMultiplier={1.2}
      accessibilityRole="header"
      accessibilityLabel="LasagnaFi"
    >
      Lasagna<Text style={{ color: fi }}>Fi</Text>
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
