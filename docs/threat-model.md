# Threat Model

This document covers the `upto-session` contract and the example-only policy wallet. The custom
`test-token` exists only for local and testnet validation and is not a production asset.

The accepted funding design is
[ADR 0001: Escrow-Funded Upto Sessions](adr/0001-escrow-funded-upto-sessions.md).
The current source implements the selected escrow model. The corrected v2
testnet deployment and lifecycle evidence are published in
`deployments/testnet-2026-10-07.json` and
`artifacts/testnet/lifecycle-2026-10-07.json`. Live on-ledger rejection evidence for the current
interface v3 source is published in `deployments/testnet-2026-10-20.json` and
`artifacts/testnet/live-evidence-2026-10-20.json`.

## Assets and trust boundaries

- Buyers authorize full-cap escrow at session creation and cancellation for
  their own funds.
- Sellers authorize settlement and cannot settle more than the buyer's cap.
- Asset activation performs a bounded read-only probe of SEP-41 balance and
  metadata methods without moving funds, then emits an activation event. This
  rejects missing, reverting, and observably malformed contracts at that time.
- The configured token contract is trusted to implement SEP-41 transfer and
  balance semantics correctly. Escrow checks exact before/after balance deltas
  and rolls back on failed, under-reporting, or partial behavior, but a token
  that consistently fabricates every observed balance can defeat local
  reconciliation. Asset review and allowlisting remain mandatory.
- The `resource_hash` and `usage_hash` values are commitments only. The contract does not validate
  off-chain resource contents or metering calculations.
- RPC nodes, Horizon, indexers, backend services, and user interfaces are outside the on-chain trust
  boundary. Clients must verify finalized transaction results before presenting settlement as final.

## Authorization and replay

- `create_session` requires buyer authorization and binds buyer, seller, asset, cap, expiry, resource
  hash, and an incrementing sequence into the session ID. Its nested token call
  transfers the cap into contract custody.
- `settle` requires the stored seller's authorization and finalizes a session once.
- Before expiry, `cancel` requires the stored buyer's authorization, refunds the escrow, and prevents later settlement.
- At or after expiry, `recover_expired` requires no caller authorization and can refund only the stored buyer.
- Repeated settlement and cancellation attempts fail against finalized state.
- Soroban rejects a callback that tries to invoke the active escrow contract
  again while its token transfer is on the call stack. Test-only callback-token
  fixtures cover create, settle, cancel, and recovery and assert that no second
  success event, authorization, balance movement, or liability transition is
  produced. This regression evidence does not make arbitrary token behavior
  trustworthy.

## Amount, expiry, and storage risks

- Caps and settlement amounts must be positive, and settlement cannot exceed the stored cap.
  Settling exactly the cap is allowed; `actual_amount > max_amount` returns `#8 AmountExceedsCap`
  (`validate_settlement_amount` in `contracts/upto-session/src/validation.rs`).
- Expiry is ledger-sequence based, not timestamp based. `settle` and `cancel` reject when
  `ledger.sequence >= expires_at_ledger` with `#4 ExpiredSession` (`validate_settlement_amount`
  and `cancel` in `contracts/upto-session/src/lib.rs`), so the last ledger that can settle or cancel
  is `expires_at_ledger - 1`. `recover_expired` is allowed from `expires_at_ledger` onward.
- `settle` checks status, amount, cap, expiry, and usage hash before seller authorization, and
  `cancel` checks status and expiry before buyer authorization. A rejected call therefore reports the
  first failed rule.
- Live testnet evidence on contract `CDI5ZVB4VUQQJ5DJ25M4QBXYI273LN4PHN7TW6BT6VHERELK26SH7YY3`
  (`artifacts/testnet/live-evidence-2026-10-20.json`), all recorded as on-ledger transactions:
  - control settlement of 6,500,000 under a 10,000,000 cap succeeded at ledger 5290715
    (`ff15324bd866801ecdf1137e478eea7d63758982af4d77cf13a122f393cb49b5`);
  - settlement of 5,000,001 under a 5,000,000 cap failed with `Error(Contract, #8)` at ledger 5290735
    (`07bb7c118510a1fbaae89f504a9b1174c4c8baae78809186d640dfb7b7e28e73`) with identical balances,
    liability, and session state before and after;
  - for a session expiring at ledger 5290770, settlement succeeded in the last valid ledger 5290769
    (`596c4cdf087f7ed06581ee3ae692bd1a4ef499248e715658eaad043f305bf0f1`);
  - for a session expiring at ledger 5290800, settlement landing exactly in ledger 5290800 failed
    with `Error(Contract, #4)` (`bcbaa57fcf8bd6c21a9dfff5cc1680d522345490fd6fc52b85132025047c884e`)
    without mutating state, and the escrow was then recovered permissionlessly.
