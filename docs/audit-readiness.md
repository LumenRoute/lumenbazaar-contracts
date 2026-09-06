# Audit Readiness

This package describes the current review boundary for LumenBazaar contracts.

## Public Interface Freeze

The review target is the `upto-session` contract public interface:

- `initialize(admin)`
- `create_session(buyer, seller, asset, max_amount, expires_at_ledger, resource_hash)`
- `get_session(session_id)`
- `settle(session_id, actual_amount, usage_hash)`
- `cancel(session_id)`
- `extend_ttl(session_id)`

The frozen interface evidence is stored in `artifacts/audit-readiness/interface-freeze.json`. It hashes the public contract files, generated XDR spec, and generated TypeScript binding.

Regenerate only after an intentional interface change:

```bash
node scripts/generate-audit-freeze.mjs
node scripts/check-audit-readiness.mjs
```

## Known Limitations

- No mainnet deployment is approved by this repository.
- Testnet IDs are not committed until a reviewed deployment is intentionally published.
- Local SDK resource usage is a regression signal, not a replacement for target-network RPC simulation.
- `policy-wallet-example` is example-only smart account policy code and is not production wallet infrastructure.
- `test-token` is utility code for local and testnet testing and is not a production asset.
- Canonical `resource_hash` and `usage_hash` payload storage is a backend responsibility.

## Threat Model

Protected assets:

- Buyer token balances covered by capped sessions.
- Seller settlement rights for actual usage.
- Session state, expiry, and finalization status.
- Backend hash records used to prove resource and usage details.

Trusted actors:

- Buyer signs session creation and cancellation.
- Seller signs settlement.
- Deployment admin initializes contracts.
- Backend records canonical resource and usage payloads.

Threats covered by current tests:

- Unauthorized creation, settlement, cancellation, or initialization.
- Settlement above cap.
- Double settlement or settlement after cancellation.
- Settlement after expiry.
- Invalid seller or asset binding.
- Event topic or payload drift.

Out of scope until later review:

- Production smart wallet custody.
- Mainnet operational signing.
- Backend replay protection outside contract state.
- Marketplace policy enforcement outside the `upto-session` contract.

## Test Coverage

The current workspace test suite covers:

- `upto-session`: 49 tests.
- `policy-wallet-example`: 16 tests.
- `test-token`: 5 tests.

Primary evidence:

- `docs/security-checklist.md`
- `artifacts/resource-usage/upto-session.md`
- `docs/backend-integration-handoff.md`

## Deployment Procedure

Before deployment:

1. Run `cargo fmt --all -- --check`.
2. Run `cargo clippy --workspace --all-targets --all-features -- -D warnings`.
3. Run `cargo test --workspace --all-features`.
4. Run `stellar contract build --locked`.
5. Run `node scripts/generate-specs.mjs --skip-build` and check no spec drift.
6. Run `node scripts/generate-bindings.mjs --skip-build` and check no binding drift.
7. Run `node scripts/check-backend-handoff.mjs`.
8. Run `node scripts/check-security-checklist.mjs`.
9. Run `node scripts/check-audit-readiness.mjs`.

Local deployment:

```bash
node scripts/local/deploy-local.mjs
node scripts/local/initialize-local.mjs
```

Testnet deployment:

```bash
node scripts/testnet/deploy-testnet.mjs
node scripts/testnet/initialize-testnet.mjs
node scripts/testnet/verify-testnet.mjs
```

Mainnet deployment is intentionally not scripted as an automatic path in this review package.
