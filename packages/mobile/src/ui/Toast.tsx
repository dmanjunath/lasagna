import * as Haptics from "expo-haptics";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme as useDesign } from "@/design";
import { palettes, radius, themedStyles, type, weight } from "@/theme";
import { Mascot } from "./Mascot";
import { Sparkle } from "./Sparkle";

type Toast = {
  id: number;
  title: string;
  /** `celebrate`: a win (a goal reached). The theme's happy mascot and a sparkle where it has them, else a positive toast. */
  tone: "positive" | "negative" | "celebrate";
  action?: { label: string; onPress: () => void };
  duration: number;
};

// One toast at a time, shown by ToastHost at the root.
let current: Toast | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Shows a toast in place of any on screen. Returns its id, for dismissToast. */
export function showToast(t: Omit<Toast, "id" | "duration"> & { duration?: number }): number {
  current = { duration: 4000, ...t, id: ++seq };
  AccessibilityInfo.announceForAccessibility(t.title);
  emit();
  return current.id;
}

/** Takes a toast down at once, if it is still the one on screen. */
export function dismissToast(id: number) {
  hide(id);
}

// Extra room under the toast while a bottom toolbar holds the screen's foot.
let lift = 0;

export function setToastLift(px: number) {
  if (px === lift) return;
  lift = px;
  emit();
}

function hide(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

export function ToastHost() {
  // Always the dark scheme's raised panel, so it stands off the page in either
  // mode, and its colors (the Undo's brand ink included) are that scheme's.
  const t = palettes.dark;
  const d = useDesign();
  const insets = useSafeAreaInsets();
  const toast = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
  const bottomLift = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => lift,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!toast) return;
    timer.current = setTimeout(() => hide(toast.id), toast.duration);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: "flex-end", paddingBottom: insets.bottom + 12 + bottomLift, paddingHorizontal: 16 }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(180)}
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: t.panelRaised, borderColor: t.line, boxShadow: t.shadowLg }]}
      >
        {toast.tone === "celebrate" && d.mascot ? (
          <View style={styles.art}>
            <Mascot name="happy" width={44} outline={t.content} />
            <View style={styles.sparkle}>
              <Sparkle size={16} />
            </View>
          </View>
        ) : (
          <View style={[styles.dot, { backgroundColor: toast.tone === "negative" ? t.dangerSolid : t.brand }]} />
        )}
        <Text style={[styles.title, { color: t.content }]} numberOfLines={3}>
          {toast.title}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            hitSlop={10}
            onPress={() => {
              Haptics.selectionAsync();
              toast.action?.onPress();
              hide(toast.id);
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.actionText, { color: t.brandInk }]}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderRadius: radius.lg,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  art: { marginLeft: -6, marginVertical: -2 },
  sparkle: { position: "absolute", right: -6, top: -4 },
  title: { ...type.subhead, ...weight.medium, flex: 1 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  actionText: { ...type.subhead, ...weight.bold },
}));
