## Description

Explain what changed, why the change is needed, and its contract or integration impact.

## Related issue

Closes #[issue number]

<!-- Replace [issue number] with the assigned issue number. -->

## Type of change

- [ ] Contract feature
- [ ] Bug or security fix
- [ ] Refactor
- [ ] Documentation
- [ ] Test, deployment, or build improvement

## Changes made

-
-

## Validation

- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- [ ] `cargo test --workspace --all-features`
- [ ] `stellar contract build --locked`
- [ ] Generated specifications and bindings have no unexplained diff.

## Security and privacy

- [ ] No secret keys, seed phrases, or deployment keys were added.
- [ ] Authorization, cap, expiry, replay, storage, and asset-trust effects were considered.
- [ ] Public evidence contains only intentionally disclosed testnet data.
- [ ] Documentation matches implemented contract behavior.
