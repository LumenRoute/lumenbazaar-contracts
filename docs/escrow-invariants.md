# Escrow Invariants

The `upto-session` storage layout version 2 uses full-cap escrow. A successful
`create_session` transfers `max_amount` from the authenticated buyer to the
contract before the session is stored as open.

For every supported asset `a`:

```text
liability[a] = sum(session.escrowed_amount for every open session using a)
token.balance(contract, a) >= liability[a]
```

`get_escrow_liability(a)` exposes the first value for supported assets without
enumerating sessions. It returns the stored aggregate maintained by checked
arithmetic. The token balance remains a separate token-contract query so
integrators can reconcile custody against accounting.

Creation, liability accounting, session storage, and event publication execute
in one Soroban transaction. A failed authorization, insufficient token balance,
arithmetic error, or under-collateralization check rolls the complete invocation
back. The sequence number therefore cannot be consumed by a failed creation.

Settlement removes the session's full escrow liability, pays only the recorded
seller, refunds the unused cap to the recorded buyer, clears
`escrowed_amount`, and writes the terminal state in the same invocation.
Cancellation removes the same liability and returns the entire escrow to the
recorded buyer.

Cancellation is available only before expiry. At the exact expiry ledger and
afterward, `recover_expired` is permissionless but has no recipient or amount
arguments: it always refunds the complete escrow to the stored buyer and marks
the session `Expired`. Settlement, cancellation, and recovery are mutually
exclusive terminal paths.

Before either terminal transfer, the contract checks that the stored open
session still carries its complete cap and that the contract token balance
covers the aggregate liability for that asset. A failed check returns
`EscrowUnderfunded` before liability or session state changes.

Asset policies are established at initialization. Each supported asset has a
positive explicit session cap; authenticated cap changes affect only later
creation and do not rewrite stored sessions. Assets follow an explicit lifecycle:
active assets can be deprecated by the administrator, which immediately rejects
new session creations while preserving every terminal exit (settle, cancel,
recover) for existing open sessions. A deprecated asset can only be removed once
its aggregate liability reaches zero.

Administrator authority follows a two-step expiring rotation. The current
administrator proposes a pending administrator with an expiration ledger. Only the
pending administrator can accept the rotation before the expiration ledger, which
atomically transfers administrator privileges. The current administrator may
cancel a pending rotation at any time before acceptance.

Each session ID commits to buyer, seller, asset, cap, expiry, resource hash, and
the contract sequence. No caller supplies a payout source or destination at
settlement, so the contract cannot act as a deputy for another account and one
session cannot use another session's authorization or parameters. Full-cap escrow
avoids shared allowance leakage and makes seller-only deferred settlement
enforceable.

Contract-to-token calls do not introduce a callback into `upto-session`; state
changes and token movements remain atomic under Soroban transaction semantics.
All arithmetic that changes aggregate liabilities uses checked operations.

Creation events use `event_version = 2` and expose only public settlement
metadata. Resource and usage hashes remain opaque fixed-length digests.

## Aggregate Exposure Ceilings

Per-session caps bound one payment. Two further ceilings bound the total open
escrow a deployment can accumulate. Both are part of every `AssetPolicy`, must
be positive at initialization, and can be changed by the administrator with
`set_asset_exposure_ceiling` and `set_buyer_exposure_ceiling`.

For every supported asset `a` and buyer `b`:

```text
buyer_exposure[b, a] = sum(session.escrowed_amount for every open session of b using a)
liability[a] + new_max_amount <= max_asset_exposure[a]          (checked at creation)
buyer_exposure[b, a] + new_max_amount <= max_buyer_exposure[a]  (checked at creation)
```

- `create_session` computes both sums with checked arithmetic and rejects with
  `AssetExposureCeilingExceeded` (36) or `BuyerExposureCeilingExceeded` (39)
  before buyer authorization, sequence consumption, or any token transfer. An
  overflowing sum fails with `LiabilityOverflow`. Reaching a ceiling exactly is
  allowed. Both sums are re-derived after the funding transfer, so a token
  callback cannot have raced a counter past its ceiling.
- Each buyer has an independent counter per asset, stored under
  `BuyerExposure(buyer, asset)`. No limit is shared between buyer addresses.
- Settlement, cancellation, single recovery, and batch recovery each release
  the session's full escrow from both counters once, in the same invocation
  that writes the terminal status. Repeated terminal calls fail on the session
  status and release nothing. A buyer counter that reaches zero is removed.
