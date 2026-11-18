import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface Session {
  asset: string;
  buyer: string;
  creation_ledger: u32;
  escrowed_amount: i128;
  expires_at_ledger: u32;
  finalized_ledger: Option<u32>;
  id: Buffer;
  max_amount: i128;
  resource_hash: Buffer;
  resource_scheme_version: u32;
  seller: string;
  settled_amount: i128;
  status: SessionStatus;
  usage_hash: Option<Buffer>;
  usage_scheme_version: Option<u32>;
}


export interface AssetPolicy {
  asset: string;
  /**
 * Ceiling on the sum of open escrow for this asset across all sessions.
 */
max_asset_exposure: i128;
  /**
 * Ceiling on the sum of open escrow for this asset held by any one buyer.
 */
max_buyer_exposure: i128;
  max_session_amount: i128;
  min_session_amount: i128;
}

export type AssetStatus = {tag: "Active", values: void} | {tag: "Deprecated", values: void};


export interface AdminRotation {
  expires_at_ledger: u32;
  pending_admin: string;
}


export interface AssetSolvency {
  asset: string;
  balance: i128;
  liability: i128;
  state: SolvencyAssetState;
  surplus: i128;
}

export type SessionStatus = {tag: "Open", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void} | {tag: "Expired", values: void} | {tag: "Rejected", values: void};

export type AssetLifecycle = {tag: "Active", values: void} | {tag: "Deprecated", values: void} | {tag: "NotConfigured", values: void};

export type SolvencyStatus = {tag: "Collateralized", values: void} | {tag: "Surplus", values: void} | {tag: "Underfunded", values: void} | {tag: "BalanceUnavailable", values: void};

export type OperationalState = {tag: "Active", values: void} | {tag: "Paused", values: void} | {tag: "Deprecated", values: void};


export interface SettlementPreview {
  actual_amount: i128;
  buyer_refund: i128;
  eligible: boolean;
  is_expired: boolean;
  rejection_reason: SettlementRejectionReason;
  seller_payout: i128;
}


export interface BatchSessionResult {
  session_id: Buffer;
  status: BatchSessionStatus;
}

export type BatchSessionStatus = {tag: "Found", values: readonly [Session]} | {tag: "NotFound", values: void};

export type SolvencyAssetState = {tag: "Unknown", values: void} | {tag: "Active", values: void} | {tag: "Deprecated", values: void};


export interface AssetPolicyResponse {
  accepts_new_sessions: boolean;
  asset: string;
  lifecycle: AssetLifecycle;
  max_session_amount: Option<i128>;
  response_version: u32;
}


export interface BatchRecoveryResult {
  refunded_amount: i128;
  session_id: Buffer;
  status: BatchRecoveryStatus;
}

export type BatchRecoveryStatus = {tag: "Recovered", values: void} | {tag: "NotFound", values: void} | {tag: "NotExpired", values: void} | {tag: "AlreadySettled", values: void} | {tag: "AlreadyCancelled", values: void} | {tag: "AlreadyRecovered", values: void} | {tag: "AlreadyRejected", values: void} | {tag: "Duplicate", values: void} | {tag: "EscrowUnavailable", values: void};


export interface CapIncreaseProposal {
  active_at_ledger: u32;
  expires_at_ledger: u32;
  proposed_max_amount: i128;
}

export type RecoverabilityStatus = {tag: "NotFound", values: void} | {tag: "NotExpired", values: void} | {tag: "Recoverable", values: void} | {tag: "AlreadySettled", values: void} | {tag: "AlreadyCancelled", values: void} | {tag: "AlreadyRecovered", values: void} | {tag: "AlreadyRejected", values: void};


export interface AssetSolvencySnapshot {
  asset: string;
  asset_status: AssetStatus;
  /**
 * `liability - token_balance` when positive, otherwise `0`.
 */
deficit: i128;
  liability: i128;
  response_version: u32;
  status: SolvencyStatus;
  /**
 * `token_balance - liability` when positive, otherwise `0`.
 */
surplus: i128;
  /**
 * Balance reported by the token for this contract, or `None` when the
 * balance call failed.
 */
token_balance: Option<i128>;
}


export interface ContractConfiguration {
  admin: string;
  instance_ttl_extension: u32;
  instance_ttl_threshold: u32;
  interface_version: u32;
  max_session_duration_ledgers: u32;
  max_supported_assets: u32;
  operational_state: OperationalState;
  response_version: u32;
  storage_layout_version: u32;
  supported_assets: Array<string>;
}


export interface SessionRecoverability {
  asset: Option<string>;
  current_ledger: u32;
  expires_at_ledger: u32;
  recipient: Option<string>;
  refundable_amount: i128;
  response_version: u32;
  status: RecoverabilityStatus;
}


export interface SessionStatusResponse {
  exists: boolean;
  expires_at_ledger: u32;
  status: SessionStatus;
}


export interface CommitmentDomainMetadata {
  interface_version: u32;
  receipt_schema_version: u32;
  response_version: u32;
  session_id_domain: Buffer;
  usage_commitment_domain: Buffer;
}

export type SettlementRejectionReason = {tag: "None", values: void} | {tag: "NotFound", values: void} | {tag: "AlreadySettled", values: void} | {tag: "AlreadyCancelled", values: void} | {tag: "AlreadyExpired", values: void} | {tag: "AlreadyRejected", values: void} | {tag: "InvalidAmount", values: void} | {tag: "AmountExceedsCap", values: void} | {tag: "Expired", values: void} | {tag: "EscrowUnderfunded", values: void};

