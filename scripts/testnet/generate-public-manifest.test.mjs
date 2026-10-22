import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPublicDeploymentManifest,
  buildPublicLiveEvidence,
  scanForSecrets,
  serializeDeterministic,
} from "../lib/public-manifest.mjs";
import { validateLiveEvidence } from "../lib/deployment-evidence.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const generator = join(repoRoot, "scripts", "testnet", "generate-public-manifest.mjs");
const passphrase = "Test SDF Network ; September 2015";

// Synthetic, format-valid public values. None of these identify a real account.
const account = (letter) => `G${letter.repeat(55)}`;
const contract = (letter) => `C${letter.repeat(55)}`;
const hash = (byte) => byte.repeat(32);
const deployer = account("D");
const admin = account("A");

// Fake secrets are assembled at runtime so committed source never contains them.
const fakeSecrets = {
  "stellar-secret-seed": ["S", "A".repeat(55)].join(""),
  "mnemonic-phrase": Array.from({ length: 12 }, (_, index) => ["abandon", "ability", "able"][index % 3]).join(" "),
  "private-key-hex": ["0x", "ab".repeat(32)].join(""),
  "absolute-local-path:home": ["/ho", "me/operator/notes"].join(""),
  "absolute-local-path:users": ["/Us", "ers/operator/notes"].join(""),
  "absolute-local-path:windows": ["C:", "\\", "Users", "\\", "operator"].join(""),
  "stellar-config-path": ["~/", ".stel", "lar/identity"].join(""),
  "soroban-config-path": ["project/", ".sor", "oban/identity"].join(""),
  "local-identity-alias": ["fixture", "buyer", "identity"].join("-"),
  "xdr-envelope": ["AAAA", "Ag".repeat(60)].join(""),
};

function receipt(transactionHash, sourceAccount, ledger, overrides = {}) {
  return {
    schemaVersion: 1,
    network: "testnet",
    networkPassphrase: passphrase,
    transactionHash,
    status: "SUCCESS",
    ledger,
    createdAt: `2026-10-21T08:${String(ledger % 60).padStart(2, "0")}:00Z`,
    sourceAccount,
    ...overrides,
  };
}

function deploymentFixture() {
  const local = {
    network: "testnet",
    sourceCommit: "a".repeat(40),
    deployer,
    admin,
    toolchain: {
      stellarCli: "28.0.0",
      stellarXdr: "28.0.0",
      rustc: "1.93.1",
      sorobanSdk: "28.0.0",
      target: "wasm32v1-none",
    },
    contracts: {},
    generatedAt: "2026-10-21T08:00:00.000Z",
  };
  const receipts = new Map();
  let ledger = 100;
  for (const [name, letter, wasmByte] of [
    ["upto-session", "U", "11"],
    ["test-token", "T", "22"],
  ]) {
    const entry = {
      name,
      alias: `local-${name}-contract-alias`,
      network: "testnet",
      wasm: `target/wasm32v1-none/release/${name}.wasm`,
      contractId: contract(letter),
      artifactSha256: hash(wasmByte),
      wasmHash: hash(wasmByte),
      interfaceSha256: hash(wasmByte === "11" ? "33" : "44"),
    };
    for (const [operation, byte] of [
      ["upload", "a"],
      ["deploy", "b"],
      ["initialize", "c"],
    ]) {
      const transactionHash = hash(`${byte}${wasmByte[0]}`);
      entry[operation] = operation === "upload" ? { transactionHash, wasmHash: hash(wasmByte) } : { transactionHash };
      ledger += 1;
      receipts.set(transactionHash, receipt(transactionHash, operation === "initialize" ? admin : deployer, ledger));
    }
    local.contracts[name] = entry;
  }
  local.contracts["test-token"].asset = { code: "LBT", decimals: 7, purpose: "Custom test-only token; not USDC" };
  return { local, receipts };
}

