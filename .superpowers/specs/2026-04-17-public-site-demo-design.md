# Public Site & Demo Mode Design

**Date:** 2026-04-17
**Branch:** `feature/public-site`

## Overview

Two new things: a public marketing site at `lasagnafi.com` and a read-only demo deployment of the app at `demo.lasagnafi.com`. The existing app moves to `app.lasagnafi.com`. Everything lives in the existing monorepo.

## Goals

- Give Lasagna a public presence that communicates its privacy-first, AI-powered value proposition
- Let prospective users explore the full app before signing up
- Prevent demo users from mutating any data (both frontend and API enforcement)
- Position Lasagna as both a hosted product and an open-source self-hostable tool

---

## 1. Repository & Branch Structure

All work happens in a new branch `feature/public-site` off `main`.

```
packages/
  landing/    ← new Astro site → lasagnafi.com
  web/        ← existing React app → app.lasagnafi.com + demo.lasagnafi.com
  api/        ← existing Hono backend (minor middleware change)
  core/       ← shared schema (add isDemo column)
```

**Three Cloudflare Pages deployments from the same repo:**

| Deployment | Package | Env vars |
|---|---|---|
| `lasagnafi.com` | `packages/landing` | `PUBLIC_VIDEO_URL` (optional, Cloudflare Pages build-time variable) |
| `app.lasagnafi.com` | `packages/web` | standard |
| `demo.lasagnafi.com` | `packages/web` | `VITE_DEMO_MODE=true` |

---

## 2. Landing Page (`packages/landing`)

### Tech Stack
- **Astro** — static site generator, zero JS by default, great SEO
- **Tailwind CSS** — dark theme consistent with the app
- No backend required

### Theme Sharing
The landing site defines its own Tailwind config and copies the CSS custom property tokens from `packages/web/src/index.css` into `packages/landing/src/styles/global.css`. One-time copy — no shared package needed.

### Layout (Hero → Video → Features → Two Ways)

```
Nav
  Logo (left) | "Sign Up →" (→ app.lasagnafi.com/login)

Hero
  Headline: "Your complete financial picture — private and AI-powered"
  Subheadline: Lasagna connects your accounts, runs retirement simulations,
  and answers financial questions with AI. Your data stays private —
  use our hosted product or self-host on your own infrastructure.
  CTAs: "Sign Up →" (primary) | "Self-host for free →" (secondary, → GitHub)

Demo Video
  Full-width YouTube/Vimeo embed (screen capture walkthrough)
  Config: import.meta.env.PUBLIC_VIDEO_URL in packages/landing/src/config.ts
  If null/unset: styled placeholder "See Lasagna in action — video coming soon"

Feature Grid (3 columns)
  1. Private by design
     Your financial data is never sold or shared. Hosted on our
     infrastructure or yours.
  2. Private AI
     Financial questions go to an LLM via your own API key.
     Anthropic sees your queries — we never do.
  3. Full financial picture
     Retirement planning, Monte Carlo simulations, portfolio analysis,
     debt, tax strategy, and spending in one place.

"Two ways to use Lasagna" section
  [Hosted]                        [Self-hosted]
  We manage the infra.            Your server, your data.
  Sign up in seconds.             Open source, free forever.
  [Sign Up →]                     [View on GitHub →]

Footer
  "Self-host Lasagna in minutes" + GitHub link + © lasagnafi.com
```

### Video Config
```ts
// packages/landing/src/config.ts
// Note: Astro exposes env vars client-side only with PUBLIC_ prefix (unlike Vite's VITE_)
export const DEMO_VIDEO_URL: string | null = import.meta.env.PUBLIC_VIDEO_URL ?? null;
```

---

## 3. Demo Mode

### 3a. Schema Change (`packages/core/src/schema.ts`)

Add `isDemo` boolean to the `users` table:

```ts
isDemo: boolean("is_demo").default(false).notNull()
```

Safe migration — non-nullable default backfills all existing rows to `false`.

⚠️ **Deployment order:** Apply migration to production DB before deploying the new API middleware.

### 3b. Seed Data (`packages/core/src/seed/seed-demo.ts`)

