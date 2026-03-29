import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message, TaxReturn, TaxDocument, ExtractedData, FilingStatus } from "./types.js";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  signup: (data: { email: string; password: string; name?: string }) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  logout: () => request("/auth/logout", { method: "POST" }),

  me: () =>
    request<{
      user: { id: string; email: string; role: string };
      tenant: { id: string; name: string; plan: string } | null;
    }>("/auth/me"),

  // Plaid
  createLinkToken: () =>
    request<{ linkToken: string }>("/plaid/link-token", { method: "POST" }),

  exchangeToken: (data: {
    publicToken: string;
    institutionId?: string;
    institutionName?: string;
  }) =>
    request<{ itemId: string }>("/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getItems: () =>
    request<{
      items: Array<{
        id: string;
        institutionId: string | null;
        institutionName: string | null;
        status: string;
        lastSyncedAt: string | null;
        accounts: Array<{
          id: string;
          name: string;
          type: string;
          subtype: string | null;
          mask: string | null;
          balance: string | null;
          currency: string;
        }>;
      }>;
    }>("/plaid/items"),

  deleteItem: (id: string) =>
    request(`/plaid/items/${id}`, { method: "DELETE" }),

  // Accounts
  getAccounts: () =>
    request<{
      accounts: Array<{
        id: string;
        name: string;
        type: string;
        mask: string | null;
      }>;
    }>("/accounts"),

  getBalances: () =>
    request<{
      balances: Array<{
        accountId: string;
        name: string;
        type: string;
        mask: string | null;
        balance: string | null;
        available: string | null;
        currency: string;
        asOf: string | null;
      }>;
    }>("/accounts/balances"),

  getHistory: (accountId: string) =>
    request<{
      account: { id: string; name: string; type: string };
      snapshots: Array<{
        balance: string | null;
        snapshotAt: string;
      }>;
    }>(`/accounts/${accountId}/history`),

  // Holdings
  getHoldings: () =>
    request<{
      holdings: Array<{
        id: string;
        accountName: string | null;
        tickerSymbol: string | null;
        securityName: string | null;
        quantity: string | null;
        institutionValue: string | null;
        costBasis: string | null;
      }>;
    }>("/holdings"),

  // Sync
  triggerSync: () => request("/sync", { method: "POST" }),

  // Plans
  getPlans: () => request<{ plans: Plan[] }>("/plans"),

  getPlan: (id: string) => request<Plan>(`/plans/${id}`),

  createPlan: (type: PlanType, title?: string) =>
    request<{ plan: Plan }>("/plans", {
      method: "POST",
      body: JSON.stringify({ type, title }),
    }),

  updatePlan: (id: string, updates: { title?: string; status?: PlanStatus }) =>
    request(`/plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  deletePlan: (id: string) => request(`/plans/${id}`, { method: "DELETE" }),

  getPlanHistory: (id: string) =>
    request<{ history: PlanEdit[] }>(`/plans/${id}/history`),

  clonePlan: (id: string) =>
    request<{ plan: Plan }>(`/plans/${id}/clone`, { method: "POST" }),

  // Threads
  getThreads: (planId?: string) =>
    request<{ threads: ChatThread[] }>(
      planId ? `/threads?planId=${planId}` : "/threads"
    ),

  getThread: (id: string) =>
    request<{ thread: ChatThread; messages: Message[] }>(`/threads/${id}`),

  createThread: (planId?: string) =>
    request<{ thread: ChatThread }>("/threads", {
      method: "POST",
      body: JSON.stringify({ planId }),
    }),

  // Tax
  getTaxReturns: () =>
    request<{ returns: TaxReturn[] }>("/tax/returns"),

  getTaxReturn: (id: string) =>
    request<{ taxReturn: TaxReturn; documents: TaxDocument[] }>(`/tax/returns/${id}`),

  createTaxReturn: (taxYear: number, filingStatus?: FilingStatus) =>
    request<{ taxReturn: TaxReturn }>("/tax/returns", {
      method: "POST",
      body: JSON.stringify({ taxYear, filingStatus }),
    }),

  addTaxDocument: (taxReturnId: string, documentType: string, extractedData: ExtractedData) =>
    request<{ document: TaxDocument }>(`/tax/returns/${taxReturnId}/documents`, {
      method: "POST",
      body: JSON.stringify({ documentType, extractedData }),
    }),

  updateTaxDocument: (id: string, extractedData: ExtractedData) =>
    request<{ document: TaxDocument }>(`/tax/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ extractedData }),
    }),

  deleteTaxDocument: (id: string) =>
    request<{ success: boolean }>(`/tax/documents/${id}`, { method: "DELETE" }),

  // Settings
  getProfile: () =>
    request<{
      profile: {
        email: string;
        name: string | null;
        plan: string;
        createdAt: string;
      };
    }>("/settings/profile"),

  updateProfile: (data: { name?: string }) =>
    request<{
      profile: { name: string | null; plan: string };
    }>("/settings/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/settings/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Portfolio
  getPortfolioComposition: () =>
    request<{
      totalValue: number;
      assetClasses: Array<{
        name: string;
        value: number;
        percentage: number;
        color: string;
        subCategories: Array<{
          name: string;
          value: number;
          percentage: number;
          holdings: Array<{
            ticker: string;
            name: string;
            shares: number;
            value: number;
            costBasis: number | null;
            account: string;
          }>;
        }>;
      }>;
    }>("/portfolio/composition"),

  getPortfolioAllocation: () =>
    request<{
      allocation: {
        usStocks: number;
        intlStocks: number;
        bonds: number;
        reits: number;
        cash: number;
      };
      totalValue: number;
    }>("/portfolio/allocation"),
};
