import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logDeployment, redactText, signerValues } from "./deployment-logging.mjs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SUPPORTED_NETWORKS = Object.freeze([
  "local",
  "testnet",
  "standalone",
  "futurenet",
  "mainnet",
]);

export const KNOWN_NETWORK_PASSPHRASES = Object.freeze({
  local: "Standalone Network ; February 2017",
  standalone: "Standalone Network ; February 2017",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
  mainnet: "Public Global Stellar Network ; September 2015",
});

export const DEFAULT_RPC_RETRY_POLICY = Object.freeze({
  maxAttempts: 4,
  attemptTimeoutMs: 15_000,
  totalTimeoutMs: 45_000,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  backoffFactor: 2,
});

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 422]);
const RETRYABLE_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const TERMINAL_JSONRPC_CODES = new Set([-32700, -32600, -32601, -32602]);

export function validateNetwork(network) {
  if (!network || typeof network !== "string") {
    throw new Error("Network must be a non-empty string");
  }
  if (!SUPPORTED_NETWORKS.includes(network)) {
    throw new Error(
      `Unsupported network "${network}". Supported networks are: ${SUPPORTED_NETWORKS.join(", ")}`,
    );
  }
  return network;
}

export function computeNetworkId(passphrase) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length === 0 ||
    passphrase.length > 256 ||
    passphrase !== passphrase.trim() ||
    passphrase !== passphrase.normalize("NFC")
  ) {
    throw new Error(
      "Network passphrase must be a non-empty, trimmed, NFC-normalized string (at most 256 UTF-16 units).",
    );
  }
  return createHash("sha256").update(Buffer.from(passphrase, "utf8")).digest("hex");
}

export function resolveExpectedNetworkIdentity(
  network,
  { expectedPassphrase, env = process.env } = {},
) {
  if (!network || typeof network !== "string" || network.trim() !== network) {
    throw new Error("Network alias must be a non-empty trimmed string.");
  }

  const explicit =
    expectedPassphrase ??
    env.LUMENBAZAAR_EXPECTED_NETWORK_PASSPHRASE ??
    env.STELLAR_NETWORK_PASSPHRASE;
  const hasExplicit = explicit !== undefined && explicit !== "";
  const isKnown = Object.prototype.hasOwnProperty.call(KNOWN_NETWORK_PASSPHRASES, network);

  if (isKnown) {
    const canonical = KNOWN_NETWORK_PASSPHRASES[network];
    if (hasExplicit && explicit !== canonical) {
      const error = new Error(
        `Expected network passphrase mismatch for "${network}": explicit passphrase does not match canonical identity for ${network}.`,
      );
      error.code = "NETWORK_PASSPHRASE_MISMATCH";
      error.network = network;
      error.expectedPassphrase = canonical;
      error.observedPassphrase = explicit;
      throw error;
    }
    return {
      network,
      passphrase: canonical,
      networkId: computeNetworkId(canonical),
      isCustom: false,
    };
  }

  if (!hasExplicit) {
    const error = new Error(
      `Custom network "${network}" requires an explicit expected passphrase via expectedPassphrase, LUMENBAZAAR_EXPECTED_NETWORK_PASSPHRASE, or STELLAR_NETWORK_PASSPHRASE.`,
    );
    error.code = "MISSING_EXPECTED_NETWORK_PASSPHRASE";
    error.network = network;
    throw error;
  }

  return {
    network,
    passphrase: explicit,
    networkId: computeNetworkId(explicit),
    isCustom: true,
  };
}

