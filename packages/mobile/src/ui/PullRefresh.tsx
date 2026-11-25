import * as Haptics from "expo-haptics";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { HELLO_WAVE, INTRO_DELAY, WAVE_HALF, withAlpha } from "@lasagna/design";
import { useTheme as useDesign } from "@/design";
import { DIVE_DEPTH, holdRemaining, MASCOT_PHASE, mascotOpacity, mascotRearms, nextArmed, nextPrimed, poolScale, PULL_TRIGGER, refreshLook, shouldFire, type RefreshLook } from "@/lib/pull-refresh";
import { openCount, subscribeOpens } from "@/lib/app-open";
import { useFocusEffect } from "expo-router";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Ellipse } from "react-native-svg";
import { BrandMark } from "./BrandMark";
import { Mascot } from "./Mascot";

// Pull to refresh in the theme's skin (`skin.refresh`), one implementation for
// every scrolling screen. The trigger is ours (PULL_TRIGGER): crossing it is the
// one moment the mascot dives in and the haptic fires, and letting go any time
// after that refreshes. The system's refresh control only holds the gap open
// while the screen refetches, and draws nothing (its tint is clear), so only the
// theme's indicator shows. That indicator runs on
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
}): PullRefresh & { armed: SharedValue<boolean>; diveShown: SharedValue<number>; on: boolean; release: () => void } {
  const d = useDesign();
  const look = refreshLook(d.skin.refresh, { reduceMotion, hasMascot: !!d.mascot });
  // A refresh that finishes in a blink still shows its indicator long enough for the hop and the bob to read.
  const held = useHeldOn(!!refreshing, look !== "spinner", releasedAt);

  // Only a pull the user started shows the indicator: a tab appearing settles its content a few points
  // past rest for a moment, which the offset alone would read as a pull.
  const armed = useSharedValue(false);
  // Whether the dive mascot is on screen (0 or 1), written by it every frame, so a mascot already on the page
  // (Home's greeting) steps aside while it shows: never two of them at once.
  const diveShown = useSharedValue(0);
  useAnimatedReaction(
    () => nextArmed(armed.value, dragging.value, pull.value, REST),
    (now) => {
      if (now !== armed.value) armed.value = now;
    },
  );
  // The trigger: a user's pull crossing PULL_TRIGGER primes it. That is the moment the mascot dives in and the
  // one light tap fires; letting go any time after it refreshes (release).
  const enabled = !!onRefresh;
  const primed = useSharedValue(false);
  const [primedOn, setPrimedOn] = useState(false);
  const inFlight = useRef(false);
  const onPrime = useCallback(() => {
    setPrimedOn(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);
  useAnimatedReaction(
    () => enabled && nextPrimed(primed.value, armed.value, dragging.value, pull.value, PULL_TRIGGER),
    (now, prev) => {
      if (now && !prev && !primed.value) {
        primed.value = true;
        scheduleOnRN(onPrime);
      }
    },
    [enabled, onPrime],
  );
  // One refresh per pull: from our release, or the system control's own trigger on a very long pull.
  const fire = useCallback(() => {
    if (!onRefresh || !shouldFire(primed.value, inFlight.current)) return;
    inFlight.current = true;
    onRefresh();
  }, [onRefresh, primed]);
  // A primed pull that never got a refresh going (the screen ignored it) lets go of the dive.
  useEffect(() => {
    if (!primedOn || held) return;
    const id = setTimeout(() => {
      if (inFlight.current) return;
      primed.value = false;
      setPrimedOn(false);
    }, 1500);
    return () => clearTimeout(id);
  }, [primedOn, held, primed]);
  // The refresh it started is over: the next pull primes afresh.
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) {
      inFlight.current = false;
      primed.value = false;
      setPrimedOn(false);
    }
    wasHeld.current = held;
  }, [held, primed]);
  // The indicator is in the sauce from the moment the pull primes until the refresh is done.
  const on = held || primedOn;
  // Kept stable between refreshes: the bar's copy rides in its options, which rebuild when it changes.
  const overlay = useMemo(
    () => (!enabled ? null : look === "mascot" ? <PullMascot pull={pull} armed={armed} refreshing={on} top={edge} shown={diveShown} /> : look === "brandPuff" ? <PullMark pull={pull} armed={armed} refreshing={on} top={edge} /> : null),
    [enabled, look, pull, armed, on, edge, diveShown],
  );
  if (!onRefresh) return { look, control: undefined, overlay: null, barOverlay: null, armed, diveShown, on, release: () => {} };
  return {
    look,
    armed,
    diveShown,
    on,
    release: fire,
    // Holds the gap open while the screen refetches. Its own trigger sits past ours, so it only ever re-asks
    // for the refresh a primed pull already started, which fire ignores.
    control: <RefreshControl refreshing={held} onRefresh={fire} tintColor={look === "spinner" ? d.color.brandInk : CLEAR} />,
    overlay,
    // The mark comes out of the bar. Where the gap opens inside the bar (a search field travels down with the
    // content) the bar's material would cover the screen's copy, so a second copy draws in the bar's background.
    // The bar clips it at its edge and covers the screen's copy above it, so the two read as one mark.
    barOverlay: look === "brandPuff" ? overlay : null,
  };
}

