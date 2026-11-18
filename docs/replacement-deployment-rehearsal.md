# Replacement Deployment Rehearsal

`upto-session` is immutable through its public interface. Replacing it requires
a second deployment and explicit client routing; session IDs are not portable
between contract IDs.

Run the deterministic routing checks and command rehearsal without a network:

```bash
node --test scripts/local/replacement-routing.test.mjs
node --test scripts/local/cross-version-traces.test.mjs
node scripts/local/cross-version-traces.mjs
node scripts/local/rehearse-replacement.mjs --dry-run
cargo test -p escrow-model -- --nocapture
```

## Cross-Version Behavioral Differential Traces

ABI compatibility between `upto-session-v2.json` and `upto-session-v3.json` is necessary but not sufficient for replacement deployments. `artifacts/interface/cross-version-behavior-traces.json` captures deterministic behavioral traces across every shared v2/v3 operation (`interface_version`, `initialize`, `create_session`, `get_session`, `settle`, `cancel`, `recover_expired`, and `extend_ttl`) and compares normalized results, error codes, events, token balances, escrow liabilities, and terminal session states:

- **Explicit Version Difference Fixtures (`expectedDifferences`)**:
  - `diff-interface-version`: `interface_version()` returns `2` on v2 and `3` on v3.
  - `diff-initialize-asset-policies-and-event`: v3 probes SEP-41 token metadata, configures `AssetPolicy` / `AssetStatus::Active`, and emits `AssetActivated` (`event_version: 3`).
  - `diff-create-session-domain-id`: v3 derives domain-separated session IDs binding protocol domain, interface version, network ID, contract address, and per-buyer `idempotency_key`.
  - `diff-session-audit-metadata`: v3 appends `creation_ledger`, `finalized_ledger`, `resource_scheme_version`, and `usage_scheme_version` to `Session` while preserving all shared v2 session fields and transitions.
- **No Cross-Deployment Identifier Reinterpretation**: Session IDs are deployment-scoped. Replaying a v2 session ID against a v3 deployment (or vice versa) is rejected before execution.
- **Fail-Closed Verification**: Any unapproved state, balance, liability, error code, or event divergence fails `scripts/local/cross-version-traces.mjs` and `cargo test -p escrow-model`.

For the live local rehearsal, start Stellar Quickstart, configure the exact
release toolchain, and provide separate buyer and seller identities:

```bash
export LUMENBAZAAR_REHEARSAL_BUYER_ACCOUNT=local-buyer
export LUMENBAZAAR_REHEARSAL_BUYER_ADDRESS=G...
export LUMENBAZAAR_REHEARSAL_SELLER_ADDRESS=G...
node scripts/local/rehearse-replacement.mjs
```

`LUMENBAZAAR_REHEARSAL_OLD_WASM` and
`LUMENBAZAAR_REHEARSAL_NEW_WASM` may select different reviewed artifacts. By
default the script deploys the current artifact twice, which isolates routing
and rollback behavior from bytecode changes.

The script deploys unique old and replacement contract IDs, creates an open old
session, switches the active integration configuration, creates a replacement
session, and verifies each session only against its originating contract. It
then rolls the active configuration back to the old deployment without changing
either recorded session route, returns to the replacement, and marks the old
deployment as unavailable for new sessions. Live evidence is written under
`target/rehearsals/`, which is intentionally untracked.

Backend storage must persist both `session_id` and `contract_id`. Never derive
an existing session's destination from the current active contract setting.
Deprecation is an integration policy: old sessions remain readable and retain
their original interface behavior, while new sessions use the replacement.

The production procedure that this rehearsal exercises, including cutover order, open-session
drain, rollback rules, and deprecation windows, is in
[deployment-migration.md](deployment-migration.md).
