import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useScrollOffset,
  useSharedValue,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { useTheme as useDesign } from "@/design";
import { barOpacity, chromeProgress, inlineTitleOpacity, type TitleFrame } from "@/lib/collapsing-header";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MenuButton } from "@/shell/NavButtons";
import { scheduleOnRN } from "react-native-worklets";
import type { RefreshLook } from "@/lib/pull-refresh";
import { NAV_ROW, PullRefreshContext, usePullRefresh } from "./PullRefresh";
import { useTextScaleKey } from "./text-scale";
import { font, space, themedStyles, type, useTheme } from "@/theme";

// The page chrome contract's scaffold. A screen's title is the first thing in
// its scroll content and scrolls away with it. The nav bar above is slim and
// clear at rest; as the title passes under it, the bar takes the page's
// surface (with the theme's blur, when its header skin is `blurred`) and a
// hairline, and a small title fades in. All of it runs on the UI thread.

/** Bar chrome stops growing at this text scale, as the system's navigation bars do. */
const BAR_MAX_SCALE = 1.3;
/** How much of a stand-in title (Home's greeting) must pass under the bar before it takes over. */
const STAND_IN_SPAN = 64;
/** The bar's search field, when it shows (measured on iOS 18). */
const SEARCH_FIELD = 54;
/** The in-content title's growth limit with the text size setting. */
const TITLE_MAX_SCALE = 1.5;

type Chrome = {
  /** Attach to the screen's ScrollView or FlashList. */
  scrollRef: AnimatedRef<any>;
  /** Attach to the in-content title. */
  onTitleLayout: (e: LayoutChangeEvent) => void;
  /** The title's frame, for what stands in for it (Home's greeting). */
  setTitleFrame: (y: number, height: number) => void;
  /** The bar's options and, on a tab's root, the hamburger. Render it once in the screen. */
  bar: ReactNode;
  /** Pull to refresh in the theme's skin: the scroll view's refreshControl, and what draws under the bar (render beside the scroll view). */
  refreshControl: React.ReactElement | undefined;
  refreshOverlay: ReactNode;
  refreshLook: RefreshLook;
  /** Refreshing, held on long enough for the indicator to read. Drives what animates. */
  refreshOn: boolean;
  /** How far the content sits below its rest, and whether the user started that pull (for a mascot on the page). */
  pull: SharedValue<number>;
  armed: SharedValue<boolean>;
  /** Spread on the scroll view: the indicator shows only on a pull the user starts. */
  dragHandlers: { onScrollBeginDrag: () => void; onScrollEndDrag: () => void };
};

/**
 * Drives the slim bar from a scroll view. `title` is the bar's small title
 * (and the screen's name for Back and VoiceOver); `barTitle` replaces the
 * small title's text with an element (Home's wordmark). `root`: a tab's root,
 * which leads with the hamburger.
 */
