function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  get DATABASE_URL() {
    return optional("DATABASE_URL", "");
  },
  get OPENROUTER_API_KEY() {
    // Optional - AI features disabled if not set
    return optional("OPENROUTER_API_KEY", "");
  },
  // Enable OpenRouter's server-side web search on the chat agent. On by default;
  // set to "false" to turn off (it adds per-request search cost and latency).
  get WEB_SEARCH_ENABLED() {
    return optional("WEB_SEARCH_ENABLED", "true") === "true";
  },
  get WEB_SEARCH_MAX_RESULTS() {
    return parseInt(optional("WEB_SEARCH_MAX_RESULTS", "3"), 10);
  },
  get ENCRYPTION_KEY() {
    return required("ENCRYPTION_KEY");
  },
  get PLAID_CLIENT_ID() {
    return required("PLAID_CLIENT_ID");
  },
  get PLAID_SECRET() {
    return required("PLAID_SECRET");
  },
  get PLAID_ENV() {
    return optional("PLAID_ENV", "sandbox") as "sandbox" | "development" | "production";
  },
  get PORT() {
    return parseInt(optional("PORT", "3000"), 10);
  },
  get MULTI_TENANT() {
    return optional("MULTI_TENANT", "true") === "true";
  },
  get APP_ENV() {
    return optional("APP_ENV", process.env.NODE_ENV || "dev");
  },
  get STRIPE_SECRET_KEY() {
    return optional("STRIPE_SECRET_KEY", "");
  },
  get STRIPE_WEBHOOK_SECRET() {
    return optional("STRIPE_WEBHOOK_SECRET", "");
  },
  get STRIPE_PRICE_PRO_MONTHLY() {
    return optional("STRIPE_PRICE_PRO_MONTHLY", "");
  },
  // Web app origin — used for Stripe Checkout/Portal success & return URLs.
  get APP_URL() {
    return optional("APP_URL", "http://localhost:5173");
  },
  get WORKOS_API_KEY() {
    return optional("WORKOS_API_KEY", "");
  },
  get WORKOS_CLIENT_ID() {
    return optional("WORKOS_CLIENT_ID", "");
  },
  // Where WorkOS sends the browser back after Google OAuth. Must be registered in WorkOS.
  get WORKOS_REDIRECT_URI() {
    return optional("WORKOS_REDIRECT_URI", `${this.APP_URL}/api/auth/google/callback`);
  },
};