export const ContractError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"Unauthorized"},
  3: {message:"InvalidAmount"},
  4: {message:"ExpiredSession"},
  5: {message:"SessionNotFound"},
  6: {message:"SessionAlreadySettled"},
  7: {message:"SessionCancelled"},
  8: {message:"AmountExceedsCap"},
  9: {message:"InvalidAsset"},
  10: {message:"InvalidSeller"},
  11: {message:"TtlExtensionFailed"},
  12: {message:"InvalidResourceHash"},
  13: {message:"InvalidUsageHash"},
  14: {message:"UnsupportedAsset"},
  15: {message:"InvalidSupportedAssets"},
  16: {message:"SessionDurationTooLong"},
  17: {message:"LiabilityOverflow"},
  18: {message:"LiabilityUnderflow"},
  19: {message:"EscrowUnderfunded"},
  20: {message:"NotInitialized"},
  21: {message:"SessionExpired"},
  22: {message:"SessionNotExpired"},
  23: {message:"InvalidAssetCap"},
  24: {message:"AssetCapNotConfigured"},
  25: {message:"InvalidAdmin"},
  26: {message:"InvalidAdminRotationExpiry"},
  27: {message:"AdminRotationPending"},
  28: {message:"AdminRotationNotFound"},
  29: {message:"AdminRotationExpired"},
  30: {message:"TokenInvariantViolation"},
  31: {message:"InvalidBatchSize"},
  32: {message:"InvalidAssetInterface"},
  33: {message:"AssetNotActive"},
  34: {message:"AssetNotDeprecated"},
  35: {message:"AssetLiabilityOutstanding"},
  36: {message:"CreationPaused"},
  37: {message:"OperationalStateUnchanged"},
  38: {message:"CapIncreasePending"},
  39: {message:"CapIncreaseNotReady"},
  40: {message:"CapIncreaseNotFound"},
  41: {message:"CapIncreaseExpired"},
  42: {message:"InvalidCapIncreaseDelay"},
  43: {message:"UnsupportedCommitmentScheme"},
  44: {message:"SellerExposureCeilingExceeded"},
  45: {message:"SellerExposureCeilingNotConfigured"},
  46: {message:"BuyerOpenSessionsExceeded"},
  47: {message:"InvalidSessionCountLimit"},
  48: {message:"SellerOpenSessionsExceeded"},
  49: {message:"InvalidCapReduction"},
  50: {message:"SessionRejected"},
  51: {message:"AssetAlreadyActive"},
  52: {message:"AssetDeprecated"},
  53: {message:"AssetLimitReached"},
  54: {message:"AssetExposureCeilingExceeded"},
  55: {message:"InvalidExposureCeiling"},
  56: {message:"ExposureCeilingNotConfigured"},
  57: {message:"BuyerExposureCeilingExceeded"},
  58: {message:"BuyerExposureUnderflow"},
  59: {message:"SequenceExhausted"},
  60: {message:"IdempotencyConflict"}
}

























