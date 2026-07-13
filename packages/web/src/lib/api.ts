import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message, TaxDocument, TaxDocumentSummary, UploadResult, TaxInputResult, ExtractionResult } from "./types.js";
import { isNativeApp, getNativeToken } from "./native.js";

export const API_BASE = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  // Native shell (capacitor://localhost): cookies don't survive cross-origin,
  // so identify as native and authenticate with the stored Bearer token.
  const native = isNativeApp();
  const nativeToken = getNativeToken();
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(native ? { "x-lasagna-client": "native" } : {}),
        ...(nativeToken ? { Authorization: `Bearer ${nativeToken}` } : {}),
        ...((options?.headers as Record<string, string> | undefined) ?? {}),
      },
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
  signup: (data: { email: string; password?: string; name?: string; acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }): Promise<{ needsVerification: true; email: string }> =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }): Promise<
    | { user: { id: string; email: string; name: string | null; role: string; onboardingStage: string | null; isAdmin: boolean; hasAcceptedTerms: boolean }; tenant: { id: string; name: string; plan: string } | null }
    | { needsVerification: true; email: string }
  > =>
    request("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  // Two-step (email-first) login
  loginStart: (email: string) =>
    request<{ step: "password" | "code" }>("/auth/login/start", { method: "POST", body: JSON.stringify({ email }) }),
  loginSendCode: (email: string) =>
    request("/auth/login/send-code", { method: "POST", body: JSON.stringify({ email }) }),
  loginCode: (email: string, code: string): Promise<{ user: { id: string; email: string; name: string | null; role: string; onboardingStage: string | null; isAdmin: boolean; hasAcceptedTerms: boolean }; tenant: { id: string; name: string; plan: string } | null; token?: string }> =>
    request("/auth/login/code", { method: "POST", body: JSON.stringify({ email, code }) }),

  setPassword: (password: string) =>
    request("/auth/set-password", { method: "POST", body: JSON.stringify({ password }) }),

  verifyEmail: (data: { email: string; code: string; setPassword: boolean; acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }): Promise<{ token?: string }> =>
    request("/auth/verify-email", { method: "POST", body: JSON.stringify(data) }),

  forgotPassword: (email: string) =>
    request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, newPassword: string) =>
    request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  acceptTerms: () => request("/auth/accept-terms", { method: "POST" }),

  logout: () => request("/auth/logout", { method: "POST" }),

  // WebAuthn / passkeys (Face ID / Touch ID sign-in)
  webauthnRegisterOptions: () =>
    request<Record<string, unknown>>("/auth/webauthn/register/options", { method: "POST" }),
  webauthnRegisterVerify: (data: { response: unknown; deviceName?: string }) =>
    request<{ ok: boolean }>("/auth/webauthn/register/verify", { method: "POST", body: JSON.stringify(data) }),
  webauthnLoginOptions: () =>
    request<Record<string, unknown>>("/auth/webauthn/login/options", { method: "POST" }),
  webauthnLoginVerify: (data: { response: unknown }): Promise<{
    user: { id: string; email: string; name: string | null; role: string; onboardingStage: string | null; isAdmin: boolean; hasAcceptedTerms: boolean };
    tenant: { id: string; name: string; plan: string } | null;
  }> => request("/auth/webauthn/login/verify", { method: "POST", body: JSON.stringify(data) }),
  listPasskeys: () =>
    request<{ credentials: { id: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null }[] }>(
      "/auth/webauthn/credentials",
    ),
  deletePasskey: (id: string) =>
    request<{ ok: boolean }>(`/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: "DELETE" }),

  me: () =>
    request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        onboardingStage: string | null;
        isAdmin: boolean;
        hasAcceptedTerms: boolean;
        hasPassword: boolean;
        lastLoginAt: string | null;
        notifyDaily: boolean;
        notifyBills: boolean;
        notifyWeeklyEmail: boolean;
      };
      tenant: { id: string; name: string; plan: string } | null;
    }>("/auth/me"),

  updateMe: (updates: { name?: string | null; notifyDaily?: boolean; notifyBills?: boolean; notifyWeeklyEmail?: boolean }) =>
    request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        onboardingStage: string | null;
        isAdmin: boolean;
        hasAcceptedTerms: boolean;
        hasPassword: boolean;
        lastLoginAt: string | null;
        notifyDaily: boolean;
        notifyBills: boolean;
        notifyWeeklyEmail: boolean;
      };
    }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

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
          apr?: string | null;
          metadata?: Record<string, unknown> | null;
          frozen?: boolean;
        }>;
      }>;
    }>("/plaid/items"),

  deleteItem: (id: string) =>
    request(`/plaid/items/${id}`, { method: "DELETE" }),

  syncPlaidItem: (id: string) =>
    request<{ ok: boolean }>(`/plaid/items/${id}/sync`, { method: "POST" }),

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
        institutionId: string | null;
        institutionName: string | null;
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
  syncItem: (itemId: string) =>
    request<{ ok: boolean; message: string }>(`/sync/${itemId}`, { method: "POST" }),
  syncAccount: (accountId: string) =>
    request<{ ok: boolean; itemId: string }>(`/sync/account/${accountId}`, { method: "POST" }),
  createUpdateLinkToken: (itemId: string) =>
    request<{ linkToken: string }>("/plaid/link-token/update", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    }),

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

  // Billing
  getBillingStatus: () =>
    request<{
      plan: "free" | "pro";
      subscriptionStatus: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      usage: { accounts: number; maxAccounts: number };
      models: { allowed: string[]; all: string[] };
    }>("/billing/status"),

  startCheckout: () =>
    request<{ url: string }>("/billing/checkout", { method: "POST" }),

  openBillingPortal: () =>
    request<{ url: string }>("/billing/portal", { method: "POST" }),

  // Admin (operator only — endpoints 403 for non-admin sessions)
  adminGetUsers: () =>
    request<{
      totals: { users: number; paid: number; comped: number; demo: number; free: number; connectedAccounts: number };
      users: Array<{
        userId: string;
        tenantId: string;
        email: string;
        name: string | null;
        createdAt: string;
        lastLoginAt: string | null;
        isDemo: boolean;
        isAdmin: boolean;
        effectivePlan: "free" | "pro";
        planSource: "paid" | "comped" | "demo" | "free";
        compedUntil: string | null;
        disabledAt: string | null;
        accountCount: number;
        spend30d: string;
      }>;
    }>("/admin/users"),

  adminCompTenant: (tenantId: string, days: number) =>
    request<{ ok: true; tenantId: string; compedUntil: string | null; effectivePlan: "free" | "pro" }>(
      `/admin/tenants/${tenantId}/comp`,
      { method: "POST", body: JSON.stringify({ days }) },
    ),

  adminGetSpend: (days: number) =>
    request<{
      days: number;
      totals: { llmCost: string; plaidCost: string; llmCalls: number; plaidEvents: number; inputTokens: number; outputTokens: number };
      series: Array<{ day: string; llmCost: string; plaidCost: string; events: number }>;
      bySource: Array<{ kind: "llm" | "plaid"; source: string; cost: string; events: number; inputTokens: number; outputTokens: number }>;
      byModel: Array<{ model: string | null; cost: string; calls: number; inputTokens: number; outputTokens: number }>;
      byTenant: Array<{ tenantId: string | null; tenantName: string | null; email: string | null; llmCost: string; plaidCost: string; events: number }>;
    }>(`/admin/spend?days=${days}`),

  adminGetTenantDetail: (tenantId: string) =>
    request<{
      tenant: { id: string; name: string; plan: string; planSource: "paid" | "comped" | "demo" | "free"; compedUntil: string | null; disabledAt: string | null; createdAt: string };
      isSelf: boolean;
      stripe: { customerId: string; subscriptionId: string | null; dashboardUrl: string } | null;
      authMode: "workos" | "local";
      users: Array<{ id: string; email: string; name: string | null; isAdmin: boolean; isDemo: boolean; lastLoginAt: string | null; createdAt: string; hasWorkosIdentity: boolean }>;
      plaidItems: Array<{ id: string; institutionName: string | null; status: string; lastSyncedAt: string | null }>;
      accounts: Array<{ id: string; name: string; type: string; subtype: string | null; frozen: boolean; balance: string | null }>;
      recentActivity: Array<{ kind: "llm" | "plaid"; source: string; model: string | null; costUsd: string; createdAt: string }>;
      spend30d: { llmCost: string; plaidCost: string };
    }>(`/admin/tenants/${tenantId}/detail`),

  adminDeleteTenant: (tenantId: string) =>
    request<{ ok: true; deleted: string }>(`/admin/tenants/${tenantId}`, { method: "DELETE" }),

  adminSetTenantDisabled: (tenantId: string, disabled: boolean) =>
    request<{ ok: true; tenantId: string; disabledAt: string | null }>(
      `/admin/tenants/${tenantId}/disable`,
      { method: "POST", body: JSON.stringify({ disabled }) },
    ),

  adminUpdateUser: (userId: string, patch: { name?: string | null; email?: string; isAdmin?: boolean }) =>
    request<{ ok: true; user: { id: string; email: string; name: string | null; isAdmin: boolean } }>(
      `/admin/users/${userId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  adminSendPasswordReset: (userId: string) =>
    request<{ ok: true }>(`/admin/users/${userId}/password-reset`, { method: "POST" }),

  adminRevokeSessions: (userId: string) =>
    request<{ ok: true; sessionsRevokedAt: string }>(`/admin/users/${userId}/revoke-sessions`, { method: "POST" }),

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

  snoozeInsight: (id: string, hours = 24) =>
    request<{ ok: boolean; snoozedUntil: string }>(`/insights/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ hours }),
    }),

  // Recurring transactions (LLM-detected)
  getRecurring: () =>
    request<{
      recurring: Array<{
        id: string;
        accountId: string | null;
        name: string;
        merchantName: string | null;
        amount: string;
        frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annually";
        category: string | null; // taxonomy systemKey (null for custom categories)
        nextDueDate: string | null;
        lastSeenDate: string | null;
        confidence: string | null;
        reasoning: string | null;
        isActive: boolean;
      }>;
    }>("/recurring"),

  detectRecurring: () =>
    request<{ ok: boolean; detected: number; written: number }>("/recurring/detect", {
      method: "POST",
    }),

  dismissRecurring: (id: string) =>
    request<{ ok: boolean }>(`/recurring/${id}/dismiss`, { method: "POST" }),

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
      transactions: Array<{ id: string; accountId: string; accountName: string | null; date: string; name: string; merchantName: string | null; amount: string; categoryId: string; pending: number; notes: string | null; excludedAt: string | null; createdAt: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/transactions${qs ? `?${qs}` : ''}`);
  },

  updateTransaction: (id: string, body: { category?: string; merchantName?: string; notes?: string; excluded?: boolean }) =>
    request<{ success: boolean }>(`/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updateTransactionCategory: (id: string, category: string) =>
    api.updateTransaction(id, { category }),

  getSpendingSummary: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    const qs = searchParams.toString();
    return request<{
      categories: Array<{
        id: string;
        name: string;
        systemKey: string | null;
        groupId: string;
        groupName: string;
        groupType: 'income' | 'expense' | 'transfer';
        total: number;
        count: number;
        percentage: number;
      }>;
      totalSpending: number;
      totalIncome: number;
      netCashFlow: number;
      period: { start: string; end: string };
    }>(`/transactions/spending-summary${qs ? `?${qs}` : ''}`);
  },

  getTrend: (params: { granularity: 'month' | 'year'; limit?: number }) => {
    const sp = new URLSearchParams({ granularity: params.granularity });
    if (params.limit !== undefined) sp.set('limit', String(params.limit));
    return request<{ periods: Array<{ period: string; income: number; expenses: number; net: number }> }>(
      `/transactions/monthly-trend?${sp.toString()}`,
    );
  },

  // Category rules
  getRules: () => request<{ rules: CategoryRule[] }>('/rules'),
  createRule: (body: CategoryRuleInput) => request<{ rule: CategoryRule }>('/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id: string, body: CategoryRuleInput) => request<{ rule: CategoryRule }>(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRule: (id: string) => request<{ success: boolean }>(`/rules/${id}`, { method: 'DELETE' }),
  previewRule: (id: string) => request<{ count: number }>(`/rules/${id}/preview`, { method: 'POST' }),
  applyRule: (id: string) => request<{ updated: number }>(`/rules/${id}/apply`, { method: 'POST' }),

  queryTransactions: (body: TxnQueryBody) =>
    request<TxnQueryListResponse | TxnQueryGroupsResponse>('/transactions/query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Category taxonomy (tenant-owned groups → categories)
  getCategoryTaxonomy: () => request<{ groups: TaxonomyGroup[] }>('/categories'),
  createCategory: (body: { name: string; groupId: string; emoji?: string | null }) =>
    request<{ category: { id: string } }>('/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: string, body: { name?: string; emoji?: string | null; groupId?: string; disabled?: boolean }) =>
    request<{ category: { id: string } }>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (id: string, reassignTo: string) =>
    request<{ success: boolean; moved: number }>(`/categories/${id}`, { method: 'DELETE', body: JSON.stringify({ reassignTo }) }),
  createCategoryGroup: (body: { name: string; type: 'income' | 'expense' | 'transfer' }) =>
    request<{ group: { id: string } }>('/categories/groups', { method: 'POST', body: JSON.stringify(body) }),
  updateCategoryGroup: (id: string, body: { name?: string; type?: 'income' | 'expense' | 'transfer' }) =>
    request<{ group: { id: string } }>(`/categories/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategoryGroup: (id: string) =>
    request<{ success: boolean }>(`/categories/groups/${id}`, { method: 'DELETE' }),

  // Goals
  getGoals: () =>
    request<{
      goals: Array<{
        id: string;
        name: string;
        description: string | null;
        targetAmount: string;
        currentAmount: string;
        monthlyContribution: string | null;
        deadline: string | null;
        category: string;
        status: string;
        icon: string | null;
        accountIds: string[];
        isAutoTracked: boolean;
        completedAt: string | null;
        createdAt: string;
      }>;
    }>('/goals'),

  createGoal: (data: { name: string; targetAmount: number; monthlyContribution?: number; deadline?: string; category?: string; icon?: string; description?: string; accountIds?: string[] }) =>
    request<{ goal: { id: string } }>('/goals', { method: 'POST', body: JSON.stringify(data) }),

  updateGoal: (id: string, data: { currentAmount?: number; name?: string; description?: string; targetAmount?: number; monthlyContribution?: number | null; deadline?: string; status?: string; accountIds?: string[] }) =>
    request<{ ok: boolean }>(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getGoalHistory: (id: string) =>
    request<{ history: Array<{ date: string; value: number }> }>(`/goals/${id}/history`),

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

  // Account settings — classification + per-account overrides (Plaid or manual)
  updateAccount: (
    id: string,
    data: {
      type?: string;
      subtype?: string | null;
      excludeFromNetWorth?: boolean;
      excludeTransactions?: boolean;
      invertBalance?: boolean;
    },
  ) => request<{ ok: boolean }>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Quick Import
  quickImportParse: (text: string) =>
    request<{
      parseResult: QuickImportParseResult;
      currentProfile: QuickImportCurrentProfile | null;
    }>('/quick-import/parse', { method: 'POST', body: JSON.stringify({ text }) }),

  quickImportCommit: (payload: QuickImportParseResult) =>
    request<{
      ok: boolean;
      created: { accounts: { id: string; name: string }[]; goals: { id: string; name: string }[] };
      profileUpdated: boolean;
    }>('/quick-import/commit', { method: 'POST', body: JSON.stringify(payload) }),
};

// ─── Quick Import types ────────────────────────────────────────────────────

export type QuickImportFilingStatus =
  | 'single'
  | 'married_joint'
  | 'married_separate'
  | 'head_of_household';

export type QuickImportEmploymentType =
  | 'w2'
  | 'self_employed'
  | '1099'
  | 'business_owner';

export type QuickImportRiskTolerance =
  | 'conservative'
  | 'moderate_conservative'
  | 'moderate'
  | 'moderate_aggressive'
  | 'aggressive';

export type QuickImportAccountType =
  | 'depository'
  | 'investment'
  | 'credit'
  | 'loan'
  | 'real_estate'
  | 'alternative';

export interface QuickImportProfile {
  name?: string | null;
  dateOfBirth?: string | null;
  annualIncome?: number | null;
  filingStatus?: QuickImportFilingStatus | null;
  stateOfResidence?: string | null;
  employmentType?: QuickImportEmploymentType | null;
  riskTolerance?: QuickImportRiskTolerance | null;
  retirementAge?: number | null;
  employerMatch?: number | null;
  dependentCount?: number | null;
  hasHDHP?: boolean | null;
  isPSLFEligible?: boolean | null;
}

export interface QuickImportAccount {
  name: string;
  type: QuickImportAccountType;
  subtype: string | null;
  balance: number | null;
  apr?: number | null;
  apy?: number | null;
  metadata?: Record<string, unknown> | null;
  sourcePhrase: string;
}

export interface QuickImportGoal {
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string | null;
  category: string;
  sourcePhrase: string;
}

export interface QuickImportParseResult {
  profile: QuickImportProfile | null;
  accounts: QuickImportAccount[];
  goals: QuickImportGoal[];
  unparsed: string[];
}

export interface QuickImportCurrentProfile {
  name: string | null;
  dateOfBirth: string | null;
  annualIncome: number | null;
  filingStatus: string | null;
  stateOfResidence: string | null;
  employmentType: string | null;
  riskTolerance: string | null;
  retirementAge: number | null;
  employerMatch: number | null;
  dependentCount: number | null;
  hasHDHP: boolean | null;
  isPSLFEligible: boolean | null;
}

// ─── Transactions query types ─────────────────────────────────────────────

export interface TxnQueryBody {
  filters?: {
    search?: string; categories?: string[]; accountIds?: string[];
    startDate?: string; endDate?: string;
    amountMin?: number; amountMax?: number; merchant?: string;
  };
  groupBy?: 'date' | 'category' | 'group' | 'merchant';
  sort?: { field: 'date' | 'amount'; dir: 'asc' | 'desc' };
  cursor?: string;
  limit?: number;
}
export interface TxnQueryRow {
  id: string; accountId: string; accountName: string | null; date: string;
  name: string; merchantName: string | null; amount: string; categoryId: string;
  pending: number; notes: string | null;
  excludedAt: string | null;
}
export interface TxnQuerySummary { count: number; totalSpent: number; totalIncome: number }
export interface TxnQueryListResponse { mode: 'list'; transactions: TxnQueryRow[]; nextCursor: string | null; summary: TxnQuerySummary }
export interface TxnQueryGroupsResponse { mode: 'groups'; groups: Array<{ key: string; label: string; count: number; total: number }>; summary: TxnQuerySummary }

// ─── Category rule types ───────────────────────────────────────────────────

export interface CategoryRuleInput {
  merchantContains?: string | null;
  amountEquals?: string | null;
  amountMin?: string | null;
  amountMax?: string | null;
  accountId?: string | null;
  matchCategory?: string | null;
  setCategory: string;
}

export interface CategoryRule {
  id: string;
  priority: number;
  merchantContains: string | null;
  amountEquals: string | null;
  amountMin: string | null;
  amountMax: string | null;
  accountId: string | null;
  matchCategoryId: string | null;
  setCategoryId: string;
  createdAt: string;
}

// ─── Category taxonomy types ───────────────────────────────────────────────

export interface TaxonomyCategory {
  id: string;
  name: string;
  systemKey: string | null;
  emoji: string | null;
  disabled: boolean;
  locked: boolean;
  sortOrder: number;
}

export interface TaxonomyGroup {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  systemKey: string | null;
  sortOrder: number;
  categories: TaxonomyCategory[];
}
