import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runResumableDeployment } from "../lib/deploy-journal.mjs";
import {
  fetchReceipt,
  receiptsDirectory,
  recordReceipt,
  requireTestnet,
  writeReceipt,
} from "../lib/network-receipts.mjs";
import { buildSimulateAndSubmit } from "../lib/soroban-transactions.mjs";
import {
  buildContracts,
  deployUploadedContract,
  getContractWasmHash,
  hasFlag,
  invokeContractTransaction,
  publicKey,
  repoRoot,
  runStellar,
  sourceAccount,
  uploadContract,
  writeManifest,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const resume = hasFlag("--resume");
const source = sourceAccount("testnet-deployer");
const manifestPath = join(repoRoot, "deployments", "testnet.json");
const journalPath = resolveJournalPath();

const available = [
  {
    name: "upto-session",
    alias: "lumenbazaar-upto-session-testnet",
    wasm: "target/wasm32v1-none/release/upto_session.wasm",
  },
  {
    name: "test-token",
    alias: "lumenbazaar-test-token-testnet",
    wasm: "target/wasm32v1-none/release/test_token.wasm",
  },
  {
    name: "policy-wallet-example",
    alias: "lumenbazaar-policy-wallet-testnet",
    wasm: "target/wasm32v1-none/release/policy_wallet_example.wasm",
  },
];
const selected = selectContracts();

if (!dryRun) {
  requireTestnet();
  requireCleanContractSources();
}

buildContracts({ dryRun });

await runResumableDeployment({
  selected,
  resume,
  dryRun,
  network: process.env.STELLAR_NETWORK || "testnet",
  journalPath,
  manifestPath,
  sourceCommit: dryRun ? "dry-run" : git(["rev-parse", "HEAD"]),
  deployer: dryRun ? source : publicKey(source),
  toolchain: dryRun ? {} : toolchainVersions(),
  readArtifactSha256: (contract) => sha256(readFileSync(join(repoRoot, contract.wasm))),
  readInterfaceSha256: (contract) => {
    const interfaceJson = runStellar(
      ["contract", "info", "interface", "--wasm", contract.wasm, "--output", "json"],
      { capture: true, dryRun: false },
    );
    return sha256(interfaceJson);
  },
  uploadContract: async (contract, { artifactSha256, dryRun: isDryRun }) => {
    const upload = uploadContract({ ...contract, source, dryRun: isDryRun });
    if (!isDryRun && upload.skipped) {
      // The CLI skips WASM that another account already installed. Public evidence needs an upload
      // signed by this deployer, so submit the install transaction explicitly.
      const receipt = await buildSimulateAndSubmit(
        [
          "contract",
          "upload",
          "--wasm",
          contract.wasm,
          "--source-account",
          source,
          "--network",
          "testnet",
          "--build-only",
        ],
        source,
      );
      if (receipt.status !== "SUCCESS") {
        throw new Error(`Explicit upload of ${contract.name} failed on ledger.`);
      }
      upload.transactionHash = receipt.transactionHash;
      upload.wasmHash = artifactSha256;
      console.log(
        `${contract.name}: WASM was already installed; recorded an explicit upload by the deployer`,
      );
    }
    return upload;
  },
  deployContract: async (contract, { wasmHash, dryRun: isDryRun }) =>
    deployUploadedContract({ ...contract, wasmHash, source, dryRun: isDryRun }),
  recordReceipt: async (transactionHash) => recordReceipt(transactionHash),
  verifyReceipt: async (transactionHash) => {
    const localPath = join(receiptsDirectory, `${transactionHash}.json`);
    if (existsSync(localPath)) {
      return JSON.parse(readFileSync(localPath, "utf8"));
    }
    const receipt = await fetchReceipt(transactionHash);
    writeReceipt(receipt);
    return receipt;
  },
  verifyContractWasmHash: async (contractId) =>
    getContractWasmHash({ contractId, network: "testnet" }),
  readAssetMetadata: async (contractId) => readAssetMetadata(contractId),
  writeManifest,
});

function resolveJournalPath() {
  const index = process.argv.indexOf("--journal");
  if (index === -1) {
    return join(repoRoot, "deployments", "testnet.deploy-journal.json");
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("--journal requires a file path");
  }
  return resolve(repoRoot, value);
}

function selectContracts() {
  const index = process.argv.indexOf("--contracts");
  if (index === -1) {
    return available;
  }
  const names = (process.argv[index + 1] ?? "").split(",").filter(Boolean);
  const unknown = names.filter((name) => !available.some((contract) => contract.name === name));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(
      `--contracts accepts a comma-separated subset of: ${available.map((c) => c.name).join(", ")}`,
    );
  }
  return available.filter((contract) => names.includes(contract.name));
}

function requireCleanContractSources() {
  const changes = git([
    "status",
    "--porcelain",
    "--",
    "contracts",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
  ]);
  if (changes) {
    throw new Error(
      "Contract sources differ from HEAD; public evidence must be built from the recorded commit.",
    );
  }
}

function toolchainVersions() {
  const stellar = runStellar(["--version"], { capture: true });
  const lock = readFileSync(join(repoRoot, "Cargo.lock"), "utf8");
  return {
    stellarCli: stellar.match(/^stellar (\S+)/m)?.[1],
    stellarXdr: stellar.match(/^stellar-xdr (\S+)/m)?.[1],
    rustc: run("rustc", ["--version"]).match(/^rustc (\S+)/)?.[1],
    sorobanSdk: lock.match(/name = "soroban-sdk"\r?\nversion = "([^"]+)"/)?.[1],
    target: "wasm32v1-none",
  };
}

function readAssetMetadata(contractId) {
  const read = (method) =>
    JSON.parse(
      invokeContractTransaction({
        contractId,
        source,
        network: "testnet",
        args: [method],
        send: "no",
      }).stdout,
    );
  return {
    code: read("symbol"),
    decimals: read("decimals"),
    purpose: "Custom test-only token; not USDC",
  };
}

function git(args) {
  return run("git", args);
}

function run(command, args) {
  return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
