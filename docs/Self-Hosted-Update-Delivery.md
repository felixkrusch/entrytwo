# Self-Hosted, Per-Customer Update Delivery

**Status:** Core delivery pipeline implemented (signed images, cosign keyless, GHCR, updater sidecar, manifest, health-gated rollback). Commercial model and trial-to-licensed transition are now specified in [Licensing-and-Trial.md](./Licensing-and-Trial.md). The separate entitlement service for license key issuance and verification is still to be built.
**Context:** entrytwo is a **proprietary, closed-source**, self-hosted, double-entry
accounting app. The commercial model is **perpetual license + annual maintenance/
support subscription** (see §9). Deployment is *one instance per customer* (or per
organization), where the customer owns their server and their financial data. This
document plans how we deliver secure updates to those instances without reinventing
software-update cryptography.

---

## 1. Goal & non-negotiables

- **One instance per customer.** We never hold customer ledgers centrally.
- **Source not publicly distributed; commercial license governs use.** We do *not*
  publish the source on a public repo anyone can clone, and use is governed by a
  commercial license — but we make **no claim to hide the source from the operator**.
  On a self-hosted box the server admin can always inspect the running image, so
  obscurity is not a control. The license is a *legal* instrument, not technical
  DRM. (They still *own their data* and their server — that is the promise.)
- **"You own your data" is a real property, not just marketing.** Updates must
  never exfiltrate, centralize, or require us to touch customer data.
- **Perpetual license + annual maintenance.** The customer buys the software
  outright; updates + support are delivered while maintenance is active (see §9).
  A lapsed instance is *never disabled* — it simply stops receiving new versions.
- **Updates must be authentic and tamper-evident.** A customer instance must
  only ever run code we actually shipped.
- **Safe by default.** Failed updates roll back automatically; backups precede
  migrations; the app process cannot rewrite its own code.
- **No custom crypto, no custom transport security.** We stand on maintained,
  audited, industry-standard tooling.

---

## 2. Threat model

| Threat | Mitigation |
|---|---|
| Attacker pushes a malicious image to our registry | Signature verification rejects it at pull time |
| Compromised `main` branch / CI | Signing identity is tied to a specific trusted workflow + tag |
| Replay of an old, vulnerable version (rollback attack) | Digest-pinned pulls + version floor in the signed manifest |
| Freeze attack (hide that an update exists) | Signed manifest with expiry/timestamp; customer checks on open |
| Lapsed maintenance → forced downtime | Not possible: instance is never disabled; it only stops receiving new versions |
| Mix-and-match (good + bad parts) | Whole-image digest signature, not per-file |
| Compromised running app (e.g. via chat/LLM) self-modifies | App has no permission to replace the running image; only the isolated updater does |
| Stolen signing key | Keyless signing → no long-lived key to steal; identity-based trust + rotation |

---

## 3. Do we reinvent the wheel? — No.

The user asked directly: *do Docker and GitHub have reliable options so we don't
reinvent the wheel?* **Yes.** Both provide mature, maintained building blocks in
2026, and we use them rather than writing our own update framework.

**What GitHub gives us (delivery + signing identity):**
- **GitHub Container Registry (GHCR)** — hosts our signed images *and* their
  signatures (cosign stores signatures as co-located OCI artifacts). No separate
  signature server needed.
- **GitHub Actions** — builds the image and signs it with **cosign keyless
  signing**: the runner proves its identity via an OIDC token, Fulcio issues a
  short-lived cert, the signature is recorded in the Rekor transparency log.
  **No signing key to store, rotate, or leak.** The signature is bound to our
  exact workflow (e.g. `…/workflows/release.yml@refs/tags/v*`), so verification
  checks *who* signed, not just *that a key signed*.
- **GitHub Releases** — hosts the human-readable changelog/manifest per version.

