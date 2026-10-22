import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  validateDeploymentManifest,
  validateLiveEvidence,
} from "../lib/deployment-evidence.mjs";
import {
  buildPublicDeploymentManifest,
  buildPublicLiveEvidence,
  ManifestGenerationError,
  scanForSecrets,
  serializeDeterministic,
} from "../lib/public-manifest.mjs";
import { hasFlag, repoRoot } from "../lib/stellar-cli.mjs";

const kinds = {
  deployment: {
    input: join(repoRoot, "deployments", "testnet.json"),
    outputDir: join(repoRoot, "deployments"),
    fileName: (date) => `testnet-${date}.json`,
    build: buildPublicDeploymentManifest,
    validate: validateDeploymentManifest,
  },
  evidence: {
    input: join(repoRoot, "deployments", "testnet-evidence.json"),
    outputDir: join(repoRoot, "artifacts", "testnet"),
    fileName: (date) => `live-evidence-${date}.json`,
    build: buildPublicLiveEvidence,
    validate: validateLiveEvidence,
  },
};
const aliasEnvironmentVariables = [
  "STELLAR_ACCOUNT",
  "LUMENBAZAAR_SOURCE_ACCOUNT",
  "LUMENBAZAAR_ADMIN",
  "LUMENBAZAAR_TEST_TOKEN_ADMIN",
  "LUMENBAZAAR_POLICY_OWNER",
  "LUMENBAZAAR_BUYER",
  "LUMENBAZAAR_SELLER",
  "LUMENBAZAAR_WRONG_SELLER",
  "LUMENBAZAAR_WRONG_BUYER",
];

try {
  run();
} catch (error) {
  console.error(`REFUSED: ${error instanceof ManifestGenerationError ? error.message : error?.message ?? error}`);
  console.error("No public manifest was written.");
  process.exit(1);
}

function run() {
  const kindName = optionValue("--kind") ?? "deployment";
  const kind = kinds[kindName];
  if (!kind) {
    throw new ManifestGenerationError(`Unsupported --kind ${JSON.stringify(kindName)}`);
  }
  const inputPath = pathOption("--input") ?? kind.input;
  const receiptsDir = pathOption("--receipts") ?? join(repoRoot, "deployments", "receipts", "testnet");
  const outputDir = pathOption("--output-dir") ?? kind.outputDir;
  const deploymentsDir = pathOption("--deployments-dir") ?? join(repoRoot, "deployments");
  const dryRun = hasFlag("--dry-run");

  if (!existsSync(inputPath)) {
    throw new ManifestGenerationError(`Local ${kindName} input does not exist: ${displayPath(inputPath)}`);
  }
  const local = JSON.parse(readFileSync(inputPath, "utf8"));
  const receipts = readReceipts(receiptsDir);
  const { document, dropped, date } = kind.build(local, receipts);

  const aliases = collectAliases(local);
  const findings = scanForSecrets(document, { aliases });
  if (findings.length > 0) {
    throw new ManifestGenerationError(
      "Secret-pattern validation failed",
      findings.map(({ path, rule }) => `${path} (${rule})`),
    );
  }

  const serialized = serializeDeterministic(document);
  const outputPath = join(outputDir, kind.fileName(date));
  kind.validate(JSON.parse(serialized), serialized, displayPath(outputPath));
  if (kindName === "evidence") {
    checkReferencedDeployment(document, deploymentsDir);
  }

  if (dropped.length > 0) {
    console.log(`dropped ${dropped.length} local-only field(s): ${dropped.join(", ")}`);
  }

  if (existsSync(outputPath)) {
    if (readFileSync(outputPath, "utf8") === serialized) {
      console.log(`unchanged ${displayPath(outputPath)} (byte-identical regeneration)`);
      return;
    }
    throw new ManifestGenerationError(
      `${displayPath(outputPath)} already exists with different content; published manifests are immutable`,
    );
  }

  if (dryRun) {
    console.log(`dry run: would write ${displayPath(outputPath)} (${serialized.length} bytes)`);
    return;
  }

  writeFileSync(outputPath, serialized, "utf8");
  if (resolve(outputDir) === resolve(kind.outputDir)) {
    const check = spawnSync(process.execPath, [join(repoRoot, "scripts", "check-deployment-evidence.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (check.status !== 0) {
      unlinkSync(outputPath);
      throw new ManifestGenerationError(
        `check-deployment-evidence.mjs rejected the generated file: ${(check.stderr || check.stdout).trim().split(/\r?\n/)[0]}`,
      );
    }
    console.log(check.stdout.trim());
  }
  console.log(`wrote ${displayPath(outputPath)}`);
}

function readReceipts(directory) {
  const receipts = new Map();
  if (!existsSync(directory)) {
    return receipts;
  }
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const receipt = JSON.parse(readFileSync(join(directory, name), "utf8"));
    if (`${receipt.transactionHash}.json` !== name) {
      throw new ManifestGenerationError(`Receipt file ${name} does not match its transaction hash`);
    }
    receipts.set(receipt.transactionHash, receipt);
  }
  return receipts;
}

function checkReferencedDeployment(document, deploymentsDir) {
  const manifestPath = join(deploymentsDir, document.deploymentManifest.replace(/^deployments\//, ""));
  if (!existsSync(manifestPath)) {
    throw new ManifestGenerationError(`Referenced deployment manifest ${document.deploymentManifest} is not published`);
  }
  const contracts = JSON.parse(readFileSync(manifestPath, "utf8")).contracts;
  if (
    contracts["upto-session"]?.contractId !== document.contractId ||
    contracts["test-token"]?.contractId !== document.asset.contractId
  ) {
    throw new ManifestGenerationError("Evidence contract IDs do not match the referenced deployment manifest");
  }
}

function collectAliases(local) {
  const aliases = [
    ...Object.values(local.contracts ?? {}).map((contract) => contract.alias),
    ...Object.values(local.localAliases ?? {}),
    ...aliasEnvironmentVariables.map((name) => process.env[name]),
  ];
  try {
    const listed = execFileSync("stellar", ["keys", "ls"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    aliases.push(...listed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {
    // Without the CLI the scan still covers manifest, evidence, and environment aliases.
  }
  return aliases.filter((alias) => typeof alias === "string" && !/^[GC][A-Z2-7]{55}$/.test(alias));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new ManifestGenerationError(`${name} requires a value`);
  return value;
}

function pathOption(name) {
  const value = optionValue(name);
  if (value === null) return null;
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function displayPath(path) {
  const relativePath = relative(repoRoot, path);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? "<path outside repository>"
    : relativePath.replaceAll("\\", "/");
}
