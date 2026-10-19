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
  max_session_amount: i128;
}

export type AssetStatus = {tag: "Active", values: void} | {tag: "Deprecated", values: void};


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
  35: {message:"AssetLiabilityOutstanding"}
}












export type DataKey = {tag: "Admin", values: void} | {tag: "AdminRotation", values: void} | {tag: "NextSessionSequence", values: void} | {tag: "Session", values: readonly [Buffer]} | {tag: "StorageLayoutVersion", values: void} | {tag: "SupportedAsset", values: readonly [string]} | {tag: "AssetMaxSessionAmount", values: readonly [string]} | {tag: "SupportedAssets", values: void} | {tag: "OperationalState", values: void} | {tag: "Liability", values: readonly [string]};

export type Executable = {tag: "Wasm", values: readonly [Buffer]} | {tag: "StellarAsset", values: void} | {tag: "Account", values: void};

/**
 * Contract executable used for creating a new contract and used in
 * `CreateContractHostFnContext`.
 */
export type ContractExecutable = {tag: "Wasm", values: readonly [Buffer]} | {tag: "ExternalRef", values: readonly [ContractExecutableRef]};


/**
 * Executable referenced via a persistent storage entry owned by a contract,
 * either this contract or another contract.
 * 
 * The persistent storage entry owned by the `owner` has the `tag` as its key.
 */
export interface ContractExecutableRef {
  owner: string;
  tag: string;
}

/**
 * Context of a single authorized call performed by an address.
 * 
 * Custom account contracts that implement `__check_auth` special function
 * receive a list of `Context` values corresponding to all the calls that
 * need to be authorized.
 */
export type Context = {tag: "Contract", values: readonly [ContractContext]} | {tag: "CreateContractHostFn", values: readonly [CreateContractHostFnContext]} | {tag: "CreateContractWithCtorHostFn", values: readonly [CreateContractWithConstructorHostFnContext]};


/**
 * Authorization context of a single contract call.
 * 
 * This struct corresponds to a `require_auth_for_args` call for an address
 * from `contract` function with `fn_name` name and `args` arguments.
 */
export interface ContractContext {
  args: Array<any>;
  contract: string;
  fn_name: string;
}


/**
 * Value of contract node in InvokerContractAuthEntry tree.
 */
export interface SubContractInvocation {
  context: ContractContext;
  sub_invocations: Array<InvokerContractAuthEntry>;
}

/**
 * A node in the tree of authorizations performed on behalf of the current
 * contract as invoker of the contracts deeper in the call stack.
 * 
 * This is used as an argument of `authorize_as_current_contract` host function.
 * 
 * This tree corresponds `require_auth[_for_args]` calls on behalf of the
 * current contract.
 */
export type InvokerContractAuthEntry = {tag: "Contract", values: readonly [SubContractInvocation]} | {tag: "CreateContractHostFn", values: readonly [CreateContractHostFnContext]} | {tag: "CreateContractWithCtorHostFn", values: readonly [CreateContractWithConstructorHostFnContext]};


/**
 * Authorization context for `create_contract` host function that creates a
 * new contract on behalf of authorizer address.
 */
export interface CreateContractHostFnContext {
  executable: ContractExecutable;
  salt: Buffer;
}


/**
 * Authorization context for `create_contract` host function that creates a
 * new contract on behalf of authorizer address.
 * This is the same as `CreateContractHostFnContext`, but also has
 * contract constructor arguments.
 */
