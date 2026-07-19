# Licensing, 30-Day Trial, and Entitlement

**Status:** Planned / partially designed. Core update delivery, signing, and updater sidecar are implemented. The trial enforcement, license key issuance, and entitlement verification layer are not yet implemented.

This document describes how entrytwo is sold and how the 30-day trial transitions into the perpetual license model, while staying consistent with the "never disable the running app after licensing" philosophy in [Self-Hosted-Update-Delivery.md](./Self-Hosted-Update-Delivery.md).

---

## 1. High-level commercial model

- **Pay-to-own (perpetual license)**: One-time purchase grants the right to run the software indefinitely on a self-hosted instance.
- **30-day trial**: Full functionality for the first 30 days from first use, with no license key required.
- **After 30 days, unlicensed**: A hard paywall blocks normal operation. The screen lifts only when a valid paid license key is entered.
- **Once licensed**: The instance moves into the model described in Self-Hosted-Update-Delivery.md:
  - Perpetual license — the running app is **never disabled**.
  - Annual maintenance (optional recurring purchase) entitles the customer to updates and support.
  - Lapsed maintenance → the instance keeps running its current version and simply stops receiving new ones.
- Enforcement during the trial window is the only place where continued use is gated. After a paid key is accepted, behavior reverts to the soft "updates only" model.

This gives customers a real "try before you buy" experience while still forcing payment to continue after the trial, and then delivering the ownership promise.

---

## 2. 30-day trial mechanics (self-hosted instance)

- On first boot / first use after a fresh install, the app records a reliable "first use" timestamp (stored in the database and at least one additional protected location for basic tamper resistance).
- During the first 30 calendar days: the full app works normally. A visible trial banner or countdown is acceptable but not mandatory.
- After 30 days with no valid paid license key present:
  - A blocking paywall / license screen is shown.
  - Normal operation (chat, journal entry, reports, etc.) is disabled or read-only.
  - The Update page does not offer or apply new versions.
- The user enters a license key (pasted from the purchase flow).
- The app verifies the key (signature check + optional online confirmation).
- On success: the key is persisted, the paywall is permanently lifted for this deployment, and the instance is considered "licensed".
- Once licensed, the app never shows the trial paywall again for this install, even if maintenance later lapses.

The 30-day clock is based on first *use* inside the instance, not download or image creation time.

---

## 3. License key design (signed Stripe proof of purchase)

We use a signed token approach so the key itself carries proof of a legitimate one-time purchase without requiring a large customer database on our side.

**Issuance (on successful payment):**
- Customer completes a one-time Stripe payment for the perpetual license (via entrytwo.com).
- A small separate privileged dynamic service (not part of the static marketing site) receives the Stripe event (or looks up the session/charge).
- It extracts stable Stripe identifiers (e.g. `payment_intent`, `charge`, or `customer` + `payment_intent`).
- It signs a compact payload with our private signing key. Example conceptual structure (JWT or custom `et1.<base64>.<sig>`):

  ```json
  {
    "type": "perpetual",
    "stripe": {
      "customer": "cus_xxx",
      "payment_intent": "pi_yyy",
      "charge": "ch_zzz"
    },
    "issued_at": "2026-07-19T12:00:00Z",
    "version": 1
  }
  ```

- The signed token is returned to the buyer (shown on the success page and emailed). This token *is* the license key.

**Verification (inside the self-hosted app):**
- The app performs an offline signature check using an embedded public key (first gate).
- Optionally (and recommended for new keys), the app sends the key to the entitlement service.
- The entitlement service:
  - Verifies the signature.
  - Can optionally call the Stripe API (using our secret key) to confirm the payment exists, succeeded, and has not been refunded or charged back.
  - Returns success / failure.
- On success the app stores the key (or a hash + verified flag) and lifts the paywall permanently.

This design allows:
- Stateless, verifiable keys.
- Easy lost-key recovery (customer provides Stripe receipt/customer id → we re-issue the same signed token).
- Prevention of easy forgery (unsigned or tampered tokens are rejected).

---

## 4. Static marketing site + Stripe + no backend on entrytwo.com

`entrytwo.com` (or the main marketing site) is intended to be a pure static/edge site:

- Built with Next.js (static export), Astro + Tailwind, or similar.
- Hosted on Vercel, Cloudflare Pages, or equivalent.
- Contains marketing copy, pricing, "Start 30-day trial" and "Buy perpetual license" buttons/links.
- Buttons redirect to Stripe Checkout (hosted) for a one-time payment.
- Links to Stripe Customer Portal for post-purchase management (receipts, etc.).
- **No database, no user accounts, no sessions on this domain.**

