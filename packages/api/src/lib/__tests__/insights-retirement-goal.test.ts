/**
 * The retirement simulation is the one judge of whether retirement is on track.
 * Actions used to tell an "On track" household to "Add $1,000/mo toward
 * Retirement Savings to close its huge gap", off a goal balance measured with
 * no growth (audit W-7). Such an action is dropped.
 */
import { describe, it, expect } from "vitest";


import { pushesOnTrackRetirementGoal } from "../insights-engine.js";

const onTrack = ["Retirement Savings"];

describe("pushesOnTrackRetirementGoal", () => {
  it("drops an action asking for more money toward an on-track retirement goal", () => {
    expect(
      pushesOnTrackRetirementGoal(
        { title: "Add $1,000/mo toward Retirement Savings to close its huge gap", description: "" },
        onTrack,
      ),
    ).toBe(true);
  });
  it("keeps an action about a different goal", () => {
    expect(
      pushesOnTrackRetirementGoal(
        { title: "Raise Become Debt Free savings by $150/mo to hit $8,000 sooner", description: "" },
        onTrack,
      ),
    ).toBe(false);
  });
  it("keeps everything when no retirement goal is on track", () => {
    expect(
      pushesOnTrackRetirementGoal(
        { title: "Add $1,000/mo toward Retirement Savings to close its huge gap", description: "" },
        [],
      ),
    ).toBe(false);
  });
  it("keeps the employer match action, which names no goal", () => {
    expect(
      pushesOnTrackRetirementGoal({ title: "Raise your 401(k) to 4% to claim $3,400/yr in match", description: "" }, onTrack),
    ).toBe(false);
  });
});
