import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { themedStyles, type, useTheme } from "@/theme";

export const BULK_BAR_HEIGHT = 50;

type Action = { key: string; label: string; onPress: () => void; hidden?: boolean };

/** The selection's actions, pinned to the bottom like a toolbar. Every action applies one value to the whole selection. */
function BulkBarBase({ actions, disabled }: { actions: Action[]; disabled: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={SlideInDown.duration(200)}
      exiting={SlideOutDown.duration(160)}
      accessibilityRole="toolbar"
      accessibilityLabel="Edit selected transactions"
      style={[styles.bar, { paddingBottom: insets.bottom, backgroundColor: t.panelRaised, borderTopColor: t.line }]}
    >
      <View style={styles.row}>
        {actions
          .filter((a) => !a.hidden)
          .map((a) => (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityState={{ disabled }}
              hitSlop={6}
              style={({ pressed }) => [styles.btn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
            >
              {/* Like a system toolbar, the labels stop growing early so all four always fit. */}
              <Text style={[styles.label, { color: t.brandInk }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
                {a.label}
              </Text>
            </Pressable>
          ))}
      </View>
    </Animated.View>
  );
}

export const BulkBar = memo(BulkBarBase);

const styles = themedStyles(() => StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, zIndex: 4 },
  row: { height: BULK_BAR_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  btn: { minHeight: 44, minWidth: 44, flexShrink: 1, paddingHorizontal: 6, justifyContent: "center" },
  label: { ...type.body },
}));