**What Docker gives us (the unit of deployment + verification):**
- **OCI images** are the immutable, reproducible deployment unit.
- **cosign** verifies a pulled image's signature against our pinned identity
  before it is ever run. TUF (The Update Framework) is already embedded in
  cosign's trust root, so rollback/freeze/replay resistance comes for free.
- **Watchtower** (maintained forks) can auto-pull + recreate containers **with
  signature verification enabled** (`WATCHTOWER_VERIFY_SIGNS`), as can several
  maintained alternatives (Dockhand, Docker-Sentinel, Drydock, docker-updater).

**Decision:** Build + sign in GitHub Actions → push to GHCR → customer-side
updater **verifies the cosign signature** and pulls the image **by digest** →
recreates the container → runs DB migration. We do not `git pull` source, do not
build on the customer machine, and do not trust a moving branch.

---

## 4. Architecture overview

```
[ Us / CI ]                              [ Customer instance ]
─────────────                           ─────────────────────
GitHub Actions                          1. Updater sidecar (isolated)
  ├─ build image  ──┐                   2. Check signed manifest (on open / webhook)
  ├─ cosign sign ──┼──▶ GHCR ◀── pull ─┘3. Verify cosign signature (keyless identity)
  │   (keyless)    │   (signed img)     4. Full DB backup
  └─ SBOM + SLSA   │                    5. `compose pull` image @sha256:...
      attestation  │                    6. `prisma migrate deploy` (one-shot job)
                   └─▶ GitHub Release   7. Recreate app container (same volumes/env)
                       (manifest +       8. Health gate → on fail: rollback to
                        changelog)           previous digest + pre-update backup
```

The **app** only *shows* "Update available vX.Y.Z" and exposes an *Apply* action.
The **updater** (a separate, least-privilege component) *applies* it. This
separation is the core security property: a compromised app cannot mutate itself.

---

## 5. Release pipeline (CI) — what we ship

A single GitHub Actions `release` workflow, triggered on version tags (`v*`):

1. Checkout, set up Buildx, build & **push by digest** to GHCR
   (`ghcr.io/<org>/entrytwo:1.4.2` + `@sha256:…`).
2. **Sign** with cosign keyless (`cosign sign --yes ghcr.io/...@<digest>`).
   Sign the *multi-arch index*, not per-arch manifests.
   Before signing, the updater image must pass `updater/smoke-test.sh` on both
   AMD64 and ARM64 using its default entrypoint, including health, Docker Compose,
   and Cosign checks. Only version tags are pushed during the build; `latest`
   is promoted after smoke tests and signing succeed.
3. **Attest** the SPDX SBOM with `cosign attest` in GHCR. BuildKit attaches
   `mode=min` provenance to both images. This does not use GitHub's repository
   attestation API, which is unavailable for user-owned private repositories.
4. Publish a **signed release manifest** (a small JSON: version, image digest,
   minSupportedVersion, changelog ref, published-at) and its Sigstore bundle to
   the public releases-only repository, alongside the SBOM, `compose.yaml`, and
   `entrytwo.env.example` (downloaded locally as `.env.example`). The source
   repository remains private.
5. Optionally fire a **webhook** to notify instances a new version is available
   (see §7).

Guardrails:
- Sign *by digest*, never by mutable tag.
- `id-token: write` + `packages: write` permissions only on the release job.
- Keep the signing workflow path strict and reviewed; verification policy pins
   the exact workflow identity.

### One-time publisher configuration

- Create and initialize the **public** repository `felixkrusch/entrytwo-releases`
  (an initial README commit is sufficient). Do not copy application source into it.
- In the private source repository, add the Actions secret `RELEASE_TOKEN`: a
  fine-grained token scoped only to that public repository with **Contents: read
  and write** permission. The built-in `GITHUB_TOKEN` cannot publish to a second
  repository. Alternatively use an equivalently scoped GitHub App token.
