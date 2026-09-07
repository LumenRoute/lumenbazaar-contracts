import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./lib/stellar-cli.mjs";

const manifestPath = join(repoRoot, "deployments", "testnet-2026-09-06.json");
const source = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(source);
const contractIdPattern = /^C[A-Z2-7]{55}$/;
const accountPattern = /^G[A-Z2-7]{55}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const secretPattern = /\bS[A-Z2-7]{55}\b/;

if (secretPattern.test(source)) {
  throw new Error("Deployment evidence must not contain Stellar secret keys.");
}

if (!accountPattern.test(manifest.deployer)) {
  throw new Error("Deployment evidence contains an invalid deployer account.");
}

if (!commitPattern.test(manifest.sourceCommit)) {
  throw new Error("Deployment evidence contains an invalid source commit.");
}

for (const [name, contract] of Object.entries(manifest.contracts)) {
  if (!contractIdPattern.test(contract.contractId)) {
    throw new Error(`Deployment evidence contains an invalid contract ID for ${name}.`);
  }

  if (!hashPattern.test(contract.artifactSha256)) {
    throw new Error(`Deployment evidence contains an invalid artifact hash for ${name}.`);
  }

  for (const operation of ["upload", "deploy", "initialize"]) {
    const evidence = contract[operation];

    if (!hashPattern.test(evidence?.transactionHash ?? "")) {
      throw new Error(`Deployment evidence is missing ${operation} transaction hash for ${name}.`);
    }

    if (!Number.isInteger(evidence?.ledger) || evidence.ledger <= 0) {
      throw new Error(`Deployment evidence is missing ${operation} ledger for ${name}.`);
    }

    if (Number.isNaN(Date.parse(evidence?.createdAt ?? ""))) {
      throw new Error(`Deployment evidence is missing ${operation} timestamp for ${name}.`);
    }
  }
}

console.log("deployment evidence is sanitized and structurally valid");