- The buyer decrement is computed before any state changes. A counter that
  would go negative fails the whole call with `BuyerExposureUnderflow` (40);
  batch recovery reports that session as `EscrowUnavailable` and continues.
- Lowering a ceiling below the current exposure is allowed. Existing sessions
  close normally; new sessions are rejected until capacity returns. Ceilings
  are per asset only: there is no fiat conversion, oracle pricing, or
  cross-asset aggregation.
- An active asset without a stored ceiling fails creation closed with
  `ExposureCeilingNotConfigured` (38).

## Bounded State Model

`formal/escrow-model` exhaustively explores the reachable states of one
session through bounded sequences of initialization, creation, settlement,
cancellation, expiry, recovery, asset lifecycle (deprecation and removal), and
two-step admin rotation (proposal, acceptance, cancellation, expiry) actions.
The finite model checks:

- at most one terminal transition succeeds;
- seller payout never exceeds the recorded cap;
- deposited value equals contract balance plus seller payout plus buyer refund;
- open liability equals the full escrowed cap and terminal liability is zero;
- cancellation and expiry recovery refund only the recorded buyer;
- deprecated assets reject new session creation while preserving all terminal exits;
- asset removal is impossible until modeled liability reaches zero;
- only accepted, non-expired rotation changes the administrator; and
- initialization, creation, settlement, cancellation, deprecation, removal,
  and admin rotation authorization gates reject unauthorized actions without
  changing state.

The model checker visits actions in a fixed order and reports the shortest
known action trace when an invariant fails. CI runs it with `--nocapture`, so a
counterexample can be reproduced locally with:

```console
cargo test -p escrow-model -- --nocapture
```

The model is a protocol-level abstraction. It does not prove that the Rust
contract implements the model. The following traceability table links each
model action to implementation and test evidence that must remain green.

| Model action | Rust method or gate | Implementation tests |
| --- | --- | --- |
| `Initialize` | `initialize` and `admin.require_auth()` | `initialize_stores_admin_once`, `initialize_rejects_empty_duplicate_or_invalid_asset_policies` |
| `Create` | `create_session`, supported-asset gate, buyer authorization, token transfer, liability increase | `create_session_stores_open_session`, `create_session_requires_buyer_auth`, `insufficient_funding_prevents_session_creation` |
| `Settle` | `settle`, seller authorization, amount and expiry validation, liability decrease | `settle_rejects_wrong_seller_auth`, `settle_accepts_exact_cap_without_refund`, `settlement_isolates_concurrent_sessions_sharing_an_asset` |
| `Cancel` | `cancel`, buyer authorization, pre-expiry gate, full refund | `cancel_requires_buyer_auth`, `cancel_allows_buyer_cancellation_before_settlement`, `cancel_rejects_already_cancelled_session` |
| `AdvanceToExpiry` | ledger sequence compared with `expires_at_ledger` | `expiry_boundary_selects_exactly_one_terminal_path` |
| `Recover` | `recover_expired`, fixed stored buyer recipient, full refund | `expiry_recovery_is_permissionless_fixed_recipient_and_single_use`, `expiry_recovery_rejects_missing_settled_and_cancelled_sessions` |
| `DeprecateAsset` | `deprecate_asset`, admin authorization, active-asset status gate | `asset_deprecation_requires_admin_and_blocks_new_sessions` |
| `RemoveAsset` | `remove_asset`, admin authorization, deprecated status and zero liability gates | `deprecated_asset_terminal_paths_clear_liability_before_removal` |
| `ProposeAdmin` | `propose_admin`, admin authorization, single pending rotation gate, expiry validation | `admin_rotation_requires_acceptance_and_changes_privileges_atomically`, `admin_rotation_rejects_overwrite_expiry_and_replay` |
| `AcceptAdmin` | `accept_admin`, pending admin authorization, non-expired ledger gate | `admin_rotation_requires_acceptance_and_changes_privileges_atomically`, `admin_rotation_rejects_overwrite_expiry_and_replay` |
| `CancelAdminRotation` | `cancel_admin_rotation`, current admin authorization, pending rotation existence gate | `admin_rotation_requires_acceptance_and_changes_privileges_atomically`, `admin_rotation_rejects_overwrite_expiry_and_replay` |

