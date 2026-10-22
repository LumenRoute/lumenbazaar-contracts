# Local validation for issue #146

Check explicit release mappings across contract manifests/Cargo.lock, interface/storage constants, binding package/lock/generator versions and public deployment schema. Validate patch/additive/migration rules, migration evidence and finalized changelog headings before tagging.

Closes #146 in PR #168.

## Validated source

- Commit: `54f331ef60d5482850505c094775ff5dc359e2eb`
- Tree: `89c3c3d2ef1cd93b02221c49e316d85dcd0833e8`
- Clean tracked checkout at suite start and finish.
- All **35 check groups passed**, with **186 Rust tests** and **64 Node tests**.
- Includes seven release-version regression tests and the release mapping CLI.
- This validation-only documentation commit changes no tested source or build configuration.

## Check coverage

Formatting; workspace Clippy with warnings denied; all workspace tests with 128
property cases; Rust/npm audits; fresh resource measurements and budgets; escrow
model checking; deployment dry-run; native differential fixtures; optimized WASM
builds and size gate; SBOM/provenance; generated spec/binding drift checks;
TypeScript build and binding smoke; receipt/interface/event/ABI/domain/backend,
security/audit and published deployment/lifecycle evidence checks; all Node tests.

Rust audit uses only the repository's existing documented RUSTSEC-2024-0436
exception. npm reports zero vulnerabilities. Additional shared read-only network
checks passed: five live native/RPC differential fixtures and all 50 published
Horizon transactions (six simulation-only rejections have no transaction).

## Shared prerequisite repair

The inherited develop commit `795f5ea` could not compile. Shared commits
`bd1f6fe` and `c62ecf5` complete interrupted definitions, restore nine interleaved
tests from their feature commits, preserve error meanings 1-37, allocate unique
new codes 38-49, and regenerate the current spec, bindings, 19-event fixture and
audit freeze. The historical v2 baseline and published deployment evidence are
unchanged. See [validation repairs](../validation-repairs.md).

Fresh merged-feature costs exceeded stale budgets. The
[budget proposal](../wasm-size-reviews/2026-10-22-merged-features.md) records the
old/new measurements and feature-commit rationale. Existing percentage headroom
and zero-field invariants are retained; no CI gate is disabled and no override
flag is enabled. **Maintainer approval is pending.**

## Toolchain and platform limits

Rust 1.93.1 (Windows GNU), Node 22.12.0, Stellar CLI 28.0.0, cargo-audit 0.22.2
and Soroban SDK 28.0.0. Windows native checks temporarily select rlib-only
manifests to avoid Windows' DLL export limit. Every source/test is retained;
original manifests are restored before WASM and release/artifact checks.

Hosted Linux CI awaits maintainer approval for fork workflows. Local Windows
results do not claim that hosted Linux CI ran. The budget proposal requires
maintainer review before merge. No deployment or state-changing live transaction
was performed.
