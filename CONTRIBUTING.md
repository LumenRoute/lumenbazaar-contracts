# Contributing

LumenBazaar contracts are intentionally narrow. Put logic on-chain only when the
project needs contract-level enforcement.

## Local Checks

Run these commands before opening a pull request:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
stellar contract build --locked
```

## Scope

- Keep `upto-session` focused on capped metered payment sessions.
- Keep exact x402 payments contract-free where Stellar Asset Contract behavior
  and Soroban authorization entries are sufficient.
- Keep `policy-wallet-example` clearly marked as example code.
- Add regression tests for every authorization, cap, expiry, and settlement rule.
