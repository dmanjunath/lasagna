import { iconScale, textScaleKey } from "../text-scale";

test("the text-scale key changes with the text size and only with it", () => {
  expect(textScaleKey(1)).toBe(textScaleKey(1.0000001));
  expect(textScaleKey(1)).not.toBe(textScaleKey(1.176));
  expect(textScaleKey(3.12)).toBe("scale-3.12");
});

test("icons beside text grow with it, but only so far", () => {
  expect(iconScale(0.8)).toBe(1);
  expect(iconScale(1.2)).toBe(1.2);
  expect(iconScale(3.1)).toBe(1.5);
});
