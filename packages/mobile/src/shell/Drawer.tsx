import * as Haptics from "expo-haptics";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { edgeSwipeOpens } from "@/lib/drawer-swipe";
import { useTheme } from "@/theme";

// The push drawer of packages/web/src/components/layout/shell.tsx and
// mobile-nav.tsx. It does not cover the app: the nav bar, the page and the tab
// bar all slide right by the panel's width, so the screen you left stays in
// view beside the menu. One shared value (how far the app is pushed) drives the
// app, the panel and the scrim, and gestures write it on the UI thread.

const SPRING = { damping: 34, stiffness: 340, mass: 1 };
/** Touches that start this close to the left edge can open the drawer. */
const EDGE = 24;

/** min(80% of the width, 320), as drawerWidth() on the web. */
export function drawerWidth(screenWidth: number) {
  return Math.min(screenWidth * 0.8, 320);
}

type DrawerValue = { open: () => void; close: () => void; isOpen: boolean };
const DrawerContext = createContext<DrawerValue | null>(null);

export function useDrawer(): DrawerValue {
  const v = useContext(DrawerContext);
  if (!v) throw new Error("useDrawer outside DrawerShell");
  return v;
}

export function DrawerShell({
  children,
  panel,
  edgeSwipe,
}: {
  children: ReactNode;
  /** The menu. Gets `close` so a row can dismiss it after navigating. */
  panel: (close: () => void) => ReactNode;
  /** On a tab's root screen. On a pushed screen the edge belongs to the stack's back swipe. */
  edgeSwipe: boolean;
}) {
  const t = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const width = drawerWidth(screenWidth);
  const x = useSharedValue(0);
  const [isOpen, setOpen] = useState(false);
  // Whether any of the panel is on screen, read off the offset itself so it
  // can never disagree with what is drawn.
  const [shown, setShown] = useState(false);
  useAnimatedReaction(
    () => x.value > 0.5,
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setShown, now);
    },
  );

  const settle = useCallback(
    (open: boolean) => {
      setOpen(open);
      x.value = withSpring(open ? width : 0, SPRING);
    },
    [width, x],
  );

  const open = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    settle(true);
  }, [settle]);
  const close = useCallback(() => settle(false), [settle]);

  // Called on the JS thread when a gesture lets go. The spring already started on the UI thread.
  const commit = useCallback(
    (openNow: boolean) => {
      setOpen(openNow);
      if (openNow) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [],
  );

  // Left-edge swipe opens, with the push following the finger. It engages
  // after 12pt of travel that is at least 1.5 times as horizontal as vertical,
  // and commits past a quarter of the panel's width or on a rightward flick,
  // like the system's own edge swipes.
  // Where the touch went down. Shared values, since a worklet's captured objects don't carry writes between callbacks.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const edge = useMemo(() => {
    return Gesture.Pan()
      .enabled(edgeSwipe && !isOpen)
      .hitSlop({ left: 0, width: EDGE })
      .manualActivation(true)
      .onTouchesDown((e) => {
        startX.value = e.changedTouches[0].absoluteX;
        startY.value = e.changedTouches[0].absoluteY;
      })
      .onTouchesMove((e, state) => {
        const touch = e.changedTouches[0];
        const dx = touch.absoluteX - startX.value;
        const dy = Math.abs(touch.absoluteY - startY.value);
        if (dx > 12 && dx > dy * 1.5) state.activate();
      })
      .onTouchesUp((_e, state) => state.end())
      .onUpdate((e) => {
        x.value = Math.max(0, Math.min(width, e.translationX));
      })
      .onEnd((e) => {
        const openNow = edgeSwipeOpens(x.value, width, e.velocityX);
        x.value = withSpring(openNow ? width : 0, SPRING);
        scheduleOnRN(commit, openNow);
      });
  }, [edgeSwipe, isOpen, width, x, startX, startY, commit]);

  // A swipe left on the menu or the pushed screen closes it, the push following
  // the finger. It commits past 64pt or on a flick faster than 400pt/s, and
  // otherwise springs back open.
  const makeClosePan = useCallback(
    () =>
      Gesture.Pan()
        .enabled(isOpen)
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          x.value = Math.max(0, Math.min(width, width + e.translationX));
        })
        .onEnd((e) => {
          const closeNow = e.translationX < -64 || e.velocityX < -400;
          x.value = withSpring(closeNow ? 0 : width, SPRING);
          if (closeNow) scheduleOnRN(setOpen, false);
        }),
    [isOpen, width, x],
  );
  const panelPan = useMemo(makeClosePan, [makeClosePan]);
  const scrimGesture = useMemo(
    () =>
      Gesture.Race(
        makeClosePan(),
        Gesture.Tap()
          .enabled(isOpen)
          .onEnd((_e, ok) => {
            if (ok) scheduleOnRN(close);
          }),
      ),
    [makeClosePan, isOpen, close],
  );

  const appStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - width }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, x.value / width) }));

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <DrawerContext.Provider value={value}>
      <View style={[styles.fill, { backgroundColor: t.canvas }]}>
        <GestureDetector gesture={edge}>
          <Animated.View
            style={[styles.fill, appStyle]}
            accessibilityElementsHidden={isOpen}
            importantForAccessibility={isOpen ? "no-hide-descendants" : "auto"}
          >
            {children}
            {/* Dims the pushed screen. A tap on it, or a swipe left, closes the menu. */}
            <GestureDetector gesture={scrimGesture}>
              <Animated.View
                pointerEvents={isOpen ? "auto" : "none"}
                style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, scrimStyle]}
              />
            </GestureDetector>
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={panelPan}>
          <Animated.View
            accessibilityViewIsModal={isOpen}
            accessibilityElementsHidden={!shown}
            importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
            style={[styles.panel, { width, backgroundColor: t.canvas, borderRightColor: t.line }, panelStyle]}
          >
            {shown ? panel(close) : null}
          </Animated.View>
        </GestureDetector>
      </View>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { position: "absolute", top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
});
