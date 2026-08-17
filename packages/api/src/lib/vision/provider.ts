/**
 * Where a tax document gets sent for vision extraction.
 *
 * Every provider we use speaks the OpenAI chat-completions protocol, so the
 * only thing that varies is the endpoint, the model name, and the bearer
 * token. `extractFromVision` owns everything else (PDF rendering, the prompt,
 * schema validation, PII scrubbing) because none of that is provider-specific.
 */
export interface VisionTarget {
  /** OpenAI-compatible chat-completions URL. */
  url: string;
  model: string;
  /** Sent as `Authorization: Bearer`. */
  apiKey: string;
}

export interface VisionProvider {
  /** Stable id, used in logs and errors. */
  readonly name: string;
  /**
   * True when the document leaves our GCP project and reaches a third party.
   * Logged on every extraction so this is never silently true.
   */
  readonly sendsDocumentsOffProject: boolean;
  resolve(): Promise<VisionTarget>;
}
