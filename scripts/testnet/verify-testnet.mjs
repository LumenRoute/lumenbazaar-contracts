import { join, resolve } from "node:path";
import {
  hasFlag,
  networkArgs,
  readManifest,
  repoRoot,
  runStellar,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const manifestPath = process.env.LUMENBAZAAR_DEPLOYMENT_MANIFEST
  ? resolve(repoRoot, process.env.LUMENBAZAAR_DEPLOYMENT_MANIFEST)
  : join(repoRoot, "deployments", "testnet.json");
const manifest = readManifest(manifestPath);
const contracts = manifest.contracts || {};
const wasmPaths = {
  "upto-session": "target/wasm32v1-none/release/upto_session.wasm",
  "test-token": "target/wasm32v1-none/release/test_token.wasm",
  "policy-wallet-example": "target/wasm32v1-none/release/policy_wallet_example.wasm",
};

for (const name of ["upto-session", "test-token", "policy-wallet-example"]) {
  const contractId = contracts[name]?.contractId || `dry-run-${name}`;
  if (!dryRun && !/^C[A-Z2-7]{55}$/.test(contractId)) {
    throw new Error(`Missing valid testnet contract ID for ${name}`);
  }

  const liveHash = runStellar(
    ["contract", "info", "hash", "--id", contractId, ...networkArgs("testnet")],
    { capture: true, dryRun },
  );
  const localHash = runStellar(
    ["contract", "info", "hash", "--wasm", wasmPaths[name]],
    { capture: true, dryRun },
  );
  const expectedHash = contracts[name]?.wasmHash || contracts[name]?.artifactSha256;

  const liveInterface = runStellar(
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
  const localInterface = runStellar(
    [
      "contract",
      "info",
      "interface",
      "--wasm",
      wasmPaths[name],
      "--output",
      "json",
    ],
    { capture: true, dryRun },
  );

  if (!dryRun && (liveHash !== localHash || liveHash !== expectedHash)) {
    throw new Error(`Live, local, and manifest WASM hashes differ for ${name}`);
  }
  if (!dryRun && (liveInterface !== localInterface || !liveInterface.startsWith("["))) {
    throw new Error(`Live and local interfaces differ for ${name}`);
  }
  console.log(`verified live hash and interface for ${name}`);
}
