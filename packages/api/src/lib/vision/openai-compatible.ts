import { env } from "../env.js";
import type { VisionProvider, VisionTarget } from "./provider.js";

/**
 * Any OpenAI-compatible endpoint (OpenRouter, sail, a self-hosted vLLM server).
 *
 * WARNING: this sends raw tax documents to whatever host you configure. The
 * whole point of moving extraction to Vertex was to stop doing that, so this
 * exists for swappability and self-hosted testing, not as a casual default.
 * It is only reachable by setting VISION_PROVIDER server-side. A browser
 * cannot select it, which was the original bug.
 */
export const openAiCompatibleVisionProvider: VisionProvider = {
  name: "openai-compatible",
  sendsDocumentsOffProject: true,

  async resolve(): Promise<VisionTarget> {
    const url = env.VISION_API_URL;
    const model = env.VISION_MODEL;
    if (!url || !model) {
      throw new Error(
        'VISION_PROVIDER is "openai-compatible" but VISION_API_URL or VISION_MODEL is unset.'
      );
    }
    return { url, model, apiKey: env.VISION_API_KEY };
  },
};
