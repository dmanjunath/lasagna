# Lasagna

Self-hosted personal finance platform.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- PostgreSQL

## Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Fill in ENCRYPTION_KEY (generate with: openssl rand -hex 32),
# BETTER_AUTH_SECRET, and Plaid credentials

# Set up the database
pnpm db:push    # apply schema directly (dev)
# or
pnpm db:migrate # run migrations (prod)

# Seed the database (optional)
pnpm db:seed
```

## Run locally

```bash
# Start the API server (port 3000)
pnpm dev

# In another terminal, start the web app
pnpm dev:web
```

## Run with Docker

```bash
docker-compose up
```

## Tests

```bash
pnpm --filter @lasagna/core test
```

## Other commands

```bash
pnpm build       # Build all packages
pnpm lint        # Lint
pnpm typecheck   # Type-check all packages
```
