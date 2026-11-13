# Peakr – Migrationen, Datenpipeline und Worker (laufen mit tsx).
# Build-Kontext = Repo-Root (siehe docker-compose.yml).
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# osmium + unzip für die Datenpipeline (OSM-Auszug filtern, swisstopo-Archive entpacken)
RUN apt-get update \
  && apt-get install -y --no-install-recommends osmium-tool unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
# tsx ist eine devDependency und wird zur Laufzeit gebraucht.
RUN pnpm install --frozen-lockfile --prod=false --filter @ch-alpineroute/backend...

COPY packages/shared packages/shared
COPY apps/backend apps/backend

WORKDIR /app/apps/backend
ENV NODE_ENV=production
ENV DATA_DIR=/data
CMD ["pnpm", "worker", "schedule"]
