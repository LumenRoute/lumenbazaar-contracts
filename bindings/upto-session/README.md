# `upto-session` TypeScript Binding & API Reference

Deterministic TypeScript client and API reference for the LumenBazaar `upto-session` Soroban smart contract, generated from the frozen specification (`artifacts/spec/upto-session.json`) and compatibility fixtures (`artifacts/interface/upto-session-v3.json`, `artifacts/interface/upto-session-v2.json`).

## Package & Interface Metadata

| Property | Value |
| --- | --- |
| Package | `upto-session` (`3.0.0`) |
| Contract Version | `0.3.0` |
| Interface Version | `3` (`interface_version() === 3`) |
| Frozen Spec SHA-256 | `bf8580094cb6569779d5249d589e8a42e44e6812810af5168ad5eca425f8fa07` |
| Supported Networks | Stellar `testnet` (`Test SDF Network ; September 2015`) and local `standalone` (`Standalone Network ; February 2017`) only |
| Unsupported Networks | Stellar `pubnet` and `futurenet` are unsupported and fail closed |
| Test Token Posture | `LBT` (`test-token`) is a synthetic local/testnet utility token only and is never USDC |

## Security, Lifecycle & Integration Guidance

- [Backend Integration Handoff](../../docs/backend-integration-handoff.md): End-to-end session routing, domain-separated hashing, and error handling.
- [Security Checklist](../../docs/security-checklist.md): Authorization boundaries, token invariant verification, and admin controls.
- [Storage Lifecycle](../../docs/storage-lifecycle.md): Instance vs. persistent storage TTL thresholds, extension rules, and archival recovery constraints.
- [Deployment Migration](../../docs/deployment-migration.md): Replacement deployment cutover, rollback routing, and `(network, contract_id, session_id)` persistence.
- [Replacement Deployment Rehearsal](../../docs/replacement-deployment-rehearsal.md): Rehearsal evidence and cross-version behavioral trace verification.
- [Backend Encoding Vectors](../../artifacts/backend-handoff/README.md): Versioned cross-repository XDR, hash, and event decoding vectors.

## Public Methods Reference

Every contract method on `Client` returns a simulated `AssembledTransaction<T>` unless invoked through the transaction evidence helpers below. Security-sensitive methods link directly to authorization and lifecycle documentation.

