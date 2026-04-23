# Multi-stage Dockerfile for the internal dnd-notes control plane

FROM node:22.21.1-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs ./scripts/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY apps/control-plane/package*.json ./apps/control-plane/

FROM base AS deps
RUN npm ci --omit=dev --workspace apps/control-plane --include-workspace-root

FROM base AS build-deps
RUN npm ci

FROM build-deps AS build
COPY tsconfig.json commitlint.config.cjs ./
COPY apps/control-plane ./apps/control-plane
RUN npm run build --workspace apps/control-plane

FROM node:22.21.1-bookworm-slim AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/control-plane/dist ./apps/control-plane/dist
COPY --from=build /app/apps/control-plane/package.json ./apps/control-plane/
COPY package.json ./

RUN mkdir -p /app/data && \
    groupadd --gid 10001 appuser && \
    useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser && \
    chown -R 10001:10001 /app
USER 10001:10001

EXPOSE 3001

ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/app/data/control-plane.sqlite

CMD ["node", "apps/control-plane/dist/index.js"]
