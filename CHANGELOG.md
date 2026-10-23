# Changelog

## Unreleased

### Breaking

- Reconcile the unreleased v3 generated interface with merged contract source, including
  administrative reason commitments and the completed feature definitions.
  Compatibility: breaking for consumers of stale unreleased v3 bindings; released v2
  deployments retain their original contract IDs and error meanings.
  Migration: [v2-to-v3 replacement routing](artifacts/interface/migrations/v2-to-v3.json).

### Fixed

- Refresh stale resource and WASM budgets from the restored merged-feature build,
  retaining existing percentage headroom and documenting every changed ceiling.
  Compatibility: no additional wire change; proposed budgets require maintainer review.
  Migration: none; see [budget proposal](docs/wasm-size-reviews/2026-10-22-merged-features.md).

- Repair interrupted merged contract definitions, restore interleaved regression tests,
  and assign unique codes to unreleased error additions while preserving published codes.
  Compatibility: existing checked-in error meanings retained; new feature errors are additive.
  Migration: none for existing deployments; see [validation repairs](docs/validation-repairs.md).

### Added

- Check explicit release-version mappings across contract crates, bindings, interface,
  storage and deployment schema before tagging. Compatibility: tooling only. Migration: none.

- Require categorized release notes for contract-facing diffs and migration references for
  breaking ABI changes. Compatibility: tooling only. Migration: none.

- Require a positive maximum session amount for every supported asset.
- Enforce asset caps before buyer authorization and escrow transfer.
- Add authenticated cap updates, a public cap query, and versioned update events.
- Add two-step administrator proposal, acceptance, cancellation, expiry, and query behavior.
- Preserve the current administrator's exclusive privileges until explicit acceptance.
- Add a supported-asset escrow liability query for custody reconciliation.
- Add branch, review, ownership, release, and emergency-change governance.
- Generate sanitized, deterministic public deployment manifests from network receipts with an
  allowlist and a pre-write secret scan.
- Publish live on-ledger wrong-seller, wrong-buyer, over-cap, and expiry-boundary rejection evidence
  on testnet.
- Verify every published testnet transaction against Horizon in a scheduled, PR-independent workflow.

## v0.2.0-testnet.20261007

- Publish escrow-funded `upto` session version 2 with cancellation and expiry recovery.
- Publish reproducible WASM, generated bindings/interface, deployment evidence, and lifecycle proof.
