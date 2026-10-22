# Validation repairs for the merged development branch

Full validation of issues #144–#147 exposed syntax and integration damage already
present in development commit `795f5ea`. The tooling fixes are accompanied by a
shared prerequisite repair so their required checks can run.

- Close the interrupted cap-proposal, cap-query, event and storage definitions.
- Remove duplicated imports introduced by overlapping feature merges.
- Restore nine interleaved test bodies from the original feature commits:
  `1695404` (asset minimum), `69c943d` (seller exposure), `7a752d7` (buyer limit),
  `c5fa5c8` (seller limit), `ac903e0` (cap reduction), and `45ae985` (creation pause).
- Preserve every error code in the checked-in interface (1–37), including
  `CreationPaused = 36` and `OperationalStateUnchanged = 37`. Allocate unique
  codes 38–49 to the additional, previously unbuildable merged features instead
  of allowing multiple meanings for the same error code.
- Use LF for repository source files so the pinned Unix-newline formatting rule
  works on Windows checkouts as well as Linux CI.

## Windows native validation

Test-enabled Soroban dependencies exceed Windows' 65,535 DLL export-ordinal limit
when Cargo also emits a native `cdylib`. Local Windows native checks temporarily
select `rlib` in the three contract manifests, run the complete test or lint
command, and restore the original manifests. No test or contract source is
excluded. The repository retains `cdylib` because Stellar CLI uses that setting
to discover release contracts. WASM, generated artifacts and release checks run
with the original manifests. Linux CI must still run on the submitted commit;
Windows validation does not claim to replace that platform check.

These repairs do not authorize deployment or replace maintainer review. Historical
deployment manifests and the v2 release baseline remain unchanged. Regenerated
current specifications, bindings and event fixtures must be reviewed alongside
the restored source. Existing v2 sessions must continue to use the replacement
routing described in `artifacts/interface/migrations/v2-to-v3.json`.
