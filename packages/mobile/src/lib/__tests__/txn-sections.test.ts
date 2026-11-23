import { headerIndices, toSections } from "../txn-sections";

const row = (id: string, date: string) => ({ id, date }) as never;
const now = new Date(2026, 10, 21, 12);

test("inserts a header before each new day", () => {
  const items = toSections([row("a", "2026-11-21T00:00:00Z"), row("b", "2026-11-21T00:00:00Z"), row("c", "2026-11-19T00:00:00Z")], true, now);
  expect(items.map((i) => (i.type === "header" ? `h:${i.label}` : i.row.id))).toEqual(["h:Today", "a", "b", "h:Nov 19", "c"]);
});

test("no headers when not sorted by date", () => {
  const items = toSections([row("a", "2026-11-21T00:00:00Z"), row("b", "2026-11-19T00:00:00Z")], false, now);
  expect(items.every((i) => i.type === "row")).toBe(true);
});

test("header keys are stable per day", () => {
  const items = toSections([row("a", "2026-11-19T00:00:00Z")], true, now);
  expect(items[0].key).toBe("day:2026-11-19");
});

test("the create-rule prompt follows its row, and headers are indexed", () => {
  const items = toSections([row("a", "2026-11-21T00:00:00Z"), row("b", "2026-11-19T00:00:00Z")], true, now, "a");
  expect(items.map((i) => i.key)).toEqual(["day:2026-11-21", "a", "prompt:a", "day:2026-11-19", "b"]);
  expect(headerIndices(items)).toEqual([0, 3]);
});
