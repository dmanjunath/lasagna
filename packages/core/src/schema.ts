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