The existing `createBaseEntities` auto-generates a `seed-{timestamp}@lasagna.local` email and accepts no email override. Rather than modifying that function, `seed-demo.ts` inserts the tenant and user rows directly using Drizzle, then runs the data generators (accounts, holdings, transactions, etc.) from the Taylor preset by passing the newly created `tenantId` and `userId` directly.

Idempotency: check whether `demo@lasagnafi.com` exists first. If yes, only ensure `isDemo = true` and return. If no, run the full seed.

```ts
// Pseudocode:
const existing = await db.select().from(users).where(eq(users.email, 'demo@lasagnafi.com'))
if (existing.length > 0) {
  await db.update(users).set({ isDemo: true }).where(eq(users.email, 'demo@lasagnafi.com'))
  return
}
// Insert tenant, plaidItem, and user directly (bypass createBaseEntities):
const [tenant] = await db.insert(tenants).values({ /* ... */ }).returning()
// A plaidItem row is required — generators use plaidItem.id as plaidItemId for accounts
// Match the shape createBaseEntities uses (status, accessToken, institutionId, institutionName, lastSyncedAt)
const [plaidItem] = await db.insert(plaidItems).values({
  tenantId: tenant.id,
  accessToken: 'manual-demo',   // sentinel — no real Plaid token
  institutionId: 'manual',
  institutionName: 'Demo Bank',
  status: 'active',
  lastSyncedAt: new Date(),
}).returning()
const [user] = await db.insert(users).values({
  email: 'demo@lasagnafi.com',
  passwordHash: await hashPassword('lasagna123'),
  name: 'Demo User',
  tenantId: tenant.id,
  role: 'owner',
  isDemo: true,
}).returning()
// Run Taylor preset data generators using the same call pattern as seed/index.ts.
// Generator signatures require (db, tenantId, plaidItemId/accounts, config, timestamp) —
// verify exact signatures in packages/core/src/seed/generators/ before implementing.
// Do not copy the calls below verbatim; use seed/index.ts as the reference.
// generateAssets(db, tenant.id, plaidItem.id, PRESETS['1.8M'].assets, timestamp)
// generateHoldings(db, tenant.id, createdAccounts, timestamp)
// etc.
```

Add to root `package.json`:
```json
"db:seed-demo": "tsx packages/core/src/seed/seed-demo.ts"
```

**Demo credentials:** `demo@lasagnafi.com` / `lasagna123`

### 3c. Session Token (`packages/api/src/lib/session.ts`)

Add `isDemo` to the `SessionPayload` **interface declaration**:

```ts
interface SessionPayload {
  userId: string
  tenantId: string
  role: string
  isDemo: boolean   // ← new
}
```

**`createSessionToken`:** include `isDemo: user.isDemo` in `POST /api/auth/login`.

**`POST /api/auth/signup`:** Also include `isDemo: false` (new signups are never demo users). TypeScript will require this once `isDemo` is added to `SessionPayload`.

**`verifySessionToken`:** include `isDemo: parsed.isDemo ?? false` explicitly in the return statement. Without this, the field is silently dropped even if present in the JWT.

### 3d. API Enforcement — Demo Guard (`packages/api/src/server.ts`)

**Middleware ordering:** `requireAuth` is currently applied per-sub-router, not globally. For the demo guard to have access to `session`, `requireAuth` must run first at the app level. Promote `requireAuth` to a global app middleware in `server.ts`, before the demo guard and before sub-router registration:

```ts
// Exempt auth and health routes from requireAuth:
app.use('/api/*', async (ctx, next) => {
  const exempt = [
    '/api/auth/login', '/api/auth/logout', '/api/auth/signup', '/api/auth/me',
    '/api/health',  // Cloud Run health probe — must remain unauthenticated
  ]
  if (exempt.includes(ctx.req.path)) return next()
  return requireAuth(ctx, next)
})
```

Remove per-router `router.use('*', requireAuth)` calls from individual route files — they are now redundant.

Also update the `app` declaration in `server.ts` to `new Hono<AuthEnv>()` so that `ctx.get('session')` type-checks correctly in the demo guard. `AuthEnv` is already defined in `middleware/auth.ts`. Without this, `ctx.get('session')` returns `unknown` and the guard will require a cast.

