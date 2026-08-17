import { GoogleAuth } from "google-auth-library";
import type { VisionProvider, VisionTarget } from "./provider.js";

/**
 * Vertex AI. The document stays inside our own GCP project, so no third-party
 * model provider sees it. Google's Service Specific Terms section 17 forbids
 * training on customer data, and project-level prompt caching is disabled.
 *
 * Needs no configuration. Credentials and the project both come from ADC: the
 * metadata server on Cloud Run, `gcloud auth application-default login`
 * locally.
 */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

// gemini-3.1-pro-preview is served from the global endpoint only. Changing
// either of these means re-checking extraction accuracy against real
// documents, so they are code decisions rather than deploy-time config.
const LOCATION = "global";
const MODEL = "google/gemini-3.1-pro-preview";

let cachedProject: string | undefined;

/**
 * On Cloud Run the metadata server answers. With user ADC locally it does not,
 * but those credentials still carry the quota project, so fall back to that
 * rather than making every developer set an env var.
 */
async function project(): Promise<string> {
  if (cachedProject) return cachedProject;
  try {
    cachedProject = await auth.getProjectId();
  } catch {
    const client = await auth.getClient();
    if (!client.quotaProjectId) {
      throw new Error(
        "Could not determine the GCP project. Run `gcloud auth application-default login`."
      );
    }
    cachedProject = client.quotaProjectId;
  }
  return cachedProject;
}

/**
 * Global-only models live on the bare host; regional models are served from a
 * per-region host. Getting this wrong is a 404, so it is a pure function with
 * its own test.
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
    const apiKey = await auth.getAccessToken();
    if (!apiKey) {
      throw new Error(
        "No Vertex AI access token. Run `gcloud auth application-default login` locally, " +
          "or give the Cloud Run service account roles/aiplatform.user."
      );
    }
    return {
      url: chatCompletionsUrl(await project(), LOCATION),
      model: MODEL,
      apiKey,
    };
  },
};
