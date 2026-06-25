# Lasagna - Claude Instructions

## General Guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

**Be unambiguously clear about exactly what I'm referring to.** Before acting on any request that points at something ("this", "the X", "it moves", a behavior, an element), confirm you and I mean the *same* thing. If there's any ambiguity about which element, interaction, or scope I mean, ask follow-up questions until it's pinned down — don't pick the interpretation you can act on fastest and run with it. Reproduce the exact scenario I described before claiming it's fixed; verifying the thing you changed is not the same as verifying the thing I reported. Keep asking until it's clear. I will tell you when I want no more questions.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
It's not required you get confirmation to execute the plan, just make a plan and state it


## Rules

- **NEVER modify user data in the database** — do not reset passwords, delete accounts, alter balances, or change any real user records. If you need to test as a specific user, ask for credentials. Use seed data for testing instead.
- **NEVER run destructive database operations** (DROP, TRUNCATE, DELETE) on production or user data without explicit permission.
- **NEVER commit by default.** Only commit when the user explicitly asks ("commit this", "make a commit", "git commit"). Finishing a task is not an implicit request to commit — leave the working tree dirty so the user can review.
- **NEVER create git branches by default.** Do not run `git checkout -b` / `git branch` / `git switch -c` unless the user explicitly asks for a branch. Work on the current branch and leave changes in the working tree.
- **Always run typecheck before committing.** Once asked to commit, run `pnpm -F @lasagna/web typecheck` (or `cd packages/web && npx tsc --noEmit` for just the web package) and fix any errors before staging. If typecheck fails, surface the errors and stop — do not commit broken code.

## Docker Development

- Source code is volume-mounted, so hot reload works without rebuilding
- Use `docker compose up -d` or `docker compose restart api` for most changes if a change is not being picked up by hot reload
- Only use `docker compose up --build` when:
  - Dependencies change (package.json/pnpm-lock.yaml)
  - Dockerfile.dev changes
  - Files outside mounted volumes change

## Superpowers Docs

All specs and plans from superpowers skills (brainstorming, writing-plans, etc.) go to:
- Specs: `.superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Plans: `.superpowers/plans/YYYY-MM-DD-<topic>.md`

These paths are git-ignored. Never write to `docs/superpowers/`.

## Visual Verification

**Anything that could benefit from visual verification — UI changes, design polish, layout fixes, new pages, chart tweaks — must be verified with Playwright before claiming it works.** Type-checking and reading the diff are not substitutes for seeing the rendered pixels.

How:
1. Use Playwright (already installed) with the `lasagna_session` cookie on `domain: localhost` to authenticate. The cookie is the same one issued by the API login flow (`COOKIE_NAME = "lasagna_session"` in `packages/api/src/lib/session.ts`).
2. Drive the relevant flow (navigate, hover, click) and screenshot — desktop and a mobile viewport (e.g. 390×844) where it matters.
3. Read the screenshot back. If something looks off (foreign colors, layout drift, missing element), fix and re-screenshot before reporting done.
4. For state-dependent visuals (focus rings, hovered chart points, computed `box-shadow`), inspect computed styles via `page.evaluate(() => getComputedStyle(...))` — don't trust the class list alone, since unresolved Tailwind tokens silently fall back to defaults (e.g. `ring-rule/60` → `rgba(59,130,246,0.5)` blue).

**Token:** ask the user for the current `lasagna_session` token if one isn't already present in the conversation. Tokens expire (the JSON payload has `exp`), so don't cache an old one across sessions.

Throwaway scripts go under `_shots-*/` (already gitignored). Don't add them to `e2e/` — that's for the test suite, not ad-hoc verification.

## Debugging

When something isn't working, **run the code and inspect actual data** before theorizing:

1. **Verify inputs and outputs first.** Call the function, log the args going in and the result coming out. Don't assume a function worked because it didn't throw — check the returned values contain real data, not nulls/empty arrays.
2. **Don't trust log summaries.** A log line like `toolCalls=5` means 5 tools were called, not that they succeeded. Always inspect what the tools actually returned.
3. **Check SDK/library types before writing integration code.** Field renames across versions (e.g. `args` → `input` in AI SDK v6) cause silent failures where everything looks fine but values are `undefined`. A 10-second check of the type definitions prevents hours of debugging.
4. **Test end-to-end with real requests.** Use curl or Playwright against the running server with real auth. Don't claim something is fixed based on reading code alone.
5. **Start with the simplest hypothesis.** "The data flowing through is wrong" is almost always more likely than "the AI model is hallucinating." Check the plumbing before blaming the model.

## Common Commands

```bash
pnpm dev          # Start postgres + API (foreground)
pnpm docker:up    # Start in background
pnpm db:reset     # Drop all tables (local only)
pnpm db:push      # Push schema changes
pnpm db:seed      # Seed test data
```
