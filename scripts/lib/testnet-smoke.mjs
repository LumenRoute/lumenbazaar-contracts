import { createHash } from "node:crypto";

export const REPORT_KIND = "lumenbazaar-testnet-upto-lifecycle-smoke";
export const REPORT_SCHEMA_VERSION = 1;
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// Hard bounds keep a live run small, cheap, and incapable of moving meaningful value.
export const MAX_SMOKE_CAP = 100_000_000n;
export const MAX_EXPIRY_WINDOW_LEDGERS = 5_000;
export const MIN_EXPIRY_WINDOW_LEDGERS = 60;

export const contractIdPattern = /^C[A-Z2-7]{55}$/;
export const accountPattern = /^G[A-Z2-7]{55}$/;
export const hashPattern = /^[a-f0-9]{64}$/;
export const commitPattern = /^[a-f0-9]{40}$/;
export const secretSeedPattern = /\bS[A-Z2-7]{55}\b/;
const localPathPattern = /(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/|\/root\/)/;
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertIdentityName(label, value) {
  if (typeof value !== "string" || secretSeedPattern.test(value) || !identityPattern.test(value)) {
    throw new Error(
      `${label} must be a local Stellar identity alias, never a secret seed or key material.`,
    );
  }
  return value;
}

export function parseBoundedAmount(label, value, { min, max }) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const amount = BigInt(value);
  if (amount < min || amount > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return amount;
}

/**
 * Validates and normalizes run configuration. Fails closed for anything that is not an explicit,
 * bounded testnet run.
 */
export function buildConfig(environment, manifest) {
  const network = environment.STELLAR_NETWORK || "testnet";
  if (network !== "testnet") {
    throw new Error("The smoke runner only supports the Stellar testnet network.");
  }
  if (manifest.environment !== "testnet" || manifest.network?.passphrase !== TESTNET_PASSPHRASE) {
    throw new Error("The deployment manifest is not a testnet manifest.");
  }

  const rpcUrl = environment.LUMENBAZAAR_SMOKE_RPC_URL || manifest.network.rpcUrl;
  if (!/^https:\/\/[^/]*testnet[^/]*\//.test(`${rpcUrl}/`)) {
    throw new Error("The RPC URL must be an https testnet endpoint.");
  }

  const uptoSession =
    environment.LUMENBAZAAR_UPTO_SESSION_CONTRACT_ID ||
    manifest.contracts?.["upto-session"]?.contractId;
  const asset =
    environment.LUMENBAZAAR_TEST_TOKEN_CONTRACT_ID || manifest.contracts?.["test-token"]?.contractId;
  for (const [name, id] of [
    ["upto-session", uptoSession],
    ["test-token", asset],
  ]) {
    if (!contractIdPattern.test(id || "")) {
      throw new Error(`Missing valid testnet contract ID for ${name}.`);
    }
  }

  const cap = parseBoundedAmount("LUMENBAZAAR_SMOKE_CAP", environment.LUMENBAZAAR_SMOKE_CAP || "10000000", {
    min: 10n,
    max: MAX_SMOKE_CAP,
  });
  const settleAmount = parseBoundedAmount(
    "LUMENBAZAAR_SMOKE_SETTLE_AMOUNT",
    environment.LUMENBAZAAR_SMOKE_SETTLE_AMOUNT || ((cap * 65n) / 100n).toString(),
    { min: 1n, max: cap - 1n },
  );
  const expiryWindow = Number(
    parseBoundedAmount(
      "LUMENBAZAAR_SMOKE_EXPIRY_WINDOW",
      environment.LUMENBAZAAR_SMOKE_EXPIRY_WINDOW || "300",
      { min: BigInt(MIN_EXPIRY_WINDOW_LEDGERS), max: BigInt(MAX_EXPIRY_WINDOW_LEDGERS) },
    ),
  );

  return {
    network,
    rpcUrl,
    passphrase: TESTNET_PASSPHRASE,
    uptoSession,
    asset,
    cap,
    settleAmount,
    expiryWindow,
    identities: {
      buyer: assertIdentityName("LUMENBAZAAR_SMOKE_BUYER", environment.LUMENBAZAAR_SMOKE_BUYER),
      seller: assertIdentityName("LUMENBAZAAR_SMOKE_SELLER", environment.LUMENBAZAAR_SMOKE_SELLER),
      tokenAdmin: assertIdentityName(
        "LUMENBAZAAR_SMOKE_TOKEN_ADMIN",
        environment.LUMENBAZAAR_SMOKE_TOKEN_ADMIN,
      ),
    },
  };
}

