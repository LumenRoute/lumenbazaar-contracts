import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const specDir = join(repoRoot, "artifacts", "spec");

const contracts = [
  {
    name: "upto-session",
    wasm: join(repoRoot, "target", "wasm32v1-none", "release", "upto_session.wasm"),
    spec: join(specDir, "upto-session.json"),
  },
  {
    name: "policy-wallet-example",
    wasm: join(
      repoRoot,
      "target",
      "wasm32v1-none",
      "release",
      "policy_wallet_example.wasm",
    ),
    spec: join(specDir, "policy-wallet-example.json"),
  },
  {
    name: "test-token",
    wasm: join(repoRoot, "target", "wasm32v1-none", "release", "test_token.wasm"),
    spec: join(specDir, "test-token.json"),
  },
];

if (!skipBuild) {
  execFileSync("stellar", ["contract", "build", "--locked"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

mkdirSync(specDir, { recursive: true });

for (const contract of contracts) {
  if (!existsSync(contract.wasm)) {
    throw new Error(`Missing built WASM for ${contract.name}: ${contract.wasm}`);
  }

  const output = execFileSync(
    "stellar",
    [
      "contract",
      "info",
      "interface",
      "--wasm",
      contract.wasm,
      "--output",
      "json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const entries = canonicalize(JSON.parse(output));
  entries.sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
  writeFileSync(contract.spec, `${JSON.stringify(entries, null, 2)}\n`, "ascii");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key === "type_" ? "type" : key, canonicalize(entryValue)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function entryKey(entry) {
  const [kind, value] = Object.entries(entry)[0] ?? [];

  if (kind === undefined || typeof value !== "object" || value === null) {
    throw new Error("Stellar CLI returned an invalid contract interface entry.");
  }

  return `${kind}:${value.name ?? JSON.stringify(value)}`;
}
