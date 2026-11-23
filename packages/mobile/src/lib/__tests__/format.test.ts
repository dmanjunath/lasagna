import { dayLabel, formatCurrencyExact, formatMoney, storedDayKey } from "../format";
import { setAmountsHidden } from "../hide-amounts";

afterEach(() => setAmountsHidden(false));

test("formatCurrencyExact prints cents", () => {
  expect(formatCurrencyExact(1234.5)).toBe("$1,234.50");
});

test("formatMoney uses a real minus and can be compact", () => {
  expect(formatMoney(-12.3)).toBe("−$12.30");
  expect(formatMoney(1500, true)).toBe("$1,500");
  expect(formatMoney(null)).toBe("—");
});

test("amounts mask when hidden", () => {
  setAmountsHidden(true);
  expect(formatCurrencyExact(5)).toBe("$•••••");
  expect(formatMoney(5)).toBe("$•••••");
});

test("storedDayKey reads the stored UTC day", () => {
  expect(storedDayKey("2026-04-16T00:00:00.000Z")).toBe("2026-04-16");
});

test("dayLabel names today, yesterday, and other years", () => {
  const now = new Date(2026, 10, 21, 15);
  expect(dayLabel("2026-11-21T00:00:00.000Z", now)).toBe("Today");
  expect(dayLabel("2026-11-20T00:00:00.000Z", now)).toBe("Yesterday");
  expect(dayLabel("2026-11-02T00:00:00.000Z", now)).toBe("Nov 2");
  expect(dayLabel("2025-11-02T00:00:00.000Z", now)).toBe("Nov 2, 2025");
});

import { parseStored } from "../format";

test("parseStored reads the Postgres text form and plain ISO", () => {
  expect(parseStored("2026-06-01 09:00:00+00").toISOString()).toBe("2026-06-01T09:00:00.000Z");
  expect(parseStored("2026-06-01 09:00:00.5-05:30").toISOString()).toBe("2026-06-01T14:30:00.500Z");
  expect(parseStored("2026-11-19T14:10:00.000Z").toISOString()).toBe("2026-11-19T14:10:00.000Z");
});
