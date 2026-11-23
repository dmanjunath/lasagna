import { getToken } from "@/auth/token";
import { API_URL } from "@/config";
import type { TaxDocument, TaxDocumentSummary } from "@/lib/tax";
import { ApiError, request } from "./client";

// The Tax page's calls, mirroring packages/web/src/lib/api.ts.

export const taxApi = {
  documents: () => request<{ documents: TaxDocumentSummary[] }>("/tax/documents"),
  document: (id: string) => request<{ document: TaxDocument }>(`/tax/documents/${encodeURIComponent(id)}`),
  /** Written on the server on the first read after the documents change, so a read can cost a generation. */
  summary: () => request<{ summary: string | null; generatedAt: string | null }>("/tax/documents/summary"),
  remove: (id: string) => request<{ success: boolean }>(`/tax/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /**
   * A file to read, or a typed description (the web's submitTaxInput). Multipart,
   * so it goes around request(): the boundary is the platform's to set.
   */
  submit: async (input: { file: { uri: string; name: string; type: string } } | { text: string }): Promise<TaxDocumentSummary[]> => {
    const body = new FormData();
    if ("file" in input) body.append("file", input.file as unknown as Blob);
    else body.append("text", input.text);
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/tax/documents`, {
        method: "POST",
        headers: { "x-lasagna-client": "native", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body,
      });
    } catch {
      throw new ApiError("Cannot reach the server. Please check your connection.", 0);
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(err.error || "Submission failed", res.status);
    }
    const data = (await res.json()) as { documents?: TaxDocumentSummary[] };
    return data.documents ?? [];
  },
};
