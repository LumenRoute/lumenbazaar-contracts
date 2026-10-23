// Submits Soroban transactions without letting `stellar contract invoke` decide whether to send.
// A transaction is built unsimulated (`--build-only`), given the resource footprint of a simulation,
// signed with a local identity, and sent. Used where the CLI would otherwise refuse to submit:
// rejected calls that must be recorded on ledger, and WASM uploads the CLI skips as already installed.
import { execFileSync, spawnSync } from "node:child_process";

import { fetchReceipt, rpcCall, writeReceipt } from "./network-receipts.mjs";
import { repoRoot, sanitizeCliOutput } from "./stellar-cli.mjs";

export async function simulate(xdr) {
  return rpcCall("simulateTransaction", { transaction: xdr });
}

// Authorization entries are attached only when the caller is expected to authorize.
export function assembleTransaction(xdr, simulation, { includeAuth = false, redact = [] } = {}) {
  if (simulation.error || !simulation.transactionData) {
    throw new Error(`Cannot assemble a transaction from a failed simulation: ${sanitizeCliOutput(simulation.error, redact)}`);
  }
  // Envelopes are passed on stdin: a WASM upload exceeds the Windows command-line length limit.
  const transaction = JSON.parse(stellar(["tx", "decode", "--output", "json"], xdr, redact));
  transaction.tx.tx.ext = { v1: decodeXdr("SorobanTransactionData", simulation.transactionData, redact) };
  transaction.tx.tx.fee = 100 + Math.ceil(Number(simulation.minResourceFee) * 1.5);
  const operation = transaction.tx.tx.operations[0].body.invoke_host_function;
  operation.auth = includeAuth
    ? (simulation.results?.[0]?.auth ?? []).map((entry) => decodeXdr("SorobanAuthorizationEntry", entry, redact))
    : [];
  return stellar(["tx", "encode", "--input", "json"], JSON.stringify(transaction), redact);
}

export function signTransaction(xdr, identity) {
  return stellar(["tx", "sign", "--sign-with-key", identity, "--network", "testnet"], xdr, [identity]);
}

// Sends a signed envelope and returns its network receipt. The signed envelope is never written to
// disk or logs; only the receipt's public fields are kept.
export async function submitSigned(signed, { redact = [] } = {}) {
  const transactionHash = stellar(["tx", "hash", "--network", "testnet"], signed, redact);
  const sent = spawnSync("stellar", ["tx", "send", "--network", "testnet"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: signed,
  });
  // A transaction that fails on ledger can make `tx send` exit non-zero; the receipt is authoritative.
  let receipt;
  try {
    receipt = await fetchReceipt(transactionHash, { timeoutMs: sent.status === 0 ? 120_000 : 30_000 });
  } catch (error) {
    // Preserve timeout/expiry evidence. A CLI exit code cannot establish finality.
    error.message = `${sanitizeCliOutput(error.message, redact)}; CLI context: ${sanitizeCliOutput(sent.stderr ?? "", redact)}`;
    throw error;
  }
  writeReceipt(receipt);
  return receipt;
}

export async function buildSimulateAndSubmit(buildArgs, identity, { includeAuth = true } = {}) {
  const xdr = stellar(buildArgs, undefined, [identity]);
  const simulation = await simulate(xdr);
  const signed = signTransaction(assembleTransaction(xdr, simulation, { includeAuth, redact: [identity] }), identity);
  return submitSigned(signed, { redact: [identity] });
}

export function decodeXdr(type, value, redact = []) {
  return JSON.parse(
    stellar(["xdr", "decode", "--type", type, "--input", "single-base64", "--output", "json", value], undefined, redact),
  );
}

export function stellar(args, input, redact = []) {
  try {
    return execFileSync("stellar", args, {
      cwd: repoRoot,
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`stellar ${args[0]} ${args[1]} failed: ${sanitizeCliOutput(String(error.stderr ?? ""), redact)}`);
  }
}
