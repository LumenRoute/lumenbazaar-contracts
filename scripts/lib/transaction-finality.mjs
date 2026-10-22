import { performance } from "node:perf_hooks";

export class TransactionFinalityError extends Error {
  constructor(outcome) {
    super(`Transaction ${outcome.transactionHash}: ${outcome.status}; latest ledger ${outcome.latestLedger ?? "unknown"}; ${outcome.attempts} polls, ${outcome.elapsedMs}ms elapsed.`);
    this.name = "TransactionFinalityError";
    this.outcome = outcome;
  }
}

// NOT_FOUND is pending, never evidence of failure or expiry. Expiry requires the
// caller's inclusive maxLedger and an RPC-observed ledger beyond that bound.
export async function pollTransaction(transactionHash, {
  rpc, now = () => performance.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 120_000, intervalMs = 1_000, maxAttempts = 121, maxLedger,
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(transactionHash ?? "")) throw new Error("A 64-character transaction hash is required.");
  if (typeof rpc !== "function") throw new Error("A transaction RPC function is required.");
  for (const [name, value] of Object.entries({ timeoutMs, intervalMs, maxAttempts })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`);
  }
  if (maxLedger !== undefined && (!Number.isSafeInteger(maxLedger) || maxLedger <= 0)) throw new Error("maxLedger must be a positive safe integer.");
  const started = now();
  let latestLedger = null;
  let attempts = 0;
  const outcome = (status, extra = {}) => ({ status, transactionHash, latestLedger, attempts,
    elapsedMs: Math.max(0, now() - started), timeoutMs, maxLedger: maxLedger ?? null, ...extra });
  while (attempts < maxAttempts) {
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) return outcome("TIMED_OUT");
    attempts++;
    let result;
    try {
      result = await rpc("getTransaction", { hash: transactionHash }, { timeoutMs: remaining });
    } catch (error) {
      if (now() - started >= timeoutMs) return outcome("TIMED_OUT");
      throw error; // Transport/protocol errors are not on-ledger transaction failures.
    }
    if (!result || !["NOT_FOUND", "PENDING", "SUCCESS", "FAILED"].includes(result.status)) {
      throw new Error("getTransaction returned an unsupported status.");
    }
    if (Number.isSafeInteger(result.latestLedger) && result.latestLedger > 0) {
      latestLedger = Math.max(latestLedger ?? 0, result.latestLedger);
    }
    if (now() - started > timeoutMs) return outcome("TIMED_OUT");
    if (["SUCCESS", "FAILED"].includes(result.status)) {
      if (!Number.isSafeInteger(result.ledger) || result.ledger <= 0 || !/^\d+$/.test(String(result.createdAt))
        || !Number.isFinite(new Date(Number(result.createdAt) * 1000).getTime())) {
        throw new Error("Final transaction result is missing network ledger or timestamp evidence.");
      }
      return outcome(result.status, { ledger: result.ledger,
        createdAt: new Date(Number(result.createdAt) * 1000).toISOString(),
        resultMetadata: { resultXdr: result.resultXdr ?? null, resultMetaXdr: result.resultMetaXdr ?? null }, result });
    }
    if (maxLedger !== undefined && latestLedger !== null && latestLedger > maxLedger) return outcome("EXPIRED");
    if (attempts >= maxAttempts || now() - started >= timeoutMs) return outcome("TIMED_OUT");
    await sleep(Math.min(intervalMs, timeoutMs - (now() - started)));
  }
  return outcome("TIMED_OUT");
}
