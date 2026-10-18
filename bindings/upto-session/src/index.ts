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
  escrowed_amount: i128;
  expires_at_ledger: u32;
  id: Buffer;
  max_amount: i128;
  resource_hash: Buffer;
  seller: string;
  settled_amount: i128;
  status: SessionStatus;
  usage_hash: Option<Buffer>;
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
}

export type AssetStatus = {tag: "Active", values: void} | {tag: "Deprecated", values: void};


export interface AdminRotation {
  expires_at_ledger: u32;
  pending_admin: string;
}

export type SessionStatus = {tag: "Open", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void} | {tag: "Expired", values: void};

export type SolvencyStatus = {tag: "Collateralized", values: void} | {tag: "Surplus", values: void} | {tag: "Underfunded", values: void} | {tag: "BalanceUnavailable", values: void};

export type OperationalState = {tag: "Active", values: void} | {tag: "Paused", values: void} | {tag: "Deprecated", values: void};


export interface BatchRecoveryResult {
  refunded_amount: i128;
  session_id: Buffer;
  status: BatchRecoveryStatus;
}

export type BatchRecoveryStatus = {tag: "Recovered", values: void} | {tag: "NotFound", values: void} | {tag: "NotExpired", values: void} | {tag: "AlreadySettled", values: void} | {tag: "AlreadyCancelled", values: void} | {tag: "AlreadyRecovered", values: void} | {tag: "Duplicate", values: void} | {tag: "EscrowUnavailable", values: void};


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
  max_supported_assets: u32;
  operational_state: OperationalState;
  response_version: u32;
  storage_layout_version: u32;
  supported_assets: Array<string>;
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
  36: {message:"AssetExposureCeilingExceeded"},
  37: {message:"InvalidExposureCeiling"},
  38: {message:"ExposureCeilingNotConfigured"},
  39: {message:"BuyerExposureCeilingExceeded"},
  40: {message:"BuyerExposureUnderflow"}
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
  remove_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_admin: ({pending_admin, expires_at_ledger}: {pending_admin: string, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_session: ({buyer, seller, asset, max_amount, expires_at_ledger, resource_hash}: {buyer: string, seller: string, asset: string, max_amount: i128, expires_at_ledger: u32, resource_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a deprecate_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deprecate_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recover_expired transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recover_expired: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Construct and simulate a get_asset_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_exposure_ceiling: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_buyer_exposure_ceiling transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_buyer_exposure_ceiling: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

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
   * Construct and simulate a get_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_max_session_amount: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a set_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_asset_max_session_amount: ({asset, max_session_amount}: {asset: string, max_session_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2Fzc2V0AAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAIAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAATAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPZGVwcmVjYXRlX2Fzc2V0AAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPcmVjb3Zlcl9leHBpcmVkAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAARZ2V0X2NvbmZpZ3VyYXRpb24AAAAAAAAAAAAAAQAAA+kAAAfQAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAASZ2V0X2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAQAAA+gAAAfQAAAADUFkbWluUm90YXRpb24AAAA=",
        "AAAAAAAAAAAAAAAUZ2V0X2VzY3Jvd19saWFiaWxpdHkAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAVcmVjb3Zlcl9leHBpcmVkX2JhdGNoAAAAAAAAAQAAAAAAAAALc2Vzc2lvbl9pZHMAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAPqAAAH0AAAABNCYXRjaFJlY292ZXJ5UmVzdWx0AAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAaZ2V0X2Fzc2V0X2V4cG9zdXJlX2NlaWxpbmcAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAaZ2V0X2J1eWVyX2V4cG9zdXJlX2NlaWxpbmcAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcc2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAADJPcGVuIGVzY3JvdyBjdXJyZW50bHkgaGVsZCBieSBgYnV5ZXJgIGZvciBgYXNzZXRgLgAAAAAAEmdldF9idXllcl9leHBvc3VyZQAAAAAAAgAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAHVSZWFkLW9ubHksIGF1dGhvcml6YXRpb24tZnJlZSBzb2x2ZW5jeSB2aWV3IGZvciBhbiBhY3RpdmUgb3IKZGVwcmVjYXRlZCBhc3NldC4gSXQgbmV2ZXIgd3JpdGVzIHN0YXRlIG9yIGV4dGVuZHMgVFRMcy4AAAAAAAASZ2V0X2Fzc2V0X3NvbHZlbmN5AAAAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAB9AAAAAVQXNzZXRTb2x2ZW5jeVNuYXBzaG90AAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAHlBZG1pbi1vbmx5OiBzZXRzIHRoZSBjZWlsaW5nIG9uIG9wZW4gZXNjcm93IGFueSBzaW5nbGUgYnV5ZXIgbWF5IGhvbGQKZm9yIGBhc3NldGAuIEVhY2ggYnV5ZXIgaGFzIGFuIGluZGVwZW5kZW50IGNvdW50ZXIuAAAAAAAAGnNldF9idXllcl9leHBvc3VyZV9jZWlsaW5nAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2NlaWxpbmcAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAM1BZG1pbi1vbmx5OiBzZXRzIHRoZSBjZWlsaW5nIG9uIGFnZ3JlZ2F0ZSBvcGVuIGVzY3JvdyBmb3IgYGFzc2V0YC4KTG93ZXJpbmcgaXQgYmVsb3cgdGhlIGN1cnJlbnQgbGlhYmlsaXR5IGlzIGFsbG93ZWQ7IGV4aXN0aW5nIHNlc3Npb25zCmFyZSB1bmFmZmVjdGVkIGFuZCBuZXcgc2Vzc2lvbnMgYXJlIHJlamVjdGVkIHVudGlsIGNhcGFjaXR5IHJldHVybnMuAAAAAAAAGnNldF9hc3NldF9leHBvc3VyZV9jZWlsaW5nAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2NlaWxpbmcAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAACwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAD2VzY3Jvd2VkX2Ftb3VudAAAAAALAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAAAmlkAAAAAAPuAAAAIAAAAAAAAAAKbWF4X2Ftb3VudAAAAAAACwAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAADnNldHRsZWRfYW1vdW50AAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAAAAAAAAAAAKdXNhZ2VfaGFzaAAAAAAD6AAAA+4AAAAg",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0UG9saWN5AAAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAEVDZWlsaW5nIG9uIHRoZSBzdW0gb2Ygb3BlbiBlc2Nyb3cgZm9yIHRoaXMgYXNzZXQgYWNyb3NzIGFsbCBzZXNzaW9ucy4AAAAAAAASbWF4X2Fzc2V0X2V4cG9zdXJlAAAAAAALAAAAR0NlaWxpbmcgb24gdGhlIHN1bSBvZiBvcGVuIGVzY3JvdyBmb3IgdGhpcyBhc3NldCBoZWxkIGJ5IGFueSBvbmUgYnV5ZXIuAAAAABJtYXhfYnV5ZXJfZXhwb3N1cmUAAAAAAAsAAAAAAAAAEm1heF9zZXNzaW9uX2Ftb3VudAAAAAAACw==",
        "AAAAAQAAAAAAAAAAAAAADUFkbWluUm90YXRpb24AAAAAAAACAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAT",
        "AAAAAQAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlSZXN1bHQAAAAAAwAAAAAAAAAPcmVmdW5kZWRfYW1vdW50AAAAAAsAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAATQmF0Y2hSZWNvdmVyeVN0YXR1cwA=",
        "AAAAAQAAAAAAAAAAAAAAFUFzc2V0U29sdmVuY3lTbmFwc2hvdAAAAAAAAAgAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAMYXNzZXRfc3RhdHVzAAAH0AAAAAtBc3NldFN0YXR1cwAAAAA5YGxpYWJpbGl0eSAtIHRva2VuX2JhbGFuY2VgIHdoZW4gcG9zaXRpdmUsIG90aGVyd2lzZSBgMGAuAAAAAAAAB2RlZmljaXQAAAAACwAAAAAAAAAJbGlhYmlsaXR5AAAAAAAACwAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA5Tb2x2ZW5jeVN0YXR1cwAAAAAAOWB0b2tlbl9iYWxhbmNlIC0gbGlhYmlsaXR5YCB3aGVuIHBvc2l0aXZlLCBvdGhlcndpc2UgYDBgLgAAAAAAAAdzdXJwbHVzAAAAAAsAAABYQmFsYW5jZSByZXBvcnRlZCBieSB0aGUgdG9rZW4gZm9yIHRoaXMgY29udHJhY3QsIG9yIGBOb25lYCB3aGVuIHRoZQpiYWxhbmNlIGNhbGwgZmFpbGVkLgAAAA10b2tlbl9iYWxhbmNlAAAAAAAD6AAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAAAkAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAWaW5zdGFuY2VfdHRsX2V4dGVuc2lvbgAAAAAABAAAAAAAAAAWaW5zdGFuY2VfdHRsX3RocmVzaG9sZAAAAAAABAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAEAAAAAAAAABRtYXhfc3VwcG9ydGVkX2Fzc2V0cwAAAAQAAAAAAAAAEW9wZXJhdGlvbmFsX3N0YXRlAAAAAAAH0AAAABBPcGVyYXRpb25hbFN0YXRlAAAAAAAAABByZXNwb25zZV92ZXJzaW9uAAAABAAAAAAAAAAWc3RvcmFnZV9sYXlvdXRfdmVyc2lvbgAAAAAABAAAAAAAAAAQc3VwcG9ydGVkX2Fzc2V0cwAAA+oAAAAT",
        "AAAAAgAAAAAAAAAAAAAAC0Fzc2V0U3RhdHVzAAAAAAIAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAAAgAAAAAAAAAAAAAADVNlc3Npb25TdGF0dXMAAAAAAAAEAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAAAAAAAHRXhwaXJlZAA=",
        "AAAAAgAAAAAAAAAAAAAADlNvbHZlbmN5U3RhdHVzAAAAAAAEAAAAAAAAACdUb2tlbiBiYWxhbmNlIGVxdWFscyB0cmFja2VkIGxpYWJpbGl0eS4AAAAADkNvbGxhdGVyYWxpemVkAAAAAAAAAAAAP1Rva2VuIGJhbGFuY2UgZXhjZWVkcyB0cmFja2VkIGxpYWJpbGl0eTsgYHN1cnBsdXNgIGlzIHBvc2l0aXZlLgAAAAAHU3VycGx1cwAAAAAAAAAAQFRva2VuIGJhbGFuY2UgaXMgYmVsb3cgdHJhY2tlZCBsaWFiaWxpdHk7IGBkZWZpY2l0YCBpcyBwb3NpdGl2ZS4AAAALVW5kZXJmdW5kZWQAAAAAAAAAAFpUaGUgdG9rZW4gYmFsYW5jZSBjYWxsIGZhaWxlZCBvciByZXR1cm5lZCBhIHZhbHVlIHRoYXQgY2Fubm90IGJlIGEKYmFsYW5jZS4gTmV2ZXIgaGVhbHRoeS4AAAAAABJCYWxhbmNlVW5hdmFpbGFibGUAAA==",
        "AAAAAgAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlTdGF0dXMAAAAACAAAAAAAAAAAAAAACVJlY292ZXJlZAAAAAAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAKTm90RXhwaXJlZAAAAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAABBBbHJlYWR5UmVjb3ZlcmVkAAAAAAAAAAAAAAAJRHVwbGljYXRlAAAAAAAAAAAAAAAAAAARRXNjcm93VW5hdmFpbGFibGUAAAA=",
        "AAAAAgAAAAAAAAAAAAAAEE9wZXJhdGlvbmFsU3RhdGUAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZQYXVzZWQAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAAoAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAAA5FeHBpcmVkU2Vzc2lvbgAAAAAABAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAUAAAAAAAAAFVNlc3Npb25BbHJlYWR5U2V0dGxlZAAAAAAAAAYAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAAHAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAACAAAAAAAAAAMSW52YWxpZEFzc2V0AAAACQAAAAAAAAANSW52YWxpZFNlbGxlcgAAAAAAAAoAAAAAAAAAElR0bEV4dGVuc2lvbkZhaWxlZAAAAAAACwAAAAAAAAATSW52YWxpZFJlc291cmNlSGFzaAAAAAAMAAAAAAAAABBJbnZhbGlkVXNhZ2VIYXNoAAAADQAAAAAAAAAQVW5zdXBwb3J0ZWRBc3NldAAAAA4AAAAAAAAAFkludmFsaWRTdXBwb3J0ZWRBc3NldHMAAAAAAA8AAAAAAAAAFlNlc3Npb25EdXJhdGlvblRvb0xvbmcAAAAAABAAAAAAAAAAEUxpYWJpbGl0eU92ZXJmbG93AAAAAAAAEQAAAAAAAAASTGlhYmlsaXR5VW5kZXJmbG93AAAAAAASAAAAAAAAABFFc2Nyb3dVbmRlcmZ1bmRlZAAAAAAAABMAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAUAAAAAAAAAA5TZXNzaW9uRXhwaXJlZAAAAAAAFQAAAAAAAAARU2Vzc2lvbk5vdEV4cGlyZWQAAAAAAAAWAAAAAAAAAA9JbnZhbGlkQXNzZXRDYXAAAAAAFwAAAAAAAAAVQXNzZXRDYXBOb3RDb25maWd1cmVkAAAAAAAAGAAAAAAAAAAMSW52YWxpZEFkbWluAAAAGQAAAAAAAAAaSW52YWxpZEFkbWluUm90YXRpb25FeHBpcnkAAAAAABoAAAAAAAAAFEFkbWluUm90YXRpb25QZW5kaW5nAAAAGwAAAAAAAAAVQWRtaW5Sb3RhdGlvbk5vdEZvdW5kAAAAAAAAHAAAAAAAAAAUQWRtaW5Sb3RhdGlvbkV4cGlyZWQAAAAdAAAAAAAAABdUb2tlbkludmFyaWFudFZpb2xhdGlvbgAAAAAeAAAAAAAAABBJbnZhbGlkQmF0Y2hTaXplAAAAHwAAAAAAAAAVSW52YWxpZEFzc2V0SW50ZXJmYWNlAAAAAAAAIAAAAAAAAAAOQXNzZXROb3RBY3RpdmUAAAAAACEAAAAAAAAAEkFzc2V0Tm90RGVwcmVjYXRlZAAAAAAAIgAAAAAAAAAZQXNzZXRMaWFiaWxpdHlPdXRzdGFuZGluZwAAAAAAACMAAAAAAAAAHEFzc2V0RXhwb3N1cmVDZWlsaW5nRXhjZWVkZWQAAAAkAAAAAAAAABZJbnZhbGlkRXhwb3N1cmVDZWlsaW5nAAAAAAAlAAAAAAAAABxFeHBvc3VyZUNlaWxpbmdOb3RDb25maWd1cmVkAAAAJgAAAAAAAAAcQnV5ZXJFeHBvc3VyZUNlaWxpbmdFeGNlZWRlZAAAACcAAAAAAAAAFkJ1eWVyRXhwb3N1cmVVbmRlcmZsb3cAAAAAACg=",
        "AAAABQAAAAAAAAAAAAAAD0Fzc2V0RGVwcmVjYXRlZAAAAAABAAAAEGFzc2V0X2RlcHJlY2F0ZWQAAAADAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAAAAAA1ldmVudF92ZXJzaW9uAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADEFzc2V0UmVtb3ZlZAAAAAEAAAANYXNzZXRfcmVtb3ZlZAAAAAAAAAMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAAAAAADWV2ZW50X3ZlcnNpb24AAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkFzc2V0QWN0aXZhdGVkAAAAAAABAAAAD2Fzc2V0X2FjdGl2YXRlZAAAAAADAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAhkZWNpbWFscwAAAAQAAAAAAAAAAAAAAA1ldmVudF92ZXJzaW9uAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlNlc3Npb25DcmVhdGVkAAAAAAABAAAAD3Nlc3Npb25fY3JlYXRlZAAAAAAJAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAAAAAAAA1yZXNvdXJjZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAAAAAA1ldmVudF92ZXJzaW9uAAAAAAAABAAAAAAAAAAAAAAAD2VzY3Jvd2VkX2Ftb3VudAAAAAALAAAAAAAAAAI=",
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
        deprecate_asset: this.txFromJSON<Result<void>>,
        recover_expired: this.txFromJSON<Result<void>>,
        get_configuration: this.txFromJSON<Result<ContractConfiguration>>,
        interface_version: this.txFromJSON<u32>,
        get_admin_rotation: this.txFromJSON<Option<AdminRotation>>,
        get_asset_solvency: this.txFromJSON<Result<AssetSolvencySnapshot>>,
        get_buyer_exposure: this.txFromJSON<Result<i128>>,
        get_escrow_liability: this.txFromJSON<Result<i128>>,
        cancel_admin_rotation: this.txFromJSON<Result<void>>,
        recover_expired_batch: this.txFromJSON<Result<Array<BatchRecoveryResult>>>,
        get_asset_exposure_ceiling: this.txFromJSON<Result<i128>>,
        get_buyer_exposure_ceiling: this.txFromJSON<Result<i128>>,
        set_asset_exposure_ceiling: this.txFromJSON<Result<void>>,
        set_buyer_exposure_ceiling: this.txFromJSON<Result<void>>,
        get_asset_max_session_amount: this.txFromJSON<Result<i128>>,
        set_asset_max_session_amount: this.txFromJSON<Result<void>>
  }
}

export * from "./usageReceipt.js";
