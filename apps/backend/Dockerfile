# CH-AlpineRoute — Backend (API), Migrations-Runner und Worker (läuft via tsx).
# Build-Kontext = Repo-Root (siehe docker-compose.yml).
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Build-Tools für native Module (argon2)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Nur Manifeste zuerst → besseres Layer-Caching beim Install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @ch-alpineroute/backend...

# Quellcode
COPY packages/shared packages/shared
COPY apps/backend apps/backend

WORKDIR /app/apps/backend
ENV NODE_ENV=production
# Standardbefehl = API; Worker/Migration überschreiben das in docker-compose.yml
CMD ["pnpm", "start"]
