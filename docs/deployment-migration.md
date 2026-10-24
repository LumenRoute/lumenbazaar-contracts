# Immutable Deployment Migration

`upto-session` has no upgrade entry point and none is planned. A code change ships as a new
contract deployment with a new contract ID, and clients migrate to it explicitly. This document is
the procedure for that replacement. It is referenced from [the threat model](threat-model.md#administration-and-upgrades),
the [backend handoff](backend-integration-handoff.md#contract-ids), and
[`deployments/README.md`](../deployments/README.md#replacement-deployments). The executable routing
rehearsal is described in [replacement-deployment-rehearsal.md](replacement-deployment-rehearsal.md);
storage expiry during a drain is covered by [storage-lifecycle.md](storage-lifecycle.md).

Terms used below:

- **Old deployment**: the contract ID currently accepting new sessions.
- **Replacement**: the newly deployed contract ID that will accept new sessions.
- **Session route**: the tuple `(network, contract_id, session_id)`. It is the only valid identity
  of a session. A bare `session_id` is never an identity.

Values marked **policy decision** are recommended defaults, not facts about any deployment.
Maintainers must confirm them before the first production replacement and record the chosen values
in the release notes for that replacement.

## Invariants

These hold for every phase, including rollback:

1. Every session is created on exactly one contract, and every later call for that session
   (`get_session`, `settle`, `cancel`, `recover_expired`, `extend_ttl`, batch reads, and
   `get_session_status`) goes to that same contract on the same network.
2. Backends persist the full session route at creation time, before returning the session to any
   client. The route is never recomputed from configuration, never inferred from the current
   "active" contract, and never rewritten.
3. Session IDs are never migrated, re-derived, or copied into another deployment. A session ID is
   meaningless on any contract other than the one that created it.
4. Escrow is never moved between contracts. Funds escrowed on the old deployment leave it only
   through that deployment's own `settle`, `cancel`, or `recover_expired`.
5. There is no on-chain upgrade, proxy, or admin migration path. Nothing in this procedure requires
   one, and no document should imply one exists.

Why the route must include the contract ID: interface v3 session IDs bind `network_id` and the
contract address into the hash domain (see the backend handoff's
[V2 to V3 compatibility](backend-integration-handoff.md#v2-to-v3-compatibility)), so a v3 ID from
one deployment does not collide with IDs from another. Interface v2 IDs do not include the contract
address, so two v2 deployments can produce the same 32-byte ID for different sessions. Keying only
by `session_id` is therefore unsafe in general, and the full route is required regardless of
interface version.

## 1. Rollout of a replacement deployment

1. **Review and build.** Build the reviewed source with the pinned toolchain
   ([release-toolchain.md](release-toolchain.md)). Record the source commit, WASM hash, and the
   generated interface hash. Confirm `interface_version()` of the new build and whether the spec
   diff is additive or breaking (`node scripts/check-abi-compatibility.mjs`). A breaking change needs
   a migration record under `artifacts/interface/migrations/` and a `Breaking` changelog entry.
2. **Deploy.** Deploy to the target network with the repository scripts. Testnet:
   `node scripts/testnet/deploy-testnet.mjs`, then `node scripts/testnet/initialize-testnet.mjs`
   with the reviewed asset policies. The old deployment is not touched in this step.
3. **Verify.** Run `node scripts/testnet/verify-testnet.mjs` and confirm that the new contract ID
   differs from every recorded contract ID, that `get_configuration()` reports the expected admin,
   interface version, storage layout version, asset set, and `Active` operational state, and that
   the deployed WASM hash matches the reviewed build.
4. **Record.** Publish a sanitized manifest with `node scripts/testnet/generate-public-manifest.mjs`
   as a new `deployments/<network>-YYYY-MM-DD.json` file. Existing manifests are immutable evidence
   and are never rewritten to point at the replacement.
5. **Smoke test.** Run the live rejection cases against the replacement's manifest only, with
   synthetic funded test identities and the test token:
   `node scripts/testnet/smoke-testnet.mjs --deployment-manifest deployments/<network>-YYYY-MM-DD.json`
   ([`deployments/README.md`](../deployments/README.md#live-rejection-evidence)). Do not create smoke
   sessions on the old deployment as part of a replacement.
6. **Rehearse routing.** Run `node scripts/local/rehearse-replacement.mjs --dry-run` in CI (already
   gated) and the live local rehearsal before a production replacement.
7. **Announce.** Publish the new contract ID, network, interface version, the configuration version
   that introduces it (section 2), and the dated phase schedule from section 5.

## 2. Client reconfiguration

Clients learn contract IDs only from versioned configuration, never from hard-coded constants or
from a contract response.

- The backend owns a **deployment registry**: an ordered list of entries
  `{config_version, network, network_passphrase, contract_id, interface_version, role, accepts_new_sessions}`
  where `role` is `active`, `draining` (deprecated), or `retired`. The shape matches the
  `deployments` object in [`deployments/replacement-rehearsal.example.json`](../deployments/replacement-rehearsal.example.json),
  extended with the network fields.
- Every change to the registry increments `config_version`. A client that sees a `config_version`
  lower than one it has already seen ignores it, so a stale cache cannot revert a cutover.
- Exactly one entry per network has `accepts_new_sessions = true` at any time.
- `LUMENBAZAAR_UPTO_SESSION_CONTRACT_ID` remains the single-deployment setting for local and
  testnet use. Once a second deployment exists, the backend reads the registry instead, and that
  variable only selects the active entry.
- The frontend never stores a contract ID of its own. It receives the active contract ID and
  `config_version` from the backend when it starts a session, and it receives each existing
  session's route from the backend with the session.
- Before encoding calls against a contract, clients check `interface_version()` against the
  registry entry and fail closed on a mismatch. This repeats the existing handoff rule.

## 3. Cutover ordering

The order is fixed. Each step starts only after the previous step's exit check passes.

| Step | Actor | Action | Exit check | Why this order |
| ---: | --- | --- | --- | --- |
| 1 | Operators | Rollout steps 1–6 complete for the replacement. | Manifest published, smoke test passed. | Nothing can route to a contract that is not verified. |
| 2 | Backend | Deploy dual-deployment awareness: read the registry, persist full routes, route existing sessions by their stored `contract_id`, and accept settlement and reconciliation for both IDs. The old deployment stays `active`. | Every stored session has a non-empty `contract_id`. Reads and settles of existing old sessions succeed through the route lookup. | The backend must understand two contracts before any session can exist on the second one. Otherwise a replacement session could be routed to the old contract. |
| 3 | Backend | Add the replacement to the registry with `accepts_new_sessions = false` and bump `config_version`. | Backend health check can call `interface_version()` and `get_configuration()` on both contracts. | Proves connectivity and decoding against the replacement without creating sessions. |
| 4 | Frontend | Deploy a frontend build that takes the contract ID and `config_version` from the backend and never assumes a fixed contract ID. | No frontend code path uses a compiled-in contract ID. | The frontend must follow the backend before the backend switches, or old builds keep signing against the old contract. |
| 5 | Backend | Switch: set the replacement to `active` (accepting new sessions) and the old deployment to `draining`, in one registry change with a new `config_version`. | New sessions are created only on the replacement. | Backend first, then frontend: the backend is the source of truth for which contract a new session uses. |
| 6 | Operators | Call `pause_creation()` on the old deployment with its admin. | `get_configuration()` on the old contract reports `Paused`. | Enforces "no new sessions" on-chain for clients that ignored the registry. Pausing keeps settle, cancel, recovery, TTL extension, and reads available, so open escrow is not trapped. |
| 7 | Backend + operators | Drain the old deployment (section 4). | Section 5 retirement criteria are met. | Old sessions complete on the contract that holds their escrow. |

Stale clients: a frontend or integration that still submits `create_session` to the old contract
after step 6 gets `CreationPaused` (error 36) before any buyer authorization or token transfer. It
fails closed rather than creating a session the backend does not expect. Between steps 5 and 6 the
backend must reject or reconcile any old-contract session creation it did not initiate. Keep that
window short.

## 4. Open sessions on the old deployment

- **No new sessions.** From step 5 the backend creates none on the old deployment, and from step 6
  the contract rejects them.
- **Existing sessions finish where they started.** Settlement, buyer cancellation, and permissionless
  `recover_expired` stay available on the old contract while it is paused. The backend routes each
  of them by the stored route.
- **No forced migration.** An open session is never closed on the old contract and recreated on the
  replacement on the buyer's behalf. A buyer who wants to move must cancel (before expiry) and
  create a new session on the replacement, with their own authorization.
- **Natural drain bound.** No session can be open on the old contract beyond
  `MAX_SESSION_DURATION_LEDGERS` (518,400 ledgers, about 30 days at a nominal 5-second close)
  after its creation ledger. The last creation on the old contract therefore bounds when the last
  session reaches logical expiry.
- **Stragglers after expiry.** A session past its expiry ledger can no longer settle or cancel
  (`ExpiredSession`). Its escrow is recoverable only through `recover_expired`, which pays the stored
  buyer and needs no authorization. During the drain the backend (or any operator) calls
  `recover_expired` or `recover_expired_batch` for every expired open session it knows about. It does
  not wait for buyers to do it.
- **Keep old state alive while it holds escrow.** The old contract's instance storage is extended
  only by admin entry points, and per-session entries by session writes and `extend_ttl`. During
  the drain, operators keep the instance TTL above the threshold (for example by re-setting an
  existing cap with `set_asset_max_session_amount`) and call `extend_ttl` for open sessions that
  are close to their TTL threshold. See [storage-lifecycle.md](storage-lifecycle.md) for the rules.
- **Sessions that cannot complete.** If a session cannot finalize (for example its entries were
  archived and could not be restored, or the token contract fails), the backend marks it
  `stuck` in its own records, alerts, and does not report it as settled or refunded. The contract
  fails closed in these cases and does not pay out. Resolution is manual and per session. The
  deployment cannot be retired while any session is `stuck` with unresolved escrow.

## 5. Compatibility and deprecation windows

| Stage | Meaning | Contract state | What clients must do |
| --- | --- | --- | --- |
| Active | Accepts new sessions. | `Active` | Create sessions here. Persist full routes. |
| Deprecated (draining) | No new sessions. Existing sessions are fully supported. | `Paused` | Do not create sessions. Settle, cancel, recover, extend TTL, and read via stored routes. |
| Retired | No supported traffic. The contract still exists on-chain and is never reused. | `Paused` | Do not send any calls. Answer reads from archived off-chain records, marked as historical. |

Windows, all **policy decision** with recommended defaults:

- **Dual-awareness lead time (steps 2–5):** at least one full backend and frontend release cycle,
  and not less than 7 days, between the backend learning the replacement and the switch.
- **Drain window (Deprecated):** starts at step 6. It lasts at least `MAX_SESSION_DURATION_LEDGERS`
  (518,400 ledgers) after the last session created on the old contract, plus a recovery grace of
  17,280 ledgers (about one day) for `recover_expired` of stragglers.
- **Retirement criteria (all required, not just elapsed time):** `get_escrow_liability(asset)` on
  the old contract is `0` for every configured asset; the backend has no session routed to the old
  contract in an open or `stuck` state; and reconciliation (see
  [storage-lifecycle.md](storage-lifecycle.md#reconciliation)) shows no mismatch for the old
  contract.
- **Read compatibility after retirement:** the backend keeps the old routes and terminal session
  records for its own retention period (**policy decision**, recommended at least 1 year). On-chain
  reads after retirement are best effort, because entries that are no longer extended will archive.
- **Interface compatibility:** a replacement with a different `interface_version` is supported only
  through its own decoder fixture (`artifacts/interface/upto-session-v*.json`). Backends keep the old
  decoder for as long as they keep old routes.

## 6. Rollback

Rollback changes only where new sessions go. It never changes where an existing session lives.

1. **Decide.** Rollback is allowed while the old deployment is Deprecated, not after it is Retired.
2. **Stop new sessions on the replacement.** Call `pause_creation()` on the replacement and set its
   registry entry to `draining` with a new `config_version`.
3. **Re-open the old deployment.** Call `resume_creation()` on the old contract and set its registry
   entry back to `active` in the same registry change.
4. **Leave every route unchanged.** Sessions created on the replacement during the cutover stay
   routed to the replacement and drain there under section 4. Sessions created on the old contract
   before the cutover were never re-routed and need no action.
5. **Verify.** The backend checks that no stored route changed: the count of routes per
   `contract_id` before and after rollback matches, apart from newly created sessions.

What rollback must never do:

- Look up a replacement-created `session_id` on the old contract, or the reverse. The contract
  returns `SessionNotFound`, and a backend that reads "not found" as "never existed" or "refunded"
  would misreport escrow that is still held on the other contract.
- Re-derive a session ID from its inputs against the "current" contract. IDs are derived from the
  contract address (v3) and a per-contract sequence counter, so recomputation targets the wrong
  session or none.
- Reuse a retired contract ID as a new deployment. Contract IDs are not reused.
- Copy session records between deployments, or "replay" creation on the old contract.

`scripts/local/replacement-routing.mjs` implements this state machine for the rehearsal. It refuses
to re-pin a session to a different contract, refuses to route an unknown session, and refuses to
deprecate the active deployment.

## 7. Risks this procedure addresses

These are tracked in the threat model under
[Administration and upgrades](threat-model.md#administration-and-upgrades).

- **Stale clients targeting the old contract.** Mitigated by registry versioning, on-chain
  `pause_creation`, and the fixed cutover order. Residual: reads and settles of existing sessions
  still reach the old contract by design.
- **ID confusion on rollback.** Mitigated by the full session route, never recomputing IDs, and
  never re-pinning a route.
- **Split-brain sessions** (a session the backend believes is on one contract but actually lives on
  the other, or exists on-chain with no backend route). Mitigated by persisting the route before
  returning a session, by reconciliation of both contracts' events against backend records during
  the drain, and by alerting on any on-chain session with no route.
- **Archived state on a draining contract.** See [storage-lifecycle.md](storage-lifecycle.md).
  Restoration is not guaranteed, so the drain keeps state extended rather than relying on it.
