import { MASCOT_PHASE, mascotOpacity, mascotRearms, refreshLook } from "../pull-refresh";

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