// ── Mascot: the sauce dive ──────────────────────────────────────────────────

const MASCOT_WIDTH = 58;
/** The artwork is 140 by 124. */
const MASCOT_HEIGHT = Math.round((MASCOT_WIDTH * 124) / 140);
/** Space above the bar's bottom edge the splash may rise into. */
const HOP_ROOM = 18;
/** How far the mascot follows a long pull before it stays put. */
const MASCOT_MAX = 36;
/** The sauce pool: wider than the mascot, a shallow ellipse seen from just above. */
const POOL_W = 92;
const POOL_H = 22;
/** The pull over which the pool forms: full exactly at the trigger, where the mascot dives in. */
const POOL_SPAN = PULL_TRIGGER;

/** The pop out of the sauce and its shake, before the mascot leaves. Short: the page is already sliding back up. */
const FINISH_MS = 220;
/** How long it takes to rise back under the bar and fade. */
const EXIT_MS = 200;
/** The pool drains as the mascot pops out, gone before the page's title slides back under it. */
const DRAIN_MS = 220;

/**
 * The theme's character dives into sauce. It comes down from under the nav bar
 * with the content as you pull, while a pool of sauce forms under its feet.
 * When the pull arms the refresh it dives in with a splash and bobs there, head
 * above the surface, with bubbles rising, while the screen refetches. When it
 * is done it pops out with a shake that flicks off a drop or two, and rises
 * back under the bar as the pool drains. It stays gone until the content is
 * back at rest, so no part of it lingers under the bar.
 */
