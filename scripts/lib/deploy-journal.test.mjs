import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DeployJournalError,
  readDeployJournal,
  runResumableDeployment,
} from "./deploy-journal.mjs";
import { testnetNetwork } from "./deployment-evidence.mjs";
import { readManifest, writeManifest } from "./stellar-cli.mjs";

const DEPLOYER = "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ";
const OTHER_DEPLOYER = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const SOURCE_COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);

const CONTRACTS = [
  {
    name: "upto-session",
    alias: "lumenbazaar-upto-session-testnet",
    wasm: "target/wasm32v1-none/release/upto_session.wasm",
    artifactSha256: "1".repeat(64),
    interfaceSha256: "2".repeat(64),
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    uploadTx: "a1".repeat(32),
    deployTx: "b1".repeat(32),
  },
  {
    name: "test-token",
    alias: "lumenbazaar-test-token-testnet",
    wasm: "target/wasm32v1-none/release/test_token.wasm",
    artifactSha256: "3".repeat(64),
    interfaceSha256: "4".repeat(64),
    contractId: "CDA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4CFV6",
    uploadTx: "a2".repeat(32),
    deployTx: "b2".repeat(32),
  },
  {
    name: "policy-wallet-example",
    alias: "lumenbazaar-policy-wallet-testnet",
    wasm: "target/wasm32v1-none/release/policy_wallet_example.wasm",
    artifactSha256: "5".repeat(64),
    interfaceSha256: "6".repeat(64),
    contractId: "CCS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LSSM",
    uploadTx: "a3".repeat(32),
    deployTx: "b3".repeat(32),
  },
];

function makeHarness(dir, overrides = {}) {
  const journalPath = join(dir, "testnet.deploy-journal.json");
  const manifestPath = join(dir, "testnet.json");
  const receipts = new Map();
  const onChainHashes = new Map();
  const calls = { uploads: [], deploys: [] };

  const byName = new Map(CONTRACTS.map((c) => [c.name, c]));

  const makeReceipt = (txHash, sourceAccount = DEPLOYER, status = "SUCCESS") => ({
    schemaVersion: 1,
    network: "testnet",
    networkPassphrase: testnetNetwork.passphrase,
    transactionHash: txHash,
    status,
    ledger: 123456,
    createdAt: "2026-10-20T00:00:00Z",
    sourceAccount,
  });

  const options = {
    selected: CONTRACTS.map(({ name, alias, wasm }) => ({ name, alias, wasm })),
    resume: false,
    dryRun: false,
    network: "testnet",
    journalPath,
    manifestPath,
    sourceCommit: SOURCE_COMMIT,
    deployer: DEPLOYER,
    toolchain: { rustc: "1.93.1", stellarCli: "28.0.0", target: "wasm32v1-none" },
    readArtifactSha256: (c) => byName.get(c.name).artifactSha256,
    readInterfaceSha256: (c) => byName.get(c.name).interfaceSha256,
    uploadContract: async (c) => {
      calls.uploads.push(c.name);
      const spec = byName.get(c.name);
      return { wasmHash: spec.artifactSha256, transactionHash: spec.uploadTx, skipped: false };
    },
    deployContract: async (c, { wasmHash }) => {
      calls.deploys.push(c.name);
      const spec = byName.get(c.name);
      onChainHashes.set(spec.contractId, wasmHash);
      return { contractId: spec.contractId, transactionHash: spec.deployTx };
    },
    recordReceipt: async (txHash) => {
      const r = makeReceipt(txHash);
      receipts.set(txHash, r);
      return r;
    },
    verifyReceipt: async (txHash) => receipts.get(txHash) ?? null,
    verifyContractWasmHash: async (contractId) => onChainHashes.get(contractId) ?? null,
    readAssetMetadata: async () => ({
      code: "LBT",
      decimals: 7,
      purpose: "Custom test-only token; not USDC",
    }),
    writeManifest,
    log: () => {},
    ...overrides,
  };

  return { journalPath, manifestPath, receipts, onChainHashes, calls, options, makeReceipt };
}

