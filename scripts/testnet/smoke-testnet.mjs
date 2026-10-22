// Live testnet rejection evidence for upto-session (issues #5 and #6).
//
// Every rejected attempt is submitted as a real transaction so the network, not the CLI, rejects it.
// The transaction is built without simulation, given the resource footprint of a valid sibling
// simulation, signed by the attempting identity, and sent. Its receipt is then fetched from RPC.
//
// Identities are local Stellar CLI aliases supplied through environment variables. Only their public
// keys are written to evidence; the aliases are recorded under `localAliases` solely so the public
// manifest generator can refuse to publish them.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { latestLedger, recordReceipt, requireTestnet, waitForLedger } from "../lib/network-receipts.mjs";
import {
  assembleTransaction,
  signTransaction,
  simulate,
  stellar,
  submitSigned,
} from "../lib/soroban-transactions.mjs";
import {
  hasFlag,
  invokeContractTransaction,
  publicKey,
  repoRoot,
  writeManifest,
} from "../lib/stellar-cli.mjs";

const execFileAsync = promisify(execFile);
const evidencePath = join(repoRoot, "deployments", "testnet-evidence.json");
const usageHash = "e1".repeat(32);
const authFailure = "Error(Auth, InvalidAction)";
const maxTimedAttempts = 3;

const identities = {
  admin: requiredEnv("LUMENBAZAAR_ADMIN"),
  buyer: requiredEnv("LUMENBAZAAR_BUYER"),
  seller: requiredEnv("LUMENBAZAAR_SELLER"),
  wrongSeller: requiredEnv("LUMENBAZAAR_WRONG_SELLER"),
  wrongBuyer: requiredEnv("LUMENBAZAAR_WRONG_BUYER"),
};
if (new Set(Object.values(identities)).size !== Object.keys(identities).length) {
  throw new Error("Each smoke-test role must use a distinct local identity.");
}
const redactions = Object.values(identities);

