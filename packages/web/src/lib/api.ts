import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message, TaxDocument, TaxDocumentSummary, UploadResult, TaxInputResult, ExtractionResult } from "./types.js";

export const API_BASE = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Cannot reach the server. Please check your connection.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error || res.statusText;
    if (res.status === 502 || res.status === 503) {
      throw new Error("Server is temporarily unavailable. Please try again.");
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  signup: (data: { email: string; password: string; name?: string; acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  logout: () => request("/auth/logout", { method: "POST" }),

  me: () =>
    request<{
      user: { id: string; email: string; role: string; onboardingStage: string | null };
      tenant: { id: string; name: string; plan: string } | null;
    }>("/auth/me"),

  updateOnboardingStage: (stage: string | null) =>
    request<{ onboardingStage: string | null }>("/auth/onboarding-stage", {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    }),

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

  getDebts: () =>
    request<{
      debts: Array<{
        id: string;
        name: string;
        type: string;
        subtype: string | null;
        balance: number;
        interestRate: number | null;
        termMonths: number | null;
        originationDate: string | null;
        minimumPayment: number;
        payoffDate: string | null;
        liabilitySource: "plaid" | "manual" | null;
        liabilityLastSyncedAt: string | null;
        lastUpdated: string | null;
      }>;
      totalDebt: number;
      monthlyInterest: number;
    }>("/accounts/debts"),

  patchLoanDetails: (accountId: string, body: Record<string, unknown>) =>
    request<{ metadata: Record<string, unknown> }>(
      `/accounts/${accountId}/loan-details`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  getNetWorthHistory: () =>
    request<{
      history: Array<{ date: string; value: number }>;
    }>("/accounts/net-worth/history"),

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
  triggerResync: () => request("/sync/resync", { method: "POST" }),

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

  createThread: (planId?: string, title?: string, tags?: string[]) =>
    request<{ thread: ChatThread }>("/threads", {
      method: "POST",
      body: JSON.stringify({ planId, title, tags }),
    }),

  deleteThread: (id: string) =>
    request<{ success: boolean }>(`/threads/${id}`, { method: "DELETE" }),

  // Tax Documents
  getTaxDocuments: () =>
    request<{ documents: TaxDocumentSummary[] }>("/tax/documents"),

  getTaxDocument: (id: string) =>
    request<{ document: TaxDocument }>(`/tax/documents/${id}`),

  extractTaxDocument: async (file: File): Promise<ExtractionResult> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/tax/documents/extract`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Extraction failed" }));
      throw new Error(err.error || "Extraction failed");
    }
    return res.json();
  },

  confirmTaxDocument: (extraction: ExtractionResult): Promise<UploadResult> =>
    request<UploadResult>("/tax/documents/confirm", {
      method: "POST",
      body: JSON.stringify(extraction),
    }),

  uploadTaxDocument: async (file: File): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/tax/documents/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Upload failed");
    }
    return res.json();
  },

  submitTaxInput: async (params: {
    file?: File;
    text?: string;
    providerUrl: string;
    apiKey?: string;
    model?: string;
  }): Promise<TaxInputResult[]> => {
    const formData = new FormData();
    if (params.file) formData.append("file", params.file);
    if (params.text) formData.append("text", params.text);
    formData.append("providerUrl", params.providerUrl);
    if (params.apiKey) formData.append("apiKey", params.apiKey);
    if (params.model) formData.append("model", params.model);

    const res = await fetch(`${API_BASE}/api/tax/documents`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" })) as { error: string };
      throw new Error(err.error || "Submission failed");
    }

    const data = await res.json() as { documents?: TaxInputResult[] };
    return data.documents ?? [];
  },

  updateTaxDocument: (id: string, data: { taxYear?: number | null }) =>
    request<{ document: TaxDocument }>(`/tax/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
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

  getFinancialProfile: () =>
    request<{
      financialProfile: {
        dateOfBirth: string | null;
        age: number | null;
        annualIncome: number | null;
        filingStatus: string | null;
        stateOfResidence: string | null;
        employmentType: string | null;
        riskTolerance: string | null;
        retirementAge: number | null;
        employerMatchPercent: number | null;
        dependentCount: number | null;
        hasHDHP: boolean | null;
        isPSLFEligible: boolean | null;
      } | null;
    }>("/settings/financial-profile"),

  updateFinancialProfile: (data: {
    dateOfBirth?: string | null;
    annualIncome?: number | null;
    filingStatus?: string | null;
    stateOfResidence?: string | null;
    employmentType?: string | null;
    riskTolerance?: string | null;
    retirementAge?: number | null;
    employerMatchPercent?: number | null;
    dependentCount?: number | null;
    hasHDHP?: boolean | null;
    isPSLFEligible?: boolean | null;
  }) =>
    request<{ ok: boolean }>("/settings/financial-profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Insights
  getInsights: () =>
    request<{
      insights: Array<{
        id: string;
        category: string;
        urgency: string;
        type: string | null;
        title: string;
        description: string;
        impact: string | null;
        impactColor: string | null;
        chatPrompt: string | null;
        generatedBy: string;
        createdAt: string;
      }>;
      lastActionsGeneratedAt: string | null;
    }>("/insights"),

  dismissInsight: (id: string) =>
    request<{ ok: boolean }>(`/insights/${id}/dismiss`, { method: "POST" }),

  actOnInsight: (id: string) =>
    request<{ ok: boolean }>(`/insights/${id}/acted`, { method: "POST" }),

  generateInsights: () =>
    request<{ ok: boolean; generated: number }>("/insights/generate", { method: "POST" }),

  // Portfolio
  getPortfolioComposition: () =>
    request<{
      totalValue: number;
      assetClasses: Array<{
        name: string;
        value: number;
        percentage: number;
        color: string;
        categories: Array<{
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

  getPortfolioExposure: () =>
    request<{
      totalValue: number;
      blendedReturn: number;
      exposures: Array<{
        name: string;
        assetClass: string;
        value: number;
        percentage: number;
        historicalReturn: number;
        holdings: Array<{ ticker: string; name: string; value: number; account: string; shares: number }>;
      }>;
    }>("/portfolio/exposure"),

  // Transactions
  getTransactions: (params?: { page?: number; limit?: number; category?: string; startDate?: string; endDate?: string; accountId?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
    }
    const qs = searchParams.toString();
    return request<{
      transactions: Array<{ id: string; accountId: string; accountName: string | null; date: string; name: string; merchantName: string | null; amount: string; category: string; pending: number; createdAt: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/transactions${qs ? `?${qs}` : ''}`);
  },

  updateTransactionCategory: (id: string, category: string) =>
    request<{ success: boolean }>(`/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category }),
    }),

  getSpendingSummary: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    const qs = searchParams.toString();
    return request<{
      categories: Array<{ category: string; total: number; count: number; percentage: number }>;
      totalSpending: number;
      totalIncome: number;
      netCashFlow: number;
      period: { start: string; end: string };
    }>(`/transactions/spending-summary${qs ? `?${qs}` : ''}`);
  },

  getMonthlyTrend: () =>
    request<{
      months: Array<{ month: string; income: number; expenses: number; net: number }>;
    }>('/transactions/monthly-trend'),

  // Goals
  getGoals: () =>
    request<{
      goals: Array<{ id: string; name: string; targetAmount: string; currentAmount: string; deadline: string | null; category: string; status: string; icon: string | null; createdAt: string }>;
    }>('/goals'),

  createGoal: (data: { name: string; targetAmount: number; deadline?: string; category?: string; icon?: string }) =>
    request<{ goal: { id: string } }>('/goals', { method: 'POST', body: JSON.stringify(data) }),

  updateGoal: (id: string, data: { currentAmount?: number; name?: string; targetAmount?: number; deadline?: string; status?: string }) =>
    request<{ ok: boolean }>(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteGoal: (id: string) =>
    request<{ ok: boolean }>(`/goals/${id}`, { method: 'DELETE' }),

  // Priorities
  getPriorities: () =>
    request<{
      steps: Array<{
        id: string;
        order: number;
        title: string;
        subtitle: string;
        description: string;
        icon: string;
        status: string;
        skipped: boolean;
        current: number | null;
        target: number | null;
        progress: number;
        action: string;
        detail: string;
        priority: string;
        note: string;
      }>;
      currentStepId: string;
      summary: {
        monthlyIncome: number;
        monthlyExpenses: number;
        monthlySurplus: number;
        totalCash: number;
        totalInvested: number;
        totalHighInterestDebt: number;
        totalMediumInterestDebt: number;
        age: number | null;
        retirementAge: number;
        filingStatus: string | null;
      };
    }>('/priorities'),

  skipPriorityStep: (stepId: string, skipped: boolean) =>
    request<{ ok: boolean; skippedSteps: string[] }>('/priorities/skip', {
      method: 'PATCH',
      body: JSON.stringify({ stepId, skipped }),
    }),

  completePriorityStep: async (stepId: string, completed: boolean, note?: string) => {
    const res = await fetch(`${API_BASE}/api/priorities/complete`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, completed, note: note ?? '' }),
    });
    if (!res.ok) throw new Error('Failed to update completion');
  },

  // Manual Accounts
  createManualAccount: (data: { name: string; type: string; subtype?: string; balance?: number; metadata?: Record<string, unknown>; linkedAccountId?: string }) =>
    request<{ account: { id: string; name: string; type: string } }>('/manual-accounts', { method: 'POST', body: JSON.stringify(data) }),

  updateManualAccount: (id: string, data: { name?: string; balance?: number; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean }>(`/manual-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteManualAccount: (id: string) =>
    request<{ ok: boolean }>(`/manual-accounts/${id}`, { method: 'DELETE' }),
};
