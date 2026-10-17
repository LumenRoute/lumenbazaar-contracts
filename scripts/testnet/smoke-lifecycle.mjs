import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { repoRoot } from "../lib/stellar-cli.mjs";
import { buildConfig, createRpc, runSmoke, sha256Hex } from "../lib/testnet-smoke.mjs";

// Opt-in live testnet lifecycle smoke runner.
//
//   node scripts/testnet/smoke-lifecycle.mjs                 plan only; no network, no signing
//   LUMENBAZAAR_LIVE_SMOKE=1 node scripts/testnet/smoke-lifecycle.mjs --execute
//
// Identities are local Stellar CLI aliases. This script never reads, prints, or stores key
// material, and the report contains only public values. It supports testnet only.

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const execute = flag("--execute");
const manifestPath = resolve(
  repoRoot,
  option("--manifest") || join("deployments", "testnet-2026-10-07.json"),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (!execute) {
  const config = buildConfig(
    {
      ...process.env,
      LUMENBAZAAR_SMOKE_BUYER: process.env.LUMENBAZAAR_SMOKE_BUYER || "buyer-alias",
      LUMENBAZAAR_SMOKE_SELLER: process.env.LUMENBAZAAR_SMOKE_SELLER || "seller-alias",
      LUMENBAZAAR_SMOKE_TOKEN_ADMIN: process.env.LUMENBAZAAR_SMOKE_TOKEN_ADMIN || "token-admin-alias",
    },
    manifest,
  );
  console.log("dry run: no network access, signing, or transactions");
  console.log(`network: ${config.network}`);
  console.log(`upto-session: ${config.uptoSession}`);
  console.log(`asset (test-only LBT): ${config.asset}`);
  console.log(`cap per session: ${config.cap}, settled amount: ${config.settleAmount}`);
  console.log("plan: mint shortfall, create+settle, replay settle (expect #6), create+cancel");
  console.log("run for real with LUMENBAZAAR_LIVE_SMOKE=1 and --execute");
  process.exit(0);
}

if (process.env.LUMENBAZAAR_LIVE_SMOKE !== "1") {
  throw new Error("Live smoke runs are opt-in: set LUMENBAZAAR_LIVE_SMOKE=1 together with --execute.");
}

const config = buildConfig(process.env, manifest);
const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).trim();
const sourceCommit = git("rev-parse", "HEAD");
const sourceTreeClean = git("status", "--porcelain", "--untracked-files=no") === "";
if (!sourceTreeClean && !flag("--allow-dirty")) {
  throw new Error("The working tree has uncommitted changes; commit them or pass --allow-dirty.");
}

const runId = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${sha256Hex(
  `${sourceCommit}:${Date.now()}`,
).slice(0, 8)}`;
const exec = (stellarArgs) => {
  const result = spawnSync("stellar", stellarArgs, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) {
    throw new Error("The Stellar CLI could not be started; install Stellar CLI 28.0.0.");
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const report = await runSmoke({
  config,
  exec,
  rpc: createRpc(config.rpcUrl),
  sourceCommit,
  sourceTreeClean,
  runId,
});

const output = resolve(
  repoRoot,
  option("--output") || join("target", "testnet-smoke", `lifecycle-${runId}.json`),
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`wrote sanitized smoke report to ${output}`);
console.log("verify with: node scripts/check-testnet-smoke.mjs <report>");
