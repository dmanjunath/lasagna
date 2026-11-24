import { getTheme } from "@lasagna/design";
import { ARM_BOX, ARM_SHOULDER, splitWavingArm, WAVE_SHOULDER, waveHand } from "../mascot-arm";

const { happy, sleepy } = getTheme("noodle").mascot!;

describe("splitWavingArm", () => {
  test("lifts the raised arm out of the happy artwork into its own layer", () => {
    const split = splitWavingArm(happy)!;
    expect(split).not.toBeNull();
    expect(split.body).not.toContain('d="M122 70 L134 50"');
    expect(split.body).toContain('d="M16 84 L4 96"');
    // The arm's layer has room to the right and above the artwork, so a wide wave is never clipped.
    expect(split.arm).toMatch(/^<svg[^>]*viewBox="0 -24 164 148"[^>]*><path d="M122 70 L134 50"[^>]*\/><\/svg>$/);
    expect(ARM_SHOULDER.x * ARM_BOX.w).toBeCloseTo(122);
    expect(ARM_SHOULDER.y * ARM_BOX.h + ARM_BOX.y).toBeCloseTo(70);
  });
  test("an artwork without a raised arm is left whole", () => {
    expect(splitWavingArm(sleepy)).toBeNull();
  });
  test("the shoulder sits where the arm starts", () => {
    expect(WAVE_SHOULDER.x).toBeCloseTo(122 / 140);
    expect(WAVE_SHOULDER.y).toBeCloseTo(70 / 124);
  });
});

test("the wave's swing keeps the hand outside the body and inside the arm's layer", () => {
  // The bounds PullRefresh's wave swings between (WAVE_BACK, WAVE_OUT), and rest: a wide, 58 degree arc.
  for (const deg of [-18, 0, 40]) {
    const hand = waveHand(deg);
    expect(hand.x).toBeGreaterThan(124 + 2); // the body's right edge, plus half the stroke
    expect(hand.x).toBeLessThan(ARM_BOX.x + ARM_BOX.w - 2);
    expect(hand.y).toBeGreaterThan(ARM_BOX.y + 2);
  }
  // Turned toward the body the old way, the hand slips behind it.
  expect(waveHand(-38).x).toBeLessThan(124);
});
