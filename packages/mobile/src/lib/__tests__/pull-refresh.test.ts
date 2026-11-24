import { AFTER_RELEASE_MS, holdRemaining, MASCOT_PHASE, mascotOpacity, mascotRearms, MIN_REFRESH_MS, nextArmed, nextPrimed, PULL_TRIGGER, pullStretch, refreshLook, resetGreetingIntro, shouldFire, takeGreetingIntro } from "../pull-refresh";

test("each theme's skin draws its own indicator", () => {
  expect(refreshLook("mascot", { reduceMotion: false, hasMascot: true })).toBe("mascot");
  expect(refreshLook("brandPuff", { reduceMotion: false, hasMascot: true })).toBe("brandPuff");
  expect(refreshLook("brandPuff", { reduceMotion: false, hasMascot: false })).toBe("brandPuff");
});

test("Reduce Motion falls back to the plain spinner in every skin", () => {
  expect(refreshLook("mascot", { reduceMotion: true, hasMascot: true })).toBe("spinner");
  expect(refreshLook("brandPuff", { reduceMotion: true, hasMascot: false })).toBe("spinner");
});

test("a mascot skin without a mascot uses the brand mark", () => {
  expect(refreshLook("mascot", { reduceMotion: false, hasMascot: false })).toBe("brandPuff");
});

const REST = 6;

test("following, the mascot shows only past the content's rest", () => {
  expect(mascotOpacity(MASCOT_PHASE.follow, 0, 0, REST)).toBe(0);
  expect(mascotOpacity(MASCOT_PHASE.follow, REST, 0, REST)).toBe(0);
  expect(mascotOpacity(MASCOT_PHASE.follow, 40, 0, REST)).toBe(1);
});

test("held, it stays fully shown while the screen refetches", () => {
  expect(mascotOpacity(MASCOT_PHASE.held, 0, 0, REST)).toBe(1);
});

test("leaving, it fades on its own clock even while the content still sits below its rest", () => {
  expect(mascotOpacity(MASCOT_PHASE.leaving, 60, 0, REST)).toBe(1);
  expect(mascotOpacity(MASCOT_PHASE.leaving, 60, 0.5, REST)).toBe(0.5);
  expect(mascotOpacity(MASCOT_PHASE.leaving, 60, 1, REST)).toBe(0);
});

test("a mascot that left follows the next pull only once gone and back at rest", () => {
  expect(mascotRearms(MASCOT_PHASE.leaving, 0, 0.5, REST)).toBe(false);
  expect(mascotRearms(MASCOT_PHASE.leaving, 30, 1, REST)).toBe(false);
  expect(mascotRearms(MASCOT_PHASE.leaving, 0, 1, REST)).toBe(true);
  expect(mascotRearms(MASCOT_PHASE.follow, 0, 1, REST)).toBe(false);
});

test("the indicator arms only on a drag the user starts", () => {
  // A tab appearing: the content settles a few points past rest with no drag. Never shows.
  expect(nextArmed(false, false, 12, REST)).toBe(false);
  expect(mascotOpacity(MASCOT_PHASE.follow, 12, 0, REST, false)).toBe(0);
  // A drag begins: armed, and a pull past rest shows it.
  expect(nextArmed(false, true, 0, REST)).toBe(true);
  expect(mascotOpacity(MASCOT_PHASE.follow, 40, 0, REST, true)).toBe(1);
  // Let go mid-pull: stays armed until the content is back at rest.
  expect(nextArmed(true, false, 30, REST)).toBe(true);
  expect(nextArmed(true, false, 2, REST)).toBe(false);
  // Held while refreshing shows whatever arming says.
  expect(mascotOpacity(MASCOT_PHASE.held, 0, 0, REST, false)).toBe(1);
});

test("the stretch follows only a user's pull, capped at 1", () => {
  expect(pullStretch(40, REST, false, 80)).toBe(0);
  expect(pullStretch(REST, REST, true, 80)).toBe(0);
  expect(pullStretch(REST + 40, REST, true, 80)).toBe(0.5);
  expect(pullStretch(500, REST, true, 80)).toBe(1);
});

test("a fast refresh still holds long enough to show", () => {
  expect(holdRemaining(1000, 1200)).toBe(MIN_REFRESH_MS - 200);
  expect(holdRemaining(1000, 1000 + MIN_REFRESH_MS + 50)).toBe(0);
});

test("a refresh done while the finger is still down holds until after it lifts", () => {
  // Finger still down: keep holding.
  expect(holdRemaining(1000, 1500, null)).toBe(Infinity);
  // Lifted at 2500, long after the minimum: AFTER_RELEASE_MS from the lift.
  expect(holdRemaining(1000, 2600, 2500)).toBe(AFTER_RELEASE_MS - 100);
  expect(holdRemaining(1000, 2500 + AFTER_RELEASE_MS, 2500)).toBe(0);
  // A lift before the refresh started (a flick that armed on the way back) adds nothing.
  expect(holdRemaining(1000, 1500, 900)).toBe(MIN_REFRESH_MS - 500);
});

test("Home's greeting intro plays once a session", () => {
  resetGreetingIntro();
  expect(takeGreetingIntro()).toBe(true);
  expect(takeGreetingIntro()).toBe(false);
});

describe("poolScale", () => {
  const { poolScale, MASCOT_PHASE } = require("../pull-refresh");
  test("forms with the user's pull, full in the sauce, drains as the mascot leaves", () => {
    expect(poolScale(MASCOT_PHASE.follow, 0, 6, true, 80, 0)).toBe(0);
    expect(poolScale(MASCOT_PHASE.follow, 46, 6, true, 80, 0)).toBeCloseTo(0.5);
    expect(poolScale(MASCOT_PHASE.follow, 200, 6, true, 80, 0)).toBe(1);
    expect(poolScale(MASCOT_PHASE.held, 0, 6, false, 80, 0)).toBe(1);
    expect(poolScale(MASCOT_PHASE.leaving, 0, 6, false, 80, 0.25)).toBeCloseTo(0.75);
  });
  test("a settle that no drag started forms no pool", () => {
    expect(poolScale(MASCOT_PHASE.follow, 30, 6, false, 80, 0)).toBe(0);
  });
});

describe("the single refresh trigger", () => {
  test("a user's pull primes as it crosses the trigger, not before", () => {
    expect(nextPrimed(false, true, true, PULL_TRIGGER - 1, PULL_TRIGGER)).toBe(false);
    expect(nextPrimed(false, true, true, PULL_TRIGGER, PULL_TRIGGER)).toBe(true);
  });

  test("only a drag the user started primes (a tab settling past rest never does)", () => {
    expect(nextPrimed(false, false, true, PULL_TRIGGER + 20, PULL_TRIGGER)).toBe(false);
    expect(nextPrimed(false, true, false, PULL_TRIGGER + 20, PULL_TRIGGER)).toBe(false);
  });

  test("once primed it stays primed, so letting go anywhere after the dive refreshes", () => {
    expect(nextPrimed(true, true, true, 10, PULL_TRIGGER)).toBe(true);
    expect(nextPrimed(true, false, false, 0, PULL_TRIGGER)).toBe(true);
  });

  test("a release refreshes only a primed pull, and only once", () => {
    expect(shouldFire(false, false)).toBe(false);
    expect(shouldFire(true, false)).toBe(true);
    expect(shouldFire(true, true)).toBe(false);
  });

  test("the trigger sits well short of the system control's own (about 130pt)", () => {
    expect(PULL_TRIGGER).toBeGreaterThanOrEqual(80);
    expect(PULL_TRIGGER).toBeLessThanOrEqual(100);
  });
});