export function parseNetworkPassphraseFromCli(output, network) {
  if (!output || typeof output !== "string") {
    return null;
  }
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.passphrase === "string" && parsed.passphrase.trim()) {
      return parsed.passphrase.trim();
    }
    if (typeof parsed?.network_passphrase === "string" && parsed.network_passphrase.trim()) {
      return parsed.network_passphrase.trim();
    }
    if (parsed && typeof parsed === "object" && network && parsed[network]) {
      const entry = parsed[network];
      if (typeof entry?.passphrase === "string" && entry.passphrase.trim()) {
        return entry.passphrase.trim();
      }
      if (typeof entry?.network_passphrase === "string" && entry.network_passphrase.trim()) {
        return entry.network_passphrase.trim();
      }
    }
  } catch {
    // Fall through to text parsing for CLI table/key-value output.
  }

  const kvMatch = trimmed.match(/^(?:network[_ -]?)?passphrase\s*[:=]\s*["']?(.+?)["']?\s*$/im);
  if (kvMatch?.[1]) {
    return kvMatch[1].trim();
  }

  return null;
}

export function resolveNetworkPassphraseFromCli(
  network,
  { execute = spawnSync, exec, timeoutMs = DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs } = {},
) {
  const args = ["network", "info", "--network", network];
  let stdout = "";
  if (exec) {
    const out = exec("stellar", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    stdout = typeof out === "string" ? out : "";
  } else {
    const result = execute("stellar", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    if (result.status !== 0 || result.error) {
      const detail = sanitizeCliOutput(result.stderr || result.error?.message || "");
      throw new Error(`Failed to resolve network passphrase for "${network}": ${detail}`);
    }
    stdout = String(result.stdout ?? "");
  }

  const passphrase = parseNetworkPassphraseFromCli(stdout, network);
  if (!passphrase) {
    throw new Error(
      `Could not determine network passphrase for "${network}" from Stellar CLI output.`,
    );
  }
  return {
    passphrase,
    networkId: computeNetworkId(passphrase),
  };
}

function assertNetworkIdentityMatch(expected, observed) {
  if (!observed || typeof observed.passphrase !== "string" || !observed.passphrase) {
    const error = new Error(
      `Unable to resolve actual network passphrase for "${expected.network}" before transaction signing.`,
    );
    error.code = "NETWORK_IDENTITY_UNRESOLVED";
    error.network = expected.network;
    throw error;
  }
  const observedPassphrase = observed.passphrase;
  const observedNetworkId = observed.networkId ?? computeNetworkId(observedPassphrase);
  if (
    observedPassphrase !== expected.passphrase ||
    observedNetworkId !== expected.networkId
  ) {
    const error = new Error(
      `Network passphrase mismatch for "${expected.network}": expected "${expected.passphrase}" (${expected.networkId}), observed "${observedPassphrase}" (${observedNetworkId}). Aborting before transaction signing.`,
    );
    error.code = "NETWORK_PASSPHRASE_MISMATCH";
    error.network = expected.network;
    error.expectedPassphrase = expected.passphrase;
    error.expectedNetworkId = expected.networkId;
    error.observedPassphrase = observedPassphrase;
    error.observedNetworkId = observedNetworkId;
    throw error;
  }
  return {
    network: expected.network,
    passphrase: expected.passphrase,
    networkId: expected.networkId,
    isCustom: expected.isCustom,
  };
}

export function verifyNetworkPassphraseSync({
  network,
  expectedPassphrase,
  actualPassphrase,
  actualNetworkId,
  resolveNetwork,
  env = process.env,
  execute = spawnSync,
  exec,
  timeoutMs = DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
} = {}) {
  const expected = resolveExpectedNetworkIdentity(network, { expectedPassphrase, env });
  let observed;
  if (actualPassphrase !== undefined) {
    observed = {
      passphrase: actualPassphrase,
      networkId: actualNetworkId ?? computeNetworkId(actualPassphrase),
    };
  } else if (typeof resolveNetwork === "function") {
    const resolved = resolveNetwork({ network: expected.network });
    observed =
      typeof resolved === "string"
        ? { passphrase: resolved, networkId: computeNetworkId(resolved) }
        : resolved;
  } else {
    observed = resolveNetworkPassphraseFromCli(expected.network, { execute, exec, timeoutMs });
  }
  return assertNetworkIdentityMatch(expected, observed);
}

export async function verifyNetworkPassphrase({
  network,
  expectedPassphrase,
  actualPassphrase,
  actualNetworkId,
  resolveNetwork,
  rpcUrl,
  fetchImpl = fetch,
  env = process.env,
  execute = spawnSync,
  exec,
  retryPolicy,
} = {}) {
  const expected = resolveExpectedNetworkIdentity(network, { expectedPassphrase, env });
  let observed;
  if (actualPassphrase !== undefined) {
    observed = {
      passphrase: actualPassphrase,
      networkId: actualNetworkId ?? computeNetworkId(actualPassphrase),
    };
  } else if (typeof resolveNetwork === "function") {
    const resolved = await resolveNetwork({ network: expected.network, rpcUrl });
    observed =
      typeof resolved === "string"
        ? { passphrase: resolved, networkId: computeNetworkId(resolved) }
        : resolved;
  } else if (rpcUrl) {
    const policy = resolveRpcRetryPolicy(retryPolicy, env);
    const result = await withBoundedRetry(
      async ({ timeoutMs }) => {
        const response = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork" }),
          signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
        });
        if (!response.ok) {
          const err = new Error(`getNetwork returned HTTP ${response.status}.`);
          err.httpStatus = response.status;
          throw err;
        }
        const payload = await response.json();
        if (payload.error || !payload.result) {
          const err = new Error(
            `getNetwork returned no result: ${JSON.stringify(payload.error ?? null)}`,
          );
          if (typeof payload.error?.code === "number") {
            err.rpcCode = payload.error.code;
          }
          throw err;
        }
        return payload.result;
      },
      { ...policy, operationName: "getNetwork" },
    );
    if (typeof result?.passphrase !== "string" || !result.passphrase) {
      throw new Error(`RPC getNetwork for "${expected.network}" returned no passphrase.`);
    }
    observed = {
      passphrase: result.passphrase,
      networkId: computeNetworkId(result.passphrase),
    };
  } else {
    observed = resolveNetworkPassphraseFromCli(expected.network, {
      execute,
      exec,
      timeoutMs: resolveRpcRetryPolicy(retryPolicy, env).attemptTimeoutMs,
    });
  }
  return assertNetworkIdentityMatch(expected, observed);
}

export function resolveRpcRetryPolicy(overrides = {}, env = process.env) {
  const parsePositiveInt = (raw, fallback, name, min = 1) => {
    if (raw === undefined || raw === null || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min) {
      throw new Error(`${name} must be an integer >= ${min}`);
    }
    return parsed;
  };
  const parseFactor = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("backoffFactor must be a finite number >= 1");
    }
    return parsed;
  };

  return {
    maxAttempts: parsePositiveInt(
      overrides.maxAttempts ?? env.LUMENBAZAAR_RPC_MAX_ATTEMPTS,
      DEFAULT_RPC_RETRY_POLICY.maxAttempts,
      "maxAttempts",
      1,
    ),
    attemptTimeoutMs: parsePositiveInt(
      overrides.attemptTimeoutMs ?? env.LUMENBAZAAR_RPC_ATTEMPT_TIMEOUT_MS,
      DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
      "attemptTimeoutMs",
      1,
    ),
    totalTimeoutMs: parsePositiveInt(
      overrides.totalTimeoutMs ?? env.LUMENBAZAAR_RPC_TOTAL_TIMEOUT_MS,
      DEFAULT_RPC_RETRY_POLICY.totalTimeoutMs,
      "totalTimeoutMs",
      1,
    ),
    initialDelayMs: parsePositiveInt(
      overrides.initialDelayMs ?? env.LUMENBAZAAR_RPC_INITIAL_DELAY_MS,
      DEFAULT_RPC_RETRY_POLICY.initialDelayMs,
      "initialDelayMs",
      0,
    ),
    maxDelayMs: parsePositiveInt(
      overrides.maxDelayMs ?? env.LUMENBAZAAR_RPC_MAX_DELAY_MS,
      DEFAULT_RPC_RETRY_POLICY.maxDelayMs,
      "maxDelayMs",
      0,
    ),
    backoffFactor: parseFactor(overrides.backoffFactor, DEFAULT_RPC_RETRY_POLICY.backoffFactor),
  };
}

