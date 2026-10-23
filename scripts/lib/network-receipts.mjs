import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testnetNetwork } from "./deployment-evidence.mjs";
import { repoRoot } from "./stellar-cli.mjs";
import { pollTransaction, TransactionFinalityError } from "./transaction-finality.mjs";

export const receiptsDirectory = join(repoRoot, "deployments", "receipts", "testnet");

const hashPattern = /^[a-f0-9]{64}$/;
// Bounded RPC polling: each wait is limited by a ledger-count or deadline, never a fixed sleep.
const pollIntervalMs = 1_000;
const defaultTimeoutMs = 120_000;

export function requireTestnet() {
  const network = process.env.STELLAR_NETWORK || "testnet";
  if (network !== "testnet") {
    throw new Error(`Unsupported network ${JSON.stringify(network)}; receipts are only recorded for testnet.`);
  }
}

export async function rpcCall(method, params = undefined, { timeoutMs = 30_000 } = {}) {
  const response = await fetch(testnetNetwork.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, 30_000)))),
  });
  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload.error || !payload.result) {
    throw new Error(`${method} returned no result: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

export async function latestLedger() {
  const result = await rpcCall("getLatestLedger");
  if (!Number.isInteger(result.sequence)) {
    throw new Error("getLatestLedger returned no integer sequence.");
  }
  return result.sequence;
}

// Polls getLatestLedger until the network reaches `target`, failing after `timeoutMs`.
export async function waitForLedger(target, { timeoutMs = defaultTimeoutMs } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sequence = await latestLedger();
    if (sequence >= target) {
      return sequence;
    }
    if (Date.now() > deadline) {
      throw new Error(`Ledger ${target} was not reached before the timeout; latest is ${sequence}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function fetchReceipt(transactionHash, options = {}) {
  if (!hashPattern.test(transactionHash ?? "")) {
    throw new Error("A 64-character transaction hash is required to fetch a receipt.");
  }
  const outcome = await pollTransaction(transactionHash, { rpc: rpcCall, ...options });
  if (!["SUCCESS", "FAILED"].includes(outcome.status)) throw new TransactionFinalityError(outcome);
  const result = outcome.result;

  // The envelope is passed on stdin: a WASM upload exceeds the Windows command-line length limit.
  const envelope = decode(["tx", "decode", "--output", "json"], result.envelopeXdr);
  const source = envelope.tx?.tx?.source_account ?? envelope.tx_fee_bump?.tx?.fee_source;
  const receipt = {
    schemaVersion: 1,
    network: "testnet",
    networkPassphrase: testnetNetwork.passphrase,
    transactionHash,
    status: result.status,
    ledger: result.ledger,
    // Ledger close time reported by the network, in whole seconds.
    createdAt: new Date(Number(result.createdAt) * 1000).toISOString().replace(".000Z", "Z"),
    sourceAccount: typeof source === "string" ? source : null,
  };
  if (result.status === "FAILED") {
    receipt.resultCode = resultCode(result.resultXdr);
    receipt.hostError = hostError(result);
  }
  if (!/^G[A-Z2-7]{55}$/.test(receipt.sourceAccount ?? "")) {
    throw new Error(`Transaction ${transactionHash} has no plain account source.`);
  }
  return receipt;
}

export function writeReceipt(receipt, directory = receiptsDirectory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${receipt.transactionHash}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export async function recordReceipt(transactionHash, options) {
  const receipt = await fetchReceipt(transactionHash, options);
  writeReceipt(receipt);
  return receipt;
}

function resultCode(resultXdr) {
  const decoded = decode(["xdr", "decode", "--type", "TransactionResult", "--input", "single-base64", "--output", "json", resultXdr]);
  const result = decoded.result ?? {};
  const [outer] = Object.keys(result);
  const operation = JSON.stringify(result[outer] ?? "").match(/"invoke_host_function":"([a-z_]+)"/)?.[1];
  return operation ? `${outer}/invoke_host_function_${operation}` : String(outer ?? "unknown");
}

// Returns the first host error reported by the network's diagnostic events, for example
// `Error(Contract, #8)` or `Error(Auth, InvalidAction)`.
function hostError(result) {
  const events = [
    ...(result.diagnosticEventsXdr ?? []),
    ...(result.events?.diagnosticEventsXdr ?? []),
  ];
  for (const event of events) {
    const text = JSON.stringify(decode(["xdr", "decode", "--type", "DiagnosticEvent", "--input", "single-base64", "--output", "json", event]));
    const match = text.match(/"error":\{"([a-z_]+)":("?[a-z_0-9]+"?)\}/);
    if (match) {
      const [, type, code] = match;
      const name = pascal(type);
      return /^\d+$/.test(code) ? `Error(${name}, #${code})` : `Error(${name}, ${pascal(code.replaceAll('"', ""))})`;
    }
  }
  return null;
}

function pascal(value) {
  return value.replace(/(^|_)([a-z])/g, (_, __, letter) => letter.toUpperCase());
}

function decode(args, input) {
  return JSON.parse(
    execFileSync("stellar", args, {
      cwd: repoRoot,
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }),
  );
}