- The optional Actions variable `RELEASE_REPOSITORY` overrides the default
  `felixkrusch/entrytwo-releases`. If overridden, update the public documentation's
  download links too. The workflow checks that the target exists and is public
  before building.
- After the first push, make **both** personal-account GHCR packages public:
  `entrytwo` and `entrytwo-updater`, under Package settings > Change visibility.
  This does not make the source repository public. Public package visibility
  cannot subsequently be reverted to private on GitHub.
- If package permissions are managed separately, retain write access for the
  private source repository under Manage Actions access.
- Push a stable `vMAJOR.MINOR.PATCH` tag containing the updated workflow. Both
  image packages receive version and `latest` tags for amd64 and arm64. Re-running
  an old failed run uses its old workflow, not the new file on the default branch.
- Test installation without GitHub credentials after publication. No customer
  should need a source-repository token.

Cosign keyless signatures and public transparency records expose the signing
workflow identity, repository name, tag, and build metadata, not repository
access. Do not place secrets in build arguments or published installation files.
The updater verifies the image signature; the manifest bundle also supports
manual `cosign verify-blob` verification using the policy in the release notes.

---

## 6. Customer-side updater (sidecar)

A small, isolated service (its own container, narrow Docker socket access) with
our **public verification key / trusted Sigstore root pinned at provisioning**:

- **Check:** fetch the signed manifest (cheap; on admin-open or via webhook —
  *not* a 60s poll). Compare to the running digest/version.
- **Verify:** `cosign verify` the target image digest against our signing
  identity (`--certificate-identity-regexp`, `--certificate-oidc-issuer
  https://token.actions.githubusercontent.com`). Refuse to proceed on mismatch.
- **Backup:** full DB export of *all* tables (the current code only backs up a
  subset — fix this) to durable storage with integrity check.
- **Apply:** `docker compose pull <app>@sha256:…` then `up -d`; run migration as
  a one-shot job (`prisma migrate deploy`) before the app serves traffic.
- **Health gate + rollback:** after recreate, run a health check; on failure,
  recreate the *previous* pinned digest and restore the pre-update backup.

Why a dedicated sidecar instead of plain Watchtower: we get audit logging,
entitlement gating, the in-app UX we already built, and a single trust boundary
we control. Watchtower (with `WATCHTOWER_VERIFY_SIGNS`) remains a valid *fallback*
for users who prefer it.

---

## 7. In-app UX (no 60s polling)

- The Update page fetches the signed manifest **when an admin opens it**, and we
  optionally push a webhook on release so the banner appears promptly.
- No background 60s interval. A daily background check (or webhook) is plenty.
- "Update available vX.Y.Z" shows changelog; *Apply* calls the updater and shows
  real progress (backup → verify → migrate → restart), not a blind 3s reload.
- Honest "up to date" + last-checked timestamp.

---

## 8. Security: new model vs. current `git pull`

| Property | Today (`git pull origin/main`) | Proposed (signed image) |
|---|---|---|
| Unit of deployment | source on a branch | immutable signed OCI image (by digest) |
| Build location | customer machine | our CI |
| Auth on update endpoint | **none** (public route) | isolated updater, admin-gated apply |
| Integrity | none (whatever is on `main`) | cosign signature bound to our CI identity |
| Rollback/freeze resistance | none | TUF-rooted digest pinning + manifest |
| App can self-modify | effectively yes | no — only the updater can |
| Backup before update | partial (subset of tables) | full, integrity-checked |
| Rollback on failure | none | automatic to previous digest + backup |
| Supply-chain attestation | none | SBOM + SLSA provenance |

---

## 9. Commercial model — perpetual license + annual maintenance

**Decided.** entrytwo is sold as a **perpetual license** (customer owns the right
to run the software) plus an **annual maintenance & support subscription** that
entitles the customer to updates and support for that year.