export interface Client {
  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reject transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reject: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  settle: ({session_id, actual_amount, usage_hash}: {session_id: Buffer, actual_amount: i128, usage_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, asset_policies}: {admin: string, asset_policies: Array<AssetPolicy>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Session>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_solvency transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only solvency snapshot for a caller-supplied list of one to
   * `MAX_SOLVENCY_QUERY_ASSETS` assets. Results preserve input order.
   * Duplicates are evaluated independently and returned once per
   * occurrence. Assets unknown to this deployment are reported as
   * `Unknown` with zero values and are never called, so arbitrary
   * contracts cannot be invoked. `surplus` is `balance - liability`
   * (negative when underfunded).
   */
  get_solvency: ({assets}: {assets: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<AssetSolvency>>>>

  /**
   * Construct and simulate a remove_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_asset: ({asset, reason_commitment}: {asset: string, reason_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_admin: ({pending_admin, expires_at_ledger}: {pending_admin: string, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a activate_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  activate_asset: ({policy}: {policy: AssetPolicy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_session: ({buyer, seller, asset, max_amount, expires_at_ledger, resource_hash, idempotency_key}: {buyer: string, seller: string, asset: string, max_amount: i128, expires_at_ledger: u32, resource_hash: Buffer, idempotency_key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a pause_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a preview_settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_settle: ({session_id, actual_amount}: {session_id: Buffer, actual_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<SettlementPreview>>

  /**
   * Construct and simulate a deprecate_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deprecate_asset: ({asset, reason_commitment}: {asset: string, reason_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recover_expired transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recover_expired: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recover_surplus transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recover_surplus: ({asset, recipient, amount}: {asset: string, recipient: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resume_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resume_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_asset_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_policy: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<AssetPolicyResponse>>>

  /**
   * Construct and simulate a get_configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_configuration: (options?: MethodOptions) => Promise<AssembledTransaction<Result<ContractConfiguration>>>

  /**
   * Construct and simulate a get_session_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session_batch: ({session_ids}: {session_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<BatchSessionResult>>>>

  /**
   * Construct and simulate a interface_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  interface_version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_admin_rotation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin_rotation: (options?: MethodOptions) => Promise<AssembledTransaction<Option<AdminRotation>>>

  /**
   * Construct and simulate a get_asset_solvency transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only, authorization-free solvency view for an active or
   * deprecated asset. It never writes state or extends TTLs.
   */
  get_asset_solvency: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<AssetSolvencySnapshot>>>

  /**
   * Construct and simulate a get_buyer_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open escrow currently held by `buyer` for `asset`.
   */
  get_buyer_exposure: ({buyer, asset}: {buyer: string, asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_recoverability transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_recoverability: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<SessionRecoverability>>

  /**
   * Construct and simulate a get_session_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session_status: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SessionStatusResponse>>>

  /**
   * Construct and simulate a reduce_session_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reduce_session_cap: ({session_id, new_max_amount}: {session_id: Buffer, new_max_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_seller_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_seller_exposure: ({seller, asset}: {seller: string, asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_escrow_liability transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow_liability: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a cancel_admin_rotation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_admin_rotation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_session_expiry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_session_expiry: ({session_id, new_expires_at_ledger}: {session_id: Buffer, new_expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recover_expired_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recover_expired_batch: ({session_ids}: {session_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<BatchRecoveryResult>>>>

  /**
   * Construct and simulate a get_asset_cap_increase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_cap_increase: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<CapIncreaseProposal>>>

  /**
   * Construct and simulate a get_buyer_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_buyer_open_sessions: ({buyer}: {buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a get_seller_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_seller_open_sessions: ({seller}: {seller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a accept_asset_cap_increase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_asset_cap_increase: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_asset_cap_increase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_asset_cap_increase: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_asset_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_exposure_ceiling: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_buyer_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_buyer_exposure_ceiling: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a propose_asset_cap_increase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_asset_cap_increase: ({asset, proposed_max_amount, active_at_ledger, expires_at_ledger}: {asset: string, proposed_max_amount: i128, active_at_ledger: u32, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_asset_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: sets the ceiling on aggregate open escrow for `asset`.
   * Lowering it below the current liability is allowed; existing sessions
   * are unaffected and new sessions are rejected until capacity returns.
   */
  set_asset_exposure_ceiling: ({asset, ceiling}: {asset: string, ceiling: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_buyer_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: sets the ceiling on open escrow any single buyer may hold
   * for `asset`. Each buyer has an independent counter.
   */
  set_buyer_exposure_ceiling: ({asset, ceiling}: {asset: string, ceiling: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_max_buyer_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_max_buyer_open_sessions: (options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a get_seller_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_seller_exposure_ceiling: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a set_max_buyer_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_max_buyer_open_sessions: ({limit}: {limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_seller_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_seller_exposure_ceiling: ({asset, ceiling}: {asset: string, ceiling: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_max_session_amount: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_asset_min_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_min_session_amount: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_max_seller_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_max_seller_open_sessions: (options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a max_session_duration_ledgers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_session_duration_ledgers: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a set_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_asset_max_session_amount: ({asset, max_session_amount}: {asset: string, max_session_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_max_seller_open_sessions transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_max_seller_open_sessions: ({limit}: {limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_commitment_domain_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_commitment_domain_metadata: (options?: MethodOptions) => Promise<AssembledTransaction<CommitmentDomainMetadata>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([
        "AAAAAAAAAAAAAAAGY2FuY2VsAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAGc2V0dGxlAAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAAAAAANYWN0dWFsX2Ftb3VudAAAAAAAAAsAAAAAAAAACnVzYWdlX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAGcmVqZWN0AAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA5hc3NldF9wb2xpY2llcwAAAAAD6gAAB9AAAAALQXNzZXRQb2xpY3kAAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAHU2Vzc2lvbgAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2Fzc2V0AAAAAgAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAABFyZWFzb25fY29tbWl0bWVudAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAIAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAATAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAcAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAA9pZGVtcG90ZW5jeV9rZXkAAAAD7gAAACAAAAABAAAD6QAAA+4AAAAgAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAOYWN0aXZhdGVfYXNzZXQAAAAAAAEAAAAAAAAABnBvbGljeQAAAAAH0AAAAAtBc3NldFBvbGljeQAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOcGF1c2VfY3JlYXRpb24AAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOcHJldmlld19zZXR0bGUAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAAAAAA1hY3R1YWxfYW1vdW50AAAAAAAACwAAAAEAAAfQAAAAEVNldHRsZW1lbnRQcmV2aWV3AAAA",
        "AAAAAAAAAAAAAAAPZGVwcmVjYXRlX2Fzc2V0AAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAARcmVhc29uX2NvbW1pdG1lbnQAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPcmVjb3Zlcl9leHBpcmVkAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAPcmVjb3Zlcl9zdXJwbHVzAAAAAAMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAPcmVzdW1lX2NyZWF0aW9uAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAQZ2V0X2Fzc2V0X3BvbGljeQAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAH0AAAABNBc3NldFBvbGljeVJlc3BvbnNlAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAARZ2V0X2NvbmZpZ3VyYXRpb24AAAAAAAAAAAAAAQAAA+kAAAfQAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAARZ2V0X3Nlc3Npb25fYmF0Y2gAAAAAAAABAAAAAAAAAAtzZXNzaW9uX2lkcwAAAAPqAAAD7gAAACAAAAABAAAD6QAAA+oAAAfQAAAAEkJhdGNoU2Vzc2lvblJlc3VsdAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAASZ2V0X2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAQAAA+gAAAfQAAAADUFkbWluUm90YXRpb24AAAA=",
        "AAAAAAAAAAAAAAASZ2V0X3JlY292ZXJhYmlsaXR5AAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAfQAAAAFVNlc3Npb25SZWNvdmVyYWJpbGl0eQAAAA==",
        "AAAAAAAAAAAAAAASZ2V0X3Nlc3Npb25fc3RhdHVzAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAABVTZXNzaW9uU3RhdHVzUmVzcG9uc2UAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAScmVkdWNlX3Nlc3Npb25fY2FwAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAAAAAAObmV3X21heF9hbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAATZ2V0X3NlbGxlcl9leHBvc3VyZQAAAAACAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAUZ2V0X2VzY3Jvd19saWFiaWxpdHkAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAVZXh0ZW5kX3Nlc3Npb25fZXhwaXJ5AAAAAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAAAAAAAFW5ld19leHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAVcmVjb3Zlcl9leHBpcmVkX2JhdGNoAAAAAAAAAQAAAAAAAAALc2Vzc2lvbl9pZHMAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAPqAAAH0AAAABNCYXRjaFJlY292ZXJ5UmVzdWx0AAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAWZ2V0X2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+gAAAfQAAAAE0NhcEluY3JlYXNlUHJvcG9zYWwA",
        "AAAAAAAAAAAAAAAXZ2V0X2J1eWVyX29wZW5fc2Vzc2lvbnMAAAAAAQAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAYZ2V0X3NlbGxlcl9vcGVuX3Nlc3Npb25zAAAAAQAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAZY2FuY2VsX2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAZYWNjZXB0X2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAaZ2V0X2Fzc2V0X2V4cG9zdXJlX2NlaWxpbmcAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAaZ2V0X2J1eWVyX2V4cG9zdXJlX2NlaWxpbmcAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAacHJvcG9zZV9hc3NldF9jYXBfaW5jcmVhc2UAAAAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAATcHJvcG9zZWRfbWF4X2Ftb3VudAAAAAALAAAAAAAAABBhY3RpdmVfYXRfbGVkZ2VyAAAABAAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAbZ2V0X21heF9idXllcl9vcGVuX3Nlc3Npb25zAAAAAAAAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAAAAAAAbZ2V0X3NlbGxlcl9leHBvc3VyZV9jZWlsaW5nAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAbc2V0X21heF9idXllcl9vcGVuX3Nlc3Npb25zAAAAAAEAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAbc2V0X3NlbGxlcl9leHBvc3VyZV9jZWlsaW5nAAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAHY2VpbGluZwAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAcZ2V0X21heF9zZWxsZXJfb3Blbl9zZXNzaW9ucwAAAAAAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21pbl9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcbWF4X3Nlc3Npb25fZHVyYXRpb25fbGVkZ2VycwAAAAAAAAABAAAABA==",
        "AAAAAAAAAAAAAAAcc2V0X21heF9zZWxsZXJfb3Blbl9zZXNzaW9ucwAAAAEAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcc2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAeZ2V0X2NvbW1pdG1lbnRfZG9tYWluX21ldGFkYXRhAAAAAAAAAAAAAQAAB9AAAAAYQ29tbWl0bWVudERvbWFpbk1ldGFkYXRh",
        "AAAAAAAAADJPcGVuIGVzY3JvdyBjdXJyZW50bHkgaGVsZCBieSBgYnV5ZXJgIGZvciBgYXNzZXRgLgAAAAAAEmdldF9idXllcl9leHBvc3VyZQAAAAAAAgAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAHVSZWFkLW9ubHksIGF1dGhvcml6YXRpb24tZnJlZSBzb2x2ZW5jeSB2aWV3IGZvciBhbiBhY3RpdmUgb3IKZGVwcmVjYXRlZCBhc3NldC4gSXQgbmV2ZXIgd3JpdGVzIHN0YXRlIG9yIGV4dGVuZHMgVFRMcy4AAAAAAAASZ2V0X2Fzc2V0X3NvbHZlbmN5AAAAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAB9AAAAAVQXNzZXRTb2x2ZW5jeVNuYXBzaG90AAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAHlBZG1pbi1vbmx5OiBzZXRzIHRoZSBjZWlsaW5nIG9uIG9wZW4gZXNjcm93IGFueSBzaW5nbGUgYnV5ZXIgbWF5IGhvbGQKZm9yIGBhc3NldGAuIEVhY2ggYnV5ZXIgaGFzIGFuIGluZGVwZW5kZW50IGNvdW50ZXIuAAAAAAAAGnNldF9idXllcl9leHBvc3VyZV9jZWlsaW5nAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2NlaWxpbmcAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAM1BZG1pbi1vbmx5OiBzZXRzIHRoZSBjZWlsaW5nIG9uIGFnZ3JlZ2F0ZSBvcGVuIGVzY3JvdyBmb3IgYGFzc2V0YC4KTG93ZXJpbmcgaXQgYmVsb3cgdGhlIGN1cnJlbnQgbGlhYmlsaXR5IGlzIGFsbG93ZWQ7IGV4aXN0aW5nIHNlc3Npb25zCmFyZSB1bmFmZmVjdGVkIGFuZCBuZXcgc2Vzc2lvbnMgYXJlIHJlamVjdGVkIHVudGlsIGNhcGFjaXR5IHJldHVybnMuAAAAAAAAGnNldF9hc3NldF9leHBvc3VyZV9jZWlsaW5nAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2NlaWxpbmcAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAZhSZWFkLW9ubHkgc29sdmVuY3kgc25hcHNob3QgZm9yIGEgY2FsbGVyLXN1cHBsaWVkIGxpc3Qgb2Ygb25lIHRvCmBNQVhfU09MVkVOQ1lfUVVFUllfQVNTRVRTYCBhc3NldHMuIFJlc3VsdHMgcHJlc2VydmUgaW5wdXQgb3JkZXIuCkR1cGxpY2F0ZXMgYXJlIGV2YWx1YXRlZCBpbmRlcGVuZGVudGx5IGFuZCByZXR1cm5lZCBvbmNlIHBlcgpvY2N1cnJlbmNlLiBBc3NldHMgdW5rbm93biB0byB0aGlzIGRlcGxveW1lbnQgYXJlIHJlcG9ydGVkIGFzCmBVbmtub3duYCB3aXRoIHplcm8gdmFsdWVzIGFuZCBhcmUgbmV2ZXIgY2FsbGVkLCBzbyBhcmJpdHJhcnkKY29udHJhY3RzIGNhbm5vdCBiZSBpbnZva2VkLiBgc3VycGx1c2AgaXMgYGJhbGFuY2UgLSBsaWFiaWxpdHlgCihuZWdhdGl2ZSB3aGVuIHVuZGVyZnVuZGVkKS4AAAAMZ2V0X3NvbHZlbmN5AAAAAQAAAAAAAAAGYXNzZXRzAAAAAAPqAAAAEwAAAAEAAAPpAAAD6gAAB9AAAAANQXNzZXRTb2x2ZW5jeQAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAADwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAD2NyZWF0aW9uX2xlZGdlcgAAAAAEAAAAAAAAAA9lc2Nyb3dlZF9hbW91bnQAAAAACwAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAABBmaW5hbGl6ZWRfbGVkZ2VyAAAD6AAAAAQAAAAAAAAAAmlkAAAAAAPuAAAAIAAAAAAAAAAKbWF4X2Ftb3VudAAAAAAACwAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAABdyZXNvdXJjZV9zY2hlbWVfdmVyc2lvbgAAAAAEAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAADnNldHRsZWRfYW1vdW50AAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAAAAAAAAAAAKdXNhZ2VfaGFzaAAAAAAD6AAAA+4AAAAgAAAAAAAAABR1c2FnZV9zY2hlbWVfdmVyc2lvbgAAA+gAAAAE",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0UG9saWN5AAAAAAUAAAAAAAAABWFzc2V0AAAAAAAAEwAAAEVDZWlsaW5nIG9uIHRoZSBzdW0gb2Ygb3BlbiBlc2Nyb3cgZm9yIHRoaXMgYXNzZXQgYWNyb3NzIGFsbCBzZXNzaW9ucy4AAAAAAAASbWF4X2Fzc2V0X2V4cG9zdXJlAAAAAAALAAAAR0NlaWxpbmcgb24gdGhlIHN1bSBvZiBvcGVuIGVzY3JvdyBmb3IgdGhpcyBhc3NldCBoZWxkIGJ5IGFueSBvbmUgYnV5ZXIuAAAAABJtYXhfYnV5ZXJfZXhwb3N1cmUAAAAAAAsAAAAAAAAAEm1heF9zZXNzaW9uX2Ftb3VudAAAAAAACwAAAAAAAAASbWluX3Nlc3Npb25fYW1vdW50AAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADUFkbWluUm90YXRpb24AAAAAAAACAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAT",
        "AAAAAQAAAAAAAAAAAAAADUFzc2V0U29sdmVuY3kAAAAAAAAFAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2JhbGFuY2UAAAAACwAAAAAAAAAJbGlhYmlsaXR5AAAAAAAACwAAAAAAAAAFc3RhdGUAAAAAAAfQAAAAElNvbHZlbmN5QXNzZXRTdGF0ZQAAAAAAAAAAAAdzdXJwbHVzAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAE0Fzc2V0UG9saWN5UmVzcG9uc2UAAAAABQAAAAAAAAAUYWNjZXB0c19uZXdfc2Vzc2lvbnMAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACWxpZmVjeWNsZQAAAAAAB9AAAAAOQXNzZXRMaWZlY3ljbGUAAAAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAPoAAAACwAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlSZXN1bHQAAAAAAwAAAAAAAAAPcmVmdW5kZWRfYW1vdW50AAAAAAsAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAATQmF0Y2hSZWNvdmVyeVN0YXR1cwA=",
        "AAAAAQAAAAAAAAAAAAAAE0NhcEluY3JlYXNlUHJvcG9zYWwAAAAAAwAAAAAAAAAQYWN0aXZlX2F0X2xlZGdlcgAAAAQAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAATcHJvcG9zZWRfbWF4X2Ftb3VudAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAAEVNldHRsZW1lbnRQcmV2aWV3AAAAAAAABgAAAAAAAAANYWN0dWFsX2Ftb3VudAAAAAAAAAsAAAAAAAAADGJ1eWVyX3JlZnVuZAAAAAsAAAAAAAAACGVsaWdpYmxlAAAAAQAAAAAAAAAKaXNfZXhwaXJlZAAAAAAAAQAAAAAAAAAQcmVqZWN0aW9uX3JlYXNvbgAAB9AAAAAZU2V0dGxlbWVudFJlamVjdGlvblJlYXNvbgAAAAAAAAAAAAANc2VsbGVyX3BheW91dAAAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAEkJhdGNoU2Vzc2lvblJlc3VsdAAAAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAAAAAAABnN0YXR1cwAAAAAH0AAAABJCYXRjaFNlc3Npb25TdGF0dXMAAA==",
        "AAAAAQAAAAAAAAAAAAAAFUFzc2V0U29sdmVuY3lTbmFwc2hvdAAAAAAAAAgAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAMYXNzZXRfc3RhdHVzAAAH0AAAAAtBc3NldFN0YXR1cwAAAAA5YGxpYWJpbGl0eSAtIHRva2VuX2JhbGFuY2VgIHdoZW4gcG9zaXRpdmUsIG90aGVyd2lzZSBgMGAuAAAAAAAAB2RlZmljaXQAAAAACwAAAAAAAAAJbGlhYmlsaXR5AAAAAAAACwAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA5Tb2x2ZW5jeVN0YXR1cwAAAAAAOWB0b2tlbl9iYWxhbmNlIC0gbGlhYmlsaXR5YCB3aGVuIHBvc2l0aXZlLCBvdGhlcndpc2UgYDBgLgAAAAAAAAdzdXJwbHVzAAAAAAsAAABYQmFsYW5jZSByZXBvcnRlZCBieSB0aGUgdG9rZW4gZm9yIHRoaXMgY29udHJhY3QsIG9yIGBOb25lYCB3aGVuIHRoZQpiYWxhbmNlIGNhbGwgZmFpbGVkLgAAAA10b2tlbl9iYWxhbmNlAAAAAAAD6AAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAAAoAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAWaW5zdGFuY2VfdHRsX2V4dGVuc2lvbgAAAAAABAAAAAAAAAAWaW5zdGFuY2VfdHRsX3RocmVzaG9sZAAAAAAABAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAEAAAAAAAAABxtYXhfc2Vzc2lvbl9kdXJhdGlvbl9sZWRnZXJzAAAABAAAAAAAAAAUbWF4X3N1cHBvcnRlZF9hc3NldHMAAAAEAAAAAAAAABFvcGVyYXRpb25hbF9zdGF0ZQAAAAAAB9AAAAAQT3BlcmF0aW9uYWxTdGF0ZQAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAAFnN0b3JhZ2VfbGF5b3V0X3ZlcnNpb24AAAAAAAQAAAAAAAAAEHN1cHBvcnRlZF9hc3NldHMAAAPqAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAAFVNlc3Npb25SZWNvdmVyYWJpbGl0eQAAAAAAAAcAAAAAAAAABWFzc2V0AAAAAAAD6AAAABMAAAAAAAAADmN1cnJlbnRfbGVkZ2VyAAAAAAAEAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAACXJlY2lwaWVudAAAAAAAA+gAAAATAAAAAAAAABFyZWZ1bmRhYmxlX2Ftb3VudAAAAAAAAAsAAAAAAAAAEHJlc3BvbnNlX3ZlcnNpb24AAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAUUmVjb3ZlcmFiaWxpdHlTdGF0dXM=",
        "AAAAAQAAAAAAAAAAAAAAFVNlc3Npb25TdGF0dXNSZXNwb25zZQAAAAAAAAMAAAAAAAAABmV4aXN0cwAAAAAAAQAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAA==",
        "AAAAAQAAAAAAAAAAAAAAGENvbW1pdG1lbnREb21haW5NZXRhZGF0YQAAAAUAAAAAAAAAEWludGVyZmFjZV92ZXJzaW9uAAAAAAAABAAAAAAAAAAWcmVjZWlwdF9zY2hlbWFfdmVyc2lvbgAAAAAABAAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAAEXNlc3Npb25faWRfZG9tYWluAAAAAAAD7gAAACAAAAAAAAAAF3VzYWdlX2NvbW1pdG1lbnRfZG9tYWluAAAAA+4AAAAg",
        "AAAAAgAAAAAAAAAAAAAAC0Fzc2V0U3RhdHVzAAAAAAIAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAAAgAAAAAAAAAAAAAADVNlc3Npb25TdGF0dXMAAAAAAAAFAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAAAAAAAHRXhwaXJlZAAAAAAAAAAAAAAAAAhSZWplY3RlZA==",
        "AAAAAgAAAAAAAAAAAAAADkFzc2V0TGlmZWN5Y2xlAAAAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAApEZXByZWNhdGVkAAAAAAAAAAAAAAAAAA1Ob3RDb25maWd1cmVkAAAA",
        "AAAAAgAAAAAAAAAAAAAADlNvbHZlbmN5U3RhdHVzAAAAAAAEAAAAAAAAACdUb2tlbiBiYWxhbmNlIGVxdWFscyB0cmFja2VkIGxpYWJpbGl0eS4AAAAADkNvbGxhdGVyYWxpemVkAAAAAAAAAAAAP1Rva2VuIGJhbGFuY2UgZXhjZWVkcyB0cmFja2VkIGxpYWJpbGl0eTsgYHN1cnBsdXNgIGlzIHBvc2l0aXZlLgAAAAAHU3VycGx1cwAAAAAAAAAAQFRva2VuIGJhbGFuY2UgaXMgYmVsb3cgdHJhY2tlZCBsaWFiaWxpdHk7IGBkZWZpY2l0YCBpcyBwb3NpdGl2ZS4AAAALVW5kZXJmdW5kZWQAAAAAAAAAAFpUaGUgdG9rZW4gYmFsYW5jZSBjYWxsIGZhaWxlZCBvciByZXR1cm5lZCBhIHZhbHVlIHRoYXQgY2Fubm90IGJlIGEKYmFsYW5jZS4gTmV2ZXIgaGVhbHRoeS4AAAAAABJCYWxhbmNlVW5hdmFpbGFibGUAAA==",
        "AAAAAgAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlTdGF0dXMAAAAACQAAAAAAAAAAAAAACVJlY292ZXJlZAAAAAAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAKTm90RXhwaXJlZAAAAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAABBBbHJlYWR5UmVjb3ZlcmVkAAAAAAAAAAAAAAAPQWxyZWFkeVJlamVjdGVkAAAAAAAAAAAAAAAACUR1cGxpY2F0ZQAAAAAAAAAAAAAAAAAAEUVzY3Jvd1VuYXZhaWxhYmxlAAAA",
        "AAAAAgAAAAAAAAAAAAAAEE9wZXJhdGlvbmFsU3RhdGUAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZQYXVzZWQAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAAAgAAAAAAAAAAAAAAEkJhdGNoU2Vzc2lvblN0YXR1cwAAAAAAAgAAAAEAAAAAAAAABUZvdW5kAAAAAAAAAQAAB9AAAAAHU2Vzc2lvbgAAAAAAAAAAAAAAAAhOb3RGb3VuZA==",
        "AAAAAgAAAAAAAAAAAAAAElNvbHZlbmN5QXNzZXRTdGF0ZQAAAAAAAwAAAAAAAAAAAAAAB1Vua25vd24AAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAApEZXByZWNhdGVkAAA=",
        "AAAAAgAAAAAAAAAAAAAAFFJlY292ZXJhYmlsaXR5U3RhdHVzAAAABwAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAKTm90RXhwaXJlZAAAAAAAAAAAAAAAAAALUmVjb3ZlcmFibGUAAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAABBBbHJlYWR5UmVjb3ZlcmVkAAAAAAAAAAAAAAAPQWxyZWFkeVJlamVjdGVkAA==",
        "AAAAAgAAAAAAAAAAAAAAGVNldHRsZW1lbnRSZWplY3Rpb25SZWFzb24AAAAAAAAKAAAAAAAAAAAAAAAETm9uZQAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAAA5BbHJlYWR5RXhwaXJlZAAAAAAAAAAAAAAAAAAPQWxyZWFkeVJlamVjdGVkAAAAAAAAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAAAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAAAAAAAAAAAAAHRXhwaXJlZAAAAAAAAAAAAAAAABFFc2Nyb3dVbmRlcmZ1bmRlZAAAAA==",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAA8AAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAAA5FeHBpcmVkU2Vzc2lvbgAAAAAABAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAUAAAAAAAAAFVNlc3Npb25BbHJlYWR5U2V0dGxlZAAAAAAAAAYAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAAHAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAACAAAAAAAAAAMSW52YWxpZEFzc2V0AAAACQAAAAAAAAANSW52YWxpZFNlbGxlcgAAAAAAAAoAAAAAAAAAElR0bEV4dGVuc2lvbkZhaWxlZAAAAAAACwAAAAAAAAATSW52YWxpZFJlc291cmNlSGFzaAAAAAAMAAAAAAAAABBJbnZhbGlkVXNhZ2VIYXNoAAAADQAAAAAAAAAQVW5zdXBwb3J0ZWRBc3NldAAAAA4AAAAAAAAAFkludmFsaWRTdXBwb3J0ZWRBc3NldHMAAAAAAA8AAAAAAAAAFlNlc3Npb25EdXJhdGlvblRvb0xvbmcAAAAAABAAAAAAAAAAEUxpYWJpbGl0eU92ZXJmbG93AAAAAAAAEQAAAAAAAAASTGlhYmlsaXR5VW5kZXJmbG93AAAAAAASAAAAAAAAABFFc2Nyb3dVbmRlcmZ1bmRlZAAAAAAAABMAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAUAAAAAAAAAA5TZXNzaW9uRXhwaXJlZAAAAAAAFQAAAAAAAAARU2Vzc2lvbk5vdEV4cGlyZWQAAAAAAAAWAAAAAAAAAA9JbnZhbGlkQXNzZXRDYXAAAAAAFwAAAAAAAAAVQXNzZXRDYXBOb3RDb25maWd1cmVkAAAAAAAAGAAAAAAAAAAMSW52YWxpZEFkbWluAAAAGQAAAAAAAAAaSW52YWxpZEFkbWluUm90YXRpb25FeHBpcnkAAAAAABoAAAAAAAAAFEFkbWluUm90YXRpb25QZW5kaW5nAAAAGwAAAAAAAAAVQWRtaW5Sb3RhdGlvbk5vdEZvdW5kAAAAAAAAHAAAAAAAAAAUQWRtaW5Sb3RhdGlvbkV4cGlyZWQAAAAdAAAAAAAAABdUb2tlbkludmFyaWFudFZpb2xhdGlvbgAAAAAeAAAAAAAAABBJbnZhbGlkQmF0Y2hTaXplAAAAHwAAAAAAAAAVSW52YWxpZEFzc2V0SW50ZXJmYWNlAAAAAAAAIAAAAAAAAAAOQXNzZXROb3RBY3RpdmUAAAAAACEAAAAAAAAAEkFzc2V0Tm90RGVwcmVjYXRlZAAAAAAAIgAAAAAAAAAZQXNzZXRMaWFiaWxpdHlPdXRzdGFuZGluZwAAAAAAACMAAAAAAAAADkNyZWF0aW9uUGF1c2VkAAAAAAAkAAAAAAAAABlPcGVyYXRpb25hbFN0YXRlVW5jaGFuZ2VkAAAAAAAAJQAAAAAAAAASQ2FwSW5jcmVhc2VQZW5kaW5nAAAAAAAmAAAAAAAAABNDYXBJbmNyZWFzZU5vdFJlYWR5AAAAACcAAAAAAAAAE0NhcEluY3JlYXNlTm90Rm91bmQAAAAAKAAAAAAAAAASQ2FwSW5jcmVhc2VFeHBpcmVkAAAAAAApAAAAAAAAABdJbnZhbGlkQ2FwSW5jcmVhc2VEZWxheQAAAAAqAAAAAAAAABtVbnN1cHBvcnRlZENvbW1pdG1lbnRTY2hlbWUAAAAAKwAAAAAAAAAdU2VsbGVyRXhwb3N1cmVDZWlsaW5nRXhjZWVkZWQAAAAAAAAsAAAAAAAAACJTZWxsZXJFeHBvc3VyZUNlaWxpbmdOb3RDb25maWd1cmVkAAAAAAAtAAAAAAAAABlCdXllck9wZW5TZXNzaW9uc0V4Y2VlZGVkAAAAAAAALgAAAAAAAAAYSW52YWxpZFNlc3Npb25Db3VudExpbWl0AAAALwAAAAAAAAAaU2VsbGVyT3BlblNlc3Npb25zRXhjZWVkZWQAAAAAADAAAAAAAAAAE0ludmFsaWRDYXBSZWR1Y3Rpb24AAAAAMQAAAAAAAAAPU2Vzc2lvblJlamVjdGVkAAAAADIAAAAAAAAAEkFzc2V0QWxyZWFkeUFjdGl2ZQAAAAAAMwAAAAAAAAAPQXNzZXREZXByZWNhdGVkAAAAADQAAAAAAAAAEUFzc2V0TGltaXRSZWFjaGVkAAAAAAAANQAAAAAAAAAcQXNzZXRFeHBvc3VyZUNlaWxpbmdFeGNlZWRlZAAAADYAAAAAAAAAFkludmFsaWRFeHBvc3VyZUNlaWxpbmcAAAAAADcAAAAAAAAAHEV4cG9zdXJlQ2VpbGluZ05vdENvbmZpZ3VyZWQAAAA4AAAAAAAAABxCdXllckV4cG9zdXJlQ2VpbGluZ0V4Y2VlZGVkAAAAOQAAAAAAAAAWQnV5ZXJFeHBvc3VyZVVuZGVyZmxvdwAAAAAAOgAAAAAAAAARU2VxdWVuY2VFeGhhdXN0ZWQAAAAAAAA7AAAAAAAAABNJZGVtcG90ZW5jeUNvbmZsaWN0AAAAADw=",
        "AAAABQAAAAAAAAAAAAAAD0Fzc2V0RGVwcmVjYXRlZAAAAAABAAAAEGFzc2V0X2RlcHJlY2F0ZWQAAAAEAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAAAAABFyZWFzb25fY29tbWl0bWVudAAAAAAAA+4AAAAgAAAAAAAAAAAAAAANZXZlbnRfdmVyc2lvbgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD0NyZWF0aW9uUmVzdW1lZAAAAAABAAAAEGNyZWF0aW9uX3Jlc3VtZWQAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAAAAAAAA1ldmVudF92ZXJzaW9uAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD1Nlc3Npb25SZWplY3RlZAAAAAABAAAAEHNlc3Npb25fcmVqZWN0ZWQAAAAGAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAADWV2ZW50X3ZlcnNpb24AAAAAAAAEAAAAAAAAAAAAAAAPcmVmdW5kZWRfYW1vdW50AAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADEFzc2V0UmVtb3ZlZAAAAAEAAAANYXNzZXRfcmVtb3ZlZAAAAAAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAAAAAAEXJlYXNvbl9jb21taXRtZW50AAAAAAAD7gAAACAAAAAAAAAAAAAAAA1ldmVudF92ZXJzaW9uAAAAAAAABAAAAAAAAAAC",
        "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"
      ]),
      options
    )
  }
  public readonly fromJSON = {
    cancel: this.txFromJSON<Result<void>>,
        reject: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<Result<string>>,
        extend_ttl: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<Session>>,
        accept_admin: this.txFromJSON<Result<void>>,
        get_solvency: this.txFromJSON<Result<Array<AssetSolvency>>>,
        remove_asset: this.txFromJSON<Result<void>>,
        propose_admin: this.txFromJSON<Result<void>>,
        activate_asset: this.txFromJSON<Result<void>>,
        create_session: this.txFromJSON<Result<Buffer>>,
        pause_creation: this.txFromJSON<Result<void>>,
        preview_settle: this.txFromJSON<SettlementPreview>,
        deprecate_asset: this.txFromJSON<Result<void>>,
        recover_expired: this.txFromJSON<Result<void>>,
        recover_surplus: this.txFromJSON<Result<void>>,
        resume_creation: this.txFromJSON<Result<void>>,
        get_asset_policy: this.txFromJSON<Result<AssetPolicyResponse>>,
        get_configuration: this.txFromJSON<Result<ContractConfiguration>>,
        get_session_batch: this.txFromJSON<Result<Array<BatchSessionResult>>>,
        interface_version: this.txFromJSON<u32>,
        get_admin_rotation: this.txFromJSON<Option<AdminRotation>>,
        get_asset_solvency: this.txFromJSON<Result<AssetSolvencySnapshot>>,
        get_buyer_exposure: this.txFromJSON<Result<i128>>,
        get_recoverability: this.txFromJSON<SessionRecoverability>,
        get_session_status: this.txFromJSON<Result<SessionStatusResponse>>,
        reduce_session_cap: this.txFromJSON<Result<void>>,
        get_seller_exposure: this.txFromJSON<Result<i128>>,
        get_escrow_liability: this.txFromJSON<Result<i128>>,
        cancel_admin_rotation: this.txFromJSON<Result<void>>,
        extend_session_expiry: this.txFromJSON<Result<void>>,
        recover_expired_batch: this.txFromJSON<Result<Array<BatchRecoveryResult>>>,
        get_asset_cap_increase: this.txFromJSON<Option<CapIncreaseProposal>>,
        get_buyer_open_sessions: this.txFromJSON<Result<u32>>,
        get_seller_open_sessions: this.txFromJSON<Result<u32>>,
        accept_asset_cap_increase: this.txFromJSON<Result<void>>,
        cancel_asset_cap_increase: this.txFromJSON<Result<void>>,
        get_asset_exposure_ceiling: this.txFromJSON<Result<i128>>,
        get_buyer_exposure_ceiling: this.txFromJSON<Result<i128>>,
        propose_asset_cap_increase: this.txFromJSON<Result<void>>,
        set_asset_exposure_ceiling: this.txFromJSON<Result<void>>,
        set_buyer_exposure_ceiling: this.txFromJSON<Result<void>>,
        get_max_buyer_open_sessions: this.txFromJSON<Option<u32>>,
        get_seller_exposure_ceiling: this.txFromJSON<Result<i128>>,
        set_max_buyer_open_sessions: this.txFromJSON<Result<void>>,
        set_seller_exposure_ceiling: this.txFromJSON<Result<void>>,
        get_asset_max_session_amount: this.txFromJSON<Result<i128>>,
        get_asset_min_session_amount: this.txFromJSON<Result<i128>>,
        get_max_seller_open_sessions: this.txFromJSON<Option<u32>>,
        max_session_duration_ledgers: this.txFromJSON<u32>,
        set_asset_max_session_amount: this.txFromJSON<Result<void>>,
        set_max_seller_open_sessions: this.txFromJSON<Result<void>>,
        get_commitment_domain_metadata: this.txFromJSON<CommitmentDomainMetadata>
  }
}

export * from "./usageReceipt.js";

export * from "./contractErrors.js";
export * from "./sessionId.js";
export * from "./transactionEvidence.js";
