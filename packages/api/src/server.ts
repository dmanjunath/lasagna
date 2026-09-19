import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { resolveCorsOrigin } from "./lib/cors.js";
import { blocksAsCsrf } from "./lib/csrf.js";
import { checkOriginAuth, ORIGIN_AUTH_HEADER } from "./lib/origin-auth.js";
import { COOKIE_NAME } from "./lib/session.js";
import type { MiddlewareHandler } from "hono";
import { requireAuth, AuthEnv } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { webauthnRoutes } from "./routes/webauthn.js";
import { plaidRoutes } from "./routes/plaid.js";
import { accountRoutes } from "./routes/accounts.js";
import { holdingsRoutes } from "./routes/holdings.js";
import { syncRoutes } from "./routes/sync.js";
import { plansRouter } from "./routes/plans.js";
import { financialPlansRouter } from "./routes/financial-plans.js";
import { threadsRouter } from "./routes/threads.js";
import { chatRouter } from "./routes/chat.js";
import { taxDocumentsRouter } from "./routes/tax-documents.js";
import { simulationsRouter } from "./routes/simulations.js";
import { settingsRoutes } from "./routes/settings.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { insightsRoutes } from "./routes/insights.js";
import { transactionRoutes } from "./routes/transactions.js";
import { goalRoutes } from "./routes/goals.js";
import { financialPathRoutes } from "./routes/financial-path.js";
import { manualAccountRoutes } from "./routes/manual-accounts.js";
import { recurringRoutes } from "./routes/recurring.js";
import { quickImportRoutes } from "./routes/quick-import.js";
import { billingRoutes } from "./routes/billing.js";
import { accountRouter } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { householdRoutes } from "./routes/household.js";
import { rulesRoutes } from "./routes/rules.js";
import { categoryRoutes } from "./routes/categories.js";
import { placesRoutes } from "./routes/places.js";
import { retirementSimRouter } from "./routes/retirement-sim.js";
import { cronRoutes } from "./routes/cron.js";

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
// localhost:* and *.trycloudflare.com are reflected only outside production —
// see resolveCorsOrigin. In prod they'd be an attacker-registerable credentialed
// origin.
const corsIsDev = process.env.NODE_ENV !== "production";

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin, allowedOrigins, corsIsDev),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-lasagna-client"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// ── Origin auth: require requests to have come through Cloudflare ──
// The run.app URL answers the internet directly, so anything Cloudflare
// enforces is bypassable while that path is open. Cloud Run's ingress setting
// can't close it (a domain mapping isn't a load balancer), so Cloudflare
// injects a shared secret header instead — see lib/origin-auth.ts.
//
// Two env vars, so this can ship before Cloudflare sends the header:
//   ORIGIN_AUTH_SECRET   unset  -> off entirely
//   ORIGIN_AUTH_ENFORCE  !true  -> log only, never reject
// Mounted on /api/* only. /cron/* is called by Cloud Scheduler on the run.app
// URL, bypassing Cloudflare by design, and has its own shared-secret guard.
const originAuthSecret = process.env.ORIGIN_AUTH_SECRET;
const originAuthEnforce = process.env.ORIGIN_AUTH_ENFORCE === "true";
app.use("/api/*", async (ctx, next) => {
  const outcome = checkOriginAuth({
    method: ctx.req.method,
    path: ctx.req.path,
    provided: ctx.req.header(ORIGIN_AUTH_HEADER),
    expected: originAuthSecret,
  });
  if (outcome === "unfronted") {
    if (originAuthEnforce) {
      return ctx.json({ error: "Direct origin access is not allowed" }, 403);
    }
    // Log-only: this is what you watch before flipping ORIGIN_AUTH_ENFORCE on.
    // A legitimate caller showing up here means it is not going through
    // Cloudflare and would break under enforcement.
    console.warn(
      `[origin-auth] would block: ${ctx.req.method} ${ctx.req.path} ua=${ctx.req.header("user-agent") ?? "-"}`
    );
  }
  return next();
});

