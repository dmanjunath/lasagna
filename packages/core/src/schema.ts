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
  index,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────────

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const roleEnum = pgEnum("role", ["owner", "member"]);
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Plaid Items ────────────────────────────────────────────────────────────

export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(), // encrypted at rest
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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

// ── Holdings ───────────────────────────────────────────────────────────────

export const holdings = pgTable("holdings", {
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
  snapshotAt: timestamp("snapshot_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
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
  deadline: timestamp("deadline", { withTimezone: true }),
  category: varchar("category", { length: 50 }).notNull().default("savings"),
  status: goalStatusEnum("goal_status").notNull().default("active"),
  icon: varchar("icon", { length: 10 }),
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
