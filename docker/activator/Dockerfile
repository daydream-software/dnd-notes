# syntax=docker/dockerfile:1.4
# Multi-stage Dockerfile for the dnd-notes activator (scale-to-zero wake-on-request proxy)

FROM node:24.15.0-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs scripts/build-portal-utils.mjs ./scripts/
COPY packages/postgres-migrations ./packages/postgres-migrations
COPY apps/activator/package*.json ./apps/activator/

FROM base AS deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --workspace apps/activator --include-workspace-root --omit=dev --ignore-scripts

FROM base AS build-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM build-deps AS build
COPY tsconfig.json ./
COPY apps/activator ./apps/activator
RUN npm run build --workspace apps/activator

FROM node:24.15.0-bookworm-slim AS runtime
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/daydream-software/dnd-notes"
LABEL org.opencontainers.image.description="D&D Notes activator (wake-on-request proxy for scale-to-zero tenants)"
LABEL org.opencontainers.image.licenses="FSL-1.1-MIT"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/activator/dist ./apps/activator/dist
COPY --from=build /app/apps/activator/package.json ./apps/activator/
COPY package.json ./

RUN groupadd --gid 10001 appuser && \
    useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser
USER 10001:10001

EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080

CMD ["node", "apps/activator/dist/index.js"]
