import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deploymentManifestPattern,
  liveEvidencePattern,
  validateDeploymentManifest,
  validateLiveEvidence,
} from "./lib/deployment-evidence.mjs";
import { repoRoot } from "./lib/stellar-cli.mjs";

const deploymentDirectory = join(repoRoot, "deployments");
const liveEvidenceDirectory = join(repoRoot, "artifacts", "testnet");
const manifestNames = readdirSync(deploymentDirectory)
  .filter((name) => deploymentManifestPattern.test(name))
  .sort();
const liveEvidenceNames = existsSync(liveEvidenceDirectory)
  ? readdirSync(liveEvidenceDirectory)
      .filter((name) => liveEvidencePattern.test(name))
      .sort()
  : [];

if (manifestNames.length === 0) {
  throw new Error("No immutable testnet deployment evidence was found.");
}

for (const manifestName of manifestNames) {
  const manifestPath = join(deploymentDirectory, manifestName);
  const source = readFileSync(manifestPath, "utf8");
  validateDeploymentManifest(JSON.parse(source), source, manifestPath);
}

for (const evidenceName of liveEvidenceNames) {
  const evidencePath = join(liveEvidenceDirectory, evidenceName);
  const source = readFileSync(evidencePath, "utf8");
  const evidence = JSON.parse(source);
  validateLiveEvidence(evidence, source, evidencePath);

  const manifestName = evidence.deploymentManifest.replace(/^deployments\//, "");
  if (!manifestNames.includes(manifestName)) {
    throw new Error(`${evidencePath} references a missing deployment manifest.`);
  }
  const contracts = JSON.parse(readFileSync(join(deploymentDirectory, manifestName), "utf8")).contracts;
  if (
    contracts["upto-session"]?.contractId !== evidence.contractId ||
    contracts["test-token"]?.contractId !== evidence.asset.contractId
  ) {
    throw new Error(`${evidencePath} does not match its deployment manifest contract IDs.`);
  }
}

console.log(`validated ${manifestNames.length} sanitized testnet deployment manifest(s)`);
if (liveEvidenceNames.length > 0) {
  console.log(`validated ${liveEvidenceNames.length} sanitized live rejection evidence file(s)`);
}
