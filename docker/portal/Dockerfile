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
# nginx-unprivileged sets USER 101 at the end of its build. /var/cache/nginx
# and /etc/nginx are pre-chowned to 101:0 by the base image, but
# /usr/share/nginx/html is not — it remains root-owned. We need root to clear
# the default html files, copy in our dist, and chown the directory so that
# generate-env.sh (which runs as UID 101 at container start) can write env.js.
# Once chown is done at build time, the container requires no capabilities.
FROM nginxinc/nginx-unprivileged:alpine AS runtime
ARG PORTAL_NAME
USER root
WORKDIR /usr/share/nginx/html
LABEL org.opencontainers.image.source="https://github.com/daydream-software/dnd-notes"
LABEL org.opencontainers.image.description="D&D Notes portal (nginx + static SPA; built for customer-portal or operator-portal via PORTAL_NAME)"
LABEL org.opencontainers.image.licenses="FSL-1.1-MIT"
RUN rm -rf ./*
COPY --from=build /app/apps/${PORTAL_NAME}/dist ./
RUN chown -R 101:0 /usr/share/nginx/html

COPY docker/portal/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/portal/generate-env.sh /docker-entrypoint.d/40-generate-env.sh
RUN chmod +x /docker-entrypoint.d/40-generate-env.sh

USER 101
EXPOSE 8080
