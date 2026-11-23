import { faviconUrl, tickerToIssuer } from "@web/components/ds/institutions";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, themedStyles, type, useTheme, weight } from "@/theme";

/**
 * A holding's tile, as the web's TickerIcon: the issuer's logo, else the
 * ticker's first letters. Cash is a banknote, not "CA" (audit W-27).
 * Decorative: the row names the holding.
 */
function TickerIconBase({ ticker }: { ticker: string }) {
  const t = useTheme();
  const d = useDesign();
  const cash = ticker.trim().toUpperCase() === "CASH";
  const url = cash ? null : faviconUrl(tickerToIssuer(ticker), 64);
  const [broken, setBroken] = useState(false);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, { borderRadius: d.radius.md, backgroundColor: t.faintFill, borderColor: t.line }]}>
      {cash ? (
        <SymbolView name="banknote" size={icon.md} tintColor={t.contentSecondary} />
      ) : url && !broken ? (
        <Image source={{ uri: url }} style={{ width: 24, height: 24, borderRadius: d.radius.xs }} onError={() => setBroken(true)} />
      ) : (
        <Text style={[styles.mono, { color: t.contentSecondary }]} maxFontSizeMultiplier={1.2}>
          {ticker.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export const TickerIcon = memo(TickerIconBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { width: 40, height: 40, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
    mono: { ...type.footnote, ...weight.bold },
  }),
);