function PullMascot({ pull, armed, refreshing, top, shown }: { pull: SharedValue<number>; armed: SharedValue<boolean>; refreshing: boolean; top: number; shown: SharedValue<number> }) {
  const d = useDesign();
  const sauce = d.color.tint.spend.accent;
  const sauceDeep = d.color.tint.spend.ink;
  // The sauce's glossy highlight: the scheme's near-white (the card in light, the text in dark).
  const gloss = d.scheme === "dark" ? d.color.content : d.color.surface;
  const phase = useSharedValue<number>(refreshing ? MASCOT_PHASE.held : MASCOT_PHASE.follow);
  const exit = useSharedValue(0);
  const dive = useSharedValue(refreshing ? 1 : 0);
  const bob = useSharedValue(0);
  const shake = useSharedValue(0);
  const drain = useSharedValue(0);
  // Each splash replays its drops: a dive in, a pop out.
  const [splash, setSplash] = useState(0);
  const [flick, setFlick] = useState(0);
  useEffect(() => {
    cancelAnimation(bob);
    if (refreshing) {
      cancelAnimation(exit);
      exit.value = 0;
      drain.value = 0;
      phase.value = MASCOT_PHASE.held;
      // In it goes: a quick crouch up, then down into the sauce.
      dive.value = withSequence(withTiming(-0.12, { duration: 110, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 260, easing: Easing.in(Easing.quad) }));
      const sway = { duration: 520, easing: Easing.inOut(Easing.sin) };
      bob.value = withDelay(420, withRepeat(withSequence(withTiming(-3, sway), withTiming(0, sway)), -1));
      setSplash((n) => n + 1);
      return;
    }
    bob.value = withTiming(0, { duration: 120 });
    if (phase.value !== MASCOT_PHASE.held) return;
    phase.value = MASCOT_PHASE.leaving;
    // Out it pops, gives itself a shake, and goes.
    dive.value = withSpring(0, { damping: 12, stiffness: 260 });
    const tilt = (deg: number, ms: number) => withTiming(deg, { duration: ms, easing: Easing.inOut(Easing.sin) });
    shake.value = withDelay(60, withSequence(tilt(-8, 50), tilt(8, 55), tilt(-5, 50), tilt(0, 50)));
    drain.value = withTiming(1, { duration: DRAIN_MS, easing: Easing.out(Easing.quad) });
    setFlick((n) => n + 1);
    exit.value = withDelay(FINISH_MS, withTiming(1, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }));
  }, [refreshing, phase, exit, dive, bob, shake, drain]);
  // Gone and the content back at rest: follow the next pull.
  useAnimatedReaction(
    () => mascotRearms(phase.value, pull.value, exit.value, REST),
    (now) => {
      if (!now) return;
      phase.value = MASCOT_PHASE.follow;
      exit.value = 0;
      dive.value = 0;
      drain.value = 0;
      // A finished pull is spent: only a new drag shows it again, not the content still settling at rest.
      armed.value = false;
    },
  );
  // On screen or not, in the same frame as its own opacity below.
  useAnimatedReaction(
    () => (mascotOpacity(phase.value, pull.value, exit.value, REST, armed.value) > 0 ? 1 : 0),
    (now, prev) => {
      if (now !== prev) shown.value = now;
    },
  );
  const group = useAnimatedStyle(() => {
    // The pool's bottom rides just above the content's top edge, so it comes out from under the bar with the page
    // and never sits over the page's title.
    const y = Math.min(pull.value - MASCOT_HEIGHT - POOL_H / 2 - 4, MASCOT_MAX) + HOP_ROOM;
    const rise = exit.value * (MASCOT_HEIGHT + HOP_ROOM);
    return { opacity: mascotOpacity(phase.value, pull.value, exit.value, REST, armed.value), transform: [{ translateY: y - rise }] };
  });
  const body = useAnimatedStyle(() => ({
    transform: [{ translateY: dive.value * MASCOT_HEIGHT * DIVE_DEPTH + bob.value }, { rotate: `${shake.value}deg` }],
  }));
  const pool = useAnimatedStyle(() => {
    const k = poolScale(phase.value, pull.value, REST, armed.value, POOL_SPAN, phase.value === MASCOT_PHASE.leaving ? drain.value : exit.value);
    return { opacity: k > 0.02 ? 1 : 0, transform: [{ scaleX: 0.35 + 0.65 * k }, { scaleY: k }] };
  });
  return (
    <View pointerEvents="none" style={[styles.clip, { top: top - HOP_ROOM }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.diveGroup, group]}>
        {/* The pool is behind; the mascot's box ends at the pool's middle, its surface, so below it the mascot is in the sauce. */}
        <Animated.View style={[styles.pool, pool]}>
          <Svg width={POOL_W} height={POOL_H}>
            <Ellipse cx={POOL_W / 2} cy={POOL_H / 2} rx={POOL_W / 2 - 1} ry={POOL_H / 2 - 1} fill={sauce} stroke={sauceDeep} strokeWidth={1.5} />
            <Ellipse cx={POOL_W * 0.34} cy={POOL_H * 0.36} rx={POOL_W * 0.16} ry={POOL_H * 0.16} fill={gloss} opacity={0.35} />
          </Svg>
        </Animated.View>
        <View style={styles.diveBody}>
          <Animated.View style={[styles.feet, body]}>
            <Mascot name="happy" width={MASCOT_WIDTH} />
          </Animated.View>
        </View>
        {refreshing ? <Bubbles color={sauce} /> : null}
        {splash ? <Splash key={`in${splash}`} color={sauce} drops={DIVE_DROPS} /> : null}
        {flick ? <Splash key={`out${flick}`} color={sauce} drops={FLICK_DROPS} /> : null}
      </Animated.View>
    </View>
  );
}

type Drop = { dx: number; up: number; r: number; delay: number };
/** The dive's splash: drops thrown out to both sides. */
const DIVE_DROPS: Drop[] = [
  { dx: -30, up: 22, r: 3.5, delay: 0 },
  { dx: -16, up: 30, r: 3, delay: 20 },
  { dx: 4, up: 34, r: 2.5, delay: 10 },
  { dx: 18, up: 28, r: 3, delay: 30 },
  { dx: 32, up: 20, r: 3.5, delay: 15 },
];
/** The shake on the way out: a drop or two flicked off. */
const FLICK_DROPS: Drop[] = [
  { dx: -24, up: 18, r: 2.5, delay: 140 },
  { dx: 26, up: 14, r: 2.5, delay: 190 },
];

/** Drops of sauce that arc up from the surface and fall back, fading. */
function Splash({ color, drops }: { color: string; drops: Drop[] }) {
  return (
    <View pointerEvents="none" style={styles.surface}>
      {drops.map((drop, i) => (
        <SplashDrop key={i} color={color} {...drop} />
      ))}
    </View>
  );
}

function SplashDrop({ color, dx, up, r, delay }: Drop & { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 460, easing: Easing.out(Easing.quad) }));
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value > 0 && p.value < 1 ? 1 - p.value * p.value : 0,
    // Out and up, then back down: a thrown drop.
    transform: [{ translateX: dx * p.value }, { translateY: -up * 4 * p.value * (1 - p.value) }],
  }));
  return <Animated.View style={[{ position: "absolute", width: r * 2, height: r * 2, borderRadius: r, marginLeft: -r, marginTop: -r, backgroundColor: color }, style]} />;
}

/** While the mascot sits in the sauce, small bubbles rise from it and pop. */
function Bubbles({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={styles.surface}>
      {[-22, 20, -6].map((dx, i) => (
        <Bubble key={i} color={color} dx={dx} delay={i * 330} />
      ))}
    </View>
  );
}

