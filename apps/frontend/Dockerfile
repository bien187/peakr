# Peakr – Web-App inkl. API (Next.js, Production-Build + next start).
# Build-Kontext = Repo-Root (siehe docker-compose.yml).
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter @ch-alpineroute/frontend...

# Die API-Routen nutzen den Server-Code aus apps/backend.
COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY apps/frontend apps/frontend

WORKDIR /app/apps/frontend
ENV NEXT_TELEMETRY_DISABLED=1
# Der Strassengraph kommt zur Laufzeit aus dem Daten-Volume (ROAD_GRAPH_PATH),
# daher wird hier «next build» direkt (ohne prebuild-Download) aufgerufen.
RUN node scripts/copy-map-worker.mjs && pnpm exec next build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
