# Local validation for issue #144

Validated source commit: `a90be188c199923fdd85bd3bbb682ac677b38594`. The following validation-only documentation commit does not change tested source or build configuration.

## Description
Centralize structured deployment logging and redact configured secrets, signer arguments, multiline and encoded values, and dry-run manifest snapshots. Preserve public account IDs, transaction hashes and contract errors.

Closes #144.

## Shared prerequisite repair
The inherited develop commit `795f5ea` could not compile. This PR includes shared repair commits `bd1f6fe` and `c62ecf5`: complete interrupted definitions, restore nine interleaved tests from original feature commits, preserve error meanings 1–37 and allocate unique new codes 38–49, and regenerate the current spec, bindings, event fixture and audit freeze. The historical v2 release baseline and published deployment evidence remain unchanged.

Fresh merged-feature measurements exceeded stale budgets. [The proposed budget refresh](https://github.com/Mintworx/lumenbazaar-contracts/blob/a90be188c199923fdd85bd3bbb682ac677b38594/docs/wasm-size-reviews/2026-10-22-merged-features.md) records old/new costs, feature rationale and unchanged percentage headroom. **Maintainer approval is pending; this is not an approved override.** No CI gate is disabled.

## Validation
Validated clean commit `a90be188c199923fdd85bd3bbb682ac677b38594` with Rust 1.93.1, Node 22.12.0, Stellar CLI 28.0.0 and cargo-audit 0.22.2:
- All 34 local check groups passed.
- Formatting and workspace Clippy with warnings denied passed.
- All 186 workspace Rust tests passed, including 128 property cases.
- All 63 Node tests passed, including six deployment-log regression tests.
- Rust audit passed with only the existing documented RUSTSEC-2024-0436 exception; npm audit reported zero vulnerabilities.
- Optimized WASM, measured resource/size budgets, model checking, spec/binding drift checks, TypeScript build/smoke tests, SBOM/provenance, ABI/event/interface and security/deployment evidence checks passed.
- Live read-only checks passed: five native/RPC differential fixtures and all 50 published Horizon transactions.

Windows native checks use a temporary rlib-only manifest adapter to avoid Windows' DLL export limit; every source/test is retained and manifests are restored before WASM/release checks. [Platform details](https://github.com/Mintworx/lumenbazaar-contracts/blob/a90be188c199923fdd85bd3bbb682ac677b38594/docs/validation-repairs.md).

## Remaining review
Hosted Linux CI awaits maintainer approval for fork workflows. The proposed budget refresh requires maintainer review before merge. No deployment or state-changing live transaction was performed.
