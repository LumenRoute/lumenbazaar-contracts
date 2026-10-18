# Changelog

## Unreleased

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

## v0.2.0-testnet.20261007

- Publish escrow-funded `upto` session version 2 with cancellation and expiry recovery.
- Publish reproducible WASM, generated bindings/interface, deployment evidence, and lifecycle proof.
