import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth.js";
import { plaidRoutes } from "./routes/plaid.js";
import { accountRoutes } from "./routes/accounts.js";
import { holdingsRoutes } from "./routes/holdings.js";
import { syncRoutes } from "./routes/sync.js";
import { plansRouter } from "./routes/plans.js";
import { threadsRouter } from "./routes/threads.js";
import { chatRouter } from "./routes/chat.js";
import { taxRouter } from "./routes/tax.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/auth", authRoutes);
app.route("/api/plaid", plaidRoutes);
app.route("/api/accounts", accountRoutes);
app.route("/api/holdings", holdingsRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/plans", plansRouter);
app.route("/api/threads", threadsRouter);
app.route("/api/chat", chatRouter);
app.route("/api/tax", taxRouter);
