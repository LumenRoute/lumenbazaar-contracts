export const testnetNetwork = Object.freeze({
  name: "Test SDF Network",
  passphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
});

export const deploymentManifestPattern = /^testnet-\d{4}-\d{2}-\d{2}\.json$/;
export const liveEvidencePattern = /^live-evidence-\d{4}-\d{2}-\d{2}\.json$/;
export const deploymentOperations = ["upload", "deploy", "initialize"];

const contractIdPattern = /^C[A-Z2-7]{55}$/;
const accountPattern = /^G[A-Z2-7]{55}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const secretPattern = /\bS[A-Z2-7]{55}\b/;
const localPathPattern = /(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/)/;
const liveEvidenceCases = new Set([
  "control_settlement_below_cap",
  "wrong_seller_settle",
  "wrong_buyer_cancel",
  "over_cap_settlement",
  "settlement_last_valid_ledger",
  "settlement_at_expiry_boundary",
]);

export function validateDeploymentManifest(manifest, source, label) {
  validatePublicEnvelope(manifest, source, label);

  if (!accountPattern.test(manifest.deployer)) {
    throw new Error(`${label} contains an invalid deployer account.`);
  }

  if (manifest.schemaVersion >= 2 && !accountPattern.test(manifest.admin)) {
    throw new Error(`${label} contains an invalid admin account.`);
  }

  for (const [name, contract] of Object.entries(manifest.contracts)) {
    if (!contractIdPattern.test(contract.contractId)) {
      throw new Error(`${label} contains an invalid contract ID for ${name}.`);
    }

    if (!hashPattern.test(contract.artifactSha256)) {
      throw new Error(`${label} contains an invalid artifact hash for ${name}.`);
    }

    if (manifest.schemaVersion >= 2) {
      if (contract.wasmHash !== contract.artifactSha256) {
        throw new Error(`${label} has mismatched WASM hashes for ${name}.`);
      }
      if (!hashPattern.test(contract.interfaceSha256)) {
        throw new Error(`${label} contains an invalid interface hash for ${name}.`);
      }
      if (contract.upload?.wasmHash !== contract.wasmHash) {
        throw new Error(`${label} has a mismatched upload hash for ${name}.`);
      }
    }

    for (const operation of deploymentOperations) {
      const evidence = contract[operation];

      if (!hashPattern.test(evidence?.transactionHash ?? "")) {
        throw new Error(`${label} is missing ${operation} transaction hash for ${name}.`);
      }

      if (!Number.isInteger(evidence?.ledger) || evidence.ledger <= 0) {
        throw new Error(`${label} is missing ${operation} ledger for ${name}.`);
      }

      if (Number.isNaN(Date.parse(evidence?.createdAt ?? ""))) {
        throw new Error(`${label} is missing ${operation} timestamp for ${name}.`);
      }
    }
  }
}

