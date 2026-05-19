# Spike: scale-to-zero tenants with HTTPS wake-on-request activator

**Issue:** #340
**Date:** 2026-05-19
**Author:** Brand (platform)
**Status:** Spike complete — pending user approval on open questions before PoC.

> Claims verified post-spike against upstream sources: KEDA HTTP add-on architecture
> and install footprint verified against `kedacore/http-add-on` manifests and README
> (<https://github.com/kedacore/http-add-on>). Knative Serving networking requirements
> and activator behavior verified via Context7 against `knative/docs` and
> `knative/serving` (<https://github.com/knative/docs>, <https://github.com/knative/serving>).
> One correction applied: KEDA core ships 3 pods (operator, metrics-apiserver,
> admission-webhooks), not 2 — total combined footprint is ~6 pods, not ~5.

---

## Context

Issue #340 describes a resource waste problem: each tenant in our multi-tenant k3s
deployment on a single Azure VM runs at least one replica continuously, even when
idle. For hobbyist / asymmetric usage patterns (most tenants quiet most of the time)
this wastes CPU and RAM on a fixed-size node.

The goal is: a tenant idle for N minutes scales to zero replicas; the next HTTPS
request to `{tenant}.notes.daydreamsoftware.ca` wakes it transparently — latency
visible but no error surfaced to the user.

Far-future scope: 1..N horizontal scaling once awake (standard HPA on CPU/RPS). Not
designed here, but the activator pick must not block that path.

---

## Comparison matrix

Three approaches were evaluated. Scoring legend: + = advantage, ~ = neutral, - = disadvantage.

### Criteria

| Criterion | Weight rationale |
|---|---|
| Install footprint on k3s + Traefik | We already run a single-node k3s with Traefik; operators we can't install without heavyweight changes are non-starters |
| Operational complexity | Single VM, small ops team; anything with a multi-component control loop needs to earn its keep |
| Cold-start budget | Issue target: < 10 s; activator must buffer the first request, not reject it |
| Observability hooks | Prometheus metrics or equivalent — existing stack unknown but we need at least request queue depth |
| Fit with existing control-plane | Provisioning is done via `kubernetes-client` (Node); the control-plane writes `Deployment` objects — changes here are bounded |
| Future 1..N HPA path | Must not require a control-plane rewrite to add HPA later |

---

### Option A — KEDA HTTP add-on

KEDA (Kubernetes Event-Driven Autoscaling) is a CNCF project that extends the
Kubernetes HPA using custom metrics. The HTTP add-on is a separate sub-project
(`kedacore/http-add-on` / `kedify/http-add-on`) that implements HTTP-triggered
scale-from-zero specifically.

**How it works.**
An `HTTPScaledObject` CRD is created per tenant, referencing the tenant's Deployment
and Service. A cluster-level interceptor proxy (one Deployment) captures HTTP
traffic forwarded to it and enqueues requests while scaling happens; a per-`HTTPScaledObject`
external-scaler watches the queue depth and signals KEDA core to scale the target
Deployment. When replicas reach 1 and the readiness probe passes, the interceptor
forwards the buffered request.

Traffic routing with Traefik: the tenant Ingress must point to the KEDA interceptor
Service (not the tenant Service directly). When awake the interceptor forwards to the
tenant; when asleep it holds the connection. There is no native Traefik middleware for
this; the Ingress backend change is the main integration cost.

**Install footprint.**
KEDA core: three pods (operator, metrics-apiserver, admission-webhooks). KEDA HTTP
add-on: three components (interceptor, scaler, operator). Total: ~6 pods of modest
size. No service mesh required. No Istio, no Kourier.

**Scores:**

| Criterion | Score | Notes |
|---|---|---|
| Install footprint | + | ~6 pods, no service mesh; fits on a single node |
| Operational complexity | ~ | CRD-per-tenant is manageable; interceptor is new data path |
| Cold-start budget | + | Interceptor holds connection; request is queued, not rejected |
| Observability | + | KEDA exposes Prometheus metrics; queue depth per `HTTPScaledObject` |
| Fit with control-plane | ~ | Provisioning must also create/delete `HTTPScaledObject`; Ingress backend points to interceptor |
| Future 1..N path | + | KEDA core IS the HPA bridge — `ScaledObject` wraps HPA natively; adding CPU/RPS triggers later is additive, not a replacement |

---

### Option B — Knative Serving

Knative Serving is a complete serverless runtime built on Kubernetes. It manages
Deployments, Revisions, Routes, and a dedicated autoscaler (KPA — Knative Pod
Autoscaler) that replaces the standard HPA.

**How it works.**
Each workload becomes a Knative `Service` with a `Revision`. An ingress gateway
(Istio or Kourier) intercepts all traffic; the activator component buffers requests
when replicas are zero and forwards once warm. The KPA autoscaler scales based on
concurrent requests (not CPU/memory).

**Install footprint.**
Knative Serving core requires ~8 pods. In addition it requires a supported network
layer: Istio (large, ~15 pods, full service mesh) or Kourier (lighter, ~2 pods, but
Traefik must be replaced or bypassed). Integration with our existing Traefik + cert-
manager + wildcard TLS setup is non-trivial; Knative expects to own the ingress layer.

**Scores:**

| Criterion | Score | Notes |
|---|---|---|
| Install footprint | - | 10–25 pods depending on network layer; service mesh or Kourier replaces Traefik |
| Operational complexity | - | Two autoscaler systems (KPA replaces HPA); Knative owns revision lifecycle; major new operational surface |
| Cold-start budget | + | Activator buffers requests with good implementation maturity |
| Observability | + | Rich built-in metrics; request concurrency visible |
| Fit with control-plane | - | Provisioning would create `ksvc` instead of `Deployment`; large rewrite surface in `provisioning.ts` |
| Future 1..N path | ~ | KPA does it but differently — concurrent-request-based, not CPU/RPS; HPA class is switchable per-revision (annotation `autoscaling.knative.dev/class: hpa.autoscaling.knative.dev`) but is a per-revision choice, not additive alongside KPA; path is not blocked but requires a mental model shift |

---

### Option C — Home-grown shim

A small custom controller watches tenant activity (no requests for N minutes → scale
to zero); a thin proxy (nginx or a Node HTTP proxy) in front of each tenant ingress
receives the wake request, patches the Deployment to `replicas: 1` via the kube API,
polls for readiness, then forwards.

**How it works.**
The control-plane (Node) already has a `kubernetes-client` dependency and patches
Deployments. The idle detector could be a new loop in the existing control-plane
process or a separate small controller. The wake proxy would be a per-cluster
sidecar.

**Scores:**

| Criterion | Score | Notes |
|---|---|---|
| Install footprint | + | No new operators; ~1–2 extra pods |
| Operational complexity | - | We reinvent request buffering, timeout handling, queue depth tracking, backpressure — all solved problems in KEDA |
| Cold-start budget | ~ | Achievable but requires careful implementation: connection hold, timeout, retry |
| Observability | - | We build it from scratch; no standard Prometheus exposition |
| Fit with control-plane | + | No new CRDs; the control-plane already writes Deployments |
| Future 1..N path | - | HPA addition requires bolting a separate system onto a bespoke wake layer; risk of interaction bugs |

---

## Recommendation

**Pick: KEDA HTTP add-on.**

KEDA's HTTP add-on is the only option that simultaneously (1) does not require
replacing or bypassing the Traefik ingress, (2) buffers the first wake request
without rejecting it, and (3) keeps the 1..N HPA path as a clean additive step
(`ScaledObject` wraps HPA natively). The install footprint (~6 pods, no service mesh)
is proportionate to a single-node k3s install and the operational burden is bounded:
one CRD per tenant (`HTTPScaledObject`) and one cluster-level interceptor.

The primary integration cost is that each tenant Ingress must route to the KEDA
interceptor Service instead of the tenant Service directly. This is a one-line change
per Ingress backend, but it means `provisioning.ts` must create the `HTTPScaledObject`
in addition to the existing Deployment/Ingress/Service bundle, and tear it down at
deprovision time. That is bounded, auditable work.

Runner-up: **home-grown**, specifically if we decide the control-plane's existing
`kubernetes-client` footprint and the small tenant count make a bespoke implementation
cheaper than operating KEDA. The condition for switching: if KEDA HTTP add-on turns
out to have a poor Traefik integration story at PoC time (e.g. the interceptor
requires nginx-ingress-controller annotations that Traefik does not honor), home-grown
is the fallback. Knative is ruled out for this install — replacing Traefik is not
justified for our scale.

---

## Proposed defaults on open questions

### OQ-1 — Idle threshold before scale-to-zero

**Proposed default: 30 minutes.**

Rationale: 15 minutes is aggressive for a notes app where users may leave a tab open
without actively making requests. 1 hour keeps the pod alive long after a user has
clearly left. 30 minutes is the common default in comparable serverless platforms and
aligns with a "session is over" intuition without wasting resources overnight.

**Needs user approval before PoC.**

---

### OQ-2 — Cold-start UX strategy

**Proposed default:** the tenant Ingress / activator holds the TCP connection open
while waiting for readiness (KEDA interceptor behavior). The tenant SPA itself
therefore experiences a delayed first response (the page load request hangs for up to
the cold-start budget) rather than a 503. No special hold-page is needed for the
first wake of a browser tab — the browser's native loading spinner covers the gap.

For subsequent API calls from an already-loaded SPA to a just-woken tenant, the
interceptor's queue ensures they succeed. If the user navigates directly to the tenant
subdomain from a bookmark or link, the cold-start wait happens during HTML load — the
browser renders nothing during that window, which is acceptable given the target
budget of < 10 s.

Client-side timeout shape: the SPA should not set a fetch timeout shorter than 15 s
on the initial page load request (or on any request made within the first 30 s after a
page load to a tenant that was recently unreachable). This avoids a race where the SPA
times out the request before the interceptor has finished waking the pod.

**Needs user approval before PoC.**

---

### OQ-3 — Resource-pressure path

The scenario: the node is saturated (no schedulable CPU/RAM) when the wake request
arrives. The new tenant pod is `Pending` indefinitely. The KEDA interceptor holds the
connection but has no information about why the pod is not becoming ready.

**Proposed default:**

1. The interceptor holds the connection for a configurable `requestTimeout` (proposed:
   60 s — see below). During this window the user sees a browser loading spinner with
   no feedback.

2. At the 15 s mark the SPA should detect the hang (the initial request is still open)
   and inject a client-side overlay: "Waking your workspace..." with a progress
   indicator. This is a frontend change in `apps/api` or the tenant SPA entry point,
   not an activator change.

3. At the 30 s mark the overlay message switches to: "Still warming up — the server
   is busy, this can take a bit longer than usual."

4. At 60 s (the hard upper bound) the interceptor times out and returns a 503-class
   response. The SPA catches this and renders a retryable error: "Your workspace
   is taking longer than expected to start. Try again in a moment." A retry button
   re-triggers the wake cycle.

5. What the activator detects: KEDA HTTP add-on does not natively distinguish
   `Pending` (node full) from `ContainerCreating` (image pull or init delay). The
   control-plane should poll `kubectl get pod -n <tenant-ns>` periodically and report
   `pod_schedule_deadline_exceeded` on any tenant pod stuck in `Pending` for > 30 s.
   This is a monitoring/alerting concern for the PoC, not a blocker.

**Hard upper bound: 60 s.** After 60 s the interceptor must not silently keep holding
connections. This surfaces the failure rather than starving the Traefik connection pool.

**Needs user approval before PoC.**

---

### OQ-4 — PVC interaction

**Confirmed non-issue.** Tenant workloads carry no PersistentVolumeClaims. The
provisioning bundle in `apps/control-plane/src/provisioning.ts` hardcodes
`pvcName: null` (line 1543) and the generated Deployment spec contains no
`volumes` or `volumeMounts` entries. All persistent tenant state lives in the shared
platform Postgres instance (`postgres.yaml`), which is not touched by pod scaling.
Scaling a tenant to zero replicas does not affect its database.

---

### OQ-5 — Backup cron interaction

**Confirmed non-issue.** The backup scheduler (`apps/control-plane/src/backup-scheduler.ts`)
runs inside the control-plane process. It iterates over `ready` tenants and calls
`tenantBackupDispatcher.executeBackup()`, which calls `pg_dump` via
`buildTenantDatabaseConnectionString(this.adminDatabaseUrl, databaseName)` —
connecting directly to the tenant's Postgres database using the platform admin
credential (see `apps/control-plane/src/tenant-backup-runner.ts`). The backup never
touches the tenant pod; it connects directly to Postgres. A tenant scaled to zero
replicas is fully backed up on the normal schedule.

One nuance: the scheduler filters to `t.currentState === 'ready'`. If a scale-to-zero
event changes the tenant's recorded `currentState` from `ready` to something like
`sleeping`, the scheduler would skip it. The PoC must confirm that the tenant's
`currentState` in the registry remains `ready` while at zero replicas. This is a
control-plane contract decision, not a backup architecture change.

---

## Integration plan

The following is a file/service-level map of required changes. No code is written here.

### New cluster operators (KEDA)

- **KEDA core** — `ScaledObject`, `ScaledJob`, `TriggerAuthentication` CRDs, KEDA
  operator and metrics-adapter Deployments. Installed once per cluster, not per
  tenant. Kustomize base in `deploy/k3s/base/keda/` (new directory).

- **KEDA HTTP add-on** — `HTTPScaledObject` CRD, HTTP interceptor Deployment, HTTP
  scaler Deployment. Installed once per cluster. Same base directory.

### Control-plane changes

- **`apps/control-plane/src/provisioning.ts`** — `buildTenantResourceBundle()` gains
  an `HTTPScaledObject` entry alongside the existing Deployment/Service/Ingress
  bundle. The Ingress backend shifts from the tenant Service to the KEDA interceptor
  Service (with a routing label or header to identify the target). Deprovision path
  must delete the `HTTPScaledObject`.

- **`apps/control-plane/src/tenant-registry.ts` / `types.ts`** — a new tenant state
  may be needed: `sleeping` (0 replicas, healthy) distinct from `ready` (>= 1 replica,
  serving). This has implications for the backup filter described in OQ-5 above.

- **`apps/control-plane/src/app.ts`** — any admin endpoint that returns tenant status
  must surface the `sleeping` state to the operator portal.

- **`apps/operator-portal/`** — fleet status UI would show "sleeping" tenants; a
  manual "wake" action may be desirable but is not required for the PoC.

### Observability

The existing observability stack is not documented in this repo. At minimum the PoC
should confirm that KEDA's Prometheus endpoint is scraped and that the following
metrics are visible:

- `keda_http_interceptor_request_count` — requests queued per `HTTPScaledObject`
- `keda_scaler_active` — whether the scaler considers the workload active
- Pod-level `kube_deployment_status_replicas` — to track scale events

No changes to `deploy/k3s/` for observability are scoped in this spike; the PoC
phase will wire this up.

### Deploy manifests

- New `deploy/k3s/base/keda/kustomization.yaml` — KEDA core and HTTP add-on install
  (vendored manifests, SHA-pinned image refs per CI policy).
- `deploy/k3s/base/kustomization.yaml` — add `keda/` to the resources list.
- No changes to existing tenant namespaces; `HTTPScaledObject` resources live in the
  tenant namespace alongside the Deployment.

---

## Risks and non-goals

### Cold-start UX failure modes

- **Interceptor holds too long:** if the interceptor's request timeout is set higher
  than what browsers tolerate (typically 2 minutes for a fetch), the browser may abort
  before the pod is ready. Set the timeout below 90 s and match the client-side hard
  abort to the same value.
- **First-request tail latency:** the interceptor must wait for `ReadinessProbe` to
  pass. If the probe is too lenient (large `initialDelaySeconds`), the cold-start
  budget blows up. The tenant Deployment's readiness probe must be validated during
  the PoC for tight configuration.
- **Multiple simultaneous wake requests:** when 0 → 1 is in progress, the interceptor
  queues concurrent requests. KEDA HTTP add-on is designed for this; validate under
  concurrent tab opens during PoC.

### Activator failure modes

- **Interceptor pod restart:** the KEDA HTTP interceptor is a new data-path component.
  If it restarts while serving a request queue, queued requests are lost. KEDA HTTP
  add-on configures the interceptor with a Deployment (restartable) but not a
  StatefulSet — there is no in-flight queue persistence. In practice: if the
  interceptor restarts, the browser sees a connection reset and retries. Confirm
  interceptor restart behavior (timeout vs reset) during PoC.
- **KEDA operator down:** if the KEDA operator pod is unavailable, existing
  `HTTPScaledObject` resources stop being reconciled. Tenants that were at 1 replica
  stay at 1 replica; tenants already at 0 stay at 0. Traffic to awake tenants passes
  through the interceptor and is unaffected. Traffic to sleeping tenants hangs at the
  interceptor with no scaler to wake the pod. This is a single-point failure for
  sleeping tenants.
- **Mitigation:** the KEDA operator should have a `PodDisruptionBudget` and a liveness
  probe restart policy. On a single-node cluster the HA options are limited;
  document as a known risk.

### TLS termination at Traefik

Traefik currently terminates TLS using a Let's Encrypt wildcard certificate for
`*.notes.daydreamsoftware.ca` (cert-manager DNS-01, `deploy/k3s/base/cert-manager/certificate.yaml`).
The KEDA interceptor receives plain HTTP after Traefik terminates TLS — this is the
existing pattern for all tenant Ingresses (`TENANT_PUBLIC_SCHEME: https`,
`X-Forwarded-Proto: https` from Traefik). No change to the TLS termination model is
required. The interceptor operates at the HTTP layer inside the cluster; the external
TLS session is fully handled by Traefik before the request reaches the interceptor.

### Traefik interceptor routing

The KEDA HTTP add-on requires the Ingress backend to point to the interceptor Service.
The interceptor uses the `Host` header to route to the correct `HTTPScaledObject`.
Traefik preserves `Host` on backend forwarding; this should work without additional
configuration but must be validated during PoC. If Traefik rewrites `Host`, the
interceptor cannot dispatch to the correct tenant and will return errors.

### Non-goals

- HPA (1..N) configuration — out of scope for this PoC.
- Multi-node autoscaling (cluster autoprovisioner) — out of scope; single VM.
- Per-tenant custom idle thresholds — a future enhancement; one global threshold for
  the PoC.
- Knative migration — explicitly ruled out; not a fallback path.
- Scale-to-zero for the control-plane, Keycloak, or Postgres — not applicable.

---

## Far-future compatibility: 1..N HPA

KEDA's design makes the 1..N transition additive. Today's `HTTPScaledObject` defines
`minReplicaCount: 0` and `maxReplicaCount: 1`. To enable 1..N scaling, the operator
would update `maxReplicaCount` and optionally add a second `ScaledObject` for CPU/RPS
metrics using KEDA's standard HPA bridge. KEDA core wraps the Kubernetes HPA
internally; the HPA object is created and managed by KEDA, not by the control-plane.
This means no new operator is required for the 1..N path — only a change to the
`HTTPScaledObject` spec and the addition of a CPU or custom-metrics `ScaledObject`.

The one decision that could constrain the HPA path: if the control-plane's provisioning
code builds `HTTPScaledObject` manifests with `maxReplicaCount` hardcoded at 1, changing
it later will require a control-plane change. Write `maxReplicaCount` as a configurable
parameter from the start (tenant config or env var) even if the PoC only exercises
0 → 1.

---

## Referenced files

- `apps/control-plane/src/provisioning.ts` — tenant resource bundle; Ingress/Deployment builder
- `apps/control-plane/src/backup-scheduler.ts` — nightly backup cron; runs in control-plane process
- `apps/control-plane/src/tenant-backup-runner.ts` — `pg_dump` via admin Postgres credential; no tenant pod interaction
- `apps/control-plane/src/types.ts` — `Tenant` type; `currentState` field relevant to OQ-5
- `deploy/k3s/base/cert-manager/certificate.yaml` — wildcard TLS certificate; Traefik terminates TLS
- `deploy/k3s/overlays/prod/configmap-control-plane.yaml` — `TENANT_INGRESS_CLASS_NAME: traefik`
- `deploy/k3s/base/customer-portal/ingress.yaml` — ingress pattern reference (`ingressClassName: traefik`)
