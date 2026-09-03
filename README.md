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

## Local Verification

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
stellar contract build --locked
```
