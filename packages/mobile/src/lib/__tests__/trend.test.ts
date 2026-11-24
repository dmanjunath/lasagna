import { chartDay, drawableRange, filterByRange, nearestIndex, pickXLabels, timeFractions, signedPct, smoothLinePath, snapshotPoints, thinLabels, tickDecimals, tickLabel } from "../trend";

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

test("points sit by date, so a missing stretch reads as its real length", () => {
  const pts = [
    { date: "2026-06-01", value: 1 },
    { date: "2026-09-01", value: 2 },
    { date: "2026-10-01", value: 3 },
    { date: "2026-11-01", value: 4 },
  ];
  const f = timeFractions(pts);
  expect(f[0]).toBe(0);
  expect(f[3]).toBe(1);
  // June to September is three of the five months: about 60% of the width, not a third.
  expect(f[1]).toBeCloseTo(92 / 153, 3);
  expect(nearestIndex(f, 0.3)).toBe(0);
  expect(nearestIndex(f, 0.9)).toBe(3);
  // Labels follow time: the June-to-September gap gets no invented month, and the ends are kept.
  const labels = pickXLabels(pts, "6M");
  expect(labels[0].idx).toBe(0);
  expect(labels[labels.length - 1].idx).toBe(3);
  // One day only, or bad dates: even spacing.
  expect(timeFractions([{ date: "2026-06-01", value: 1 }, { date: "2026-06-01", value: 2 }])).toEqual([0, 1]);
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

test("chart labels stay one short line for any date or amount", () => {
  const today = new Date("2026-11-22T12:00:00Z");
  expect(chartDay("2026-09-30", today)).toBe("Sep 30");
  expect(chartDay("2025-09-30", today)).toBe("Sep 30 ’25");
  expect(chartDay("2026-09-30", today).length).toBeLessThanOrEqual(6);
  // Big and negative amounts compact to a few characters.
  expect(tickLabel(1_234_567.89)).toBe("$1.2M");
  expect(tickLabel(-98_765)).toBe("−$99K");
  expect(tickLabel(12_345_678)).toBe("$12M");
  for (const v of [0, 999, 1234.5, -98_765, 1_234_567.89, 99_999_999]) expect(tickLabel(v).length).toBeLessThanOrEqual(6);
});
