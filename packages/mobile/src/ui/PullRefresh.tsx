import * as Haptics from "expo-haptics";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { withAlpha } from "@lasagna/design";
import { useTheme as useDesign } from "@/design";
import { holdRemaining, MASCOT_PHASE, mascotOpacity, mascotRearms, nextArmed, pullStretch, refreshLook, takeGreetingIntro, type RefreshLook } from "@/lib/pull-refresh";
import { BrandMark } from "./BrandMark";
import { Mascot } from "./Mascot";

// Pull to refresh in the theme's skin (`skin.refresh`), one implementation for
// every scrolling screen. The system's refresh control still owns the gesture
// and holds the gap open while the screen refetches, but draws nothing (its
// tint is clear), so only the theme's indicator shows. That indicator runs on
// the UI thread from the scroll offset: `pull` is how far the content sits
// below its rest. Reduce Motion: the system spinner in the brand ink, alone.

/** UIRefreshControl draws its spinner in this, which is as good as nothing. A fully clear color would read as unset and fall back to the default tint. */
const CLEAR = "rgba(0, 0, 0, 0.004)";
/** A content edge this close to its rest is at rest (the bar's rows round to fractions of a point). */
const REST = 6;
/** A compact navigation bar's row under the status bar on iOS 18, until the bar reports its real height. */
export const NAV_ROW = 44;

export type PullRefresh = {
  look: RefreshLook;
  /** For the scroll view's (or FlashList's) refreshControl prop. */
  control: React.ReactElement | undefined;
  /** The indicator, beside the scroll view. */
  overlay: React.ReactNode;
  /** Its copy for the bar's background, for what draws inside the bar. */
  barOverlay: React.ReactNode;
};

