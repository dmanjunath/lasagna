import { env } from "../env.js";
import type { VisionProvider } from "./provider.js";
import { vertexVisionProvider } from "./vertex.js";
import { openAiCompatibleVisionProvider } from "./openai-compatible.js";

export type { VisionProvider, VisionTarget } from "./provider.js";

const PROVIDERS: Record<string, VisionProvider> = {
  [vertexVisionProvider.name]: vertexVisionProvider,
  [openAiCompatibleVisionProvider.name]: openAiCompatibleVisionProvider,
};

/**
 * Chosen server-side only. The browser used to pass its own endpoint, which
 * meant a user could point tax documents anywhere.
 */
export function visionProvider(): VisionProvider {
  const name = env.VISION_PROVIDER;
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown VISION_PROVIDER "${name}". Options: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }
  return provider;
}
