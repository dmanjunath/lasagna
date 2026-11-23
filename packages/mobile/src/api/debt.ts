import type { DebtsResponse } from "@/lib/debt";
import { request } from "./client";

// The Debt page's call, mirroring packages/web/src/lib/api.ts getDebts.

export const debtApi = {
  list: () => request<DebtsResponse>("/accounts/debts"),
};