- **Customer buys the software outright** → "you own it" is literally true (their
  running instance + their data). We don't publish the source publicly, but on
  self-hosted the operator can always inspect it — so we make no obfuscation
  claims. The commercial license is a *legal* grant, not a technical lock, and a
  purchased version never stops working.
- **Maintenance active → updates + support delivered.** Maintenance lapsed → the
  instance **keeps running on its current version** and simply stops receiving
  new ones. It is *never* remotely disabled. Renewal (with optional reinstatement)
  resumes delivery.
- **Recurring revenue without hostage dynamics.** This is the Red Hat / enterprise
  infrastructure model: predictable yearly maintenance revenue *and* an ownership
  trust story — the only model where both are true at once, and the right fit for
  "you own your data."

### Licensing posture

Source is **not publicly distributed** (no public repo anyone can clone) and use is
governed by a **commercial license** — but we make **no technical obfuscation
claims**. On a self-hosted box the server admin can always inspect the running
image, so hiding the source is neither possible nor a control we rely on. The license
is a **legal grant, not technical DRM**: it defines permitted use and binds
support/maintenance, and it is enforced commercially (terms, invoices), not by code.
This is exactly why entitlement gates *delivery of updates* and *support* — never the
running app or the customer's data — and why we never attempt to remotely disable a
purchased instance.

### Entitlement-aware delivery (how the model is enforced)

Enforcement lives at the **delivery layer only**, never at the running app.

**Important:** The self-hosted app follows a "verify once, trust forever" policy
(see [Licensing-and-Trial.md](./Licensing-and-Trial.md)):
- The external verify service is called **only once**, at the moment a customer
  pastes a license key (activation).
- After successful activation, the key is stored locally and the instance is
  permanently licensed. No further calls to the verify service are made for
  status, UI, or update checks.
- Update gating in the app only checks the stored licensed flag (never re-verifies).

The update delivery layer still respects entitlement:

1. On update check, the instance presents its **license token** to our
   entitlement service (future / optional).
2. We return the latest digest the token is entitled to (tier + maintenance
   status). Lapsed maintenance → manifest returns the customer's current/supported
   version, so they don't see newer ones.
3. **Security carve-out (non-negotiable):** critical CVE fixes for the supported
   major line are *always* published, regardless of maintenance status. Gating
   security fixes behind payment is both unethical and reputationally toxic for
   financial software.
4. Channels: `stable` for active maintainers; `beta`/early-access for higher tiers.

### Other commercial notes

- **One signed image, not per-customer builds.** Entitlement is a manifest-layer
  concern; we never ship bespoke images (ops nightmare, weakens signing story).
- **Feature gating stays in-app**, not in the update layer — maintenance entitles
  *updates*, while optional add-ons/tiers can gate *features* separately if needed.
- **Marketing alignment:** "self-hosted, you own your data" is technically true —
  we cannot read ledgers, updates are verifiable/refusable by the customer, and a
  purchased version never stops working. Strong, defensible claim.
- **Registry:** GHCR to start; for larger customers we can mirror signed images to
  their own registry — verification still uses *our* signing identity, so mirroring
  does not weaken trust.
- **Break-glass:** documented, time-limited bypass if signature infra is down, with
  mandatory audit log + auto-expire.

---

## 10. Migration from the current implementation

1. Replace `app/api/admin/update/route.ts` git-pull logic with an **authenticated**
   "apply" call to the updater sidecar (remove `/api/admin/update` from
   `middleware.ts` `publicRoutes`; require ADMIN session).
2. Replace the partial backup with the **full** backup (reuse
   `/api/backup/export`).