| Method | Inputs | Output | Authorization | Compatibility | Summary & Guidance |
| --- | --- | --- | --- | --- | --- |
| `accept_admin` | _none_ | `Result<void, ContractError>` | Pending admin (`pending_admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Completes two-step administrator rotation before the proposal expiry ledger. [Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `accept_asset_cap_increase` | `asset: string (Address)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Activates a time-locked per-asset session cap increase after its activation delay and before expiry. [Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `activate_asset` | `policy: AssetPolicy` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Probes a SEP-41 token contract and activates it with bounded session and exposure ceilings. [Handoff: Asset Lifecycle](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `cancel` | `session_id: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Buyer (`session.buyer.require_auth()`) | v2 + v3 | **[Security-Sensitive]** Cancels an open, unexpired session and refunds the full escrowed amount to the stored buyer. [Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `cancel_admin_rotation` | _none_ | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Cancels a pending or expired administrator rotation proposal. [Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `cancel_asset_cap_increase` | `asset: string (Address)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Cancels a pending per-asset session cap increase proposal. [Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `create_session` | `buyer: string (Address)`<br>`seller: string (Address)`<br>`asset: string (Address)`<br>`max_amount: i128 (bigint)`<br>`expires_at_ledger: u32 (number)`<br>`resource_hash: BytesN<32> (Buffer)`<br>`idempotency_key: BytesN<32> (Buffer)` | `Result<BytesN<32> (Buffer), ContractError>` | Buyer (`buyer.require_auth()`) | v2 + v3 (v3 payload) | **[Security-Sensitive]** Creates a domain-separated v3 escrow session with per-buyer idempotency and transfers `max_amount` into contract custody. [Handoff: Session Creation & Domain Separation](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `deprecate_asset` | `asset: string (Address)`<br>`reason_commitment: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Transitions an active asset to `Deprecated` with a 32-byte reason commitment, blocking new sessions while preserving open session exits. [Handoff: Asset Deprecation](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility) · [Security Checklist](../../docs/security-checklist.md) |
| `extend_session_expiry` | `session_id: BytesN<32> (Buffer)`<br>`new_expires_at_ledger: u32 (number)` | `Result<void, ContractError>` | Buyer and Seller (`buyer.require_auth()` + `seller.require_auth()`) | v3 addition | **[Security-Sensitive]** Extends `expires_at_ledger` for an open, unexpired session within `MAX_SESSION_DURATION_LEDGERS`. [Handoff: Session Lifecycle](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `extend_ttl` | `session_id: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Permissionless (open sessions only) | v2 + v3 | **[Security-Sensitive]** Extends persistent storage TTL for an open session and its associated liability/exposure counters. [Storage Lifecycle](../../docs/storage-lifecycle.md) · [Handoff: Missing or Expired State](../../docs/backend-integration-handoff.md#missing-or-expired-on-chain-state) |
| `get_admin` | _none_ | `Result<string (Address), ContractError>` | Read-only (none) | v3 addition | Returns the active administrator address. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_admin_rotation` | _none_ | `Option<AdminRotation>` | Read-only (none) | v3 addition | Returns the optional pending `AdminRotation` proposal and expiry ledger. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_cap_increase` | `asset: string (Address)` | `Option<CapIncreaseProposal>` | Read-only (none) | v3 addition | Returns the optional pending `CapIncreaseProposal` for a supported asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_exposure_ceiling` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the configured aggregate open escrow liability ceiling for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_max_session_amount` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the maximum `max_amount` permitted when creating a new session for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_min_session_amount` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the minimum `max_amount` permitted when creating or reducing a session for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_policy` | `asset: string (Address)` | `Result<AssetPolicyResponse, ContractError>` | Read-only (none) | v3 addition | Returns the full `AssetPolicy` record for a configured asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_asset_solvency` | `asset: string (Address)` | `Result<AssetSolvencySnapshot, ContractError>` | Read-only (none) | v3 addition | Returns `AssetSolvency` (`state`, `balance`, `liability`, `surplus`) for a single configured asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_buyer_exposure` | `buyer: string (Address)`<br>`asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns a buyer's current open escrow exposure for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_buyer_exposure_ceiling` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the configured per-buyer open escrow exposure ceiling for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_buyer_open_sessions` | `buyer: string (Address)` | `Result<u32 (number), ContractError>` | Read-only (none) | v3 addition | Returns the number of currently open sessions for a buyer. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_commitment_domain_metadata` | _none_ | `CommitmentDomainMetadata` | Read-only (none) | v3 addition | Returns versioned commitment domain labels and active resource/usage scheme metadata. [Handoff: V2 to V3 Compatibility](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility) |
| `get_configuration` | _none_ | `Result<ContractConfiguration, ContractError>` | Read-only (none) | v3 addition | Returns `ContractConfiguration` including interface/storage versions, admin, supported assets, operational state, TTL policy, and max session duration. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_escrow_liability` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the aggregate open-session escrow liability recorded for a supported asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_max_buyer_open_sessions` | _none_ | `Option<u32 (number)>` | Read-only (none) | v3 addition | Returns the optional global limit on concurrent open sessions per buyer. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_max_seller_open_sessions` | _none_ | `Option<u32 (number)>` | Read-only (none) | v3 addition | Returns the optional global limit on concurrent open sessions per seller. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_recoverability` | `session_id: BytesN<32> (Buffer)` | `SessionRecoverability` | Read-only (none) | v3 addition | Returns versioned `SessionRecoverability` metadata indicating whether an expired session can be recovered. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_seller_exposure` | `seller: string (Address)`<br>`asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns a seller's current open escrow exposure for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_seller_exposure_ceiling` | `asset: string (Address)` | `Result<i128 (bigint), ContractError>` | Read-only (none) | v3 addition | Returns the optional configured per-seller open escrow exposure ceiling for an asset. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_seller_open_sessions` | `seller: string (Address)` | `Result<u32 (number), ContractError>` | Read-only (none) | v3 addition | Returns the number of currently open sessions for a seller. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_session` | `session_id: BytesN<32> (Buffer)` | `Result<Session, ContractError>` | Read-only (none) | v2 + v3 | Returns the stored `Session` record for `session_id` or fails with `SessionNotFound`. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `get_session_batch` | `session_ids: Array<BytesN<32> (Buffer)>` | `Result<Array<BatchSessionResult>, ContractError>` | Read-only (none) | v3 addition | Reads 1 to 8 session IDs in request order, returning `Found(Session)` or `NotFound` per item. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_session_status` | `session_id: BytesN<32> (Buffer)` | `Result<SessionStatusResponse, ContractError>` | Read-only (none) | v3 addition | Returns lightweight `SessionStatusResponse` (`exists`, `status`, `expires_at_ledger`). [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `get_solvency` | `assets: Array<string (Address)>` | `Result<Array<AssetSolvency>, ContractError>` | Read-only (none) | v3 addition | Returns ordered `AssetSolvency` snapshots for 1 to 16 assets. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `initialize` | `admin: string (Address)`<br>`asset_policies: Array<AssetPolicy>` | `Result<void, ContractError>` | Admin (`admin.require_auth()`) | v2 + v3 (v3 payload) | **[Security-Sensitive]** One-time deployment initialization with 1 to 16 unique SEP-41 asset policies. [Handoff: Initialization](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Deployment Migration](../../docs/deployment-migration.md) |
| `interface_version` | _none_ | `u32 (number)` | Read-only (none) | v2 + v3 | Returns the contract interface version (`3`). [Handoff: Generated Interfaces](../../docs/backend-integration-handoff.md#generated-interfaces) |
| `max_session_duration_ledgers` | _none_ | `u32 (number)` | Read-only (none) | v3 addition | Returns the maximum allowed session lifetime in ledgers (`518400`). [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `pause_creation` | _none_ | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Transitions operational state to `Paused`, rejecting new `create_session` calls while keeping settlements, cancellations, and recoveries active. [Handoff: Replacement Deployments](../../docs/backend-integration-handoff.md#replacement-deployments-and-session-routes) · [Deployment Migration](../../docs/deployment-migration.md) · [Security Checklist](../../docs/security-checklist.md) |
| `preview_settle` | `session_id: BytesN<32> (Buffer)`<br>`actual_amount: i128 (bigint)` | `SettlementPreview` | Read-only (none) | v3 addition | Simulates settlement eligibility, seller payout, buyer refund, and rejection reason without mutating state. [Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions) |
| `propose_admin` | `pending_admin: string (Address)`<br>`expires_at_ledger: u32 (number)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Proposes a new administrator with an expiry window bounded to 1..=17,280 ledgers. [Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `propose_asset_cap_increase` | `asset: string (Address)`<br>`proposed_max_amount: i128 (bigint)`<br>`active_at_ledger: u32 (number)`<br>`expires_at_ledger: u32 (number)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Proposes a time-locked per-asset session cap increase with an activation delay between 100 and 17,280 ledgers. [Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `recover_expired` | `session_id: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Permissionless (at or after `expires_at_ledger`) | v2 + v3 | **[Security-Sensitive]** Recovers an open session at or after `expires_at_ledger` and refunds the full escrowed amount strictly to the stored buyer. [Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `recover_expired_batch` | `session_ids: Array<BytesN<32> (Buffer)>` | `Result<Array<BatchRecoveryResult>, ContractError>` | Permissionless (1 to 8 session IDs) | v3 addition | **[Security-Sensitive]** Recovers up to 8 session IDs in request order, returning per-item `BatchRecoveryResult` without aborting on ineligible items. [Handoff: Batch Recovery](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |
| `recover_surplus` | `asset: string (Address)`<br>`recipient: string (Address)`<br>`amount: i128 (bigint)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Transfers unencumbered token surplus (`balance - liability`) above open-session escrow liability to `recipient`. [Handoff: Solvency & Liability](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `reduce_session_cap` | `session_id: BytesN<32> (Buffer)`<br>`new_max_amount: i128 (bigint)` | `Result<void, ContractError>` | Buyer (`session.buyer.require_auth()`) | v3 addition | **[Security-Sensitive]** Reduces an open, unexpired session's cap and immediately refunds the difference to the buyer. [Handoff: Session Lifecycle](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `reject` | `session_id: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Seller (`session.seller.require_auth()`) | v3 addition | **[Security-Sensitive]** Seller-authorized rejection of an open, unexpired session with full refund to the buyer. [Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `remove_asset` | `asset: string (Address)`<br>`reason_commitment: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Removes a deprecated asset once its open escrow liability is zero, recording a 32-byte reason commitment. [Handoff: Asset Lifecycle](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility) · [Security Checklist](../../docs/security-checklist.md) |
| `resume_creation` | _none_ | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Transitions operational state from `Paused` back to `Active`. [Handoff: Replacement Deployments](../../docs/backend-integration-handoff.md#replacement-deployments-and-session-routes) · [Deployment Migration](../../docs/deployment-migration.md) · [Security Checklist](../../docs/security-checklist.md) |
| `set_asset_exposure_ceiling` | `asset: string (Address)`<br>`ceiling: i128 (bigint)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Updates the aggregate open escrow liability ceiling for an asset. [Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `set_asset_max_session_amount` | `asset: string (Address)`<br>`max_session_amount: i128 (bigint)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Decreases or maintains an asset's per-session cap immediately; cap increases require `propose_asset_cap_increase`. [Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `set_buyer_exposure_ceiling` | `asset: string (Address)`<br>`ceiling: i128 (bigint)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Updates the per-buyer open escrow exposure ceiling for an asset. [Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `set_max_buyer_open_sessions` | `limit: u32 (number)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Configures the maximum concurrent open sessions permitted per buyer. [Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `set_max_seller_open_sessions` | `limit: u32 (number)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Configures the maximum concurrent open sessions permitted per seller. [Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `set_seller_exposure_ceiling` | `asset: string (Address)`<br>`ceiling: i128 (bigint)` | `Result<void, ContractError>` | Active admin (`admin.require_auth()`) | v3 addition | **[Security-Sensitive]** Updates the per-seller open escrow exposure ceiling for an asset. [Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) |
| `settle` | `session_id: BytesN<32> (Buffer)`<br>`actual_amount: i128 (bigint)`<br>`usage_hash: BytesN<32> (Buffer)` | `Result<void, ContractError>` | Seller (`session.seller.require_auth()`) | v2 + v3 | **[Security-Sensitive]** Finalizes an open, unexpired session, paying `actual_amount` to the seller and refunding `escrowed_amount - actual_amount` to the buyer. [Handoff: Settlement & Usage Commitments](../../docs/backend-integration-handoff.md#upto-session-functions) · [Security Checklist](../../docs/security-checklist.md) · [Storage Lifecycle](../../docs/storage-lifecycle.md) |

## Public Types Reference

### Struct Types

| Type | Fields | Description |
| --- | --- | --- |
| `AdminRotation` | `expires_at_ledger: u32 (number)`<br>`pending_admin: string (Address)` | Contract struct type exported in generated bindings. |
| `AssetPolicy` | `asset: string (Address)`<br>`max_asset_exposure: i128 (bigint)`<br>`max_buyer_exposure: i128 (bigint)`<br>`max_session_amount: i128 (bigint)`<br>`min_session_amount: i128 (bigint)` | Contract struct type exported in generated bindings. |
| `AssetPolicyResponse` | `accepts_new_sessions: boolean`<br>`asset: string (Address)`<br>`lifecycle: AssetLifecycle`<br>`max_session_amount: Option<i128 (bigint)>`<br>`response_version: u32 (number)` | Contract struct type exported in generated bindings. |
| `AssetSolvency` | `asset: string (Address)`<br>`balance: i128 (bigint)`<br>`liability: i128 (bigint)`<br>`state: SolvencyAssetState`<br>`surplus: i128 (bigint)` | Contract struct type exported in generated bindings. |
| `AssetSolvencySnapshot` | `asset: string (Address)`<br>`asset_status: AssetStatus`<br>`deficit: i128 (bigint)`<br>`liability: i128 (bigint)`<br>`response_version: u32 (number)`<br>`status: SolvencyStatus`<br>`surplus: i128 (bigint)`<br>`token_balance: Option<i128 (bigint)>` | Contract struct type exported in generated bindings. |
| `BatchRecoveryResult` | `refunded_amount: i128 (bigint)`<br>`session_id: BytesN<32> (Buffer)`<br>`status: BatchRecoveryStatus` | Contract struct type exported in generated bindings. |
| `BatchSessionResult` | `session_id: BytesN<32> (Buffer)`<br>`status: BatchSessionStatus` | Contract struct type exported in generated bindings. |
| `CapIncreaseProposal` | `active_at_ledger: u32 (number)`<br>`expires_at_ledger: u32 (number)`<br>`proposed_max_amount: i128 (bigint)` | Contract struct type exported in generated bindings. |
| `CommitmentDomainMetadata` | `interface_version: u32 (number)`<br>`receipt_schema_version: u32 (number)`<br>`response_version: u32 (number)`<br>`session_id_domain: BytesN<32> (Buffer)`<br>`usage_commitment_domain: BytesN<32> (Buffer)` | Contract struct type exported in generated bindings. |
| `ContractConfiguration` | `admin: string (Address)`<br>`instance_ttl_extension: u32 (number)`<br>`instance_ttl_threshold: u32 (number)`<br>`interface_version: u32 (number)`<br>`max_session_duration_ledgers: u32 (number)`<br>`max_supported_assets: u32 (number)`<br>`operational_state: OperationalState`<br>`response_version: u32 (number)`<br>`storage_layout_version: u32 (number)`<br>`supported_assets: Array<string (Address)>` | Contract struct type exported in generated bindings. |
| `Session` | `asset: string (Address)`<br>`buyer: string (Address)`<br>`creation_ledger: u32 (number)`<br>`escrowed_amount: i128 (bigint)`<br>`expires_at_ledger: u32 (number)`<br>`finalized_ledger: Option<u32 (number)>`<br>`id: BytesN<32> (Buffer)`<br>`max_amount: i128 (bigint)`<br>`resource_hash: BytesN<32> (Buffer)`<br>`resource_scheme_version: u32 (number)`<br>`seller: string (Address)`<br>`settled_amount: i128 (bigint)`<br>`status: SessionStatus`<br>`usage_hash: Option<BytesN<32> (Buffer)>`<br>`usage_scheme_version: Option<u32 (number)>` | Contract struct type exported in generated bindings. |
| `SessionRecoverability` | `asset: Option<string (Address)>`<br>`current_ledger: u32 (number)`<br>`expires_at_ledger: u32 (number)`<br>`recipient: Option<string (Address)>`<br>`refundable_amount: i128 (bigint)`<br>`response_version: u32 (number)`<br>`status: RecoverabilityStatus` | Contract struct type exported in generated bindings. |
| `SessionStatusResponse` | `exists: boolean`<br>`expires_at_ledger: u32 (number)`<br>`status: SessionStatus` | Contract struct type exported in generated bindings. |
| `SettlementPreview` | `actual_amount: i128 (bigint)`<br>`buyer_refund: i128 (bigint)`<br>`eligible: boolean`<br>`is_expired: boolean`<br>`rejection_reason: SettlementRejectionReason`<br>`seller_payout: i128 (bigint)` | Contract struct type exported in generated bindings. |

### Enum & Union Types

| Type | Variants | Description |
| --- | --- | --- |
| `AssetLifecycle` | `undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `AssetStatus` | `undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `BatchRecoveryStatus` | `undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `BatchSessionStatus` | `undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `OperationalState` | `undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `RecoverabilityStatus` | `undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `SessionStatus` | `undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `SettlementRejectionReason` | `undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `SolvencyAssetState` | `undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |
| `SolvencyStatus` | `undefined`<br>`undefined`<br>`undefined`<br>`undefined` | Contract enum/union type exported in generated bindings. |

## Contract Errors Reference (`ContractError`)

All contract failures use stable numeric `u32` error codes (`1..=60`). Use `decodeContractError(error)`, `isContractError(error, name)`, `CONTRACT_ERROR_CODES`, and `CONTRACT_ERROR_NAMES` to classify contract, host, and transport errors deterministically. See [Stable Errors](../../docs/backend-integration-handoff.md#stable-errors).

| Code | Error Name | Compatibility | Category |
| ---: | --- | --- | --- |
| 1 | `AlreadyInitialized` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 2 | `Unauthorized` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 3 | `InvalidAmount` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 4 | `ExpiredSession` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 5 | `SessionNotFound` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 6 | `SessionAlreadySettled` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 7 | `SessionCancelled` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 8 | `AmountExceedsCap` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 9 | `InvalidAsset` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 10 | `InvalidSeller` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 11 | `TtlExtensionFailed` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 12 | `InvalidResourceHash` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 13 | `InvalidUsageHash` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 14 | `UnsupportedAsset` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 15 | `InvalidSupportedAssets` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 16 | `SessionDurationTooLong` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 17 | `LiabilityOverflow` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 18 | `LiabilityUnderflow` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 19 | `EscrowUnderfunded` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 20 | `NotInitialized` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 21 | `SessionExpired` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 22 | `SessionNotExpired` | v2 + v3 (retained) | Core Session, Validation & Liability (v2 baseline) |
| 23 | `InvalidAssetCap` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 24 | `AssetCapNotConfigured` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 25 | `InvalidAdmin` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 26 | `InvalidAdminRotationExpiry` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 27 | `AdminRotationPending` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 28 | `AdminRotationNotFound` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 29 | `AdminRotationExpired` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 30 | `TokenInvariantViolation` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 31 | `InvalidBatchSize` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 32 | `InvalidAssetInterface` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 33 | `AssetNotActive` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 34 | `AssetNotDeprecated` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 35 | `AssetLiabilityOutstanding` | v3 addition | Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds |
| 36 | `CreationPaused` | v3 addition | Operational State (`Paused` / `Active`) |
| 37 | `OperationalStateUnchanged` | v3 addition | Operational State (`Paused` / `Active`) |
| 38 | `CapIncreasePending` | v3 addition | Time-Locked Asset Cap Increases |
| 39 | `CapIncreaseNotReady` | v3 addition | Time-Locked Asset Cap Increases |
| 40 | `CapIncreaseNotFound` | v3 addition | Time-Locked Asset Cap Increases |
| 41 | `CapIncreaseExpired` | v3 addition | Time-Locked Asset Cap Increases |
| 42 | `InvalidCapIncreaseDelay` | v3 addition | Time-Locked Asset Cap Increases |
| 43 | `UnsupportedCommitmentScheme` | v3 addition | Commitment Scheme Versioning |
| 44 | `SellerExposureCeilingExceeded` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 45 | `SellerExposureCeilingNotConfigured` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 46 | `BuyerOpenSessionsExceeded` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 47 | `InvalidSessionCountLimit` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 48 | `SellerOpenSessionsExceeded` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 49 | `InvalidCapReduction` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 50 | `SessionRejected` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 51 | `AssetAlreadyActive` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 52 | `AssetDeprecated` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 53 | `AssetLimitReached` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 54 | `AssetExposureCeilingExceeded` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 55 | `InvalidExposureCeiling` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 56 | `ExposureCeilingNotConfigured` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 57 | `BuyerExposureCeilingExceeded` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 58 | `BuyerExposureUnderflow` | v3 addition | Exposure Ceilings, Open Session Limits & Lifecycle Guards |
| 59 | `SequenceExhausted` | v3 addition | Sequence Exhaustion & Idempotency Protection |
| 60 | `IdempotencyConflict` | v3 addition | Sequence Exhaustion & Idempotency Protection |

## Events Reference

Every event publishes one prefix topic (`Symbol`) and one bounded 32-byte indexed topic (`session_id` or `Address`), plus a data map containing `event_version: u32`. See [Indexed Event Topics](../../docs/backend-integration-handoff.md#indexed-event-topics).

| Event | Prefix Topic | Indexed Topic | Data Fields | Compatibility |
| --- | --- | --- | --- | --- |
| `AdminRotationAccepted` | `admin_rotation_accepted` |  | `previous_admin: string (Address)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AdminRotationCancelled` | `admin_rotation_cancelled` |  | `current_admin: string (Address)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AdminRotationProposed` | `admin_rotation_proposed` |  | `current_admin: string (Address)`<br>`expires_at_ledger: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AssetActivated` | `asset_activated` |  | `decimals: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AssetDeprecated` | `asset_deprecated` |  | `admin: string (Address)`<br>`reason_commitment: BytesN<32> (Buffer)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AssetExposureCeilingUpdated` | `asset_exposure_ceiling_updated` |  | `admin: string (Address)`<br>`previous_ceiling: i128 (bigint)`<br>`new_ceiling: i128 (bigint)`<br>`current_liability: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AssetRemoved` | `asset_removed` |  | `admin: string (Address)`<br>`reason_commitment: BytesN<32> (Buffer)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `AssetSessionCapUpdated` | `asset_session_cap_updated` |  | `admin: string (Address)`<br>`previous_max_session_amount: i128 (bigint)`<br>`new_max_session_amount: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `BuyerExposureCeilingUpdated` | `buyer_exposure_ceiling_updated` |  | `admin: string (Address)`<br>`previous_ceiling: i128 (bigint)`<br>`new_ceiling: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `CapIncreaseCancelled` | `cap_increase_cancelled` |  | `admin: string (Address)`<br>`proposed_max_amount: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `CapIncreaseProposed` | `cap_increase_proposed` |  | `admin: string (Address)`<br>`proposed_max_amount: i128 (bigint)`<br>`active_at_ledger: u32 (number)`<br>`expires_at_ledger: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `CreationPaused` | `creation_paused` |  | `event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `CreationResumed` | `creation_resumed` |  | `event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `MaxBuyerOpenSessionsUpdated` | `max_buyer_open_sessions_updated` |  | `previous_limit: u32 (number)`<br>`new_limit: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `MaxSellerOpenSessionsUpdated` | `max_seller_open_sessions_updated` |  | `previous_limit: u32 (number)`<br>`new_limit: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `SellerExposureCeilingUpdated` | `seller_exposure_ceiling_updated` |  | `admin: string (Address)`<br>`previous_ceiling: i128 (bigint)`<br>`new_ceiling: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `SessionCancelled` | `session_cancelled` |  | `buyer: string (Address)`<br>`asset: string (Address)`<br>`event_version: u32 (number)`<br>`refunded_amount: i128 (bigint)` | v2 + v3 (`event_version: 2`) |
| `SessionCapReduced` | `session_cap_reduced` |  | `buyer: string (Address)`<br>`asset: string (Address)`<br>`previous_max_amount: i128 (bigint)`<br>`new_max_amount: i128 (bigint)`<br>`refunded_amount: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `SessionCreated` | `session_created` |  | `buyer: string (Address)`<br>`seller: string (Address)`<br>`asset: string (Address)`<br>`max_amount: i128 (bigint)`<br>`expires_at_ledger: u32 (number)`<br>`resource_hash: BytesN<32> (Buffer)`<br>`event_version: u32 (number)`<br>`escrowed_amount: i128 (bigint)` | v2 + v3 (`event_version: 2`) |
| `SessionExpiryExtended` | `session_expiry_extended` |  | `buyer: string (Address)`<br>`seller: string (Address)`<br>`previous_expires_at_ledger: u32 (number)`<br>`new_expires_at_ledger: u32 (number)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |
| `SessionRecovered` | `session_recovered` |  | `buyer: string (Address)`<br>`asset: string (Address)`<br>`event_version: u32 (number)`<br>`refunded_amount: i128 (bigint)`<br>`expired_at_ledger: u32 (number)`<br>`recovered_at_ledger: u32 (number)` | v2 + v3 (`event_version: 2`) |
| `SessionRejected` | `session_rejected` |  | `seller: string (Address)`<br>`buyer: string (Address)`<br>`asset: string (Address)`<br>`event_version: u32 (number)`<br>`refunded_amount: i128 (bigint)` | v3 addition (`event_version: 1` or `3`) |
| `SessionSettled` | `session_settled` |  | `seller: string (Address)`<br>`asset: string (Address)`<br>`actual_amount: i128 (bigint)`<br>`usage_hash: BytesN<32> (Buffer)`<br>`event_version: u32 (number)`<br>`refunded_amount: i128 (bigint)` | v2 + v3 (`event_version: 2`) |
| `SurplusRecovered` | `surplus_recovered` |  | `recipient: string (Address)`<br>`amount: i128 (bigint)`<br>`event_version: u32 (number)` | v3 addition (`event_version: 1` or `3`) |

## Handwritten Domain, Receipt & Error Helpers

| Export | Source Module | Purpose |
| --- | --- | --- |
| `deriveSessionId(input)` | `src/sessionId.ts` | Derives the v3 domain-separated `session_id` (64-char lowercase hex) from `SessionIdInputV3`. |
| `deriveSessionIdPreimage(input)` | `src/sessionId.ts` | Returns the raw Soroban `ScVal` XDR preimage `Buffer` for `(domain_xdr, payload_xdr)`. |
| `validateSessionIdInput(input)` | `src/sessionId.ts` | Validates v3 session ID derivation inputs and fails closed on v2 or malformed arguments. |
| `canonicalizeUsageReceipt(receipt)` | `src/usageReceipt.ts` | Serializes a v1 usage receipt into canonical compact UTF-8 JSON. |
| `hashUsageReceipt(receipt)` | `src/usageReceipt.ts` | Computes the 32-byte SHA-256 `measurement_hash` hex for a canonical v1 usage receipt. |
| `parseCanonicalUsageReceipt(json)` | `src/usageReceipt.ts` | Validates and parses a canonical v1 usage receipt JSON string. |
| `decodeContractError(error)` | `src/contractErrors.ts` | Decodes thrown, simulated, or RPC failures into `contract`, `unknown_contract`, `malformed_contract`, `host`, or `other`. |
| `isContractError(error, name)` | `src/contractErrors.ts` | Type-safe predicate matching a known `ContractErrorName`. |

<!-- lumenbazaar:transaction-evidence (appended by scripts/generate-bindings.mjs; edit scripts/templates/README.transactionEvidence.md) -->

# Transaction evidence helpers

Generated methods return an `AssembledTransaction` that is built and simulated
but not submitted. The hand-written helpers in `src/transactionEvidence.ts`
(copied from `scripts/templates/transactionEvidence.ts`, so they survive
regeneration) take it the rest of the way and return typed evidence:

| Helper | Contract method |
| --- | --- |
| `createSessionWithEvidence(client, args, options)` | `create_session` |
| `settleWithEvidence(client, args, options)` | `settle` |
| `cancelWithEvidence(client, args, options)` | `cancel` |
| `extendTtlWithEvidence(client, args, options)` | `extend_ttl` |

Each helper simulates through the generated client, hands the envelope to your
signer, submits it with `sendTransaction`, polls `getTransaction` within a
bounded budget, and decodes the return value with the generated decoder.

```ts
import { Client, Networks, rpc, createSessionWithEvidence } from "upto-session";

const networkPassphrase = Networks.TESTNET; // testnet or a local standalone network only
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const client = new Client({
  contractId: "C...", // the published testnet deployment
  networkPassphrase,
  rpcUrl: "https://soroban-testnet.stellar.org",
  publicKey: "G...", // the buyer's public account; no secret key here
});

// Placeholder signer: delegate to a wallet, HSM or KMS that you control.
const signer = {
  async signTransaction(transactionXdr: string, { networkPassphrase }: { networkPassphrase: string }) {
    return wallet.signTransaction(transactionXdr, { networkPassphrase }); // { signedTxXdr }
  },
};

const evidence = await createSessionWithEvidence(client, args, {
  networkPassphrase,
  rpc: server,
  signer,
  timeoutMs: 60_000, // default 60 s, at most 600 s
  pollIntervalMs: 1_000, // default 1 s, 100 ms to 30 s
});

switch (evidence.status) {
  case "confirmed":
    // transactionHash, ledger and createdAt come from RPC; result is typed.
    store(evidence.transactionHash, evidence.ledger, evidence.result);
    break;
  case "failed":
    // stage "submission": RPC rejected it, no ledger. stage "ledger": included and failed.
    report(evidence.transactionHash, evidence.stage, evidence.resultCode);
    break;
  case "pending":
    // Unknown outcome. Keep polling evidence.transactionHash; do not resubmit blindly.
    resume(evidence.transactionHash);
    break;
}
```

Outcomes are a discriminated union, so pending can never be read as success
or failure. Evidence fields are taken from RPC responses only: a missing or
malformed hash, a missing, zero or non-integer ledger, a missing close time or
a missing return value raises `EvidenceError("malformed_rpc_response")` instead
of being defaulted. `assertConfirmedEvidence(value)` applies the same rules to
evidence you load back from storage.

`EvidenceError.code` separates problems that are not on-chain outcomes:
`unsupported_network`, `invalid_configuration`, `not_a_write`, `not_simulated`,
`additional_signers_required`, `signer_rejected`, `signer_modified_transaction`,
`rpc_error` (transport or RPC failure; `transactionHash` is set when the
transaction is known to be submitted, `expectedTransactionHash` when it is not)
and `malformed_rpc_response`.

Pubnet is not supported. The helpers accept only the testnet and standalone
passphrases and require the passphrase explicitly; there is no default network.
LBT, the repository's test token, is a custom test-only token and is not USDC.

## Safe signer boundaries

- The library never accepts, stores, logs or requires a secret key, seed phrase
  or mnemonic. It receives only the signed envelope back from your signer.
- The signer is injected and owned by you. Prefer a wallet, HSM or KMS-backed
  signer, and keep signing material out of client code, configuration files,
  logs, error reports and source control.
- Verify the network passphrase the signer is asked to use before signing. The
  helpers reject an envelope whose hash differs from the simulated transaction,
  which also catches a signer that changed the network or the operations.
- Use testnet or a local standalone network for examples and tests. Never use
  real funds or production keys with these examples.
- Calls that need other parties' authorization entries
  (`needsNonInvokerSigningBy()`) are rejected; collect those signatures with the
  generated client first.
- Treat `pending` as an unknown outcome. Poll the reported hash until it is
  confirmed or failed, or until the transaction's time bounds have passed,
  before deciding whether to build a new transaction. Never resubmit blindly.
