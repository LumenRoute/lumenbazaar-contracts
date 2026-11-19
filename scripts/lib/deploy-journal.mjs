import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./atomic-manifest.mjs";
import { testnetNetwork } from "./deployment-evidence.mjs";

export const JOURNAL_SCHEMA_VERSION = 1;

const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID_PATTERN = /^G[A-Z2-7]{55}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export class DeployJournalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeployJournalError";
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateDeployJournal(journal) {
  if (!isPlainObject(journal)) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", "Deployment journal must be a JSON object.");
  }
  if (journal.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    throw new DeployJournalError(
      "CORRUPTED_JOURNAL",
      `Unsupported deployment journal schemaVersion ${JSON.stringify(journal.schemaVersion)}; expected ${JOURNAL_SCHEMA_VERSION}.`,
    );
  }
  if (journal.network !== "testnet") {
    throw new DeployJournalError(
      "NETWORK_MISMATCH",
      `Deployment journal network is ${JSON.stringify(journal.network)}; only "testnet" is supported.`,
    );
  }
  if (journal.networkPassphrase !== testnetNetwork.passphrase) {
    throw new DeployJournalError(
      "NETWORK_MISMATCH",
      "Deployment journal networkPassphrase does not match Stellar testnet.",
    );
  }
  if (typeof journal.sourceCommit !== "string" || !COMMIT_PATTERN.test(journal.sourceCommit)) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", "Deployment journal sourceCommit must be a 40-char lowercase hex SHA.");
  }
  if (typeof journal.deployer !== "string" || !ACCOUNT_ID_PATTERN.test(journal.deployer)) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", "Deployment journal deployer must be a valid G-address.");
  }
  if (
    !Array.isArray(journal.selectedContracts) ||
    journal.selectedContracts.length === 0 ||
    !journal.selectedContracts.every((name) => typeof name === "string" && name.length > 0)
  ) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", "Deployment journal selectedContracts must be a non-empty array of contract names.");
  }
  if (journal.status !== "in-progress" && journal.status !== "completed") {
    throw new DeployJournalError(
      "CORRUPTED_JOURNAL",
      `Deployment journal status must be "in-progress" or "completed", got ${JSON.stringify(journal.status)}.`,
    );
  }
  if (!isPlainObject(journal.steps)) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", 'Deployment journal "steps" field must be an object.');
  }

  for (const [name, step] of Object.entries(journal.steps)) {
    if (!isPlainObject(step)) {
      throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" must be an object.`);
    }
    if (step.name !== name) {
      throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has mismatched name field.`);
    }
    if (typeof step.artifactSha256 !== "string" || !HASH_PATTERN.test(step.artifactSha256)) {
      throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid artifactSha256.`);
    }
    if (typeof step.interfaceSha256 !== "string" || !HASH_PATTERN.test(step.interfaceSha256)) {
      throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid interfaceSha256.`);
    }
    if (step.upload !== undefined) {
      if (!isPlainObject(step.upload) || step.upload.status !== "completed") {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid upload record.`);
      }
      if (typeof step.upload.wasmHash !== "string" || !HASH_PATTERN.test(step.upload.wasmHash)) {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid upload.wasmHash.`);
      }
      if (
        typeof step.upload.transactionHash !== "string" ||
        !HASH_PATTERN.test(step.upload.transactionHash)
      ) {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid upload.transactionHash.`);
      }
    }
    if (step.deploy !== undefined) {
      if (!step.upload || step.upload.status !== "completed") {
        throw new DeployJournalError(
          "CORRUPTED_JOURNAL",
          `Journal step "${name}" records a completed deploy without a completed upload.`,
        );
      }
      if (!isPlainObject(step.deploy) || step.deploy.status !== "completed") {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid deploy record.`);
      }
      if (
        typeof step.deploy.contractId !== "string" ||
        !CONTRACT_ID_PATTERN.test(step.deploy.contractId)
      ) {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid deploy.contractId.`);
      }
      if (
        typeof step.deploy.transactionHash !== "string" ||
        !HASH_PATTERN.test(step.deploy.transactionHash)
      ) {
        throw new DeployJournalError("CORRUPTED_JOURNAL", `Journal step "${name}" has invalid deploy.transactionHash.`);
      }
    }
  }
}

