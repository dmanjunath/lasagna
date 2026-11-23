import { edgeSwipeOpens } from "../drawer-swipe";

const W = 320;

test("a short, slow drag past a quarter of the panel opens it", () => {
  expect(edgeSwipeOpens(W * 0.3, W, 50)).toBe(true);
  // The old rule wanted 40% (128pt) and ignored speed.
  expect(edgeSwipeOpens(100, W, 0)).toBe(true);
});

test("a quick rightward flick opens it from a few points of travel", () => {
  expect(edgeSwipeOpens(20, W, 600)).toBe(true);
});

test("a small drag let go still, or one flung back left, stays closed", () => {
  expect(edgeSwipeOpens(40, W, 0)).toBe(false);
  expect(edgeSwipeOpens(W * 0.6, W, -500)).toBe(false);
});
