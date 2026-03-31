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
import { chatRouterV2 } from "./routes/chat-v2.js";
import { taxRouter } from "./routes/tax.js";
import { simulationsRouter } from "./routes/simulations.js";
import { settingsRoutes } from "./routes/settings.js";
import { portfolioRoutes } from "./routes/portfolio.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
}));

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
app.route("/api/chat/v2", chatRouterV2);
app.route("/api/tax", taxRouter);
app.route("/api/simulations", simulationsRouter);
app.route("/api/settings", settingsRoutes);
app.route("/api/portfolio", portfolioRoutes);
