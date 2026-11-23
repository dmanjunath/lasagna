import { barOpacity, chromeProgress, inlineTitleOpacity } from "../collapsing-header";

const title = { y: 4, height: 40 };

describe("chromeProgress", () => {
  it("is 0 at rest and while pulling to refresh", () => {
    expect(chromeProgress(0, title, false)).toBe(0);
    expect(chromeProgress(-80, title, false)).toBe(0);
  });

  it("follows the title as it passes under the bar", () => {
    expect(chromeProgress(4, title, false)).toBe(0);
    expect(chromeProgress(24, title, false)).toBe(0.5);
    expect(chromeProgress(44, title, false)).toBe(1);
    expect(chromeProgress(900, title, false)).toBe(1);
  });

  it("treats any scroll as gone before the title is measured", () => {
    expect(chromeProgress(0, null, false)).toBe(0);
    expect(chromeProgress(1, null, false)).toBe(1);
    expect(chromeProgress(10, { y: 0, height: 0 }, false)).toBe(1);
  });

  it("switches at halfway with Reduce Motion", () => {
    expect(chromeProgress(23, title, true)).toBe(0);
    expect(chromeProgress(24, title, true)).toBe(1);
    expect(chromeProgress(-20, title, true)).toBe(0);
  });
});

describe("bar layers", () => {
  it("fades the small title in over the second half", () => {
    expect(inlineTitleOpacity(0)).toBe(0);
    expect(inlineTitleOpacity(0.5)).toBe(0);
    expect(inlineTitleOpacity(0.75)).toBe(0.5);
    expect(inlineTitleOpacity(1)).toBe(1);
  });

  it("brings the surface in with the passage", () => {
    expect(barOpacity(-1)).toBe(0);
    expect(barOpacity(0.3)).toBe(0.3);
    expect(barOpacity(2)).toBe(1);
  });
});
