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
    spec: join(specDir, "upto-session.xdr-base64.txt"),
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
    spec: join(specDir, "policy-wallet-example.xdr-base64.txt"),
  },
  {
    name: "test-token",
    wasm: join(repoRoot, "target", "wasm32v1-none", "release", "test_token.wasm"),
    spec: join(specDir, "test-token.xdr-base64.txt"),
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

  const spec = execFileSync(
    "stellar",
    [
      "contract",
      "info",
      "interface",
      "--wasm",
      contract.wasm,
      "--output",
      "xdr-base64",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  writeFileSync(contract.spec, `${spec.trimEnd()}\n`, "ascii");
}