/** Extracts the single transaction hash a signed `stellar contract invoke` printed. */
export function parseTransactionHash(output) {
  const explorer = [...output.matchAll(/\/tx\/([a-f0-9]{64})\b/gi)].map((match) => match[1]);
  const labelled = [...output.matchAll(/transaction hash(?: is|:)?\s+([a-f0-9]{64})\b/gi)].map(
    (match) => match[1],
  );
  const unique = new Set([...explorer, ...labelled].map((hash) => hash.toLowerCase()));
  if (unique.size !== 1) {
    throw new Error("Could not find exactly one transaction hash in the Stellar CLI output.");
  }
  return [...unique][0];
}

/** Parses the JSON scalar a read or create call returns, such as a 32-byte session ID. */
export function parseSessionId(stdout) {
  const value = stdout.trim().replace(/^"|"$/g, "");
  if (!hashPattern.test(value)) {
    throw new Error("The create_session result is not a 32-byte session ID.");
  }
  return value;
}

export function parseJsonResult(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error("The Stellar CLI result was not valid JSON.");
  }
}

function sessionStatus(value) {
  const status = value?.status;
  if (typeof status === "string") return status;
  if (Array.isArray(status)) return String(status[0]);
  if (status && typeof status === "object") return Object.keys(status)[0];
  return undefined;
}

/**
 * Minimal Soroban JSON-RPC client. `fetchImpl` is injectable so tests never touch a network.
 */
export function createRpc(rpcUrl, fetchImpl = globalThis.fetch, sleep = defaultSleep) {
  let nextId = 1;
  async function call(method, params) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    const body = await response.json();
    if (body.error) {
      throw new Error(`RPC ${method} failed: ${body.error.message || "unknown error"}`);
    }
    return body.result;
  }

  return {
    async latestLedger() {
      const result = await call("getLatestLedger", {});
      if (!Number.isInteger(result.sequence)) {
        throw new Error("RPC returned no latest ledger sequence.");
      }
      return result.sequence;
    },
    async confirmed(hash, { attempts = 20, delayMs = 1500 } = {}) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = await call("getTransaction", { hash });
        if (result.status === "SUCCESS") {
          const ledger = Number(result.ledger);
          const createdAt = new Date(Number(result.createdAt) * 1000).toISOString();
          if (!Number.isInteger(ledger) || Number.isNaN(Date.parse(createdAt))) {
            throw new Error(`RPC returned incomplete evidence for ${hash}.`);
          }
          return { transactionHash: hash, ledger, createdAt };
        }
        if (result.status === "FAILED") {
          throw new Error(`Transaction ${hash} failed on-chain.`);
        }
        await sleep(delayMs);
      }
      throw new Error(`Transaction ${hash} was not confirmed in time.`);
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function placeholderCommand(args, config) {
  const replacements = new Map([
    [config.identities.buyer, "<buyer-identity>"],
    [config.identities.seller, "<seller-identity>"],
    [config.identities.tokenAdmin, "<token-admin-identity>"],
  ]);
  const parts = args.map((part) => replacements.get(part) ?? part);
  return `stellar ${parts.join(" ")}`;
}

/**
 * Runs the bounded lifecycle and returns an unsanitized-by-construction report: only public
 * values (contract IDs, public accounts, hashes, ledgers, amounts) are ever copied into it.
 *
 * `exec(args)` runs the Stellar CLI and returns `{ status, stdout, stderr }`.
 */