export function usePullRefresh({
  pull,
  dragging,
  releasedAt,
  edge,
  refreshing,
  onRefresh,
  reduceMotion,
  inlineMascot = false,
}: {
  pull: SharedValue<number>;
  /** Whether the user's finger is dragging the content (the scroll view's begin and end drag). */
  dragging: SharedValue<boolean>;
  /** When the finger last lifted (ms), or null while it is down. */
  releasedAt: number | null;
  /** The nav bar's bottom edge at rest, where the indicator comes out from under the bar. */
  edge: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  reduceMotion: boolean;
  /** A mascot on the page is the indicator (RefreshMascot), so none comes down from the bar. */
  inlineMascot?: boolean;
}): PullRefresh & { armed: SharedValue<boolean>; on: boolean } {
  const d = useDesign();
  const look = refreshLook(d.skin.refresh, { reduceMotion, hasMascot: !!d.mascot });
  // A refresh that finishes in a blink still shows its indicator long enough for the hop and the bob to read.
  const on = useHeldOn(!!refreshing, look !== "spinner", releasedAt);

  // Only a pull the user started shows the indicator: a tab appearing settles its content a few points
  // past rest for a moment, which the offset alone would read as a pull.
  const armed = useSharedValue(false);
  useAnimatedReaction(
    () => nextArmed(armed.value, dragging.value, pull.value, REST),
    (now) => {
      if (now !== armed.value) armed.value = now;
    },
  );
  // One light tap when a pull arms the refresh (the system control fires as the pull passes its threshold).
  useEffect(() => {
    if (on && look !== "spinner") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [on, look]);
  // The bar's row. A search field under it travels down with the content, so the gap opens here.
  const enabled = !!onRefresh;
  // Kept stable between refreshes: the bar's copy rides in its options, which rebuild when it changes.
  const overlay = useMemo(
    () => (!enabled ? null : look === "mascot" ? (inlineMascot ? null : <PullMascot pull={pull} armed={armed} refreshing={on} top={edge} />) : look === "brandPuff" ? <PullMark pull={pull} armed={armed} refreshing={on} top={edge} /> : null),
    [enabled, look, pull, armed, on, edge, inlineMascot],
  );
  if (!onRefresh) return { look, control: undefined, overlay: null, barOverlay: null, armed, on };
  return {
    look,
    armed,
    on,
    control: <RefreshControl refreshing={on} onRefresh={onRefresh} tintColor={look === "spinner" ? d.color.brandInk : CLEAR} />,
    overlay,
    // The mark comes out of the bar. Where the gap opens inside the bar (a search field travels down with the
    // content) the bar's material would cover the screen's copy, so a second copy draws in the bar's background.
    // The bar clips it at its edge and covers the screen's copy above it, so the two read as one mark.
    barOverlay: look === "brandPuff" ? overlay : null,
  };
}

// ── Mascot ──────────────────────────────────────────────────────────────────

const MASCOT_WIDTH = 58;
/** The artwork is 140 by 124. */
const MASCOT_HEIGHT = Math.round((MASCOT_WIDTH * 124) / 140);
/** Space above the bar's bottom edge the hop may rise into. */
const HOP_ROOM = 18;
/** How far the mascot follows a long pull before it stays put. */
const MASCOT_MAX = 36;

/** The finish hop's length, before the mascot leaves. */
const FINISH_MS = 300;
/** How long it takes to rise back under the bar and fade. */
const EXIT_MS = 240;

/**
 * The theme's character slides down from under the nav bar with the content
 * as you pull, hops once when the pull arms the refresh, bobs while the screen
 * refetches, and when it is done gives a small happy hop and rises back under
 * the bar, fading. It stays gone until the content is back at rest, so no part
 * of it lingers under the bar.
 */
function PullMascot({ pull, armed, refreshing, top }: { pull: SharedValue<number>; armed: SharedValue<boolean>; refreshing: boolean; top: number }) {
  const { hop, bob } = useHopBob(refreshing);
  const phase = useSharedValue<number>(refreshing ? MASCOT_PHASE.held : MASCOT_PHASE.follow);
  const exit = useSharedValue(0);
  useEffect(() => {
    if (refreshing) {
      cancelAnimation(exit);
      exit.value = 0;
      phase.value = MASCOT_PHASE.held;
      return;
    }
    if (phase.value !== MASCOT_PHASE.held) return;
    phase.value = MASCOT_PHASE.leaving;
    exit.value = withDelay(FINISH_MS, withTiming(1, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }));
  }, [refreshing, phase, exit]);
  // Gone and the content back at rest: follow the next pull.
  useAnimatedReaction(
    () => mascotRearms(phase.value, pull.value, exit.value, REST),
    (now) => {
      if (!now) return;
      phase.value = MASCOT_PHASE.follow;
      exit.value = 0;
      // A finished pull is spent: only a new drag shows it again, not the content still settling at rest.
      armed.value = false;
    },
  );
  const style = useAnimatedStyle(() => {
    // Its feet ride just above the content's top edge, so it comes out from under the bar with the page.
    const y = Math.min(pull.value - MASCOT_HEIGHT - 8, MASCOT_MAX) + HOP_ROOM;
    const rise = exit.value * (MASCOT_HEIGHT + HOP_ROOM);
    return { opacity: mascotOpacity(phase.value, pull.value, exit.value, REST, armed.value), transform: [{ translateY: y + hop.value + bob.value - rise }] };
  });
  return (
    <View pointerEvents="none" style={[styles.clip, { top: top - HOP_ROOM }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={style}>
        <Mascot name="happy" width={MASCOT_WIDTH} />
      </Animated.View>
    </View>
  );
}

/**
 * The armed hop (once, as the refresh starts), the bob while it lasts, and a
 * finish hop when it ends, as translateY offsets. Both always end at exactly 0.
 */
function useHopBob(refreshing: boolean) {
  const hop = useSharedValue(0);
  const bob = useSharedValue(0);
  const was = useRef(refreshing);
  useEffect(() => {
    const ended = was.current && !refreshing;
    was.current = refreshing;
    cancelAnimation(bob);
    if (!refreshing) {
      bob.value = withTiming(0, { duration: 120 });
      if (ended) {
        // Done: one small happy hop. It starts from wherever the armed hop is, so a refresh shorter than the hop still lands at rest.
        cancelAnimation(hop);
        hop.value = withSequence(withTiming(-12, { duration: 130, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 11, stiffness: 300 }));
      }
      return;
    }
    hop.value = withSequence(withTiming(-14, { duration: 140, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 9, stiffness: 320 }));
    const sway = { duration: 480, easing: Easing.inOut(Easing.sin) };
    bob.value = withDelay(260, withRepeat(withSequence(withTiming(-5, sway), withTiming(0, sway)), -1));
  }, [refreshing, hop, bob]);
  return { hop, bob };
}

/**
 * `refreshing`, held on long enough for the indicator to read (holdRemaining):
 * a fast refresh is often done before the finger lifts, so it stays on until a
 * moment after. Off right away where nothing animates (the system spinner).
 */
function useHeldOn(refreshing: boolean, hold: boolean, releasedAt: number | null): boolean {
  const [on, setOn] = useState(refreshing);
  const startedAt = useRef(0);
  useEffect(() => {
    if (refreshing) {
      startedAt.current = Date.now();
      setOn(true);
      return;
    }
    const wait = hold ? holdRemaining(startedAt.current, Date.now(), releasedAt) : 0;
    if (wait === 0) {
      setOn(false);
      return;
    }
    // Still down: wait for the lift (this runs again with its time).
    if (!Number.isFinite(wait)) return;
    const id = setTimeout(() => setOn(false), wait);
    return () => clearTimeout(id);
  }, [refreshing, hold, releasedAt]);
  return on;
}

// ── The page's own mascot as the indicator (Home's greeting) ─────────────────

type Inline = {
  refreshing: boolean;
  look: RefreshLook;
  claim: (on: boolean) => void;
  /** How far the content sits below its rest, and whether the user started that pull. */
  pull?: SharedValue<number>;
  armed?: SharedValue<boolean>;
};
export const PullRefreshContext = createContext<Inline | null>(null);

/** How far a pull goes before the stretch is full (about where the system arms the refresh). */
const STRETCH_SPAN = 90;

/**
 * Wraps a mascot already on the page (Home's greeting). Where the refresh skin
 * is the mascot, it becomes the indicator: it stretches toward the finger as
 * the user pulls, hops when the pull arms the refresh, bobs while it lasts and
 * gives a finish hop when it is done, back at exactly its resting place, and
 * no second mascot comes down from the bar. The first time Home shows in a
 * session it pops in and waves. Reduce Motion: it stands still. Elsewhere it
 * draws its child as is.
 */
export function RefreshMascot({ children }: { children: ReactNode }) {
  const ctx = useContext(PullRefreshContext);
  const active = ctx?.look === "mascot";
  const claim = ctx?.claim;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!active || !claim) return;
    claim(true);
    return () => claim(false);
  }, [active, claim]);
  const { hop, bob } = useHopBob(active && !!ctx?.refreshing);

  // The intro: once a session, a pop with a little bounce, then a wave (a tilt on its feet, side to side).
  const [intro] = useState(() => !reduceMotion && takeGreetingIntro());
  const pop = useSharedValue(intro ? 0 : 1);
  const wave = useSharedValue(0);
  useEffect(() => {
    if (!intro) return;
    pop.value = withDelay(120, withSpring(1, { damping: 9, stiffness: 220, mass: 0.8 }));
    const swing = (deg: number, ms: number) => withTiming(deg, { duration: ms, easing: Easing.inOut(Easing.sin) });
    wave.value = withDelay(520, withSequence(swing(-9, 140), swing(8, 160), swing(-6, 150), swing(0, 140)));
  }, [intro, pop, wave]);

  const pull = ctx?.pull;
  const armed = ctx?.armed;
  const stretchOn = active && !reduceMotion;
  const style = useAnimatedStyle(() => {
    const s = stretchOn && pull && armed ? pullStretch(pull.value, REST, armed.value, STRETCH_SPAN) : 0;
    return {
      transform: [
        { translateY: hop.value + bob.value + s * 6 },
        { rotate: `${wave.value}deg` },
        { scale: pop.value },
        // Stretching toward the finger: a little taller and narrower, from its feet.
        { scaleY: 1 + 0.14 * s },
        { scaleX: 1 - 0.06 * s },
      ],
    };
  });
  return <Animated.View style={[styles.feet, style]}>{children}</Animated.View>;
}