export function classifyRpcError(error) {
  if (!error) {
    return { retryable: false, category: "terminal_unknown", reason: "empty error" };
  }

  const code = String(error.code ?? error.cause?.code ?? "");
  const name = String(error.name ?? "");
  const message = String(error.message ?? error);
  const stderr = String(error.stderr ?? "");
  const combined = `${message}\n${stderr}`;
  const httpStatus = Number.isInteger(error.httpStatus)
    ? error.httpStatus
    : Number.isInteger(error.status) && error.status >= 100 && error.status < 600
      ? error.status
      : Number(combined.match(/\bHTTP\s+(\d{3})\b/i)?.[1] ?? NaN);
  const rpcCode = Number.isInteger(error.rpcCode) ? error.rpcCode : undefined;

  if (
    code === "NETWORK_PASSPHRASE_MISMATCH" ||
    code === "MISSING_EXPECTED_NETWORK_PASSPHRASE" ||
    code === "TRANSACTION_IDENTITY_MISMATCH"
  ) {
    return { retryable: false, category: "safety_violation", reason: code };
  }

  if (
    /Error\((?:Contract|Auth|Budget|Storage|Value|WasmVm|Context|Crypto|Object|ScVmError),/i.test(
      combined,
    ) ||
    /\b(?:tx_failed|tx_bad_auth|tx_bad_seq|tx_insufficient_balance|tx_insufficient_fee|tx_too_late|tx_too_early|tx_malformed|tx_no_source_account)\b/i.test(
      combined,
    ) ||
    /Cannot assemble a transaction from a failed simulation/i.test(combined) ||
    /invalid xdr|malformed xdr|unsupported network/i.test(combined)
  ) {
    return {
      retryable: false,
      category: "contract_or_tx_error",
      reason: "deterministic contract, auth, or transaction error",
    };
  }

  if (Number.isInteger(httpStatus) && TERMINAL_HTTP_STATUSES.has(httpStatus)) {
    return {
      retryable: false,
      category: "terminal_http_error",
      reason: `HTTP ${httpStatus}`,
    };
  }

  if (rpcCode !== undefined && TERMINAL_JSONRPC_CODES.has(rpcCode)) {
    return {
      retryable: false,
      category: "terminal_rpc_error",
      reason: `JSON-RPC ${rpcCode}`,
    };
  }

  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    /\b(?:timed?\s*out|timeout|deadline exceeded|operation was aborted)\b/i.test(combined)
  ) {
    return { retryable: true, category: "timeout", reason: code || name || "timeout" };
  }

  if (
    RETRYABLE_ERROR_CODES.has(code) ||
    /\b(?:socket hang up|fetch failed|network error|connection reset|connection refused|temporary failure|econnreset|econnrefused|etimedout|eai_again)\b/i.test(
      combined,
    )
  ) {
    return { retryable: true, category: "transport", reason: code || "transient transport error" };
  }

  if (Number.isInteger(httpStatus) && RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
    return { retryable: true, category: "http_transient", reason: `HTTP ${httpStatus}` };
  }

  if (
    /\b(?:TRY_AGAIN_LATER|rate limit|too many requests|service unavailable|temporarily unavailable|overloaded|gateway timeout|bad gateway)\b/i.test(
      combined,
    ) ||
    rpcCode === -32000 ||
    rpcCode === -32603
  ) {
    return {
      retryable: true,
      category: "rpc_transient",
      reason: rpcCode !== undefined ? `JSON-RPC ${rpcCode}` : "transient RPC error",
    };
  }

  return { retryable: false, category: "terminal_unknown", reason: "unclassified error" };
}