Note: `ctx.req.path` in `app.use` middleware always returns the full original request path (e.g. `/api/insights/abc/dismiss`) — Hono only strips the mount prefix inside sub-router handlers, not in top-level `app.use` middleware. The demo guard's regex patterns are correct as written.

**Demo guard** (registered immediately after the requireAuth promotion, before sub-routers):

```ts
app.use('/api/*', async (ctx, next) => {
  const session = ctx.get('session')
  if (!session?.isDemo || ctx.req.method === 'GET') return next()

  const path = ctx.req.path

  // Intercepted — return success without DB write:
  if (path.match(/^\/api\/insights\/[^/]+\/(dismiss|acted)$/)) {
    return ctx.json({ ok: true })
  }
  if (path === '/api/insights/generate') {
    return ctx.json({ ok: true, generated: 0 })
  }

  // Allowed through to route handler:
  const allowed = ['/api/chat', '/api/simulations', '/api/threads']
  if (allowed.some(p => path === p || path.startsWith(p + '/'))) {
    return next()
  }

  return ctx.json(
    { error: 'Demo mode — sign up to make changes at app.lasagnafi.com' },
    403
  )
})
```

**Route policy for demo users:**

| Route | Demo behavior | Reason |
|---|---|---|
| `POST /api/chat`, `POST /api/chat/v2` | Allowed through | Core feature |
| `POST /api/threads` | Allowed through | Required to initiate chat |
| `DELETE /api/threads/:id` | Blocked (403) | Destructive |
| `POST /api/simulations/*` | Allowed through | Computation, no state persisted |
| `POST /api/insights/generate` | Intercepted (200, `generated: 0`) | Prevents shared tenant accumulation |
| `POST /api/insights/:id/dismiss` | Intercepted (200 no-op) | UI call succeeds; no DB write |
| `POST /api/insights/:id/acted` | Intercepted (200 no-op) | UI call succeeds; no DB write |
| `POST /api/plans` | Blocked (403) | Mutation — hide "New Plan" button |
| `PATCH /api/plans/:id` | Blocked (403) | Mutation |
| `POST /api/plans/:id/clone` | Blocked (403) | Mutation |
| `POST /api/plans/:id/restore` | Blocked (403) | Mutation |
| `POST /api/sync`, `POST /api/sync/:itemId` | Blocked (403) | No Plaid tokens on demo tenant |
| `POST /api/auth/signup` | Allowed (not behind requireAuth) | Intentional conversion path |
| All other POST / PUT / PATCH / DELETE | Blocked (403) | Mutations |

### 3e. Chat Handler Demo Guards (`packages/api/src/routes/chat.ts`, `chat-v2.ts`)

Both handlers contain direct DB writes that must be individually guarded because the routes are on the allowlist. Skip all three if `session.isDemo`:

1. `db.insert(planEdits)` — skip
2. `db.update(plans)` (content update) — skip
3. `db.update(plans)` (title update, `chat.ts` only, near end of handler) — skip

Additionally: skip `db.insert(messages)` for both the user message and assistant message when `session.isDemo`. This prevents unbounded message row accumulation in the shared demo tenant (chat will still function — messages just are not persisted).

**Agent tools:** Update `createAgentTools(tenantId: string)` to accept a second optional parameter `options?: { isDemo?: boolean }`. When `isDemo` is true, exclude `update_plan_content` and `create_plan` from the returned tool set. Verify actual tool names against `packages/api/src/agent/tools/plans.ts` before implementing. Then update **both call sites** — in `chat.ts` (line ~73) and `chat-v2.ts` (line ~74) — to pass `{ isDemo: session.isDemo }` as the second argument. Without updating the call sites, the tool-filtering logic silently won't fire (TypeScript optional parameter doesn't surface this).

### 3f. CORS (`packages/api/src/server.ts`)

Update the CORS origin callback to support a comma-separated list, preserving existing special-case logic, with a localhost default:

```ts
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

origin: (origin) => {
  if (!origin) return origin
  if (origin.startsWith('http://localhost:')) return origin
  if (origin.endsWith('.trycloudflare.com')) return origin
  if (allowedOrigins.includes(origin)) return origin
  return undefined
},
credentials: true,
```

