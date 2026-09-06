import { join } from "node:path";
import {
  hasFlag,
  networkArgs,
  readManifest,
  repoRoot,
  runStellar,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const manifest = readManifest(join(repoRoot, "deployments", "testnet.json"));
const contracts = manifest.contracts || {};

for (const name of ["upto-session", "test-token", "policy-wallet-example"]) {
  const contractId = contracts[name]?.contractId || `dry-run-${name}`;
  if (!dryRun && !/^C[A-Z2-7]{55}$/.test(contractId)) {
    throw new Error(`Missing valid testnet contract ID for ${name}`);
  }

  const output = runStellar(
    [
      "contract",
      "info",
      "interface",
      "--contract-id",
      contractId,
      ...networkArgs("testnet"),
      "--output",
      "json",
    ],
    { capture: true, dryRun },
  );

  if (!dryRun && !output.startsWith("[")) {
    throw new Error(`Unexpected interface output for ${name}`);
  }
  console.log(`verified ${name}`);
}
