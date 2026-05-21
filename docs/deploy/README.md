# Deploy runbook — Azure VM + k3s test release

Target infrastructure: Azure D4ads_v7 (4 vCPU AMD / 16 GB / Premium SSD P10 128 GB), East US.
Domain: `daydreamsoftware.ca` (Cloudflare DNS).
Manifests: `deploy/k3s/` (PR #335). Backup runner: PR #334. GHCR push workflow: PR #331.
Prod-deploy workflow: `.github/workflows/prod-deploy.yml` (issue #374).

This document is the sole reference for bootstrapping, deploying, and operating the D&D Notes stack
on the test-release VM. Any future operator should be able to follow it end-to-end after a long gap,
without external input.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial VM bootstrap (one-time)](#2-initial-vm-bootstrap-one-time)
3. [Secrets setup (before first deploy)](#3-secrets-setup-before-first-deploy)
4. [Pre-deploy: promote and pin image tags](#4-pre-deploy-promote-and-pin-image-tags)
5. [First deploy](#5-first-deploy)
   - 5a. Apply (initial manual deploy)
   - 5b. [GitHub Actions workflow (routine deploys)](#5b-github-actions-workflow-routine-deploys)
6. [GHCR package linking (one-time, post-first-push)](#6-ghcr-package-linking-one-time-post-first-push)
7. [Daily ops](#7-daily-ops)
8. [Backups](#8-backups)
9. [Failure modes](#9-failure-modes)
10. [Test release scope reminders](#10-test-release-scope-reminders)
11. [Scale-to-zero operator notes](#11-scale-to-zero-operator-notes)
12. [Changelog](#changelog)

---

## 1. Prerequisites

### VM

Already provisioned:

- **Size**: Azure D4ads_v7 (4 vCPU AMD, 16 GB RAM, Premium SSD P10 128 GB)
- **Region**: East US
- **Public IP**: `20.236.199.204`
- **NSG ports open**: 80, 443, 6443
- **k3s installed** with `--tls-san 20.236.199.204` flag
- **Kubeconfig merged** as context `dnd-notes-prod` in `~/.kube/config`

### Domain and DNS

Already configured:

- **Registrar and DNS**: Cloudflare, zone `daydreamsoftware.ca`
- **DNS records** (grey-cloud / DNS-only, not proxied):
  - `notes.daydreamsoftware.ca` A → `20.236.199.204`
  - `*.notes.daydreamsoftware.ca` A → `20.236.199.204`
  - `auth.daydreamsoftware.ca` A → `20.236.199.204`
  - `operator.daydreamsoftware.ca` A → `20.236.199.204`
- **Apex**: `daydreamsoftware.ca` proxied (orange-cloud) with a Cloudflare Page Rule redirecting to `github.com/daydream-software`
- **Cloudflare API token**: scoped to `Zone:DNS:Edit` on `daydreamsoftware.ca` — required for cert-manager DNS-01 challenge

### Azure Storage

Already provisioned:

- Storage account (note your account name)
- Blob container: `tenant-backups`

### GitHub Actions runner (one-time)

The `prod-deploy.yml` workflow runs on a self-hosted runner tagged `[self-hosted, prod]`. The
runner must be installed and started on the prod VM before the first workflow trigger.

On the VM, as `azureuser`:

```bash
# 1. Create the runner directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# 2. Download and configure the runner (replace <TOKEN> with the registration
#    token from repo Settings → Actions → Runners → New self-hosted runner)
curl -o actions-runner-linux-x64-2.324.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.324.0/actions-runner-linux-x64-2.324.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.324.0.tar.gz

./config.sh \
  --url https://github.com/daydream-software/dnd-notes \
  --token <TOKEN> \
  --labels prod \
  --name prod-vm

# 3. Install and start as a systemd service
sudo ./svc.sh install
sudo ./svc.sh start
```

The runner user must have `kubectl`, `kustomize` v5+, and `docker` (with `buildx`) in PATH.

Runner kubeconfig: k3s installs `/etc/rancher/k3s/k3s.yaml` with context `default` on the VM.
The runner user must have read access to that file. The workflow uses `--context dnd-notes-prod`,
so the runner user's `~/.kube/config` must have that context wired to `https://127.0.0.1:6443`.
Simplest setup (as `azureuser`):

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
chmod 600 ~/.kube/config
sed -i 's/name: default/name: dnd-notes-prod/g'    ~/.kube/config
sed -i 's/cluster: default/cluster: dnd-notes-prod/g' ~/.kube/config
sed -i 's/user: default/user: dnd-notes-prod/g'    ~/.kube/config
sed -i 's/current-context: default/current-context: dnd-notes-prod/g' ~/.kube/config
# Verify:
kubectl --context dnd-notes-prod get nodes
```

### GitHub Environment (one-time)

The workflow enforces the `production` GitHub Environment with required reviewers. Configure it
before the first trigger:

1. Go to repo **Settings → Environments → New environment** → name: `production`.
2. Under **Environment protection rules**, enable **Required reviewers** and add the maintainer(s).
3. Optionally set a deployment branch filter to `main` only.

Without this, the workflow runs without a review gate.

### Local tooling

Required on the operator's machine:

- **Linux or WSL** — section 2c uses GNU `sed -i` syntax. macOS BSD `sed` requires `sed -i ''` instead; operators on macOS should either prefix `gsed` (from `brew install gnu-sed`) or adapt each `sed -i` invocation.
- `kubectl` (any recent version)
- `kustomize` v5+ — required. `kubectl kustomize` provides the `kubectl kustomize` render path but
  does **not** include the `kustomize edit` subcommand used in Sections 4 and 7. If you only have
  `kubectl`, use the `sed` alternative documented in those sections.
- `gh` CLI (for working with GHCR tags)
- `az` CLI (for VM start/stop and storage operations)

> ⚠️ **Always pass `--context dnd-notes-prod` on every cluster-targeting `kubectl` command in this runbook.** If you
> have both `dnd-notes-prod` and a local `k3d-*` context in your merged kubeconfig, omitting the
> flag silently targets your default context. The runbook examples already include the flag — keep
> it. Alternatively, run `kubectl config use-context dnd-notes-prod` at the start of each deploy or
> ops session to make it the active default.

---

## 2. Initial VM bootstrap (one-time)

Estimated time: ~15 min.

This section assumes the VM is provisioned and the operator has SSH access as `azureuser`.

### 2a. Open ports on the Azure NSG

If not already done via the portal, use the CLI. Replace `<resource-group>` and `<vm-name>` with real values:

```bash
az vm open-port --resource-group <resource-group> --name <vm-name> --port 80 --priority 100
az vm open-port --resource-group <resource-group> --name <vm-name> --port 443 --priority 101
az vm open-port --resource-group <resource-group> --name <vm-name> --port 6443 --priority 102
```

Ports 80, 443, and 6443 are already open on this VM. This step is recorded here for reprovisioning.

### 2b. Install k3s on the VM

SSH into the VM:

```bash
ssh azureuser@20.236.199.204
```

Install k3s with the public IP in the TLS SAN so the remote kubeconfig works:

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --tls-san 20.236.199.204
```

k3s is already installed on this VM. This command is recorded here for reprovisioning.

Verify the node is ready on the VM:

```bash
sudo kubectl get nodes
```

### 2c. Fetch the kubeconfig and merge it locally

On the VM, print the kubeconfig:

```bash
sudo cat /etc/rancher/k3s/k3s.yaml
```

Copy the output to your local machine. Replace the `server:` line so it points at the public IP instead of localhost, then rename the context to `dnd-notes-prod`:

```bash
# On local machine — save to a temp file first
scp azureuser@20.236.199.204:/etc/rancher/k3s/k3s.yaml /tmp/k3s-prod.yaml

# Rewrite the server address and context name
sed -i 's|https://127.0.0.1:6443|https://20.236.199.204:6443|g' /tmp/k3s-prod.yaml
sed -i 's/name: default/name: dnd-notes-prod/g' /tmp/k3s-prod.yaml
sed -i 's/cluster: default/cluster: dnd-notes-prod/g' /tmp/k3s-prod.yaml
sed -i 's/user: default/user: dnd-notes-prod/g' /tmp/k3s-prod.yaml
sed -i 's/current-context: default/current-context: dnd-notes-prod/g' /tmp/k3s-prod.yaml

# Merge into ~/.kube/config
KUBECONFIG=~/.kube/config:/tmp/k3s-prod.yaml kubectl config view --flatten > /tmp/merged.yaml
mv /tmp/merged.yaml ~/.kube/config
chmod 600 ~/.kube/config
rm /tmp/k3s-prod.yaml
```

Verify the context is available:

```bash
kubectl --context dnd-notes-prod get nodes
```

This context is already merged on this machine as `dnd-notes-prod`.

> ⚠️ **Multiple contexts in one kubeconfig.** Once merged, both `dnd-notes-prod` and any local
> `k3d-*` contexts coexist. Forgetting `--context dnd-notes-prod` on a `kubectl` command targets
> whichever context is currently the default. See the tooling note in Section 1 for the `use-context`
> shortcut.

### 2d. Install cert-manager

Install cert-manager v1.16.3 (the version validated with this stack):

```bash
kubectl --context dnd-notes-prod apply \
  -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.3/cert-manager.yaml
```

Wait for the webhook to be ready (~2 min):

```bash
kubectl --context dnd-notes-prod wait \
  --for=condition=Available deployment --all \
  -n cert-manager \
  --timeout=120s
```

### 2e. Create the Cloudflare API token secret

cert-manager uses this secret to perform DNS-01 challenges for Let's Encrypt:

```bash
kubectl --context dnd-notes-prod create secret generic cloudflare-api-token \
  -n cert-manager \
  --from-literal=api-token='<your-cloudflare-dns-edit-token>' \
  --dry-run=client -o yaml \
  | kubectl --context dnd-notes-prod apply -f -
```

The token must have `Zone:DNS:Edit` scope on `daydreamsoftware.ca` only.

### 2f. Apply the ClusterIssuer and Certificate

The ClusterIssuer and wildcard Certificate are included in the base manifests:

```bash
kubectl --context dnd-notes-prod apply \
  -f deploy/k3s/base/cert-manager/cluster-issuer.yaml \
  -f deploy/k3s/base/cert-manager/certificate.yaml
```

The certificate covers `*.daydreamsoftware.ca` and `*.notes.daydreamsoftware.ca` via a single DNS-01 wildcard. It is issued into the `dnd-notes-platform` namespace so all ingress resources can reference it.

---

## 3. Secrets setup (before first deploy)

Estimated time: ~10 min.

All secrets must exist in the cluster before applying the kustomization. The control-plane pod will not start until its secret is present. Keycloak and Postgres will not start without theirs.

### Provision everything with the shared script (recommended)

`scripts/platform/provision-secrets.sh` is the single, mode-aware provisioner used for **both** local k3d and prod (epic #362). It creates every platform Secret idempotently (`kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -`) and never echoes secret values. In `--mode prod` it has **no defaults for real secrets** — it fails loudly listing any unset required variable, so a half-blank Secret can never reach the cluster.

Export the real values (from a secured source — a sourced env file, your secrets manager, etc.), then run the script once. Use `--context dnd-notes-prod` so the script targets the prod cluster without mutating your current kube-context:

```bash
# Export real values from a secured source. Do NOT paste secrets into shell
# history; prefer `set -a; source /path/to/secured.env; set +a`.
export PLATFORM_POSTGRES_USER=postgres
export PLATFORM_POSTGRES_PASSWORD='<strong-random-password>'
export PLATFORM_POSTGRES_DB=keycloak
export KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME=admin
export KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD='<strong-random-password>'
export CONTROL_PLANE_DATABASE_URL='postgresql://postgres:<password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/control_plane'
export TENANT_DATABASE_ADMIN_URL='postgresql://postgres:<password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres'
export TENANT_DATABASE_RUNTIME_URL='postgresql://postgres:<password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres'
# Activator DB URL (#363). Defaults to CONTROL_PLANE_DATABASE_URL when the
# activator shares the control-plane registry DB, so this export is optional:
export ACTIVATOR_CONTROL_PLANE_DATABASE_URL="$CONTROL_PLANE_DATABASE_URL"

# KEYCLOAK_ADMIN_CLIENT_ID/_SECRET are optional here: the secret is auto-generated
# by Keycloak on first realm import and is unknown before the first deploy. Leave
# them unset now and patch the value in after deploy (Section 5e), or export a
# placeholder you will overwrite.

scripts/platform/provision-secrets.sh --mode prod --context dnd-notes-prod
```

This creates `platform-postgres-credentials`, `keycloak-bootstrap-env`, `dnd-notes-control-plane-secrets`, and `dnd-notes-activator-secrets` in one pass. The `keycloak-realm-dev-secrets` Secret is k3d-only (it feeds the local realm seed's `${REALM_DEV_*}` placeholders) and is never created in prod — the prod realm seed carries no committed secrets.

The script does not create the namespace, the Cloudflare token, the backup config, or the GHCR pull secret — handle those separately (3a, 2e, 3e, prerequisite #8). After the script runs, skip to Section 4.

> The per-secret subsections below (3b–3e) document the same Secrets created by hand with `--from-env-file`. Use them only if you need to create or rotate a single Secret without running the full script.

### 3a. Create the namespace

The prod overlay targets `dnd-notes-platform`. Create it if it does not already exist:

```bash
kubectl --context dnd-notes-prod create namespace dnd-notes-platform --dry-run=client -o yaml \
  | kubectl --context dnd-notes-prod apply -f -
```

### 3b. Postgres credentials

Write a temporary env file, create the secret, then delete the file:

Run the block as one paste — the subshell scopes `umask 077`, the `mktemp` file, and the `trap` cleanup so the plaintext env file never lingers on disk:

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=keycloak
EOF

  kubectl --context dnd-notes-prod create secret generic platform-postgres-credentials \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

`POSTGRES_DB=keycloak` is the database Postgres initialises on first start. The control-plane and tenant databases are created separately after the pod is running (see Section 5d).

### 3c. Keycloak bootstrap admin

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<strong-random-password>
EOF

  kubectl --context dnd-notes-prod create secret generic keycloak-bootstrap-env \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

### 3d. Control-plane secrets

The `KEYCLOAK_ADMIN_CLIENT_SECRET` is auto-generated by Keycloak on first realm import and is not known before the first deploy. Set a placeholder here and update it after the first deploy (Section 5e):

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
CONTROL_PLANE_DATABASE_URL=postgresql://postgres:<postgres-password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/control_plane
TENANT_DATABASE_ADMIN_URL=postgresql://postgres:<postgres-password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres
TENANT_DATABASE_RUNTIME_URL=postgresql://postgres:<postgres-password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres
KEYCLOAK_ADMIN_CLIENT_ID=dnd-notes-keycloak-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=placeholder-update-after-first-deploy
EOF

  kubectl --context dnd-notes-prod create secret generic dnd-notes-control-plane-secrets \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

`CONTROL_PLANE_ADMIN_TOKEN` is intentionally omitted here. The prod overlay uses
`CONTROL_PLANE_AUTH_MODE=keycloak`, which does not use the static admin token. That variable is
only required when running with `CONTROL_PLANE_AUTH_MODE=static` (local dev or test environments).

> ⚠️ **Use `stringData` — never manual `base64` — when patching a Secret by hand.** The
> `--from-env-file` flow above avoids manual encoding entirely. If you ever need to patch a value
> directly (e.g., to update `KEYCLOAK_ADMIN_CLIENT_SECRET`), use `--type=merge` with
> `stringData`:
>
> ```bash
> kubectl --context dnd-notes-prod patch secret dnd-notes-control-plane-secrets \
>   -n dnd-notes-platform \
>   --type merge \
>   -p '{"stringData":{"MY_KEY":"my-value"}}'
> ```
>
> Do not use `echo '<value>' | base64`. That form silently appends a trailing newline to the
> encoded value. The pod receives `<value>\n`, which fails opaque comparisons — for example,
> Keycloak rejects the client secret with `invalid_client_credentials`.

### 3e. Backup config (optional — enables nightly backup)

The control-plane boots without this secret (all backup env vars are `optional: true` in the pod spec). Skip this section on first deploy if you want to defer backup setup to Section 8.

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
BACKUP_DESTINATION=azure-blob
AZURE_STORAGE_ACCOUNT=<your-storage-account-name>
AZURE_STORAGE_CONTAINER=tenant-backups
AZURE_STORAGE_SAS_TOKEN=<your-sas-token>
BACKUP_SCHEDULE_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=14
EOF

  kubectl --context dnd-notes-prod create secret generic dnd-notes-backup-config \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

### 3f. Activator secrets

Required for prod scale-to-zero (#363). The activator wakes idle tenants and reads/writes `tenant_activity` in the control-plane registry database, so it needs `CONTROL_PLANE_DATABASE_URL`. Without this Secret a prod deploy has an activator that cannot boot — historically it was created only for local k3d. The shared script (above) provisions it automatically; the manual equivalent:

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
CONTROL_PLANE_DATABASE_URL=postgresql://postgres:<postgres-password>@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/control_plane
EOF

  kubectl --context dnd-notes-prod create secret generic dnd-notes-activator-secrets \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

This URL is normally the same `control_plane` connection string used by `dnd-notes-control-plane-secrets` (Section 3d).

---

## 4. Pre-deploy: promote and pin image tags

Estimated time: ~5 min.

### Tag convention

Prod images are pinned to **`prod-*` tags** (e.g. `prod-20260521`). These tags are
protected by the tag-aware retention script
(`scripts/platform/cleanup-ghcr-versions.mjs`) and will not be deleted by build
churn — no amount of merges to main can remove the image prod is running. The
`sha-*` tags are for CI builds only; never pin prod directly to a `sha-*` tag.

When more than one promotion lands on the same calendar day, use a time-qualified
form: `prod-YYYYMMDD-HHMMSSz` (UTC) to keep each promotion unique.

The sentinel `prod-pin-before-deploy` is committed in the overlay. Applying the
overlay without substituting a real `prod-*` tag causes an intentional
ImagePullBackOff — a safety net to prevent a silent rollout.

### Five images covered

The prod overlay pins 4 images explicitly. The fifth —
`ghcr.io/daydream-software/dnd-notes` (per-tenant app) — is referenced dynamically
by the control-plane at provisioning time via `TENANT_IMAGE_REPOSITORY` in the
ConfigMap. All 5 must be promoted together using the script below.

| GHCR package | Purpose |
|---|---|
| `dnd-notes` | Per-tenant web + API (referenced from ConfigMap) |
| `dnd-notes-control-plane` | Control plane API |
| `dnd-notes-customer-portal` | Customer portal frontend |
| `dnd-notes-operator-portal` | Operator portal frontend |
| `dnd-notes-activator` | Scale-to-zero wake proxy |

### Step 1 — Find the build to promote

```bash
gh api /repos/daydream-software/dnd-notes/packages/container/dnd-notes-control-plane/versions \
  --jq '.[0].metadata.container.tags[]' \
  | grep '^sha-'
```

This returns the most recently pushed `sha-*` tags. Pick the commit you want to
deploy.

### Step 2 — Promote to a protected prod-* tag

Run the promotion script. It retags all 5 images without rebuilding, and fails
loudly if any source tag is missing:

```bash
COMMIT=sha-abcdef0  # replace with the sha-* tag you chose above

scripts/platform/promote-prod-image.sh "${COMMIT}"
# Creates: prod-YYYYMMDD (today's UTC date)

# To supply an explicit destination tag (e.g. same-day re-promote):
scripts/platform/promote-prod-image.sh "${COMMIT}" prod-20260521-143000z
```

The script requires `docker` with `buildx` and active GHCR credentials
(`docker login ghcr.io` or `GITHUB_TOKEN` in the environment).

### Step 3 — Pin the overlay to the new prod-* tag

```bash
PROD_TAG=prod-20260521  # use the tag the script printed

sed -i "s/newTag: prod-pin-before-deploy/newTag: ${PROD_TAG}/g" \
  deploy/k3s/overlays/prod/kustomization.yaml

# Confirm all four entries updated:
grep newTag deploy/k3s/overlays/prod/kustomization.yaml
```

Commit the change:

```bash
git add deploy/k3s/overlays/prod/kustomization.yaml
git commit -m "chore(deploy): promote images to ${PROD_TAG}"
```

---

## 5. First deploy

Estimated time: ~15 min (plus 1–5 min for DNS-01 cert issuance).

### 5a. Apply the prod overlay

This is the manual path for the initial deploy (before the GitHub Actions runner is registered).
For all subsequent deploys, use the workflow in Section 5b instead.

From the repo root:

```bash
kubectl kustomize deploy/k3s/overlays/prod \
  | kubectl --context dnd-notes-prod apply -f -
```

> Note: the overlay's sentinel tag (`prod-pin-before-deploy`) must be replaced with a real
> `prod-*` tag before this command works — see Section 4. On first deploy this means running
> `promote-prod-image.sh`, pinning the overlay, and committing it manually.

### 5b. GitHub Actions workflow (routine deploys)

`.github/workflows/prod-deploy.yml` is the `k3d:up` equivalent for prod — it promotes the
right images, pins the overlay ephemerally, and waits for rollout. Use it for every deploy
after the initial one.

**End-to-end flow:**

1. Promote the chosen build to a protected tag (operator's machine, GHCR credentials required):

   ```bash
   scripts/platform/promote-prod-image.sh sha-<commit>
   # Prints the created tag, e.g. prod-20260521
   ```

2. Trigger the workflow from the GitHub Actions UI or CLI:

   ```bash
   gh workflow run prod-deploy.yml \
     --field prod_tag=prod-20260521
   ```

   Or from the GitHub UI: **Actions → Deploy to production → Run workflow**.

3. Enter the `prod_tag` value (e.g. `prod-20260521`) and submit. The required-reviewer gate
   fires before the runner picks up the job.

**What the workflow does:**

- Validates tag format (`prod-YYYYMMDD` / `prod-YYYYMMDD-HHMMSSz`).
- Verifies all 5 images exist in GHCR under the supplied tag.
- Applies an ephemeral `kustomize edit set image` in the runner workspace (never committed).
- Guards that the `prod-pin-before-deploy` sentinel does not appear in the rendered output.
- `kubectl apply -k deploy/k3s/overlays/prod --context dnd-notes-prod`.
- Waits for rollout on all four platform Deployments:
  `dnd-notes-control-plane`, `dnd-notes-activator`, `customer-portal`, `operator-portal`.

**Dry-run mode:** set `dry_run: true` to run `kubectl apply --dry-run=server` (server-side
validation only, no cluster mutation, rollout waits skipped). Useful before a first real
trigger to confirm the overlay renders correctly.

**Runner prerequisite:** the self-hosted runner must be installed and online on the prod VM
before the first trigger. See Section 1 "GitHub Actions runner" for setup steps.

### 5c. Watch pods come up

```bash
kubectl --context dnd-notes-prod get pods -n dnd-notes-platform -w
```

Postgres and Keycloak start first (~2 min). The control-plane will enter `CrashLoopBackOff` until
Section 5e (Keycloak client secret patch) is complete — this is expected. Final state after 5e:
all pods `Running`, all containers `Ready`.

### 5d. Create additional databases

> ⚠️ **STOP — required step before the control-plane pod can boot.**
>
> Postgres only auto-creates the one database named in `POSTGRES_DB` (which is `keycloak`). The
> `control_plane` database does **not** exist until you create it manually. If you skip this step,
> the control-plane pod enters `CrashLoopBackOff` immediately with:
>
> ```text
> error: database "control_plane" does not exist
> ```
>
> Wait for the Postgres pod to reach `Running` (Section 5c), then run:
>
> ```bash
> kubectl --context dnd-notes-prod exec -it platform-postgres-0 -n dnd-notes-platform -- \
>   psql -U postgres -c "CREATE DATABASE control_plane;"
> ```
>
> Confirm success: `CREATE DATABASE` is printed with no error.

Tenant databases are created automatically by the control-plane at provisioning time.

### 5e. Retrieve the Keycloak admin client secret (chicken-and-egg step)

Keycloak auto-generates the `dnd-notes-keycloak-admin` client secret on first realm import. The control-plane needs this value but it is not known before the first deploy.

After Keycloak is `Running`, retrieve the secret:

```bash
kubectl --context dnd-notes-prod exec -n dnd-notes-platform deploy/platform-keycloak -- \
  /opt/keycloak/bin/kcadm.sh get clients \
  -r dnd-notes \
  --fields clientId,secret \
  --no-config \
  --server http://localhost:8080 \
  --realm master \
  --user admin \
  --password <KC_BOOTSTRAP_ADMIN_PASSWORD>
```

Look for the entry where `clientId` is `dnd-notes-keycloak-admin`. Copy its `secret` value.

Patch the control-plane secret with the real value:

```bash
kubectl --context dnd-notes-prod patch secret dnd-notes-control-plane-secrets \
  -n dnd-notes-platform \
  --type merge \
  -p "{\"stringData\":{\"KEYCLOAK_ADMIN_CLIENT_SECRET\":\"<retrieved-secret>\"}}"
```

Restart the control-plane deployment so it picks up the updated secret:

```bash
kubectl --context dnd-notes-prod rollout restart deployment/dnd-notes-control-plane \
  -n dnd-notes-platform
```

If `rollout restart` alone does not clear the error (rare race with secret propagation), force-delete
the pod so the scheduler creates a fresh one that reads the updated Secret from scratch:

```bash
kubectl --context dnd-notes-prod delete pod \
  -l app.kubernetes.io/name=dnd-notes-control-plane \
  -n dnd-notes-platform --force --grace-period=0
```

### 5f. Wait for the TLS certificate

The wildcard certificate is issued via DNS-01 against Cloudflare. This takes 1–5 min after Keycloak is ready:

```bash
kubectl --context dnd-notes-prod get certificate \
  -n dnd-notes-platform daydreamsoftware-wildcard -w
```

Wait until `READY=True`. If it stays `False` for more than 5 min, see [Section 9: Cert stuck on Pending](#cert-stuck-on-pending).

### 5g. Smoke test

Open the following URLs in a browser:

- `https://notes.daydreamsoftware.ca` — customer portal
- `https://operator.daydreamsoftware.ca` — operator portal
- `https://auth.daydreamsoftware.ca` — Keycloak login

Provision a test tenant via the operator portal, then open the tenant URL
(`https://<slug>.notes.daydreamsoftware.ca`) and log in.

---

## 6. GHCR package linking (one-time, post-first-push)

> ⚠️ **GHCR packages default to private even on a public repo.** Until you manually flip each
> package to public, pods will fail image pulls with `ImagePullBackOff` / 401 Unauthorized.
>
> For each of the five packages — `dnd-notes`, `dnd-notes-control-plane`,
> `dnd-notes-customer-portal`, `dnd-notes-operator-portal`, `dnd-notes-activator`:
>
> 1. Open `https://github.com/orgs/daydream-software/packages/<package-name>`
> 2. Package settings → Danger zone → **Change visibility → Public** → confirm.
>
> This must be done before the cluster can pull images anonymously. It is a one-time step per
> package (visibility persists across image updates).

Each package must also be linked to the `dnd-notes` repository so GitHub Actions can manage
retention and so the package shows up under the repo's package list. After the first push to main
lands an image set on GHCR:

1. Go to `https://github.com/orgs/daydream-software/packages`
2. For each of the five packages listed above:

   Open the package → Package Settings → "Manage Actions access" → connect to the `dnd-notes` repo.

Once Issue #332 lands, the source link becomes automatic (Dockerfile `LABEL` wires it). The
visibility step (flipping packages to Public) must still be done manually for any newly created
package — GitHub does not propagate repo visibility to packages automatically.

> Note: `dnd-notes-activator` is a new package created by the CI workflow added in PR #375.
> It requires the same visibility flip and repository link as the other four packages. Perform
> these steps the first time the push workflow runs after that PR merges.
>
> **Maintainer note:** adding a new package requires updating three places: (1) the prod overlay
> (`deploy/k3s/overlays/prod/kustomization.yaml` — add an `images:` entry), (2) the CI workflow
> (`.github/workflows/deployment-artifacts.yml` — add build/push and cleanup steps), and (3) this
> runbook (Section 4 "5 images" wording and Section 6 package list).

---

## 7. Daily ops

### Start the VM

```bash
az vm start --resource-group <resource-group> --name <vm-name>
```

Allow ~2 min for k3s to resume and pods to reach Ready.

### Stop the VM (deallocate to halt billing)

```bash
az vm deallocate --resource-group <resource-group> --name <vm-name>
```

Use `deallocate`, not `stop`. The `stop` command stops the OS but keeps the VM allocated in Azure
and continues billing compute. Deallocate releases the compute allocation.

### Auto-shutdown

Configure the Azure VM Auto-shutdown feature to deallocate the VM automatically each night.
In the Azure portal: VM → Auto-shutdown → Enable, set time and timezone, save.
Recommendation: 23:00 local time, manual start when testing resumes.

### Deploy a new image version

The recommended path uses the GitHub Actions workflow (Section 5b). It handles the ephemeral
pin, sentinel guard, apply, and rollout-status automatically.

**Via workflow (recommended):**

1. Find the `sha-*` tag from GHCR for the commit you want to deploy.

   ```bash
   gh api /repos/daydream-software/dnd-notes/packages/container/dnd-notes-control-plane/versions \
     --jq '.[0].metadata.container.tags[]' | grep '^sha-'
   ```

2. Promote all 5 images to a protected `prod-*` tag (no rebuild — retags only):

   ```bash
   scripts/platform/promote-prod-image.sh sha-abcdef0
   # Prints the created prod-* tag, e.g. prod-20260521
   ```

3. Trigger the deploy workflow:

   ```bash
   gh workflow run prod-deploy.yml --field prod_tag=prod-20260521
   ```

   Or from the GitHub UI: **Actions → Deploy to production → Run workflow**.
   The required-reviewer gate fires before the runner picks up the job.

**Manual fallback (no runner / runner offline):**

Follow the full procedure in Section 4. Summary: promote → pin overlay (`sed -i`) → commit →
`kubectl kustomize ... | kubectl --context dnd-notes-prod apply -f -`.

### Roll back to a previous version

Same as deploying — promote an earlier `sha-*` tag to a new `prod-*` tag and re-pin the overlay.
The `prod-*` rollback window is kept at 3 versions per the CI retention policy. The `sha-*` window
is 10 most recent main pushes; rolling back to a `sha-*` directly is not safe because the retention
policy can delete it — always promote to a `prod-*` tag first.

### Restart a deployment

```bash
kubectl --context dnd-notes-prod rollout restart deployment/<name> -n dnd-notes-platform
```

Common names: `dnd-notes-control-plane`, `platform-keycloak`, `customer-portal`, `operator-portal`.

### Pod label convention

All manifests in this repo use the Kubernetes recommended label `app.kubernetes.io/name`, not the
legacy `app=<name>` shorthand. When filtering pods by label, use the full key:

```bash
kubectl --context dnd-notes-prod get pods \
  -n dnd-notes-platform \
  -l app.kubernetes.io/name=dnd-notes-control-plane
```

The legacy form (`-l app=dnd-notes-control-plane`) returns zero results. The label selector in log
and delete commands throughout this runbook uses `app.kubernetes.io/name=`.

### Tail logs

```bash
# By label selector
kubectl --context dnd-notes-prod logs \
  -n dnd-notes-platform \
  -l app.kubernetes.io/name=<service> \
  --tail=100 -f

# Or by pod name
kubectl --context dnd-notes-prod logs -n dnd-notes-platform <pod-name> --tail=100 -f
```

### Update a Secret and force the pod to pick it up

After patching a Secret that a pod consumes via `envFrom`, a `rollout restart` is the standard
path. If you observe that the pod still reads the old value (this can happen under replica-set
races), force-delete the pod so the scheduler creates a completely fresh one:

```bash
kubectl --context dnd-notes-prod delete pod \
  -l app.kubernetes.io/name=<deployment-name> \
  -n dnd-notes-platform --force --grace-period=0
```

Replace `<deployment-name>` with the relevant service, for example `dnd-notes-control-plane`.

---

## 8. Backups

PR #334 adds the backup runner and scheduler to the control-plane.

### Enable backups

If you skipped Section 3e, create the backup config secret now:

```bash
(
  umask 077
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT

  cat > "$ENV_FILE" <<'EOF'
BACKUP_DESTINATION=azure-blob
AZURE_STORAGE_ACCOUNT=<your-storage-account-name>
AZURE_STORAGE_CONTAINER=tenant-backups
AZURE_STORAGE_SAS_TOKEN=<your-sas-token>
BACKUP_SCHEDULE_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=14
EOF

  kubectl --context dnd-notes-prod create secret generic dnd-notes-backup-config \
    -n dnd-notes-platform \
    --from-env-file="$ENV_FILE" \
    --dry-run=client -o yaml \
    | kubectl --context dnd-notes-prod apply -f -
)
```

Then restart the control-plane to pick up the secret:

```bash
kubectl --context dnd-notes-prod rollout restart deployment/dnd-notes-control-plane \
  -n dnd-notes-platform
```

Accepted `BACKUP_DESTINATION` values: `azure-blob` or `disabled`. Any other value causes the pod to
fail at startup with a clear error. The key `azure` (without `-blob`) is not valid.

### Cron and retention

- Default schedule: `0 3 * * *` — 03:00 UTC nightly.
- Only daily schedules are supported. Fields 3–5 (day-of-month, month, day-of-week) must each be `*`.
  A non-wildcard value in those fields causes the pod to fail at startup.
- Default retention: 14 days. Older blobs are deleted after each successful nightly backup for the
  same tenant. The last known backup per tenant is always retained, even if past the retention window.

### Verify the scheduler is running

```bash
kubectl --context dnd-notes-prod logs \
  -n dnd-notes-platform \
  -l app.kubernetes.io/name=dnd-notes-control-plane \
  | grep backup-scheduler
```

Look for: `[backup-scheduler] Next run scheduled at <ISO timestamp>`.

### Verify in the operator portal

After the first successful nightly tick, "Backup missing" warning chips on each tenant card become
"Backup recorded" chips. Refresh the page to see the updated state.

### Trigger an ad-hoc backup for a tenant

The `/internal/*` API has no external ingress — it is cluster-internal only. Reach it via
`kubectl port-forward`.

In prod, `CONTROL_PLANE_AUTH_MODE=keycloak`, so the `/internal/*` routes require a workforce bearer
JWT (not a static token). Obtain one from the operator portal:

1. Log into `https://operator.daydreamsoftware.ca` in your browser.
2. Open DevTools (F12) and go to the Network tab.
3. Click any request in the list; copy the `Authorization` header value — it starts with `Bearer`.
4. Paste only the token part (the long string after `Bearer`) into the shell variable below.

```bash
# Step 1: set the JWT from the operator portal DevTools
TOKEN=<paste-bearer-token-here>

# Step 2: open a local port to the control-plane service (run in a separate terminal)
kubectl --context dnd-notes-prod port-forward \
  -n dnd-notes-platform \
  svc/dnd-notes-control-plane 3001:3001

# Step 3: trigger the backup (in the original terminal)
TENANT_ID=<tenant-uuid>

curl -fsS \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"triggeredBy":"operator","reason":"manual ad-hoc backup"}' \
  "http://localhost:3001/internal/tenants/${TENANT_ID}/backup"
```

The response includes a `backupId`. Poll the backup status:

```bash
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  "http://localhost:3001/internal/tenants/${TENANT_ID}/backups" \
  | jq '.backups[0]'
```

### Restore a backup

To restore a backup by its ID (requires the same `kubectl port-forward` from above):

```bash
BACKUP_ID=<uuid-from-backup-list>

curl -fsS \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"triggeredBy\":\"operator\",\"reason\":\"restore test\",\"backupId\":\"${BACKUP_ID}\"}" \
  "http://localhost:3001/internal/tenants/${TENANT_ID}/restore"
```

Alternatively, pass `backupLocation` (the Azure Blob path) instead of `backupId` — provide one or the other, not both.

---

## 9. Failure modes

### Cert stuck on Pending

```bash
kubectl --context dnd-notes-prod describe order -n dnd-notes-platform
kubectl --context dnd-notes-prod logs -n cert-manager \
  -l app.kubernetes.io/name=cert-manager --tail=50
```

Common causes:

- Cloudflare API token missing or wrong scope (must be `Zone:DNS:Edit` on `daydreamsoftware.ca`).
- DNS record not yet propagated — wait up to 5 min and check `dig notes.daydreamsoftware.ca`.
- Rate limit from Let's Encrypt (5 failed attempts per hour) — check the order events for
  `too many failed authorizations`.

### 502 from ingress

The pod is not Ready. Check:

```bash
kubectl --context dnd-notes-prod get pods -n dnd-notes-platform
kubectl --context dnd-notes-prod logs -n dnd-notes-platform <pod-name> --tail=50
```

### Tenant provisioning failing

The control-plane orchestrates provisioning. Check its logs:

```bash
kubectl --context dnd-notes-prod logs -n dnd-notes-platform \
  -l app.kubernetes.io/name=dnd-notes-control-plane --tail=100
```

Also verify Keycloak admin REST is reachable from within the cluster:

```bash
kubectl --context dnd-notes-prod exec -n dnd-notes-platform deploy/platform-keycloak -- \
  curl -fsS http://localhost:8080/health/ready
```

### Image pull fails / ImagePullBackOff

Diagnose the failing image first:

```bash
kubectl --context dnd-notes-prod describe pod -n dnd-notes-platform <pod-name> \
  | grep -A5 "Failed\|ImagePull"
```

Common causes and recovery:

**`prod-pin-before-deploy` sentinel still in place** — the overlay was applied
without running the promotion script and pinning a real `prod-*` tag (Section 4).
Run the script, update the overlay, re-apply.

**`prod-*` tag was purged** — this should not happen under normal operation: the CI
retention policy excludes `prod-*` tags from deletion. If it has been purged (e.g.
the package was manually deleted from GHCR), recovery is to re-promote from a
`sha-*` tag that still exists:

```bash
# Find the most recent sha-* tag still in GHCR
gh api /repos/daydream-software/dnd-notes/packages/container/dnd-notes-control-plane/versions \
  --jq '.[0].metadata.container.tags[]' | grep '^sha-'

# Promote it to a new prod-* tag
scripts/platform/promote-prod-image.sh sha-<latest>

# Update the overlay and re-apply (Section 4)
```

If the `sha-*` tag for the previously deployed commit is also gone (more than 10
merges since the last deploy, or the package was recreated), you must rebuild from
source and push a new `sha-*` before promoting. Trigger a manual workflow run on
the `main` branch from the Actions tab, or push any change to trigger the
`deployment-artifacts.yml` workflow, then promote the resulting tag.

**`prod-*` tag exists but GHCR package is private** — pods fail with 401
Unauthorized. Flip the package to Public (Section 6) and retry.

**Activator ImagePullBackOff specifically** — if only the activator fails, the
`dnd-notes-activator` package may not have been promoted alongside the other four.
Re-run `promote-prod-image.sh` with the same `sha-*` tag: it is idempotent and
will create the missing tag without touching the others.

### Postgres pod restarting

```bash
kubectl --context dnd-notes-prod describe pod -n dnd-notes-platform platform-postgres-0
kubectl --context dnd-notes-prod logs -n dnd-notes-platform platform-postgres-0 --tail=50
```

Check:

- PVC space: `kubectl --context dnd-notes-prod get pvc -n dnd-notes-platform`
- Secret values correct (re-check `platform-postgres-credentials`)
- k3s `local-path` provisioner running:
  `kubectl --context dnd-notes-prod get pods -n kube-system -l app=local-path-provisioner`

### Keycloak client secret missing or stale

The `dnd-notes-keycloak-admin` client secret in `dnd-notes-control-plane-secrets` was not set
after first deploy (see Section 5e), or Keycloak was reprovisioned and the secret rotated.

Retrieve the current secret from inside the Keycloak pod:

```bash
kubectl --context dnd-notes-prod exec -n dnd-notes-platform deploy/platform-keycloak -- \
  /opt/keycloak/bin/kcadm.sh get clients \
  -r dnd-notes \
  --fields clientId,secret \
  --no-config \
  --server http://localhost:8080 \
  --realm master \
  --user admin \
  --password <KC_BOOTSTRAP_ADMIN_PASSWORD>
```

Patch the secret and restart the control-plane (same as Section 5e). If `rollout restart` does not
clear the error, force-delete the pod:

```bash
kubectl --context dnd-notes-prod delete pod \
  -l app.kubernetes.io/name=dnd-notes-control-plane \
  -n dnd-notes-platform --force --grace-period=0
```

### Tenant deprovision times out with `TenantRegistryLockTimeoutError`

Provisioning failed mid-flight (for example, bad image tag or transient network error), leaving a
stuck Postgres advisory lock. The next deprovision call times out waiting to acquire the same lock.

```bash
# 1. Find the lock holder
kubectl --context dnd-notes-prod exec platform-postgres-0 -n dnd-notes-platform -- \
  psql -U postgres -c "
SELECT l.pid, a.application_name, a.state, a.query_start
FROM pg_locks l
LEFT JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory';"

# 2. Kill the holding session (replace <pid> with the value from the query above)
kubectl --context dnd-notes-prod exec platform-postgres-0 -n dnd-notes-platform -- \
  psql -U postgres -c "SELECT pg_terminate_backend(<pid>);"

# 3. Or simpler: restart the control-plane to flush its connection pool entirely
kubectl --context dnd-notes-prod delete pod \
  -l app.kubernetes.io/name=dnd-notes-control-plane \
  -n dnd-notes-platform --force --grace-period=0
```

Issue #338 (post-mortem parent) and PR #342 (control-plane three-phase provisioning) make this
scenario much less likely going forward.

---

## 10. Test release scope reminders

These constraints are intentional for the test period. They are not defects.

- **VM may be off.** Testers see "site down" when the VM is deallocated outside active testing windows. Coordinate testing schedules and start the VM before sharing URLs.
- **No SMTP wired.** Email verification is disabled in Keycloak (`verifyEmail: false`). Password reset emails are not sent. Operators create and reset users manually via the Keycloak admin console or operator portal.
- **No prod observability.** Sentry and OpenTelemetry are not configured. Debug via `kubectl logs`.
- **Secrets are env-based, not vault-managed.** Credentials live in k8s Secrets (etcd-backed, not encrypted at rest by default on k3s). Acceptable for a test release. Migrate to a secrets manager before any production rollout.
- **GHCR package visibility is manual.** New GHCR packages default to private. Each must be flipped
  to Public manually (Section 6). Once Issue #332 lands, the source link to the repository becomes
  automatic; the visibility flip remains a manual step.

---

## 11. Scale-to-zero operator notes

### Enabling scale-to-zero on an environment with pre-existing tenants

Pre-existing tenants — those provisioned before `ACTIVATOR_EXTERNAL_NAME` was set and their
IngressRoute pointed at the activator — are safe by default after the 0009 migration. Their
`tenant_activity` rows carry `seen_by_activator = FALSE`, which prevents the idle-scaler from ever
targeting them. They continue running until they receive their first request through the activator,
at which point the activator flips the flag to `TRUE` and the tenant becomes scale-eligible on the
next idle-scaler run.

No operator action is needed. The migration runs automatically on control-plane startup. Tenants
whose traffic is already routed through the activator will flip to eligible on first activity write;
tenants still on direct-to-Service routing stay running indefinitely until re-provisioned or
manually re-routed.

Before rolling out the activator, verify migration 0009 is applied:

```bash
kubectl --context dnd-notes-prod exec -it platform-postgres-0 -n dnd-notes-platform -- \
  psql -U postgres -d control_plane -c "\d tenant_activity"
```

Confirm `seen_by_activator boolean not null default false` is present in the output.

Deploy ordering is required: migration 0009 must run before the updated activator code reaches
the cluster. The standard workflow (control-plane rollout precedes activator rollout) ensures this.

### Limitation: the seen_by_activator flag is one-way

Once a tenant's `seen_by_activator` flips to `TRUE` it stays `TRUE`. If an operator later re-wires
a tenant's IngressRoute back to direct (bypassing the activator at runtime), the idle-scaler still
considers that tenant eligible and will scale it to zero. The activator would then never see traffic
to wake it, re-creating the original outage class on direct routes.

If you need to reverse a tenant's routing away from the activator, either:

- Manually reset the flag: `UPDATE tenant_activity SET seen_by_activator = FALSE WHERE tenant_id = '<id>';`
- Or keep the activator in the path (pattern B is the supported configuration).

---

## Changelog

### 2026-05-21 — prod-deploy workflow (issue #374)

`.github/workflows/prod-deploy.yml` added: a manually-triggered GitHub Actions workflow that
converges prod the way `k3d:up` does for local dev. It is the prod analog of `npm run k3d:up`.

**Flow:** operator promotes a `sha-*` build to a `prod-*` tag via
`scripts/platform/promote-prod-image.sh`, then triggers the workflow with `prod_tag=prod-YYYYMMDD`.
The workflow validates that all 5 images exist in GHCR, applies an ephemeral
`kustomize edit set image` (never committed), guards against the `prod-pin-before-deploy` sentinel
reaching the cluster, runs `kubectl apply -k`, and waits for rollout on all four platform
Deployments (`dnd-notes-control-plane`, `dnd-notes-activator`, `customer-portal`, `operator-portal`).

**Constraints:** `workflow_dispatch` only, self-hosted runner (`[self-hosted, prod]`),
`environment: production` with required reviewers, `permissions: contents: read / packages: read`,
all actions SHA-pinned. Promotion remains a deliberate separate operator step —
the workflow only converges to a tag that already exists.

Added: runner setup (Section 1), GitHub Environment setup (Section 1), Section 5b (workflow docs),
Section 7 "deploy a new image version" updated to reference the workflow.

### 2026-05-21 — prod ImagePullBackOff post-mortem (issue #375, PR #375)

Two structural gaps closed:

- **R1 — prod tag protection**: prod overlay now pins `prod-*` tags instead of
  `sha-*` tags. The tag-aware retention script
  (`scripts/platform/cleanup-ghcr-versions.mjs`) inspects `metadata.container.tags[]`
  directly via the GHCR API: it keeps the 10 newest `sha-*/latest` versions and always
  keeps `prod-*` versions (bounded to 3). A version carrying both `sha-*` and `prod-*`
  counts as prod-only, so build churn can never delete the image prod is running. The
  promotion script `scripts/platform/promote-prod-image.sh` retags a chosen `sha-*`
  build to `prod-YYYYMMDD` for all 5 images without rebuilding.
- **R2 — activator image**: `dnd-notes-activator` is now built and pushed by the
  `deployment-artifacts.yml` CI workflow on every merge to main. The prod overlay
  pins it alongside the other four images. This unblocks the scale-to-zero prod
  rollout (#340/#364).
- Updated Sections 4, 6, 7, 9 and added activator to the image table.

### 2026-05-18 — post-deploy walkthrough (issue #339)

This runbook was walked end-to-end on a fresh Azure D4ads_v7 VM on 2026-05-18. Nine gaps were
identified and closed in this revision:

- **R1** — `kustomize edit` is kustomize-only; added `sed` alternative for kubectl-only setups
  (Sections 1, 4, 7).
- **R2** — Removed `CONTROL_PLANE_ADMIN_TOKEN` from the Section 3d template (only needed for
  `CONTROL_PLANE_AUTH_MODE=static`).
- **R3** — Promoted Section 5d (create `control_plane` database) to a STOP/warning block.
- **R4** — Added explicit `--context dnd-notes-prod` warning to Section 1 and Section 2c.
- **R5** — Added base64 newline trap warning and `stringData` guidance to Section 3d.
- **R6** — Added GHCR private-by-default warning and package visibility flip steps to Section 6;
  narrowed the Issue #332 cross-reference to source-link only (visibility stays manual).
- **R7** — Added force-delete pod note to Section 5e and Section 9 (Keycloak client secret
  stale); added "Update a Secret" ops procedure to Section 7.
- **R8** — Added pod label convention reference to Section 7.
- **R9** — Added `TenantRegistryLockTimeoutError` (stuck advisory lock) recovery to Section 9,
  with cross-references to issue #338 (post-mortem parent) and PR #342 (control-plane three-phase
  provisioning fix).

Companion fixes: PR #341 (manifest gaps) and PR #342 (control-plane lock fix).