function writeInputs(local, receipts) {
  const root = mkdtempSync(join(tmpdir(), "lumenbazaar-manifest-"));
  const receiptDir = join(root, "receipts");
  const outputDir = join(root, "out");
  mkdirSync(receiptDir);
  mkdirSync(outputDir);
  writeFileSync(join(root, "local.json"), JSON.stringify(local));
  for (const [transactionHash, value] of receipts) {
    writeFileSync(join(receiptDir, `${transactionHash}.json`), JSON.stringify(value));
  }
  return { root, receiptDir, outputDir, input: join(root, "local.json") };
}

function runGenerator(paths, extra = []) {
  return spawnSync(
    process.execPath,
    [generator, "--input", paths.input, "--receipts", paths.receiptDir, "--output-dir", paths.outputDir, ...extra],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("generation is byte-for-byte deterministic", () => {
  const first = deploymentFixture();
  const second = deploymentFixture();
  const left = serializeDeterministic(buildPublicDeploymentManifest(first.local, first.receipts).document);
  const right = serializeDeterministic(buildPublicDeploymentManifest(second.local, second.receipts).document);
  assert.equal(left, right);
  assert.ok(left.endsWith("}\n"));

  const paths = writeInputs(first.local, first.receipts);
  try {
    const firstRun = runGenerator(paths);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const [fileName] = readdirSync(paths.outputDir);
    assert.equal(fileName, "testnet-2026-10-21.json");
    const written = readFileSync(join(paths.outputDir, fileName));

    const secondRun = runGenerator(paths);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.match(secondRun.stdout, /unchanged .*byte-identical regeneration/);
    assert.deepEqual(readFileSync(join(paths.outputDir, fileName)), written);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("ledgers and timestamps come from receipts, and local-only fields are dropped and reported", () => {
  const { local, receipts } = deploymentFixture();
  const { document, dropped } = buildPublicDeploymentManifest(local, receipts);
  assert.deepEqual(scanForSecrets(document), []);
  const deploy = document.contracts["upto-session"].deploy;
  assert.equal(deploy.ledger, receipts.get(deploy.transactionHash).ledger);
  assert.equal(deploy.createdAt, receipts.get(deploy.transactionHash).createdAt);
  assert.ok(dropped.includes("contracts.upto-session.alias"));
  assert.ok(dropped.includes("generatedAt"));
  assert.equal(JSON.stringify(document).includes("alias"), false);
  assert.equal("generatedAt" in document, false);
});

for (const [name, secret] of Object.entries(fakeSecrets)) {
  test(`refuses to write when a ${name} is present`, () => {
    const { local, receipts } = deploymentFixture();
    local.localAliases = { buyer: fakeSecrets["local-identity-alias"] };
    local.toolchain.target = secret;
    const paths = writeInputs(local, receipts);
    try {
      const result = runGenerator(paths);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Secret-pattern validation failed: .*\$\.toolchain\.target/);
      assert.equal(result.stderr.includes(secret), false, "the secret value must never be printed");
      assert.equal(result.stdout.includes(secret), false, "the secret value must never be printed");
      assert.deepEqual(readdirSync(paths.outputDir), []);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
}

test("the repository alias naming convention is rejected even when the alias is not configured", () => {
  const findings = scanForSecrets({ note: ["lumenbazaar", "testnet", "buyer"].join("-") });
  assert.deepEqual(findings, [{ path: "$.note", rule: "local-identity-alias" }]);
});

test("public hashes are allowed only in hash fields", () => {
  assert.deepEqual(scanForSecrets({ transactionHash: hash("ab") }), []);
  assert.deepEqual(scanForSecrets({ purpose: hash("ab") }), [{ path: "$.purpose", rule: "private-key-hex" }]);
});

test("unknown input fields fail closed without printing their values", () => {
  const { local, receipts } = deploymentFixture();
  const marker = ["operator", "private", "note"].join("-");
  local.operatorNotes = marker;
  local.contracts["upto-session"].debug = marker;
  const paths = writeInputs(local, receipts);
  try {
    const result = runGenerator(paths);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown fields.*contracts\.upto-session\.debug.*operatorNotes/);
    assert.equal(result.stderr.includes(marker), false);
    assert.deepEqual(readdirSync(paths.outputDir), []);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("a missing network receipt fails closed and writes nothing", () => {
  const { local, receipts } = deploymentFixture();
  receipts.delete(local.contracts["upto-session"].deploy.transactionHash);
  const paths = writeInputs(local, receipts);
  try {
    const result = runGenerator(paths);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing network receipt for contracts\.upto-session\.deploy/);
    assert.deepEqual(readdirSync(paths.outputDir), []);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("unsupported networks, failed deployments, and unexpected signers fail closed", () => {
  const mainnet = deploymentFixture();
  mainnet.local.network = "mainnet";
  assert.throws(() => buildPublicDeploymentManifest(mainnet.local, mainnet.receipts), /Unsupported network/);

  const failed = deploymentFixture();
  const failedHash = failed.local.contracts["test-token"].initialize.transactionHash;
  failed.receipts.set(failedHash, { ...failed.receipts.get(failedHash), status: "FAILED" });
  assert.throws(() => buildPublicDeploymentManifest(failed.local, failed.receipts), /not a successful transaction/);

  const signer = deploymentFixture();
  const signerHash = signer.local.contracts["test-token"].upload.transactionHash;
  signer.receipts.set(signerHash, { ...signer.receipts.get(signerHash), sourceAccount: account("X") });
  assert.throws(() => buildPublicDeploymentManifest(signer.local, signer.receipts), /other than the recorded deployer/);

  const extraReceiptField = deploymentFixture();
  const extraHash = extraReceiptField.local.contracts["test-token"].deploy.transactionHash;
  extraReceiptField.receipts.set(extraHash, { ...extraReceiptField.receipts.get(extraHash), envelopeXdr: "x" });
  assert.throws(
    () => buildPublicDeploymentManifest(extraReceiptField.local, extraReceiptField.receipts),
    /unknown fields: receipt\.envelopeXdr/,
  );
});

test("an unknown --kind is refused", () => {
  const result = spawnSync(process.execPath, [generator, "--kind", "mainnet"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported --kind/);
});

function evidenceFixture() {
  const receipts = new Map();
  const actors = { admin, buyer: account("B"), seller: account("E"), wrongSeller: account("W"), wrongBuyer: account("V") };
  const state = (status = "Open", escrowedAmount = "1000000", settledAmount = "0") => ({
    session: { status, maxAmount: "1000000", escrowedAmount, settledAmount },
    balances: { buyer: "9000000", seller: "0", wrongSeller: "0", wrongBuyer: "0", escrowContract: escrowedAmount },
    liability: escrowedAmount,
  });
  const setupHash = hash("e1");
  receipts.set(setupHash, receipt(setupHash, actors.buyer, 200));
  const ledgerCase = (name, byte, invokedBy, expected, overrides = {}) => {
    const transactionHash = hash(byte);
    const failed = expected.outcome === "failure";
    receipts.set(
      transactionHash,
      receipt(transactionHash, invokedBy, 210, failed ? { status: "FAILED", resultCode: "tx_failed", hostError: expected.error } : {}),
    );
    return {
      name,
      issue: 6,
      sessionId: hash("5a"),
      operation: "settle",
      invokedBy,
      arguments: { actualAmount: "500000", usageHash: hash("e1") },
      expiresAtLedger: 300,
      expected,
      recordedOn: "ledger",
      transactionHash,
      before: state(),
      after: failed ? state() : state("Settled", "0", "500000"),
      ...overrides,
    };
  };
  const failure = (error) => ({ outcome: "failure", error });
  const local = {
    network: "testnet",
    sourceCommit: "b".repeat(40),
    deploymentManifest: "deployments/testnet-2026-10-21.json",
    contractId: contract("U"),
    asset: { contractId: contract("T"), code: "LBT", decimals: 7, purpose: "Custom test-only token; not USDC" },
    actors,
    localAliases: { buyer: "fixture-buyer-alias" },
    setupTransactions: [{ name: "create_session", sessionId: hash("5a"), transactionHash: setupHash }],
    cases: [
      ledgerCase("control_settlement_below_cap", "c1", actors.seller, { outcome: "success", error: null }),
      ledgerCase("wrong_seller_settle", "c2", actors.wrongSeller, failure("Error(Auth, InvalidAction)"), { issue: 5 }),
      ledgerCase("wrong_buyer_cancel", "c3", actors.wrongBuyer, failure("Error(Auth, InvalidAction)"), {
        issue: 5,
        operation: "cancel",
        arguments: {},
      }),
      ledgerCase("over_cap_settlement", "c4", actors.seller, failure("Error(Contract, #8)"), {
        arguments: { actualAmount: "1000001", usageHash: hash("e1") },
      }),
      ledgerCase("settlement_last_valid_ledger", "c5", actors.seller, { outcome: "success", error: null }, {
        expiresAtLedger: 211,
      }),
      {
        name: "settlement_at_expiry_boundary",
        issue: 6,
        sessionId: hash("5b"),
        operation: "settle",
        invokedBy: actors.seller,
        arguments: { actualAmount: "500000", usageHash: hash("e1") },
        expiresAtLedger: 220,
        expected: failure("Error(Contract, #4)"),
        actual: failure("Error(Contract, #4)"),
        recordedOn: "simulation-only",
        transactionHash: null,
        observedAtLedger: 220,
        simulation: { error: "Error(Contract, #4)", latestLedger: 220 },
        before: state(),
        after: state(),
      },
    ],
  };
  return { local, receipts };
}

test("live evidence takes on-ledger outcomes from receipts and labels simulation-only cases", () => {
  const { local, receipts } = evidenceFixture();
  const { document, dropped } = buildPublicLiveEvidence(local, receipts);
  const serialized = serializeDeterministic(document);
  validateLiveEvidence(JSON.parse(serialized), serialized, "fixture");
  assert.deepEqual(scanForSecrets(document), []);
  assert.ok(dropped.includes("localAliases"));
  assert.equal(serialized.includes("fixture-buyer-alias"), false);

  const overCap = document.cases.find((entry) => entry.name === "over_cap_settlement");
  assert.equal(overCap.recordedOn, "ledger");
  assert.equal(overCap.expectedSuccessful, false);
  assert.deepEqual(overCap.actual, { outcome: "failure", error: "Error(Contract, #8)" });
  assert.equal(overCap.stateUnchanged, true);

  const boundary = document.cases.find((entry) => entry.name === "settlement_at_expiry_boundary");
  assert.equal(boundary.transactionHash, null);
  assert.ok(document.limitations.some((line) => line.includes("simulation-only")));
});

test("live evidence refuses a rejected case that moved funds or finalized state", () => {
  const { local, receipts } = evidenceFixture();
  local.cases[3].after = { ...local.cases[3].after, liability: "0" };
  const { document } = buildPublicLiveEvidence(local, receipts);
  const serialized = serializeDeterministic(document);
  assert.throws(() => validateLiveEvidence(JSON.parse(serialized), serialized, "fixture"), /changed balances or session state/);
});

test("live evidence refuses a receipt whose outcome differs from the expected result", () => {
  const { local, receipts } = evidenceFixture();
  const hashOfOverCap = local.cases[3].transactionHash;
  receipts.set(hashOfOverCap, { ...receipts.get(hashOfOverCap), status: "SUCCESS", hostError: undefined });
  const { document } = buildPublicLiveEvidence(local, receipts);
  const serialized = serializeDeterministic(document);
  assert.throws(() => validateLiveEvidence(JSON.parse(serialized), serialized, "fixture"), /did not produce its expected result/);
});

test("committed public evidence still passes the CI checker", () => {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "check-deployment-evidence.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
