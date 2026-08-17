import { describe, it, expect, afterEach } from "vitest";
import { visionProvider } from "../index.js";
import { openAiCompatibleVisionProvider } from "../openai-compatible.js";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("visionProvider", () => {
  it("defaults to vertex, so documents stay in the GCP project", () => {
    delete process.env.VISION_PROVIDER;
    const provider = visionProvider();
    expect(provider.name).toBe("vertex");
    expect(provider.sendsDocumentsOffProject).toBe(false);
  });

  it("selects the openai-compatible provider only when explicitly asked", () => {
    process.env.VISION_PROVIDER = "openai-compatible";
    const provider = visionProvider();
    expect(provider.name).toBe("openai-compatible");
    // The route logs a warning off the back of this flag.
    expect(provider.sendsDocumentsOffProject).toBe(true);
  });

  it("throws on an unknown provider rather than falling back silently", () => {
    process.env.VISION_PROVIDER = "definitely-not-a-provider";
    expect(() => visionProvider()).toThrow(/Unknown VISION_PROVIDER/);
  });
});

describe("openAiCompatibleVisionProvider", () => {
  it("refuses to resolve when the endpoint is not configured", async () => {
    delete process.env.VISION_API_URL;
    delete process.env.VISION_MODEL;
    await expect(openAiCompatibleVisionProvider.resolve()).rejects.toThrow(
      /VISION_API_URL or VISION_MODEL is unset/
    );
  });

  it("returns the configured target", async () => {
    process.env.VISION_API_URL = "https://example.test/v1/chat/completions";
    process.env.VISION_MODEL = "some/model";
    process.env.VISION_API_KEY = "test-key";
    await expect(openAiCompatibleVisionProvider.resolve()).resolves.toEqual({
      url: "https://example.test/v1/chat/completions",
      model: "some/model",
      apiKey: "test-key",
    });
  });
});
