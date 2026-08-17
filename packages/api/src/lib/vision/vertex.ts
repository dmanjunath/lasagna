import { GoogleAuth } from "google-auth-library";
import { env } from "../env.js";
import type { VisionProvider, VisionTarget } from "./provider.js";

/**
 * Vertex AI. The document stays inside our own GCP project, so no third-party
 * model provider sees it. Google's Service Specific Terms section 17 forbids
 * training on customer data, and project-level prompt caching is disabled.
 *
 * Credentials come from ADC: the metadata server on Cloud Run, `gcloud auth
 * application-default login` locally. GoogleAuth caches and refreshes, so
 * callers can just await it per request.
 */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

let cachedProject: string | undefined;

/** Resolved from ADC so no environment-specific project id lives in the repo. */
async function project(): Promise<string> {
  if (env.VERTEX_PROJECT) return env.VERTEX_PROJECT;
  cachedProject ??= await auth.getProjectId();
  return cachedProject;
}

/**
 * Global-only models (gemini-3.1-pro-preview among them) live on the bare host;
 * regional models are served from a per-region host. Getting this wrong is a
 * 404, so it is a pure function with its own test.
 */
export function chatCompletionsUrl(project: string, location: string): string {
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`;
}

export const vertexVisionProvider: VisionProvider = {
  name: "vertex",
  sendsDocumentsOffProject: false,

  async resolve(): Promise<VisionTarget> {
    if (!env.VERTEX_VISION_MODEL) {
      throw new Error("VERTEX_VISION_MODEL is unset.");
    }
    const apiKey = await auth.getAccessToken();
    if (!apiKey) {
      throw new Error(
        "No Vertex AI access token. Run `gcloud auth application-default login` locally, " +
          "or give the Cloud Run service account roles/aiplatform.user."
      );
    }
    return {
      url: chatCompletionsUrl(await project(), env.VERTEX_LOCATION),
      model: env.VERTEX_VISION_MODEL,
      apiKey,
    };
  },
};
