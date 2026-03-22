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
    return required("DATABASE_URL");
  },
  get OPENROUTER_API_KEY() {
    // Optional - AI features disabled if not set
    return optional("OPENROUTER_API_KEY", "");
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
  get BETTER_AUTH_SECRET() {
    return required("BETTER_AUTH_SECRET");
  },
  get BETTER_AUTH_URL() {
    return optional("BETTER_AUTH_URL", "http://localhost:3000");
  },
  get PORT() {
    return parseInt(optional("PORT", "3000"), 10);
  },
  get MULTI_TENANT() {
    return optional("MULTI_TENANT", "false") === "true";
  },
};
