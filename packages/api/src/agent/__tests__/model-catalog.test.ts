import { describe, it, expect } from "vitest";
import { CHAT_MODEL_CATALOG, isAllowedModel } from "../agent.js";

describe("chat model catalog", () => {
  it("offers models for both providers", () => {
    expect(CHAT_MODEL_CATALOG.openrouter.length).toBeGreaterThan(0);
    expect(CHAT_MODEL_CATALOG.sail.length).toBeGreaterThan(0);
  });

  it("isAllowedModel accepts (provider, model) pairs that are in the catalog", () => {
    const or = CHAT_MODEL_CATALOG.openrouter[0];
    expect(isAllowedModel("openrouter", or.id)).toBe(true);
    const sail = CHAT_MODEL_CATALOG.sail[0];
    expect(isAllowedModel("sail", sail.id)).toBe(true);
  });

  it("isAllowedModel rejects unknown provider, unknown model, and cross-provider slugs", () => {
    expect(isAllowedModel("openrouter", "definitely/not-a-real-model")).toBe(false);
    expect(isAllowedModel("bogus-provider", CHAT_MODEL_CATALOG.openrouter[0].id)).toBe(false);
    // A slug that only exists under OpenRouter must not validate under sail —
    // this is what stops an admin (or a spoofed request) pinning a model to the
    // wrong provider.
    const orOnly = CHAT_MODEL_CATALOG.openrouter.find(
      (m) => !CHAT_MODEL_CATALOG.sail.some((s) => s.id === m.id),
    );
    expect(orOnly).toBeDefined();
    expect(isAllowedModel("sail", orOnly!.id)).toBe(false);
  });
});