- Contract storage TTL can outlive or expire independently of off-chain records. Operators must not
  treat a missing off-chain record as proof that an on-chain session is absent.
- TTL extension is limited to open sessions. Tests cover missing, settled, and cancelled session
  rejection. The public lifecycle evidence also covers settlement rejection at the live expiry
  boundary and permissionless recovery seven ledgers after expiry.
- Every storage key, its TTL owner, the separate open and finalized session policies, and the
  required backend behavior for missing or expired state are specified in
  [storage-lifecycle.md](storage-lifecycle.md), with each rule (`SR-n`) linked to a boundary test.
  Risks recorded there:
  - The instance entry (admin, asset configuration, operational state, and the session sequence) is
    extended only by admin entry points. If no admin call happens for a full extension window, the
    whole contract becomes unusable until the entry is restored.
  - Aggregate counters (`Liability`, `SellerExposure`, open-session counts) are extended only when a
    session that touches them is written or extended. A counter that lapses makes settlement,
    cancellation, and recovery fail closed (no payout) rather than pay out against wrong accounting.
  - Restoring archived entries is a network operation outside this contract. It is not guaranteed
    to be available, cheap, or timely, so no recovery procedure may depend on it.

## Administration and upgrades

- `upto-session` stores an administrator during one-time initialization but currently exposes no
  contract upgrade entry point.
- The administrator can authorize an `Active`/`Paused` operational transition with
  `pause_creation` and `resume_creation`. A pause stops new exposure by rejecting
  `create_session` before buyer authorization or any token transfer, while settlement,
  cancellation, expiry recovery, TTL extension, and read-only queries stay available so
  existing escrow cannot be trapped.
- Deployed instances are therefore operationally immutable through this interface. A code change
  requires a new deployment and explicit migration or reconfiguration by clients. The rollout,
  client reconfiguration, cutover order, open-session drain, rollback, and deprecation windows are
  specified in [deployment-migration.md](deployment-migration.md). No upgrade entry point is added
  or implied by that procedure.
- Replacement deployment risks (mitigations in [deployment-migration.md](deployment-migration.md#7-risks-this-procedure-addresses)):
  - Stale clients may keep targeting the old contract. New session creation there fails closed with
    `CreationPaused` once the old deployment is paused. Reads and exits for existing sessions
    intentionally still reach it.
  - Session ID confusion on rollback. A session's identity is `(network, contract_id, session_id)`.
    Looking an ID up on the wrong contract returns `SessionNotFound`, and backends must not read
    that as "never existed" or "refunded". Interface v2 IDs are not bound to the contract address,
    so two v2 deployments can produce the same ID.
  - Split-brain sessions: an on-chain session with no backend route, or a route pointing at the
    wrong contract. Backends persist the route before returning a session and reconcile both
    contracts during the drain.
- The policy wallet owner can update its own spending policy. That authority does not grant access to
  another buyer's session or permit settlement by a different seller.

## Known limitations

- `upto` is a LumenBazaar extension and is not presented as an upstream-standard Stellar x402 scheme.
- The live evidence uses LBT, a custom test-only token, not Circle USDC or another production asset.
- The 2026-10-07 lifecycle rejections failed during simulation and therefore have no submitted
  transaction hash; that evidence records the observation ledger, exact command, and deterministic
  rejection instead. The 2026-10-20 live evidence submits rejected operations without simulation
  (using a valid sibling simulation's footprint), so each rejection is a failed transaction on ledger.
  A scheduled workflow re-verifies every published transaction and its expected outcome against
  Horizon.
- Testnet lifecycle evidence does not prove mainnet readiness, production monitoring, or backend
  idempotency.
- Production use requires an independently reviewed token, a live transaction submission client,
  durable backend idempotency, and monitoring for failed or delayed finality.
- The malicious-token suite demonstrates bounded behaviors, not safety against
  arbitrary token bytecode. Exact balance checks are defense in depth and do
  not remove the configured-asset trust boundary.