**Production:** `CORS_ORIGIN=https://app.lasagnafi.com,https://demo.lasagnafi.com`

### 3g. Cookie SameSite Policy (`packages/api/src/routes/auth.ts`)

Update all three cookie operations (signup set, login set, logout delete):

```ts
sameSite: "None"
secure: true   // changed from current secure: false
```

The `deleteCookie` on logout must include the same attributes — a cookie set with `sameSite: "None"` cannot be cleared by a delete call that omits them.

### 3h. Frontend — Demo UI (`packages/web`)

**`VITE_DEMO_MODE`** is a Vite build-time constant. Absence = `false`. No runtime check needed.

**Demo banner** — mounts in `App.tsx` inside authenticated layout:
```tsx
{import.meta.env.VITE_DEMO_MODE === 'true' && <DemoBanner />}
```
Content: `You're exploring a read-only demo. Sign up at app.lasagnafi.com to get started. [Sign Up →]`

**Login page banner** (above login form, `VITE_DEMO_MODE=true` only):
```
Demo account — click to auto-fill:
  Email: demo@lasagnafi.com  |  Password: lasagna123  [Auto-fill]
```

**Sign up form:** Replace entirely (not `display:none`) with `Create an account at app.lasagnafi.com →`

**Onboarding redirect:** If `VITE_DEMO_MODE=true` and user navigates to `/onboarding`, redirect to `/`.

**Mutation UI hidden when `VITE_DEMO_MODE=true`:**
- Add account buttons (manual + Plaid link)
- Edit/delete account forms
- Add/edit/delete holdings
- Create/edit/delete goals
- New Plan button, create/edit/delete plans
- Upload tax documents
- Profile edit form, financial profile edit form, and change-password form
- All "Connect bank" / Plaid flows
- "Sync now" / refresh account buttons
- Delete thread button in chat

### 3i. Login Page Link (`packages/web/src/pages/Login.tsx`)

On the hosted login page — only when `VITE_DEMO_MODE` is **not** set — add below the sign-up form:

```
Want to explore first? → Try the demo (demo.lasagnafi.com)
```

---

## 4. Implementation Sequence

1. Create branch `feature/public-site` off `main`
2. **Schema:** add `isDemo` column → `pnpm db:push`
   - ⚠️ Apply to production DB before deploying new API middleware
3. **Seed:** write `seed-demo.ts` (direct tenant/user insert, not via `createBaseEntities`) → add `db:seed-demo` to root `package.json`
4. **Session:** update `SessionPayload` interface, `createSessionToken` in login, `createSessionToken` in signup (add `isDemo: false`), and `verifySessionToken` return
5. **API middleware restructure:** promote `requireAuth` to global `app.use('/api/*', ...)` with auth route exemptions; remove per-router `requireAuth` calls; register demo guard after requireAuth
6. **Chat handlers:** add `session.isDemo` guards for plan/planEdits writes and message inserts; update `createAgentTools` to accept `options.isDemo` and exclude plan-mutation tools
7. **API CORS:** comma-separated `CORS_ORIGIN` with localhost default
8. **API cookies:** `sameSite: "None"`, `secure: true` on signup, login, and logout
9. **Frontend:** `DemoBanner`, login banner + auto-fill, replace signup form, `/onboarding` redirect, hidden mutation UI, "Try the demo" link on hosted login page
10. **Landing:** scaffold `packages/landing` as Astro + Tailwind → build all sections
11. **Docs:** note three Cloudflare Pages deployment configs in README

---

## 5. Known Limitations (Accepted for Initial Launch)

- Chat messages and AI responses are **not persisted** for demo users (skipped in chat handlers). Chat still functions — messages just aren't stored.
- `POST /api/threads` is allowed through the guard, so thread rows accumulate in the shared demo tenant over time (one per visitor chat session). These are visible in the chat sidebar. A cron-based reset that truncates `chatThreads` for the demo tenant can be added later.
- Demo credentials are publicly visible by design — the account is read-only at the API level.

---

## 6. Out of Scope

- Actual Cloudflare Pages and Cloud Run deployment configuration (manual operator setup)
- Recording or hosting the demo video
- Stripe/billing for the hosted product
- Custom domain DNS setup
