import { textScaleKey } from "../text-scale";

test("the text-scale key changes with the text size and only with it", () => {
  expect(textScaleKey(1)).toBe(textScaleKey(1.0000001));
  expect(textScaleKey(1)).not.toBe(textScaleKey(1.176));
  expect(textScaleKey(3.12)).toBe("scale-3.12");
});
