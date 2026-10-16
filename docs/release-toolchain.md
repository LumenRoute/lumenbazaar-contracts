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

## Release SBOM and Build Provenance

`node scripts/generate-provenance.mjs` runs after `stellar contract build` and writes
two machine-readable artifacts under `artifacts/provenance/`:

- `sbom.cdx.json` — a CycloneDX 1.5 document listing every crate in `Cargo.lock`
  (first-party workspace crates plus transitive registry crates) with version,
  registry `purl`, and the recorded registry checksum.
- `build-provenance.json` — binds each released WASM to the source commit, the
  `Cargo.lock` digest, the pinned toolchain identity, and the artifact SHA-256 and
  size.

`node scripts/check-provenance.mjs` recomputes every digest from the checked-out
source, the pinned `rust-toolchain.toml`, and the built WASM, and exits non-zero when
an artifact is missing, a checksum or size drifts, the lockfile or toolchain no longer
matches, a transitive crate is dropped from the SBOM, or a built WASM has no
provenance entry. Verification is fully offline and requires no private service.

CI runs the provenance unit tests and both scripts on every pull request and release
build, and uploads `artifacts/provenance` for reviewers. Provenance is supply-chain
evidence that a released artifact matches a reviewed source and toolchain; it does not
replace code review or an external security audit.
