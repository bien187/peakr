# CH-AlpineRoute — Frontend (Next.js, Production-Build + next start).
# Build-Kontext = Repo-Root (siehe docker-compose.yml).
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter @ch-alpineroute/frontend...

COPY packages/shared packages/shared
COPY apps/frontend apps/frontend

WORKDIR /app/apps/frontend
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* wird beim Build eingebacken; Default http://localhost:4000 passt für lokalen Betrieb.
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
