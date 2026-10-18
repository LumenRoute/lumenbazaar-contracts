# Changelog

## Unreleased

- Require a positive maximum session amount for every supported asset.
- Enforce asset caps before buyer authorization and escrow transfer.
- Add authenticated cap updates, a public cap query, and versioned update events.
- Add two-step administrator proposal, acceptance, cancellation, expiry, and query behavior.
- Preserve the current administrator's exclusive privileges until explicit acceptance.
- Add a supported-asset escrow liability query for custody reconciliation.
- Add branch, review, ownership, release, and emergency-change governance.
- Add admin-authorized `activate_asset` for onboarding a reviewed asset after initialization, with errors 36 to 38 for duplicate, deprecated, and over-limit assets.
- Make `remove_asset` delete the asset's cap, zero liability record, and entry in the configured asset order; hide stale entries from earlier removals.
- Add the read-only, versioned `get_asset_policy` lifecycle query.
- Add typed TypeScript contract error decoding (`decodeContractError`, `CONTRACT_ERROR_CODES`) with a generation-time drift check against the interface fixture.

## v0.2.0-testnet.20261007

- Publish escrow-funded `upto` session version 2 with cancellation and expiry recovery.
- Publish reproducible WASM, generated bindings/interface, deployment evidence, and lifecycle proof.
