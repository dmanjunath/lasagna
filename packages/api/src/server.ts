import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { requireAuth, AuthEnv } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { plaidRoutes } from "./routes/plaid.js";
import { accountRoutes } from "./routes/accounts.js";
import { holdingsRoutes } from "./routes/holdings.js";
import { syncRoutes } from "./routes/sync.js";
import { plansRouter } from "./routes/plans.js";
import { threadsRouter } from "./routes/threads.js";
import { chatRouter } from "./routes/chat.js";
import { chatRouterV2 } from "./routes/chat-v2.js";
import { taxDocumentsRouter } from "./routes/tax-documents.js";
import { simulationsRouter } from "./routes/simulations.js";
import { settingsRoutes } from "./routes/settings.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { insightsRoutes } from "./routes/insights.js";
import { transactionRoutes } from "./routes/transactions.js";
import { goalRoutes } from "./routes/goals.js";
import { priorityRoutes } from "./routes/priorities.js";
import { manualAccountRoutes } from "./routes/manual-accounts.js";

export const app = new Hono<AuthEnv>();

// Plain-text request logger (no ANSI colors/arrows)
const requestLogger: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  const start = Date.now();
  console.log(`[${method}] ${path}`);
  await next();
  const ms = Date.now() - start;
  console.log(`[${method}] ${path} ${c.res.status} ${ms}ms`);
};
app.use("*", requestLogger);

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (origin.startsWith("http://localhost:")) return origin;
      if (origin.endsWith(".trycloudflare.com")) return origin;
      if (allowedOrigins.includes(origin)) return origin;
      return undefined;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Global auth: exempt public routes, require auth everywhere else ──
app.use("/api/*", async (ctx, next) => {
  const exempt = [
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/signup",
    "/api/auth/me",
    "/api/health",
  ];
  if (exempt.includes(ctx.req.path)) return next();
  return requireAuth(ctx, next);
});

// ── Demo guard: block mutations for isDemo users ──
app.use("/api/*", async (ctx, next) => {
  const session = ctx.get("session");
  if (!session?.isDemo || ctx.req.method === "GET") return next();

  const path = ctx.req.path;

  // Intercept without DB write — return success so UI doesn't break
  if (path.match(/^\/api\/insights\/[^/]+\/(dismiss|acted)$/)) {
    return ctx.json({ ok: true });
  }
  if (path === "/api/insights/generate") {
    return ctx.json({ ok: true, generated: 0 });
  }

  // Allow read-only computation and chat routes through
  const allowed = ["/api/chat", "/api/simulations", "/api/threads"];
  if (allowed.some((p) => path === p || path.startsWith(p + "/"))) {
    return next();
  }

  return ctx.json(
    { error: "Demo mode — sign up to make changes at app.lasagnafi.com" },
    403
  );
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
app.route("/api/tax/documents", taxDocumentsRouter);
app.route("/api/simulations", simulationsRouter);
app.route("/api/settings", settingsRoutes);
app.route("/api/portfolio", portfolioRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/transactions", transactionRoutes);
app.route("/api/goals", goalRoutes);
app.route("/api/priorities", priorityRoutes);
app.route("/api/manual-accounts", manualAccountRoutes);
