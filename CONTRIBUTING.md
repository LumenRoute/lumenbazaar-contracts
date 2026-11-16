# Contributing

LumenBazaar contracts are intentionally narrow. Put logic on-chain only when the
project needs contract-level enforcement.

## Local Checks

Install `stellar-cli` 25.2.0 or newer before building contract WASM files.

Run these commands before opening a pull request:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
stellar contract build --locked
```

Enable the repository hook and run the dependency-free Python malware checks before pushing:

```bash
git config core.hooksPath .githooks
cargo security-malware-scan
cargo security-malware-test
```
## Scope

- Keep `upto-session` focused on capped metered payment sessions.
- Keep exact x402 payments contract-free where Stellar Asset Contract behavior
  and Soroban authorization entries are sufficient.
- Keep `policy-wallet-example` clearly marked as example code.
- Add regression tests for every authorization, cap, expiry, and settlement rule.