export function readDeployJournal(journalPath) {
  if (!existsSync(journalPath)) {
    return null;
  }
  let raw;
  try {
    raw = readFileSync(journalPath, "utf8");
  } catch (err) {
    throw new DeployJournalError("CORRUPTED_JOURNAL", `Failed to read deployment journal at ${journalPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DeployJournalError(
      "CORRUPTED_JOURNAL",
      `Corrupted JSON in deployment journal at ${journalPath}: ${err.message}`,
    );
  }
  validateDeployJournal(parsed);
  return parsed;
}

export function writeDeployJournal(journalPath, journal, options = {}) {
  const updated = {
    ...journal,
    updatedAt: new Date().toISOString(),
  };
  return writeJsonAtomic(journalPath, updated, {
    ...options,
    validate: validateDeployJournal,
    checkSecrets: true,
  });
}

function assertValidTestnetReceipt(receipt, { transactionHash, expectedSource, contractName, operation }) {
  if (!isPlainObject(receipt)) {
    throw new DeployJournalError(
      "RECEIPT_VERIFICATION_FAILED",
      `Recorded ${operation} transaction for ${contractName} could not be verified: receipt is missing.`,
    );
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.network !== "testnet" ||
    receipt.networkPassphrase !== testnetNetwork.passphrase ||
    receipt.transactionHash !== transactionHash
  ) {
    throw new DeployJournalError(
      "RECEIPT_VERIFICATION_FAILED",
      `Recorded ${operation} receipt for ${contractName} does not match testnet transaction ${transactionHash}.`,
    );
  }
  if (receipt.status !== "SUCCESS") {
    throw new DeployJournalError(
      "RECEIPT_VERIFICATION_FAILED",
      `Recorded ${operation} transaction for ${contractName} did not succeed (status: ${receipt.status}).`,
    );
  }
  if (receipt.sourceAccount !== expectedSource) {
    throw new DeployJournalError(
      "RECEIPT_VERIFICATION_FAILED",
      `Recorded ${operation} transaction for ${contractName} was signed by ${receipt.sourceAccount}, expected ${expectedSource}.`,
    );
  }
}

export async function verifyRecordedStep(
  step,
  {
    contract,
    currentArtifactSha256,
    currentInterfaceSha256,
    deployer,
    verifyReceipt,
    verifyContractWasmHash,
  },
) {
  if (step.artifactSha256 !== currentArtifactSha256) {
    throw new DeployJournalError(
      "HASH_MISMATCH",
      `Artifact SHA-256 mismatch for ${contract.name}: journal recorded ${step.artifactSha256}, current build is ${currentArtifactSha256}.`,
    );
  }
  if (step.interfaceSha256 !== currentInterfaceSha256) {
    throw new DeployJournalError(
      "HASH_MISMATCH",
      `Interface SHA-256 mismatch for ${contract.name}: journal recorded ${step.interfaceSha256}, current build is ${currentInterfaceSha256}.`,
    );
  }

  let skipUpload = false;
  let skipDeploy = false;

  if (step.upload?.status === "completed") {
    if (step.upload.wasmHash !== currentArtifactSha256) {
      throw new DeployJournalError(
        "HASH_MISMATCH",
        `Uploaded WASM hash mismatch for ${contract.name}: journal recorded ${step.upload.wasmHash}, current build is ${currentArtifactSha256}.`,
      );
    }
    const uploadReceipt = await verifyReceipt(step.upload.transactionHash, {
      contractName: contract.name,
      operation: "upload",
      expectedSource: deployer,
    });
    assertValidTestnetReceipt(uploadReceipt, {
      transactionHash: step.upload.transactionHash,
      expectedSource: deployer,
      contractName: contract.name,
      operation: "upload",
    });
    skipUpload = true;
  }

  if (step.deploy?.status === "completed") {
    const deployReceipt = await verifyReceipt(step.deploy.transactionHash, {
      contractName: contract.name,
      operation: "deploy",
      expectedSource: deployer,
    });
    assertValidTestnetReceipt(deployReceipt, {
      transactionHash: step.deploy.transactionHash,
      expectedSource: deployer,
      contractName: contract.name,
      operation: "deploy",
    });

    const onChainWasmHash = await verifyContractWasmHash(step.deploy.contractId, {
      contractName: contract.name,
      expectedWasmHash: currentArtifactSha256,
    });
    if (typeof onChainWasmHash !== "string" || onChainWasmHash !== currentArtifactSha256) {
      throw new DeployJournalError(
        "CONTRACT_VERIFICATION_FAILED",
        `On-chain WASM hash mismatch for ${contract.name} (${step.deploy.contractId}): expected ${currentArtifactSha256}, got ${JSON.stringify(onChainWasmHash)}.`,
      );
    }
    skipDeploy = true;
  }

  return { skipUpload, skipDeploy };
}

/**
 * Orchestrates a testnet multi-contract deployment with an atomic journal and verified resume mode.
 *
 * When `resume` is true, every previously recorded step is verified (network, source commit,
 * deployer, artifact/interface hashes, transaction receipts, and on-chain contract WASM hash)
 * BEFORE any subsequent submission occurs.
 */
export async function runResumableDeployment({
  selected,
  resume = false,
  dryRun = false,
  network = "testnet",
  journalPath,
  manifestPath,
  sourceCommit,
  deployer,
  toolchain = {},
  readArtifactSha256,
  readInterfaceSha256,
  uploadContract,
  deployContract,
  recordReceipt,
  verifyReceipt,
  verifyContractWasmHash,
  readAssetMetadata,
  writeManifest,
  log = console.log,
}) {
  if (network !== "testnet") {
    throw new DeployJournalError(
      "NETWORK_MISMATCH",
      `Unsupported network ${JSON.stringify(network)}; resumable deployment only supports "testnet".`,
    );
  }
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new DeployJournalError("INVALID_SELECTION", "At least one contract must be selected for deployment.");
  }

  const selectedNames = selected.map((c) => c.name);
  const stats = {
    uploaded: [],
    deployed: [],
    skippedUploads: [],
    skippedDeploys: [],
  };

  if (dryRun) {
    const contracts = {};
    for (const contract of selected) {
      const upload = await uploadContract(contract, { dryRun: true });
      const deployed = await deployContract(contract, { wasmHash: upload.wasmHash, dryRun: true });
      contracts[contract.name] = {
        name: contract.name,
        alias: contract.alias,
        network: "testnet",
        wasm: contract.wasm,
        contractId: deployed.contractId,
        artifactSha256: "dry-run",
        wasmHash: upload.wasmHash,
        interfaceSha256: "dry-run",
        upload: { transactionHash: upload.transactionHash, wasmHash: upload.wasmHash },
        deploy: { transactionHash: deployed.transactionHash },
      };
    }
    const manifest = {
      network: "testnet",
      sourceCommit: "dry-run",
      deployer,
      toolchain: {},
      contracts,
    };
    writeManifest(manifestPath, manifest, { dryRun: true });
    return { manifest, journal: null, stats };
  }

  // Compute current local artifact and interface hashes upfront for all selected contracts.
  const currentHashes = new Map();
  for (const contract of selected) {
    const artifactSha256 = readArtifactSha256(contract);
    const interfaceSha256 = readInterfaceSha256(contract);
    currentHashes.set(contract.name, { artifactSha256, interfaceSha256 });
  }

  let journal;
  const skipPlan = new Map();

  if (resume) {
    journal = readDeployJournal(journalPath);
    if (!journal) {
      throw new DeployJournalError(
        "MISSING_JOURNAL",
        `Cannot resume: deployment journal not found at ${journalPath}.`,
      );
    }
    if (journal.sourceCommit !== sourceCommit) {
      throw new DeployJournalError(
        "CONTEXT_MISMATCH",
        `Source commit mismatch: journal recorded ${journal.sourceCommit}, current HEAD is ${sourceCommit}.`,
      );
    }
    if (journal.deployer !== deployer) {
      throw new DeployJournalError(
        "CONTEXT_MISMATCH",
        `Deployer mismatch: journal recorded ${journal.deployer}, current deployer is ${deployer}.`,
      );
    }
    if (
      journal.selectedContracts.length !== selectedNames.length ||
      journal.selectedContracts.some((name, idx) => name !== selectedNames[idx])
    ) {
      throw new DeployJournalError(
        "CONTEXT_MISMATCH",
        `Selected contracts mismatch: journal recorded [${journal.selectedContracts.join(", ")}], requested [${selectedNames.join(", ")}].`,
      );
    }

    // Verify ALL recorded steps before performing ANY new submission.
    for (const contract of selected) {
      const existingStep = journal.steps[contract.name];
      if (!existingStep) {
        skipPlan.set(contract.name, { skipUpload: false, skipDeploy: false });
        continue;
      }
      const { artifactSha256, interfaceSha256 } = currentHashes.get(contract.name);
      const decision = await verifyRecordedStep(existingStep, {
        contract,
        currentArtifactSha256: artifactSha256,
        currentInterfaceSha256: interfaceSha256,
        deployer,
        verifyReceipt,
        verifyContractWasmHash,
      });
      skipPlan.set(contract.name, decision);
    }
  } else {
    const existing = readDeployJournal(journalPath);
    if (existing && existing.status === "in-progress") {
      throw new DeployJournalError(
        "INCOMPLETE_JOURNAL_EXISTS",
        `An in-progress deployment journal already exists at ${journalPath}. Run with --resume to continue or remove the stale journal before starting a fresh deployment.`,
      );
    }
    journal = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      network: "testnet",
      networkPassphrase: testnetNetwork.passphrase,
      sourceCommit,
      deployer,
      selectedContracts: selectedNames,
      status: "in-progress",
      steps: {},
    };
    writeDeployJournal(journalPath, journal);
    for (const contract of selected) {
      skipPlan.set(contract.name, { skipUpload: false, skipDeploy: false });
    }
  }

  const contracts = {};

  for (const contract of selected) {
    const { artifactSha256, interfaceSha256 } = currentHashes.get(contract.name);
    const { skipUpload, skipDeploy } = skipPlan.get(contract.name);
    const step = journal.steps[contract.name] ?? {
      name: contract.name,
      alias: contract.alias,
      wasm: contract.wasm,
      artifactSha256,
      interfaceSha256,
    };

    let uploadRecord;
    if (skipUpload) {
      uploadRecord = step.upload;
      stats.skippedUploads.push(contract.name);
      log(`resumed ${contract.name}: verified completed upload (${uploadRecord.transactionHash})`);
    } else {
      const upload = await uploadContract(contract, { artifactSha256, dryRun: false });
      if (upload.wasmHash !== artifactSha256) {
        throw new DeployJournalError(
          "HASH_MISMATCH",
          `Uploaded WASM hash for ${contract.name} differs from the local artifact.`,
        );
      }
      await recordReceipt(upload.transactionHash);
      uploadRecord = {
        status: "completed",
        wasmHash: upload.wasmHash,
        transactionHash: upload.transactionHash,
      };
      step.upload = uploadRecord;
      journal.steps[contract.name] = step;
      journal.status = "in-progress";
      writeDeployJournal(journalPath, journal);
      stats.uploaded.push(contract.name);
    }

    let deployRecord;
    if (skipDeploy) {
      deployRecord = step.deploy;
      stats.skippedDeploys.push(contract.name);
      log(`resumed ${contract.name}: verified completed deploy (${deployRecord.contractId})`);
    } else {
      const deployed = await deployContract(contract, {
        wasmHash: uploadRecord.wasmHash,
        dryRun: false,
      });
      await recordReceipt(deployed.transactionHash);
      deployRecord = {
        status: "completed",
        contractId: deployed.contractId,
        transactionHash: deployed.transactionHash,
      };
      step.deploy = deployRecord;
      if (contract.name === "test-token" && typeof readAssetMetadata === "function") {
        step.asset = await readAssetMetadata(deployed.contractId);
      }
      journal.steps[contract.name] = step;
      journal.status = "in-progress";
      writeDeployJournal(journalPath, journal);
      stats.deployed.push(contract.name);
      log(`deployed ${contract.name}: ${deployed.contractId}`);
    }

    const entry = {
      name: contract.name,
      alias: contract.alias,
      network: "testnet",
      wasm: contract.wasm,
      contractId: deployRecord.contractId,
      artifactSha256,
      wasmHash: uploadRecord.wasmHash,
      interfaceSha256,
      upload: {
        transactionHash: uploadRecord.transactionHash,
        wasmHash: uploadRecord.wasmHash,
      },
      deploy: {
        transactionHash: deployRecord.transactionHash,
      },
    };
    if (contract.name === "test-token") {
      entry.asset = step.asset ?? (typeof readAssetMetadata === "function" ? await readAssetMetadata(deployRecord.contractId) : undefined);
    }
    contracts[contract.name] = entry;
  }

  const manifest = {
    network: "testnet",
    sourceCommit,
    deployer,
    toolchain,
    contracts,
  };
  writeManifest(manifestPath, manifest, { dryRun: false });

  journal.status = "completed";
  writeDeployJournal(journalPath, journal);

  return { manifest, journal, stats };
}
