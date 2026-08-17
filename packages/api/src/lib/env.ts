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
  // sailresearch.com inference (OpenAI-compatible). When set, inference routes
  // through sail instead of OpenRouter. Optional — falls back to OpenRouter.
  get SAIL_RESEARCH_API_KEY() {
    return optional("SAIL_RESEARCH_API_KEY", "");
  },
  // Which inference provider to use by default: "openrouter" (default) or "sail".
  // OpenRouter is the default even when a sail key is present — sail is used only
  // when explicitly selected here, or per-request by an admin's model override.
  get INFERENCE_PROVIDER() {
    return optional("INFERENCE_PROVIDER", "openrouter") as "openrouter" | "sail";
  },
  // Which backend runs tax document vision extraction: "vertex" (default, keeps
  // the document inside our GCP project) or "openai-compatible" (sends it to a
  // third party — see lib/vision/openai-compatible.ts).
  get VISION_PROVIDER() {
    return optional("VISION_PROVIDER", "vertex");
  },
  // Only for VISION_PROVIDER=openai-compatible. The default (vertex) needs no
  // configuration at all: credentials and project both come from ADC.
  get VISION_API_URL() {
    return optional("VISION_API_URL", "");
  },
  get VISION_API_KEY() {
    return optional("VISION_API_KEY", "");
  },
  get VISION_MODEL() {
    return optional("VISION_MODEL", "");
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
  // Public HTTPS URL Plaid POSTs item updates to, e.g.
  // https://api.example.com/api/plaid/webhook. Empty in local dev (Plaid can't
  // reach localhost), which simply means no webhook is registered and the cron
  // remains the only sync trigger.
  get PLAID_WEBHOOK_URL() {
    return optional("PLAID_WEBHOOK_URL", "");
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
  // Cloudflare Email Service (transactional send). All three must be set for
  // invite emails to go out; otherwise the invite flow logs the accept link.
  get CLOUDFLARE_EMAIL_TOKEN() {
    return optional("CLOUDFLARE_EMAIL_TOKEN", "");
  },
  get CLOUDFLARE_EMAIL_ACCOUNT_ID() {
    return optional("CLOUDFLARE_EMAIL_ACCOUNT_ID", "");
  },
  // A verified sender on the domain onboarded for Cloudflare Email Sending.
  get CLOUDFLARE_EMAIL_FROM() {
    return optional("CLOUDFLARE_EMAIL_FROM", "");
  },
};
