# syntax=docker/dockerfile:1.4
# Stage 1: Base with package.json files
FROM node:24.15.0-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs scripts/build-portal-utils.mjs ./scripts/
COPY packages/portal-utils ./packages/portal-utils
COPY packages/postgres-migrations ./packages/postgres-migrations
COPY packages/theme ./packages/theme
COPY platform/keycloak-jwt ./platform/keycloak-jwt
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY apps/control-plane/package*.json ./apps/control-plane/
COPY apps/operator-portal/package*.json ./apps/operator-portal/
COPY apps/customer-portal/package*.json ./apps/customer-portal/

# Stage 2: Install all dependencies for build
FROM base AS build-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

# Stage 3: Build application
FROM build-deps AS build
ARG PORTAL_NAME
COPY tsconfig.json commitlint.config.cjs ./
COPY . ./
RUN node ./scripts/build-portal-utils.mjs
RUN npm run build --workspace packages/theme
RUN npm run build --workspace apps/${PORTAL_NAME}

# Stage 4: Runtime image
FROM nginx:alpine AS runtime
ARG PORTAL_NAME
WORKDIR /usr/share/nginx/html
LABEL org.opencontainers.image.source="https://github.com/daydream-software/dnd-notes"
LABEL org.opencontainers.image.description="D&D Notes operator portal (nginx + static SPA)"
LABEL org.opencontainers.image.licenses="FSL-1.1-MIT"
RUN rm -rf ./*
COPY --from=build /app/apps/${PORTAL_NAME}/dist ./

COPY docker/portal/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/portal/generate-env.sh /docker-entrypoint.d/40-generate-env.sh
RUN chmod +x /docker-entrypoint.d/40-generate-env.sh

EXPOSE 8080