function Bubble({ color, dx, delay }: { color: string; dx: number; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1000, easing: Easing.out(Easing.quad) }), -1));
    return () => cancelAnimation(p);
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.85 ? 0.9 : (1 - p.value) * 6,
    transform: [{ translateX: dx }, { translateY: -12 * p.value }, { scale: 0.5 + p.value * 0.7 }],
  }));
  return <Animated.View style={[styles.bubble, { borderColor: color }, style]} />;
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

// ── A mascot already on the page (Home's greeting) ─────────────────────────

type Inline = {
  look: RefreshLook;
  /** Whether the dive mascot is on screen (0 or 1). */
  diveShown?: SharedValue<number>;
};
export const PullRefreshContext = createContext<Inline | null>(null);

/** How long the page's mascot takes to come back once the dive mascot has gone. */
const RETURN_MS = 220;

/**
 * Wraps a mascot already on the page (Home's greeting). The pull's indicator is
 * the same sauce dive as on every other page (owner, 2026-11-24), so this one
 * steps aside while that one shows: gone in the frame the dive mascot appears,
 * back with a short fade once it has left, so the two are never on screen
 * together. Each time the user sees the app open (a fresh launch, or a return
 * from the background, once Face ID and the launch screen are gone) it waves
 * hello with its raised arm alone, three times, while Home is the screen in
 * view; never on a tab switch. Reduce Motion: no wave.
 */
export function RefreshMascot({ children, width, blink }: { children?: ReactNode; /** The mascot's width: given, the wrapper draws it itself with a waving arm. */ width?: number; /** Blink every few seconds (Home). */ blink?: boolean }) {
  const ctx = useContext(PullRefreshContext);
  const reduceMotion = useReducedMotion();
  const arm = useSharedValue(0);

  // The hello: one per open the user sees, only while Home is in view.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const opens = useSyncExternalStore(subscribeOpens, openCount);
  useEffect(() => {
    if (reduceMotion || !width || opens === 0 || opens <= lastWaved || !focused.current) return;
    lastWaved = opens;
    const out = (deg: number) => withTiming(deg, { duration: WAVE_HALF, easing: Easing.inOut(Easing.sin) });
    const [first, ...rest] = HELLO_WAVE.map(out);
    arm.value = withDelay(INTRO_DELAY, withSequence(first, ...rest));
  }, [opens, reduceMotion, width, arm]);

  // Out of the way while the dive mascot shows.
  const diveShown = ctx?.look === "mascot" ? ctx.diveShown : undefined;
  const present = useSharedValue(1);
  useAnimatedReaction(
    () => diveShown?.value ?? 0,
    (now, prev) => {
      if (now === prev) return;
      cancelAnimation(present);
      present.value = now ? 0 : withTiming(1, { duration: RETURN_MS, easing: Easing.out(Easing.quad) });
    },
  );
  const style = useAnimatedStyle(() => ({ opacity: present.value }));
  const content = width ? <Mascot name="happy" width={width} arm={arm} blink={blink} /> : children;
  return <Animated.View style={[styles.feet, style]}>{content}</Animated.View>;
}

/** The last open the page's mascot waved for, so a remount (a text-size change) never waves twice for one. */
let lastWaved = 0;

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
  // The page mascot's box, its wave turning from its feet.
  feet: { transformOrigin: "bottom" },
  clip: { position: "absolute", left: 0, right: 0, height: MASCOT_MAX + MASCOT_HEIGHT + 40 + POOL_H, overflow: "hidden", alignItems: "center" },
  // The mascot and its pool travel together; the pool's center line is the sauce's surface.
  diveGroup: { width: POOL_W + 40, height: MASCOT_HEIGHT + POOL_H, alignItems: "center" },
  diveBody: { width: MASCOT_WIDTH + 12, height: MASCOT_HEIGHT, overflow: "hidden", alignItems: "center" },
  pool: { position: "absolute", top: MASCOT_HEIGHT - POOL_H / 2, width: POOL_W, height: POOL_H },
  // Drops and bubbles start on the surface line, centered.
  surface: { position: "absolute", top: MASCOT_HEIGHT - 4, left: 0, right: 0, height: 0, alignItems: "center" },
  bubble: { position: "absolute", width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, marginLeft: -3, marginTop: -3 },
  mark: { transformOrigin: "top" },
  // Centered just under the bar's edge, where the mark goes back in.
  puff: { position: "absolute", top: HOP_ROOM - 4, left: 0, right: 0, height: 24, alignItems: "center", justifyContent: "center" },
  // The web's wisp: 11pt, content-muted at 32%.
  wisp: { position: "absolute", width: 11, height: 11, borderRadius: 5.5, opacity: 0 },
});