All persistent customer, subscription (if any maintenance products), and payment data live in Stripe.

Because a purely static site cannot hold signing keys or call the Stripe secret API, key issuance and verification are delegated to a small separate "privileged dynamic piece" (Cloudflare Worker, Vercel Edge Function in a separate project, tiny API service, etc.). This service is the only component that needs the Stripe secret key and our signing private key.

---

## 5. Entitlement / verification service (separate component)

This is the small privileged dynamic piece we will build independently:

Responsibilities:
- On successful one-time payment (Stripe webhook or Checkout session completed): sign and issue the license key.
- On key verification requests from running instances: verify signature + (optionally) re-check Stripe payment status.
- Support lost-key lookup / re-issuance (customer proves ownership via Stripe customer id or receipt).
- Return appropriate responses for trial vs. licensed vs. invalid/expired cases.

It does **not** need to store full customer ledgers or run the accounting app. It only deals with license keys and Stripe payment records.

The self-hosted app calls this service:
- When a user pastes a new license key (to lift the paywall).
- Optionally on update checks (to decide whether newer manifests are allowed).

After the initial key acceptance, the app can continue to function offline for normal use (subject to the "once licensed" rules).

---

## 6. Update delivery after licensing

Once a valid paid license key is present, update behavior follows the model in [Self-Hosted-Update-Delivery.md](./Self-Hosted-Update-Delivery.md):

- Signed manifests are delivered via GitHub Releases (`UPDATE_MANIFEST_URL`).
- Images are built, cosign-signed (keyless), and pushed to GHCR with SBOM + SLSA provenance.
- The updater sidecar (or fallback) performs digest-pinned pulls, full backups, `prisma migrate deploy`, health gating, and automatic rollback on failure.
- Annual maintenance status (if sold separately) can further filter which digests a key is entitled to see.
- The running app is **never disabled** — lapsed maintenance only stops delivery of new versions.

The license key is required to *consume* updates (the Update page and updater will not proceed without a stored valid key after the trial window). The actual update safety machinery remains unchanged.

---

## 7. One-time purchase vs. annual maintenance

- The initial license is a **one-time payment** for perpetual ownership.
- Annual maintenance / support can be offered as a separate optional recurring product in Stripe (or as a renewal one-time payment each year).
- Lapsed maintenance affects only access to new versions and official support — not the ability to keep running the already-licensed version.

This matches the "perpetual license + annual maintenance" language in the existing docs, with the addition of a real 30-day trial that requires payment to continue.

---

## 8. Offline, air-gapped, and lost-key handling

- **Offline verification**: The app can accept a key based on signature alone (using the embedded public key) and lift the paywall. It may defer full Stripe re-verification until connectivity is restored.
- **Air-gapped customers**: We can provide a signed manifest file + the license key for manual application. The updater sidecar or manual `docker compose` flow can still be used.
- **Lost keys**: The static site (or a thin lookup page backed by the entitlement service) allows the customer to retrieve their key again by providing their Stripe customer id or payment reference. The service looks it up in Stripe and re-issues the same signed token.
- **Refunds / chargebacks**: The entitlement service can mark a key as invalid on refund. Already-running instances that have accepted the key may continue (depending on policy), but new update checks will fail.

---

## 9. Enforcement realities and limitations

- The customer controls the host, database, clock, and container. Tampering with the first-use timestamp or removing the license marker is possible for a determined attacker.
- We make tampering *obvious and annoying* (multiple storage locations for the first-use date and license flag, signature verification, clear UI messaging) but we do not claim cryptographic or unbreakable enforcement.
- The goal is to create a fair "try before you buy" + pay-to-own experience for normal users while keeping the post-licensing promise that a purchased version never stops working.

---

## 10. Alignment with existing documentation

- [Self-Hosted-Update-Delivery.md](./Self-Hosted-Update-Delivery.md) describes the post-licensing world (signed images, updater sidecar, manifest-based updates, "never disable the running app").
- This document adds the transitional 30-day trial and the mechanism that forces payment to exit the trial.
- After a paid license key is successfully entered, the instance is treated as licensed and the rules from Self-Hosted-Update-Delivery.md apply fully.

---

## 11. Open questions / future work

- Exact license token format (JWT vs. compact custom format) and claims to include.
- Whether maintenance is sold as a recurring subscription or as renewable one-year licenses.
- How aggressively to re-verify keys against Stripe (every update check vs. only on first entry + periodic).
- Grace period / messaging during the final days of the trial.
- Exact copy and UX for the paywall screen inside the app.
- Support for bulk / enterprise licensing (multiple instances under one key, or per-instance keys).

These can be refined when the separate entitlement service is implemented.
