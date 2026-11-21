import { describe, it, expect } from "vitest";
import { cleanGeneratedTitle, displayTitle, fallbackTitle, isUsableTitle, launcherSubject } from "../chat-title.js";

describe("cleanGeneratedTitle", () => {
  it("keeps a plain title and drops quotes and end punctuation", () => {
    expect(cleanGeneratedTitle('"Safe Withdrawal Rate for Retirement."', "stop")).toBe("Safe Withdrawal Rate for Retirement");
  });

  it("rejects the model's reasoning returned as the title", () => {
    expect(
      cleanGeneratedTitle("The user wants a short title (3-6 words) for a financial conversation. The conversation is about ste", "length"),
    ).toBeNull();
    // Even when the provider reports a clean stop.
    expect(cleanGeneratedTitle("The user wants a short title (3-6 words) for a financial conversation", "stop")).toBeNull();
    expect(cleanGeneratedTitle("Okay, here is a title", "stop")).toBeNull();
  });

  it("rejects a reply cut off by the output cap", () => {
    expect(cleanGeneratedTitle("Acceler", "length")).toBeNull();
    expect(cleanGeneratedTitle("Calculating", "stop")).toBeNull();
    expect(cleanGeneratedTitle("user)", "stop")).toBeNull();
  });

  it("rejects empty text and placeholders", () => {
    expect(cleanGeneratedTitle("", "stop")).toBeNull();
    expect(cleanGeneratedTitle("   \n ", "stop")).toBeNull();
    expect(cleanGeneratedTitle("Conversation", "stop")).toBeNull();
  });

  it("strips a thinking block and a Title: label", () => {
    expect(cleanGeneratedTitle("<think>The user asks about debt</think>\nTitle: Pay debt or save first", "stop")).toBe(
      "Pay debt or save first",
    );
  });
});

describe("fallbackTitle", () => {
  it("uses a short first sentence", () => {
    expect(fallbackTitle("How much should I save? I earn 90k.")).toBe("How much should I save?");
  });

  it("cuts a long message on a word boundary", () => {
    const t = fallbackTitle(
      "I want to assess my retirement plan with all of my accounts and the income I expect from my pension later on",
    )!;
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/\s…$/);
  });

  it("names the step for a thread opened from Walk me through this", () => {
    expect(
      fallbackTitle(
        'Walk me through step 3 of my financial path, "Cut spending to free up cash". What exactly should I do on this step, and why does it sit where it does?',
      ),
    ).toBe("Cut spending to free up cash");
  });

  it("names the insight for a thread opened from an insight", () => {
    expect(
      fallbackTitle("Walk me through this insight:\n\nTitle: Move idle cash to savings\nDescription: x\nImpact: $40/mo\n\nWhat now?"),
    ).toBe("Move idle cash to savings");
  });

  it("uses the opening line of a multi-line prompt", () => {
    expect(fallbackTitle("Let's talk about my retirement readiness:\n- Readiness: 100%\n- Age: 55")).toBe(
      "Let's talk about my retirement readiness",
    );
  });

  it("returns null without a message", () => {
    expect(fallbackTitle(null)).toBeNull();
    expect(fallbackTitle("  ")).toBeNull();
  });
});

describe("displayTitle (existing rows, fixed at read time)", () => {
  const ask = "Can I retire at 55? My savings are on track.";

  it("keeps a usable stored title", () => {
    expect(displayTitle("Retirement outlook check", ask)).toBe("Retirement outlook check");
  });

  it("replaces a leaked instruction, a placeholder and a missing title with the first message", () => {
    expect(displayTitle("The user wants a short title (3-6 words) for a financial conversation. The conversation is about ste", ask)).toBe(
      "Can I retire at 55?",
    );
    expect(displayTitle("Conversation", ask)).toBe("Can I retire at 55?");
    expect(displayTitle(null, ask)).toBe("Can I retire at 55?");
  });
});

describe("launcherSubject", () => {
  it("ignores a typed question", () => {
    expect(launcherSubject("Walk me through my budget")).toBeNull();
  });
});

describe("isUsableTitle", () => {
  it("accepts a two-word user-set title", () => {
    expect(isUsableTitle("Debt check")).toBe(true);
  });
});
