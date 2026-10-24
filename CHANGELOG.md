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

### Security

- Redact signer material and configured secret values from CLI diagnostics and dry-run logs.
  Compatibility: no contract interface change. Migration: none.

### Fixed

- Bound transaction finality polling by deadline and attempt budget, preserving distinct
  success, failure, expiry and timeout evidence. Compatibility: receipt schema unchanged.
  Migration: none.

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
- Require positive per-asset and per-buyer aggregate exposure ceilings, enforce them before buyer authorization, and release them on every terminal path.
- Add a read-only, authorization-free per-asset solvency snapshot query.
- Add owner-authorized policy revocation to the example policy wallet.
- Add branch, review, ownership, release, and emergency-change governance.
- Generate sanitized, deterministic public deployment manifests from network receipts with an
  allowlist and a pre-write secret scan.
- Publish live on-ledger wrong-seller, wrong-buyer, over-cap, and expiry-boundary rejection evidence
  on testnet.
- Verify every published testnet transaction against Horizon in a scheduled, PR-independent workflow.
- Add admin-authorized `activate_asset` for onboarding a reviewed asset after initialization, with errors 36 to 38 for duplicate, deprecated, and over-limit assets.
- Make `remove_asset` delete the asset's cap, zero liability record, and entry in the configured asset order; hide stale entries from earlier removals.
- Add the read-only, versioned `get_asset_policy` lifecycle query.
- Add typed TypeScript contract error decoding (`decodeContractError`, `CONTRACT_ERROR_CODES`) with a generation-time drift check against the interface fixture.
- Add deterministic ledger-boundary tests for config, sequence, session, and liability TTL and document the boundary semantics.
- Add state-transition and cap-invariant property tests with documented reproducible seeds.
- Add an opt-in live testnet lifecycle smoke runner that emits a sanitized JSON report, plus an offline test suite and report checker.

## v0.2.0-testnet.20261007

- Publish escrow-funded `upto` session version 2 with cancellation and expiry recovery.
- Publish reproducible WASM, generated bindings/interface, deployment evidence, and lifecycle proof.
