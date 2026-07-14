# THNIC EPP integration — requirements & rollout (BLOCKED)

Status: **blocked on external credentials.** The `.th` ccTLD adapter
(`services/reseller-api/internal/registry/thnic.go`) is intentionally a stub.
This document records exactly what is needed to make it live so the work can
resume the moment F2 has a registrar relationship with THNIC (T.H.NIC).

## Why it's blocked

Unlike ResellerClub (a simple authenticated HTTP API — already live in
`resellerclub.go`), THNIC's registry uses **EPP (Extensible Provisioning
Protocol) over TLS with mutual authentication (mTLS)**. That requires:

1. A **registrar/reseller agreement** with T.H.NIC (business + legal step).
2. **EPP credentials**: a registrar login + password.
3. An **mTLS client certificate + private key** issued/registered with THNIC,
   and their EPP host allow-listing our egress IP.
4. Access to the **OT&E / test EPP environment** first, then production.

None of these exist today, so no code path can be verified. Everything below
is the plan, not a to-do we can start unilaterally.

## What it unlocks

The three `Registry` interface methods, mapped to EPP commands:

| Adapter method (registry.go) | EPP command | Purpose |
|---|---|---|
| `CheckAvailability` | `domain:check` | real `.th` availability (today: returns `ClassManual`) |
| `Register` | `domain:create` (+ `contact:create`) | place `.th` orders programmatically (today: "approved", staff finish in the portal) |
| `GetDetails` | `domain:info` | authoritative expiry for the renewal engine (today: `ErrSyncUnsupported`) |

`GetDetails` is the one that matters for the recurring-renewal system: once
wired, `.th` domains would auto-sync `customer_domains.expires_at` through the
same `DomainSyncer` that already handles ResellerClub — closing the last
manual gap for Thai domains.

## Implementation plan (when credentials land)

1. **Config** (`internal/config/config.go`): add `THNIC_EPP_HOST`,
   `THNIC_EPP_USER`, `THNIC_EPP_PASSWORD`, `THNIC_EPP_CLIENT_CERT`,
   `THNIC_EPP_CLIENT_KEY`, plus a `THNICConfigured()` gate mirroring
   `RCConfigured()`.
2. **EPP client** (`internal/registry/epp/`): a small EPP-over-TLS client —
   `tls.Dial` with the client cert, EPP greeting + `<login>`, then
   length-prefixed XML frames for `check` / `create` / `info`. Parse the
   `<domain:exDate>` from `info` responses into `DomainDetails.ExpiresAt`.
3. **Adapter** (`thnic.go`): replace the stub bodies at the three marked
   boundaries with EPP calls; keep the manual fallback when
   `!THNICConfigured()` so dev/CI without creds still works.
4. **Wire-up** (`cmd/server/main.go`): construct the real THNIC adapter when
   configured, else keep `THNICStub{}` — same pattern as ResellerClub.
5. **Verify** against OT&E: a `domain:check` on a known name, a `domain:info`
   on an F2-held `.th`, and confirm the sync worker writes back `expires_at`
   in `notify` mode before enabling `write`.

## Interim behavior (today)

`.th` renewals still work end-to-end on the manual path: the renewal engine
sends notices and issues invoices off `customer_domains.expires_at`; staff
renew via the THNIC partner portal and update the expiry date in
`/admin/customers/[id]`. The registrar-sync automation simply skips `.th`
(`ErrSyncUnsupported`) until this integration is built.
