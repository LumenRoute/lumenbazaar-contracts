# LumenBazaar Contracts

Soroban contracts for capped metered x402 `upto` payment sessions, optional
smart-wallet policy examples, test token utilities, generated bindings,
deployment scripts, and contract security evidence.

## Contracts

```txt
contracts/
  upto-session/
  policy-wallet-example/
  test-token/
```

The first production-oriented contract is `upto-session`. It lets a buyer
authorize a maximum spend for one resource while the seller settles only the
actual usage amount.

`policy-wallet-example` is example-only smart account policy code.

`test-token` is reserved for local and testnet utility token behavior.

## Local Verification

Contract WASM builds require `stellar-cli` 25.2.0 or newer.

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
stellar contract build --locked
```

## Local Deployment

Set a local Stellar network in the CLI, then run:

```bash
node scripts/local/deploy-local.mjs
node scripts/local/initialize-local.mjs
```

Use `--dry-run` with either script to print commands without submitting transactions. See `scripts/local/sample-commands.md` for create, settle, cancel, and inspect examples.

## Testnet Deployment

Export the values from `.env.testnet.example`, then run:

```bash
node scripts/testnet/deploy-testnet.mjs
node scripts/testnet/initialize-testnet.mjs
node scripts/testnet/verify-testnet.mjs
```

The scripts write `deployments/testnet.json`, which is ignored until a reviewed deployment is ready to publish.