export async function runSmoke({
  config,
  exec,
  rpc,
  sourceCommit,
  sourceTreeClean,
  now = () => new Date(),
  runId,
}) {
  const commands = [];

  const run = (args, { signer, send } = {}) => {
    const full = [
      "contract",
      "invoke",
      "--id",
      args.contract,
      "--source-account",
      signer ?? config.identities.buyer,
      "--network",
      config.network,
      ...(send === false ? ["--send", "no"] : []),
      "--",
      ...args.call,
    ];
    const result = exec(full);
    return { full, result };
  };

  const publicAddress = (alias) => {
    const result = exec(["keys", "address", alias]);
    const address = (result.stdout || "").trim();
    if (result.status !== 0 || !accountPattern.test(address)) {
      throw new Error("Could not resolve a public account for a configured identity.");
    }
    return address;
  };

  const readCall = (contract, call) => {
    const { full, result } = run({ contract, call }, { send: false });
    if (result.status !== 0) {
      throw new Error(`Read-only call ${call[0]} failed.`);
    }
    commands.push(placeholderCommand(full, config));
    return result.stdout;
  };

  const sendCall = async (name, contract, call, signer) => {
    const { full, result } = run({ contract, call }, { signer });
    if (result.status !== 0) {
      throw new Error(`Transaction ${name} was not accepted.`);
    }
    const hash = parseTransactionHash(`${result.stderr || ""}\n${result.stdout || ""}`);
    const evidence = await rpc.confirmed(hash);
    const command = placeholderCommand(full, config);
    commands.push(command);
    return { evidence: { ...evidence, command }, stdout: result.stdout || "" };
  };

  const rejectedCall = (name, contract, call, signer, expectedCode, expectedName, ledger) => {
    const { full, result } = run({ contract, call }, { signer });
    const text = `${result.stderr || ""}\n${result.stdout || ""}`;
    if (result.status === 0) {
      throw new Error(`Rejection case ${name} unexpectedly succeeded.`);
    }
    if (!new RegExp(`#${expectedCode}\\b|${expectedName}`).test(text)) {
      throw new Error(`Rejection case ${name} failed for an unexpected reason.`);
    }
    const command = placeholderCommand(full, config);
    commands.push(command);
    return {
      name,
      transactionHash: null,
      observedAtLedger: ledger,
      result: `#${expectedCode} ${expectedName}`,
      command,
    };
  };

  const buyer = publicAddress(config.identities.buyer);
  const seller = publicAddress(config.identities.seller);
  const tokenAdmin = publicAddress(config.identities.tokenAdmin);
  if (new Set([buyer, seller]).size !== 2) {
    throw new Error("Buyer and seller identities must be distinct accounts.");
  }

  const balanceOf = (account) => {
    const raw = readCall(config.asset, ["balance", "--id", account]);
    const value = parseJsonResult(raw);
    if (!/^-?[0-9]+$/.test(String(value))) {
      throw new Error("Balance result was not an integer.");
    }
    return BigInt(value);
  };

  const interfaceVersion = parseJsonResult(readCall(config.uptoSession, ["interface_version"]));
  const assetCap = BigInt(
    parseJsonResult(readCall(config.uptoSession, ["get_asset_max_session_amount", "--asset", config.asset])),
  );
  if (assetCap < config.cap) {
    throw new Error("The configured smoke cap exceeds the deployed per-asset session cap.");
  }

  const startLedger = await rpc.latestLedger();
  const balancesBefore = {
    buyer: balanceOf(buyer),
    seller: balanceOf(seller),
    escrowContract: balanceOf(config.uptoSession),
  };

  // Fund only the shortfall for two sessions so repeated runs stay bounded.
  const needed = config.cap * 2n;
  let mint = null;
  if (balancesBefore.buyer < needed) {
    const amount = needed - balancesBefore.buyer;
    const minted = await sendCall(
      "mint",
      config.asset,
      ["mint", "--to", buyer, "--amount", amount.toString()],
      config.identities.tokenAdmin,
    );
    mint = { amount: amount.toString(), ...minted.evidence };
  }

  const expiresAtLedger = startLedger + config.expiryWindow;
  const createSession = async (label) => {
    const resourceHash = sha256Hex(`lumenbazaar-smoke:${runId}:${label}:resource`);
    const created = await sendCall(
      `create_${label}`,
      config.uptoSession,
      [
        "create_session",
        "--buyer",
        buyer,
        "--seller",
        seller,
        "--asset",
        config.asset,
        "--max_amount",
        config.cap.toString(),
        "--expires_at_ledger",
        String(expiresAtLedger),
        "--resource_hash",
        resourceHash,
      ],
      config.identities.buyer,
    );
    return { sessionId: parseSessionId(created.stdout), create: created.evidence, resourceHash };
  };
  const readStatus = (sessionId) =>
    sessionStatus(parseJsonResult(readCall(config.uptoSession, ["get_session", "--session_id", sessionId])));

  // Lifecycle A: create, settle, then a rejected replay.
  const settled = await createSession("settle");
  const usageHash = sha256Hex(`lumenbazaar-smoke:${runId}:settle:usage`);
  const settle = await sendCall(
    "settle",
    config.uptoSession,
    [
      "settle",
      "--session_id",
      settled.sessionId,
      "--actual_amount",
      config.settleAmount.toString(),
      "--usage_hash",
      usageHash,
    ],
    config.identities.seller,
  );
  const replayLedger = await rpc.latestLedger();
  const replay = rejectedCall(
    "replay_settle",
    config.uptoSession,
    [
      "settle",
      "--session_id",
      settled.sessionId,
      "--actual_amount",
      config.settleAmount.toString(),
      "--usage_hash",
      usageHash,
    ],
    config.identities.seller,
    6,
    "SessionAlreadySettled",
    replayLedger,
  );
  if (readStatus(settled.sessionId) !== "Settled") {
    throw new Error("The settled session is not in the Settled state.");
  }

  // Lifecycle B: a separate session that is cancelled.
  const cancelled = await createSession("cancel");
  const cancel = await sendCall(
    "cancel",
    config.uptoSession,
    ["cancel", "--session_id", cancelled.sessionId],
    config.identities.buyer,
  );
  if (readStatus(cancelled.sessionId) !== "Cancelled") {
    throw new Error("The cancelled session is not in the Cancelled state.");
  }

  const balancesAfter = {
    buyer: balanceOf(buyer),
    seller: balanceOf(seller),
    escrowContract: balanceOf(config.uptoSession),
  };
  const endLedger = await rpc.latestLedger();

  const report = {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    network: config.network,
    networkPassphrase: config.passphrase,
    mainnetEvidence: false,
    note: "Testnet-only evidence using the test-only LBT asset. It makes no mainnet or production claim.",
    generatedAt: now().toISOString(),
    runId,
    sourceCommit,
    sourceTreeClean,
    contracts: { uptoSession: config.uptoSession, asset: config.asset, interfaceVersion },
    actors: { buyer, seller, tokenAdmin },
    bounds: {
      capPerSession: config.cap.toString(),
      settleAmount: config.settleAmount.toString(),
      expiryWindowLedgers: config.expiryWindow,
    },
    ledgers: { start: startLedger, end: endLedger, sessionExpiresAt: expiresAtLedger },
    mint,
    sessions: {
      settled: {
        sessionId: settled.sessionId,
        status: "Settled",
        create: settled.create,
        settle: settle.evidence,
        replaySettle: replay,
      },
      cancelled: {
        sessionId: cancelled.sessionId,
        status: "Cancelled",
        create: cancelled.create,
        cancel: cancel.evidence,
      },
    },
    balances: {
      before: stringifyBalances(balancesBefore),
      after: stringifyBalances(balancesAfter),
      mintedToBuyer: mint ? mint.amount : "0",
    },
    commands,
  };

  validateReport(report);
  return report;
}

