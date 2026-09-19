import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_LIMITS,
  FREE_MODEL_LEVEL,
  maxInstitutions,
  canManualSync,
  isModelAllowed,
  allowedModelLevels,
  PRO_MANUAL_SYNC_COOLDOWN_MS,
} from "../billing.js";

describe("billing policy", () => {
  it("free allows 2 institutions, pro allows 50", () => {
    assert.equal(maxInstitutions("free"), 2);
    assert.equal(maxInstitutions("pro"), 50);
  });

  it("exposes the institution cap on PLAN_LIMITS itself", () => {
    assert.equal(PLAN_LIMITS.free.maxInstitutions, 2);
    assert.equal(PLAN_LIMITS.pro.maxInstitutions, 50);
  });

  it("only pro can manual sync", () => {
    assert.equal(canManualSync("free"), false);
    assert.equal(canManualSync("pro"), true);
  });

  it("free is limited to the free model level", () => {
    assert.equal(isModelAllowed("free", FREE_MODEL_LEVEL), true);
    assert.equal(isModelAllowed("free", "frontier"), false);
    assert.equal(isModelAllowed("free", "fast-claude"), false);
  });

  it("pro can use any model level", () => {
    assert.equal(isModelAllowed("pro", "frontier"), true);
    assert.equal(isModelAllowed("pro", FREE_MODEL_LEVEL), true);
  });

  it("allowedModelLevels filters the universe by plan", () => {
    const all = ["free", "fast", "frontier"];
    assert.deepEqual(allowedModelLevels("free", all), ["free"]);
    assert.deepEqual(allowedModelLevels("pro", all), all);
  });

  it("exposes a manual-sync cooldown constant", () => {
    assert.equal(PRO_MANUAL_SYNC_COOLDOWN_MS, 5 * 60 * 1000);
  });
});
