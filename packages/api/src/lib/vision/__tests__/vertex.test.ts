import { describe, it, expect } from "vitest";
import { chatCompletionsUrl, vertexVisionProvider } from "../vertex.js";

describe("chatCompletionsUrl", () => {
  it("uses the bare host for global-only models", () => {
    expect(chatCompletionsUrl("example-project", "global")).toBe(
      "https://aiplatform.googleapis.com/v1/projects/example-project/locations/global/endpoints/openapi/chat/completions"
    );
  });

  it("uses a per-region host for regional models", () => {
    expect(chatCompletionsUrl("example-project", "us-central1")).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/example-project/locations/us-central1/endpoints/openapi/chat/completions"
    );
  });
});

describe("vertexVisionProvider", () => {
  it("is marked as keeping documents inside the project", () => {
    expect(vertexVisionProvider.name).toBe("vertex");
    expect(vertexVisionProvider.sendsDocumentsOffProject).toBe(false);
  });
});
