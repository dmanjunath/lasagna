import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARM_BOX, ARM_SHOULDER, HELLO_WAVE, splitWavingArm, WAVE_BACK, WAVE_OUT, waveHand } from "../mascot-arm";
import { getTheme } from "../registry";

describe("the waving arm", () => {
  const happy = getTheme("noodle").mascot!.happy;

  it("lifts the raised arm out of the happy artwork", () => {
    const split = splitWavingArm(happy);
    assert.ok(split);
    assert.ok(!split.body.includes('d="M122 70 L134 50"'));
    assert.ok(split.arm.includes('d="M122 70 L134 50"'));
    assert.ok(split.arm.includes(`viewBox="${ARM_BOX.x} ${ARM_BOX.y} ${ARM_BOX.w} ${ARM_BOX.h}"`));
  });

  it("has no arm to wave on the sleepy artwork", () => {
    assert.equal(splitWavingArm(getTheme("noodle").mascot!.sleepy), null);
  });

  it("turns at the shoulder and waves three times, ending at rest", () => {
    assert.ok(ARM_SHOULDER.x > 0.7 && ARM_SHOULDER.x < 0.8);
    assert.equal(HELLO_WAVE.length, 6);
    assert.equal(HELLO_WAVE.at(-1), 0);
  });

  it("keeps the hand outside the body and inside the arm's layer across the whole wave", () => {
    for (const deg of [WAVE_BACK, 0, WAVE_OUT]) {
      const hand = waveHand(deg);
      assert.ok(hand.x > 124 + 2, `hand at ${deg} deg is right of the body`);
      assert.ok(hand.x < ARM_BOX.x + ARM_BOX.w - 2, `hand at ${deg} deg stays inside the layer`);
      assert.ok(hand.y > ARM_BOX.y + 2, `hand at ${deg} deg stays below the layer's top`);
    }
    // Turned toward the body (the old -38 degrees), the hand slips behind it.
    assert.ok(waveHand(-38).x < 124);
  });

  it("puts the shoulder where the arm starts, in the arm layer's box", () => {
    assert.ok(Math.abs(ARM_SHOULDER.x * ARM_BOX.w - 122) < 1e-9);
    assert.ok(Math.abs(ARM_SHOULDER.y * ARM_BOX.h + ARM_BOX.y - 70) < 1e-9);
  });
});
