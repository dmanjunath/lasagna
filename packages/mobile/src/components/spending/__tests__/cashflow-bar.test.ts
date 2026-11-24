import { barFill } from "../CashflowChart";

test("a finished period is a solid bar", () => {
  expect(barFill("#C2311E", false)).toEqual({ backgroundColor: "#C2311E" });
});

test("the period still under way is outlined in its full color, never faded away", () => {
  const f = barFill("#C2311E", true);
  expect(f.borderColor).toBe("#C2311E");
  expect(f.borderWidth).toBeGreaterThan(1);
  expect(f.backgroundColor).not.toBe("#C2311E");
});
