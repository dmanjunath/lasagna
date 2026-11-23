import type { Composition, Exposure, SymbolAccounts } from "@/lib/portfolio";
import { request } from "./client";

// The Portfolio page's calls, mirroring packages/web/src/lib/api.ts.

export const portfolioApi = {
  composition: () => request<Composition>("/portfolio/composition"),
  exposure: () => request<Exposure>("/portfolio/exposure"),
  symbolAccounts: (symbol: string) => request<SymbolAccounts>(`/portfolio/holdings/${encodeURIComponent(symbol)}/accounts`),
};
