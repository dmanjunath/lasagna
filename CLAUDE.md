# Lasagna - Claude Instructions

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
