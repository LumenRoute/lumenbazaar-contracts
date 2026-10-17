# Changelog

## Unreleased

- Require a positive maximum session amount for every supported asset.
- Enforce asset caps before buyer authorization and escrow transfer.
- Add authenticated cap updates, a public cap query, and versioned update events.
- Add two-step administrator proposal, acceptance, cancellation, expiry, and query behavior.
- Preserve the current administrator's exclusive privileges until explicit acceptance.
- Add a supported-asset escrow liability query for custody reconciliation.
- Add branch, review, ownership, release, and emergency-change governance.
- Add deterministic ledger-boundary tests for config, sequence, session, and liability TTL and document the boundary semantics.
- Add state-transition and cap-invariant property tests with documented reproducible seeds.
- Add an opt-in live testnet lifecycle smoke runner that emits a sanitized JSON report, plus an offline test suite and report checker.

## v0.2.0-testnet.20261007

- Publish escrow-funded `upto` session version 2 with cancellation and expiry recovery.
- Publish reproducible WASM, generated bindings/interface, deployment evidence, and lifecycle proof.
