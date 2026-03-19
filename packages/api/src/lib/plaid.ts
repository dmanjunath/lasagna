import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { env } from "./env.js";

const config = new Configuration({
  basePath:
    PlaidEnvironments[env.PLAID_ENV] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
      "PLAID-SECRET": env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(config);