export function validateLiveEvidence(evidence, source, label) {
  validatePublicEnvelope(evidence, source, label);

  if (evidence.schemaVersion !== 1 || evidence.kind !== "live-rejection-evidence") {
    throw new Error(`${label} has an unsupported live evidence schema.`);
  }
  if (!deploymentManifestPattern.test(evidence.deploymentManifest?.replace(/^deployments\//, ""))) {
    throw new Error(`${label} does not reference a public deployment manifest.`);
  }
  if (!contractIdPattern.test(evidence.contractId) || !contractIdPattern.test(evidence.asset?.contractId)) {
    throw new Error(`${label} contains an invalid contract or asset ID.`);
  }
  for (const [name, account] of Object.entries(evidence.actors ?? {})) {
    if (!accountPattern.test(account)) {
      throw new Error(`${label} actor ${name} is invalid.`);
    }
  }
  if (evidence.expiryBoundary?.rule !== "ledger.sequence >= expires_at_ledger rejects settle and cancel") {
    throw new Error(`${label} does not state the documented expiry boundary.`);
  }

  for (const operation of evidence.setupTransactions ?? []) {
    validateRecordedTransaction(operation, `${label} setup ${operation.name}`);
    if (operation.expectedSuccessful !== true) {
      throw new Error(`${label} setup ${operation.name} must be an expected success.`);
    }
  }

  const seen = new Set();
  for (const entry of evidence.cases ?? []) {
    const caseLabel = `${label} case ${entry.name}`;
    if (!liveEvidenceCases.has(entry.name) || seen.has(entry.name)) {
      throw new Error(`${caseLabel} is unknown or duplicated.`);
    }
    seen.add(entry.name);
    if (!hashPattern.test(entry.sessionId ?? "")) {
      throw new Error(`${caseLabel} has an invalid session ID.`);
    }
    if (entry.expected?.outcome !== entry.actual?.outcome || entry.expected?.error !== entry.actual?.error) {
      throw new Error(`${caseLabel} did not produce its expected result.`);
    }
    if (entry.recordedOn === "ledger") {
      validateRecordedTransaction(entry, caseLabel);
      if (entry.expectedSuccessful !== (entry.expected.outcome === "success")) {
        throw new Error(`${caseLabel} expected success does not match its expected outcome.`);
      }
    } else if (entry.recordedOn === "simulation-only") {
      if (entry.transactionHash !== null || !Number.isInteger(entry.observedAtLedger)) {
        throw new Error(`${caseLabel} simulation-only evidence must have no hash and an observed ledger.`);
      }
    } else {
      throw new Error(`${caseLabel} must be recorded on ledger or labelled simulation-only.`);
    }
    if (entry.expected.outcome === "failure") {
      if (JSON.stringify(entry.before) !== JSON.stringify(entry.after) || entry.stateUnchanged !== true) {
        throw new Error(`${caseLabel} rejected operation changed balances or session state.`);
      }
      if (entry.after?.session?.status !== "Open") {
        throw new Error(`${caseLabel} rejected operation finalized the session.`);
      }
    }
  }
  for (const required of liveEvidenceCases) {
    if (!seen.has(required)) {
      throw new Error(`${label} is missing the ${required} case.`);
    }
  }

  const control = evidence.cases.find((entry) => entry.name === "control_settlement_below_cap");
  if (BigInt(control.arguments.actualAmount) >= BigInt(control.before.session.maxAmount)) {
    throw new Error(`${label} control settlement is not below the session cap.`);
  }
  const boundary = evidence.cases.find((entry) => entry.name === "settlement_at_expiry_boundary");
  const boundaryLedger = boundary.ledger ?? boundary.observedAtLedger;
  if (boundaryLedger < boundary.expiresAtLedger) {
    throw new Error(`${label} expiry case was not attempted at or after the boundary.`);
  }
  const lastValid = evidence.cases.find((entry) => entry.name === "settlement_last_valid_ledger");
  if ((lastValid.ledger ?? lastValid.observedAtLedger) >= lastValid.expiresAtLedger) {
    throw new Error(`${label} last-valid settlement was not before the boundary.`);
  }
}

function validatePublicEnvelope(document, source, label) {
  if (secretPattern.test(source) || localPathPattern.test(source)) {
    throw new Error(`${label} contains signing material or a local path.`);
  }

  if (document.environment !== "testnet") {
    throw new Error(`${label} must identify the testnet environment.`);
  }

  if (document.network?.passphrase !== testnetNetwork.passphrase) {
    throw new Error(`${label} contains the wrong network passphrase.`);
  }
  if (
    document.network?.horizonUrl !== testnetNetwork.horizonUrl ||
    document.network?.rpcUrl !== testnetNetwork.rpcUrl
  ) {
    throw new Error(`${label} must use the public Stellar testnet endpoints.`);
  }

  if (!commitPattern.test(document.sourceCommit)) {
    throw new Error(`${label} contains an invalid source commit.`);
  }
}

function validateRecordedTransaction(entry, label) {
  if (!hashPattern.test(entry.transactionHash ?? "")) {
    throw new Error(`${label} has no transaction hash.`);
  }
  if (!Number.isInteger(entry.ledger) || entry.ledger <= 0 || Number.isNaN(Date.parse(entry.createdAt ?? ""))) {
    throw new Error(`${label} has incomplete ledger evidence.`);
  }
  if (!accountPattern.test(entry.sourceAccount ?? "")) {
    throw new Error(`${label} has an invalid source account.`);
  }
  if (typeof entry.expectedSuccessful !== "boolean") {
    throw new Error(`${label} does not state its expected outcome.`);
  }
}