export function useCollapsingHeader({
  title,
  barTitle,
  root = false,
  scrolled,
  refreshing,
  onRefresh,
  searchBar = false,
  inlineMascot = false,
}: {
  title: string;
  barTitle?: ReactNode;
  root?: boolean;
  /** The distance scrolled from rest, when the scroll view is not native (a web page reports its own). */
  scrolled?: SharedValue<number>;
  /** Pull to refresh (a native scroll view only). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The bar has a search field that hides on scroll (a pull reveals it before it refreshes). */
  searchBar?: boolean;
  /** A mascot on the page is the refresh indicator (RefreshMascot). */
  inlineMascot?: boolean;
}): Chrome {
  const t = useTheme();
  const d = useDesign();
  const scrollRef = useAnimatedRef<any>();
  const offset = useScrollOffset(scrollRef);
  const headerHeight = useHeaderHeight();
  const reduceMotion = useReducedMotion();
  const frame = useSharedValue<TitleFrame | null>(null);
  // The list rests at minus the bar's height (the content is inset under the clear bar).
  const progress = useDerivedValue(
    () => chromeProgress(scrolled ? scrolled.value : offset.value + headerHeight, frame.value, reduceMotion),
    [headerHeight, reduceMotion, scrolled],
  );
  const blurred = d.skin.header === "blurred";
  // The material goes on only once the page has scrolled. At rest it sits under an opaque veil anyway, and
  // the system draws it over the bar's background, where it would blur the pull to refresh's brand mark.
  const [material, setMaterial] = useState(false);
  useAnimatedReaction(
    () => blurred && progress.value > 0,
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setMaterial, now);
    },
    [blurred],
  );
  // How far the content sits below its rest: a pull, or the gap held open while it refreshes.
  // The content rests at the bar's bottom edge. The bar's own row is 44pt on iOS 18 and 54pt on iOS 26, so the
  // edge is the bar's measured height, not an assumed row (it holds still through an overscroll).
  // A search field rests under the bar's row, or, hidden, comes down first and takes the start of the pull,
  // so either way the gap opens only past it.
  const barBottom = useBarBottom(headerHeight);
  const rest = barBottom + (searchBar ? SEARCH_FIELD : 0);
  const pull = useDerivedValue(() => Math.max(0, -(offset.value + rest)), [rest]);
  const dragging = useSharedValue(false);
  // When the finger last lifted, for how long a finished refresh stays on (null while it is down).
  const [releasedAt, setReleasedAt] = useState<number | null>(0);
  const refresh = usePullRefresh({ pull, dragging, releasedAt, edge: barBottom, inlineMascot, refreshing, onRefresh: scrolled ? undefined : onRefresh, reduceMotion });
  const dragHandlers = useMemo(
    () => ({
      onScrollBeginDrag: () => {
        dragging.value = true;
        setReleasedAt(null);
      },
      onScrollEndDrag: () => {
        dragging.value = false;
        setReleasedAt(Date.now());
        // A pull that crossed the trigger refreshes as the finger lifts.
        refresh.release();
      },
    }),
    [dragging, refresh.release],
  );

  const surfaceStyle = useAnimatedStyle(() => {
    const p = barOpacity(progress.value);
    // A blurred bar keeps its material under a canvas veil at rest (so it reads as clear) and lets it show once scrolled.
    return { opacity: blurred ? 1 - 0.35 * p : p };
  });
  const lineStyle = useAnimatedStyle(() => ({ opacity: barOpacity(progress.value) }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: inlineTitleOpacity(progress.value) }));

  const setTitleFrame = useCallback(
    (y: number, height: number) => {
      frame.value = { y, height };
    },
    [frame],
  );
  const onTitleLayout = useCallback((e: LayoutChangeEvent) => setTitleFrame(e.nativeEvent.layout.y, e.nativeEvent.layout.height), [setTitleFrame]);

  const options = useMemo(
    () => ({
      title,
      headerLargeTitle: false,
      headerTransparent: true,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "transparent" },
      headerBlurEffect: material ? ("systemChromeMaterial" as const) : undefined,
      headerTitle: () => (
        <Animated.View style={titleStyle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {barTitle ?? (
            <Text style={[styles.barTitle, { color: t.content }]} numberOfLines={1} maxFontSizeMultiplier={BAR_MAX_SCALE}>
              {title}
            </Text>
          )}
        </Animated.View>
      ),
      headerBackground: () => (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.canvas }, surfaceStyle]} />
          <Animated.View style={[styles.hairline, { backgroundColor: t.line }, lineStyle]} />
          {refresh.barOverlay}
        </>
      ),
    }),
    [title, barTitle, blurred, material, t, titleStyle, surfaceStyle, lineStyle, refresh.barOverlay],
  );

  return {
    scrollRef,
    onTitleLayout,
    setTitleFrame,
    bar: (
      <>
        <Stack.Screen options={options} />
        {root ? <MenuButton /> : null}
      </>
    ),
    refreshControl: refresh.control,
    refreshLook: refresh.look,
    refreshOverlay: refresh.overlay,
    refreshOn: refresh.on,
    pull,
    armed: refresh.armed,
    dragHandlers,
  };
}