// ── Brand mark and smoke puff (the web's pull-to-refresh.tsx and app-header.tsx) ──

/** The pull that arms the refresh on the web, which the mark's stretch is measured against. */
const ARMED = 64;
const MARK_SIZE = 28;
/** The mark's artwork is 28 by 24. */
const MARK_HEIGHT = 24;
/** How far the mark can be pulled down, and where it waits while the screen refetches. */
const MARK_MAX_TRAVEL = 72;
const MARK_REFRESH_TRAVEL = 52;
const PUFF_MS = 520;

/**
 * The brand mark, yanked down out of the nav bar with the pull (stretching
 * from the top), held below the bar while the screen refetches, then sprung
 * back up into the bar with a puff of smoke at its edge. Its home is just
 * inside the bar, so its travel is the web's, measured from the bar.
 */
function PullMark({ pull, armed, refreshing, top }: { pull: SharedValue<number>; armed: SharedValue<boolean>; refreshing: boolean; top: number }) {
  const y = useSharedValue(0);
  // 0 follows the finger, 1 is held or springing home.
  const held = useSharedValue(0);
  const [puff, setPuff] = useState(0);

  // 1 from the puff on: the mark is home and stays out of sight until the content is back at rest.
  // It starts at 1 too: the bar's copy remounts when the refresh ends, mid ride-back, and must not show then.
  const landed = useSharedValue(refreshing ? 0 : 1);

  useAnimatedReaction(
    () => pull.value,
    (p) => {
      if (landed.value === 1) {
        // Hidden through the whole ride back: the content at rest and the spring home done.
        if (p > REST || held.value === 1) return;
        landed.value = 0;
      }
      if (held.value === 0) y.value = armed.value && p > REST ? Math.min(p * 0.7, MARK_MAX_TRAVEL) : 0;
    },
  );

  useEffect(() => {
    if (refreshing) {
      held.value = 1;
      y.value = withSpring(MARK_REFRESH_TRAVEL, { stiffness: 380, damping: 24 });
      return;
    }
    if (held.value === 0) return;
    // Snap home, and puff as it lands back in the bar. The puff takes its place: hidden from here on.
    landed.value = 1;
    y.value = withSpring(0, { stiffness: 620, damping: 30 });
    setPuff((n) => n + 1);
    // Home and the puff spent: back to following the next pull.
    const id = setTimeout(() => {
      held.value = 0;
      setPuff(0);
    }, PUFF_MS);
    return () => clearTimeout(id);
  }, [refreshing, held, y, landed]);

  const style = useAnimatedStyle(() => {
    const stretch = held.value === 0 ? 1 + Math.min(1, pull.value / ARMED) * 0.18 : 1;
    return {
      // Shown only away from home: once it lands, the puff takes its place.
      opacity: landed.value === 0 && y.value > 1 ? 1 : 0,
      // The spring home overshoots a little: never up into the status bar.
      transform: [{ translateY: HOP_ROOM - MARK_HEIGHT + Math.max(y.value, -2) }, { scaleY: stretch }],
    };
  });

  return (
    <View pointerEvents="none" style={[styles.clip, { top: top - HOP_ROOM }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.mark, style]}>
        <BrandMark size={MARK_SIZE} />
      </Animated.View>
      {puff ? <SmokePuff key={puff} /> : null}
    </View>
  );
}

