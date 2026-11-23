import { drawableRange, filterByRange, pickXLabels, signedPct, smoothLinePath, snapshotPoints, thinLabels, tickDecimals, tickLabel } from "../trend";

const now = new Date("2026-11-22T12:00:00Z").getTime();
const day = (n: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);

test("ranges filter by age and fall back to the shortest one that draws", () => {
  const h = [{ date: day(300), value: 1 }, { date: day(100), value: 2 }, { date: day(5), value: 3 }];
  expect(filterByRange(h, "1M", now)).toHaveLength(1);
  expect(filterByRange(h, "6M", now)).toHaveLength(2);
  expect(drawableRange(h, "1M", now)).toBe("6M");
  expect(drawableRange([h[0]], "1M", now)).toBe("1M");
});

test("spline: a straight segment for two points, curves for more", () => {
  expect(smoothLinePath([[0, 0]])).toBe("");
  expect(smoothLinePath([[0, 0], [10, 10]])).toBe("M 0.00 0.00 L 10.00 10.00");
  expect(smoothLinePath([[0, 0], [10, 10], [20, 0]])).toMatch(/^M 0\.00 0\.00 C .* C /);
});

test("labels: distinct, thinned to fit", () => {
  const pts = Array.from({ length: 180 }, (_, i) => ({ date: day(180 - i), value: i }));
  const labels = pickXLabels(pts, "6M");
  expect(labels.length).toBeGreaterThan(2);
  expect(new Set(labels.map((l) => l.label)).size).toBe(labels.length);
  const thin = thinLabels(labels, pts.length, 120, 6.1);
  expect(thin.length).toBeLessThan(labels.length);
  expect(thin[thin.length - 1]).toEqual(labels[labels.length - 1]);
});

test("ticks and percent", () => {
  expect(tickDecimals([98000, 99000, 100000], 0)).toBe(0);
  expect(tickDecimals([98000, 98200], 0)).toBe(1);
  expect(tickLabel(98000, 0)).toBe("$98K");
  expect(tickLabel(-1_200_000)).toBe("−$1.2M");
  expect(signedPct(0.01)).toBe("0.0%");
  expect(signedPct(-2.345)).toBe("−2.3%");
});

test("snapshots: ascending, owed unsigned", () => {
  const pts = snapshotPoints(
    [
      { balance: "-20", snapshotAt: "2026-11-20T12:00:00Z" },
      { balance: "-10", snapshotAt: "2026-11-10T12:00:00Z" },
      { balance: null, snapshotAt: "bad" },
    ],
    true,
  );
  expect(pts.map((p) => p.value)).toEqual([10, 20]);
});
