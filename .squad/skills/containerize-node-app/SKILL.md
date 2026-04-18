# Skill: Containerize Node.js App for Kubernetes

## When to Use

Use this skill when containerizing a Node.js application for production Kubernetes deployment with health probes and same-origin serving.

## Pattern

### 1. Multi-Stage Dockerfile

```dockerfile
# Stage 1: Base with package.json files
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
COPY apps/*/package*.json ./apps/*/

# Stage 2: Install production dependencies
FROM base AS deps
RUN npm ci --omit=dev

# Stage 3: Install all dependencies for build
FROM base AS build-deps
RUN npm ci

# Stage 4: Build application
FROM build-deps AS build
COPY . ./
RUN npm run build --workspaces

# Stage 5: Runtime image
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/*/dist ./apps/*/dist
COPY --from=build /app/apps/*/package.json ./apps/*/
COPY package.json ./

RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

### 2. Health Endpoints

**Liveness Probe** (`/healthz`):
```typescript
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'my-app' })
})
```

**Readiness Probe** (`/readyz`):
```typescript
app.get('/readyz', (_req, res) => {
  try {
    // Check database or critical dependency
    database.ping()
    res.json({ status: 'ok', service: 'my-app' })
  } catch {
    res.status(503).json({ error: 'Service unavailable' })
  }
})
```

### 3. Graceful Shutdown

```typescript
function shutdown(exitCode: number) {
  database.close()
  process.exit(exitCode)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
```

### 4. Same-Origin Web Serving (Optional)

For SPA + API same-origin deployments:

```typescript
if (process.env.SERVE_WEB === 'true') {
  const webDistPath = join(__dirname, '..', '..', 'web', 'dist')
  
  app.use(express.static(webDistPath))
  
  // SPA fallback - skip API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/health') || 
        req.path.startsWith('/readyz')) {
      next()
    } else {
      res.sendFile(join(webDistPath, 'index.html'))
    }
  })
}
```

**Note:** Express 5's path-to-regexp breaks `app.get('*')` wildcard. Use middleware instead.

### 5. .dockerignore

```
node_modules
npm-debug.log
.git
.gitignore
.env
.env.*
*.md
!README.md
apps/*/dist
apps/*/node_modules
apps/*/data
.husky
.squad
.copilot*
docker/
scripts/
.github/
*.test.ts
*.test.tsx
test/
```

### 6. Runtime Documentation (RUNTIME.md)

Always document:
- Required and optional environment variables
- Default values
- Health endpoint behavior and Kubernetes probe config
- Persistent storage requirements
- Graceful shutdown behavior
- Security posture (user, permissions, exposed ports)

## Kubernetes Manifests

### Deployment (excerpt)

```yaml
spec:
  containers:
  - name: app
    image: ghcr.io/org/app:latest
    ports:
    - containerPort: 3000
    env:
    - name: SERVE_WEB
      value: "true"
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: app-secrets
          key: database-url
    livenessProbe:
      httpGet:
        path: /healthz
        port: 3000
      initialDelaySeconds: 10
      periodSeconds: 10
      timeoutSeconds: 3
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /readyz
        port: 3000
      initialDelaySeconds: 5
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 2
    terminationGracePeriodSeconds: 30
```

## Health Probe Best Practices

**Liveness:**
- Should only fail if process is stuck or deadlocked
- Never fail on transient errors (database down, external service unavailable)
- Failure triggers pod restart (expensive, disruptive)

**Readiness:**
- Should fail fast when service can't handle traffic
- Check database, critical dependencies
- Failure removes pod from load balancer (graceful)

**Common mistake:** Using the same endpoint for both. They have different semantics.

## Security Checklist

- [ ] Run as non-root user
- [ ] Minimize write-access (only data volumes)
- [ ] Multi-stage build (no dev dependencies in runtime image)
- [ ] No secrets in Dockerfile or image layers
- [ ] .dockerignore excludes .env files
- [ ] Exposed ports documented
- [ ] Base image regularly updated

## Testing

```bash
# Build
docker build -t myapp:test .

# Run
docker run -d -p 3000:3000 --name myapp-test myapp:test

# Validate
curl http://localhost:3000/healthz  # Should return 200
curl http://localhost:3000/readyz   # Should return 200
curl http://localhost:3000/         # Should return web app (if SERVE_WEB=true)

# Cleanup
docker stop myapp-test
docker rm myapp-test
```

## References

- Issue #52: Containerize dnd-notes for K8s deployment
- PR #60: feat(platform): containerize tenant app with K8s health probes
- [Kubernetes Liveness/Readiness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

## Lessons

1. Express 5 path-to-regexp: use middleware for SPA fallback, not `app.get('*')`
2. Health probes are not interchangeable - different semantics, different failure modes
3. Document runtime contract early - saves debugging time in Phase 1+
4. Keep local dev path simple during cloud-native transition (e.g., SQLite fallback)
