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
  36: {message:"CreationPaused"},
  37: {message:"OperationalStateUnchanged"}
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
  max_session_amount: i128;
  min_session_amount: i128;
}


export interface AdminRotation {
  expires_at_ledger: u32;
  pending_admin: string;
}

export type SessionStatus = {tag: "Open", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void} | {tag: "Expired", values: void};

export type OperationalState = {tag: "Active", values: void} | {tag: "Paused", values: void} | {tag: "Deprecated", values: void};


export interface BatchRecoveryResult {
  refunded_amount: i128;
  session_id: Buffer;
  status: BatchRecoveryStatus;
}

export type BatchRecoveryStatus = {tag: "Recovered", values: void} | {tag: "NotFound", values: void} | {tag: "NotExpired", values: void} | {tag: "AlreadySettled", values: void} | {tag: "AlreadyCancelled", values: void} | {tag: "AlreadyRecovered", values: void} | {tag: "Duplicate", values: void} | {tag: "EscrowUnavailable", values: void};


export interface CapIncreaseProposal {
  active_at_ledger: u32;
  expires_at_ledger: u32;
  proposed_max_amount: i128;
}


export interface ContractConfiguration {
  admin: string;
  instance_ttl_extension: u32;
  instance_ttl_threshold: u32;
  interface_version: u32;
  max_supported_assets: u32;
  operational_state: OperationalState;
  response_version: u32;
  storage_layout_version: u32;
  supported_assets: Array<string>;
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

export interface Client {
  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Construct and simulate a remove_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_asset: ({asset, reason_commitment}: {asset: string, reason_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_admin: ({pending_admin, expires_at_ledger}: {pending_admin: string, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_session: ({buyer, seller, asset, max_amount, expires_at_ledger, resource_hash}: {buyer: string, seller: string, asset: string, max_amount: i128, expires_at_ledger: u32, resource_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a pause_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deprecate_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deprecate_asset: ({asset, reason_commitment}: {asset: string, reason_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recover_expired transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recover_expired: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resume_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resume_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_configuration: (options?: MethodOptions) => Promise<AssembledTransaction<Result<ContractConfiguration>>>

  /**
   * Construct and simulate a interface_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  interface_version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_admin_rotation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin_rotation: (options?: MethodOptions) => Promise<AssembledTransaction<Option<AdminRotation>>>

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
   * Construct and simulate a propose_asset_cap_increase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_asset_cap_increase: ({asset, proposed_max_amount, active_at_ledger, expires_at_ledger}: {asset: string, proposed_max_amount: i128, active_at_ledger: u32, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA5hc3NldF9wb2xpY2llcwAAAAAD6gAAB9AAAAALQXNzZXRQb2xpY3kAAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAHU2Vzc2lvbgAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2Fzc2V0AAAAAgAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAABFyZWFzb25fY29tbWl0bWVudAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAIAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAATAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAOcGF1c2VfY3JlYXRpb24AAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAPZGVwcmVjYXRlX2Fzc2V0AAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAARcmVhc29uX2NvbW1pdG1lbnQAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPcmVjb3Zlcl9leHBpcmVkAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAPcmVzdW1lX2NyZWF0aW9uAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAARZ2V0X2NvbmZpZ3VyYXRpb24AAAAAAAAAAAAAAQAAA+kAAAfQAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAASZ2V0X2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAQAAA+gAAAfQAAAADUFkbWluUm90YXRpb24AAAA=",
        "AAAAAAAAAAAAAAASZ2V0X3Nlc3Npb25fc3RhdHVzAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAABVTZXNzaW9uU3RhdHVzUmVzcG9uc2UAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAScmVkdWNlX3Nlc3Npb25fY2FwAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAAAAAAObmV3X21heF9hbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAATZ2V0X3NlbGxlcl9leHBvc3VyZQAAAAACAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAUZ2V0X2VzY3Jvd19saWFiaWxpdHkAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAVcmVjb3Zlcl9leHBpcmVkX2JhdGNoAAAAAAAAAQAAAAAAAAALc2Vzc2lvbl9pZHMAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAPqAAAH0AAAABNCYXRjaFJlY292ZXJ5UmVzdWx0AAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAWZ2V0X2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+gAAAfQAAAAE0NhcEluY3JlYXNlUHJvcG9zYWwA",
        "AAAAAAAAAAAAAAAXZ2V0X2J1eWVyX29wZW5fc2Vzc2lvbnMAAAAAAQAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAYZ2V0X3NlbGxlcl9vcGVuX3Nlc3Npb25zAAAAAQAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAZY2FuY2VsX2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAZYWNjZXB0X2Fzc2V0X2NhcF9pbmNyZWFzZQAAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAacHJvcG9zZV9hc3NldF9jYXBfaW5jcmVhc2UAAAAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAATcHJvcG9zZWRfbWF4X2Ftb3VudAAAAAALAAAAAAAAABBhY3RpdmVfYXRfbGVkZ2VyAAAABAAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAbZ2V0X21heF9idXllcl9vcGVuX3Nlc3Npb25zAAAAAAAAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAAAAAAAbZ2V0X3NlbGxlcl9leHBvc3VyZV9jZWlsaW5nAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAbc2V0X21heF9idXllcl9vcGVuX3Nlc3Npb25zAAAAAAEAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAbc2V0X3NlbGxlcl9leHBvc3VyZV9jZWlsaW5nAAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAHY2VpbGluZwAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAcZ2V0X21heF9zZWxsZXJfb3Blbl9zZXNzaW9ucwAAAAAAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21pbl9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcc2V0X21heF9zZWxsZXJfb3Blbl9zZXNzaW9ucwAAAAEAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcc2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAeZ2V0X2NvbW1pdG1lbnRfZG9tYWluX21ldGFkYXRhAAAAAAAAAAAAAQAAB9AAAAAYQ29tbWl0bWVudERvbWFpbk1ldGFkYXRh",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAADwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAD2NyZWF0aW9uX2xlZGdlcgAAAAAEAAAAAAAAAA9lc2Nyb3dlZF9hbW91bnQAAAAACwAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAABBmaW5hbGl6ZWRfbGVkZ2VyAAAD6AAAAAQAAAAAAAAAAmlkAAAAAAPuAAAAIAAAAAAAAAAKbWF4X2Ftb3VudAAAAAAACwAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAABdyZXNvdXJjZV9zY2hlbWVfdmVyc2lvbgAAAAAEAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAADnNldHRsZWRfYW1vdW50AAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAAAAAAAAAAAKdXNhZ2VfaGFzaAAAAAAD6AAAA+4AAAAgAAAAAAAAABR1c2FnZV9zY2hlbWVfdmVyc2lvbgAAA+gAAAAE",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0UG9saWN5AAAAAAMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAALAAAAAAAAABJtaW5fc2Vzc2lvbl9hbW91bnQAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAADUFkbWluUm90YXRpb24AAAAAAAACAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAT",
        "AAAAAQAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlSZXN1bHQAAAAAAwAAAAAAAAAPcmVmdW5kZWRfYW1vdW50AAAAAAsAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAATQmF0Y2hSZWNvdmVyeVN0YXR1cwA=",
        "AAAAAQAAAAAAAAAAAAAAE0NhcEluY3JlYXNlUHJvcG9zYWwAAAAAAwAAAAAAAAAQYWN0aXZlX2F0X2xlZGdlcgAAAAQAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAATcHJvcG9zZWRfbWF4X2Ftb3VudAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAAAkAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAWaW5zdGFuY2VfdHRsX2V4dGVuc2lvbgAAAAAABAAAAAAAAAAWaW5zdGFuY2VfdHRsX3RocmVzaG9sZAAAAAAABAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAEAAAAAAAAABRtYXhfc3VwcG9ydGVkX2Fzc2V0cwAAAAQAAAAAAAAAEW9wZXJhdGlvbmFsX3N0YXRlAAAAAAAH0AAAABBPcGVyYXRpb25hbFN0YXRlAAAAAAAAABByZXNwb25zZV92ZXJzaW9uAAAABAAAAAAAAAAWc3RvcmFnZV9sYXlvdXRfdmVyc2lvbgAAAAAABAAAAAAAAAAQc3VwcG9ydGVkX2Fzc2V0cwAAA+oAAAAT",
        "AAAAAQAAAAAAAAAAAAAAFVNlc3Npb25TdGF0dXNSZXNwb25zZQAAAAAAAAMAAAAAAAAABmV4aXN0cwAAAAAAAQAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAA==",
        "AAAAAQAAAAAAAAAAAAAAGENvbW1pdG1lbnREb21haW5NZXRhZGF0YQAAAAUAAAAAAAAAEWludGVyZmFjZV92ZXJzaW9uAAAAAAAABAAAAAAAAAAWcmVjZWlwdF9zY2hlbWFfdmVyc2lvbgAAAAAABAAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAAEXNlc3Npb25faWRfZG9tYWluAAAAAAAD7gAAACAAAAAAAAAAF3VzYWdlX2NvbW1pdG1lbnRfZG9tYWluAAAAA+4AAAAg",
        "AAAAAgAAAAAAAAAAAAAADVNlc3Npb25TdGF0dXMAAAAAAAAEAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAAAAAAAHRXhwaXJlZAA=",
        "AAAAAgAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlTdGF0dXMAAAAACAAAAAAAAAAAAAAACVJlY292ZXJlZAAAAAAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAKTm90RXhwaXJlZAAAAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAABBBbHJlYWR5UmVjb3ZlcmVkAAAAAAAAAAAAAAAJRHVwbGljYXRlAAAAAAAAAAAAAAAAAAARRXNjcm93VW5hdmFpbGFibGUAAAA=",
        "AAAAAgAAAAAAAAAAAAAAEE9wZXJhdGlvbmFsU3RhdGUAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZQYXVzZWQAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAAxAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAAA5FeHBpcmVkU2Vzc2lvbgAAAAAABAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAUAAAAAAAAAFVNlc3Npb25BbHJlYWR5U2V0dGxlZAAAAAAAAAYAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAAHAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAACAAAAAAAAAAMSW52YWxpZEFzc2V0AAAACQAAAAAAAAANSW52YWxpZFNlbGxlcgAAAAAAAAoAAAAAAAAAElR0bEV4dGVuc2lvbkZhaWxlZAAAAAAACwAAAAAAAAATSW52YWxpZFJlc291cmNlSGFzaAAAAAAMAAAAAAAAABBJbnZhbGlkVXNhZ2VIYXNoAAAADQAAAAAAAAAQVW5zdXBwb3J0ZWRBc3NldAAAAA4AAAAAAAAAFkludmFsaWRTdXBwb3J0ZWRBc3NldHMAAAAAAA8AAAAAAAAAFlNlc3Npb25EdXJhdGlvblRvb0xvbmcAAAAAABAAAAAAAAAAEUxpYWJpbGl0eU92ZXJmbG93AAAAAAAAEQAAAAAAAAASTGlhYmlsaXR5VW5kZXJmbG93AAAAAAASAAAAAAAAABFFc2Nyb3dVbmRlcmZ1bmRlZAAAAAAAABMAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAUAAAAAAAAAA5TZXNzaW9uRXhwaXJlZAAAAAAAFQAAAAAAAAARU2Vzc2lvbk5vdEV4cGlyZWQAAAAAAAAWAAAAAAAAAA9JbnZhbGlkQXNzZXRDYXAAAAAAFwAAAAAAAAAVQXNzZXRDYXBOb3RDb25maWd1cmVkAAAAAAAAGAAAAAAAAAAMSW52YWxpZEFkbWluAAAAGQAAAAAAAAAaSW52YWxpZEFkbWluUm90YXRpb25FeHBpcnkAAAAAABoAAAAAAAAAFEFkbWluUm90YXRpb25QZW5kaW5nAAAAGwAAAAAAAAAVQWRtaW5Sb3RhdGlvbk5vdEZvdW5kAAAAAAAAHAAAAAAAAAAUQWRtaW5Sb3RhdGlvbkV4cGlyZWQAAAAdAAAAAAAAABdUb2tlbkludmFyaWFudFZpb2xhdGlvbgAAAAAeAAAAAAAAABBJbnZhbGlkQmF0Y2hTaXplAAAAHwAAAAAAAAAVSW52YWxpZEFzc2V0SW50ZXJmYWNlAAAAAAAAIAAAAAAAAAAOQXNzZXROb3RBY3RpdmUAAAAAACEAAAAAAAAAEkFzc2V0Tm90RGVwcmVjYXRlZAAAAAAAIgAAAAAAAAAZQXNzZXRMaWFiaWxpdHlPdXRzdGFuZGluZwAAAAAAACMAAAAAAAAAEkNhcEluY3JlYXNlUGVuZGluZwAAAAAAJgAAAAAAAAATQ2FwSW5jcmVhc2VOb3RSZWFkeQAAAAAnAAAAAAAAABNDYXBJbmNyZWFzZU5vdEZvdW5kAAAAACgAAAAAAAAAEkNhcEluY3JlYXNlRXhwaXJlZAAAAAAAKQAAAAAAAAAXSW52YWxpZENhcEluY3JlYXNlRGVsYXkAAAAAKgAAAAAAAAAbVW5zdXBwb3J0ZWRDb21taXRtZW50U2NoZW1lAAAAACsAAAAAAAAAHVNlbGxlckV4cG9zdXJlQ2VpbGluZ0V4Y2VlZGVkAAAAAAAALAAAAAAAAAAiU2VsbGVyRXhwb3N1cmVDZWlsaW5nTm90Q29uZmlndXJlZAAAAAAALQAAAAAAAAAZQnV5ZXJPcGVuU2Vzc2lvbnNFeGNlZWRlZAAAAAAAAC4AAAAAAAAAGEludmFsaWRTZXNzaW9uQ291bnRMaW1pdAAAAC8AAAAAAAAAGlNlbGxlck9wZW5TZXNzaW9uc0V4Y2VlZGVkAAAAAAAwAAAAAAAAABNJbnZhbGlkQ2FwUmVkdWN0aW9uAAAAADEAAAAAAAAADkNyZWF0aW9uUGF1c2VkAAAAAAAkAAAAAAAAABlPcGVyYXRpb25hbFN0YXRlVW5jaGFuZ2VkAAAAAAAAJQ==",
        "AAAABQAAAAAAAAAAAAAAD0Fzc2V0RGVwcmVjYXRlZAAAAAABAAAAEGFzc2V0X2RlcHJlY2F0ZWQAAAAEAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAAAAABFyZWFzb25fY29tbWl0bWVudAAAAAAAA+4AAAAgAAAAAAAAAAAAAAANZXZlbnRfdmVyc2lvbgAAAAAAAAQAAAAAAAAAAg==",
        "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"
      ]),
      options
    )
  }
  public readonly fromJSON = {
    cancel: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<Result<string>>,
        extend_ttl: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<Session>>,
        accept_admin: this.txFromJSON<Result<void>>,
        remove_asset: this.txFromJSON<Result<void>>,
        propose_admin: this.txFromJSON<Result<void>>,
        create_session: this.txFromJSON<Result<Buffer>>,
        pause_creation: this.txFromJSON<Result<void>>,
        deprecate_asset: this.txFromJSON<Result<void>>,
        recover_expired: this.txFromJSON<Result<void>>,
        resume_creation: this.txFromJSON<Result<void>>,
        get_configuration: this.txFromJSON<Result<ContractConfiguration>>,
        interface_version: this.txFromJSON<u32>,
        get_admin_rotation: this.txFromJSON<Option<AdminRotation>>,
        get_session_status: this.txFromJSON<Result<SessionStatusResponse>>,
        reduce_session_cap: this.txFromJSON<Result<void>>,
        get_seller_exposure: this.txFromJSON<Result<i128>>,
        get_escrow_liability: this.txFromJSON<Result<i128>>,
        cancel_admin_rotation: this.txFromJSON<Result<void>>,
        recover_expired_batch: this.txFromJSON<Result<Array<BatchRecoveryResult>>>,
        get_asset_cap_increase: this.txFromJSON<Option<CapIncreaseProposal>>,
        get_buyer_open_sessions: this.txFromJSON<Result<u32>>,
        get_seller_open_sessions: this.txFromJSON<Result<u32>>,
        accept_asset_cap_increase: this.txFromJSON<Result<void>>,
        cancel_asset_cap_increase: this.txFromJSON<Result<void>>,
        propose_asset_cap_increase: this.txFromJSON<Result<void>>,
        get_max_buyer_open_sessions: this.txFromJSON<Option<u32>>,
        get_seller_exposure_ceiling: this.txFromJSON<Result<i128>>,
        set_max_buyer_open_sessions: this.txFromJSON<Result<void>>,
        set_seller_exposure_ceiling: this.txFromJSON<Result<void>>,
        get_asset_max_session_amount: this.txFromJSON<Result<i128>>,
        get_asset_min_session_amount: this.txFromJSON<Result<i128>>,
        get_max_seller_open_sessions: this.txFromJSON<Option<u32>>,
        set_asset_max_session_amount: this.txFromJSON<Result<void>>,
        set_max_seller_open_sessions: this.txFromJSON<Result<void>>,
        get_commitment_domain_metadata: this.txFromJSON<CommitmentDomainMetadata>
  }
}

export * from "./usageReceipt.js";