function stringifyBalances(balances) {
  return Object.fromEntries(Object.entries(balances).map(([key, value]) => [key, value.toString()]));
}

function requireOperation(operation, label) {
  if (!hashPattern.test(operation?.transactionHash || "")) {
    throw new Error(`${label} has no transaction hash.`);
  }
  if (!Number.isInteger(operation.ledger) || Number.isNaN(Date.parse(operation.createdAt))) {
    throw new Error(`${label} has incomplete ledger evidence.`);
  }
  if (typeof operation.command !== "string" || !operation.command.startsWith("stellar ")) {
    throw new Error(`${label} has no replay command.`);
  }
}

/** Validates a smoke report. Throws on any missing evidence, unsafe claim, or secret material. */
export function validateReport(report) {
  const source = JSON.stringify(report);
  if (secretSeedPattern.test(source)) {
    throw new Error("The smoke report contains signing material.");
  }
  if (localPathPattern.test(source)) {
    throw new Error("The smoke report contains a local path.");
  }
  if (report.kind !== REPORT_KIND || report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error("The smoke report has an unknown kind or schema version.");
  }
  if (report.network !== "testnet" || report.networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error("The smoke report must identify the Stellar testnet.");
  }
  if (report.mainnetEvidence !== false) {
    throw new Error("The smoke report must not claim mainnet evidence.");
  }
  if (!commitPattern.test(report.sourceCommit || "")) {
    throw new Error("The smoke report has no source commit.");
  }
  if (typeof report.sourceTreeClean !== "boolean") {
    throw new Error("The smoke report does not state whether the source tree was clean.");
  }
  if (!contractIdPattern.test(report.contracts?.uptoSession || "") || !contractIdPattern.test(report.contracts?.asset || "")) {
    throw new Error("The smoke report has invalid contract IDs.");
  }
  for (const [name, account] of Object.entries(report.actors || {})) {
    if (!accountPattern.test(account)) {
      throw new Error(`Actor ${name} is not a public account.`);
    }
  }
  if (report.actors.buyer === report.actors.seller) {
    throw new Error("Buyer and seller must be distinct.");
  }

  const { settled, cancelled } = report.sessions || {};
  if (!settled || !cancelled || settled.sessionId === cancelled.sessionId) {
    throw new Error("The report needs two separate sessions.");
  }
  for (const session of [settled, cancelled]) {
    if (!hashPattern.test(session.sessionId || "")) {
      throw new Error("A session ID is not a 32-byte hash.");
    }
  }
  requireOperation(settled.create, "Settled-session create");
  requireOperation(settled.settle, "Settle");
  requireOperation(cancelled.create, "Cancelled-session create");
  requireOperation(cancelled.cancel, "Cancel");
  if (report.mint) {
    requireOperation(report.mint, "Mint");
  }
  if (settled.settle.ledger < settled.create.ledger || cancelled.cancel.ledger < cancelled.create.ledger) {
    throw new Error("Ledger ordering is inconsistent.");
  }
  if (settled.status !== "Settled" || cancelled.status !== "Cancelled") {
    throw new Error("Terminal session statuses are wrong.");
  }

  const replay = settled.replaySettle;
  if (
    replay?.name !== "replay_settle" ||
    replay.transactionHash !== null ||
    !Number.isInteger(replay.observedAtLedger) ||
    !/#6 SessionAlreadySettled/.test(replay.result || "") ||
    !replay.command
  ) {
    throw new Error("Replay settlement was not recorded as rejected.");
  }

  const before = report.balances.before;
  const after = report.balances.after;
  const total = (balances) => Object.values(balances).reduce((sum, value) => sum + BigInt(value), 0n);
  if (total(before) + BigInt(report.balances.mintedToBuyer) !== total(after)) {
    throw new Error("Token balances do not conserve value.");
  }
  const settleAmount = BigInt(report.bounds.settleAmount);
  if (BigInt(after.seller) - BigInt(before.seller) !== settleAmount) {
    throw new Error("The seller was not paid exactly the settled amount.");
  }
  if (BigInt(after.escrowContract) !== BigInt(before.escrowContract)) {
    throw new Error("The escrow contract retained funds after both sessions finalized.");
  }
  return true;
}
