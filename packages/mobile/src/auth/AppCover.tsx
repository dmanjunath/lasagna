import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { reportOpen } from "@/lib/app-open";
import { isLockEnabled, shouldLock } from "./biometric";

// The cover's art per the theme's brandArt skin, each a 2732px square drawn
// at the launch screen's frame, with where its art ends (for the Unlock button).
// `mascot` is the launch artwork (scripts/gen-brand-assets.mts: 520px wide at
// the centre, art 140 by 124). `mark` is the wave mark on the canvas, the
// cover the app had before the mascot.
const ART_PX = 2732;
const COVER_ART = {
  mascot: { light: require("../../assets/splash.png"), dark: require("../../assets/splash-dark.png"), bottomPx: ART_PX / 2 + (520 * 124) / 140 / 2 },
  mark: { light: require("../../assets/cover-mark.png"), dark: require("../../assets/cover-mark-dark.png"), bottomPx: 1513 },
} as const;

/**
 * The launch screen's artwork, drawn exactly as the launch screen draws it
 * (the whole square filling the screen, aspect fill) over the theme's canvas,
 * so going from launch to lock to app never moves or resizes the mascot.
 */
function SplashArt({ children }: { children?: React.ReactNode }) {
  const t = useTheme();
  const art = COVER_ART[useDesign().skin.brandArt];
  const dark = useColorScheme() === "dark";
  const { width, height } = useWindowDimensions();
  const side = Math.max(width, height);
  return (
    <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: t.canvas }]}>
      <Image
        source={dark ? art.dark : art.light}
        style={{ position: "absolute", width: side, height: side, left: (width - side) / 2, top: (height - side) / 2 }}
        accessibilityIgnoresInvertColors
        accessibilityLabel="LasagnaFi"
      />
      {children}
    </View>
  );
}

/** The mark's bottom edge on screen, for an aspect-fill square centred in a width by height window. */
export function markBottom(width: number, height: number, bottomPx: number = COVER_ART.mascot.bottomPx): number {
  const side = Math.max(width, height);
  return (height - side) / 2 + (side * bottomPx) / ART_PX;
}

/**
 * Covers the app, from the root, in two cases. The Face ID lock
 * (BiometricLock.tsx on the web): on a cold start and on a return after more
 * than a minute away, while signed in with the lock on, until Face ID or the
 * device passcode passes. And the app-switcher cover (the Capacitor app's
 * privacy screen): whenever the app is not active, so its snapshot shows the
 * splash rather than balances.
 */
export function AppCover({ signedIn }: { signedIn: boolean }) {
  const { width, height } = useWindowDimensions();
  const artBottomPx = COVER_ART[useDesign().skin.brandArt].bottomPx;
  const [locked, setLocked] = useState(() => shouldLock({ enabled: isLockEnabled(), signedIn, backgroundedAt: null, now: Date.now() }));
  const [inactive, setInactive] = useState(AppState.currentState !== "active");
  // Set when the app goes to the background, cleared once the return is judged.
  // The Face ID sheet itself makes the app inactive (not background), so a
  // return from it never re-locks.
  const backgroundedAt = useRef<number | undefined>(undefined);
  const prompting = useRef(false);
  // Prompt by itself once when the lock engages and once on each return from
  // the background, never on the app's own inactive and active bounce around
  // the Face ID sheet, or a Cancel would bring the sheet straight back.
  const autoPrompt = useRef(false);
  const signedInRef = useRef(signedIn);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock LasagnaFi", disableDeviceFallback: false });
      if (r.success) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    signedInRef.current = signedIn;
    if (!signedIn) setLocked(false);
  }, [signedIn]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") {
        backgroundedAt.current = Date.now();
        // Coming back from here is an open the user sees, so Home's mascot says hello again.
        reportOpen({ type: "background" });
      }
      if (s === "active") {
        const at = backgroundedAt.current;
        backgroundedAt.current = undefined;
        if (at !== undefined) autoPrompt.current = true;
        if (at !== undefined && shouldLock({ enabled: isLockEnabled(), signedIn: signedInRef.current, backgroundedAt: at, now: Date.now() })) {
          setLocked(true);
        }
      }
      setInactive(s !== "active");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (locked) autoPrompt.current = true;
  }, [locked]);

  // Whether anything covers the app, for the hello wave: it plays once the user can actually see Home.
  useEffect(() => {
    reportOpen({ type: "covered", covered: locked || inactive });
  }, [locked, inactive]);

  useEffect(() => {
    if (!locked || inactive || !autoPrompt.current) return;
    autoPrompt.current = false;
    void unlock();
  }, [locked, inactive, unlock]);

  if (locked) {
    return (
      <SplashArt>
        <View style={[styles.unlockRow, { top: markBottom(width, height, artBottomPx) + 40 }]}>
          {/* Neutral label: the passcode can stand in for Face ID. */}
          <Button title="Unlock" icon="faceid" iconLeading onPress={() => void unlock()} style={styles.unlock} />
        </View>
      </SplashArt>
    );
  }
  return inactive ? <SplashArt /> : null;
}

const styles = StyleSheet.create({
  cover: { zIndex: 100 },
  unlockRow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  unlock: { paddingHorizontal: 28 },
});
