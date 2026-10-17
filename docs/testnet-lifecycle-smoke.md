# Live Testnet Lifecycle Smoke Runner

`scripts/testnet/smoke-lifecycle.mjs` submits a small, bounded `upto` lifecycle to the corrected v2
testnet deployment and writes a sanitized JSON report. It adds create, settle, cancel, and replay
evidence to the deploy and initialize evidence already published in
`deployments/testnet-2026-10-07.json`. It is testnet-only and makes no mainnet claim.

## Opt-in behavior

- No flags: prints the plan. No network access, signing, or transactions.
- `--execute` without `LUMENBAZAAR_LIVE_SMOKE=1`: refuses to run.
- `STELLAR_NETWORK` other than `testnet`, a non-testnet RPC URL, or a non-testnet manifest: refuses.
- A dirty tracked working tree: refuses unless `--allow-dirty`, and the report records
  `sourceTreeClean`.

## What a run does

1. Resolves public accounts for three local Stellar CLI identities (buyer, seller, test-token admin).
2. Checks `interface_version`, the per-asset cap, and starting balances with read-only calls.
3. Mints only the shortfall of test-only LBT to the buyer.
4. Session A: `create_session`, then `settle` for a partial amount, then a replayed `settle`, which
   must be rejected with `#6 SessionAlreadySettled` (no transaction is submitted for a rejection).
5. Session B (a separate session): `create_session`, then `cancel`.
6. Confirms both terminal statuses and token conservation, then validates the report.

Each submitted transaction is confirmed through the testnet RPC `getTransaction`, so the report
carries the transaction hash, ledger, and close time. A run aborts on any unexpected result,
including a replay that succeeds or fails for a different reason.

## Run it

Install Stellar CLI 28.0.0 (see `docs/release-toolchain.md`) and create three funded testnet
identities with `stellar keys generate --fund`. Then:

```bash
export LUMENBAZAAR_LIVE_SMOKE=1
export LUMENBAZAAR_SMOKE_BUYER=<buyer-identity-alias>
export LUMENBAZAAR_SMOKE_SELLER=<seller-identity-alias>
export LUMENBAZAAR_SMOKE_TOKEN_ADMIN=<token-admin-identity-alias>
node scripts/testnet/smoke-lifecycle.mjs --execute
node scripts/check-testnet-smoke.mjs target/testnet-smoke/lifecycle-<run-id>.json
```

The token-admin alias must be the admin that initialized the deployed LBT token. Optional bounds:
`LUMENBAZAAR_SMOKE_CAP` (default 10,000,000; at most 100,000,000), `LUMENBAZAAR_SMOKE_SETTLE_AMOUNT`
(default 65% of the cap), `LUMENBAZAAR_SMOKE_EXPIRY_WINDOW` (60 to 5,000 ledgers, default 300), and
`--output <path>`.

## Report contents and sanitization

The report (`kind: lumenbazaar-testnet-upto-lifecycle-smoke`) holds the source commit, contract IDs,
public account addresses, session IDs, create/settle/cancel transaction hashes and ledgers, the
rejected replay with its observed ledger, balances before and after, and replay commands. Identity
aliases are replaced by placeholders in recorded commands. The runner takes aliases only: it rejects
secret-seed-shaped values and never reads or writes key material. `validateReport` additionally
rejects secret seeds, local paths, a missing source commit, a mainnet claim, a missing replay
rejection, and non-conserving balances.

## Offline tests

`node --test scripts/test-testnet-smoke.mjs` runs the whole orchestration against an in-memory
Stellar CLI and RPC fake. It needs no network and runs in CI. The live CLI output format
(transaction hash lines on stderr) is parsed strictly; if a CLI version changes it, the runner fails
closed instead of recording unverified evidence.
