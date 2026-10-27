// Hand-written helpers copied into the generated binding by
// scripts/generate-bindings.mjs. Edit this template, not the copy in
// bindings/upto-session/src.
//
// The helpers wrap generated client calls with an explicit send, bounded
// confirmation and typed result extraction. They never see secret material:
// signing is delegated to an injected signer owned by the caller.
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { FeeBumpTransaction, Transaction, rpc, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import type { Client } from "./index.js";

export type EvidenceNetwork = "testnet" | "standalone";

/**
 * Networks the helpers accept. Pubnet is intentionally absent: LumenBazaar
 * publishes testnet deployments only, and LBT is a test token, not USDC.
 */
export const SUPPORTED_EVIDENCE_NETWORKS: Readonly<Record<EvidenceNetwork, string>> = Object.freeze({
  testnet: Networks.TESTNET,
  standalone: Networks.STANDALONE,
});

export const DEFAULT_EVIDENCE_TIMEOUT_MS = 60_000;
export const MAX_EVIDENCE_TIMEOUT_MS = 600_000;
export const DEFAULT_EVIDENCE_POLL_INTERVAL_MS = 1_000;
export const MIN_EVIDENCE_POLL_INTERVAL_MS = 100;
export const MAX_EVIDENCE_POLL_INTERVAL_MS = 30_000;

const TRANSACTION_HASH = /^[0-9a-f]{64}$/;

/**
 * Signs a transaction envelope. Wallet, HSM or KMS signers fit this shape (it
 * matches the SDK's `SignTransaction`). The helpers pass the unsigned envelope
 * and the network passphrase, and only ever receive the signed envelope back.
 */
export interface EvidenceSigner {
  signTransaction(
    transactionXdr: string,
    options: { networkPassphrase: string },
  ): Promise<{ signedTxXdr: string; error?: unknown }>;
}

/** The subset of `rpc.Server` the helpers call. */
export interface EvidenceRpc {
  sendTransaction(transaction: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export interface EvidenceOptions {
  /** Must be the testnet or standalone passphrase; anything else is rejected. */
  networkPassphrase: string;
  rpc: EvidenceRpc;
  signer: EvidenceSigner;
  /** Total confirmation budget. Default 60 s, at most 600 s. */
  timeoutMs?: number;
  /** Delay between `getTransaction` polls. Default 1 s, between 100 ms and 30 s. */
  pollIntervalMs?: number;
  /** Injectable clock and sleep for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type EvidenceMethod = "create_session" | "settle" | "cancel" | "extend_ttl";

/** The transaction was included in a ledger and succeeded. All fields come from RPC. */
export interface ConfirmedEvidence<T> {
  status: "confirmed";
  method: EvidenceMethod;
  network: EvidenceNetwork;
  transactionHash: string;
  ledger: number;
  /** Ledger close time reported by RPC, in Unix seconds. */
  createdAt: number;
  result: T;
}

/**
 * The transaction did not succeed. `stage: "submission"` means RPC rejected it
 * before inclusion (no ledger); `stage: "ledger"` means it was included and failed.
 */
export interface FailedEvidence {
  status: "failed";
  method: EvidenceMethod;
  network: EvidenceNetwork;
  transactionHash: string;
  stage: "submission" | "ledger";
  ledger?: number;
  createdAt?: number;
  /** Base64 `TransactionResult` XDR when RPC returned one. */
  resultXdr?: string;
  /** `TransactionResult` result code name, for example `txFailed`. */
  resultCode?: string;
}

/**
 * The transaction was accepted for submission but not observed in a ledger
 * within the confirmation budget. The outcome is unknown: resume polling with
 * `transactionHash` before deciding anything, and never resubmit blindly.
 */
export interface PendingEvidence {
  status: "pending";
  method: EvidenceMethod;
  network: EvidenceNetwork;
  transactionHash: string;
  attempts: number;
  elapsedMs: number;
  latestLedger?: number;
}

export type TransactionEvidence<T> = ConfirmedEvidence<T> | FailedEvidence | PendingEvidence;

export type EvidenceErrorCode =
  | "unsupported_network"
  | "invalid_configuration"
  | "not_a_write"
  | "not_simulated"
  | "additional_signers_required"
  | "signer_rejected"
  | "signer_modified_transaction"
  | "rpc_error"
  | "malformed_rpc_response";

/**
 * Raised for configuration problems, signer refusals and RPC/transport
 * problems. On-chain failure is never an exception; it is `FailedEvidence`.
 */
export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;
  /** RPC-reported hash, when the transaction is known to have been submitted. */
  readonly transactionHash?: string;
  /**
   * Hash computed locally from the signed envelope when RPC did not answer.
   * It is not evidence of submission; use it only to query RPC.
   */
  readonly expectedTransactionHash?: string;
  readonly retryable: boolean;

  constructor(
    code: EvidenceErrorCode,
    message: string,
    details: { transactionHash?: string; expectedTransactionHash?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
    this.transactionHash = details.transactionHash;
    this.expectedTransactionHash = details.expectedTransactionHash;
    this.retryable = details.retryable ?? false;
  }
}

/** The parts of a generated `AssembledTransaction` the helpers use. */
export interface AssembledLike<T> {
  built?: Transaction;
  readonly isReadCall: boolean;
  needsNonInvokerSigningBy(): string[];
  options: {
    networkPassphrase: string;
    parseResultXdr: (result: any) => T;
  };
}

type ResultOf<M extends EvidenceMethod> = Awaited<ReturnType<Client[M]>> extends AssembledLike<infer R> ? R : never;
type ArgsOf<M extends EvidenceMethod> = Parameters<Client[M]>[0];

/** Calls `create_session` and returns typed evidence; `result` is the session ID result. */
export function createSessionWithEvidence(
  client: Pick<Client, "create_session">,
  args: ArgsOf<"create_session">,
  options: EvidenceOptions,
): Promise<TransactionEvidence<ResultOf<"create_session">>> {
  return submitWithEvidence("create_session", () => client.create_session(args), options);
}

export function settleWithEvidence(
  client: Pick<Client, "settle">,
  args: ArgsOf<"settle">,
  options: EvidenceOptions,
): Promise<TransactionEvidence<ResultOf<"settle">>> {
  return submitWithEvidence("settle", () => client.settle(args), options);
}

export function cancelWithEvidence(
  client: Pick<Client, "cancel">,
  args: ArgsOf<"cancel">,
  options: EvidenceOptions,
): Promise<TransactionEvidence<ResultOf<"cancel">>> {
  return submitWithEvidence("cancel", () => client.cancel(args), options);
}

/** Extends the session's storage TTL (`extend_ttl`). */
export function extendTtlWithEvidence(
  client: Pick<Client, "extend_ttl">,
  args: ArgsOf<"extend_ttl">,
  options: EvidenceOptions,
): Promise<TransactionEvidence<ResultOf<"extend_ttl">>> {
  return submitWithEvidence("extend_ttl", () => client.extend_ttl(args), options);
}

/**
 * Builds and simulates through the generated client, hands the envelope to the
 * injected signer, submits it, polls RPC within a bounded budget and extracts
 * the typed result with the generated decoder.
 */
export async function submitWithEvidence<T>(
  method: EvidenceMethod,
  assemble: () => Promise<AssembledLike<T>>,
  options: EvidenceOptions,
): Promise<TransactionEvidence<T>> {
  const network = resolveEvidenceNetwork(options?.networkPassphrase);
  const { timeoutMs, pollIntervalMs } = resolveTiming(options);
  if (typeof options.rpc?.sendTransaction !== "function" || typeof options.rpc?.getTransaction !== "function") {
    throw new EvidenceError("invalid_configuration", "rpc must provide sendTransaction and getTransaction");
  }
  if (typeof options.signer?.signTransaction !== "function") {
    throw new EvidenceError("invalid_configuration", "signer must provide signTransaction");
  }
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const assembled = await assemble();
  if (assembled.options?.networkPassphrase !== options.networkPassphrase) {
    throw new EvidenceError(
      "invalid_configuration",
      "the generated client and the evidence options use different network passphrases",
    );
  }
  if (assembled.isReadCall) {
    throw new EvidenceError("not_a_write", `${method} simulated as a read-only call; nothing to submit`);
  }
  if (assembled.built === undefined) {
    throw new EvidenceError("not_simulated", `${method} has no simulated transaction to sign`);
  }
  const others = assembled.needsNonInvokerSigningBy();
  if (others.length > 0) {
    throw new EvidenceError(
      "additional_signers_required",
      `${method} needs authorization entries signed by ${others.join(", ")} before submission`,
    );
  }

  const built = assembled.built;
  const expectedHash = Buffer.from(built.hash()).toString("hex");
  let signed: { signedTxXdr: string; error?: unknown };
  try {
    signed = await options.signer.signTransaction(built.toXDR(), {
      networkPassphrase: options.networkPassphrase,
    });
  } catch {
    throw new EvidenceError("signer_rejected", `the signer did not sign ${method}`);
  }
  if (signed?.error !== undefined || typeof signed?.signedTxXdr !== "string" || signed.signedTxXdr === "") {
    throw new EvidenceError("signer_rejected", `the signer did not return a signed ${method} envelope`);
  }
  let signedTransaction: Transaction | FeeBumpTransaction;
  try {
    signedTransaction = TransactionBuilder.fromXDR(signed.signedTxXdr, options.networkPassphrase);
  } catch {
    throw new EvidenceError("signer_modified_transaction", "the signer returned an envelope that does not decode");
  }
  // The hash covers the network and the transaction body but not signatures,
  // so any change the signer made to the transaction is detected here.
  if (Buffer.from(signedTransaction.hash()).toString("hex") !== expectedHash) {
    throw new EvidenceError(
      "signer_modified_transaction",
      `the signer returned a different ${method} transaction than the one simulated`,
    );
  }

  let sent: rpc.Api.SendTransactionResponse;
  try {
    sent = await options.rpc.sendTransaction(signedTransaction);
  } catch {
    throw new EvidenceError("rpc_error", `sendTransaction failed for ${method}; submission state is unknown`, {
      expectedTransactionHash: expectedHash,
      retryable: true,
    });
  }
  const transactionHash = requireTransactionHash(sent?.hash, "sendTransaction");
  if (transactionHash !== expectedHash) {
    throw new EvidenceError("malformed_rpc_response", "sendTransaction returned a hash for a different transaction", {
      expectedTransactionHash: expectedHash,
    });
  }
  switch (sent.status) {
    case "ERROR":
      return {
        status: "failed",
        method,
        network,
        transactionHash,
        stage: "submission",
        ...resultDetails(sent.errorResult),
      };
    case "TRY_AGAIN_LATER":
      throw new EvidenceError("rpc_error", `RPC asked to retry ${method} later; it was not submitted`, {
        transactionHash,
        retryable: true,
      });
    case "PENDING":
    case "DUPLICATE":
      break;
    default:
      throw new EvidenceError("malformed_rpc_response", `sendTransaction returned an unknown status`, {
        transactionHash,
      });
  }

  const started = now();
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs) + 1;
  let attempts = 0;
  let latestLedger: number | undefined;
  for (;;) {
    if (attempts > 0) {
      const remaining = timeoutMs - (now() - started);
      if (remaining <= 0 || attempts >= maxAttempts) {
        break;
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
    attempts += 1;
    let response: rpc.Api.GetTransactionResponse;
    try {
      response = await options.rpc.getTransaction(transactionHash);
    } catch {
      throw new EvidenceError(
        "rpc_error",
        `getTransaction failed while confirming ${method}; it was submitted, resume polling by hash`,
        { transactionHash, retryable: true },
      );
    }
    if (response?.txHash !== undefined && response.txHash !== transactionHash) {
      throw new EvidenceError("malformed_rpc_response", "getTransaction returned a different transaction", {
        transactionHash,
      });
    }
    if (Number.isSafeInteger(response?.latestLedger) && response.latestLedger > 0) {
      latestLedger = response.latestLedger;
    }
    switch (response?.status) {
      case "NOT_FOUND":
        continue;
      case "SUCCESS": {
        const ledger = requireLedger(response.ledger, transactionHash);
        const createdAt = requireCreatedAt(response.createdAt, transactionHash);
        if (response.returnValue === undefined) {
          throw new EvidenceError("malformed_rpc_response", "successful transaction has no return value to decode", {
            transactionHash,
          });
        }
        return {
          status: "confirmed",
          method,
          network,
          transactionHash,
          ledger,
          createdAt,
          result: assembled.options.parseResultXdr(response.returnValue),
        };
      }
      case "FAILED":
        return {
          status: "failed",
          method,
          network,
          transactionHash,
          stage: "ledger",
          ledger: requireLedger(response.ledger, transactionHash),
          createdAt: requireCreatedAt(response.createdAt, transactionHash),
          ...resultDetails(response.resultXdr),
        };
      default:
        throw new EvidenceError("malformed_rpc_response", "getTransaction returned an unknown status", {
          transactionHash,
        });
    }
  }

  const pending: PendingEvidence = {
    status: "pending",
    method,
    network,
    transactionHash,
    attempts,
    elapsedMs: Math.round(now() - started),
  };
  if (latestLedger !== undefined) {
    pending.latestLedger = latestLedger;
  }
  return pending;
}

/** Maps a passphrase to a supported network or throws `unsupported_network`. */
export function resolveEvidenceNetwork(networkPassphrase: unknown): EvidenceNetwork {
  if (typeof networkPassphrase !== "string" || networkPassphrase === "") {
    throw new EvidenceError("invalid_configuration", "networkPassphrase is required; there is no default network");
  }
  for (const [network, passphrase] of Object.entries(SUPPORTED_EVIDENCE_NETWORKS)) {
    if (passphrase === networkPassphrase) {
      return network as EvidenceNetwork;
    }
  }
  if (networkPassphrase === Networks.PUBLIC) {
    throw new EvidenceError(
      "unsupported_network",
      "pubnet is not supported by the upto-session evidence helpers: there is no reviewed pubnet deployment",
    );
  }
  throw new EvidenceError("unsupported_network", "unsupported network passphrase; use testnet or a local standalone network");
}

/**
 * Throws unless `value` is confirmed evidence with a real-looking transaction
 * hash, a positive integer ledger and close time, and a result field.
 */
export function assertConfirmedEvidence(value: unknown): asserts value is ConfirmedEvidence<unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("evidence must be an object");
  }
  const evidence = value as Record<string, unknown>;
  if (evidence.status !== "confirmed") {
    throw new Error(`evidence status is ${String(evidence.status)}, not confirmed`);
  }
  if (typeof evidence.transactionHash !== "string" || !TRANSACTION_HASH.test(evidence.transactionHash)) {
    throw new Error("evidence transactionHash must be 64 lowercase hex characters");
  }
  if (!isPositiveInteger(evidence.ledger)) {
    throw new Error("evidence ledger must be a positive integer");
  }
  if (!isPositiveInteger(evidence.createdAt)) {
    throw new Error("evidence createdAt must be a positive integer");
  }
  if (!("result" in evidence)) {
    throw new Error("evidence must include the decoded result");
  }
}

function resolveTiming(options: EvidenceOptions): { timeoutMs: number; pollIntervalMs: number } {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVIDENCE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_EVIDENCE_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_EVIDENCE_TIMEOUT_MS) {
    throw new EvidenceError("invalid_configuration", `timeoutMs must be an integer in 1..${MAX_EVIDENCE_TIMEOUT_MS}`);
  }
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < MIN_EVIDENCE_POLL_INTERVAL_MS ||
    pollIntervalMs > MAX_EVIDENCE_POLL_INTERVAL_MS
  ) {
    throw new EvidenceError(
      "invalid_configuration",
      `pollIntervalMs must be an integer in ${MIN_EVIDENCE_POLL_INTERVAL_MS}..${MAX_EVIDENCE_POLL_INTERVAL_MS}`,
    );
  }
  return { timeoutMs, pollIntervalMs };
}

function requireTransactionHash(value: unknown, source: string): string {
  if (typeof value !== "string" || !TRANSACTION_HASH.test(value)) {
    throw new EvidenceError("malformed_rpc_response", `${source} did not return a valid transaction hash`);
  }
  return value;
}

function requireLedger(value: unknown, transactionHash: string): number {
  if (!isPositiveInteger(value)) {
    throw new EvidenceError("malformed_rpc_response", "RPC did not report a valid ledger; refusing to default it", {
      transactionHash,
    });
  }
  return value;
}

function requireCreatedAt(value: unknown, transactionHash: string): number {
  if (!isPositiveInteger(value)) {
    throw new EvidenceError("malformed_rpc_response", "RPC did not report a valid ledger close time", {
      transactionHash,
    });
  }
  return value;
}

function resultDetails(result: xdr.TransactionResult | undefined) {
  if (result === undefined) {
    return {};
  }
  const details: { resultXdr?: string; resultCode?: string } = {};
  try {
    details.resultXdr = result.toXdr("base64");
    details.resultCode = result.result.type;
  } catch {
    // Keep whatever decoded; the hash and stage remain authoritative.
  }
  return details;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
