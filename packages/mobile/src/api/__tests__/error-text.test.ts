import { ApiError, errorText } from "../client";

describe("errorText", () => {
  it("tells a phone that can't reach the server so, never that it's on our side", () => {
    const text = errorText(new ApiError("Cannot reach the server.", 0));
    expect(text).toBe("Can't reach LasagnaFi. Check your connection and try again.");
    expect(text).not.toMatch(/our side/);
  });

  it("owns a server failure", () => {
    expect(errorText(new ApiError("boom", 500))).toBe("This is on our side, so trying again usually works.");
    expect(errorText(new ApiError("down", 503))).toMatch(/our side/);
  });

  it("stays neutral for anything else", () => {
    for (const e of [new ApiError("nope", 404), new ApiError("bad", 400), new Error("parse"), undefined]) {
      const text = errorText(e);
      expect(text).toBe("Something went wrong. Try again in a moment.");
    }
  });
});