// ── CSRF: reject cross-site writes that ride on the session cookie ──
// Runs before auth so a forged request never reaches a handler. Cookie-less
// requests (webhooks, Bearer clients) are untouched — see lib/csrf.ts.
app.use("/api/*", async (ctx, next) => {
  if (
    blocksAsCsrf({
      method: ctx.req.method,
      origin: ctx.req.header("origin"),
      hasSessionCookie: getCookie(ctx, COOKIE_NAME) !== undefined,
      allowedOrigins,
      isDev: corsIsDev,
    })
  ) {
    return ctx.json({ error: "Cross-site request blocked" }, 403);
  }
  return next();
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Cloud Scheduler jobs: mounted OUTSIDE /api/* so the user-auth and demo
// guards below never apply. Its own shared-secret guard protects it. ──
app.route("/cron", cronRoutes);

// ── Global auth: exempt public routes, require auth everywhere else ──
app.use("/api/*", async (ctx, next) => {
  const exempt = [
    "/api/auth/login",
    "/api/auth/login/start",
    "/api/auth/login/send-code",
    "/api/auth/login/code",
    "/api/auth/webauthn/login/options",
    "/api/auth/webauthn/login/verify",
    "/api/auth/logout",
    "/api/auth/signup",
    "/api/auth/me",
    "/api/auth/verify-email",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/google/start",
    "/api/auth/google/callback",
    "/api/health",
    "/api/billing/webhook",
    "/api/plaid/webhook",
  ];
  if (exempt.includes(ctx.req.path)) return next();
  // Public invite-summary endpoint (/api/household/invite/:token) — the
  // logged-out /accept-invite page calls it, and the per-request token means
  // the resolved path can never be an exact-match exempt entry. All other
  // /api/household/* actions stay guarded.
  if (ctx.req.path.startsWith("/api/household/invite/")) return next();
  return requireAuth(ctx, next);
});

// ── Demo guard: block mutations for isDemo users ──
app.use("/api/*", async (ctx, next) => {
  const session = ctx.get("session");
  if (!session?.isDemo || ctx.req.method === "GET") return next();

  const path = ctx.req.path;

  // Intercept without DB write — return success so UI doesn't break
  // `snooze` was missing here, so a demo user pressing it got a 403 on an
  // action the UI offers.
  if (path.match(/^\/api\/insights\/[^/]+\/(dismiss|acted|snooze)$/)) {
    return ctx.json({ ok: true });
  }
  if (path === "/api/insights/generate" || path === "/api/insights/refresh-spend-cuts") {
    return ctx.json({ ok: true, generated: 0 });
  }

  // Allow read-only computation and chat routes through
  const allowed = ["/api/chat", "/api/simulations", "/api/threads", "/api/retirement"];
  if (allowed.some((p) => path === p || path.startsWith(p + "/"))) {
    return next();
  }

  return ctx.json(
    { error: "Demo mode. Sign up to make changes at app.lasagnafi.com." },
    403
  );
});

app.route("/api/auth/webauthn", webauthnRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/plaid", plaidRoutes);
app.route("/api/accounts", accountRoutes);
app.route("/api/holdings", holdingsRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/plans", plansRouter);
app.route("/api/financial-plans", financialPlansRouter);
app.route("/api/threads", threadsRouter);
app.route("/api/chat", chatRouter);
app.route("/api/tax/documents", taxDocumentsRouter);
app.route("/api/simulations", simulationsRouter);
app.route("/api/settings", settingsRoutes);
app.route("/api/portfolio", portfolioRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/transactions", transactionRoutes);
app.route("/api/goals", goalRoutes);
app.route("/api/financial-path", financialPathRoutes);
app.route("/api/manual-accounts", manualAccountRoutes);
app.route("/api/recurring", recurringRoutes);
app.route("/api/quick-import", quickImportRoutes);
app.route("/api/billing", billingRoutes);
app.route("/api/account", accountRouter);
app.route("/api/admin", adminRoutes);
app.route("/api/household", householdRoutes);
app.route("/api/rules", rulesRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/places", placesRoutes);
app.route("/api/retirement", retirementSimRouter);
