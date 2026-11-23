import { post, request } from "./client";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  onboardingStage: string | null;
  onboardingDeferred?: boolean;
  isAdmin: boolean;
  isDemo?: boolean;
  hasAcceptedTerms: boolean;
  hasPassword?: boolean;
  lastLoginAt?: string | null;
}
export interface Tenant {
  id: string;
  name: string;
  plan: string;
}
export type Session = { user: User; tenant: Tenant | null; token?: string };
export type NeedsVerification = { needsVerification: true; email: string };
export type Consents = { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean };

export type InviteStatus = "ok" | "expired" | "used" | "revoked" | "not_found";

export interface BillingStatus {
  plan: "free" | "pro";
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: { institutions: number; maxInstitutions: number };
}

// Mirrors the auth calls in packages/web/src/lib/api.ts.
export const authApi = {
  me: () => request<{ user: User; tenant: Tenant | null }>("/auth/me"),
  loginStart: (email: string) => post<{ step: "password" | "code" | "signup" }>("/auth/login/start", { email }),
  login: (email: string, password: string) => post<Session | NeedsVerification>("/auth/login", { email, password }),
  loginSendCode: (email: string) => post<unknown>("/auth/login/send-code", { email }),
  loginCode: (email: string, code: string) => post<Session>("/auth/login/code", { email, code }),
  logout: () => post<unknown>("/auth/logout"),
  signupOptions: () => request<{ passwordRequired: boolean }>("/auth/signup/options"),
  signup: (body: { email: string; password: string; name?: string } & Consents) => post<Session | NeedsVerification>("/auth/signup", body),
  verifyEmail: (body: { email: string; code: string; setPassword: boolean } & Consents) => post<Session>("/auth/verify-email", body),
  forgotPassword: (email: string) => post<{ ok: true }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, newPassword: string) => post<{ ok: true }>("/auth/reset-password", { token, newPassword }),
  acceptTerms: () => post<{ ok: true }>("/auth/accept-terms"),
  onboardingDeferred: (deferred: boolean) =>
    request<{ onboardingDeferred: boolean }>("/auth/onboarding-deferred", { method: "PATCH", body: JSON.stringify({ deferred }) }),
  validateInvite: (token: string) =>
    request<{ status: InviteStatus; householdName?: string | null; inviterName?: string | null }>(`/household/invite/${encodeURIComponent(token)}`),
};

// The WebAuthn challenge travels in a cookie the API sets on the options call
// and reads on the verify call, so these requests carry cookies.
const withCookies = { credentials: "include" as const };

export const webauthnApi = {
  loginOptions: () => request<Record<string, unknown>>("/auth/webauthn/login/options", { method: "POST", ...withCookies }),
  loginVerify: (response: unknown) =>
    request<Session>("/auth/webauthn/login/verify", { method: "POST", body: JSON.stringify({ response }), ...withCookies }),
  registerOptions: () => request<Record<string, unknown>>("/auth/webauthn/register/options", { method: "POST", ...withCookies }),
  registerVerify: (response: unknown, deviceName?: string) =>
    request<{ ok: true }>("/auth/webauthn/register/verify", { method: "POST", body: JSON.stringify({ response, deviceName }), ...withCookies }),
};

export const billingApi = {
  status: () => request<BillingStatus>("/billing/status"),
  checkout: () => post<{ url: string }>("/billing/checkout", { native: true }),
  /** The Stripe billing portal, opened in the browser sheet as the Capacitor app did. */
  portal: () => post<{ url: string }>("/billing/portal", { native: true }),
};
