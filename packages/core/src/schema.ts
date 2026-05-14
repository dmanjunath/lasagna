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
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("owner"),
  isDemo: boolean("is_demo").default(false).notNull(),
  onboardingStage: onboardingStageEnum("onboarding_stage"),
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
  metadata: text("metadata"), // JSON string for loan details, property info, etc.
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

// ── Transactions ─────────────────────────────────────────────────────────

export const transactionCategoryEnum = pgEnum("transaction_category", [
  "income",
  "housing",
  "transportation",
  "food_dining",
  "groceries",
  "utilities",
  "healthcare",
  "insurance",
  "entertainment",
  "shopping",
  "personal_care",
  "education",
  "travel",
  "subscriptions",
  "savings_investment",
  "debt_payment",
  "gifts_donations",
  "taxes",
  "transfer",
  "other",
]);

export const transactionSourceEnum = pgEnum("transaction_source", ["seed", "plaid"]);

export const transactions = pgTable("transactions", {
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
  category: transactionCategoryEnum("category").notNull().default("other"),
  pending: integer("pending").notNull().default(0), // 0 = false, 1 = true
  source: transactionSourceEnum("source").notNull().default("seed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Goals ─────────────────────────────────────────────────────────────────

export const goalStatusEnum = pgEnum("goal_status", ["active", "completed", "paused"]);

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  targetAmount: numeric("target_amount", { precision: 19, scale: 2 }).notNull(),
  currentAmount: numeric("current_amount", { precision: 19, scale: 2 }).notNull().default("0"),
  deadline: timestamp("deadline", { withTimezone: true }),
  category: varchar("category", { length: 50 }).notNull().default("savings"),
  status: goalStatusEnum("goal_status").notNull().default("active"),
  icon: varchar("icon", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
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