3. Replace `git fetch/pull` + `npm install` + `npm run build` with
   `compose pull @digest` + `migrate deploy` + recreate.
 4. Add signature verification before any pull. ✅ Implemented —
    `app/api/admin/update/route.ts` verifies the target digest against a keyless
    cosign identity (`COSIGN_IDENTITY`) or a pinned public key (`COSIGN_PUBLIC_KEY`);
    on by default, required unless `UPDATE_VERIFY_SIGNATURE=false`.
 5. Add a `Dockerfile` that actually runs the app (the current one is a `fortune`
    placeholder) and ship a working `compose.yaml` for customers. ✅ Done
    (`Dockerfile`, `docker-entrypoint.sh`, `compose.yaml` mount the host Docker
    socket so the instance can self-update).
 6. Add the GitHub Actions release workflow (build → cosign keyless sign → GHCR →
    SBOM/SLSA → manifest). ✅ Done (`.github/workflows/release.yml`): multi-arch
    build pushed by digest, keyless cosign sign, SBOM + SLSA attestation, and a
    signed `manifest.json` published as a release asset.
 7. Update the in-app check to use the signed manifest on open / webhook. ✅ Done —
    the Update page fetches the manifest on open (no 60s poll) and the apply flow
    pulls the image **by digest** from that manifest with staged progress.

---

## 11. Suggested rollout

- **Phase 0 — Stop the bleeding:** lock down the current update endpoint
  (auth + full backup). *(Independent of the rearchitecture.)*
- **Phase 1 — Real images:** working `Dockerfile` + `compose.yaml`; manual
  `docker compose pull && up -d` updates by the customer.
- **Phase 2 — Signed + verified:** CI signs images; customer `compose`/updater
  verifies before applying.
- **Phase 3 — In-app UX + channels:** manifest check on open/webhook, beta
  channel, health-gated rollback.

---

## 12. Open decisions (remaining, before implementation)

**Decided:** commercial model = pay-to-own perpetual license after a 30-day trial, followed by optional annual maintenance for updates and support. See [Licensing-and-Trial.md](./Licensing-and-Trial.md) for the full trial + licensing + entitlement rules. The post-licensing behavior (never disable the running app, maintenance only gates new versions) remains as described in this document (§9).

Still open (technical):
- **Updater vehicle:** ✅ Implemented as a **dedicated sidecar** (`updater/`,
  `compose.yaml` `updater` service). The app no longer mounts the Docker socket;
  it authenticates to the sidecar over HTTP with `UPDATER_TOKEN` and the sidecar
  performs pull / migrate / recreate / health-gate / rollback. An in-app fallback
  (app holds the socket) remains in `route.ts` when `UPDATER_URL` is empty, for
  non-compose or dev deployments. Watchtower-with-`WATCHTOWER_VERIFY_SIGNS` is
  still a valid alternative for users who prefer it. Future hardening: front the
  socket with a scoped proxy (e.g. `tecnativa/docker-socket-proxy`) granting only
  the API verbs `compose`/`containers`/`images` need.
- **Entitlement service:** standalone license service vs. lightweight token check;
  where license tokens are issued/stored; reinstatement rules for lapsed maintenance.
  **Not implemented** — updates are currently delivered to any instance that can
  read the (public) release manifest. Gate delivery here when the commercial
  enforcement layer lands (see §9).
- **License token format & validation:** how the instance proves entitlement on
  each update check (opaque signed token vs. JWT; offline-tolerant validation).

Resolved by the current implementation (defaults, overridable):
- **Manifest transport:** GitHub Releases — `UPDATE_MANIFEST_URL` points at the raw
  `manifest.json` asset.
- **Keyless vs. pinned-key verification:** both supported. Keyless identity
  (`COSIGN_IDENTITY` + `COSIGN_OIDC_ISSUER`) is the default; a pinned public key
  (`COSIGN_PUBLIC_KEY`) takes precedence for offline/air-gapped customers. The
  manifest blob itself is also cosign-signed (`manifest.json.sig`) for an
  offline-tolerant manifest check.
- **Registry:** GHCR for all (per-tier mirrors via re-signing later if needed).
- **Check cadence:** on-open (manual refresh) — no background 60s poll. Webhook
  push (§7) is a future nicety, not required.
