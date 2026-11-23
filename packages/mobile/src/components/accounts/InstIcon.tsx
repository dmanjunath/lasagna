import { faviconUrl, institutionDomainFor } from "@web/components/ds/institutions";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, themedStyles, type, useTheme, weight } from "@/theme";

/**
 * An institution's tile, as the web's InstIcon draws it: its logo, a pencil
 * for accounts entered by hand, or the name's first letter when there is no
 * logo. Decorative: the row names the institution.
 */
function InstIconBase({ institution, manual, size = 40 }: { institution: string; manual?: boolean; size?: number }) {
  const t = useTheme();
  const d = useDesign();
  const url = manual ? null : faviconUrl(institutionDomainFor(institution), 64);
  const [broken, setBroken] = useState(false);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: d.radius.md, backgroundColor: t.faintFill, borderColor: t.line }]}
    >
      {url && !broken ? (
        <Image source={{ uri: url }} style={{ width: size * 0.6, height: size * 0.6, borderRadius: d.radius.xs }} onError={() => setBroken(true)} />
      ) : manual ? (
        <SymbolView name="pencil" size={size < 36 ? icon.sm : icon.md} tintColor={t.contentMuted} />
      ) : (
        <Text style={[styles.mono, { color: t.contentSecondary }]} maxFontSizeMultiplier={1.2}>
          {(institution || "?").trim().charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export const InstIcon = memo(InstIconBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
    mono: { ...type.footnote, ...weight.bold },
  }),
);