test("fresh deployment writes checkpoints, manifest, and marks journal completed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-journal-fresh-"));
  try {
    const h = makeHarness(dir);
    const result = await runResumableDeployment(h.options);

    assert.deepEqual(h.calls.uploads, ["upto-session", "test-token", "policy-wallet-example"]);
    assert.deepEqual(h.calls.deploys, ["upto-session", "test-token", "policy-wallet-example"]);
    assert.deepEqual(result.stats.skippedUploads, []);
    assert.deepEqual(result.stats.skippedDeploys, []);

    const journal = readDeployJournal(h.journalPath);
    assert.equal(journal.status, "completed");
    assert.equal(journal.steps["upto-session"].deploy.contractId, CONTRACTS[0].contractId);

    const manifest = readManifest(h.manifestPath);
    assert.equal(manifest.contracts["upto-session"].contractId, CONTRACTS[0].contractId);
    assert.equal(manifest.contracts["test-token"].asset.code, "LBT");
    assert.equal(manifest.contracts["policy-wallet-example"].contractId, CONTRACTS[2].contractId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted deployment resumes without redeploying verified completed steps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-journal-interrupted-"));
  try {
    const h = makeHarness(dir, {
      deployContract: async (c, { wasmHash }) => {
        if (c.name === "test-token") {
          throw new Error("Simulated network outage during test-token deploy");
        }
        h.calls.deploys.push(c.name);
        const spec = CONTRACTS.find((x) => x.name === c.name);
        h.onChainHashes.set(spec.contractId, wasmHash);
        return { contractId: spec.contractId, transactionHash: spec.deployTx };
      },
    });

    await assert.rejects(() => runResumableDeployment(h.options), /Simulated network outage/);
    assert.deepEqual(h.calls.uploads, ["upto-session", "test-token"]);
    assert.deepEqual(h.calls.deploys, ["upto-session"]);

    const midJournal = readDeployJournal(h.journalPath);
    assert.equal(midJournal.status, "in-progress");
    assert.equal(midJournal.steps["upto-session"].deploy.status, "completed");
    assert.equal(midJournal.steps["test-token"].upload.status, "completed");
    assert.equal(midJournal.steps["test-token"].deploy, undefined);

    // Starting a fresh run without --resume fails closed while an in-progress journal exists.
    await assert.rejects(
      () => runResumableDeployment({ ...h.options, resume: false }),
      (err) => err instanceof DeployJournalError && err.code === "INCOMPLETE_JOURNAL_EXISTS",
    );

    // Resume: must NOT re-upload upto-session or test-token, and must NOT redeploy upto-session.
    h.calls.uploads.length = 0;
    h.calls.deploys.length = 0;
    const resumed = await runResumableDeployment({
      ...h.options,
      resume: true,
      deployContract: async (c, { wasmHash }) => {
        h.calls.deploys.push(c.name);
        const spec = CONTRACTS.find((x) => x.name === c.name);
        h.onChainHashes.set(spec.contractId, wasmHash);
        return { contractId: spec.contractId, transactionHash: spec.deployTx };
      },
    });

    assert.deepEqual(h.calls.uploads, ["policy-wallet-example"]);
    assert.deepEqual(h.calls.deploys, ["test-token", "policy-wallet-example"]);
    assert.deepEqual(resumed.stats.skippedUploads, ["upto-session", "test-token"]);
    assert.deepEqual(resumed.stats.skippedDeploys, ["upto-session"]);

    const completedJournal = readDeployJournal(h.journalPath);
    assert.equal(completedJournal.status, "completed");
    const manifest = readManifest(h.manifestPath);
    assert.equal(Object.keys(manifest.contracts).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resuming a completed journal verifies all steps and performs zero submissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-journal-completed-"));
  try {
    const h = makeHarness(dir);
    await runResumableDeployment(h.options);

    h.calls.uploads.length = 0;
    h.calls.deploys.length = 0;
    const resumed = await runResumableDeployment({ ...h.options, resume: true });

    assert.deepEqual(h.calls.uploads, []);
    assert.deepEqual(h.calls.deploys, []);
    assert.deepEqual(resumed.stats.skippedUploads, [
      "upto-session",
      "test-token",
      "policy-wallet-example",
    ]);
    assert.deepEqual(resumed.stats.skippedDeploys, [
      "upto-session",
      "test-token",
      "policy-wallet-example",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupted journals fail closed before any submission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-journal-corrupt-"));
  try {
    const h = makeHarness(dir);

    const corruptPayloads = [
      "{ truncated json",
      JSON.stringify({ schemaVersion: 99, network: "testnet" }),
      JSON.stringify({
        schemaVersion: 1,
        network: "testnet",
        networkPassphrase: testnetNetwork.passphrase,
        sourceCommit: SOURCE_COMMIT,
        deployer: DEPLOYER,
        selectedContracts: ["upto-session"],
        status: "in-progress",
        steps: {
          "upto-session": {
            name: "upto-session",
            artifactSha256: "1".repeat(64),
            interfaceSha256: "2".repeat(64),
            // Deploy without upload is invalid.
            deploy: {
              status: "completed",
              contractId: CONTRACTS[0].contractId,
              transactionHash: CONTRACTS[0].deployTx,
            },
          },
        },
      }),
    ];

    for (const payload of corruptPayloads) {
      writeFileSync(h.journalPath, payload, "utf8");
      await assert.rejects(
        () => runResumableDeployment({ ...h.options, resume: true }),
        (err) => err instanceof DeployJournalError && err.code === "CORRUPTED_JOURNAL",
      );
      assert.deepEqual(h.calls.uploads, []);
      assert.deepEqual(h.calls.deploys, []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mismatches in network, commit, deployer, artifact hash, on-chain hash, or receipt stop before any submission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-journal-mismatch-"));
  try {
    const h = makeHarness(dir, {
      deployContract: async (c, { wasmHash }) => {
        if (c.name === "test-token") {
          throw new Error("stop after first contract");
        }
        h.calls.deploys.push(c.name);
        const spec = CONTRACTS.find((x) => x.name === c.name);
        h.onChainHashes.set(spec.contractId, wasmHash);
        return { contractId: spec.contractId, transactionHash: spec.deployTx };
      },
    });
    await assert.rejects(() => runResumableDeployment(h.options), /stop after first contract/);
    h.calls.uploads.length = 0;
    h.calls.deploys.length = 0;

    // 1. Wrong network.
    await assert.rejects(
      () => runResumableDeployment({ ...h.options, resume: true, network: "mainnet" }),
      (err) => err instanceof DeployJournalError && err.code === "NETWORK_MISMATCH",
    );

    // 2. Source commit mismatch.
    await assert.rejects(
      () => runResumableDeployment({ ...h.options, resume: true, sourceCommit: OTHER_COMMIT }),
      (err) => err instanceof DeployJournalError && err.code === "CONTEXT_MISMATCH",
    );

    // 3. Deployer mismatch.
    await assert.rejects(
      () => runResumableDeployment({ ...h.options, resume: true, deployer: OTHER_DEPLOYER }),
      (err) => err instanceof DeployJournalError && err.code === "CONTEXT_MISMATCH",
    );

    // 4. Local artifact SHA-256 mismatch.
    await assert.rejects(
      () =>
        runResumableDeployment({
          ...h.options,
          resume: true,
          readArtifactSha256: (c) => (c.name === "upto-session" ? "f".repeat(64) : CONTRACTS.find((x) => x.name === c.name).artifactSha256),
        }),
      (err) => err instanceof DeployJournalError && err.code === "HASH_MISMATCH",
    );

    // 5. On-chain contract WASM hash mismatch.
    await assert.rejects(
      () =>
        runResumableDeployment({
          ...h.options,
          resume: true,
          verifyContractWasmHash: async () => "e".repeat(64),
        }),
      (err) => err instanceof DeployJournalError && err.code === "CONTRACT_VERIFICATION_FAILED",
    );

    // 6. Unverifiable / failed receipt.
    await assert.rejects(
      () =>
        runResumableDeployment({
          ...h.options,
          resume: true,
          verifyReceipt: async () => null,
        }),
      (err) => err instanceof DeployJournalError && err.code === "RECEIPT_VERIFICATION_FAILED",
    );

    // 7. Wrong-signer receipt.
    await assert.rejects(
      () =>
        runResumableDeployment({
          ...h.options,
          resume: true,
          verifyReceipt: async (tx) => h.makeReceipt(tx, OTHER_DEPLOYER, "SUCCESS"),
        }),
      (err) => err instanceof DeployJournalError && err.code === "RECEIPT_VERIFICATION_FAILED",
    );

    // Zero submissions occurred across all mismatch checks.
    assert.deepEqual(h.calls.uploads, []);
    assert.deepEqual(h.calls.deploys, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