export async function withBoundedRetry(
  operation,
  {
    maxAttempts = DEFAULT_RPC_RETRY_POLICY.maxAttempts,
    attemptTimeoutMs = DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
    totalTimeoutMs = DEFAULT_RPC_RETRY_POLICY.totalTimeoutMs,
    initialDelayMs = DEFAULT_RPC_RETRY_POLICY.initialDelayMs,
    maxDelayMs = DEFAULT_RPC_RETRY_POLICY.maxDelayMs,
    backoffFactor = DEFAULT_RPC_RETRY_POLICY.backoffFactor,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    classify = classifyRpcError,
    onRetry,
    operationName = "rpc",
  } = {},
) {
  const policy = resolveRpcRetryPolicy({
    maxAttempts,
    attemptTimeoutMs,
    totalTimeoutMs,
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
  });

  const startedAt = now();
  const deadline = startedAt + policy.totalTimeoutMs;
  let lastError = null;
  let lastClassification = null;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      const timeoutError = new Error(
        `${operationName} exceeded total timeout of ${policy.totalTimeoutMs}ms after ${attempt - 1} attempt(s).`,
      );
      timeoutError.code = "RPC_TOTAL_TIMEOUT_EXCEEDED";
      timeoutError.attempts = attempt - 1;
      timeoutError.elapsedMs = Math.max(0, now() - startedAt);
      timeoutError.cause = lastError;
      throw timeoutError;
    }

    const perAttemptBudgetMs = Math.max(1, Math.min(policy.attemptTimeoutMs, remainingMs));
    try {
      return await runWithAttemptTimeout(
        (signal) =>
          operation({
            attempt,
            maxAttempts: policy.maxAttempts,
            timeoutMs: perAttemptBudgetMs,
            remainingMs,
            signal,
          }),
        perAttemptBudgetMs,
        operationName,
      );
    } catch (error) {
      lastError = error;
      lastClassification = classify(error);

      if (!lastClassification.retryable) {
        error.retryClassification = lastClassification;
        error.attempts = attempt;
        throw error;
      }

      if (attempt >= policy.maxAttempts) {
        const exhausted = new Error(
          `${operationName} failed after ${attempt} attempt(s) (${lastClassification.category}: ${lastClassification.reason}): ${error.message}`,
        );
        exhausted.code = "RPC_RETRY_EXHAUSTED";
        exhausted.attempts = attempt;
        exhausted.elapsedMs = Math.max(0, now() - startedAt);
        exhausted.retryClassification = lastClassification;
        exhausted.cause = error;
        throw exhausted;
      }

      const rawDelay = Math.round(
        policy.initialDelayMs * Math.pow(policy.backoffFactor, attempt - 1),
      );
      const delayMs = Math.min(policy.maxDelayMs, rawDelay);
      const remainingAfterError = deadline - now();

      if (remainingAfterError <= 0 || delayMs >= remainingAfterError) {
        const timeoutError = new Error(
          `${operationName} exceeded total timeout of ${policy.totalTimeoutMs}ms after ${attempt} attempt(s): ${error.message}`,
        );
        timeoutError.code = "RPC_TOTAL_TIMEOUT_EXCEEDED";
        timeoutError.attempts = attempt;
        timeoutError.elapsedMs = Math.max(0, now() - startedAt);
        timeoutError.retryClassification = lastClassification;
        timeoutError.cause = error;
        throw timeoutError;
      }

      if (typeof onRetry === "function") {
        onRetry({
          operationName,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          remainingMs: remainingAfterError,
          classification: lastClassification,
        });
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function runWithAttemptTimeout(fn, timeoutMs, operationName) {
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${operationName} attempt timed out after ${timeoutMs}ms.`);
      err.name = "TimeoutError";
      err.code = "ETIMEDOUT";
      controller.abort(err);
      reject(err);
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  return Promise.race([
    Promise.resolve().then(() => fn(controller.signal)),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timer);
  });
}

export async function submitTransactionWithRetry({
  signedXdr,
  expectedTransactionHash,
  computeTransactionHash,
  sendTransaction,
  checkTransactionStatus,
  retryPolicy,
  now,
  sleep,
  onRetry,
} = {}) {
  if (typeof signedXdr !== "string" || signedXdr.trim().length === 0) {
    throw new Error("signedXdr must be a non-empty string.");
  }
  if (typeof sendTransaction !== "function") {
    throw new Error("sendTransaction callback is required.");
  }

  const envelopeDigest = createHash("sha256").update(signedXdr, "utf8").digest("hex");
  const computedHash =
    typeof computeTransactionHash === "function"
      ? await computeTransactionHash(signedXdr)
      : expectedTransactionHash;

  if (!HASH_PATTERN.test(computedHash ?? "")) {
    throw new Error("Submission retry requires a valid 64-character lowercase transaction hash.");
  }
  if (expectedTransactionHash && computedHash !== expectedTransactionHash) {
    const mismatch = new Error(
      `Transaction identity mismatch before submission: expected ${expectedTransactionHash}, computed ${computedHash}.`,
    );
    mismatch.code = "TRANSACTION_IDENTITY_MISMATCH";
    mismatch.expectedTransactionHash = expectedTransactionHash;
    mismatch.observedTransactionHash = computedHash;
    throw mismatch;
  }

  const transactionHash = computedHash;
  const policy = resolveRpcRetryPolicy(retryPolicy);

  return withBoundedRetry(
    async ({ attempt, timeoutMs, signal }) => {
      // Re-verify immutable envelope and transaction hash before every send/resend.
      const currentDigest = createHash("sha256").update(signedXdr, "utf8").digest("hex");
      if (currentDigest !== envelopeDigest) {
        const mismatch = new Error(
          `Signed transaction envelope changed before attempt ${attempt}; refusing to resend.`,
        );
        mismatch.code = "TRANSACTION_IDENTITY_MISMATCH";
        throw mismatch;
      }
      if (typeof computeTransactionHash === "function") {
        const verifiedHash = await computeTransactionHash(signedXdr);
        if (verifiedHash !== transactionHash) {
          const mismatch = new Error(
            `Transaction hash mismatch before attempt ${attempt}: expected ${transactionHash}, got ${verifiedHash}.`,
          );
          mismatch.code = "TRANSACTION_IDENTITY_MISMATCH";
          mismatch.expectedTransactionHash = transactionHash;
          mismatch.observedTransactionHash = verifiedHash;
          throw mismatch;
        }
      }

      // On retries, check if the previous attempt already landed or is pending before resending.
      if (attempt > 1 && typeof checkTransactionStatus === "function") {
        const existing = await checkTransactionStatus(transactionHash, { timeoutMs, signal });
        const status = existing?.status;
        if (status === "SUCCESS" || status === "FAILED" || status === "PENDING") {
          return {
            transactionHash,
            status,
            alreadySubmitted: true,
            attempts: attempt,
            result: existing,
          };
        }
      }

      const sendResult = await sendTransaction({
        signedXdr,
        transactionHash,
        attempt,
        timeoutMs,
        signal,
      });

      if (sendResult?.transactionHash && sendResult.transactionHash !== transactionHash) {
        const mismatch = new Error(
          `Submitted transaction hash mismatch: expected ${transactionHash}, observed ${sendResult.transactionHash}.`,
        );
        mismatch.code = "TRANSACTION_IDENTITY_MISMATCH";
        mismatch.expectedTransactionHash = transactionHash;
        mismatch.observedTransactionHash = sendResult.transactionHash;
        throw mismatch;
      }

      return {
        ...sendResult,
        transactionHash,
        alreadySubmitted: false,
        attempts: attempt,
      };
    },
    {
      ...policy,
      now,
      sleep,
      onRetry,
      operationName: `submitTransaction(${transactionHash.slice(0, 12)})`,
    },
  );
}

export function hasFlag(flag) {
  return process.argv.includes(flag);
}

export function sourceAccount(defaultValue = "local-deployer") {
  if (hasFlag("--dry-run")) {
    return (
      process.env.LUMENBAZAAR_SOURCE_ACCOUNT ||
      process.env.STELLAR_ACCOUNT ||
      defaultValue
    );
  }

  const source = process.env.LUMENBAZAAR_SOURCE_ACCOUNT || process.env.STELLAR_ACCOUNT;
  if (!source) {
    throw new Error("Set STELLAR_ACCOUNT or LUMENBAZAAR_SOURCE_ACCOUNT");
  }
  return source;
}

export function networkArgs(defaultNetwork) {
  const network = process.env.STELLAR_NETWORK || defaultNetwork;
  if (network) {
    validateNetwork(network);
    return ["--network", network];
  }
  return [];
}

export function runStellar(
  args,
  { capture = false, dryRun = false, exec, execute = spawnSync, timeoutMs } = {},
) {
  const redact = signerValues(args);
  if (dryRun) {
    logDeployment("stellar.dry-run", { command: formatCommand("stellar", args) }, { redact });
    return "";
  }

  const spawnOptions = {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  };

  if (exec) {
    try {
      const output = exec("stellar", args, spawnOptions);
      return typeof output === "string" ? output.trim() : "";
    } catch (err) {
      const status = err.status ?? err.code ?? 1;
      const stderr = err.stderr ? err.stderr.toString().trim() : "";
      const stdout = err.stdout ? err.stdout.toString().trim() : "";
      const detail = sanitizeCliOutput(stderr || err.message, redact);
      const error = new Error(`Stellar CLI command failed with exit code ${status}: ${detail}`);
      error.status = status;
      error.stderr = stderr;
      error.stdout = stdout;
      error.args = args;
      throw error;
    }
  }

  const result = execute("stellar", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`stellar ${args[0]} failed: ${sanitizeCliOutput(result.stderr || result.error?.message, redact)}`);
  }
  if (result.stderr) logDeployment("stellar.diagnostics", { stderr: result.stderr }, { redact, sink: console.error });
  if (!capture && result.stdout) logDeployment("stellar.output", { stdout: result.stdout }, { redact });
  return capture ? String(result.stdout ?? "").trim() : "";
}

// Runs a transaction-submitting command and returns stdout plus the submitted transaction hash.
// CLI diagnostics are never echoed verbatim because they can include local identity aliases.
export function runStellarTransaction(
  args,
  {
    dryRun = false,
    redact = [],
    execute = spawnSync,
    network,
    expectedPassphrase,
    actualPassphrase,
    resolveNetwork,
    verifyNetwork = false,
    timeoutMs,
  } = {},
) {
  redact = [...redact, ...signerValues(args)];
  const targetNetwork = network ?? extractFlagValue(args, "--network");
  if (
    !dryRun &&
    targetNetwork &&
    (verifyNetwork ||
      expectedPassphrase !== undefined ||
      actualPassphrase !== undefined ||
      typeof resolveNetwork === "function")
  ) {
    verifyNetworkPassphraseSync({
      network: targetNetwork,
      expectedPassphrase,
      actualPassphrase,
      resolveNetwork,
      execute,
      timeoutMs: timeoutMs ?? DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
    });
  } else if (targetNetwork && expectedPassphrase !== undefined) {
    resolveExpectedNetworkIdentity(targetNetwork, { expectedPassphrase });
  }

  if (dryRun) {
    logDeployment("stellar.dry-run", { command: formatCommand("stellar", args) }, { redact });
    return { stdout: "", transactionHash: null, skipped: false };
  }

  const result = execute("stellar", args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  });
  const stderr = result.stderr ?? "";
  if (result.status !== 0 || result.error) {
    throw new Error(
      `stellar ${args[0]} ${args[1] ?? ""} failed: ${sanitizeCliOutput(stderr || result.error?.message || "", redact)}`,
    );
  }
  return {
    stdout: (result.stdout ?? "").trim(),
    // Stellar CLI 28 logs `Signing transaction: <hash>`; some paths also log `Transaction hash is <hash>`.
    transactionHash:
      [...stderr.matchAll(/(?:Transaction hash is|Signing transaction:) ([a-f0-9]{64})/g)].pop()?.[1] ?? null,
    skipped: /Skipping install because wasm already installed/.test(stderr),
  };
}

function extractFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

export function sanitizeCliOutput(text, redact = []) {
  return redactText(text, redact).trim() || "no error details";
}

export function publicKey(identity) {
  if (/^G[A-Z2-7]{55}$/.test(identity)) {
    return identity;
  }
  const address = runStellar(["keys", "public-key", identity], { capture: true });
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    throw new Error("Could not resolve a public account for a local identity.");
  }
  return address;
}

export function uploadContract({ name, wasm, source, network = "testnet", dryRun = false }) {
  const { stdout, transactionHash, skipped } = runStellarTransaction(
    ["contract", "upload", "--wasm", wasm, "--source-account", source, ...networkArgs(network)],
    { dryRun, redact: [source] },
  );
  if (dryRun) {
    return { wasmHash: "dry-run", transactionHash: null, skipped: false };
  }
  if (!skipped && !transactionHash) {
    throw new Error(`Uploading ${name} returned no transaction hash.`);
  }
  // When the CLI skips an already-installed WASM, `skipped` is true and no transaction was sent.
  return { wasmHash: stdout.split(/\r?\n/).pop().trim(), transactionHash, skipped };
}

export function deployUploadedContract({ name, wasmHash, alias, source, network = "testnet", dryRun = false }) {
  const { stdout, transactionHash } = runStellarTransaction(
    [
      "contract",
      "deploy",
      "--wasm-hash",
      wasmHash,
      "--source-account",
      source,
      ...networkArgs(network),
      "--alias",
      alias,
    ],
    { dryRun, redact: [source, alias] },
  );
  if (dryRun) {
    return { contractId: `dry-run-${name}`, transactionHash: null };
  }
  const contractId = findContractId(stdout);
  if (!contractId || !transactionHash) {
    throw new Error(`Deploying ${name} returned no contract ID or transaction hash.`);
  }
  return { contractId, transactionHash };
}

export function buildContracts({ dryRun = false, exec = execFileSync } = {}) {
  runStellar(["contract", "build", "--locked"], { dryRun, exec });
}

export function deployContract({
  name,
  wasm,
  alias,
  source,
  network = "local",
  dryRun = false,
  exec = execFileSync,
  expectedPassphrase,
  actualPassphrase,
  resolveNetwork,
  verifyNetwork = false,
  timeoutMs,
}) {
  const effectiveNetwork = process.env.STELLAR_NETWORK || network;
  if (
    !dryRun &&
    (verifyNetwork ||
      expectedPassphrase !== undefined ||
      actualPassphrase !== undefined ||
      typeof resolveNetwork === "function")
  ) {
    verifyNetworkPassphraseSync({
      network: effectiveNetwork,
      expectedPassphrase,
      actualPassphrase,
      resolveNetwork,
      exec,
      timeoutMs: timeoutMs ?? DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
    });
  } else if (expectedPassphrase !== undefined) {
    resolveExpectedNetworkIdentity(effectiveNetwork, { expectedPassphrase });
  }

  const args = [
    "contract",
    "deploy",
    "--wasm",
    wasm,
    "--source-account",
    source,
    ...networkArgs(network),
    "--alias",
    alias,
  ];
  const output = runStellar(args, { capture: true, dryRun, exec, timeoutMs });

  let contractId = "dry-run";
  if (!dryRun) {
    const found = findContractId(output);
    if (!found) {
      throw new Error(
        `Failed to extract valid contract ID from deployment output for ${name}: "${output}"`,
      );
    }
    contractId = found;
  }

  return {
    name,
    alias,
    network: effectiveNetwork,
    wasm,
    contractId,
  };
}

export function invokeContract({
  contractId,
  source,
  network = "local",
  args,
  capture = false,
  dryRun = false,
  exec = execFileSync,
  expectedPassphrase,
  actualPassphrase,
  resolveNetwork,
  verifyNetwork = false,
  timeoutMs,
}) {
  const effectiveNetwork = process.env.STELLAR_NETWORK || network;
  if (
    !dryRun &&
    (verifyNetwork ||
      expectedPassphrase !== undefined ||
      actualPassphrase !== undefined ||
      typeof resolveNetwork === "function")
  ) {
    verifyNetworkPassphraseSync({
      network: effectiveNetwork,
      expectedPassphrase,
      actualPassphrase,
      resolveNetwork,
      exec,
      timeoutMs: timeoutMs ?? DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
    });
  } else if (expectedPassphrase !== undefined) {
    resolveExpectedNetworkIdentity(effectiveNetwork, { expectedPassphrase });
  }

  return runStellar(
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source-account",
      source,
      ...networkArgs(network),
      "--",
      ...args,
    ],
    { capture, dryRun, exec, timeoutMs },
  );
}

export function invokeContractTransaction({
  contractId,
  source,
  network = "testnet",
  args,
  send = "default",
  dryRun = false,
  redact = [],
}) {
  return runStellarTransaction(
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source-account",
      source,
      ...networkArgs(network),
      "--send",
      send,
      "--",
      ...args,
    ],
    { dryRun, redact: [source, ...redact] },
  );
}

export function readManifest(path) {
  if (!existsSync(path)) {
    return { contracts: {} };
  }
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`Failed to read manifest file at ${path}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Malformed JSON in deployment manifest at ${path}: ${err.message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Malformed manifest at ${path}: expected a JSON object`);
  }
  if (
    parsed.contracts !== undefined &&
    (typeof parsed.contracts !== "object" ||
      parsed.contracts === null ||
      Array.isArray(parsed.contracts))
  ) {
    throw new Error(
      `Malformed manifest at ${path}: "contracts" field must be an object`,
    );
  }
  return parsed;
}

export function getContractEntry(manifest, name) {
  if (!manifest || typeof manifest !== "object" || !manifest.contracts) {
    throw new Error('Invalid manifest structure: missing "contracts" object');
  }
  const entry = manifest.contracts[name];
  if (!entry) {
    throw new Error(`Contract "${name}" not found in manifest`);
  }
  if (!entry.contractId || !/^C[A-Z2-7]{55}$/.test(entry.contractId)) {
    throw new Error(
      `Contract "${name}" in manifest is missing a valid contractId`,
    );
  }
  return entry;
}

export function writeManifest(path, manifest, { dryRun = false } = {}) {
  const value = {
    ...manifest,
    generatedAt: new Date().toISOString(),
  };

  if (dryRun) {
    logDeployment("manifest.dry-run", { path: relative(repoRoot, path), manifest: value });
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function mergeContracts(
  manifestPath,
  contractEntries,
  { dryRun = false, fields = {}, mergeEntries = false } = {},
) {
  const manifest = readManifest(manifestPath);
  const contracts = { ...(manifest.contracts || {}) };
  for (const entry of contractEntries) {
    contracts[entry.name] = mergeEntries ? { ...(contracts[entry.name] || {}), ...entry } : entry;
  }

  writeManifest(
    manifestPath,
    {
      ...manifest,
      ...fields,
      contracts,
    },
    { dryRun },
  );
}

export function findContractId(output) {
  if (!output || typeof output !== "string") {
    return undefined;
  }
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^C[A-Z2-7]{55}$/.test(line));
}

export function formatCommand(command, args) {
  return [command, ...args].map((part) => quoteArg(part)).join(" ");
}

export function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