/** The nav bar's bottom edge at rest, as the bar measures it, or the iOS 18 row until it reports a height. */
function useBarBottom(headerHeight: number): number {
  const top = useSafeAreaInsets().top;
  return headerHeight > top ? headerHeight : top + NAV_ROW;
}

/** The screen's title, first in its content: display size on a tab's root, smaller on a pushed screen. */
export function ScreenTitle({ title, root, onLayout }: { title: string; root: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  const t = useTheme();
  return (
    // It stops growing at 1.5x, so a one-word title ("Transactions") never breaks inside the word at the largest text sizes.
    <Text onLayout={onLayout} style={[root ? styles.rootTitle : styles.pushedTitle, { color: t.content }]} accessibilityRole="header" maxFontSizeMultiplier={TITLE_MAX_SCALE}>
      {title}
    </Text>
  );
}

type Props = Omit<ScrollViewProps, "refreshControl" | "contentContainerStyle"> & {
  title: string;
  /** A tab's root: the display title and the hamburger. */
  root?: boolean;
  /** Stands in for the in-content title (Home's greeting). */
  header?: ReactNode;
  /** The bar's small title as an element (Home's wordmark). */
  barTitle?: ReactNode;
  /** Pull to refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** A scrolling screen on the scaffold: the bar, the in-content title, the theme's gutter, pull to refresh. */
export function ScreenScroll({ title, root = false, header, barTitle, refreshing, onRefresh, contentContainerStyle, children, ...rest }: Props) {
  // A mascot in the content (Home's greeting) claims the indicator's job.
  const [inlineMascot, setInlineMascot] = useState(false);
  const chrome = useCollapsingHeader({ title, barTitle, root, refreshing, onRefresh, inlineMascot });
  const refreshCtx = useMemo(
    () => ({ refreshing: chrome.refreshOn, look: chrome.refreshLook, claim: setInlineMascot, pull: chrome.pull, armed: chrome.armed }),
    [chrome.refreshOn, chrome.refreshLook, chrome.pull, chrome.armed],
  );
  // The content is laid out again when the text size changes (see text-scale.ts).
  const scaleKey = useTextScaleKey();
  return (
    <PullRefreshContext.Provider value={refreshCtx}>
      {chrome.bar}
      <Animated.ScrollView
        ref={chrome.scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={16}
        contentContainerStyle={[screenStyles.body, contentContainerStyle]}
        refreshControl={chrome.refreshControl}
        {...chrome.dragHandlers}
        {...rest}
      >
        <Fragment key={scaleKey}>
        {header ? (
          // A tall stand-in (a greeting card) hands the bar over once its top has gone, not its whole height.
          <Animated.View onLayout={(e) => chrome.setTitleFrame(e.nativeEvent.layout.y, Math.min(e.nativeEvent.layout.height, STAND_IN_SPAN))}>{header}</Animated.View>
        ) : (
          <ScreenTitle title={title} root={root} onLayout={chrome.onTitleLayout} />
        )}
        {children}
        </Fragment>
      </Animated.ScrollView>
      {chrome.refreshOverlay}
    </PullRefreshContext.Provider>
  );
}

/** The page body's spacing, for a screen that lays out its own scroll view. */
export const screenStyles = themedStyles(() =>
  StyleSheet.create({
    body: { paddingHorizontal: space.screen, paddingTop: 2, paddingBottom: 32, gap: space.md },
  }),
);

const styles = themedStyles(() =>
  StyleSheet.create({
    rootTitle: { ...type.largeTitle, paddingHorizontal: space.card, paddingTop: 2, paddingBottom: 2 },
    pushedTitle: { ...type.title1, paddingHorizontal: space.card, paddingTop: 2, paddingBottom: 2 },
    barTitle: { ...type.headline, fontFamily: font.semibold },
    hairline: { position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  }),
);
