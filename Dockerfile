# Multi-stage Dockerfile for dnd-notes tenant app
# Produces a single-origin container with web + API served by Express

FROM node:22.21.1-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs scripts/build-portal-utils.mjs ./scripts/
COPY packages/portal-utils ./packages/portal-utils
COPY packages/postgres-migrations ./packages/postgres-migrations
COPY packages/theme ./packages/theme
COPY platform/keycloak-jwt/package*.json ./platform/keycloak-jwt/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

FROM base AS deps
RUN npm ci --workspace apps/api --include-workspace-root && \
    npm prune --omit=dev

FROM base AS build-deps
RUN npm ci

FROM build-deps AS build
COPY tsconfig.json commitlint.config.cjs ./
COPY platform/keycloak-jwt ./platform/keycloak-jwt
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npm run build --workspace packages/portal-utils
RUN npm run build --workspace packages/postgres-migrations
RUN npm run build --workspace packages/theme
RUN npm run build --workspace platform/keycloak-jwt
RUN npm run build --workspace apps/api
RUN npm run build --workspace apps/web

FROM node:22.21.1-bookworm-slim AS runtime
WORKDIR /app

# Install runtime dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=build /app/platform/keycloak-jwt/dist ./platform/keycloak-jwt/dist
COPY --from=build /app/platform/keycloak-jwt/package.json ./platform/keycloak-jwt/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/packages/postgres-migrations/package.json ./packages/postgres-migrations/
COPY --from=build /app/packages/postgres-migrations/dist ./packages/postgres-migrations/dist

# Copy root package.json for workspace resolution
COPY package.json ./

# Run as non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000

CMD ["node", "apps/api/dist/index.js"]
