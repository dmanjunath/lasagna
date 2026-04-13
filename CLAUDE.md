# Lasagna - Claude Instructions

## Rules

- **NEVER modify user data in the database** — do not reset passwords, delete accounts, alter balances, or change any real user records. If you need to test as a specific user, ask for credentials. Use seed data for testing instead.
- **NEVER run destructive database operations** (DROP, TRUNCATE, DELETE) on production or user data without explicit permission.

## Docker Development

- Use `docker compose up -d` or `docker compose restart api` for most changes
- Source code is volume-mounted, so hot reload works without rebuilding
- Only use `docker compose up --build` when:
  - Dependencies change (package.json/pnpm-lock.yaml)
  - Dockerfile.dev changes
  - Files outside mounted volumes change

## Common Commands

```bash
pnpm dev          # Start postgres + API (foreground)
pnpm docker:up    # Start in background
pnpm db:reset     # Drop all tables (local only)
pnpm db:push      # Push schema changes
pnpm db:seed      # Seed test data
```
