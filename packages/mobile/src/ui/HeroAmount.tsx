import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { isAmountsHidden, subscribe, toggleAmountsHidden, useAmountsHidden } from "@/lib/hide-amounts";
import { dismissToast, showToast } from "./Toast";

// The page chrome contract's hide-amounts control: a tap on any hero amount
// (net worth, Spent, an account's balance) hides or shows every amount in the
// app. The switch in Settings does the same. The first time amounts hide, a toast
// says how to bring them back.

const EXPLAINED_KEY = "lf-hide-amounts-explained";

// The explanation on screen, if any. Amounts shown again (a second tap, or the
// switch in Settings) take it down at once, so it never contradicts the screen.
let explanation: number | null = null;
subscribe(() => {
  if (isAmountsHidden() || explanation === null) return;
  dismissToast(explanation);
  explanation = null;
});

/** Flips hide-amounts from a hero tap: a light haptic, and the one-time explanation. */
export async function toggleAmountsFromHero(): Promise<void> {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  toggleAmountsHidden();
  if (!isAmountsHidden()) return;
  const explained = await AsyncStorage.getItem(EXPLAINED_KEY).catch(() => "1");
  if (explained) return;
  AsyncStorage.setItem(EXPLAINED_KEY, "1").catch(() => {});
  // Shown again while the storage read was in flight: nothing to explain.
  if (!isAmountsHidden()) return;
  explanation = showToast({ tone: "positive", title: "Amounts hidden. Tap again to show." });
}

/**
 * A hero amount that toggles hide-amounts. `label` is what VoiceOver reads
 * (the figure's name and value, already masked when hidden).
 */
export function HeroAmount({ label, children, style }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const hidden = useAmountsHidden();
  return (
    <Pressable
      onPress={() => void toggleAmountsFromHero()}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hidden ? "Shows amounts across the app" : "Hides amounts across the app"}
      hitSlop={6}
      style={({ pressed }) => [{ alignSelf: "flex-start", maxWidth: "100%", opacity: pressed ? 0.6 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}
