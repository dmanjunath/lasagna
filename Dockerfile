FROM node:20-slim AS base
RUN corepack enable

# Build stage
FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api/package.json packages/api/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/core packages/core
COPY packages/api packages/api

RUN pnpm --filter @lasagna/core build
RUN pnpm --filter @lasagna/api build

# Production stage
FROM base AS production
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api/package.json packages/api/package.json
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/api/dist packages/api/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
