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
  expires_at_ledger: u32;
  id: Buffer;
  max_amount: i128;
  resource_hash: Buffer;
  seller: string;
  settled_amount: i128;
  status: SessionStatus;
  usage_hash: Option<Buffer>;
}

export type SessionStatus = {tag: "Open", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};

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
  13: {message:"InvalidUsageHash"}
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
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session: ({session_id}: {session_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Session>>>

  /**
   * Construct and simulate a create_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_session: ({buyer, seller, asset, max_amount, expires_at_ledger, resource_hash}: {buyer: string, seller: string, asset: string, max_amount: i128, expires_at_ledger: u32, resource_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAGY2FuY2VsAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAGc2V0dGxlAAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAAAAAANYWN0dWFsX2Ftb3VudAAAAAAAAAsAAAAAAAAACnVzYWdlX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAACgAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAACaWQAAAAAA+4AAAAgAAAAAAAAAAptYXhfYW1vdW50AAAAAAALAAAAAAAAAA1yZXNvdXJjZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAOc2V0dGxlZF9hbW91bnQAAAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA1TZXNzaW9uU3RhdHVzAAAAAAAAAAAAAAp1c2FnZV9oYXNoAAAAAAPoAAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAADVNlc3Npb25TdGF0dXMAAAAAAAADAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAANAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAAA5FeHBpcmVkU2Vzc2lvbgAAAAAABAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAUAAAAAAAAAFVNlc3Npb25BbHJlYWR5U2V0dGxlZAAAAAAAAAYAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAAHAAAAAAAAABBBbW91bnRFeGNlZWRzQ2FwAAAACAAAAAAAAAAMSW52YWxpZEFzc2V0AAAACQAAAAAAAAANSW52YWxpZFNlbGxlcgAAAAAAAAoAAAAAAAAAElR0bEV4dGVuc2lvbkZhaWxlZAAAAAAACwAAAAAAAAATSW52YWxpZFJlc291cmNlSGFzaAAAAAAMAAAAAAAAABBJbnZhbGlkVXNhZ2VIYXNoAAAADQ==",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAHU2Vzc2lvbgAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAANcmVzb3VyY2VfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAABQAAAAAAAAAAAAAADlNlc3Npb25DcmVhdGVkAAAAAAABAAAAD3Nlc3Npb25fY3JlYXRlZAAAAAAHAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAAAAAAABFleHBpcmVzX2F0X2xlZGdlcgAAAAAAAAQAAAAAAAAAAAAAAA1yZXNvdXJjZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADlNlc3Npb25TZXR0bGVkAAAAAAABAAAAD3Nlc3Npb25fc2V0dGxlZAAAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAPuAAAAIAAAAAEAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAADWFjdHVhbF9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAAKdXNhZ2VfaGFzaAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEFNlc3Npb25DYW5jZWxsZWQAAAABAAAAEXNlc3Npb25fY2FuY2VsbGVkAAAAAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAD7gAAACAAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAAg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    cancel: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<void>>,
        extend_ttl: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<Session>>,
        create_session: this.txFromJSON<Result<Buffer>>
  }
}