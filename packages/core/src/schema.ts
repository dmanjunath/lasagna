import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  pgEnum,
  integer,
  jsonb,
  boolean,
  unique,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { GoalDetails } from "./goal-target.js";

// ── Enums ──────────────────────────────────────────────────────────────────

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const roleEnum = pgEnum("role", ["owner", "member", "viewer"]);
export const accountTypeEnum = pgEnum("account_type", [
  "depository",
  "investment",
  "credit",
  "loan",
  "real_estate",
  "alternative",
]);
export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "error",
]);

export const planTypeEnum = pgEnum("plan_type", [
  "net_worth",
  "retirement",
  "debt_payoff",
  "custom",
]);

export const planStatusEnum = pgEnum("plan_status", [
  "draft",
  "active",
  "archived",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const editedByEnum = pgEnum("edited_by", ["user", "agent"]);

export const simulationTypeEnum = pgEnum("simulation_type", [
  "monte_carlo",
  "backtest",
  "scenario",
]);

export const onboardingStageEnum = pgEnum("onboarding_stage", [
  "profile",
  "income",
  "lifestyle",
  "accounts",
  "complete",
]);

// ── Tenants ────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status", { length: 50 }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // True when the subscription is set to cancel at period end — still active
  // (Pro) until currentPeriodEnd, then Stripe fires subscription.deleted.
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // Complimentary Pro (no payment) until this instant. Null or past = no comp.
  // Overlays plan resolution only — `plan` stays Stripe-authoritative.
  compedUntil: timestamp("comped_until", { withTimezone: true }),
  // Admin pause: while set, account sync and insights generation are skipped.
  // Login and read access still work. Null = active.
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  // Last time this tenant's post-sync AI classification of unknown securities
  // ran. Throttles the batch to at most once per 24h. Null = never run.
  lastSecurityClassifyAt: timestamp("last_security_classify_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  // Nullable: WorkOS/Google users have no local hash. Local-mode users still set it.
  passwordHash: text("password_hash"),
  // Set when this row is linked to a WorkOS user (workos mode). Null for local-mode users.
  workosUserId: text("workos_user_id").unique(),
  // When the user accepted ToS/Privacy/RIA. Null ⇒ client routes them to /welcome/consent.
  acceptedTermsAt: timestamp("accepted_terms_at", { withTimezone: true }),
  role: roleEnum("role").notNull().default("owner"),
  isDemo: boolean("is_demo").default(false).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // True once a password credential exists (WorkOS or local). Drives the two-step
  // login Step-1 branch (password vs emailed code). Migration backfills existing
  // rows to true so current password users keep the password screen.
  hasPassword: boolean("has_password").notNull().default(false),
  // "Sign out everywhere": requireAuth rejects tokens issued before this.
  sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
  onboardingStage: onboardingStageEnum("onboarding_stage"),
  notifyDaily: boolean("notify_daily").notNull().default(true),
  notifyBills: boolean("notify_bills").notNull().default(true),
  notifyWeeklyEmail: boolean("notify_weekly_email").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Financial Profiles ────────────────────────────────────────────────────

export const filingStatusEnum = pgEnum("filing_status", [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
]);

export const riskToleranceEnum = pgEnum("risk_tolerance", [
  "conservative",
  "moderate_conservative",
  "moderate",
  "moderate_aggressive",
  "aggressive",
]);

// WebAuthn/passkey credentials (Face ID / Touch ID sign-in). One row per
// registered authenticator; id is the base64url credential ID.
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  deviceName: varchar("device_name", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const financialProfiles = pgTable("financial_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" })
    .unique(),
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
  annualIncome: numeric("annual_income", { precision: 19, scale: 2 }),
  filingStatus: filingStatusEnum("filing_status"),
  stateOfResidence: varchar("state_of_residence", { length: 2 }),
  employmentType: varchar("employment_type", { length: 50 }),
  riskTolerance: riskToleranceEnum("risk_tolerance"),
  retirementAge: integer("retirement_age"),
  employerMatch: numeric("employer_match_percent", { precision: 5, scale: 2 }),
  skippedPrioritySteps: text("skipped_priority_steps").array().default([]),
  completedPrioritySteps: jsonb("completed_priority_steps").$type<Array<{id: string; note: string; completedAt: string}>>().default([]),
  hasHDHP: boolean("has_hdhp"),
  dependentCount: integer("dependent_count"),   // null = unknown; 0 = none; 1+ = has dependents
  isPSLFEligible: boolean("is_pslf_eligible"),
  lastActionsGeneratedAt: timestamp("last_actions_generated_at", { withTimezone: true }),
  // Plain-language description of what this household's tax documents show.
  // Regenerated only when the fingerprint (the documents plus the profile
  // fields the summary reads) changes, so a page view costs nothing.
  taxSummary: text("tax_summary"),
  taxSummaryFingerprint: varchar("tax_summary_fingerprint", { length: 64 }),
  taxSummaryGeneratedAt: timestamp("tax_summary_generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Personal (per-user) profile fields — the "you vs your partner" split.
// Household-level fields (filingStatus, stateOfResidence, dependentCount,
// and the priorities bookkeeping) stay on financialProfiles (tenant-scoped).
export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
  annualIncome: numeric("annual_income", { precision: 19, scale: 2 }),
  employmentType: varchar("employment_type", { length: 50 }),
  riskTolerance: riskToleranceEnum("risk_tolerance"),
  retirementAge: integer("retirement_age"),
  employerMatch: numeric("employer_match_percent", { precision: 5, scale: 2 }),
  hasHDHP: boolean("has_hdhp"),
  isPSLFEligible: boolean("is_pslf_eligible"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull().defaultNow().$onUpdate(() => new Date()),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: roleEnum("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // At most one PENDING invite per (tenant, email). Expiry is enforced in app
  // logic — a partial-unique index predicate cannot reference now().
  uniqueIndex("invites_pending_tenant_email_idx")
    .on(t.tenantId, t.email)
    .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
]);

// ── Plaid Items ────────────────────────────────────────────────────────────

export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(), // encrypted at rest
  // Plaid's own item_id. Webhooks are keyed by it, so it's the only way to map
  // an inbound webhook back to a row. Null for manual items and for links made
  // before this column existed (backfilled via /item/get).
  plaidItemId: varchar("plaid_item_id", { length: 255 }).unique(),
  institutionId: varchar("institution_id", { length: 255 }),
  institutionName: varchar("institution_name", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  transactionCursor: text("transaction_cursor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Accounts ───────────────────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  plaidItemId: uuid("plaid_item_id")
    .notNull()
    .references(() => plaidItems.id, { onDelete: "cascade" }),
  plaidAccountId: varchar("plaid_account_id", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: accountTypeEnum("type").notNull(),
  subtype: varchar("subtype", { length: 100 }),
  mask: varchar("mask", { length: 10 }),
  apr: numeric("apr", { precision: 6, scale: 4 }), // annual % rate on debts (credit/loan)
  apy: numeric("apy", { precision: 6, scale: 4 }), // annual % yield on deposits (savings)
  metadata: text("metadata"), // JSON string for loan details, property info, etc.
  // User overrides — when an account's contribution to totals should differ
  // from its raw synced balance. Honored everywhere balances are aggregated
  // (net worth, debts, chat tools, insights, priorities, portfolio).
  excludeFromNetWorth: boolean("exclude_from_net_worth").notNull().default(false),
  excludeTransactions: boolean("exclude_transactions").notNull().default(false),
  invertBalance: boolean("invert_balance").notNull().default(false), // flip the sign of the balance at point of use
  // Over the tenant's plan account limit → read-only: not synced, shown locked.
  frozen: boolean("frozen").notNull().default(false),
  // Credit cards only: the user designates the card as paid in full every month.
  // A fallback for banks that do not report statement/payment data — it makes the
  // card a transactor (off the payoff plan) regardless of what sync knows.
  paidInFullMonthly: boolean("paid_in_full_monthly").notNull().default(false),
  // Debt accounts only: the real_estate account this debt is secured by
  // (e.g. mortgage → home). N debts may point at one property. Enforced
  // debt→property at the API layer; DB clears the link if the property goes.
  propertyAccountId: uuid("property_account_id").references((): AnyPgColumn => accounts.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [index("accounts_property_account_idx").on(t.propertyAccountId)]);

// ── Balance Snapshots ──────────────────────────────────────────────────────

export const balanceSnapshots = pgTable("balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  balance: numeric("balance", { precision: 19, scale: 4 }),
  available: numeric("available", { precision: 19, scale: 4 }),
  limit: numeric("limit", { precision: 19, scale: 4 }),
  isoCurrencyCode: varchar("iso_currency_code", { length: 3 }),
  // Where this snapshot came from — e.g. "plaid" (provider sync) or a valuation
  // source for manual/real-estate accounts. Nullable so legacy rows stay valid.
  source: varchar("source", { length: 40 }),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Securities ─────────────────────────────────────────────────────────────

export const securities = pgTable("securities", {
  id: uuid("id").primaryKey().defaultRandom(),
  plaidSecurityId: varchar("plaid_security_id", { length: 255 })
    .notNull()
    .unique(),
  name: varchar("name", { length: 255 }),
  tickerSymbol: varchar("ticker_symbol", { length: 20 }),
  type: varchar("type", { length: 100 }),
  closePrice: numeric("close_price", { precision: 19, scale: 4 }),
  closePriceAsOf: timestamp("close_price_as_of", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Security Classifications ─────────────────────────────────────────────────
//
// Global (not tenant-scoped) cache of AI-derived asset-class classifications for
// securities that the hardcoded ticker map can't place. Securities are shared
// across all users, so we look each unknown symbol up ONCE and every account
// holding it reuses the result. `failed` rows are negative caches — the model
// couldn't confidently classify the symbol — so we don't hammer it every sync.
export const securityClassifications = pgTable("security_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Uppercased ticker/symbol — the shared key. Unique so one row per symbol.
  symbol: varchar("symbol", { length: 40 }).notNull().unique(),
  // Resolved asset class from the app's taxonomy (US Stocks, International
  // Stocks, Bonds, REITs, Cash, Other). Null on a failed/negative cache.
  assetClass: varchar("asset_class", { length: 40 }),
  // Free-form sub-category label (e.g. "Individual Stocks"). Null when failed.
  category: varchar("category", { length: 80 }),
  // True when classification failed or was too low-confidence to trust — stored
  // so we skip re-querying until the throttle window lets us refresh.
  failed: boolean("failed").notNull().default(false),
  classifiedAt: timestamp("classified_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Holdings ───────────────────────────────────────────────────────────────

// Current state, not history: exactly one row per position. Sync upserts on
// (account_id, security_id) and the unique constraint enforces it. Value over
// time comes from `balanceSnapshots`, so per-holding history is not needed.
export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 19, scale: 6 }),
    institutionPrice: numeric("institution_price", { precision: 19, scale: 4 }),
    institutionValue: numeric("institution_value", { precision: 19, scale: 4 }),
    costBasis: numeric("cost_basis", { precision: 19, scale: 4 }),
    // Last time sync refreshed this position.
    snapshotAt: timestamp("snapshot_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.accountId, t.securityId)],
);

// ── Sync Log ───────────────────────────────────────────────────────────────

export const syncLog = pgTable("sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  plaidItemId: uuid("plaid_item_id")
    .notNull()
    .references(() => plaidItems.id, { onDelete: "cascade" }),
  status: syncStatusEnum("status").notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ── Plans ─────────────────────────────────────────────────────────────────

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  type: planTypeEnum("type").notNull(),
  title: text("title").notNull(),
  inputs: text("inputs"), // JSON string
  content: text("content"), // JSON string (UIPayload)
  status: planStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Plan Edits ────────────────────────────────────────────────────────────

export const planEdits = pgTable("plan_edits", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  editedBy: editedByEnum("edited_by").notNull(),
  previousContent: text("previous_content").notNull(), // JSON string
  changeDescription: text("change_description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Chat Threads ──────────────────────────────────────────────────────────

export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
  // Links a thread to a Financial Plan document (the new financial_plans table).
  // Kept distinct from planId, which FKs the legacy `plans` table.
  financialPlanId: uuid("financial_plan_id").references(() => financialPlans.id, {
    onDelete: "cascade",
  }),
  title: text("title"),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Messages ──────────────────────────────────────────────────────────────

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => chatThreads.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON string
  uiPayload: text("ui_payload"), // JSON string
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Simulation Results ───────────────────────────────────────────────────

export const simulationResults = pgTable("simulation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  type: simulationTypeEnum("type").notNull(),
  paramsHash: varchar("params_hash", { length: 64 }).notNull(),
  params: text("params").notNull(),
  results: text("results").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ── Insights ──────────────────────────────────────────────────────────────

export const insightCategoryEnum = pgEnum("insight_category", [
  "portfolio",
  "debt",
  "tax",
  "savings",
  "general",
]);

export const insightUrgencyEnum = pgEnum("insight_urgency", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  category: insightCategoryEnum("category").notNull(),
  urgency: insightUrgencyEnum("urgency").notNull().default("medium"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  impact: text("impact"), // e.g. "Saves $340/yr" or "+$2,080 free money"
  impactColor: varchar("impact_color", { length: 10 }), // green, amber, red
  chatPrompt: text("chat_prompt"), // message to send to AI for deeper discussion
  dismissed: timestamp("dismissed_at", { withTimezone: true }),
  actedOn: timestamp("acted_on_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  generatedBy: varchar("generated_by", { length: 50 }).notNull().default("system"), // system, ai, manual
  insightType: text("type"), // page routing: spending|behavioral|debt|tax|portfolio|savings|retirement|general
  // The step of this person's path that this action serves, named by the path's
  // own candidate key (`debt:<id>`, `goal:<id>`, `emergency-fund`, ...). Null
  // when the action serves no step, which is a real answer and not a failure:
  // a fraud alert or a tax-document nudge belongs on the list whether or not
  // the path has a rung for it.
  //
  // A KEY, not a `financial_path_steps.id`, and that is the load-bearing part.
  // Regenerating a path supersedes its step rows and inserts a fresh set, so a
  // row id would point at a step that is no longer on the path the moment the
  // order is chosen again, and every action would fall out of its group on
  // every rebuild. The key is what the path itself is stable on: it is what
  // carries a person's tick and note onto the next path, what `applyStoredOrder`
  // re-anchors on, and what `markPathStep` addresses. An action attached by key
  // survives a regeneration for exactly the reason a tick does.
  //
  // Nothing enforces it as a foreign key, and nothing needs to. Resolution
  // happens on read against the ACTIVE path: a key with no step behind it (the
  // account closed, the goal deleted, the step taken off the path) resolves to
  // no step, which is what an `on delete set null` would have produced, and the
  // action is still shown, after every action that has one.
  pathStepKey: varchar("path_step_key", { length: 100 }),
  sourceData: text("source_data"), // JSON snapshot of data that triggered this insight
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Category taxonomy (groups → categories) ────────────────────────────────
// Tenant-owned. System rows carry a systemKey (fixed, unique per tenant);
// custom rows have systemKey NULL. The old transaction_category enum column
// stays dual-written as a safety net until the phase-4 cleanup drop.

export const categoryGroupTypeEnum = pgEnum("category_group_type", [
  "income",
  "expense",
  "transfer",
]);

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    type: categoryGroupTypeEnum("type").notNull(),
    systemKey: varchar("system_key", { length: 40 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tenantId, t.systemKey)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    systemKey: varchar("system_key", { length: 40 }),
    emoji: varchar("emoji", { length: 8 }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tenantId, t.systemKey)],
);

// ── Transactions ─────────────────────────────────────────────────────────

export const transactionSourceEnum = pgEnum("transaction_source", ["seed", "plaid"]);

export const categorySourceEnum = pgEnum("category_source", ["auto", "rule", "transfer", "manual"]);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plaidTransactionId: varchar("plaid_transaction_id", { length: 255 }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    merchantName: varchar("merchant_name", { length: 255 }),
    amount: numeric("amount", { precision: 19, scale: 2 }).notNull(), // positive = expense, negative = income
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    plaidCategoryPrimary: varchar("plaid_category_primary", { length: 64 }),
    plaidCategoryDetailed: varchar("plaid_category_detailed", { length: 96 }),
    pending: integer("pending").notNull().default(0), // 0 = false, 1 = true
    source: transactionSourceEnum("source").notNull().default("seed"),
    categorySource: categorySourceEnum("category_source").notNull().default("auto"),
    linkedTransactionId: uuid("linked_transaction_id"),
    notes: text("notes"),
    merchantEditedAt: timestamp("merchant_edited_at", { withTimezone: true }),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_tenant_category_idx").on(t.tenantId, t.categoryId),
    index("transactions_tenant_date_idx").on(t.tenantId, t.date),
  ],
);

// ── Category Rules ────────────────────────────────────────────────────────
// User-defined re-categorization rules. First match (by priority asc) wins.
// All non-null criteria are AND-ed; amounts compare against abs(amount).

export const categoryRules = pgTable("category_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull(),
  merchantContains: varchar("merchant_contains", { length: 255 }),
  amountEquals: numeric("amount_equals", { precision: 19, scale: 2 }),
  amountMin: numeric("amount_min", { precision: 19, scale: 2 }),
  amountMax: numeric("amount_max", { precision: 19, scale: 2 }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  matchCategoryId: uuid("match_category_id").references(() => categories.id),
  setCategoryId: uuid("set_category_id").notNull().references(() => categories.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Recurring Transactions ───────────────────────────────────────────────
// LLM-detected: a periodic job reads transaction history and writes rows here.
// We never compute recurrence with rules; the LLM is the source of truth and
// downstream UI (bill reminders, "rent due in 3 days") reads from this table.

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
]);

export const recurringTransactions = pgTable("recurring_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  merchantName: varchar("merchant_name", { length: 255 }),
  amount: numeric("amount", { precision: 19, scale: 2 }).notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  nextDueDate: timestamp("next_due_date", { withTimezone: true }),
  lastSeenDate: timestamp("last_seen_date", { withTimezone: true }),
  confidence: numeric("confidence", { precision: 3, scale: 2 }), // 0.00-1.00 LLM confidence
  reasoning: text("reasoning"), // why the LLM thinks this is recurring
  isActive: boolean("is_active").notNull().default(true),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Goals ─────────────────────────────────────────────────────────────────

export const goalStatusEnum = pgEnum("goal_status", ["active", "completed", "paused"]);

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  targetAmount: numeric("target_amount", { precision: 19, scale: 2 }).notNull(),
  currentAmount: numeric("current_amount", { precision: 19, scale: 2 }).notNull().default("0"),
  // Optional plan: how much the user intends to put toward this goal monthly.
  monthlyContribution: numeric("monthly_contribution", { precision: 19, scale: 2 }),
  deadline: timestamp("deadline", { withTimezone: true }),
  category: varchar("category", { length: 50 }).notNull().default("savings"),
  // What the user is actually saving for, for the categories that can be
  // described (a house at a price, N months of expenses). `target_amount` is
  // always written from this via resolveGoalTarget, so every reader of
  // target_amount keeps working without knowing details exist. Null for goals
  // that carry a plain hand-entered target.
  details: jsonb("details").$type<GoalDetails>(),
  status: goalStatusEnum("goal_status").notNull().default("active"),
  icon: varchar("icon", { length: 32 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const goalAccounts = pgTable(
  "goal_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqGoalAccount: unique().on(t.goalId, t.accountId),
  }),
);

// Progress history for manually-tracked goals — one row per manual amount
// change. Auto-tracked goals don't need rows here: their history is derived
// from the linked accounts' balance_snapshots.
export const goalSnapshots = pgTable("goal_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  value: numeric("value", { precision: 19, scale: 2 }).notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Tax Documents ─────────────────────────────────────────────────────────
export const taxDocuments = pgTable("tax_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  gcsPath: text("gcs_path").notNull(),
  rawExtraction: jsonb("raw_extraction").notNull(),
  llmFields: jsonb("llm_fields").notNull(),
  llmSummary: text("llm_summary").notNull(),
  taxYear: integer("tax_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Activity events (operator metering) ─────────────────────────────────────
// One row per billable activity: an LLM call (tokens + estimated $) or a Plaid
// API event (per-event estimated $). Written fire-and-forget by the API;
// aggregated over time by the admin spend dashboard. tenant_id is SET NULL on
// tenant deletion so spend history survives account removal.

export const activityEventKindEnum = pgEnum("activity_event_kind", ["llm", "plaid"]);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    kind: activityEventKindEnum("kind").notNull(),
    // What produced the event: chat | chat-title | insights | recurring |
    // tax-vision (llm) · sync | link (plaid).
    source: varchar("source", { length: 40 }).notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_events_kind_created_idx").on(t.kind, t.createdAt),
    index("activity_events_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

// ── Financial Plans ─────────────────────────────────────────────────────────
// Advisor-grade "Financial Plans" documents — a distinct, personal (per-user)
// entity from the lightweight `plans` chat-plan concept above. `document` holds
// the structured multi-section payload as a JSON string (Financial Snapshot
// only for now). Reuses planStatusEnum (draft/active/archived).
export const financialPlans = pgTable("financial_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  document: text("document"), // JSON string (structured multi-section payload)
  assumptions: text("assumptions"), // JSON string (PlanAssumptions: scalar overrides applied to the plan)
  status: planStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Financial path ──────────────────────────────────────────────────────────
// One generated path per tenant, with its steps in the order they were placed.
//
// The path is stored rather than recomputed because its ORDER is a judgement,
// not a formula: a model picks it from the validated candidate set. Asking the
// model twice would otherwise reshuffle a plan the user is standing in the
// middle of. Only the newest row is `active`; earlier ones are kept as
// `superseded` so a reshuffle is a visible event rather than a silent edit.

/** Which of the two orderings produced the stored path. */
export const financialPathSourceEnum = pgEnum("financial_path_source", [
  "model",
  "deterministic",
]);

export const financialPathStatusEnum = pgEnum("financial_path_status", [
  "active",
  "superseded",
]);

/**
 * Where a step of the path stands.
 *
 * The first three are the person's own word on it. `pending` is every step
 * nobody has touched. `done` is a manual tick, which only decides the status of
 * a step no figure measures. `not_applicable` takes the step off the path: it
 * is not counted, not numbered and not shown among the steps, because a step
 * struck through forever is still a step you read.
 *
 * `left_out` is the ONE that is not theirs. It is a step that applies to this
 * household but that the model judged does not belong in their sequence, and it
 * is stored rather than dropped so the page can name it, say why it was left
 * out, and offer it back. Putting it back writes `pending` over it, which is
 * how a person overrules the model and why that overrule survives the next
 * generation: the row then carries a mark of their own.
 */
export const financialPathStepStatusEnum = pgEnum("financial_path_step_status", [
  "pending",
  "done",
  "not_applicable",
  "left_out",
]);

export const financialPaths = pgTable(
  "financial_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    // What caused this generation, e.g. "no_active_path".
    reason: varchar("reason", { length: 40 }).notNull(),
    // Digest of the figures the sizing pass ran on, so a later slice can tell a
    // stale path from a current one without re-reading the whole household.
    inputsFingerprint: varchar("inputs_fingerprint", { length: 64 }).notNull(),
    // The model that chose the order. Null when the deterministic order did.
    model: text("model"),
    orderSource: financialPathSourceEnum("order_source").notNull(),
    status: financialPathStatusEnum("status").notNull().default("active"),
    // Why this path is due to be replaced, parked here by whatever knew: a goal
    // route that changed the set, or a step being ticked. The read that next
    // regenerates spends it, so the page can say what changed rather than only
    // that something did. Null whenever nothing is owed.
    pendingReason: varchar("pending_reason", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("financial_paths_tenant_status_idx").on(t.tenantId, t.status),
    // At most one active path per tenant, enforced by the database rather than
    // by a read-then-write. Two requests landing together (the path page and
    // the dashboard both read this) would otherwise each generate one, and the
    // tenant would have two active orders and have paid for two model calls.
    uniqueIndex("financial_paths_one_active_per_tenant")
      .on(t.tenantId)
      .where(sql`"status" = 'active'`),
  ],
);

// The steps of one path, in order.
//
// The order is the whole of what is COMPUTED that gets stored. Titles, targets,
// balances, monthly figures and dates are all recomputed on every read against
// the household as it stands that day, because a balance moves and a finished
// step can reopen, so storing them would only freeze the page against the
// accounts behind it. What a step stores is therefore the candidate it names,
// the one line the model wrote about where it sits, and what the PERSON said
// about it, which nothing in the household can be read back from.
export const financialPathSteps = pgTable(
  "financial_path_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => financialPaths.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    // Names the account or goal it acts on when it acts on one: `debt:<id>`,
    // `goal:<id>`. A key whose row is gone is skipped on read.
    candidateKey: varchar("candidate_key", { length: 100 }).notNull(),
    // One sentence on why the step sits here, and on a `left_out` row, why it is
    // not on the path at all. The model's, when it decided.
    reason: text("reason").notNull().default(""),
    // Where the person stands on this step, and what they wrote about it.
    // Carried onto the next path for every key that survives a regeneration,
    // so a step you ticked stays ticked when the order is chosen again.
    status: financialPathStepStatusEnum("status").notNull().default("pending"),
    note: text("note").notNull().default(""),
    statusAt: timestamp("status_at", { withTimezone: true }),
  },
  (t) => [unique("financial_path_steps_path_position_uniq").on(t.pathId, t.position)],
);
