# Release Toolchain

Contract release and audit evidence must use the following exact toolchain:

| Component | Version | Enforcement |
| --- | --- | --- |
| Rust | 1.93.1 | `rust-toolchain.toml` and CI |
| WASM target | `wasm32v1-none` from Rust 1.93.1 | `rust-toolchain.toml` and CI |
| Soroban SDK | 28.0.0 | Workspace dependency and `Cargo.lock` |
| Stellar CLI | 28.0.0 | CI release archive |
| Node.js | 22.12.0 | CI setup |
| cargo-audit | 0.22.2 | CI install command |
| generated Stellar SDK | 17.2.1 | Binding generator output |

## Dependency Audit Policy

CI runs `cargo audit --deny warnings` and `npm audit --omit=dev`. A Rust advisory may be ignored only when it has a matching record in `audits/dependency-exceptions.json` with an owner, dependency path, risk statement, planned resolution, and future expiry date. The exception checker fails on expired, duplicate, malformed, or incomplete records.

The current `RUSTSEC-2024-0436` exception covers the unmaintained `paste` crate inherited through released Soroban host-side dependencies. It is not a vulnerability report and the package is absent from deployed contract WASM. Contracts maintainers must remove the ignore as soon as a compatible Soroban release removes the dependency, and no later than the recorded recheck date without a fresh review.

The generated TypeScript binding pins Stellar SDK 17.2.1 because the CLI-generated 16.x range resolves Axios versions with published high-severity advisories. Regeneration reapplies the reviewed version so the package cannot silently regress.

## Resource and Rent Regression Guardrails

`node scripts/report-resource-usage.mjs` runs one native invocation of each lifecycle method
(`create_session`, `settle`, `cancel`, `recover_expired`, `extend_ttl`) and records the Soroban
cost estimate for each. The report separates work that does not touch ledger entries (instruction
and memory counters) from ledger footprint and TTL cost (`write_bytes`, `disk_read_bytes`,
`contract_events_size_bytes`, persistent and temporary rent ledger bytes and bump counts, and the
estimated fee), so a compute regression and a storage/rent regression are distinguishable.

`artifacts/resource-usage/thresholds.json` records the reviewed ceiling for every measured field.
`node scripts/check-resource-budgets.mjs` fails when a lifecycle method is missing from the report,
a measured field is absent, or a field exceeds its reviewed ceiling. Ceilings are the reviewed
native baseline plus headroom; update them only when a change to the measured behaviour is
intentional and reviewed, and record the reviewer, date, and rationale in the file.

Native estimates are deterministic for the pinned SDK but they are **not** a deployment quote:
they measure local host execution, not RPC simulation or live ledger rent on the target network.
Use them for regression tracking, and run RPC simulation before production fee budgeting. The
scheduled native/RPC differential in `docs/native-rpc-differential.md` is the complementary check.