const WISPS = [
  { x: -13, y: -1 },
  { x: 13, y: -3 },
  { x: -7, y: -11 },
  { x: 9, y: -9 },
  { x: 0, y: -13 },
  { x: -2, y: 4 },
];

/** A few gray wisps that puff outward as the mark lands back in the bar. */
function SmokePuff() {
  return (
    <View pointerEvents="none" style={styles.puff}>
      {WISPS.map((w, i) => (
        <Wisp key={i} dx={w.x} dy={w.y} delay={i * 12} />
      ))}
    </View>
  );
}

function Wisp({ dx, dy, delay }: { dx: number; dy: number; delay: number }) {
  const d = useDesign();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) }));
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - p.value),
    transform: [{ translateX: dx * p.value }, { translateY: dy * p.value }, { scale: 0.35 + 1.55 * p.value }],
  }));
  return <Animated.View style={[styles.wisp, { backgroundColor: withAlpha(d.color.contentMuted, 0.32) }, style]} />;
}

const styles = StyleSheet.create({
  // The intro's wave and the pull's stretch turn and grow from the mascot's feet.
  feet: { transformOrigin: "bottom" },
  clip: { position: "absolute", left: 0, right: 0, height: MASCOT_MAX + MASCOT_HEIGHT + 40, overflow: "hidden", alignItems: "center" },
  mark: { transformOrigin: "top" },
  // Centered just under the bar's edge, where the mark goes back in.
  puff: { position: "absolute", top: HOP_ROOM - 4, left: 0, right: 0, height: 24, alignItems: "center", justifyContent: "center" },
  // The web's wisp: 11pt, content-muted at 32%.
  wisp: { position: "absolute", width: 11, height: 11, borderRadius: 5.5, opacity: 0 },
});
