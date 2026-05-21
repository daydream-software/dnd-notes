# Deploy runbook — Azure VM + k3s test release

Target infrastructure: Azure D4ads_v7 (4 vCPU AMD / 16 GB / Premium SSD P10 128 GB), East US.
Domain: `daydreamsoftware.ca` (Cloudflare DNS).
Manifests: `deploy/k3s/` (PR #335). Backup runner: PR #334. GHCR push workflow: PR #331.

This document is the sole reference for bootstrapping, deploying, and operating the D&D Notes stack
on the test-release VM. Any future operator should be able to follow it end-to-end after a long gap,
without external input.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial VM bootstrap (one-time)](#2-initial-vm-bootstrap-one-time)
3. [Secrets setup (before first deploy)](#3-secrets-setup-before-first-deploy)
4. [Pre-deploy: pin image tags](#4-pre-deploy-pin-image-tags)
5. [First deploy](#5-first-deploy)
6. [GHCR package linking (one-time, post-first-push)](#6-ghcr-package-linking-one-time-post-first-push)
7. [Daily ops](#7-daily-ops)
8. [Backups](#8-backups)
9. [Failure modes](#9-failure-modes)
10. [Test release scope reminders](#10-test-release-scope-reminders)
11. [Changelog](#changelog)

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
# them unset now and patch the value in after deploy (Section 5d), or export a
# placeholder you will overwrite.

scripts/platform/provision-secrets.sh --mode prod --context dnd-notes-prod
```

This creates `platform-postgres-credentials`, `keycloak-bootstrap-env`, `dnd-notes-control-plane-secrets`, and `dnd-notes-activator-secrets` in one pass. The `keycloak-realm-dev-secrets` Secret is k3d-only (it feeds the local realm seed's `${KC_DEV_*}` placeholders) and is never created in prod — the prod realm seed carries no committed secrets.

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

`POSTGRES_DB=keycloak` is the database Postgres initialises on first start. The control-plane and tenant databases are created separately after the pod is running (see Section 5c).

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

The `KEYCLOAK_ADMIN_CLIENT_SECRET` is auto-generated by Keycloak on first realm import and is not known before the first deploy. Set a placeholder here and update it after the first deploy (Section 5d):

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

## 4. Pre-deploy: pin image tags

Estimated time: ~5 min.

The prod overlay uses a `pin-before-deploy` sentinel tag on all images. Applying the overlay without substituting a real tag will cause ImagePullBackOff on purpose — this is a safety net to prevent silent rollouts of an unreviewed image.

Find the `sha-XXXXX` tag to deploy from GHCR. The GHCR push workflow (PR #331) tags every main-branch push with the short commit SHA:

```bash
gh api /repos/daydream-software/dnd-notes/packages/container/dnd-notes-control-plane/versions \
  --jq '.[0].metadata.container.tags[]' \
  | grep '^sha-'
```

Once you have the tag, substitute it in the prod overlay.

**If you have `kustomize` v5+:**

```bash
TAG=sha-abcdef0  # replace with the real tag from the command above

cd /path/to/dnd-notes/deploy/k3s/overlays/prod

kustomize edit set image \
  ghcr.io/daydream-software/dnd-notes-control-plane=ghcr.io/daydream-software/dnd-notes-control-plane:${TAG} \
  ghcr.io/daydream-software/dnd-notes-customer-portal=ghcr.io/daydream-software/dnd-notes-customer-portal:${TAG} \
  ghcr.io/daydream-software/dnd-notes-operator-portal=ghcr.io/daydream-software/dnd-notes-operator-portal:${TAG}
```

**If you only have `kubectl` (no standalone `kustomize` binary):** `kubectl kustomize` renders
overlays but does not include the `kustomize edit` subcommand. Edit the tag directly with `sed`:

```bash
TAG=sha-abcdef0  # replace with the real tag from the command above

sed -i "s/newTag: pin-before-deploy/newTag: ${TAG}/g" \
  /path/to/dnd-notes/deploy/k3s/overlays/prod/kustomization.yaml
```

Confirm the substitution worked before applying:

```bash
grep newTag /path/to/dnd-notes/deploy/k3s/overlays/prod/kustomization.yaml
```

The overlay patches three images. The fourth GHCR package — `ghcr.io/daydream-software/dnd-notes`
(the per-tenant app image) — is not in this overlay because it is referenced dynamically by the
control-plane at tenant provisioning time via `TENANT_IMAGE_REPOSITORY` in the ConfigMap. It uses the
same `sha-XXXXX` tag and does not need a separate `kustomize edit` call here.

Commit the change (you are still in `deploy/k3s/overlays/prod` from the `cd` above):

```bash
git add kustomization.yaml
git commit -m "chore(deploy): pin images to ${TAG}"
```

---

## 5. First deploy

Estimated time: ~15 min (plus 1–5 min for DNS-01 cert issuance).

### 5a. Apply the prod overlay

From the repo root:

```bash
kubectl kustomize deploy/k3s/overlays/prod \
  | kubectl --context dnd-notes-prod apply -f -
```

### 5b. Watch pods come up

```bash
kubectl --context dnd-notes-prod get pods -n dnd-notes-platform -w
```

Postgres and Keycloak start first (~2 min). The control-plane will enter `CrashLoopBackOff` until
Section 5d (Keycloak client secret patch) is complete — this is expected. Final state after 5d:
all pods `Running`, all containers `Ready`.

### 5c. Create additional databases

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
> Wait for the Postgres pod to reach `Running` (Section 5b), then run:
>
> ```bash
> kubectl --context dnd-notes-prod exec -it platform-postgres-0 -n dnd-notes-platform -- \
>   psql -U postgres -c "CREATE DATABASE control_plane;"
> ```
>
> Confirm success: `CREATE DATABASE` is printed with no error.

Tenant databases are created automatically by the control-plane at provisioning time.

### 5d. Retrieve the Keycloak admin client secret (chicken-and-egg step)

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

### 5e. Wait for the TLS certificate

The wildcard certificate is issued via DNS-01 against Cloudflare. This takes 1–5 min after Keycloak is ready:

```bash
kubectl --context dnd-notes-prod get certificate \
  -n dnd-notes-platform daydreamsoftware-wildcard -w
```

Wait until `READY=True`. If it stays `False` for more than 5 min, see [Section 9: Cert stuck on Pending](#cert-stuck-on-pending).

### 5f. Smoke test

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
> For each of the four packages — `dnd-notes`, `dnd-notes-control-plane`,
> `dnd-notes-customer-portal`, `dnd-notes-operator-portal`:
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
2. For each of the four packages listed above:

   Open the package → Package Settings → "Manage Actions access" → connect to the `dnd-notes` repo.

Once Issue #332 lands, the source link becomes automatic (Dockerfile `LABEL` wires it). The
visibility step (flipping packages to Public) must still be done manually for any newly created
package — GitHub does not propagate repo visibility to packages automatically.

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

1. Find the `sha-XXXXX` tag from GHCR for the commit you want to deploy (same as Section 4).

2. Update the overlay.

   **With `kustomize` v5+:**

   ```bash
   TAG=sha-abcdef0

   cd deploy/k3s/overlays/prod

   kustomize edit set image \
     ghcr.io/daydream-software/dnd-notes-control-plane=ghcr.io/daydream-software/dnd-notes-control-plane:${TAG} \
     ghcr.io/daydream-software/dnd-notes-customer-portal=ghcr.io/daydream-software/dnd-notes-customer-portal:${TAG} \
     ghcr.io/daydream-software/dnd-notes-operator-portal=ghcr.io/daydream-software/dnd-notes-operator-portal:${TAG}
   ```

   **Without `kustomize` (kubectl only):** use `sed` as documented in Section 4.

3. Commit the kustomization change to a deploy branch and push.

4. Apply:

   ```bash
   kubectl kustomize deploy/k3s/overlays/prod \
     | kubectl --context dnd-notes-prod apply -f -
   ```

5. Watch the rollout:

   ```bash
   kubectl --context dnd-notes-prod rollout status deployment/dnd-notes-control-plane \
     -n dnd-notes-platform
   ```

### Roll back to a previous version

Same as deploying — substitute an earlier `sha-XXXXX` tag in step 2 above.
PR #331's cleanup policy retains the 10 most recent tags per image, so rollback to any of the 10
most recent main pushes is available without re-building.

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

Two likely causes:

1. `pin-before-deploy` sentinel still in place — the tag was never substituted (Section 4).
   Substitute the real tag using `kustomize edit set image` or the `sed` alternative documented
   in Section 4, then re-apply.
2. The tag you rolled back to is outside the 10-most-recent window and was cleaned up by the
   retention policy (PR #331). Pick a tag that is still present in GHCR.

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
after first deploy (see Section 5d), or Keycloak was reprovisioned and the secret rotated.

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

Patch the secret and restart the control-plane (same as Section 5d). If `rollout restart` does not
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

## Changelog

### 2026-05-18 — post-deploy walkthrough (issue #339)

This runbook was walked end-to-end on a fresh Azure D4ads_v7 VM on 2026-05-18. Nine gaps were
identified and closed in this revision:

- **R1** — `kustomize edit` is kustomize-only; added `sed` alternative for kubectl-only setups
  (Sections 1, 4, 7).
- **R2** — Removed `CONTROL_PLANE_ADMIN_TOKEN` from the Section 3d template (only needed for
  `CONTROL_PLANE_AUTH_MODE=static`).
- **R3** — Promoted Section 5c (create `control_plane` database) to a STOP/warning block.
- **R4** — Added explicit `--context dnd-notes-prod` warning to Section 1 and Section 2c.
- **R5** — Added base64 newline trap warning and `stringData` guidance to Section 3d.
- **R6** — Added GHCR private-by-default warning and package visibility flip steps to Section 6;
  narrowed the Issue #332 cross-reference to source-link only (visibility stays manual).
- **R7** — Added force-delete pod note to Section 5d and Section 9 (Keycloak client secret
  stale); added "Update a Secret" ops procedure to Section 7.
- **R8** — Added pod label convention reference to Section 7.
- **R9** — Added `TenantRegistryLockTimeoutError` (stuck advisory lock) recovery to Section 9,
  with cross-references to issue #338 (post-mortem parent) and PR #342 (control-plane three-phase
  provisioning fix).

Companion fixes: PR #341 (manifest gaps) and PR #342 (control-plane lock fix).
