import { INITIAL_OPEN, nextOpen, openCount, reportOpen, resetOpens, subscribeOpens, type OpenEvent, type OpenState } from "../app-open";

function run(events: OpenEvent[], from: OpenState = INITIAL_OPEN) {
  let s = from;
  const fired: number[] = [];
  events.forEach((e, i) => {
    const r = nextOpen(s, e);
    s = r.state;
    if (r.opened) fired.push(i);
  });
  return { state: s, fired };
}

describe("app open", () => {
  it("a cold start opens once the launch screen has gone", () => {
    expect(run([{ type: "splashHidden" }]).fired).toEqual([0]);
  });

  it("a cold start behind the Face ID lock opens when the lock lifts, not before", () => {
    const { fired } = run([{ type: "covered", covered: true }, { type: "splashHidden" }, { type: "covered", covered: false }]);
    expect(fired).toEqual([2]);
  });

  it("a return from the background opens again once the cover lifts", () => {
    const { fired } = run([
      { type: "splashHidden" },
      { type: "covered", covered: true },
      { type: "background" },
      { type: "covered", covered: false },
    ]);
    expect(fired).toEqual([0, 3]);
  });

  it("the cover's own bounce (the app-switcher peek, the Face ID sheet) is not an open", () => {
    const { fired } = run([{ type: "splashHidden" }, { type: "covered", covered: true }, { type: "covered", covered: false }]);
    expect(fired).toEqual([0]);
  });

  it("counts opens for listeners", () => {
    resetOpens();
    const seen: number[] = [];
    const off = subscribeOpens(() => seen.push(openCount()));
    reportOpen({ type: "splashHidden" });
    reportOpen({ type: "background" });
    reportOpen({ type: "covered", covered: false });
    off();
    expect(seen).toEqual([1, 2]);
  });
});
