// Resolves every transaction in the published testnet evidence through Horizon and compares
// ledger, close time, source account, and success against the expected outcome.
//
// Exit codes: 0 verified, 1 mismatch (evidence contradicted), 2 outage (Horizon unreachable after
// bounded retries). This script needs network access and runs only in the scheduled workflow.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  collectPublishedTransactions,
  exitCodeFor,
  exitCodes,
  renderSummary,
  verifyTransactions,
} from "./lib/horizon-evidence.mjs";
import { testnetNetwork } from "./lib/deployment-evidence.mjs";
import { repoRoot } from "./lib/stellar-cli.mjs";

const evidenceRoot = pathOption("--evidence-root") ?? repoRoot;
const horizonUrl = optionValue("--horizon-url") ?? testnetNetwork.horizonUrl;
const summaryPath = pathOption("--summary") ?? process.env.GITHUB_STEP_SUMMARY ?? null;

const sources = [
  ["deployments", /^testnet-\d{4}-\d{2}-\d{2}\.json$/],
  ["artifacts/testnet", /^(?:lifecycle|live-evidence)-\d{4}-\d{2}-\d{2}\.json$/],
];
const transactions = [];
const simulationOnly = [];
for (const [directory, pattern] of sources) {
  const absolute = join(evidenceRoot, directory);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute).filter((entry) => pattern.test(entry)).sort()) {
    const file = `${directory}/${name}`;
    const collected = collectPublishedTransactions(file, JSON.parse(readFileSync(join(absolute, name), "utf8")));
    transactions.push(...collected.transactions);
    simulationOnly.push(...collected.simulationOnly);
  }
}
if (transactions.length === 0) {
  console.error("HORIZON_MISMATCH: no published transactions were found to verify.");
  process.exit(exitCodes.mismatch);
}

const results = await verifyTransactions(transactions, { horizonUrl });
const code = exitCodeFor(results);
const summary = renderSummary(results, simulationOnly, { fileLink });

for (const result of results.filter((entry) => entry.status !== "verified")) {
  console.log(`${result.status.toUpperCase()} ${result.file} ${result.label} ${result.transactionHash}: ${result.differences.join("; ")}`);
}
console.log(
  `checked ${results.length} published transaction(s); ` +
    `${results.filter((entry) => entry.status === "verified").length} verified, ` +
    `${simulationOnly.length} simulation-only rejection(s) have no transaction to resolve`,
);
if (summaryPath) {
  appendFileSync(summaryPath, summary, "utf8");
}
if (code === exitCodes.mismatch) {
  console.error("HORIZON_MISMATCH: published evidence is contradicted by Horizon.");
} else if (code === exitCodes.outage) {
  console.error("HORIZON_OUTAGE: Horizon was unavailable after bounded retries; no mismatch was established.");
} else {
  console.log("all published testnet transactions match Horizon");
}
process.exit(code);

function fileLink(file) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_SHA: sha } = process.env;
  return server && repository && sha ? `${server}/${repository}/blob/${sha}/${file}` : file;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function pathOption(name) {
  const value = optionValue(name);
  if (value === null) return null;
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}