export interface CreateContractWithConstructorHostFnContext {
  constructor_args: Array<any>;
  executable: ContractExecutable;
  salt: Buffer;
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
   * Construct and simulate a get_session_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session_status: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SessionStatusResponse>>>

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
   * Construct and simulate a get_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_asset_max_session_amount: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a set_asset_max_session_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_asset_max_session_amount: ({asset, max_session_amount}: {asset: string, max_session_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2Fzc2V0AAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAIAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAATAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPZGVwcmVjYXRlX2Fzc2V0AAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPcmVjb3Zlcl9leHBpcmVkAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAARZ2V0X2NvbmZpZ3VyYXRpb24AAAAAAAAAAAAAAQAAA+kAAAfQAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAASZ2V0X2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAQAAA+gAAAfQAAAADUFkbWluUm90YXRpb24AAAA=",
        "AAAAAAAAAAAAAAASZ2V0X3Nlc3Npb25fc3RhdHVzAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAABVTZXNzaW9uU3RhdHVzUmVzcG9uc2UAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAUZ2V0X2VzY3Jvd19saWFiaWxpdHkAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3JvdGF0aW9uAAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAVcmVjb3Zlcl9leHBpcmVkX2JhdGNoAAAAAAAAAQAAAAAAAAALc2Vzc2lvbl9pZHMAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAPqAAAH0AAAABNCYXRjaFJlY292ZXJ5UmVzdWx0AAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcZ2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAcc2V0X2Fzc2V0X21heF9zZXNzaW9uX2Ftb3VudAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAeZ2V0X2NvbW1pdG1lbnRfZG9tYWluX21ldGFkYXRhAAAAAAAAAAAAAQAAB9AAAAAYQ29tbWl0bWVudERvbWFpbk1ldGFkYXRh",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAACwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAD2VzY3Jvd2VkX2Ftb3VudAAAAAALAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAAAmlkAAAAAAPuAAAAIAAAAAAAAAAKbWF4X2Ftb3VudAAAAAAACwAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAADnNldHRsZWRfYW1vdW50AAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAAAAAAAAAAAKdXNhZ2VfaGFzaAAAAAAD6AAAA+4AAAAg",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0UG9saWN5AAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAASbWF4X3Nlc3Npb25fYW1vdW50AAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADUFkbWluUm90YXRpb24AAAAAAAACAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAT",
        "AAAAAQAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlSZXN1bHQAAAAAAwAAAAAAAAAPcmVmdW5kZWRfYW1vdW50AAAAAAsAAAAAAAAACnNlc3Npb25faWQAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAATQmF0Y2hSZWNvdmVyeVN0YXR1cwA=",
        "AAAAAQAAAAAAAAAAAAAAFUNvbnRyYWN0Q29uZmlndXJhdGlvbgAAAAAAAAkAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAWaW5zdGFuY2VfdHRsX2V4dGVuc2lvbgAAAAAABAAAAAAAAAAWaW5zdGFuY2VfdHRsX3RocmVzaG9sZAAAAAAABAAAAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAEAAAAAAAAABRtYXhfc3VwcG9ydGVkX2Fzc2V0cwAAAAQAAAAAAAAAEW9wZXJhdGlvbmFsX3N0YXRlAAAAAAAH0AAAABBPcGVyYXRpb25hbFN0YXRlAAAAAAAAABByZXNwb25zZV92ZXJzaW9uAAAABAAAAAAAAAAWc3RvcmFnZV9sYXlvdXRfdmVyc2lvbgAAAAAABAAAAAAAAAAQc3VwcG9ydGVkX2Fzc2V0cwAAA+oAAAAT",
        "AAAAAQAAAAAAAAAAAAAAFVNlc3Npb25TdGF0dXNSZXNwb25zZQAAAAAAAAMAAAAAAAAABmV4aXN0cwAAAAAAAQAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANU2Vzc2lvblN0YXR1cwAAAA==",
        "AAAAAQAAAAAAAAAAAAAAGENvbW1pdG1lbnREb21haW5NZXRhZGF0YQAAAAUAAAAAAAAAEWludGVyZmFjZV92ZXJzaW9uAAAAAAAABAAAAAAAAAAWcmVjZWlwdF9zY2hlbWFfdmVyc2lvbgAAAAAABAAAAAAAAAAQcmVzcG9uc2VfdmVyc2lvbgAAAAQAAAAAAAAAEXNlc3Npb25faWRfZG9tYWluAAAAAAAD7gAAACAAAAAAAAAAF3VzYWdlX2NvbW1pdG1lbnRfZG9tYWluAAAAA+4AAAAg",
        "AAAAAQAAADhWYWx1ZSBvZiBjb250cmFjdCBub2RlIGluIEludm9rZXJDb250cmFjdEF1dGhFbnRyeSB0cmVlLgAAAAAAAAAVU3ViQ29udHJhY3RJbnZvY2F0aW9uAAAAAAAAAgAAAAAAAAAHY29udGV4dAAAAAfQAAAAD0NvbnRyYWN0Q29udGV4dAAAAAAAAAAAD3N1Yl9pbnZvY2F0aW9ucwAAAAPqAAAH0AAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnk=",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAQAAAMBFeGVjdXRhYmxlIHJlZmVyZW5jZWQgdmlhIGEgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IGEgY29udHJhY3QsCmVpdGhlciB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuCgpUaGUgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IHRoZSBgb3duZXJgIGhhcyB0aGUgYHRhZ2AgYXMgaXRzIGtleS4AAAAAAAAAFUNvbnRyYWN0RXhlY3V0YWJsZVJlZgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAADdGFnAAAAABA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAANQWRtaW5Sb3RhdGlvbgAAAAAAAAAAAAAAAAAAE05leHRTZXNzaW9uU2VxdWVuY2UAAAAAAQAAAAAAAAAHU2Vzc2lvbgAAAAABAAAD7gAAACAAAAAAAAAAAAAAABRTdG9yYWdlTGF5b3V0VmVyc2lvbgAAAAEAAAAAAAAADlN1cHBvcnRlZEFzc2V0AAAAAAABAAAAEwAAAAEAAAAAAAAAFUFzc2V0TWF4U2Vzc2lvbkFtb3VudAAAAAAAAAEAAAATAAAAAAAAAAAAAAAPU3VwcG9ydGVkQXNzZXRzAAAAAAAAAAAAAAAAEE9wZXJhdGlvbmFsU3RhdGUAAAABAAAAAAAAAAlMaWFiaWxpdHkAAAAAAAABAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAC0Fzc2V0U3RhdHVzAAAAAAIAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAAAgAAAAAAAAAAAAAACkV4ZWN1dGFibGUAAAAAAAMAAAABAAAAAAAAAARXYXNtAAAAAQAAA+4AAAAgAAAAAAAAAAAAAAAMU3RlbGxhckFzc2V0AAAAAAAAAAAAAAAHQWNjb3VudAA=",
        "AAAAAgAAAAAAAAAAAAAADVNlc3Npb25TdGF0dXMAAAAAAAAEAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAAAAAAAHRXhwaXJlZAA=",
        "AAAAAgAAAAAAAAAAAAAAE0JhdGNoUmVjb3ZlcnlTdGF0dXMAAAAACAAAAAAAAAAAAAAACVJlY292ZXJlZAAAAAAAAAAAAAAAAAAACE5vdEZvdW5kAAAAAAAAAAAAAAAKTm90RXhwaXJlZAAAAAAAAAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAAAAAAAAAAAEEFscmVhZHlDYW5jZWxsZWQAAAAAAAAAAAAAABBBbHJlYWR5UmVjb3ZlcmVkAAAAAAAAAAAAAAAJRHVwbGljYXRlAAAAAAAAAAAAAAAAAAARRXNjcm93VW5hdmFpbGFibGUAAAA=",
        "AAAAAgAAAAAAAAAAAAAAEE9wZXJhdGlvbmFsU3RhdGUAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZQYXVzZWQAAAAAAAAAAAAAAAAACkRlcHJlY2F0ZWQAAA==",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAgAAAAEAAAB4RXhlY3V0YWJsZSBzcGVjaWZpZWQgYnkgdGhlIGNvbnRyYWN0IGluc3RhbmNlIGFzIGEgc3BlY2lmaWMgV2FzbSBjb250cmFjdCBjb2RlIGVudHJ5IGlkZW50aWZpZWQgYnkgaXRzIFdhc20gc2hhMjU2IGhhc2guAAAABFdhc20AAAABAAAD7gAAACAAAAABAAAAX0V4ZWN1dGFibGUgcmVmZXJlbmNlIHZpYSBhIHBlcnNpc3RlbnQgc3RvcmFnZSBlbnRyeSBvd25lZCBieSB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuAAAAAAtFeHRlcm5hbFJlZgAAAAABAAAH0AAAABVDb250cmFjdEV4ZWN1dGFibGVSZWYAAAA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAgAAAS9BIG5vZGUgaW4gdGhlIHRyZWUgb2YgYXV0aG9yaXphdGlvbnMgcGVyZm9ybWVkIG9uIGJlaGFsZiBvZiB0aGUgY3VycmVudApjb250cmFjdCBhcyBpbnZva2VyIG9mIHRoZSBjb250cmFjdHMgZGVlcGVyIGluIHRoZSBjYWxsIHN0YWNrLgoKVGhpcyBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IG9mIGBhdXRob3JpemVfYXNfY3VycmVudF9jb250cmFjdGAgaG9zdCBmdW5jdGlvbi4KClRoaXMgdHJlZSBjb3JyZXNwb25kcyBgcmVxdWlyZV9hdXRoW19mb3JfYXJnc11gIGNhbGxzIG9uIGJlaGFsZiBvZiB0aGUKY3VycmVudCBjb250cmFjdC4AAAAAAAAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnkAAAADAAAAAQAAABJJbnZva2UgYSBjb250cmFjdC4AAAAAAAhDb250cmFjdAAAAAEAAAfQAAAAFVN1YkNvbnRyYWN0SW52b2NhdGlvbgAAAAAAAAEAAAA1Q3JlYXRlIGEgY29udHJhY3QgcGFzc2luZyAwIGFyZ3VtZW50cyB0byBjb25zdHJ1Y3Rvci4AAAAAAAAUQ3JlYXRlQ29udHJhY3RIb3N0Rm4AAAABAAAH0AAAABtDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHQAAAAAAQAAAD1DcmVhdGUgYSBjb250cmFjdCBwYXNzaW5nIDAgb3IgbW9yZSBhcmd1bWVudHMgdG8gY29uc3RydWN0b3IuAAAAAAAAHENyZWF0ZUNvbnRyYWN0V2l0aEN0b3JIb3N0Rm4AAAABAAAH0AAAACpDcmVhdGVDb250cmFjdFdpdGhDb25zdHJ1Y3Rvckhvc3RGbkNvbnRleHQAAA==",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAAjAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAAA5FeHBpcmVkU2Vzc2lvbgAAAAAABAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAUAAAAAAAAAFVNlc3Npb25BbHJlYWR5U2V0dGxlZAAAAAAAAAYAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAAHAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAACAAAAAAAAAAMSW52YWxpZEFzc2V0AAAACQAAAAAAAAANSW52YWxpZFNlbGxlcgAAAAAAAAoAAAAAAAAAElR0bEV4dGVuc2lvbkZhaWxlZAAAAAAACwAAAAAAAAATSW52YWxpZFJlc291cmNlSGFzaAAAAAAMAAAAAAAAABBJbnZhbGlkVXNhZ2VIYXNoAAAADQAAAAAAAAAQVW5zdXBwb3J0ZWRBc3NldAAAAA4AAAAAAAAAFkludmFsaWRTdXBwb3J0ZWRBc3NldHMAAAAAAA8AAAAAAAAAFlNlc3Npb25EdXJhdGlvblRvb0xvbmcAAAAAABAAAAAAAAAAEUxpYWJpbGl0eU92ZXJmbG93AAAAAAAAEQAAAAAAAAASTGlhYmlsaXR5VW5kZXJmbG93AAAAAAASAAAAAAAAABFFc2Nyb3dVbmRlcmZ1bmRlZAAAAAAAABMAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAUAAAAAAAAAA5TZXNzaW9uRXhwaXJlZAAAAAAAFQAAAAAAAAARU2Vzc2lvbk5vdEV4cGlyZWQAAAAAAAAWAAAAAAAAAA9JbnZhbGlkQXNzZXRDYXAAAAAAFwAAAAAAAAAVQXNzZXRDYXBOb3RDb25maWd1cmVkAAAAAAAAGAAAAAAAAAAMSW52YWxpZEFkbWluAAAAGQAAAAAAAAAaSW52YWxpZEFkbWluUm90YXRpb25FeHBpcnkAAAAAABoAAAAAAAAAFEFkbWluUm90YXRpb25QZW5kaW5nAAAAGwAAAAAAAAAVQWRtaW5Sb3RhdGlvbk5vdEZvdW5kAAAAAAAAHAAAAAAAAAAUQWRtaW5Sb3RhdGlvbkV4cGlyZWQAAAAdAAAAAAAAABdUb2tlbkludmFyaWFudFZpb2xhdGlvbgAAAAAeAAAAAAAAABBJbnZhbGlkQmF0Y2hTaXplAAAAHwAAAAAAAAAVSW52YWxpZEFzc2V0SW50ZXJmYWNlAAAAAAAAIAAAAAAAAAAOQXNzZXROb3RBY3RpdmUAAAAAACEAAAAAAAAAEkFzc2V0Tm90RGVwcmVjYXRlZAAAAAAAIgAAAAAAAAAZQXNzZXRMaWFiaWxpdHlPdXRzdGFuZGluZwAAAAAAACM=",
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
        get_session_status: this.txFromJSON<Result<SessionStatusResponse>>,
        get_escrow_liability: this.txFromJSON<Result<i128>>,
        cancel_admin_rotation: this.txFromJSON<Result<void>>,
        recover_expired_batch: this.txFromJSON<Result<Array<BatchRecoveryResult>>>,
        get_asset_max_session_amount: this.txFromJSON<Result<i128>>,
        set_asset_max_session_amount: this.txFromJSON<Result<void>>,
        get_commitment_domain_metadata: this.txFromJSON<CommitmentDomainMetadata>
  }
}

export * from "./usageReceipt.js";
