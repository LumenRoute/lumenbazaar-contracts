import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logDeployment, redactText, signerValues } from "./deployment-logging.mjs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function hasFlag(flag) {
  return process.argv.includes(flag);
}

export function sourceAccount(defaultValue = "local-deployer") {
  if (hasFlag("--dry-run")) {
    return (
      process.env.LUMENBAZAAR_SOURCE_ACCOUNT ||
      process.env.STELLAR_ACCOUNT ||
      defaultValue
    );
  }

  const source = process.env.LUMENBAZAAR_SOURCE_ACCOUNT || process.env.STELLAR_ACCOUNT;
  if (!source) {
    throw new Error("Set STELLAR_ACCOUNT or LUMENBAZAAR_SOURCE_ACCOUNT");
  }
  return source;
}

export function networkArgs(defaultNetwork) {
  const network = process.env.STELLAR_NETWORK || defaultNetwork;
  return network ? ["--network", network] : [];
}

export function runStellar(args, { capture = false, dryRun = false, execute = spawnSync } = {}) {
  const redact = signerValues(args);
  if (dryRun) {
    logDeployment("stellar.dry-run", { command: formatCommand("stellar", args) }, { redact });
    return "";
  }

  const result = execute("stellar", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`stellar ${args[0]} failed: ${sanitizeCliOutput(result.stderr || result.error?.message, redact)}`);
  }
  if (result.stderr) logDeployment("stellar.diagnostics", { stderr: result.stderr }, { redact, sink: console.error });
  if (!capture && result.stdout) logDeployment("stellar.output", { stdout: result.stdout }, { redact });
  return capture ? String(result.stdout ?? "").trim() : "";
}

// Runs a transaction-submitting command and returns stdout plus the submitted transaction hash.
// CLI diagnostics are never echoed verbatim because they can include local identity aliases.
export function runStellarTransaction(args, { dryRun = false, redact = [], execute = spawnSync } = {}) {
  redact = [...redact, ...signerValues(args)];
  if (dryRun) {
    logDeployment("stellar.dry-run", { command: formatCommand("stellar", args) }, { redact });
    return { stdout: "", transactionHash: null, skipped: false };
  }

  const result = execute("stellar", args, { cwd: repoRoot, encoding: "utf8" });
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(`stellar ${args[0]} ${args[1] ?? ""} failed: ${sanitizeCliOutput(stderr, redact)}`);
  }
  return {
    stdout: (result.stdout ?? "").trim(),
    // Stellar CLI 28 logs `Signing transaction: <hash>`; some paths also log `Transaction hash is <hash>`.
    transactionHash:
      [...stderr.matchAll(/(?:Transaction hash is|Signing transaction:) ([a-f0-9]{64})/g)].pop()?.[1] ?? null,
    skipped: /Skipping install because wasm already installed/.test(stderr),
  };
}

export function sanitizeCliOutput(text, redact = []) {
  return redactText(text, redact).trim() || "no error details";
}

export function publicKey(identity) {
  if (/^G[A-Z2-7]{55}$/.test(identity)) {
    return identity;
  }
  const address = runStellar(["keys", "public-key", identity], { capture: true });
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    throw new Error("Could not resolve a public account for a local identity.");
  }
  return address;
}

export function uploadContract({ name, wasm, source, network = "testnet", dryRun = false }) {
  const { stdout, transactionHash, skipped } = runStellarTransaction(
    ["contract", "upload", "--wasm", wasm, "--source-account", source, ...networkArgs(network)],
    { dryRun, redact: [source] },
  );
  if (dryRun) {
    return { wasmHash: "dry-run", transactionHash: null, skipped: false };
  }
  if (!skipped && !transactionHash) {
    throw new Error(`Uploading ${name} returned no transaction hash.`);
  }
  // When the CLI skips an already-installed WASM, `skipped` is true and no transaction was sent.
  return { wasmHash: stdout.split(/\r?\n/).pop().trim(), transactionHash, skipped };
}

export function deployUploadedContract({ name, wasmHash, alias, source, network = "testnet", dryRun = false }) {
  const { stdout, transactionHash } = runStellarTransaction(
    [
      "contract",
      "deploy",
      "--wasm-hash",
      wasmHash,
      "--source-account",
      source,
      ...networkArgs(network),
      "--alias",
      alias,
    ],
    { dryRun, redact: [source, alias] },
  );
  if (dryRun) {
    return { contractId: `dry-run-${name}`, transactionHash: null };
  }
  const contractId = findContractId(stdout);
  if (!contractId || !transactionHash) {
    throw new Error(`Deploying ${name} returned no contract ID or transaction hash.`);
  }
  return { contractId, transactionHash };
}

export function buildContracts({ dryRun = false } = {}) {
  runStellar(["contract", "build", "--locked"], { dryRun });
}

export function deployContract({
  name,
  wasm,
  alias,
  source,
  network = "local",
  dryRun = false,
}) {
  const args = [
    "contract",
    "deploy",
    "--wasm",
    wasm,
    "--source-account",
    source,
    ...networkArgs(network),
    "--alias",
    alias,
  ];
  const output = runStellar(args, { capture: true, dryRun });

  return {
    name,
    alias,
    network: process.env.STELLAR_NETWORK || network,
    wasm,
    contractId: output ? findContractId(output) || output : "dry-run",
  };
}

export function invokeContract({
  contractId,
  source,
  network = "local",
  args,
  capture = false,
  dryRun = false,
}) {
  return runStellar(
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source-account",
      source,
      ...networkArgs(network),
      "--",
      ...args,
    ],
    { capture, dryRun },
  );
}

export function invokeContractTransaction({
  contractId,
  source,
  network = "testnet",
  args,
  send = "default",
  dryRun = false,
  redact = [],
}) {
  return runStellarTransaction(
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source-account",
      source,
      ...networkArgs(network),
      "--send",
      send,
      "--",
      ...args,
    ],
    { dryRun, redact: [source, ...redact] },
  );
}

export function readManifest(path) {
  if (!existsSync(path)) {
    return { contracts: {} };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeManifest(path, manifest, { dryRun = false } = {}) {
  const value = {
    ...manifest,
    generatedAt: new Date().toISOString(),
  };

  if (dryRun) {
    console.log(`write ${relative(repoRoot, path)}`);
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function mergeContracts(
  manifestPath,
  contractEntries,
  { dryRun = false, fields = {}, mergeEntries = false } = {},
) {
  const manifest = readManifest(manifestPath);
  const contracts = { ...(manifest.contracts || {}) };
  for (const entry of contractEntries) {
    contracts[entry.name] = mergeEntries ? { ...(contracts[entry.name] || {}), ...entry } : entry;
  }

  writeManifest(
    manifestPath,
    {
      ...manifest,
      ...fields,
      contracts,
    },
    { dryRun },
  );
}

function findContractId(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^C[A-Z2-7]{55}$/.test(line));
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => quoteArg(part)).join(" ");
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