requireTestnet();
const deploymentManifest = requiredOption("--deployment-manifest");
const manifestPath = join(repoRoot, deploymentManifest);
if (!/^deployments\/testnet-\d{4}-\d{2}-\d{2}\.json$/.test(deploymentManifest) || !existsSync(manifestPath)) {
  throw new Error("--deployment-manifest must name a published deployments/testnet-YYYY-MM-DD.json file.");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const contractId = manifest.contracts["upto-session"]?.contractId;
const asset = manifest.contracts["test-token"];
const actors = Object.fromEntries(Object.entries(identities).map(([role, alias]) => [role, publicKey(alias)]));
if (!contractId || !asset?.contractId || actors.admin !== manifest.admin) {
  throw new Error("The deployment manifest must contain upto-session, test-token, and the configured admin.");
}

const setupTransactions = [];
const cases = [];
const openTimedSessions = [];

if (hasFlag("--dry-run")) {
  console.log(`dry run: would exercise ${contractId} with token ${asset.contractId}; no transaction submitted`);
  process.exit(0);
}

await setup("mint_test_tokens", null, () =>
  invoke(asset.contractId, identities.admin, ["mint", "--to", actors.buyer, "--amount", "100000000"]),
);

// #6 control: a settlement below the cap succeeds.
const control = await createSession("control", "10000000", (await latestLedger()) + 1000);
await runCase({
  name: "control_settlement_below_cap",
  issue: 6,
  sessionId: control.sessionId,
  operation: "settle",
  signer: "seller",
  args: settleArgs(control.sessionId, "6500000"),
  arguments: { actualAmount: "6500000", usageHash },
  expiresAtLedger: control.expiresAtLedger,
  expected: { outcome: "success", error: null },
  includeAuth: true,
});

// #5 and #6 rejections share one open fixture session that must stay open and funded.
const fixture = await createSession("rejection_fixture", "5000000", (await latestLedger()) + 1000);
await runCase({
  name: "wrong_seller_settle",
  issue: 5,
  sessionId: fixture.sessionId,
  operation: "settle",
  signer: "wrongSeller",
  args: settleArgs(fixture.sessionId, "1000000"),
  arguments: { actualAmount: "1000000", usageHash },
  expiresAtLedger: fixture.expiresAtLedger,
  expected: { outcome: "failure", error: authFailure },
});
await runCase({
  name: "wrong_buyer_cancel",
  issue: 5,
  sessionId: fixture.sessionId,
  operation: "cancel",
  signer: "wrongBuyer",
  args: ["cancel", "--session_id", fixture.sessionId],
  arguments: {},
  expiresAtLedger: fixture.expiresAtLedger,
  expected: { outcome: "failure", error: authFailure },
});
await runCase({
  name: "over_cap_settlement",
  issue: 6,
  sessionId: fixture.sessionId,
  operation: "settle",
  signer: "seller",
  args: settleArgs(fixture.sessionId, "5000001"),
  // The over-cap call cannot simulate, so its footprint comes from the same settlement at the cap.
  footprintArgs: settleArgs(fixture.sessionId, "5000000"),
  arguments: { actualAmount: "5000001", usageHash },
  expiresAtLedger: fixture.expiresAtLedger,
  expected: { outcome: "failure", error: "Error(Contract, #8)" },
});
await setup("cancel_rejection_fixture", fixture.sessionId, () =>
  invoke(contractId, identities.buyer, ["cancel", "--session_id", fixture.sessionId]),
);

// #6 expiry: settlement lands in the last valid ledger (E - 1), then exactly at the boundary (E).
await timedCase("settlement_last_valid_ledger", 1, { outcome: "success", error: null });
await timedCase("settlement_at_expiry_boundary", 0, { outcome: "failure", error: "Error(Contract, #4)" });

const final = await readState(null);
if (final.balances.escrowContract !== "0" || final.liability !== "0") {
  throw new Error("Escrow still holds funds after cleanup; evidence was not written.");
}

writeManifest(evidencePath, {
  network: "testnet",
  sourceCommit: manifest.sourceCommit,
  deploymentManifest,
  contractId,
  asset: { contractId: asset.contractId, ...asset.asset },
  actors,
  localAliases: identities,
  setupTransactions,
  cases,
});
console.log("wrote ignored deployments/testnet-evidence.json; publish it with generate-public-manifest.mjs --kind evidence");

// The boundary attempt lands `ledgersBeforeExpiry` ledgers before expiry: 1 for E - 1, 0 for E.
// The transaction is prepared and signed right after the session is created, while it is still far
// from expiry, and then submitted as soon as RPC reports the ledger before the target.
async function timedCase(name, ledgersBeforeExpiry, expected) {
  try {
    await attemptTimedCase(name, ledgersBeforeExpiry, expected);
  } finally {
    // Every session left open by a timed case (the boundary session, missed attempts, or a failed
    // run) is refunded to its buyer through permissionless recovery once it has expired.
    for (const session of openTimedSessions.splice(0)) {
      await recoverIfOpen(session);
    }
  }
}

async function attemptTimedCase(name, ledgersBeforeExpiry, expected) {
  for (let attempt = 1; attempt <= maxTimedAttempts; attempt += 1) {
    const session = await createSession(`${name}_${attempt}`, "2000000", (await latestLedger()) + 30);
    const targetLedger = session.expiresAtLedger - ledgersBeforeExpiry;
    const result = await runCase(
      {
        name,
        issue: 6,
        sessionId: session.sessionId,
        operation: "settle",
        signer: "seller",
        args: settleArgs(session.sessionId, "1000000"),
        arguments: { actualAmount: "1000000", usageHash },
        expiresAtLedger: session.expiresAtLedger,
        expected,
        includeAuth: true,
        submitAfterLedger: targetLedger - 1,
      },
      { record: false },
    );
    if (result.skipped) {
      console.log(`${name}: attempt ${attempt} missed its submission window; retrying with a new session`);
    } else if (result.ledger === targetLedger) {
      cases.push(result.entry);
      break;
    } else {
      console.log(`${name}: attempt ${attempt} landed at ${result.ledger}, not ${targetLedger}; retrying`);
    }
    if (attempt === maxTimedAttempts) {
      throw new Error(`${name} did not land at ledger expiry - ${ledgersBeforeExpiry} in ${maxTimedAttempts} attempts.`);
    }
  }
}

async function recoverIfOpen(session) {
  const state = await readState(session.sessionId);
  if (state.session.status !== "Open") return;
  await waitForLedger(session.expiresAtLedger);
  await setup(`recover_${session.label}`, session.sessionId, () =>
    invoke(contractId, identities.buyer, ["recover_expired", "--session_id", session.sessionId]),
  );
}

async function runCase(definition, { record = true } = {}) {
  const before = await readState(definition.sessionId);
  const signer = identities[definition.signer];
  const xdr = build(signer, definition.args);
  const sibling = definition.footprintArgs ? build(signer, definition.footprintArgs) : xdr;
  const simulation = await simulate(sibling);
  if (simulation.error) {
    throw new Error(`${definition.name}: footprint simulation failed: ${simulation.error.split("\n")[0]}`);
  }
  const signed = signTransaction(
    assembleTransaction(xdr, simulation, { includeAuth: definition.includeAuth === true, redact: redactions }),
    signer,
  );

  if (definition.submitAfterLedger !== undefined) {
    const current = await latestLedger();
    if (current > definition.submitAfterLedger) {
      return { skipped: true };
    }
    await waitForLedger(definition.submitAfterLedger);
  }
  const receipt = await submitSigned(signed, { redact: redactions });
  const transactionHash = receipt.transactionHash;
  const after = await readState(definition.sessionId);

  const entry = {
    name: definition.name,
    issue: definition.issue,
    sessionId: definition.sessionId,
    operation: definition.operation,
    invokedBy: actors[definition.signer],
    arguments: definition.arguments,
    expiresAtLedger: definition.expiresAtLedger,
    expected: definition.expected,
    recordedOn: "ledger",
    transactionHash,
    before,
    after,
  };
  const outcome = receipt.status === "SUCCESS" ? "success" : "failure";
  console.log(
    `${definition.name}: ${outcome}${receipt.hostError ? ` ${receipt.hostError}` : ""} at ledger ${receipt.ledger} (${transactionHash})`,
  );
  if (record) {
    cases.push(entry);
  }
  // Ledger, timestamp, and outcome are published from the receipt by the generator, not from here.
  return { entry, ledger: receipt.ledger, skipped: false };
}

async function createSession(label, maxAmount, expiresAtLedger) {
  const resourceHash = Buffer.from(`lumenbazaar-smoke-${label}`).toString("hex").padEnd(64, "0").slice(0, 64);
  const { stdout } = await setup(`create_${label}`, null, () =>
    invoke(contractId, identities.buyer, [
      "create_session",
      "--buyer",
      actors.buyer,
      "--seller",
      actors.seller,
      "--asset",
      asset.contractId,
      "--max_amount",
      maxAmount,
      "--expires_at_ledger",
      String(expiresAtLedger),
      "--resource_hash",
      resourceHash,
    ]),
  );
  const sessionId = JSON.parse(stdout);
  setupTransactions[setupTransactions.length - 1].sessionId = sessionId;
  const session = { label, sessionId, expiresAtLedger };
  if (label.startsWith("settlement_")) openTimedSessions.push(session);
  return session;
}

async function setup(name, sessionId, submit) {
  const result = submit();
  if (!result.transactionHash) {
    throw new Error(`${name} returned no transaction hash.`);
  }
  const receipt = await recordReceipt(result.transactionHash);
  if (receipt.status !== "SUCCESS") {
    throw new Error(`${name} failed on ledger.`);
  }
  setupTransactions.push({ name, ...(sessionId ? { sessionId } : {}), transactionHash: result.transactionHash });
  console.log(`${name}: success at ledger ${receipt.ledger}`);
  return result;
}

async function readState(sessionId) {
  const read = async (id, args) => {
    const { stdout } = await execFileAsync(
      "stellar",
      ["contract", "invoke", "--id", id, "--source-account", actors.buyer, "--network", "testnet", "--send", "no", "--", ...args],
      { cwd: repoRoot },
    );
    return JSON.parse(stdout.trim());
  };
  const balance = (account) => read(asset.contractId, ["balance", "--id", account]).then(String);
  const [session, buyer, seller, wrongSeller, wrongBuyer, escrowContract, liability] = await Promise.all([
    sessionId ? read(contractId, ["get_session", "--session_id", sessionId]) : null,
    balance(actors.buyer),
    balance(actors.seller),
    balance(actors.wrongSeller),
    balance(actors.wrongBuyer),
    balance(contractId),
    read(contractId, ["get_escrow_liability", "--asset", asset.contractId]).then(String),
  ]);
  return {
    session: session
      ? {
          status: sessionStatus(session.status),
          maxAmount: String(session.max_amount),
          escrowedAmount: String(session.escrowed_amount),
          settledAmount: String(session.settled_amount),
        }
      : null,
    balances: { buyer, seller, wrongSeller, wrongBuyer, escrowContract },
    liability,
  };
}

function sessionStatus(status) {
  if (typeof status === "string") return status;
  if (Array.isArray(status)) return String(status[0]);
  return Object.keys(status ?? {})[0] ?? "Unknown";
}

function build(identity, args) {
  return stellar([
    "contract",
    "invoke",
    "--id",
    contractId,
    "--source-account",
    identity,
    "--network",
    "testnet",
    "--build-only",
    "--",
    ...args,
  ], undefined, redactions);
}

function invoke(id, identity, args) {
  return invokeContractTransaction({ contractId: id, source: identity, args, redact: redactions });
}

function settleArgs(sessionId, amount) {
  return ["settle", "--session_id", sessionId, "--actual_amount", amount, "--usage_hash", usageHash];
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to a funded local testnet identity.`);
  return value;
}

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? null : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value.replaceAll("\\", "/");
}
