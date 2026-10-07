import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./lib/stellar-cli.mjs";

const contractIdPattern = /^C[A-Z2-7]{55}$/;
const accountPattern = /^G[A-Z2-7]{55}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const secretPattern = /\bS[A-Z2-7]{55}\b/;
const localPathPattern = /(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/)/;
const deploymentDirectory = join(repoRoot, "deployments");
const manifestNames = readdirSync(deploymentDirectory)
  .filter((name) => /^testnet-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort();

if (manifestNames.length === 0) {
  throw new Error("No immutable testnet deployment evidence was found.");
}

for (const manifestName of manifestNames) {
  validateManifest(join(deploymentDirectory, manifestName));
}

console.log(`validated ${manifestNames.length} sanitized testnet deployment manifest(s)`);

function validateManifest(manifestPath) {
  const source = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(source);

  if (secretPattern.test(source) || localPathPattern.test(source)) {
    throw new Error(`${manifestPath} contains signing material or a local path.`);
  }

  if (manifest.environment !== "testnet") {
    throw new Error(`${manifestPath} must identify the testnet environment.`);
  }

  if (manifest.network?.passphrase !== "Test SDF Network ; September 2015") {
    throw new Error(`${manifestPath} contains the wrong network passphrase.`);
  }
  if (
    manifest.network?.horizonUrl !== "https://horizon-testnet.stellar.org" ||
    manifest.network?.rpcUrl !== "https://soroban-testnet.stellar.org"
  ) {
    throw new Error(`${manifestPath} must use the public Stellar testnet endpoints.`);
  }

  if (!accountPattern.test(manifest.deployer)) {
    throw new Error(`${manifestPath} contains an invalid deployer account.`);
  }

  if (manifest.schemaVersion >= 2 && !accountPattern.test(manifest.admin)) {
    throw new Error(`${manifestPath} contains an invalid admin account.`);
  }

  if (!commitPattern.test(manifest.sourceCommit)) {
    throw new Error(`${manifestPath} contains an invalid source commit.`);
  }

  for (const [name, contract] of Object.entries(manifest.contracts)) {
    if (!contractIdPattern.test(contract.contractId)) {
      throw new Error(`${manifestPath} contains an invalid contract ID for ${name}.`);
    }

    if (!hashPattern.test(contract.artifactSha256)) {
      throw new Error(`${manifestPath} contains an invalid artifact hash for ${name}.`);
    }

    if (manifest.schemaVersion >= 2) {
      if (contract.wasmHash !== contract.artifactSha256) {
        throw new Error(`${manifestPath} has mismatched WASM hashes for ${name}.`);
      }
      if (!hashPattern.test(contract.interfaceSha256)) {
        throw new Error(`${manifestPath} contains an invalid interface hash for ${name}.`);
      }
      if (contract.upload?.wasmHash !== contract.wasmHash) {
        throw new Error(`${manifestPath} has a mismatched upload hash for ${name}.`);
      }
    }

    for (const operation of ["upload", "deploy", "initialize"]) {
      const evidence = contract[operation];

      if (!hashPattern.test(evidence?.transactionHash ?? "")) {
        throw new Error(`${manifestPath} is missing ${operation} transaction hash for ${name}.`);
      }

      if (!Number.isInteger(evidence?.ledger) || evidence.ledger <= 0) {
        throw new Error(`${manifestPath} is missing ${operation} ledger for ${name}.`);
      }

      if (Number.isNaN(Date.parse(evidence?.createdAt ?? ""))) {
        throw new Error(`${manifestPath} is missing ${operation} timestamp for ${name}.`);
      }
    }
  }
}
